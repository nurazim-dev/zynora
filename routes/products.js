const express = require("express");
const { prisma } = require("../config/database");
const { requireAdmin } = require("../middlewares/auth");
const { productSchema } = require("../validators/schemas");

const router = express.Router();

router.get("/", async (req, res) => {
  const { q = "", category, brand, minPrice, maxPrice, sort = "newest" } = req.query;
  const minimum = minPrice === undefined || minPrice === "" ? undefined : Number(minPrice);
  const maximum = maxPrice === undefined || maxPrice === "" ? undefined : Number(maxPrice);
  if ((minimum !== undefined && (!Number.isFinite(minimum) || minimum < 0)) || (maximum !== undefined && (!Number.isFinite(maximum) || maximum < 0))) return res.status(400).json({ error: "Некорректный диапазон цены." });
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(48, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 12));
  const where = { active: true };
  if (category) where.category = { slug: String(category) };
  if (brand) where.brand = { equals: String(brand), mode: "insensitive" };
  if (minimum !== undefined || maximum !== undefined) where.price = { ...(minimum !== undefined ? { gte: minimum } : {}), ...(maximum !== undefined ? { lte: maximum } : {}) };
  if (q) where.OR = ["name", "brand", "description", "category.name"].map((field) => field === "category.name" ? { category: { name: { contains: String(q), mode: "insensitive" } } } : { [field]: { contains: String(q), mode: "insensitive" } });
  const orderBy = sort === "price-asc" ? { price: "asc" } : sort === "price-desc" ? { price: "desc" } : { createdAt: "desc" };
  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, include: { category: true, reviews: { where: { status: "APPROVED" }, select: { rating: true } } }, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.product.count({ where }),
  ]);
  res.json({ products: products.map(withRating), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

router.get("/categories", async (_req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  res.json({ categories });
});

router.get("/brands", async (_req, res) => {
  const brands = await prisma.product.findMany({ where: { active: true }, distinct: ["brand"], select: { brand: true }, orderBy: { brand: "asc" } });
  res.json({ brands: brands.map((item) => item.brand) });
});

router.get("/id/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Некорректный товар." });
  const product = await prisma.product.findFirst({ where: { id, active: true }, include: { category: true } });
  if (!product) return res.status(404).json({ error: "Товар не найден." });
  res.json({ product: withRating(product) });
});

router.get("/:slug", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { slug: req.params.slug }, include: { category: true, reviews: { where: { status: "APPROVED" }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" } } } });
  if (!product || !product.active) return res.status(404).json({ error: "Товар не найден." });
  const related = await prisma.product.findMany({ where: { active: true, id: { not: product.id }, OR: [{ categoryId: product.categoryId }, { brand: product.brand }] }, take: 4, orderBy: { createdAt: "desc" }, include: { category: true } });
  res.json({ product: withRating(product, true), related });
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Проверьте цену и остаток." });
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Некорректный товар." });
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id } });
      if (!current) return null;
      if (parsed.data.stock !== undefined && parsed.data.stock < current.reservedStock) throw Object.assign(new Error(`Нельзя установить остаток ниже резерва (${current.reservedStock} шт.).`), { status: 409 });
      const updated = await tx.product.update({ where: { id }, data: parsed.data });
      if (parsed.data.stock !== undefined && parsed.data.stock !== current.stock) {
        const delta = parsed.data.stock - current.stock;
        await tx.inventoryMovement.create({ data: { productId: id, type: delta > 0 ? "RECEIPT" : "ADJUSTMENT", quantity: Math.abs(delta), note: `Изменение остатка администратором (${delta > 0 ? "+" : ""}${delta})` } });
      }
      return updated;
    });
    if (!product) return res.status(404).json({ error: "Товар не найден." });
    res.json({ product });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ error: error.message });
    if (error.code === "P2025") return res.status(404).json({ error: "Товар не найден." });
    throw error;
  }
});

function withRating(product, includeReviews = false) {
  const ratings = product.reviews || [];
  const { reviews, ...rest } = product;
  return { ...rest, availableStock: Math.max(0, product.stock - (product.reservedStock || 0)), ...(includeReviews ? { reviews } : {}), rating: ratings.length ? ratings.reduce((sum, row) => sum + row.rating, 0) / ratings.length : null, reviewCount: ratings.length };
}

module.exports = router;
