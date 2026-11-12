require("dotenv").config();

const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { prisma } = require("./config/database");
const { handleTelegramUpdate, startTelegramPolling } = require("./services/telegram");

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production";
const PgSession = connectPgSimple;

if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("В production задайте SESSION_SECRET длиной не менее 32 символов.");
}

app.disable("x-powered-by");
const proxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || "1", 10);
app.set("trust proxy", isProduction ? Math.max(1, Number.isInteger(proxyHops) ? proxyHops : 1) : false);
const safeLogPath = (requestPath) => requestPath.replace(/(\/orders\/track\/)[^/]+/g, "$1[redacted]");
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  const started = Date.now();
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.on("finish", () => console.log(JSON.stringify({ level: "info", requestId: req.requestId, method: req.method, path: safeLogPath(req.path), status: res.statusCode, durationMs: Date.now() - started })));
  next();
});
app.use(express.json({ limit: "32kb" }));

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined }) : null;
if (!pool) console.warn("DATABASE_URL is missing. Database-backed features are unavailable until PostgreSQL is configured.");

const sessionOptions = {
  name: "zynora.sid",
  secret: process.env.SESSION_SECRET || require("node:crypto").randomBytes(48).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 14 },
};
if (pool) sessionOptions.store = new PgSession({ pool, createTableIfMissing: true, tableName: "zynora_sessions" });
app.use(session(sessionOptions));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Слишком много запросов. Повторите позже." } });
const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Слишком много попыток оформить заказ. Повторите позже." } });
const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Слишком много сообщений. Попробуйте позже." } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Слишком много попыток входа. Попробуйте позже." } });
app.use("/api", apiLimiter);
app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || /\/telegram\/webhook\/?$/.test(req.path)) return next();
  if (req.get("sec-fetch-site") === "cross-site") return res.status(403).json({ error: "Запрос отклонён." });
  const origin = req.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Запрос отклонён." }); }
    catch { return res.status(403).json({ error: "Запрос отклонён." }); }
  }
  next();
});

const apiRouters = {
  auth: (req, res, next) => ["POST"].includes(req.method) ? authLimiter(req, res, next) : next(),
  products: require("./routes/products"),
  orders: (req, res, next) => req.method === "POST" ? orderLimiter(req, res, next) : next(),
  favorites: require("./routes/favorites"),
  coupons: require("./routes/coupons"),
  reviews: require("./routes/reviews"),
  admin: require("./routes/admin"),
};
for (const prefix of ["/api/v1", "/api"]) {
  app.use(`${prefix}/auth`, apiRouters.auth, require("./routes/auth"));
  app.use(`${prefix}/products`, apiRouters.products);
  app.use(`${prefix}/orders`, apiRouters.orders, require("./routes/orders"));
  app.use(`${prefix}/favorites`, apiRouters.favorites);
  app.use(`${prefix}/coupons`, apiRouters.coupons);
  app.use(`${prefix}/reviews`, apiRouters.reviews);
  app.use(`${prefix}/admin`, apiRouters.admin);
}

app.get(["/api/storefront/config", "/api/v1/storefront/config"], (_req, res) => {
  const configuredPath = process.env.MBANK_QR_IMAGE_PATH || "/image/mbank-qr.jpg";
  const safePath = /^\/(image|public)\/(?!.*\.\.\/)[A-Za-z0-9_./-]+\.(png|jpe?g|webp)$/i.test(configuredPath) ? configuredPath : "/image/mbank-qr.jpg";
  res.json({ mbankQrImagePath: safePath });
});

app.post(["/api/contact", "/api/v1/contact"], contactLimiter, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(100), email: z.email().max(254), subject: z.string().trim().min(2).max(150), message: z.string().trim().min(2).max(3000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Проверьте поля формы." });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(503).json({ error: "Отправка пока не настроена. Попробуйте позже." });
  const { name, email, subject, message } = parsed.data;
  const text = `📩 Новое сообщение с сайта ZYNORA\n\n👤 Имя: ${name}\n✉️ Email: ${email}\n📝 Тема: ${subject}\n\nСообщение:\n${message}`;
  try {
    const telegram = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(10000) });
    const result = await telegram.json();
    if (!telegram.ok || !result.ok) throw new Error(result.description || String(telegram.status));
    res.json({ ok: true });
  } catch (error) {
    console.error(`Contact Telegram notification failed: ${error.message}`);
    res.status(502).json({ error: "Не удалось отправить сообщение в Telegram. Попробуйте позже." });
  }
});

app.post(["/api/telegram/webhook", "/api/v1/telegram/webhook"], async (req, res) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.get("x-telegram-bot-api-secret-token") !== secret) return res.sendStatus(403);
  await handleTelegramUpdate(req.body);
  res.json({ ok: true });
});

app.get(["/api/health", "/api/v1/health"], async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

app.get("/robots.txt", (_req, res) => {
  const origin = (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`);
});
app.get("/sitemap.xml", async (_req, res) => {
  const origin = (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
  const products = await prisma.product.findMany({ where: { active: true }, select: { slug: true, updatedAt: true } });
  const staticPaths = ["/", "/html/catalog-page.html", "/html/contact-page.html"];
  const urls = [...staticPaths.map((loc) => ({ loc: `${origin}${loc}` })), ...products.map((product) => ({ loc: `${origin}/product/${encodeURIComponent(product.slug)}`, lastmod: product.updatedAt.toISOString().slice(0, 10) }))];
  const xml = urls.map(({ loc, lastmod }) => `<url><loc>${loc.replace(/&/g, "&amp;")}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`).join("");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${xml}</urlset>`);
});

const root = __dirname;
for (const directory of ["html", "css", "scripts", "image", "public"]) {
  app.use(`/${directory}`, express.static(path.join(root, directory), { dotfiles: "deny", index: false, fallthrough: true, maxAge: isProduction ? "1h" : 0 }));
}

app.get("/", (_req, res) => res.sendFile(path.join(root, "html/home-page.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(root, "html/admin-page.html")));
app.get("/favorites", (_req, res) => res.sendFile(path.join(root, "html/favorites-page.html")));
app.get("/account", (_req, res) => res.sendFile(path.join(root, "html/account-page.html")));
app.get("/cart", (_req, res) => res.sendFile(path.join(root, "html/cart-page.html")));
app.get("/checkout", (_req, res) => res.sendFile(path.join(root, "html/checkout-page.html")));
app.get("/track", (_req, res) => res.sendFile(path.join(root, "html/order-page.html")));
app.get("/compare", (_req, res) => res.sendFile(path.join(root, "html/compare-page.html")));
app.get("/product/:slug", (req, res) => {
  if (!/^[a-z0-9-]{1,180}$/.test(req.params.slug)) return res.status(404).sendFile(path.join(root, "html/home-page.html"));
  res.sendFile(path.join(root, "html/product-page.html"));
});
app.use((req, res) => req.path.startsWith("/api/") ? res.status(404).json({ error: "Маршрут не найден." }) : res.status(404).sendFile(path.join(root, "html/home-page.html")));

app.use((error, _req, res, _next) => {
  console.error(JSON.stringify({ level: "error", requestId: _req.requestId, message: error.message }));
  if (res.headersSent) return;
  const status = error.status || (error.type === "entity.too.large" ? 413 : 500);
  res.status(status).json({ error: status >= 500 ? "Внутренняя ошибка сервера." : error.message });
});

const server = app.listen(port, host, () => console.log(`ZYNORA server listening on ${host}:${port}`));
startTelegramPolling();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  if (pool) await pool.end();
  process.exit(0);
}
