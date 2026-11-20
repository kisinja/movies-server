const prisma = require("../lib/prisma");

function requireAdmin(req, res, next) {
  prisma.user
    .findUnique({
      where: { id: req.userId },
      select: { role: true },
    })
    .then((user) => {
      if (!user || user.role !== "ADMIN") {
        return res.status(403).json({
          success: false,
          error: "Admin access required.",
          code: "ADMIN_ONLY",
        });
      }
      next();
    })
    .catch(next);
}

module.exports = { requireAdmin };
