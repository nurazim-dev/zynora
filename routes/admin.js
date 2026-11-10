const express = require("express");
const { prisma } = require("../config/database");
const { requireAdmin } = require("../middlewares/auth");
const { formatSom } = require("../services/telegram");
const { saveProductImage } = require("../services/storage");

const router = express.Router();
router.use(requireAdmin);

router.get("/dashboard", async (_req, res) => {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart); weekStart.setDate(dayStart.getDate() - 6);
  const monthStart = new Date(dayStart); monthStart.setDate(1);
  const revenueStatuses = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"];
  const [counts, allPaid, day, week, month, recentOrders, lowStock, soldItems] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.aggregate({ where: { status: { in: revenueStatuses } }, _sum: { total: true }, _count: { _all: true }, _avg: { total: true } }),
    prisma.order.aggregate({ where: { status: { in: revenueStatuses }, createdAt: { gte: dayStart } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { status: { in: revenueStatuses }, createdAt: { gte: weekStart } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { status: { in: revenueStatuses }, createdAt: { gte: monthStart } }, _sum: { total: true } }),
    prisma.order.findMany({ take: 8, orderBy: { createdAt: "desc" }, include: { items: true } }),
    prisma.product.findMany({ where: { active: true }, include: { category: true }, orderBy: { stock: "asc" }, take: 200 }),
    prisma.orderItem.findMany({ where: { order: { status: { in: revenueStatuses } } }, include: { product: { include: { category: true } } } }),
  ]);

  const countByStatus = Object.fromEntries(counts.map((row) => [row.status, row._count._all]));
  const lowStockProducts = lowStock.filter((product) => product.stock - product.reservedStock <= product.lowStockThreshold).slice(0, 12).map((product) => ({ ...product, availableStock: Math.max(0, product.stock - product.reservedStock) }));
  const topProducts = new Map();
  const popularCategories = new Map();
  for (const item of soldItems) {
    const product = item.product;
    const productKey = product?.id || item.productSlug;
    const current = topProducts.get(productKey) || { name: item.productName, quantity: 0, revenue: 0 };
    current.quantity += item.quantity;
    current.revenue += item.unitPrice * item.quantity;
    topProducts.set(productKey, current);
    if (product?.category) popularCategories.set(product.category.name, (popularCategories.get(product.category.name) || 0) + item.quantity);
  }

  res.json({
    counts: { total: Object.values(countByStatus).reduce((sum, n) => sum + n, 0), paid: revenueStatuses.reduce((sum, status) => sum + (countByStatus[status] || 0), 0), pending: (countByStatus.PENDING_PAYMENT || 0) + (countByStatus.PAYMENT_REPORTED || 0), ...countByStatus },
    revenue: { allTime: allPaid._sum.total || 0, day: day._sum.total || 0, week: week._sum.total || 0, month: month._sum.total || 0, averageOrder: Math.round(allPaid._avg.total || 0), paidOrderCount: allPaid._count._all },
    recentOrders,
    lowStock: lowStockProducts,
    topProducts: [...topProducts.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
    popularCategories: [...popularCategories.entries()].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity),
    formatSom,
  });
});

router.get("/products", async (_req, res) => {
  const products = await prisma.product.findMany({ include: { category: true }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  res.json({ products: products.map((product) => ({ ...product, availableStock: Math.max(0, product.stock - product.reservedStock) })) });
});

router.get("/products/:id/inventory", async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId < 1) return res.status(400).json({ error: "Некорректный товар." });
  const [product, movements] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, stock: true, reservedStock: true, lowStockThreshold: true } }),
    prisma.inventoryMovement.findMany({ where: { productId }, include: { order: { select: { orderNumber: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  if (!product) return res.status(404).json({ error: "Товар не найден." });
  res.json({ product: { ...product, availableStock: Math.max(0, product.stock - product.reservedStock) }, movements });
});

router.post("/product-image", express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }), async (req, res) => {
  const mime = req.get("content-type")?.split(";")[0].trim().toLowerCase();
  const imagePath = await saveProductImage(req.body, mime);
  res.status(201).json({ imagePath });
});

router.post("/products", async (req, res) => {
  const { z } = require("zod");
  const parsed = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string().trim().min(2).max(150), brand: z.string().trim().min(1).max(100), categoryId: z.number().int().positive(), description: z.string().trim().min(1).max(5000), imagePath: z.string().startsWith("/"), specifications: z.record(z.string(), z.string()), price: z.number().int().positive().nullable(), stock: z.number().int().min(0), active: z.boolean().default(true) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Проверьте поля товара." });
  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: parsed.data });
      if (created.stock > 0) await tx.inventoryMovement.create({ data: { productId: created.id, type: "RECEIPT", quantity: created.stock, note: "Начальный остаток при создании товара" } });
      return created;
    });
    res.status(201).json({ product });
  }
  catch (error) { if (error.code === "P2002") return res.status(409).json({ error: "Такой URL товара уже занят." }); throw error; }
});

module.exports = router;
