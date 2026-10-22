const express = require("express");
const { getMe } = require("../controllers/auth.controller");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/me", requireAuth, getMe);

module.exports = router;