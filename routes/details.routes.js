const express = require("express");
const {requireAuth} = require("../middleware/auth");
const {
  getMovieDetails,
  getTvDetails,
} = require("../controllers/details.controller");

const router = express.Router();

router.get("/details/movie/:tmdbId", requireAuth,getMovieDetails);
router.get("/details/tv/:tmdbId", requireAuth,getTvDetails);

module.exports = router;