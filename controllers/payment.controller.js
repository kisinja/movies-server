const crypto = require("crypto");
const axios = require("axios");
const prisma = require("../lib/prisma");
const { AppError } = require("../middleware/error-handler");
const { getPlan, PLANS } = require("../middleware/auth");

const CURRENCY = "KES";

// ======================
// Daraja Helpers
// ======================
const isSandbox = process.env.DARAJA_ENV !== "production";
const DARAJA_BASE = isSandbox
  ? "https://sandbox.safaricom.co.ke"
  : "https://api.safaricom.co.ke";

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const auth = Buffer.from(
    `${process.env.DARAJA_CONSUMER_KEY}:${process.env.DARAJA_CONSUMER_SECRET}`
  ).toString("base64");

  const { data } = await axios.get(
    `${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

function generatePassword() {
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);

  const password = Buffer.from(shortcode + passkey + timestamp).toString("base64");
  return { password, timestamp };
}

function formatPhone(phone) {
  let p = phone.toString().replace(/\D/g, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("7") || p.startsWith("1")) p = "254" + p;
  if (p.startsWith("+")) p = p.slice(1);
  return p;
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
 * Body: { plan?: "weekly" | "monthly", phone: "07XXXXXXXX" }
 */
async function initialize(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new AppError(401, "Please sign in.");

  const planId = req.body?.plan;
  const phone = req.body?.phone;

  if (!["weekly", "monthly"].includes(planId)) {
    throw new AppError(400, "Please select a valid subscription plan.");
  }

  if (!phone) {
    throw new AppError(400, "Phone number is required for M-Pesa payment.");
  }

  const plan = getPlan(planId);
  const formattedPhone = formatPhone(phone);

  const reference = `mw_${user.id}_${Date.now()}_${crypto
    .randomBytes(4)
    .toString("hex")}`;

  // Create pending payment first
  const payment = await prisma.payment.create({
    data: {
      amount: plan.amountKes,
      currency: CURRENCY,
      provider: "daraja",
      providerPaymentId: reference,
      plan: plan.id,
      userId: user.id,
      status: "PENDING",
      phone: formattedPhone,
    },
  });

  try {
    const token = await getAccessToken();
    const { password, timestamp } = generatePassword();

    const payload = {
      BusinessShortCode: process.env.DARAJA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: plan.amountKes,
      PartyA: formattedPhone,
      PartyB: process.env.DARAJA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: process.env.DARAJA_CALLBACK_URL,
      AccountReference: reference,
      TransactionDesc: `Triple M ${plan.label || planId} Subscription`,
    };

    const { data: stkRes } = await axios.post(
      `${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (stkRes.ResponseCode !== "0") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
      });
      throw new AppError(400, stkRes.errorMessage || "Failed to initiate M-Pesa payment");
    }

    // Save CheckoutRequestID for callback matching
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        checkoutRequestId: stkRes.CheckoutRequestID,
        merchantRequestId: stkRes.MerchantRequestID,
      },
    });

    res.status(201).json({
      success: true,
      reference,
      plan: plan.id,
      amount: plan.amountKes,
      message: "STK Push sent. Please check your phone and enter your M-Pesa PIN.",
      checkoutRequestId: stkRes.CheckoutRequestID,
    });
  } catch (err) {
    // Mark as failed if STK push itself fails
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED" },
    }).catch(() => {});
    throw err;
  }
}

/**
 * Grant access using payment.plan duration (7d or 30d).
 */
async function fulfillReference(reference, extra = {}) {
  const payment = await prisma.payment.findUnique({
    where: { providerPaymentId: reference },
  });
  if (!payment) throw new AppError(404, "Payment not found.");
  if (payment.status === "SUCCEEDED") return payment;

  const plan = resolvePlan(payment);

  await prisma.$transaction(async (db) => {
    const claimed = await db.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: "SUCCEEDED",
        mpesaReceipt: extra.mpesaReceipt || null,
        paidAt: new Date(),
      },
    });
    if (claimed.count === 0) return;

    const user = await db.user.findUnique({ where: { id: payment.userId } });
    const base =
      user.subscriptionExpiresAt && user.subscriptionExpiresAt > new Date()
        ? user.subscriptionExpiresAt
        : new Date();

    const newExpiry = new Date(base.getTime() + plan.durationMs);

    console.log("FULFILL", {
      reference,
      dbPlan: payment.plan,
      amountKes: payment.amount,
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
 * (Frontend can still poll this)
 */
async function verify(req, res) {
  const payment = await prisma.payment.findUnique({
    where: { providerPaymentId: req.params.reference },
  });
  if (!payment || payment.userId !== req.userId) {
    throw new AppError(404, "Payment not found.");
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });

  res.json({
    success: true,
    status: payment.status,
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
 * POST /api/payments/daraja/callback
 * Called by Safaricom
 */
async function darajaCallback(req, res) {
  // Always acknowledge quickly
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return;

    const checkoutRequestId = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;

    const payment = await prisma.payment.findFirst({
      where: { checkoutRequestId },
    });

    if (!payment || payment.status !== "PENDING") return;

    if (resultCode === 0) {
      // Success
      const items = callback.CallbackMetadata?.Item || [];
      const mpesaReceipt = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value;
      const amount = items.find((i) => i.Name === "Amount")?.Value;

      await fulfillReference(payment.providerPaymentId, { mpesaReceipt, amount });
      console.log(`✅ Daraja payment success: ${payment.providerPaymentId} - ${mpesaReceipt}`);
    } else {
      // Failed / Cancelled
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          failureReason: callback.ResultDesc || "Failed",
        },
      });
      console.log(`❌ Daraja payment failed: ${payment.providerPaymentId} - ${callback.ResultDesc}`);
    }
  } catch (err) {
    console.error("Daraja callback error:", err);
  }
}

module.exports = {
  initialize,
  verify,
  listPlans,
  darajaCallback,
};