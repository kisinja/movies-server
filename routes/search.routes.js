const express = require("express");
const { requireAuth, requireSubscription } = require("../middleware/auth");
const {
  search,
  searchMovies,
  searchTv,
} = require("../controllers/search.controller");

const router = express.Router();

// Unified search (movies + TV)
// GET /api/search?q=Invincible
// GET /api/search?q=Invincible&type=movie
// GET /api/search?q=Invincible&type=tv&limit=15
router.get("/", requireAuth, requireSubscription, search);

// Movies only
// GET /api/search/movies?q=Avengers
router.get("/movies", requireAuth, requireSubscription, searchMovies);

// TV shows only
// GET /api/search/tv?q=Invincible
router.get("/tv", requireAuth, requireSubscription, searchTv);

module.exports = router;
