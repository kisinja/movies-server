const express = require("express");
const router = express.Router();
const { getMovieEmbed, getTvEmbed } = require("../controllers/watch.controller");

router.get("/movie/:tmdbId", getMovieEmbed);
router.get("/tv/:tmdbId/:season/:episode", getTvEmbed);

module.exports = router;