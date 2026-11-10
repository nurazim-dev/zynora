(() => {
  const loginPanel = document.querySelector("[data-admin-login]");
  if (!loginPanel) return;
  const appPanel = document.querySelector("[data-admin-app]");
  const logoutButton = document.querySelector("[data-admin-logout]");
  const dialog = document.querySelector("[data-confirm-dialog]");
  let pendingCancellation = null;
  const nextStatuses = { PENDING_PAYMENT: ["PAID", "CANCELLED"], PAYMENT_REPORTED: ["PAID", "CANCELLED"], PAID: ["PROCESSING", "CANCELLED"], PROCESSING: ["SHIPPED", "CANCELLED"], SHIPPED: ["DELIVERED", "CANCELLED"], DELIVERED: [], CANCELLED: [] };
  const labels = { PENDING_PAYMENT: "Ожидает оплаты", PAYMENT_REPORTED: "Оплата сообщена", PAID: "Оплачен", PROCESSING: "В обработке", SHIPPED: "В доставке", DELIVERED: "Доставлен", CANCELLED: "Отменён" };
  const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (value) => `${new Intl.NumberFormat("ru-RU").format(value || 0)} сом`;
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос.");
    return data;
  };
  const showError = (message) => {
    let toast = document.querySelector("#toast-region");
    if (!toast) { toast = document.createElement("div"); toast.id = "toast-region"; toast.className = "toast-region"; document.body.append(toast); }
    const item = document.createElement("div"); item.className = "toast toast-error"; item.textContent = message; toast.append(item); setTimeout(() => item.remove(), 4000);
  };
  const showAdmin = async (user) => {
    if (!user || user.role !== "ADMIN") { loginPanel.classList.remove("is-hidden"); appPanel.classList.add("is-hidden"); logoutButton.hidden = true; return; }
    loginPanel.classList.add("is-hidden"); appPanel.classList.remove("is-hidden"); logoutButton.hidden = false;
    await loadDashboard(); await Promise.all([loadOrders(), loadProducts(), loadCoupons(), loadReviews()]);
  };
  document.querySelector("[data-admin-login-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    try { const result = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify(data) }); await showAdmin(result.user); }
    catch (error) { const node = document.querySelector("[data-admin-login-error]"); node.textContent = error.message; node.classList.remove("is-hidden"); }
  });
  logoutButton.addEventListener("click", async () => { try { await api("/api/v1/auth/logout", { method: "POST", body: "{}" }); location.reload(); } catch (error) { showError(error.message); } });
  document.querySelectorAll("[data-admin-section]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-admin-section]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-admin-panel]").forEach((item) => item.classList.toggle("active", item.dataset.adminPanel === button.dataset.adminSection));
  }));

  async function loadDashboard() {
    try {
      const data = await api("/api/v1/admin/dashboard");
      document.querySelector("[data-admin-metrics]").innerHTML = [
        ["Всего заказов", data.counts.total], ["Ожидают оплаты", data.counts.pending], ["Оплаченные", data.counts.paid], ["Выручка всего", fmt(data.revenue.allTime)], ["Выручка за день", fmt(data.revenue.day)], ["За 7 дней", fmt(data.revenue.week)], ["За месяц", fmt(data.revenue.month)], ["Средний чек", fmt(data.revenue.averageOrder)],
      ].map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
      document.querySelector("[data-recent-orders]").innerHTML = data.recentOrders.map((order) => `<tr><td>${esc(order.orderNumber)}</td><td>${esc(order.customerName)}</td><td>${fmt(order.total)}</td><td>${labels[order.status]}</td><td>${new Date(order.createdAt).toLocaleDateString("ru-RU")}</td></tr>`).join("") || `<tr><td colspan="5">Заказов пока нет.</td></tr>`;
      document.querySelector("[data-low-stock]").innerHTML = data.lowStock.map((product) => `<div class="summary-line"><span>${esc(product.name)}</span><strong>${product.availableStock} доступно</strong></div>`).join("") || `<p class="muted">Критичных остатков нет.</p>`;
      document.querySelector("[data-top-products]").innerHTML = data.topProducts.map((row) => `<div class="summary-line"><span>${esc(row.name)} · ${row.quantity} шт.</span><strong>${fmt(row.revenue)}</strong></div>`).join("") || `<p class="muted">Продаж пока нет.</p>`;
      document.querySelector("[data-popular-categories]").innerHTML = data.popularCategories.map((row) => `<div class="summary-line"><span>${esc(row.name)}</span><strong>${row.quantity} шт.</strong></div>`).join("") || `<p class="muted">Данных пока нет.</p>`;
    } catch (error) { showError(error.message); }
  }

  async function loadOrders() {
    const status = document.querySelector("[data-order-filter]").value;
    const search = document.querySelector("[data-order-search]").value.trim();
    const params = new URLSearchParams(); if (status) params.set("status", status); if (search) params.set("q", search);
    try {
      const { orders } = await api(`/api/v1/orders?${params}`);
      document.querySelector("[data-orders-table]").innerHTML = orders.map((order) => {
        const choices = [order.status, ...(nextStatuses[order.status] || [])];
        const options = choices.map((statusValue) => `<option value="${statusValue}" ${order.status === statusValue ? "selected" : ""}>${labels[statusValue]}</option>`).join("");
        const history = (order.statusHistory || []).map((entry) => `${labels[entry.to]} · ${new Date(entry.createdAt).toLocaleString("ru-RU")}`).join("<br>");
        const paymentNote = order.status === "PAYMENT_REPORTED" || (order.status === "PENDING_PAYMENT" && order.paymentReported) ? "<br><strong>Покупатель сообщил об оплате</strong>" : "";
        return `<tr data-order-row="${order.id}"><td><strong>${esc(order.orderNumber)}</strong><br><small>${new Date(order.createdAt).toLocaleString("ru-RU")}</small>${paymentNote}</td><td>${esc(order.customerName)}<br>${esc(order.user?.email || "Гостевой заказ")}<br>${esc(order.phone)}<br>${esc(order.city)}, ${esc(order.address)}</td><td>${order.items.map((item) => `${esc(item.productName)} × ${item.quantity}`).join("<br>")}</td><td>${fmt(order.total)}</td><td><select data-status-select>${options}</select><button class="text-button" data-save-status="${order.id}">Сохранить</button><button class="text-button" data-notify-order="${order.id}">${order.telegramNotified ? "Отправлено в Telegram" : "Повторить Telegram"}</button></td><td>${history || "—"}<br><a href="/api/v1/orders/${order.id}/invoice" target="_blank" rel="noopener">Накладная</a></td></tr>`;
      }).join("") || `<tr><td colspan="6">Заказы не найдены.</td></tr>`;
    } catch (error) { showError(error.message); }
  }

  document.querySelector("[data-load-orders]").addEventListener("click", loadOrders);
  document.querySelector("[data-order-filter]").addEventListener("change", loadOrders);
  document.querySelector("[data-order-search]").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); loadOrders(); } });
  document.querySelector("[data-orders-table]").addEventListener("click", async (event) => {
    const notify = event.target.closest("[data-notify-order]");
    if (notify) {
      notify.disabled = true;
      try { await api(`/api/v1/orders/${notify.dataset.notifyOrder}/notify`, { method: "POST", body: "{}" }); await loadOrders(); }
      catch (error) { showError(error.message); notify.disabled = false; }
      return;
    }
    const button = event.target.closest("[data-save-status]"); if (!button) return;
    const id = Number(button.dataset.saveStatus); const status = button.closest("tr").querySelector("[data-status-select]").value;
    if (status === "CANCELLED") { pendingCancellation = { id, button }; dialog.showModal(); return; }
    await changeStatus(id, status, button);
  });
  document.querySelector("[data-confirm-no]").addEventListener("click", () => { pendingCancellation = null; dialog.close(); });
  document.querySelector("[data-confirm-yes]").addEventListener("click", async () => { if (pendingCancellation) await changeStatus(pendingCancellation.id, "CANCELLED", pendingCancellation.button); pendingCancellation = null; dialog.close(); });

  async function changeStatus(id, status, button) {
    button.disabled = true;
    try { await api(`/api/v1/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); await Promise.all([loadOrders(), loadDashboard()]); }
    catch (error) { showError(error.message); }
    finally { button.disabled = false; }
  }

  async function loadProducts() {
    try {
      const [{ products }, { categories }] = await Promise.all([api("/api/v1/admin/products"), api("/api/v1/products/categories")]);
      document.querySelector("[data-products-table]").innerHTML = products.map((product) => `<tr data-product-row="${product.id}"><td>${esc(product.name)}<br><small>${esc(product.slug)}</small></td><td>${esc(product.category.name)}</td><td><input data-product-price type="number" min="1" value="${product.price ?? ""}" placeholder="Цена не задана"></td><td><input data-product-stock type="number" min="0" value="${product.stock}"><small>Резерв ${product.reservedStock} · доступно ${product.availableStock}</small></td><td><input data-product-active type="checkbox" ${product.active ? "checked" : ""}></td><td><button class="text-button" data-save-product="${product.id}">Сохранить</button><br><button class="text-button" data-inventory-history="${product.id}">История склада</button></td></tr>`).join("");
      document.querySelector("[data-product-categories]").innerHTML = categories.map((category) => `<option value="${category.id}">${esc(category.name)}</option>`).join("");
    } catch (error) { showError(error.message); }
  }

  document.querySelector("[data-products-table]").addEventListener("click", async (event) => {
    const historyButton = event.target.closest("[data-inventory-history]");
    if (historyButton) {
      try {
        const data = await api(`/api/v1/admin/products/${historyButton.dataset.inventoryHistory}/inventory`);
        const history = data.movements.map((entry) => `${new Date(entry.createdAt).toLocaleString("ru-RU")} · ${entry.type} · ${entry.quantity} шт. · ${entry.note || ""}`).join("\n");
        window.alert(`${data.product.name}\nВсего: ${data.product.stock} · в резерве: ${data.product.reservedStock} · доступно: ${data.product.availableStock}\n\n${history || "Операций пока нет."}`);
      } catch (error) { showError(error.message); }
      return;
    }
    const button = event.target.closest("[data-save-product]"); if (!button) return;
    const row = button.closest("tr");
    const price = row.querySelector("[data-product-price]").value;
    const data = { price: price ? Number(price) : null, stock: Number(row.querySelector("[data-product-stock]").value), active: row.querySelector("[data-product-active]").checked };
    try { await api(`/api/v1/products/${button.dataset.saveProduct}`, { method: "PATCH", body: JSON.stringify(data) }); showError("Сохранено."); await loadDashboard(); }
    catch (error) { showError(error.message); }
  });

  document.querySelector("[data-create-product]").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    const fields = new FormData(form);
    const image = fields.get("imageFile");
    const data = Object.fromEntries(fields.entries());
    delete data.imageFile;
    try {
      if (!(image instanceof File) || !image.size) throw new Error("Выберите фотографию товара.");
      if (image.size > 5 * 1024 * 1024) throw new Error("Файл изображения должен быть не больше 5 МБ.");
      const uploadResponse = await fetch("/api/v1/admin/product-image", { method: "POST", credentials: "same-origin", headers: { "Content-Type": image.type }, body: image });
      const uploaded = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) throw new Error(uploaded.error || "Не удалось загрузить фотографию.");
      data.imagePath = uploaded.imagePath;
      data.categoryId = Number(data.categoryId); data.price = Number(data.price); data.stock = Number(data.stock); data.active = true;
      data.specifications = JSON.parse(data.specifications);
      await api("/api/v1/admin/products", { method: "POST", body: JSON.stringify(data) }); form.reset(); await loadProducts();
    } catch (error) { showError(error instanceof SyntaxError ? "Характеристики должны быть корректным JSON." : error.message); }
  });

  async function loadCoupons() {
    try {
      const { coupons } = await api("/api/v1/coupons");
      document.querySelector("[data-coupons-table]").innerHTML = coupons.map((coupon) => `<tr><td><strong>${esc(coupon.code)}</strong></td><td>${coupon.type === "PERCENT" ? `${coupon.value}%` : fmt(coupon.value)}</td><td>${fmt(coupon.minSubtotal)}</td><td>${coupon.uses}${coupon.usageLimit ? ` / ${coupon.usageLimit}` : ""}</td><td>${coupon.expiresAt ? new Date(coupon.expiresAt).toLocaleDateString("ru-RU") : "Без срока"}</td><td><input type="checkbox" data-coupon-active="${coupon.id}" ${coupon.active ? "checked" : ""}></td></tr>`).join("") || `<tr><td colspan="6">Промокодов пока нет.</td></tr>`;
    } catch (error) { showError(error.message); }
  }
  document.querySelector("[data-create-coupon]").addEventListener("submit", async (event) => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    data.value = Number(data.value); data.minSubtotal = Number(data.minSubtotal || 0); data.usageLimit = data.usageLimit ? Number(data.usageLimit) : null; data.expiresAt = data.expiresAt ? new Date(data.expiresAt).toISOString() : null; data.active = true;
    try { await api("/api/v1/coupons", { method: "POST", body: JSON.stringify(data) }); event.currentTarget.reset(); await loadCoupons(); }
    catch (error) { showError(error.message); }
  });
  document.querySelector("[data-coupons-table]").addEventListener("change", async (event) => {
    const checkbox = event.target.closest("[data-coupon-active]"); if (!checkbox) return;
    try { await api(`/api/v1/coupons/${checkbox.dataset.couponActive}`, { method: "PATCH", body: JSON.stringify({ active: checkbox.checked }) }); }
    catch (error) { checkbox.checked = !checkbox.checked; showError(error.message); }
  });

  async function loadReviews() {
    try {
      const { reviews } = await api("/api/v1/reviews/admin");
      document.querySelector("[data-review-queue]").innerHTML = reviews.map((review) => `<article><span class="eyebrow">${esc(review.product.name)} · заказ ${esc(review.order.orderNumber)}</span><p>${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)} · ${esc(review.authorName)}</p><p>${esc(review.text)}</p><div class="form-actions"><button class="button button-primary" data-review-status="APPROVED" data-review-id="${review.id}">Опубликовать</button><button class="button button-secondary" data-review-status="REJECTED" data-review-id="${review.id}">Отклонить</button></div></article>`).join("") || `<p class="muted">Нет отзывов, ожидающих проверки.</p>`;
    } catch (error) { showError(error.message); }
  }
  document.querySelector("[data-review-queue]").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-review-status]"); if (!button) return;
    try { await api(`/api/v1/reviews/${button.dataset.reviewId}`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.reviewStatus }) }); await loadReviews(); }
    catch (error) { showError(error.message); }
  });

  api("/api/v1/auth/me").then(({ user }) => showAdmin(user)).catch(() => showAdmin(null));
})();
