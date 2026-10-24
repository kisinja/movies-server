const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { AppError } = require("./error-handler");

const WEEKLY_PRICE_KES = 30;

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(new AppError(401, "Please sign in."));

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // UUID string ids — do NOT use Number()
    const userId = payload.sub || payload.id;
    if (!userId || typeof userId !== "string") {
      return next(new AppError(401, "Your session is invalid or has expired."));
    }

    req.userId = userId;
    req.user = payload;
    next();
  } catch {
    next(new AppError(401, "Your session is invalid or has expired."));
  }
}

async function requireSubscription(req, res, next) {
  try {
    if (!req.userId) {
      return next(new AppError(401, "Please sign in."));
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { subscriptionExpiresAt: true, role: true },
    });

    if (!user) return next(new AppError(401, "Please sign in."));

    const active =
      user.role === "ADMIN" ||
      (user.subscriptionExpiresAt && user.subscriptionExpiresAt > new Date());

    if (!active) {
      return next(
        new AppError(
          402,
          `An active subscription is required (KES ${WEEKLY_PRICE_KES} per week).`,
        ),
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireSubscription, WEEKLY_PRICE_KES };