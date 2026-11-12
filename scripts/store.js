(() => {
  const CART_KEY = "zynora-cart-v1";
  const COMPARE_KEY = "zynora-compare-v1";
  const RECENT_KEY = "zynora-recent-v1";
  const CART_URL = "/cart";
  let products = [];

  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const som = (value) => `${new Intl.NumberFormat("ru-RU").format(value || 0)} сом`;
  const createUuid = () => {
    const bytes = new Uint8Array(16);
    try {
      if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
      if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
      else throw new Error("Web Crypto недоступен");
    } catch {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const readCart = () => {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]").filter((item) => Number.isInteger(item.productId) && Number.isInteger(item.quantity)); }
    catch { return []; }
  };
  const readIds = (key) => {
    try { return [...new Set(JSON.parse(localStorage.getItem(key) || "[]").filter((id) => Number.isInteger(id) && id > 0))]; }
    catch { return []; }
  };
  const saveCart = (cart) => { localStorage.setItem(CART_KEY, JSON.stringify(cart)); updateCartCount(); };
  const updateCartCount = () => {
    const count = readCart().reduce((sum, item) => sum + item.quantity, 0);
    document.querySelectorAll("[data-cart-count]").forEach((node) => { node.textContent = count; node.hidden = count === 0; });
  };
  const toast = (message, kind = "info") => {
    let node = document.querySelector("#toast-region");
    if (!node) { node = document.createElement("div"); node.id = "toast-region"; node.className = "toast-region"; node.setAttribute("aria-live", "polite"); document.body.append(node); }
    const item = document.createElement("div"); item.className = `toast toast-${kind}`; item.textContent = message; node.append(item);
    setTimeout(() => item.remove(), 3600);
  };
  const api = async (url, options = {}) => {
    const { signal, ...requestOptions } = options;
    const controller = signal ? null : new AbortController();
    const timeoutId = controller ? setTimeout(() => controller.abort(), 20000) : null;
    try {
      const response = await fetch(url, { credentials: "same-origin", ...requestOptions, signal: signal || controller.signal, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Не удалось выполнить запрос.");
      return result;
    } catch (error) {
      if (controller?.signal.aborted) throw new Error("Сервер долго не отвечает. Проверьте Wi-Fi и повторите попытку. Если заказ уже отправляли, повтор безопасен.");
      if (error instanceof TypeError) throw new Error("Нет связи с сервером. Убедитесь, что Mac и это устройство в одной Wi-Fi сети, а сайт запущен.");
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
  const productById = async (id) => {
    const cached = products.find((product) => product.id === id);
    if (cached) return cached;
    try { return (await api(`/api/v1/products/id/${id}`)).product; } catch { return null; }
  };
  const productsByIds = async (ids) => new Map((await Promise.all([...new Set(ids)].map(productById))).filter(Boolean).map((product) => [product.id, product]));
  const addToCart = (productId) => productById(productId).then((product) => {
    const availableStock = product?.availableStock ?? product?.stock ?? 0;
    if (!product || !product.price || availableStock < 1) throw new Error("Товар пока недоступен для покупки.");
    const cart = readCart();
    const existing = cart.find((item) => item.productId === productId);
    if (existing) {
      if (existing.quantity >= availableStock) throw new Error("Доступный остаток уже в корзине.");
      existing.quantity += 1;
    } else cart.push({ productId, quantity: 1 });
    saveCart(cart);
    toast("Добавлено в корзину", "success");
  });

  async function renderCatalog() {
    const grid = document.querySelector("[data-catalog-grid]");
    if (!grid) return;
    const [categories, brands] = await Promise.all([api("/api/v1/products/categories"), api("/api/v1/products/brands")]);
    const categorySelect = document.querySelector("#filter-category");
    categories.categories.forEach((category) => categorySelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(category.slug)}">${escapeHtml(category.name)}</option>`));
    const brandSelect = document.querySelector("#filter-brand");
    brands.brands.forEach((brand) => brandSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`));

    const controls = ["#catalog-search", "#filter-category", "#filter-brand", "#min-price", "#max-price", "#catalog-sort"].map((selector) => document.querySelector(selector));
    const pagination = document.querySelector("[data-catalog-pagination]");
    let page = 1;
    let requestId = 0;
    const loadPage = async () => {
      const thisRequest = ++requestId;
      const params = new URLSearchParams({ page: String(page), pageSize: "12", sort: document.querySelector("#catalog-sort").value });
      const q = document.querySelector("#catalog-search").value.trim();
      const category = categorySelect.value;
      const brand = brandSelect.value;
      const min = document.querySelector("#min-price").value;
      const max = document.querySelector("#max-price").value;
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      if (brand) params.set("brand", brand);
      if (min) params.set("minPrice", min);
      if (max) params.set("maxPrice", max);
      grid.innerHTML = `<div class="loading-skeleton">Загружаем каталог…</div>`;
      const catalog = await api(`/api/v1/products?${params}`);
      if (thisRequest !== requestId) return;
      products = catalog.products;
      page = catalog.pagination.page;
      const countNode = document.querySelector("[data-catalog-count]");
      if (countNode) countNode.textContent = `Позиции: ${String(catalog.pagination.total).padStart(2, "0")}`;
      grid.innerHTML = products.length ? products.map(productCard).join("") : `<div class="empty-state"><span class="eyebrow">По вашему запросу</span><h2>Ничего не найдено</h2><p>Измените поисковый запрос или сбросьте фильтры.</p><button class="button button-secondary" type="button" data-reset-filters>Сбросить фильтры</button></div>`;
      pagination.innerHTML = catalog.pagination.totalPages > 1 ? `<button class="button button-secondary" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>Назад</button><span>Страница ${page} из ${catalog.pagination.totalPages}</span><button class="button button-secondary" data-page="${page + 1}" ${page === catalog.pagination.totalPages ? "disabled" : ""}>Дальше</button>` : "";
    };
    let debounce;
    controls.forEach((input) => input.addEventListener("input", () => { page = 1; clearTimeout(debounce); debounce = setTimeout(loadPage, 180); }));
    controls.forEach((input) => input.addEventListener("change", () => { page = 1; loadPage(); }));
    pagination.addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (button && !button.disabled) { page = Number(button.dataset.page); loadPage(); } });
    document.addEventListener("click", (event) => { if (event.target.closest("[data-reset-filters]")) { controls.forEach((input) => { input.value = ""; }); page = 1; loadPage(); } });
    await loadPage();
  }

  function productCard(product) {
    const available = product.availableStock ?? product.stock ?? 0;
    const isUnavailable = !product.price || available < 1;
    return `<article class="product-card">
      <a class="product-image" href="/product/${encodeURIComponent(product.slug)}"><img src="${escapeHtml(product.imagePath)}" alt="${escapeHtml(product.name)}" loading="lazy"></a>
      <div class="product-card-body"><div class="product-card-meta"><span>${escapeHtml(product.brand)}</span><span>${product.rating ? `★ ${product.rating.toFixed(1)} · ${product.reviewCount}` : "Новая коллекция"}</span></div>
      <h2><a href="/product/${encodeURIComponent(product.slug)}">${escapeHtml(product.name)}</a></h2>
      <p class="product-card-description">${escapeHtml(product.description)}</p>
      <div class="product-card-bottom"><div><strong class="price">${product.price ? som(product.price) : "Цена уточняется"}</strong><span class="stock-note">${available ? `В наличии · ${available} шт.` : "Нет в наличии"}</span></div>
      <div class="product-card-actions"><button class="icon-button favorite-toggle" type="button" data-favorite="${product.id}" aria-label="В избранное">♡</button><button class="icon-button" type="button" data-compare="${product.id}" aria-label="Сравнить">⇄</button></div></div>
      <button class="button button-primary product-add" data-add-product="${product.id}" type="button" ${isUnavailable ? "disabled" : ""}>${isUnavailable ? "Скоро в продаже" : "В корзину"}</button></div></article>`;
  }

  async function renderProductDetail() {
    const root = document.querySelector("[data-product-detail]");
    if (!root) return;
    const slug = root.dataset.productDetail || decodeURIComponent(location.pathname.split("/").pop());
    const { product, related } = await api(`/api/v1/products/${encodeURIComponent(slug)}`);
    const recentlyViewed = [product.id, ...readIds(RECENT_KEY).filter((id) => id !== product.id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentlyViewed));
    document.title = `${product.name} — ZYNORA`;
    const image = root.querySelector("[data-detail-image]");
    image.src = product.imagePath; image.alt = product.name;
    root.querySelector("[data-detail-title]").textContent = product.name;
    const brand = root.querySelector("[data-detail-brand]"); if (brand) brand.textContent = `${product.brand} · ${product.category?.name || ""}`;
    root.querySelector("[data-detail-description]").textContent = product.description;
    root.querySelector("[data-detail-price]").textContent = product.price ? som(product.price) : "Цена уточняется";
    const available = product.availableStock ?? product.stock ?? 0;
    root.querySelector("[data-detail-stock]").textContent = available ? `В наличии · ${available} шт.` : "Нет в наличии";
    const add = root.querySelector("[data-detail-add]"); add.dataset.addProduct = product.id; add.disabled = !product.price || !available;
    const specList = root.querySelector("[data-detail-specs]");
    specList.innerHTML = Object.entries(product.specifications || {}).map(([key, value]) => `<div class="spec-row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
    const fav = root.querySelector("[data-detail-favorite]"); fav.dataset.favorite = product.id;
    const compare = root.querySelector("[data-detail-compare]"); if (compare) compare.dataset.compare = product.id;
    root.querySelector("[data-detail-rating]").textContent = product.rating ? `★ ${product.rating.toFixed(1)} · ${product.reviewCount} отзывов` : "Пока без отзывов";
    const canonicalUrl = `${location.origin}/product/${encodeURIComponent(product.slug)}`;
    let canonical = document.querySelector('link[rel="canonical"]'); if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.append(canonical); } canonical.href = canonicalUrl;
    const structuredData = { "@context": "https://schema.org", "@type": "Product", name: product.name, description: product.description, image: new URL(product.imagePath, location.origin).href, sku: String(product.id), brand: { "@type": "Brand", name: product.brand }, offers: { "@type": "Offer", url: canonicalUrl, priceCurrency: "KGS", ...(product.price ? { price: product.price } : {}), availability: available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } };
    let jsonLd = document.querySelector('script[type="application/ld+json"]'); if (!jsonLd) { jsonLd = document.createElement("script"); jsonLd.type = "application/ld+json"; document.head.append(jsonLd); } jsonLd.textContent = JSON.stringify(structuredData);
    root.querySelector("[data-related]").innerHTML = related.map(productCard).join("");
    const reviews = root.querySelector("[data-product-reviews]");
    const reviewItems = product.reviews || [];
    reviews.innerHTML = reviewItems.length ? reviewItems.map((review) => `<article class="review-card"><div class="review-rating">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</div><strong>${escapeHtml(review.authorName)}</strong><p>${escapeHtml(review.text)}</p></article>`).join("") : `<p class="muted">Отзывы появятся после подтверждённых покупок.</p>`;
  }

  async function renderCart() {
    const root = document.querySelector("[data-cart-page]");
    if (!root) return;
    const list = root.querySelector("[data-cart-items]");
    const byId = await productsByIds(readCart().map((item) => item.productId));
    const render = () => {
      const cart = readCart();
      const valid = cart.filter((item) => byId.has(item.productId));
      if (valid.length !== cart.length) saveCart(valid);
      const subtotal = valid.reduce((sum, item) => sum + (byId.get(item.productId).price || 0) * item.quantity, 0);
      list.innerHTML = valid.length ? valid.map((item) => {
        const product = byId.get(item.productId);
        const available = product.availableStock ?? product.stock ?? 0;
        return `<article class="cart-item"><img src="${escapeHtml(product.imagePath)}" alt=""><div class="cart-item-main"><a href="/html/${escapeHtml(product.slug.replace("macbook-air-", "mac-"))}.html">${escapeHtml(product.name)}</a><span>${product.price ? som(product.price) : "Цена уточняется"}</span><span class="stock-note">Доступно: ${available}</span></div><div class="quantity-control"><button type="button" data-qty="-1" data-id="${product.id}" aria-label="Уменьшить">−</button><span>${item.quantity}</span><button type="button" data-qty="1" data-id="${product.id}" aria-label="Увеличить" ${item.quantity >= available ? "disabled" : ""}>+</button></div><strong>${som((product.price || 0) * item.quantity)}</strong><button class="text-button" type="button" data-remove="${product.id}">Удалить</button></article>`;
      }).join("") : `<div class="empty-state"><span class="eyebrow">Корзина</span><h2>Пока здесь пусто</h2><p>Выберите технику из каталога и добавьте её сюда.</p><a class="button button-primary" href="/html/catalog-page.html">Перейти в каталог</a></div>`;
      root.querySelector("[data-cart-subtotal]").textContent = som(subtotal);
      root.querySelector("[data-cart-checkout]").classList.toggle("is-hidden", !valid.length || valid.some((item) => !byId.get(item.productId).price || item.quantity > (byId.get(item.productId).availableStock ?? byId.get(item.productId).stock)));
      root.querySelector("[data-cart-warning]").classList.toggle("is-hidden", !valid.some((item) => !byId.get(item.productId).price || item.quantity > (byId.get(item.productId).availableStock ?? byId.get(item.productId).stock)));
    };
    root.addEventListener("click", (event) => {
      const qty = event.target.closest("[data-qty]");
      const remove = event.target.closest("[data-remove]");
      const cart = readCart();
      if (qty) {
        const item = cart.find((entry) => entry.productId === Number(qty.dataset.id));
        if (item) item.quantity += Number(qty.dataset.qty);
        saveCart(cart.filter((entry) => entry.quantity > 0)); render();
      }
      if (remove) { saveCart(cart.filter((entry) => entry.productId !== Number(remove.dataset.remove))); render(); }
    });
    render();
  }

  async function renderCheckout() {
    const form = document.querySelector("[data-checkout-form]");
    if (!form) return;
    const { user } = await api("/api/v1/auth/me");
    const customerName = form.querySelector('[name="customerName"]');
    if (user && customerName && !customerName.value) customerName.value = user.name || "";
    const byId = await productsByIds(readCart().map((item) => item.productId));
    const summary = document.querySelector("[data-checkout-items]");
    const rows = () => readCart().map((item) => ({ ...item, product: byId.get(item.productId) })).filter((item) => item.product);
    const subtotal = () => rows().reduce((sum, item) => sum + (item.product.price || 0) * item.quantity, 0);
    const render = (discount = 0) => {
      const current = rows();
      summary.innerHTML = current.map((item) => `<div class="summary-line"><span>${escapeHtml(item.product.name)} × ${item.quantity}</span><strong>${som((item.product.price || 0) * item.quantity)}</strong></div>`).join("");
      document.querySelector("[data-checkout-subtotal]").textContent = som(subtotal());
      document.querySelector("[data-checkout-discount]").textContent = `−${som(discount)}`;
      document.querySelector("[data-checkout-total]").textContent = som(Math.max(0, subtotal() - discount));
      return current;
    };
    render();
    const couponButton = document.querySelector("[data-check-coupon]");
    couponButton.addEventListener("click", async () => {
      const code = document.querySelector("#coupon-code").value.trim();
      try {
        const result = await api("/api/v1/coupons/validate", { method: "POST", body: JSON.stringify({ code, items: rows().map(({ productId, quantity }) => ({ productId, quantity })) }) });
        form.dataset.coupon = result.code; form.dataset.discount = String(result.discount); render(result.discount); toast(`Скидка применена: ${som(result.discount)}`, "success");
      } catch (error) { form.dataset.coupon = ""; form.dataset.discount = "0"; render(); toast(error.message, "error"); }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const current = render(Number(form.dataset.discount || 0));
      if (!current.length) return toast("Добавьте товары в корзину.", "error");
      const submit = form.querySelector("button[type=submit]"); submit.disabled = true; submit.textContent = "Создаём заказ…";
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        data.items = current.map(({ productId, quantity }) => ({ productId, quantity }));
        data.idempotencyKey = form.dataset.idempotencyKey || (form.dataset.idempotencyKey = createUuid());
        data.couponCode = form.dataset.coupon || "";
        const result = await api("/api/v1/orders", { method: "POST", body: JSON.stringify(data) });
        delete form.dataset.idempotencyKey;
        saveCart([]); location.assign(result.trackUrl);
      } catch (error) { toast(error.message, "error"); submit.disabled = false; submit.textContent = "Подтвердить заказ"; }
    });
  }

  async function renderOrder() {
    const root = document.querySelector("[data-order-page]");
    if (!root) return;
    const token = new URLSearchParams(location.search).get("token");
    if (!token) { root.innerHTML = `<div class="empty-state"><h1>Не найдена ссылка заказа</h1><p>Откройте персональную ссылку из сообщения после оформления.</p></div>`; return; }
    const { order } = await api(`/api/v1/orders/track/${encodeURIComponent(token)}`);
    root.querySelectorAll("[data-order-number]").forEach((node) => { node.textContent = `#${order.orderNumber}`; });
    root.querySelector("[data-order-status]").textContent = statusLabel(order.status);
    root.querySelector("[data-order-total]").textContent = som(order.total);
    root.querySelector("[data-order-date]").textContent = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(new Date(order.createdAt));
    root.querySelector("[data-order-items]").innerHTML = order.items.map((item) => `<div class="summary-line"><span>${escapeHtml(item.productName)} × ${item.quantity}</span><strong>${som(item.unitPrice * item.quantity)}</strong></div>`).join("");
    const storefrontConfig = await api("/api/v1/storefront/config");
    root.querySelector("[data-payment-qr]").src = storefrontConfig.mbankQrImagePath;
    root.querySelector("[data-manual-payment-notice]").hidden = order.status !== "PENDING_PAYMENT";
    const reportPayment = root.querySelector("[data-report-payment]");
    if (reportPayment) {
      reportPayment.hidden = !["PENDING_PAYMENT", "PAYMENT_REPORTED"].includes(order.status) || order.paymentReported;
      reportPayment.addEventListener("click", async () => {
        reportPayment.disabled = true;
        try {
          await api(`/api/v1/orders/${order.id}/payment-reported`, { method: "POST", body: JSON.stringify({ trackingToken: token }) });
          reportPayment.hidden = true;
          root.querySelector("[data-payment-reported-note]").hidden = false;
          root.querySelector("[data-order-status]").textContent = statusLabel("PAYMENT_REPORTED");
        } catch (error) { toast(error.message, "error"); reportPayment.disabled = false; }
      });
    }
    root.querySelector("[data-payment-reported-note]").hidden = !order.paymentReported;
    const timeline = root.querySelector("[data-status-history]");
    timeline.innerHTML = order.statusHistory.map((entry) => `<li><strong>${statusLabel(entry.to)}</strong><time>${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt))}</time></li>`).join("");
    const reviewRoot = root.querySelector("[data-review-forms]");
    if (["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(order.status)) {
      reviewRoot.innerHTML = order.items.filter((item) => item.productId).map((item) => `<form class="review-form" data-review-form><h3>Отзыв: ${escapeHtml(item.productName)}</h3><input type="hidden" name="productId" value="${item.productId}"><input type="hidden" name="orderItemId" value="${item.id}"><label>Оценка <select name="rating" required><option value="5">5 — Отлично</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1 — Плохо</option></select></label><label>Отзыв <textarea name="text" minlength="10" maxlength="1500" required></textarea></label><button class="button button-secondary">Отправить отзыв</button></form>`).join("");
      reviewRoot.querySelectorAll("[data-review-form]").forEach((form) => form.addEventListener("submit", async (event) => {
        event.preventDefault(); const data = Object.fromEntries(new FormData(form).entries());
        data.productId = Number(data.productId); data.orderItemId = Number(data.orderItemId); data.rating = Number(data.rating); data.trackingToken = token;
        try { await api("/api/v1/reviews", { method: "POST", body: JSON.stringify(data) }); form.innerHTML = `<p class="success-note">Спасибо! Отзыв отправлен на модерацию.</p>`; }
        catch (error) { toast(error.message, "error"); }
      }));
    }
  }

  async function renderFavorites() {
    const root = document.querySelector("[data-favorites-grid]"); if (!root) return;
    try {
      const { products: favoriteProducts } = await api("/api/v1/favorites");
      root.innerHTML = favoriteProducts.length ? favoriteProducts.map(productCard).join("") : `<div class="empty-state"><h2>В избранном пока пусто</h2><p>Сохраняйте товары, чтобы вернуться к ним позже.</p><a class="button button-primary" href="/html/catalog-page.html">Открыть каталог</a></div>`;
    } catch (error) { root.innerHTML = `<div class="empty-state"><h2>Войдите, чтобы видеть избранное</h2><p>${escapeHtml(error.message)}</p><a class="button button-primary" href="/html/account-page.html">Войти или создать аккаунт</a></div>`; }
  }

  async function renderCompare() {
    const root = document.querySelector("[data-compare-root]");
    if (!root) return;
    const ids = readIds(COMPARE_KEY).slice(0, 4);
    const items = await productsByIds(ids);
    const selected = ids.map((id) => items.get(id)).filter(Boolean);
    if (selected.length < ids.length) localStorage.setItem(COMPARE_KEY, JSON.stringify(selected.map((product) => product.id)));
    if (!selected.length) { root.innerHTML = `<div class="empty-state"><h2>Список сравнения пуст</h2><p>Добавьте товары к сравнению из каталога.</p><a class="button button-primary" href="/html/catalog-page.html">Открыть каталог</a></div>`; return; }
    const rows = [
      ["Цена", (product) => product.price ? som(product.price) : "Цена уточняется"],
      ["Доступно", (product) => String(product.availableStock ?? product.stock ?? 0)],
      ...[...new Set(selected.flatMap((product) => Object.keys(product.specifications || {})))].map((key) => [key, (product) => product.specifications?.[key] || "—"]),
    ];
    root.innerHTML = `<div class="compare-table-wrap"><table class="compare-table"><thead><tr><th>Характеристика</th>${selected.map((product) => `<th><img src="${escapeHtml(product.imagePath)}" alt=""><a href="/product/${encodeURIComponent(product.slug)}">${escapeHtml(product.name)}</a><button class="text-button" type="button" data-remove-compare="${product.id}">Убрать</button></th>`).join("")}</tr></thead><tbody>${rows.map(([name, value]) => `<tr><th>${escapeHtml(name)}</th>${selected.map((product) => `<td>${escapeHtml(value(product))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  async function renderRecentlyViewed() {
    const root = document.querySelector("[data-recently-viewed]");
    if (!root) return;
    const productsById = await productsByIds(readIds(RECENT_KEY).slice(0, 4));
    const items = readIds(RECENT_KEY).slice(0, 4).map((id) => productsById.get(id)).filter(Boolean);
    root.innerHTML = items.length ? items.map(productCard).join("") : `<p class="muted">Просмотренные товары появятся здесь.</p>`;
  }

  function statusLabel(status) {
    return ({ PENDING_PAYMENT: "Ожидает оплаты", PAYMENT_REPORTED: "Оплата сообщена · на проверке", PAID: "Оплата подтверждена", PROCESSING: "В обработке", SHIPPED: "Передан курьеру", DELIVERED: "Доставлен", CANCELLED: "Отменён" })[status] || status;
  }

  document.addEventListener("click", async (event) => {
    const add = event.target.closest("[data-add-product]");
    if (add) { try { await addToCart(Number(add.dataset.addProduct)); } catch (error) { toast(error.message, "error"); } }
    const compare = event.target.closest("[data-compare]");
    if (compare) {
      const id = Number(compare.dataset.compare);
      let ids = readIds(COMPARE_KEY);
      if (ids.includes(id)) ids = ids.filter((entry) => entry !== id);
      else if (ids.length >= 4) { toast("Можно сравнить до 4 товаров.", "error"); return; }
      else ids.push(id);
      localStorage.setItem(COMPARE_KEY, JSON.stringify(ids));
      compare.classList.toggle("is-selected", ids.includes(id));
      toast(ids.includes(id) ? "Добавлено к сравнению" : "Убрано из сравнения", "success");
    }
    const removeCompare = event.target.closest("[data-remove-compare]");
    if (removeCompare) {
      localStorage.setItem(COMPARE_KEY, JSON.stringify(readIds(COMPARE_KEY).filter((id) => id !== Number(removeCompare.dataset.removeCompare))));
      renderCompare().catch((error) => toast(error.message, "error"));
    }
    const favorite = event.target.closest("[data-favorite]");
    if (favorite) {
      try {
        if (favorite.closest("[data-favorites-grid]")) {
          await api(`/api/v1/favorites/${favorite.dataset.favorite}`, { method: "DELETE" });
          await renderFavorites();
          toast("Удалено из избранного", "success");
        } else {
          await api(`/api/v1/favorites/${favorite.dataset.favorite}`, { method: "POST", body: "{}" });
          favorite.classList.add("is-favorite"); favorite.textContent = "♥"; toast("Сохранено в избранном", "success");
        }
      } catch (error) {
        if (error.message.includes("Войдите")) location.assign("/html/account-page.html"); else toast(error.message, "error");
      }
    }
  });

  updateCartCount();
  for (const task of [renderCatalog, renderProductDetail, renderCart, renderCheckout, renderOrder, renderFavorites, renderCompare, renderRecentlyViewed]) {
    task().catch((error) => { const target = document.querySelector("[data-catalog-grid], [data-product-detail], [data-cart-page], [data-checkout-form], [data-order-page], [data-favorites-grid]"); if (target) target.insertAdjacentHTML("afterbegin", `<div class="error-panel">${escapeHtml(error.message)}</div>`); });
  }
})();
