const express = require("express");
const { requireAuth, requireSubscription } = require("../middleware/auth");
const {
  getFeed,
  getFeedMovies,
  getFeedTv,
} = require("../controllers/feed.controller");

const router = express.Router();

// GET /api/feed
router.get("/", requireAuth, requireSubscription, getFeed);

// GET /api/feed/movies
router.get("/movies", requireAuth, requireSubscription, getFeedMovies);

// GET /api/feed/tv
router.get("/tv", requireAuth, requireSubscription, getFeedTv);

module.exports = router;