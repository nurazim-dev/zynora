const express = require("express");
const { z } = require("zod");
const { prisma } = require("../config/database");
const { requireAdmin } = require("../middlewares/auth");

const router = express.Router();
const couponSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.number().int().positive(),
  minSubtotal: z.number().int().min(0).default(0),
  expiresAt: z.string().datetime().nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
}).refine((coupon) => coupon.type !== "PERCENT" || coupon.value <= 100, { message: "Процент скидки не может быть выше 100." });

router.post("/validate", async (req, res) => {
  const parsed = z.object({ code: z.string().trim().min(1), items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(20) })).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Проверьте промокод и корзину." });
  const products = await prisma.product.findMany({ where: { id: { in: parsed.data.items.map((item) => item.productId) }, active: true } });
  const productById = new Map(products.map((product) => [product.id, product]));
  const subtotal = parsed.data.items.reduce((sum, item) => sum + (productById.get(item.productId)?.price || 0) * item.quantity, 0);
  const coupon = await prisma.coupon.findUnique({ where: { code: parsed.data.code.toUpperCase() } });
  if (!coupon || !coupon.active || (coupon.expiresAt && coupon.expiresAt < new Date()) || (coupon.usageLimit !== null && coupon.uses >= coupon.usageLimit)) return res.status(400).json({ error: "Промокод недействителен." });
  if (subtotal < coupon.minSubtotal) return res.status(400).json({ error: `Минимальная сумма заказа — ${coupon.minSubtotal} сом.` });
  const discount = coupon.type === "PERCENT" ? Math.floor(subtotal * coupon.value / 100) : Math.min(subtotal, coupon.value);
  res.json({ code: coupon.code, discount, total: subtotal - discount });
});

router.get("/", requireAdmin, async (_req, res) => res.json({ coupons: await prisma.coupon.findMany({ orderBy: { createdAt: "desc" } }) }));

router.post("/", requireAdmin, async (req, res) => {
  const parsed = couponSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Проверьте промокод." });
  try {
    const coupon = await prisma.coupon.create({ data: { ...parsed.data, code: parsed.data.code.toUpperCase(), expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null } });
    res.status(201).json({ coupon });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ error: "Такой промокод уже существует." });
    throw error;
  }
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = couponSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Проверьте поля промокода." });
  const data = { ...parsed.data };
  if (data.code) data.code = data.code.toUpperCase();
  if (typeof data.expiresAt === "string") data.expiresAt = new Date(data.expiresAt);
  try { res.json({ coupon: await prisma.coupon.update({ where: { id: Number(req.params.id) }, data }) }); }
  catch (error) { if (error.code === "P2025") return res.status(404).json({ error: "Промокод не найден." }); throw error; }
});

module.exports = router;
