const express = require("express");
const axios = require("axios");
const { AppError } = require("../middleware/error-handler");
const { requireAuth, requireSubscription } = require("../middleware/auth");

const router = express.Router();
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const tmdb = (path, params = {}) =>
  axios.get(`${TMDB}${path}`, {
    params: { api_key: process.env.TMDB_API_KEY, language: "en-US", ...params },
    timeout: 10000,
  });

const img = (path, size) => (path ? `${IMG}/${size}${path}` : null);

function mapSearchItem(type) {
  return (item) => {
    const date = type === "movie" ? item.release_date : item.first_air_date;
    return {
      type,
      tmdbId: item.id,
      title: type === "movie" ? item.title : item.name,
      year: date ? date.slice(0, 4) : null,
      overview: item.overview,
      poster: img(item.poster_path, "w500"),
      backdrop: img(item.backdrop_path, "w1280"),
      voteAverage: item.vote_average,
      popularity: item.popularity,
    };
  };
}

/** Details shared by movies and TV: IMDb id, trailer, legal places to watch. */
function extras(data) {
  const trailer =
    data.videos?.results?.find(
      (v) => v.site === "YouTube" && v.type === "Trailer" && v.official,
    ) ||
    data.videos?.results?.find(
      (v) => v.site === "YouTube" && v.type === "Trailer",
    );
  const ke = data["watch/providers"]?.results?.KE || null;

  return {
    imdbId: data.external_ids?.imdb_id || null,
    trailer: trailer
      ? {
          youtubeKey: trailer.key,
          embedUrl: `https://www.youtube.com/embed/${trailer.key}`,
          watchUrl: `https://www.youtube.com/watch?v=${trailer.key}`,
          iframeHtml: `<iframe src="https://www.youtube.com/embed/${trailer.key}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; picture-in-picture"></iframe>`,
        }
      : null,
    whereToWatchInKenya: ke
      ? {
          link: ke.link,
          stream: ke.flatrate || [],
          rent: ke.rent || [],
          buy: ke.buy || [],
        }
      : null,
  };
}

const APPEND = "external_ids,videos,watch/providers";

/**
 * GET /search?q=Invincible&type=all|movie|tv&limit=10
 */
router.get(
  "/search",
  requireAuth,
  requireSubscription,
  asyncHandler(async (req, res) => {
    const query = String(req.query.q || req.query.query || "").trim();
    if (!query) throw new AppError(400, 'Missing query parameter "q".');

    const type = String(req.query.type || "all").toLowerCase();
    if (!["all", "movie", "tv"].includes(type)) {
      throw new AppError(400, 'type must be "all", "movie" or "tv".');
    }
    const limit = Math.min(parseInt(req.query.limit) || 10, 20);

    const calls = [];
    if (type === "movie" || type === "all") {
      calls.push(
        tmdb("/search/movie", { query, include_adult: false, page: 1 }).then(
          (r) => r.data.results.slice(0, limit).map(mapSearchItem("movie")),
        ),
      );
    }
    if (type === "tv" || type === "all") {
      calls.push(
        tmdb("/search/tv", { query, include_adult: false, page: 1 }).then((r) =>
          r.data.results.slice(0, limit).map(mapSearchItem("tv")),
        ),
      );
    }

    const results = (await Promise.all(calls))
      .flat()
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    res.json({ success: true, query, count: results.length, results });
  }),
);

/**
 * GET /movie/:tmdbId
 */
router.get(
  "/movie/:tmdbId",
  requireAuth,
  requireSubscription,
  asyncHandler(async (req, res) => {
    if (!/^\d+$/.test(req.params.tmdbId)) {
      throw new AppError(400, "tmdbId must be a number.");
    }
    const { data } = await tmdb(`/movie/${req.params.tmdbId}`, {
      append_to_response: APPEND,
    });

    res.json({
      success: true,
      type: "movie",
      movie: {
        tmdbId: data.id,
        title: data.title,
        tagline: data.tagline,
        releaseDate: data.release_date,
        overview: data.overview,
        runtime: data.runtime,
        genres: (data.genres || []).map((g) => g.name),
        voteAverage: data.vote_average,
        poster: img(data.poster_path, "w500"),
        backdrop: img(data.backdrop_path, "w1280"),
        ...extras(data),
      },
    });
  }),
);

/**
 * GET /tv/:tmdbId
 */
router.get(
  "/tv/:tmdbId",
  requireAuth,
  requireSubscription,
  asyncHandler(async (req, res) => {
    if (!/^\d+$/.test(req.params.tmdbId)) {
      throw new AppError(400, "tmdbId must be a number.");
    }
    const { data } = await tmdb(`/tv/${req.params.tmdbId}`, {
      append_to_response: APPEND,
    });

    res.json({
      success: true,
      type: "tv",
      show: {
        tmdbId: data.id,
        title: data.name,
        tagline: data.tagline,
        firstAirDate: data.first_air_date,
        overview: data.overview,
        numberOfSeasons: data.number_of_seasons,
        numberOfEpisodes: data.number_of_episodes,
        genres: (data.genres || []).map((g) => g.name),
        voteAverage: data.vote_average,
        poster: img(data.poster_path, "w500"),
        backdrop: img(data.backdrop_path, "w1280"),
        ...extras(data),
      },
    });
  }),
);

module.exports = router;
