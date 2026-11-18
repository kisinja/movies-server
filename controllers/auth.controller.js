const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const prisma = require("../lib/prisma");
const { sendPasswordResetEmail } = require("../utils/email");
const { AppError } = require("../middleware/error-handler");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;
const TOKEN_LIFETIME = "7d"; // was 1h — short sessions force constant re-login

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function getRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "Please provide a valid JSON object.");
  }
  return body;
}

function validateCredentials(body, includeName = false) {
  const { email, password, name } = getRequestBody(body);

  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    throw new AppError(400, "Please provide a valid email address.");
  }
  if (email.trim().length > 254) {
    throw new AppError(400, "Email address must be 254 characters or fewer.");
  }
  if (
    typeof password !== "string" ||
    Array.from(password).length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new AppError(
      400,
      "Password must be at least 8 characters and no more than 72 bytes.",
    );
  }

  let normalizedName;
  if (includeName && name !== undefined && name !== null) {
    if (typeof name !== "string" || name.trim().length > 100) {
      throw new AppError(400, "Name must be 100 characters or fewer.");
    }
    normalizedName = name.trim() || null;
  }

  return {
    email: email.trim().toLowerCase(),
    password,
    ...(includeName ? { name: normalizedName } : {}),
  };
}

function toPublicUser(user) {
  return {
    id: user.id, // UUID string
    email: user.email,
    name: user.name ?? null,
    role: user.role ?? "USER",
    createdAt: user.createdAt,
  };
}

/**
 * Sign JWT with UUID in `sub` (string — never Number).
 */
function createToken(user, secret) {
  return jwt.sign(
    {
      email: user.email,
      name: user.name ?? null,
    },
    secret,
    {
      subject: String(user.id), // -> payload.sub = UUID
      expiresIn: TOKEN_LIFETIME,
    },
  );
}

async function register(req, res) {
  const { email, password, name } = validateCredentials(req.body, true);
  const jwtSecret = getJwtSecret();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let user;
  try {
    user = await prisma.user.create({
      data: { email, passwordHash, name },
    });
  } catch (err) {
    // Unique constraint on email
    if (err.code === "P2002") {
      throw new AppError(409, "An account with this email already exists.");
    }
    throw err;
  }

  res.status(201).json({
    success: true,
    message: "Your account has been created.",
    user: toPublicUser(user),
    token: createToken(user, jwtSecret),
  });
}

async function login(req, res) {
  const { email, password } = validateCredentials(req.body);
  const jwtSecret = getJwtSecret();

  const user = await prisma.user.findUnique({ where: { email } });

  if (
    !user ||
    !user.passwordHash ||
    !(await bcrypt.compare(password, user.passwordHash))
  ) {
    throw new AppError(401, "Email or password is incorrect.");
  }

  res.json({
    success: true,
    message: "You are now signed in.",
    user: toPublicUser(user),
    token: createToken(user, jwtSecret),
  });
}

async function getMe(req, res, next) {
  try {
    if (!req.userId) {
      return res.status(401).json({ success: false, error: "Please sign in." });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        subscriptionExpiresAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: "Not found." });
    }

    const active =
      user.role === "ADMIN" ||
      (!!user.subscriptionExpiresAt && user.subscriptionExpiresAt > new Date());

    res.json({
      success: true,
      user: toPublicUser(user),
      subscription: {
        active,
        expiresAt: user.subscriptionExpiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 */
async function forgotPassword(req, res) {
  const { email } = req.body;

  if (!email) {
    throw new AppError(400, "Email is required");
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  // Always return success (don't reveal if email exists)
  if (!user) {
    return res.json({
      success: true,
      message:
        "If an account exists with that email, a reset link has been sent.",
    });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: hashedToken,
      passwordResetExpires: expires,
    },
  });

  const resetUrl = `https://watchtriplem.co.ke/reset-password?token=${resetToken}&email=${encodeURIComponent(
    user.email,
  )}`;

  try {
    await sendPasswordResetEmail({
      to: user.email,
      resetUrl,
    });
  } catch (err) {
    console.error("Failed to send reset email:", err);
    throw new AppError(
      500,
      "Could not send reset email. Please try again later.",
    );
  }

  res.json({
    success: true,
    message:
      "If an account exists with that email, a reset link has been sent.",
  });

  //console.log("Password reset link:", resetUrl);
}

/**
 * POST /api/auth/reset-password
 * Body: { token, email, password }
 */
async function resetPassword(req, res) {
  const { token, email, password } = req.body;

  if (!token || !email || !password) {
    throw new AppError(400, "Token, email and new password are required");
  }

  if (password.length < 6) {
    throw new AppError(400, "Password must be at least 6 characters");
  }

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await prisma.user.findFirst({
    where: {
      email: email.toLowerCase().trim(),
      passwordResetToken: hashedToken,
      passwordResetExpires: { gt: new Date() },
    },
  });

  if (!user) {
    throw new AppError(400, "Invalid or expired reset token");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });

  res.json({
    success: true,
    message: "Password has been reset successfully. You can now log in.",
  });
}

module.exports = { register, login, getMe, forgotPassword, resetPassword };
