const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/database");
const { requireAdmin } = require("../middlewares/auth");

const router = express.Router();

router.post("/", async (req, res) => {
  const parsed = z.object({ productId: z.number().int().positive(), orderItemId: z.number().int().positive(), trackingToken: z.string().min(30).max(100), rating: z.number().int().min(1).max(5), text: z.string().trim().min(10).max(1500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Добавьте оценку и отзыв не короче 10 символов." });
  const { productId, orderItemId, trackingToken, rating, text } = parsed.data;
  const order = await prisma.order.findUnique({ where: { trackingToken }, include: { items: true } });
  if (!order || !["PAID", "PROCESSING", "SHIPPED", "DELIVERED"].includes(order.status)) return res.status(403).json({ error: "Оставить отзыв можно после подтверждения покупки." });
  const item = order.items.find((entry) => entry.id === orderItemId && entry.productId === productId);
  if (!item) return res.status(403).json({ error: "Этот товар не найден в заказе." });
  try {
    const review = await prisma.review.create({ data: { productId, orderId: order.id, orderItemId, userId: req.session.user?.id || null, authorName: order.customerName, rating, text } });
    res.status(201).json({ review, message: "Отзыв отправлен на проверку." });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ error: "Для этого товара в заказе отзыв уже оставлен." });
    throw error;
  }
});

router.get("/admin", requireAdmin, async (_req, res) => {
  res.json({ reviews: await prisma.review.findMany({ where: { status: "PENDING" }, include: { product: true, order: { select: { orderNumber: true } } }, orderBy: { createdAt: "asc" } }) });
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = z.object({ status: z.enum(["APPROVED", "REJECTED"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Укажите статус модерации." });
  try { res.json({ review: await prisma.review.update({ where: { id: Number(req.params.id) }, data: { status: parsed.data.status } }) }); }
  catch (error) { if (error.code === "P2025") return res.status(404).json({ error: "Отзыв не найден." }); throw error; }
});

module.exports = router;
