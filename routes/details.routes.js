const express = require("express");
const {
  getMovieDetails,
  getTvDetails,
} = require("../controllers/details.controller");

const router = express.Router();

// Public, read-only title info (needed for SEO and logged-out visitors)
router.get("/details/movie/:tmdbId", getMovieDetails);
router.get("/details/tv/:tmdbId", getTvDetails);

module.exports = router;