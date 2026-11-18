const express = require("express");
const {
  login,
  register,
  forgotPassword,
  resetPassword,
} = require("../controllers/auth.controller");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many reset requests. Please try again in a few minutes.",
});
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many attempts. Please try again in a few minutes.",
});

router.post("/register", asyncHandler(register));
router.post("/login", asyncHandler(login));
router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  asyncHandler(forgotPassword),
);
router.post(
  "/reset-password",
  resetPasswordLimiter,
  asyncHandler(resetPassword),
);

module.exports = router;
