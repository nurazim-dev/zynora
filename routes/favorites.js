const express = require("express");
const { prisma } = require("../config/database");
const { requireUser } = require("../middlewares/auth");

const router = express.Router();
router.use(requireUser);

router.get("/", async (req, res) => {
  const favorites = await prisma.favorite.findMany({ where: { userId: req.session.user.id }, include: { product: { include: { category: true } } }, orderBy: { createdAt: "desc" } });
  res.json({ products: favorites.map(({ product }) => product) });
});

router.post("/:productId", async (req, res) => {
  const productId = Number(req.params.productId);
  if (!Number.isInteger(productId) || productId < 1) return res.status(400).json({ error: "Некорректный товар." });
  try {
    await prisma.favorite.create({ data: { userId: req.session.user.id, productId } });
  } catch (error) {
    if (error.code !== "P2002") {
      if (error.code === "P2003") return res.status(404).json({ error: "Товар не найден." });
      throw error;
    }
  }
  res.json({ ok: true });
});

router.delete("/:productId", async (req, res) => {
  await prisma.favorite.deleteMany({ where: { userId: req.session.user.id, productId: Number(req.params.productId) } });
  res.json({ ok: true });
});

module.exports = router;
