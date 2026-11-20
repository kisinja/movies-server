const prisma = require("../lib/prisma");
const { AppError } = require("../middleware/error-handler");
const { sendPasswordResetEmail } = require("../utils/email");
const { writeAudit } = require("../utils/audit");
const { createPasswordResetLink } = require("../utils/password-reset");
const {
  extendSubscription,
  resolvePaymentPlan,
} = require("../utils/subscription");
const { clearBlockedTitleCache } = require("../utils/blocked-titles");

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  subscriptionExpiresAt: true,
};
const PAYMENT_SELECT = {
  id: true,
  amount: true,
  currency: true,
  status: true,
  provider: true,
  providerPaymentId: true,
  plan: true,
  userId: true,
  phone: true,
  checkoutRequestId: true,
  merchantRequestId: true,
  mpesaReceipt: true,
  failureReason: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true,
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = ["ADMIN", "USER"];
const MESSAGE_STATUSES = ["NEW", "RESOLVED"];
const TOPICS = ["support", "billing", "info"];
const TITLE_TYPES = ["movie", "tv"];
const PLAN_DAYS = { weekly: 7, monthly: 30 };

function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "Please provide a valid JSON object.");
  }
}

function assertAllowedKeys(value, allowed) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new AppError(400, `Unsupported field: ${unexpected}.`);
}

function requiredString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new AppError(400, `${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function getUuid(value, label = "id") {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AppError(400, `${label} must be a valid UUID.`);
  }
  return value;
}

function getPaymentId(value) {
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw new AppError(400, "Payment id must be a positive integer.");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2147483647) {
    throw new AppError(400, "Payment id must be a valid integer.");
  }
  return id;
}

function getPagination(query, sortValues) {
  const parseInteger = (value, fallback, label) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
      throw new AppError(400, `${label} must be an integer.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new AppError(400, `${label} is out of range.`);
    }
    return parsed;
  };
  const page = parseInteger(query.page, 1, "page");
  if (page < 1 || page > 1000000) {
    throw new AppError(400, "page must be between 1 and 1000000.");
  }
  const requestedLimit = parseInteger(query.limit, 20, "limit");
  const limit = Math.min(100, Math.max(1, requestedLimit));
  const sort = query.sort === undefined ? sortValues[0] : query.sort;
  if (typeof sort !== "string" || !sortValues.includes(sort)) {
    throw new AppError(400, "sort is not supported.");
  }
  const [sortField, sortOrder] = sort.split(":");
  return { page, limit, skip: (page - 1) * limit, orderBy: { [sortField]: sortOrder } };
}

function getSearch(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 200) {
    throw new AppError(400, "q must be a string of at most 200 characters.");
  }
  return value.trim() || null;
}

function getIsoDate(value, label) {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value,
    )
  ) {
    throw new AppError(400, `${label} must be an ISO date.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, `${label} must be a valid ISO date.`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && date.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, `${label} must be a valid ISO date.`);
  }
  if (label === "to" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function subscriptionStatus(expiresAt, now = new Date()) {
  if (!expiresAt) return "none";
  return expiresAt > now ? "active" : "expired";
}

function toPayment(payment) {
  return { ...payment, amount: Number(payment.amount) };
}

function paginationResponse(page, limit, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

async function serializableTransaction(callback) {
  try {
    return await prisma.$transaction(callback, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2034") {
      throw new AppError(409, "This operation conflicted with another update. Please retry.");
    }
    throw error;
  }
}

async function getStats(req, res) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [
    usersTotal,
    newLast7Days,
    newLast30Days,
    activeSubscribers,
    paymentCounts,
    openMessages,
    revenueRows,
    revenueSeriesRows,
    signupSeriesRows,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.user.count({
      where: { subscriptionExpiresAt: { gt: now } },
    }),
    prisma.payment.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.contactMessage.count({ where: { status: "NEW" } }),
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM("amount") FILTER (
          WHERE COALESCE("paidAt", "createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi'
            >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi')
        ), 0)::double precision AS today,
        COALESCE(SUM("amount") FILTER (
          WHERE COALESCE("paidAt", "createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi'
            >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi') - INTERVAL '6 days'
        ), 0)::double precision AS "last7Days",
        COALESCE(SUM("amount") FILTER (
          WHERE COALESCE("paidAt", "createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi'
            >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi') - INTERVAL '29 days'
        ), 0)::double precision AS "last30Days",
        COALESCE(SUM("amount"), 0)::double precision AS "allTime"
      FROM "Payment"
      WHERE "status" = 'SUCCEEDED' AND "currency" = 'KES'
    `,
    prisma.$queryRaw`
      SELECT to_char(
        date_trunc('day', COALESCE("paidAt", "createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi'),
        'YYYY-MM-DD'
      ) AS date, SUM("amount")::double precision AS amount
      FROM "Payment"
      WHERE "status" = 'SUCCEEDED'
        AND "currency" = 'KES'
        AND COALESCE("paidAt", "createdAt") AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi'
          >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi') - INTERVAL '29 days'
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT to_char(
        date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi'),
        'YYYY-MM-DD'
      ) AS date, COUNT(*)::integer AS count
      FROM "User"
      WHERE "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi'
        >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi') - INTERVAL '29 days'
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const payments = { succeeded: 0, pending: 0, failed: 0, refunded: 0 };
  for (const row of paymentCounts) {
    payments[row.status.toLowerCase()] = row._count._all;
  }

  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayParts = Object.fromEntries(
    dateFormatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const todayUtc = new Date(`${today}T00:00:00.000Z`);
  const revenueByDate = new Map(
    revenueSeriesRows.map((row) => [row.date, Number(row.amount)]),
  );
  const signupsByDate = new Map(
    signupSeriesRows.map((row) => [row.date, Number(row.count)]),
  );
  const revenueSeries = [];
  const signupSeries = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(todayUtc.getTime() - offset * 86400000)
      .toISOString()
      .slice(0, 10);
    revenueSeries.push({ date, amount: revenueByDate.get(date) || 0 });
    signupSeries.push({ date, count: signupsByDate.get(date) || 0 });
  }

  res.json({
    success: true,
    stats: {
      users: { total: usersTotal, newLast7Days, newLast30Days, activeSubscribers },
      revenue: {
        today: Number(revenueRows[0].today),
        last7Days: Number(revenueRows[0].last7Days),
        last30Days: Number(revenueRows[0].last30Days),
        allTime: Number(revenueRows[0].allTime),
      },
      payments,
      openMessages,
    },
    series: { revenue: revenueSeries, signups: signupSeries },
  });
}

async function listUsers(req, res) {
  const { page, limit, skip, orderBy } = getPagination(req.query, [
    "createdAt:desc",
    "createdAt:asc",
    "email:asc",
    "email:desc",
    "name:asc",
    "name:desc",
  ]);
  const q = getSearch(req.query.q);
  const where = {};
  if (q) {
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }
  if (req.query.role !== undefined) {
    if (!ROLES.includes(req.query.role)) throw new AppError(400, "role is invalid.");
    where.role = req.query.role;
  }
  const now = new Date();
  if (req.query.subscription !== undefined) {
    if (!["active", "expired", "none"].includes(req.query.subscription)) {
      throw new AppError(400, "subscription is invalid.");
    }
    if (req.query.subscription === "active") {
      where.subscriptionExpiresAt = { gt: now };
    } else if (req.query.subscription === "expired") {
      where.subscriptionExpiresAt = { lte: now };
    } else {
      where.subscriptionExpiresAt = null;
    }
  }

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        ...USER_SELECT,
        _count: { select: { payments: true } },
      },
      orderBy,
      skip,
      take: limit,
    }),
  ]);
  const data = users.map(({ _count, ...user }) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
    subscriptionStatus: subscriptionStatus(user.subscriptionExpiresAt, now),
    paymentsCount: _count.payments,
  }));
  res.json({ success: true, data, pagination: paginationResponse(page, limit, total) });
}

async function getUser(req, res) {
  const id = getUuid(req.params.id, "User id");
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...USER_SELECT,
      payments: {
        select: PAYMENT_SELECT,
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      _count: { select: { payments: true } },
    },
  });
  if (!user) throw new AppError(404, "User not found.");

  const [paidTotals, paymentsCount] = await prisma.$transaction([
    prisma.payment.aggregate({
      where: { userId: id, status: "SUCCEEDED", currency: "KES" },
      _sum: { amount: true },
    }),
    prisma.payment.count({ where: { userId: id } }),
  ]);
  const { payments, _count, ...userData } = user;
  res.json({
    success: true,
    user: userData,
    payments: payments.map(toPayment),
    totals: {
      paidKes: Number(paidTotals._sum.amount || 0),
      paymentsCount,
    },
  });
}

async function updateUser(req, res) {
  const id = getUuid(req.params.id, "User id");
  assertObject(req.body);
  assertAllowedKeys(req.body, ["name", "role"]);
  const data = {};
  if (Object.hasOwn(req.body, "name")) {
    if (
      req.body.name !== null &&
      (typeof req.body.name !== "string" || req.body.name.trim().length > 100)
    ) {
      throw new AppError(400, "name must be a string of at most 100 characters or null.");
    }
    data.name = req.body.name === null ? null : req.body.name.trim() || null;
  }
  if (Object.hasOwn(req.body, "role")) {
    if (!ROLES.includes(req.body.role)) throw new AppError(400, "role is invalid.");
    if (id === req.userId) throw new AppError(409, "You cannot change your own role.");
    data.role = req.body.role;
  }
  if (!Object.keys(data).length) throw new AppError(400, "Provide name or role to update.");

  const user = await serializableTransaction(async (db) => {
    const current = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true },
    });
    if (!current) throw new AppError(404, "User not found.");
    if (data.role === "USER" && current.role === "ADMIN") {
      const admins = await db.user.count({ where: { role: "ADMIN" } });
      if (admins <= 1) throw new AppError(409, "The last administrator cannot be demoted.");
    }
    const updated = await db.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
    await writeAudit(db, {
      adminId: req.userId,
      action: "user.updated",
      targetType: "user",
      targetId: id,
      details: { before: current, changes: data },
    });
    return updated;
  });
  res.json({ success: true, user });
}

async function updateSubscription(req, res) {
  const id = getUuid(req.params.id, "User id");
  assertObject(req.body);
  assertAllowedKeys(req.body, ["action", "days", "note"]);
  const action = req.body.action;
  if (!["grant", "revoke"].includes(action)) {
    throw new AppError(400, "action must be grant or revoke.");
  }
  if (action === "revoke" && id === req.userId) {
    throw new AppError(409, "You cannot revoke your own access.");
  }
  let note;
  if (req.body.note !== undefined) {
    note = requiredString(req.body.note, "note", 500);
  }
  let days;
  if (action === "grant") {
    days = req.body.days;
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new AppError(400, "days must be an integer between 1 and 365.");
    }
  } else if (Object.hasOwn(req.body, "days")) {
    throw new AppError(400, "days is only valid when granting a subscription.");
  }

  const subscriptionExpiresAt = await prisma.$transaction(async (db) => {
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new AppError(404, "User not found.");
    const expiry =
      action === "grant"
        ? await extendSubscription(db, id, days * 24 * 60 * 60 * 1000)
        : new Date();
    if (action === "revoke") {
      await db.user.update({
        where: { id },
        data: { subscriptionExpiresAt: expiry },
      });
    }
    await writeAudit(db, {
      adminId: req.userId,
      action: action === "grant" ? "user.subscription_granted" : "user.subscription_revoked",
      targetType: "user",
      targetId: id,
      details: { ...(action === "grant" ? { days } : {}), ...(note ? { note } : {}) },
    });
    return expiry;
  });
  res.json({ success: true, subscriptionExpiresAt });
}

async function sendUserReset(req, res) {
  const id = getUuid(req.params.id, "User id");
  const reset = await prisma.$transaction(async (db) => {
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!user) throw new AppError(404, "User not found.");
    const link = await createPasswordResetLink(db, user);
    await writeAudit(db, {
      adminId: req.userId,
      action: "user.password_reset_sent",
      targetType: "user",
      targetId: id,
    });
    return { user, ...link };
  });
  try {
    await sendPasswordResetEmail({ to: reset.user.email, resetUrl: reset.resetUrl });
  } catch (error) {
    console.error("Failed to send admin password reset email:", error.message);
    throw new AppError(503, "The reset link was created but the email could not be sent.");
  }
  res.json({ success: true, message: "Password reset email sent." });
}

async function deleteUser(req, res) {
  const id = getUuid(req.params.id, "User id");
  if (id === req.userId) throw new AppError(409, "You cannot delete your own account.");

  try {
    await serializableTransaction(async (db) => {
      const user = await db.user.findUnique({
        where: { id },
        select: { id: true, role: true },
      });
      if (!user) throw new AppError(404, "User not found.");
      const paymentsCount = await db.payment.count({ where: { userId: id } });
      if (paymentsCount > 0) {
        throw new AppError(
          409,
          "This user has payment records and cannot be deleted. Revoke the subscription instead.",
        );
      }
      if (user.role === "ADMIN") {
        const admins = await db.user.count({ where: { role: "ADMIN" } });
        if (admins <= 1) throw new AppError(409, "The last administrator cannot be deleted.");
      }
      const [auditCount, blockedCount] = await Promise.all([
        db.auditLog.count({ where: { adminId: id } }),
        db.blockedTitle.count({ where: { createdById: id } }),
      ]);
      if (auditCount || blockedCount) {
        throw new AppError(409, "This user owns retained administrative records and cannot be deleted.");
      }
      await writeAudit(db, {
        adminId: req.userId,
        action: "user.deleted",
        targetType: "user",
        targetId: id,
      });
      await db.user.delete({ where: { id } });
    });
  } catch (error) {
    if (error.code !== "P2003") throw error;
    const paymentsCount = await prisma.payment.count({ where: { userId: id } });
    if (paymentsCount > 0) {
      throw new AppError(
        409,
        "This user has payment records and cannot be deleted. Revoke the subscription instead.",
      );
    }
    throw new AppError(409, "This user owns retained administrative records and cannot be deleted.");
  }
  res.json({ success: true });
}

function getPaymentWhere(query) {
  const where = {};
  if (query.status !== undefined) {
    if (!["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"].includes(query.status)) {
      throw new AppError(400, "status is invalid.");
    }
    where.status = query.status;
  }
  if (query.plan !== undefined) {
    if (!Object.hasOwn(PLAN_DAYS, query.plan)) throw new AppError(400, "plan is invalid.");
    where.plan = query.plan;
  }
  const q = getSearch(query.q);
  if (q) {
    where.OR = [
      { phone: { contains: q, mode: "insensitive" } },
      { mpesaReceipt: { contains: q, mode: "insensitive" } },
      { checkoutRequestId: { contains: q, mode: "insensitive" } },
      { user: { is: { email: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const from = getIsoDate(query.from, "from");
  const to = getIsoDate(query.to, "to");
  if (from && to && from > to) throw new AppError(400, "from must be earlier than or equal to to.");
  if (from || to) {
    where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  return where;
}

async function listPayments(req, res) {
  const { page, limit, skip, orderBy } = getPagination(req.query, [
    "createdAt:desc",
    "createdAt:asc",
    "amount:desc",
    "amount:asc",
    "status:asc",
  ]);
  const where = getPaymentWhere(req.query);
  const [total, payments, summary] = await prisma.$transaction([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      select: { ...PAYMENT_SELECT, user: { select: { id: true, email: true, name: true } } },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.payment.aggregate({
      where: {
        AND: [where, { status: "SUCCEEDED", currency: "KES" }],
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);
  res.json({
    success: true,
    data: payments.map(toPayment),
    pagination: paginationResponse(page, limit, total),
    summary: {
      count: summary._count._all,
      totalKes: Number(summary._sum.amount || 0),
    },
  });
}

async function getPayment(req, res) {
  const id = getPaymentId(req.params.id);
  const payment = await prisma.payment.findUnique({
    where: { id },
    select: {
      ...PAYMENT_SELECT,
      user: { select: { id: true, email: true, name: true } },
    },
  });
  if (!payment) throw new AppError(404, "Payment not found.");
  res.json({ success: true, payment: toPayment(payment) });
}

async function reconcilePayment(req, res) {
  const id = getPaymentId(req.params.id);
  assertObject(req.body);
  assertAllowedKeys(req.body, ["mpesaReceipt", "note"]);
  const mpesaReceipt = requiredString(req.body.mpesaReceipt, "mpesaReceipt", 100);
  const note =
    req.body.note === undefined ? undefined : requiredString(req.body.note, "note", 500);

  const result = await prisma.$transaction(async (db) => {
    const payment = await db.payment.findUnique({
      where: { id },
      select: { ...PAYMENT_SELECT },
    });
    if (!payment) throw new AppError(404, "Payment not found.");
    if (payment.status === "SUCCEEDED") return { payment, idempotent: true };
    if (!["PENDING", "FAILED"].includes(payment.status)) {
      throw new AppError(409, "Only pending or failed payments can be reconciled.");
    }
    const plan = resolvePaymentPlan(payment);
    const paidAt = new Date();
    const claimed = await db.payment.updateMany({
      where: { id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "SUCCEEDED", mpesaReceipt, paidAt, failureReason: null },
    });
    if (!claimed.count) {
      const current = await db.payment.findUnique({
        where: { id },
        select: PAYMENT_SELECT,
      });
      if (current && current.status === "SUCCEEDED") {
        return { payment: current, idempotent: true };
      }
      throw new AppError(409, "This payment can no longer be reconciled.");
    }
    await extendSubscription(db, payment.userId, plan.durationMs, paidAt);
    await writeAudit(db, {
      adminId: req.userId,
      action: "payment.reconciled",
      targetType: "payment",
      targetId: id,
      details: { mpesaReceipt, ...(note ? { note } : {}) },
    });
    return {
      payment: { ...payment, status: "SUCCEEDED", mpesaReceipt, paidAt, failureReason: null },
      idempotent: false,
    };
  });
  res.json({
    success: true,
    payment: toPayment(result.payment),
    idempotent: result.idempotent,
  });
}

async function refundPayment(req, res) {
  const id = getPaymentId(req.params.id);
  assertObject(req.body);
  assertAllowedKeys(req.body, ["note", "revokeAccess"]);
  const note = requiredString(req.body.note, "note", 500);
  if (
    req.body.revokeAccess !== undefined &&
    typeof req.body.revokeAccess !== "boolean"
  ) {
    throw new AppError(400, "revokeAccess must be a boolean.");
  }
  const revokeAccess = req.body.revokeAccess === true;

  const payment = await prisma.$transaction(async (db) => {
    const current = await db.payment.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!current) throw new AppError(404, "Payment not found.");
    if (current.status !== "SUCCEEDED") {
      throw new AppError(409, "Only succeeded payments can be refunded.");
    }
    const transitioned = await db.payment.updateMany({
      where: { id, status: "SUCCEEDED" },
      data: { status: "REFUNDED" },
    });
    if (!transitioned.count) {
      throw new AppError(409, "Only succeeded payments can be refunded.");
    }
    const updated = await db.payment.findUnique({
      where: { id },
      select: PAYMENT_SELECT,
    });
    if (revokeAccess) {
      await db.user.update({
        where: { id: current.userId },
        data: { subscriptionExpiresAt: new Date() },
      });
    }
    await writeAudit(db, {
      adminId: req.userId,
      action: "payment.refunded",
      targetType: "payment",
      targetId: id,
      details: { note, revokeAccess },
    });
    return updated;
  });
  res.json({ success: true, payment: toPayment(payment) });
}

async function listMessages(req, res) {
  const { page, limit, skip, orderBy } = getPagination(req.query, [
    "createdAt:desc",
    "createdAt:asc",
    "status:asc",
  ]);
  const where = {};
  if (req.query.status !== undefined) {
    if (!MESSAGE_STATUSES.includes(req.query.status)) throw new AppError(400, "status is invalid.");
    where.status = req.query.status;
  }
  if (req.query.topic !== undefined) {
    if (!TOPICS.includes(req.query.topic)) throw new AppError(400, "topic is invalid.");
    where.topic = req.query.topic;
  }
  const q = getSearch(req.query.q);
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { subject: { contains: q, mode: "insensitive" } },
      { message: { contains: q, mode: "insensitive" } },
    ];
  }
  const [total, data] = await prisma.$transaction([
    prisma.contactMessage.count({ where }),
    prisma.contactMessage.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        topic: true,
        subject: true,
        message: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        resolvedById: true,
      },
      orderBy,
      skip,
      take: limit,
    }),
  ]);
  res.json({ success: true, data, pagination: paginationResponse(page, limit, total) });
}

async function updateMessage(req, res) {
  const id = getUuid(req.params.id, "Message id");
  assertObject(req.body);
  assertAllowedKeys(req.body, ["status"]);
  if (!MESSAGE_STATUSES.includes(req.body.status)) {
    throw new AppError(400, "status must be NEW or RESOLVED.");
  }
  const status = req.body.status;
  const message = await prisma.$transaction(async (db) => {
    const current = await db.contactMessage.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) throw new AppError(404, "Message not found.");
    const updated = await db.contactMessage.update({
      where: { id },
      data: {
        status,
        resolvedAt: status === "RESOLVED" ? new Date() : null,
        resolvedById: status === "RESOLVED" ? req.userId : null,
      },
    });
    await writeAudit(db, {
      adminId: req.userId,
      action: "message.status_changed",
      targetType: "message",
      targetId: id,
      details: { from: current.status, to: status },
    });
    return updated;
  });
  res.json({ success: true, message });
}

async function listAuditLogs(req, res) {
  const { page, limit, skip, orderBy } = getPagination(req.query, [
    "createdAt:desc",
    "createdAt:asc",
  ]);
  const where = {};
  if (req.query.action !== undefined) {
    where.action = requiredString(req.query.action, "action", 100);
  }
  const q = getSearch(req.query.q);
  if (q) {
    where.OR = [
      { targetId: { contains: q, mode: "insensitive" } },
      { admin: { is: { email: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const [total, data] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        adminId: true,
        action: true,
        targetType: true,
        targetId: true,
        details: true,
        createdAt: true,
        admin: { select: { id: true, email: true, name: true } },
      },
      orderBy,
      skip,
      take: limit,
    }),
  ]);
  res.json({ success: true, data, pagination: paginationResponse(page, limit, total) });
}

async function listBlockedTitles(req, res) {
  const { page, limit, skip, orderBy } = getPagination(req.query, [
    "createdAt:desc",
    "createdAt:asc",
    "tmdbId:asc",
    "tmdbId:desc",
  ]);
  const where = {};
  if (req.query.type !== undefined) {
    if (!TITLE_TYPES.includes(req.query.type)) throw new AppError(400, "type is invalid.");
    where.type = req.query.type;
  }
  const [total, data] = await prisma.$transaction([
    prisma.blockedTitle.count({ where }),
    prisma.blockedTitle.findMany({
      where,
      select: {
        id: true,
        type: true,
        tmdbId: true,
        reason: true,
        createdById: true,
        createdAt: true,
      },
      orderBy,
      skip,
      take: limit,
    }),
  ]);
  res.json({ success: true, data, pagination: paginationResponse(page, limit, total) });
}

async function createBlockedTitle(req, res) {
  assertObject(req.body);
  assertAllowedKeys(req.body, ["type", "tmdbId", "reason"]);
  const { type, tmdbId } = req.body;
  if (!TITLE_TYPES.includes(type)) throw new AppError(400, "type must be movie or tv.");
  if (!Number.isInteger(tmdbId) || tmdbId < 1 || tmdbId > 2147483647) {
    throw new AppError(400, "tmdbId must be a positive integer.");
  }
  let reason = null;
  if (req.body.reason !== undefined && req.body.reason !== null) {
    if (typeof req.body.reason !== "string" || req.body.reason.trim().length > 500) {
      throw new AppError(400, "reason must be a string of at most 500 characters.");
    }
    reason = req.body.reason.trim() || null;
  }
  const blockedTitle = await prisma.$transaction(async (db) => {
    const title = await db.blockedTitle.create({
      data: { type, tmdbId, reason, createdById: req.userId },
      select: {
        id: true,
        type: true,
        tmdbId: true,
        reason: true,
        createdById: true,
        createdAt: true,
      },
    });
    await writeAudit(db, {
      adminId: req.userId,
      action: "title.blocked",
      targetType: "title",
      targetId: title.id,
      details: { type, tmdbId, reason },
    });
    return title;
  });
  clearBlockedTitleCache();
  res.status(201).json({ success: true, blockedTitle });
}

async function deleteBlockedTitle(req, res) {
  const id = getUuid(req.params.id, "Blocked title id");
  await prisma.$transaction(async (db) => {
    const title = await db.blockedTitle.findUnique({
      where: { id },
      select: { id: true, type: true, tmdbId: true, reason: true },
    });
    if (!title) throw new AppError(404, "Blocked title not found.");
    await db.blockedTitle.delete({ where: { id } });
    await writeAudit(db, {
      adminId: req.userId,
      action: "title.unblocked",
      targetType: "title",
      targetId: id,
      details: title,
    });
  });
  clearBlockedTitleCache();
  res.json({ success: true });
}

module.exports = {
  getStats,
  listUsers,
  getUser,
  updateUser,
  updateSubscription,
  sendUserReset,
  deleteUser,
  listPayments,
  getPayment,
  reconcilePayment,
  refundPayment,
  listMessages,
  updateMessage,
  listAuditLogs,
  listBlockedTitles,
  createBlockedTitle,
  deleteBlockedTitle,
};
