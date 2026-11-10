const express = require("express");
const { prisma } = require("../config/database");
const { requireAdmin } = require("../middlewares/auth");
const { createOrder, publicOrder, OrderError } = require("../services/orders");
const { sendOrderNotification, updateOrderStatus } = require("../services/telegram");
const { statusSchema } = require("../validators/schemas");

const router = express.Router();

function csvCell(value) {
  const safe = String(value ?? "").replace(/^[\s]*[=+@-]/, (match) => `'${match}`);
  return `"${safe.replace(/"/g, '""')}"`;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

router.post("/", async (req, res) => {
  try {
    const order = await createOrder(req.body, req.session.user?.id || null);
    const claim = await prisma.order.updateMany({ where: { id: order.id, telegramAttempted: false }, data: { telegramAttempted: true } });
    if (claim.count === 1) {
      const orderForNotification = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true, user: { select: { email: true } } } });
      const notified = await sendOrderNotification(orderForNotification);
      await prisma.order.update({ where: { id: order.id }, data: { telegramNotified: notified, telegramNotificationError: notified ? null : "Проверьте доступность Telegram Bot API и настройки бота." } });
    }
    res.status(201).json({ order: publicOrder(order), trackUrl: `/html/order.html?token=${encodeURIComponent(order.trackingToken)}` });
  } catch (error) {
    if (error instanceof OrderError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post("/:id/payment-reported", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Некорректный заказ." });
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true, user: { select: { email: true } } } });
  if (!order) return res.status(404).json({ error: "Заказ не найден." });
  if (order.userId ? order.userId !== req.session.user?.id : req.body?.trackingToken !== order.trackingToken) return res.status(404).json({ error: "Заказ не найден." });
  if (!new Set(["PENDING_PAYMENT", "PAYMENT_REPORTED"]).has(order.status)) return res.status(409).json({ error: "Этот заказ уже не ожидает оплату." });
  if (order.paymentReported) return res.json({ ok: true, paymentReported: true });
  const reportedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const change = await tx.order.updateMany({ where: { id, status: "PENDING_PAYMENT", paymentReported: false }, data: { paymentReported: true, paymentReportedAt: reportedAt, status: "PAYMENT_REPORTED" } });
    if (change.count !== 1) return false;
    await tx.orderStatusHistory.create({ data: { orderId: id, from: "PENDING_PAYMENT", to: "PAYMENT_REPORTED", note: "Покупатель сообщил об оплате" } });
    return true;
  });
  if (!updated) return res.status(409).json({ error: "Заказ уже обновлён. Перезагрузите страницу." });
  const reportedOrder = { ...order, paymentReported: true, paymentReportedAt: reportedAt };
  const notified = await sendOrderNotification(reportedOrder, { paymentReported: true });
  res.json({ ok: true, paymentReported: true, telegramNotified: notified });
});

router.post("/:id/notify", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Некорректный заказ." });
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true, user: { select: { email: true } } } });
  if (!order) return res.status(404).json({ error: "Заказ не найден." });
  const notified = await sendOrderNotification(order);
  await prisma.order.update({ where: { id }, data: { telegramAttempted: true, telegramNotified: notified, telegramNotificationError: notified ? null : "Проверьте доступность Telegram Bot API и настройки бота." } });
  res.status(notified ? 200 : 502).json({ ok: notified, error: notified ? undefined : "Не удалось отправить уведомление. Попробуйте ещё раз позже." });
});

router.get("/track/:token", async (req, res) => {
  const order = await prisma.order.findUnique({ where: { trackingToken: req.params.token }, include: { items: true, statusHistory: { orderBy: { createdAt: "asc" }, select: { to: true, createdAt: true } } } });
  if (!order) return res.status(404).json({ error: "Заказ по этой ссылке не найден." });
  res.json({ order: { ...publicOrder(order), statusHistory: order.statusHistory } });
});

router.get("/mine", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Войдите в аккаунт." });
  const orders = await prisma.order.findMany({ where: { userId: req.session.user.id }, include: { items: true }, orderBy: { createdAt: "desc" } });
  res.json({ orders: orders.map(publicOrder) });
});

router.get("/export.csv", requireAdmin, async (req, res) => {
  const where = {};
  if (req.query.status && ["PENDING_PAYMENT", "PAYMENT_REPORTED", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].includes(req.query.status)) where.status = req.query.status;
  if (req.query.from || req.query.to) {
    const from = req.query.from ? new Date(req.query.from) : undefined;
    const to = req.query.to ? new Date(req.query.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return res.status(400).json({ error: "Некорректный диапазон дат." });
    where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  const orders = await prisma.order.findMany({ where, include: { items: true, user: { select: { email: true } } }, orderBy: { createdAt: "desc" }, take: 5000 });
  const rows = [["Номер", "Дата", "Статус", "Оплата", "Покупатель", "Email", "Телефон", "Город", "Адрес", "Товары", "Сумма"], ...orders.map((order) => [order.orderNumber, order.createdAt.toISOString(), order.status, order.paymentReported ? "Покупатель сообщил" : "Ожидает", order.customerName, order.user?.email || "Гостевой заказ", order.phone, order.city, order.address, order.items.map((item) => `${item.productName} x ${item.quantity} @ ${item.unitPrice}`).join("; "), order.total])];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=zynora-orders.csv");
  res.send(csv);
});

router.get("/:id/invoice", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).send("Некорректный заказ.");
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true, user: { select: { email: true } } } });
  if (!order) return res.status(404).send("Заказ не найден.");
  const lines = order.items.map((item) => `<tr><td>${escapeHtml(item.productName)}</td><td>${item.quantity}</td><td>${item.unitPrice} сом</td><td>${item.quantity * item.unitPrice} сом</td></tr>`).join("");
  res.type("html").send(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Заказ ${escapeHtml(order.orderNumber)}</title><style>body{font:16px system-ui;max-width:800px;margin:40px auto;color:#191a1d}table{width:100%;border-collapse:collapse}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}.total{text-align:right;font-size:22px;margin:24px 0}@media print{button{display:none}}</style><h1>ZYNORA · Заказ ${escapeHtml(order.orderNumber)}</h1><p>${escapeHtml(order.customerName)} · ${escapeHtml(order.phone)}</p><p>${escapeHtml(order.city)}, ${escapeHtml(order.address)}</p><p>${escapeHtml(order.user?.email || "Гостевой заказ")}</p><table><thead><tr><th>Товар</th><th>Кол-во</th><th>Цена</th><th>Итого</th></tr></thead><tbody>${lines}</tbody></table><p class="total">Всего: ${order.total} сом</p><p>Статус: ${escapeHtml(order.status)}</p><button onclick="window.print()">Печать / сохранить PDF</button></html>`);
});

router.get("/", requireAdmin, async (req, res) => {
  const { status, q } = req.query;
  const where = {};
  if (status && ["PENDING_PAYMENT", "PAYMENT_REPORTED", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].includes(status)) where.status = status;
  if (q) where.OR = [{ orderNumber: { contains: String(q), mode: "insensitive" } }, { customerName: { contains: String(q), mode: "insensitive" } }, { phone: { contains: String(q) } }, { user: { email: { contains: String(q), mode: "insensitive" } } }];
  const orders = await prisma.order.findMany({ where, include: { items: true, user: { select: { email: true } }, statusHistory: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ orders });
});

router.patch("/:id/status", requireAdmin, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Неизвестный статус заказа." });
  try {
    const order = await updateOrderStatus(Number(req.params.id), parsed.data.status, `Admin ${req.session.user.email}`);
    res.json({ order });
  } catch (error) {
    return res.status(error.message === "Заказ не найден." ? 404 : 409).json({ error: error.message });
  }
});

module.exports = router;
