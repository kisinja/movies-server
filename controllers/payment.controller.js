const crypto = require("crypto");
const axios = require("axios");
const prisma = require("../lib/prisma");
const { AppError } = require("../middleware/error-handler");
const { WEEKLY_PRICE_KES } = require("../middleware/auth");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CURRENCY = "KES";

const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  timeout: 15000,
});

function authHeaders() {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY is not set");
  }
  return { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` };
}

/**
 * POST /api/payments/initialize
 * Creates a pending payment and returns the Paystack checkout URL.
 */
async function initialize(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new AppError(401, "Please sign in.");

  const reference = `mw_${user.id}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  const { data } = await paystack.post(
    "/transaction/initialize",
    {
      email: user.email,
      amount: WEEKLY_PRICE_KES * 100, // Paystack uses the smallest unit (cents)
      currency: CURRENCY,
      reference,
      callback_url: process.env.PAYSTACK_CALLBACK_URL || undefined,
      metadata: { userId: user.id, plan: "weekly" },
    },
    { headers: authHeaders() },
  );

  await prisma.payment.create({
    data: {
      amount: WEEKLY_PRICE_KES,
      currency: CURRENCY,
      provider: "paystack",
      providerPaymentId: reference,
      userId: user.id,
    },
  });

  res.status(201).json({
    success: true,
    reference,
    authorizationUrl: data.data.authorization_url,
  });
}

/**
 * Verifies a reference with Paystack and, if it was paid in full,
 * grants one week of access. Safe to call many times for the same reference.
 */
async function fulfillReference(reference) {
  const payment = await prisma.payment.findUnique({
    where: { providerPaymentId: reference },
  });
  if (!payment) throw new AppError(404, "Payment not found.");
  if (payment.status === "SUCCEEDED") return payment;

  const { data } = await paystack.get(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: authHeaders() },
  );
  const tx = data.data;

  if (tx.status === "failed" || tx.status === "abandoned") {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    return { ...payment, status: "FAILED" };
  }

  if (tx.status !== "success") return payment; // still pending

  const paidInFull =
    tx.currency === CURRENCY && tx.amount >= WEEKLY_PRICE_KES * 100;
  if (!paidInFull) {
    console.warn(`Underpaid/wrong currency for ${reference}`, tx.amount, tx.currency);
    return payment;
  }

  await prisma.$transaction(async (db) => {
    // Only the first caller flips PENDING -> SUCCEEDED, so a webhook retry
    // or a double verify can never grant two weeks.
    const claimed = await db.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "SUCCEEDED" },
    });
    if (claimed.count === 0) return;

    const user = await db.user.findUnique({ where: { id: payment.userId } });
    const base =
      user.subscriptionExpiresAt && user.subscriptionExpiresAt > new Date()
        ? user.subscriptionExpiresAt
        : new Date();
    await db.user.update({
      where: { id: user.id },
      data: { subscriptionExpiresAt: new Date(base.getTime() + WEEK_MS) },
    });
  });

  return { ...payment, status: "SUCCEEDED" };
}

/**
 * GET /api/payments/verify/:reference
 * Called by the frontend after Paystack redirects back. Webhook is the
 * source of truth; this just makes the UI update instantly.
 */
async function verify(req, res) {
  const payment = await prisma.payment.findUnique({
    where: { providerPaymentId: req.params.reference },
  });
  if (!payment || payment.userId !== req.userId) {
    throw new AppError(404, "Payment not found.");
  }

  const result = await fulfillReference(req.params.reference);
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  res.json({
    success: true,
    status: result.status,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
  });
}

/**
 * POST /api/payments/webhook  (Paystack -> us, no JWT)
 * Authenticated by the HMAC-SHA512 signature of the raw body.
 */
async function webhook(req, res) {
  const signature = req.headers["x-paystack-signature"];
  const expected = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY || "")
    .update(req.rawBody || "")
    .digest("hex");

  const valid =
    typeof signature === "string" &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return res.sendStatus(401);

  res.sendStatus(200); // acknowledge fast; Paystack retries on non-200

  const event = req.body;
  if (event?.event === "charge.success" && event.data?.reference) {
    try {
      // Re-verify with the Paystack API rather than trusting the payload.
      await fulfillReference(event.data.reference);
    } catch (err) {
      console.error("Webhook fulfilment failed:", err.message);
    }
  }
}

module.exports = { initialize, verify, webhook };
