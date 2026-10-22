const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { AppError } = require("../middleware/error-handler");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;
const TOKEN_LIFETIME = "1h";

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
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}

function createToken(user, secret) {
  return jwt.sign({}, secret, {
    subject: String(user.id),
    expiresIn: TOKEN_LIFETIME,
  });
}

async function register(req, res) {
  const { email, password, name } = validateCredentials(req.body, true);
  const jwtSecret = getJwtSecret();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: { email, passwordHash, name },
  });

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
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user)
      return res.status(404).json({ success: false, error: "Not found." });
    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      subscription: {
        active:
          !!user.subscriptionExpiresAt &&
          user.subscriptionExpiresAt > new Date(),
        expiresAt: user.subscriptionExpiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, getMe };
