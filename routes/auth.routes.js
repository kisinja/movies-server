const express = require("express");
const { login, register } = require("../controllers/auth.controller");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.post("/register", asyncHandler(register));
router.post("/login", asyncHandler(login));

module.exports = router;
