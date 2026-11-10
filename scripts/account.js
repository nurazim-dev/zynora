(() => {
  const root = document.querySelector("[data-account-root]");
  if (!root) return;
  const form = root.querySelector("[data-account-form]");
  let mode = "login";
  const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (value) => `${new Intl.NumberFormat("ru-RU").format(value || 0)} сом`;
  const statusLabel = (order) => order.status === "PENDING_PAYMENT" && order.paymentReported ? "Оплата сообщена · на проверке" : ({ PENDING_PAYMENT: "Ожидает оплаты", PAYMENT_REPORTED: "Оплата сообщена · на проверке", PAID: "Оплата подтверждена", PROCESSING: "В обработке", SHIPPED: "В доставке", DELIVERED: "Доставлен", CANCELLED: "Отменён" })[order.status] || order.status;
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос.");
    return data;
  };
  const showTab = (nextMode) => {
    mode = nextMode;
    const isRegister = mode === "register";
    root.querySelector("[data-account-title]").textContent = isRegister ? "Создание аккаунта" : "Вход в аккаунт";
    root.querySelector("[data-account-name-label]").classList.toggle("is-hidden", !isRegister);
    root.querySelector("[data-account-name-label] input").required = isRegister;
    root.querySelector("[data-account-submit]").textContent = isRegister ? "Создать аккаунт" : "Войти";
    root.querySelectorAll("[data-account-tab]").forEach((button) => { button.className = `button ${button.dataset.accountTab === mode ? "button-primary" : "button-secondary"}`; });
  };
  const showUser = async (user) => {
    const returnTo = new URLSearchParams(location.search).get("return");
    if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return location.replace(returnTo);
    form.classList.add("is-hidden"); root.querySelector(".account-tabs").classList.add("is-hidden");
    root.querySelector("[data-account-history]").classList.remove("is-hidden");
    const history = await api("/api/v1/orders/mine");
    root.querySelector("[data-history-list]").innerHTML = history.orders.length ? history.orders.map((order) => `<article class="panel" style="margin:14px 0"><div class="summary-line"><span><strong>#${esc(order.orderNumber)}</strong><br>${esc(statusLabel(order))}</span><strong>${fmt(order.total)}</strong></div><p class="small-help">${order.items.map((item) => `${esc(item.productName)} × ${item.quantity}`).join(" · ")}</p><a class="text-link" href="/html/order-page.html?token=${encodeURIComponent(order.trackingToken)}">Открыть заказ и статус</a></article>`).join("") : `<p class="muted">Покупок пока нет.</p>`;
    root.querySelector("[data-account-history] h2").textContent = `Здравствуйте, ${user.name}`;
  };
  root.querySelectorAll("[data-account-tab]").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.accountTab)));
  root.querySelector("[data-account-logout]").addEventListener("click", async () => { try { await api("/api/v1/auth/logout", { method: "POST", body: "{}" }); location.reload(); } catch (error) { root.querySelector("[data-account-message]").textContent = error.message; } });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const submit = form.querySelector("button[type=submit]"); submit.disabled = true;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await api(`/api/v1/auth/${mode}`, { method: "POST", body: JSON.stringify(data) });
      if (response.user.role === "ADMIN") return location.assign("/admin");
      await showUser(response.user);
    } catch (error) { root.querySelector("[data-account-message]").textContent = error.message; }
    finally { submit.disabled = false; }
  });
  showTab("login");
  api("/api/v1/auth/me").then(({ user }) => user && showUser(user)).catch(() => {});
})();
