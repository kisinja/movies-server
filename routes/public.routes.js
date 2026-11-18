const express = require("express");
const axios = require("axios");
const router = express.Router();

let cache = { at: 0, items: null };

router.get("/trending", async (req, res, next) => {
  try {
    if (!cache.items || Date.now() - cache.at > 60 * 60 * 1000) {
      const { data } = await axios.get(
        "https://api.themoviedb.org/3/trending/all/week",
        {
          params: { api_key: process.env.TMDB_API_KEY },
          timeout: 8000,
        },
      );
      cache = {
        at: Date.now(),
        items: data.results
          .filter((r) => r.media_type === "movie" || r.media_type === "tv")
          .slice(0, 18)
          .map((r) => ({
            type: r.media_type,
            tmdbId: r.id,
            title: r.title || r.name,
            poster: r.poster_path
              ? `https://image.tmdb.org/t/p/w342${r.poster_path}`
              : null,
          })),
      };
    }
    res.set("Cache-Control", "public, max-age=600, s-maxage=3600");
    res.json({ success: true, items: cache.items });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
