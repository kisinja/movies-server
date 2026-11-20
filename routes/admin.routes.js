const express = require("express");
const admin = require("../controllers/admin.controller");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/stats", asyncHandler(admin.getStats));

router.get("/users", asyncHandler(admin.listUsers));
router.get("/users/:id", asyncHandler(admin.getUser));
router.patch("/users/:id", asyncHandler(admin.updateUser));
router.post("/users/:id/subscription", asyncHandler(admin.updateSubscription));
router.post("/users/:id/send-reset", asyncHandler(admin.sendUserReset));
router.delete("/users/:id", asyncHandler(admin.deleteUser));

router.get("/payments", asyncHandler(admin.listPayments));
router.get("/payments/:id", asyncHandler(admin.getPayment));
router.post("/payments/:id/reconcile", asyncHandler(admin.reconcilePayment));
router.post("/payments/:id/refund", asyncHandler(admin.refundPayment));

router.get("/messages", asyncHandler(admin.listMessages));
router.patch("/messages/:id", asyncHandler(admin.updateMessage));
router.get("/audit-logs", asyncHandler(admin.listAuditLogs));

router.get("/blocked-titles", asyncHandler(admin.listBlockedTitles));
router.post("/blocked-titles", asyncHandler(admin.createBlockedTitle));
router.delete("/blocked-titles/:id", asyncHandler(admin.deleteBlockedTitle));

module.exports = router;
