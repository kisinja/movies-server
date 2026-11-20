const crypto = require("node:crypto");

const FRONTEND_URL = (
  process.env.APP_URL || "https://www.watchtriplem.co.ke"
).replace(/\/+$/, "");

async function createPasswordResetLink(db, user) {
  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: hashedToken,
      passwordResetExpires: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  return {
    resetUrl: `${FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(
      user.email,
    )}`,
  };
}

module.exports = { createPasswordResetLink };
