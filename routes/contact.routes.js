const express = require("express");
const { sendContactMessage } = require("../controllers/contact.controller");
const { rateLimit } = require("../middleware/rate-limit");

const router = express.Router();
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "You've sent several messages recently. Please try again later.",
});

router.post("/", limiter, (req, res, next) =>
  Promise.resolve(sendContactMessage(req, res)).catch(next),
);

module.exports = router;
