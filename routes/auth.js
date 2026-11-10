const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { prisma } = require("../config/database");

const router = express.Router();
const credentialsSchema = z.object({ email: z.email().max(254), password: z.string().min(8).max(100) });

router.get("/me", (req, res) => res.json({ user: req.session.user || null }));

router.post("/register", async (req, res) => {
  const parsed = credentialsSchema.extend({ name: z.string().trim().min(2).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Введите имя, корректный email и пароль от 8 символов." });
  const email = parsed.data.email.toLowerCase();
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    const user = await prisma.user.create({ data: { email, name: parsed.data.name, passwordHash }, select: { id: true, email: true, name: true, role: true } });
    req.session.user = user;
    res.status(201).json({ user });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ error: "Аккаунт с таким email уже существует." });
    throw error;
  }
});

router.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Проверьте email и пароль." });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: "Неверный email или пароль." });
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: "Не удалось создать сессию." });
    req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    res.json({ user: req.session.user });
  });
});

router.post("/logout", (req, res) => req.session.destroy(() => {
  res.clearCookie("zynora.sid", { path: "/" });
  res.json({ ok: true });
}));

module.exports = router;
