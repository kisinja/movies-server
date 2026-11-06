const axios = require("axios");
const { AppError } = require("../middleware/error-handler");

const VIDAPI_BASE = "https://vidapi.ru";

/**
 * Map VidAPI movie item to your standard format
 */
function mapVidapiMovie(item) {
  return {
    type: "movie",
    tmdbId: item.tmdb_id || null,
    imdbId: item.imdb_id || null,
    title: item.title,
    year: item.year || null,
    overview: null, // VidAPI listing doesn't provide overview
    poster: item.poster_url || null,
    backdrop: null,
    voteAverage: item.rating ? parseFloat(item.rating) : null,
    popularity: item.popularity ? parseFloat(item.popularity) : null,
    genre: item.genre || null,
    embedUrl: item.embed_url || null, // ready-to-use embed
  };
}

/**
 * Map VidAPI TV item
 */
function mapVidapiTv(item) {
  return {
    type: "tv",
    tmdbId: item.tmdb_id || null,
    imdbId: item.imdb_id || null,
    title: item.title,
    year: item.year || null,
    overview: null,
    poster: item.poster_url || null,
    backdrop: null,
    voteAverage: item.rating ? parseFloat(item.rating) : null,
    popularity: item.popularity ? parseFloat(item.popularity) : null,
    genre: item.genre || null,
    embedUrl: item.embed_url || null,
  };
}

function getLimit(req) {
  return Math.min(parseInt(req.query.limit, 10) || 12, 24);
}

/**
 * GET /api/feed
 * Homepage feed using VidAPI latest content
 */
const getFeed = async (req, res, next) => {
  try {
    const limit = getLimit(req);

    const [moviesRes, tvRes] = await Promise.all([
      axios.get(`${VIDAPI_BASE}/movies/latest/page-1.json`),
      axios.get(`${VIDAPI_BASE}/tvshows/latest/page-1.json`),
    ]);

    const trendingMovies = (moviesRes.data.items || [])
      .slice(0, limit)
      .map(mapVidapiMovie);

    const trendingTv = (tvRes.data.items || [])
      .slice(0, limit)
      .map(mapVidapiTv);

    // Using latest movies also as "popular" for now
    const popularMovies = (moviesRes.data.items || [])
      .slice(0, limit)
      .map(mapVidapiMovie);

    res.json({
      success: true,
      sections: {
        trendingMovies,
        trendingTv,
        popularMovies,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/feed/movies
 */
const getFeedMovies = async (req, res, next) => {
  try {
    const limit = getLimit(req);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const { data } = await axios.get(
      `${VIDAPI_BASE}/movies/latest/page-${page}.json`
    );

    const results = (data.items || []).slice(0, limit).map(mapVidapiMovie);

    res.json({
      success: true,
      page: data.page,
      totalPages: data.total_pages,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/feed/tv
 */
const getFeedTv = async (req, res, next) => {
  try {
    const limit = getLimit(req);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const { data } = await axios.get(
      `${VIDAPI_BASE}/tvshows/latest/page-${page}.json`
    );

    const results = (data.items || []).slice(0, limit).map(mapVidapiTv);

    res.json({
      success: true,
      page: data.page,
      totalPages: data.total_pages,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getFeed, getFeedMovies, getFeedTv };