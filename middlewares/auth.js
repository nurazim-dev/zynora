function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "ADMIN") return res.status(401).json({ error: "Войдите в панель администратора." });
  next();
}

function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Войдите в аккаунт." });
  next();
}

module.exports = { requireAdmin, requireUser };
