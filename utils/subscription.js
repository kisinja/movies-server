const { getPlan } = require("../middleware/auth");
const { AppError } = require("../middleware/error-handler");

function resolvePaymentPlan(payment) {
  if (payment.plan === "monthly") return getPlan("monthly");
  if (payment.plan === "weekly") return getPlan("weekly");

  return Number(payment.amount) >= 100
    ? getPlan("monthly")
    : getPlan("weekly");
}

async function extendSubscription(db, userId, durationMs, now = new Date()) {
  const lockedUsers = await db.$queryRaw`
    SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `;
  if (!lockedUsers.length) {
    throw new AppError(404, "User not found.");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, subscriptionExpiresAt: true },
  });

  const base =
    user.subscriptionExpiresAt && user.subscriptionExpiresAt > now
      ? user.subscriptionExpiresAt
      : now;
  const subscriptionExpiresAt = new Date(base.getTime() + durationMs);

  await db.user.update({
    where: { id: userId },
    data: { subscriptionExpiresAt },
  });

  return subscriptionExpiresAt;
}

module.exports = { resolvePaymentPlan, extendSubscription };
