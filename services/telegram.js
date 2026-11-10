const { prisma } = require("../config/database");

const STATUS_LABELS = {
  PENDING_PAYMENT: "Ожидает оплаты",
  PAYMENT_REPORTED: "Покупатель сообщил об оплате",
  PAID: "Оплата подтверждена",
  PROCESSING: "В обработке",
  SHIPPED: "Передан курьеру",
  DELIVERED: "Доставлен",
  CANCELLED: "Отменён",
};
const ALLOWED_TRANSITIONS = {
  PENDING_PAYMENT: ["PAYMENT_REPORTED", "PAID", "CANCELLED"],
  PAYMENT_REPORTED: ["PAID", "CANCELLED"],
  PAID: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function orderKeyboard(order) {
  if (!process.env.TELEGRAM_ADMIN_USER_ID && !process.env.TELEGRAM_CHAT_ID) return undefined;
  const actions = { PAID: "✅ Подтвердить оплату", PROCESSING: "📦 В обработке", SHIPPED: "🚚 Передан курьеру", DELIVERED: "✅ Доставлен", CANCELLED: "❌ Отменить заказ" };
  const next = (ALLOWED_TRANSITIONS[order.status] || []).filter((status) => status !== "PAYMENT_REPORTED");
  return { inline_keyboard: next.map((status) => [{ text: actions[status], callback_data: `o:${order.id}:${status}` }]) };
}

async function sendOrderNotification(order, { paymentReported = order.paymentReported } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error("Telegram order notification skipped: bot credentials are not configured.");
    return false;
  }

  const items = order.items.map((item) => `${escapeHtml(item.productName)}\nКоличество: ${item.quantity}\nЦена: ${formatSom(item.unitPrice)} сом`).join("\n\n");
  const text = [
    "🛍 <b>ZYNORA — НОВЫЙ ЗАКАЗ</b>",
    `Заказ №: <b>#${escapeHtml(order.orderNumber)}</b>`,
    "",
    "👤 <b>Покупатель</b>",
    `Имя: ${escapeHtml(order.customerName)}`,
    order.user?.email ? `Аккаунт: ${escapeHtml(order.user.email)}` : "",
    `Телефон: ${escapeHtml(order.phone)}`,
    `Город: ${escapeHtml(order.city)}`,
    `Адрес: ${escapeHtml(order.address)}`,
    order.comment ? `Комментарий: ${escapeHtml(order.comment)}` : "",
    "",
    "📦 <b>Товары</b>",
    items,
    order.discount ? `\nПромокод: −${formatSom(order.discount)} сом` : "",
    `\n💰 <b>ИТОГО: ${formatSom(order.total)} сом</b>`,
    "💳 Способ оплаты: MBank QR",
    `⏳ Статус: ${paymentReported ? "Покупатель сообщил об оплате — проверьте поступление" : STATUS_LABELS[order.status]}`,
    `Дата: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bishkek" }).format(order.createdAt)}`,
  ].filter(Boolean).join("\n");

  const keyboard = orderKeyboard(order);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...(keyboard ? { reply_markup: keyboard } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.description || `HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.error(`Telegram notification failed for order ${order.orderNumber}: ${error.message}`);
    return false;
  }
}

async function applyTelegramStatusCallback(callback) {
  const allowedTelegramId = process.env.TELEGRAM_ADMIN_USER_ID || process.env.TELEGRAM_CHAT_ID;
  if (!allowedTelegramId || String(callback.from?.id) !== String(allowedTelegramId)) return { ok: false, text: "Нет доступа администратора." };
  const match = /^o:(\d+):(PAID|PROCESSING|SHIPPED|DELIVERED|CANCELLED)$/.exec(callback.data || "");
  if (!match) return { ok: false, text: "Неизвестная команда." };
  try {
    const order = await updateOrderStatus(Number(match[1]), match[2], "Telegram admin");
    return { ok: true, text: `Статус заказа обновлён: ${STATUS_LABELS[match[2]]}.`, replyMarkup: orderKeyboard(order) || { inline_keyboard: [] } };
  } catch (error) { return { ok: false, text: error.message }; }
}

async function updateOrderStatus(orderId, status, note = "Администратор") {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new Error("Заказ не найден.");
    if (order.status === status) return order;
    if (!ALLOWED_TRANSITIONS[order.status]?.includes(status)) throw new Error(`Нельзя изменить статус «${STATUS_LABELS[order.status]}» на «${STATUS_LABELS[status]}».`);
    const changed = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status } });
    if (changed.count !== 1) throw new Error("Заказ уже изменён другим менеджером. Обновите список.");
    if (status === "PAID") {
      for (const item of order.items) {
        if (!item.productId) continue;
        const stock = await tx.product.updateMany({ where: { id: item.productId, active: true, stock: { gte: item.quantity }, reservedStock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity }, reservedStock: { decrement: item.quantity } } });
        if (stock.count !== 1) throw new Error(`Нельзя подтвердить оплату: резерв товара «${item.productName}» уже недоступен.`);
        await tx.inventoryMovement.create({ data: { productId: item.productId, orderId: order.id, type: "SALE", quantity: item.quantity, note: `Оплата подтверждена для заказа ${order.orderNumber}` } });
      }
    }
    if (status === "CANCELLED" && ["PENDING_PAYMENT", "PAYMENT_REPORTED"].includes(order.status)) {
      for (const item of order.items) {
        if (!item.productId) continue;
        await tx.product.update({ where: { id: item.productId }, data: { reservedStock: { decrement: item.quantity } } });
        await tx.inventoryMovement.create({ data: { productId: item.productId, orderId: order.id, type: "RELEASE", quantity: item.quantity, note: `Резерв снят при отмене ${order.orderNumber}` } });
      }
    } else if (status === "CANCELLED") {
      for (const item of order.items) {
        if (!item.productId) continue;
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        await tx.inventoryMovement.create({ data: { productId: item.productId, orderId: order.id, type: "RETURN", quantity: item.quantity, note: `Возврат товара по заказу ${order.orderNumber}` } });
      }
    }
    if (status === "CANCELLED" && order.couponId) {
      await tx.coupon.updateMany({ where: { id: order.couponId, uses: { gt: 0 } }, data: { uses: { decrement: 1 } } });
    }
    await tx.orderStatusHistory.create({ data: { orderId: order.id, from: order.status, to: status, note } });
    return { ...order, status };
  });
}

function formatSom(amount) { return new Intl.NumberFormat("ru-RU").format(amount); }

async function telegramRequest(method, payload, timeoutMs = 10000) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram HTTP ${response.status}`);
  return result.result;
}

async function handleTelegramUpdate(update) {
  if (update.callback_query) {
    const callback = update.callback_query;
    const result = await applyTelegramStatusCallback(callback);
    await telegramRequest("answerCallbackQuery", { callback_query_id: callback.id, text: result.text, show_alert: !result.ok });
    if (result.ok && callback.message) {
      await telegramRequest("editMessageReplyMarkup", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, reply_markup: result.replyMarkup }).catch((error) => console.error(`Telegram message update failed: ${error.message}`));
    }
    return;
  }
  const message = update.message;
  if (!message?.text) return;
  const command = message.text.trim().split(/\s+/, 1)[0].split("@")[0].toLowerCase();
  const allowedId = process.env.TELEGRAM_ADMIN_USER_ID || process.env.TELEGRAM_CHAT_ID;
  if (command === "/start" || command === "/help") {
    const userId = message.from?.id;
    const isAdmin = String(userId) === String(allowedId);
    const response = isAdmin
      ? `Панель ZYNORA подключена. Ваш Telegram ID: ${userId}. Команда /orders покажет последние заказы. Кнопки под сообщением заказа меняют статус в базе.`
      : `Ваш Telegram ID: ${userId}. Бот подключён к магазину ZYNORA; доступ к заказам есть только у администратора.`;
    await telegramRequest("sendMessage", { chat_id: message.chat.id, text: response });
    return;
  }
  if (command === "/orders") {
    if (!allowedId || String(message.from?.id) !== String(allowedId)) {
      await telegramRequest("sendMessage", { chat_id: message.chat.id, text: "Команда доступна только администратору." });
      return;
    }
    const orders = await prisma.order.findMany({ take: 10, orderBy: { createdAt: "desc" }, include: { items: true } });
    if (!orders.length) return telegramRequest("sendMessage", { chat_id: message.chat.id, text: "Заказов пока нет." });
    for (const order of orders) {
      const text = `Заказ #${order.orderNumber}\n${order.customerName} · ${order.phone}\n${order.items.map((item) => `${item.productName} × ${item.quantity}`).join("\n")}\nИтого: ${formatSom(order.total)} сом\nСтатус: ${order.paymentReported && order.status === "PENDING_PAYMENT" ? "Оплату сообщили — проверьте" : STATUS_LABELS[order.status]}`;
      await telegramRequest("sendMessage", { chat_id: message.chat.id, text, ...(orderKeyboard(order) ? { reply_markup: orderKeyboard(order) } : {}) });
    }
  }
}

async function startTelegramPolling() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  let offset = 0;
  try {
    const webhook = await telegramRequest("getWebhookInfo", {});
    if (webhook.url) {
      console.log("Telegram webhook is configured; local polling is disabled.");
      return;
    }
  } catch (error) {
    console.error(`Telegram bot startup check failed: ${error.message}`);
    return;
  }
  console.log("Telegram bot polling started.");
  while (true) {
    try {
      const updates = await telegramRequest("getUpdates", { offset, timeout: 20, allowed_updates: ["message", "callback_query"] }, 30000);
      for (const update of updates) {
        try { await handleTelegramUpdate(update); }
        catch (error) { console.error(`Telegram update ${update.update_id} failed: ${error.message}`); }
        offset = update.update_id + 1;
      }
    } catch (error) {
      console.error(`Telegram polling failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

module.exports = { sendOrderNotification, applyTelegramStatusCallback, handleTelegramUpdate, startTelegramPolling, updateOrderStatus, STATUS_LABELS, ALLOWED_TRANSITIONS, formatSom };
