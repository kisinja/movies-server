const express = require("express");
const { requireAuth, requireSubscription } = require("../middleware/auth");
const {
  getMoviePlayer,
  getTvPlayer,
} = require("../controllers/player.controller");

const router = express.Router();

// GET /api/movie/:tmdbId
router.get("/movie/:tmdbId", requireAuth, requireSubscription, getMoviePlayer);

// GET /api/tv/:tmdbId
// GET /api/tv/:tmdbId?season=1&episode=1
router.get("/tv/:tmdbId", requireAuth, requireSubscription, getTvPlayer);

module.exports = router;
