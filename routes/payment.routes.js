const express = require("express");
const { requireAuth } = require("../middleware/auth");
const {
  initialize,
  verify,
  webhook,
} = require("../controllers/payment.controller");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.post("/initialize", requireAuth, asyncHandler(initialize));
router.get("/verify/:reference", requireAuth, asyncHandler(verify));
router.post("/webhook", asyncHandler(webhook)); // verified by signature, not JWT

module.exports = router;
