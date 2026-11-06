const crypto = require("crypto");
const axios = require("axios");
const prisma = require("../lib/prisma");
const { AppError } = require("../middleware/error-handler");
const { getPlan, PLANS } = require("../middleware/auth");

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
 * Resolve plan from DB field, with amount fallback.
 * KES 100+ → monthly (30 days), otherwise weekly (7 days).
 */
function resolvePlan(payment) {
  if (payment.plan === "monthly") return getPlan("monthly");
  if (payment.plan === "weekly") return getPlan("weekly");

  const kes = Number(payment.amount);
  if (kes >= 100) return getPlan("monthly");
  return getPlan("weekly");
}

/**
 * POST /api/payments/initialize
 * Body: { plan?: "weekly" | "monthly" }
 */
async function initialize(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new AppError(401, "Please sign in.");

  const planId = req.body?.plan

  if(!["weekly", "monthly"].includes(planId)){
    throw new AppError(400, "Please select a valid subscription plan.");
  }

  const plan = getPlan(planId);

  console.log("PAYMENT INITIALIZATION:", {
  requestedPlan: req.body?.plan,
  selectedPlan: plan.id,
  amountKes: plan.amountKes,
  durationMs: plan.durationMs,
  userId: user.id,
});

  const reference = `mw_${user.id}_${Date.now()}_${crypto
    .randomBytes(4)
    .toString("hex")}`;

  const { data } = await paystack.post(
    "/transaction/initialize",
    {
      email: user.email,
      amount: plan.amountKes * 100,
      currency: CURRENCY,
      reference,
      callback_url: process.env.PAYSTACK_CALLBACK_URL || undefined,
      metadata: {
        userId: user.id,
        plan: plan.id,
      },
    },
    { headers: authHeaders() },
  );

  await prisma.payment.create({
    data: {
      amount: plan.amountKes,
      currency: CURRENCY,
      provider: "paystack",
      providerPaymentId: reference,
      plan: plan.id,
      userId: user.id,
      status: "PENDING",
    },
  });

  res.status(201).json({
    success: true,
    reference,
    plan: plan.id,
    amount: plan.amountKes,
    authorizationUrl: data.data.authorization_url,
  });
}

/**
 * Grant access using payment.plan duration (7d or 30d).
 * Falls back to amount if plan is missing/wrong.
 */
async function fulfillReference(reference) {
  const payment = await prisma.payment.findUnique({
    where: { providerPaymentId: reference },
  });
  if (!payment) throw new AppError(404, "Payment not found.");
  if (payment.status === "SUCCEEDED") return payment;

  // CHANGED: resolve plan from DB plan OR amount (>= 100 → monthly)
  const plan = resolvePlan(payment);
  console.log("PAYMENT FULFILLMENT:", {
  reference,
  databasePlan: payment.plan,
  databaseAmount: Number(payment.amount),
  resolvedPlan: plan.id,
  durationMs: plan.durationMs,
});

  const expectedKobo = Math.round(Number(payment.amount) * 100);

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

  if (tx.status !== "success") return payment;

  const paidInFull =
    tx.currency === CURRENCY && tx.amount >= expectedKobo;
  if (!paidInFull) {
    console.warn(
      `Underpaid/wrong currency for ${reference}`,
      "got",
      tx.amount,
      tx.currency,
      "expected",
      expectedKobo,
      "plan",
      plan.id,
    );
    return payment;
  }

  await prisma.$transaction(async (db) => {
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

    const newExpiry = new Date(base.getTime() + plan.durationMs);

    // CHANGED: richer log so you can see weekly vs monthly in the terminal
    console.log("FULFILL", {
      reference,
      dbPlan: payment.plan,
      amount: Number(payment.amount),
      resolved: plan.id,
      durationMs: plan.durationMs,
      expiry: newExpiry.toISOString(),
    });

    await db.user.update({
      where: { id: user.id },
      data: { subscriptionExpiresAt: newExpiry },
    });
  });

  return { ...payment, status: "SUCCEEDED", plan: plan.id };
}

/**
 * GET /api/payments/verify/:reference
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
    plan: payment.plan,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
  });
}

/**
 * GET /api/payments/plans
 */
async function listPlans(req, res) {
  res.json({
    success: true,
    plans: [
      {
        id: PLANS.weekly.id,
        amountKes: PLANS.weekly.amountKes,
        label: PLANS.weekly.label,
        description: "KES 30 per week",
        durationDays: 7,
      },
      {
        id: PLANS.monthly.id,
        amountKes: PLANS.monthly.amountKes,
        label: PLANS.monthly.label,
        description: "KES 100 per month · Save KES 20",
        durationDays: 30,
        savingsKes: 20,
      },
    ],
  });
}

/**
 * POST /api/payments/webhook
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

  res.sendStatus(200);

  const event = req.body;
  if (event?.event === "charge.success" && event.data?.reference) {
    try {
      await fulfillReference(event.data.reference);
    } catch (err) {
      console.error("Webhook fulfilment failed:", err.message);
    }
  }
}

module.exports = { initialize, verify, webhook, listPlans };