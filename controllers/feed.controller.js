const axios = require("axios");
const { AppError } = require("../middleware/error-handler");

function mapMovie(item) {
  return {
    type: "movie",
    tmdbId: item.id,
    title: item.title,
    originalTitle: item.original_title,
    releaseDate: item.release_date || null,
    year: item.release_date ? item.release_date.slice(0, 4) : null,
    overview: item.overview,
    poster: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : null,
    backdrop: item.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
      : null,
    voteAverage: item.vote_average,
    popularity: item.popularity,
  };
}

function mapTv(item) {
  return {
    type: "tv",
    tmdbId: item.id,
    title: item.name,
    originalTitle: item.original_name,
    firstAirDate: item.first_air_date || null,
    year: item.first_air_date ? item.first_air_date.slice(0, 4) : null,
    overview: item.overview,
    poster: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : null,
    backdrop: item.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
      : null,
    voteAverage: item.vote_average,
    popularity: item.popularity,
  };
}

function getLimit(req) {
  return Math.min(parseInt(req.query.limit, 10) || 12, 20);
}

/**
 * GET /api/feed
 * Homepage feed: trending movies + trending TV + popular movies
 */
const getFeed = async (req, res, next) => {
  try {
    const limit = getLimit(req);
    const key = process.env.TMDB_API_KEY;

    const [trendingMoviesRes, trendingTvRes, popularMoviesRes] =
      await Promise.all([
        axios.get("https://api.themoviedb.org/3/trending/movie/day", {
          params: { api_key: key, language: "en-US" },
        }),
        axios.get("https://api.themoviedb.org/3/trending/tv/day", {
          params: { api_key: key, language: "en-US" },
        }),
        axios.get("https://api.themoviedb.org/3/movie/popular", {
          params: { api_key: key, language: "en-US", page: 1 },
        }),
      ]);

    res.json({
      success: true,
      sections: {
        trendingMovies: (trendingMoviesRes.data.results || [])
          .slice(0, limit)
          .map(mapMovie),
        trendingTv: (trendingTvRes.data.results || [])
          .slice(0, limit)
          .map(mapTv),
        popularMovies: (popularMoviesRes.data.results || [])
          .slice(0, limit)
          .map(mapMovie),
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

    const { data } = await axios.get(
      "https://api.themoviedb.org/3/trending/movie/day",
      {
        params: {
          api_key: process.env.TMDB_API_KEY,
          language: "en-US",
        },
      }
    );

    const results = (data.results || []).slice(0, limit).map(mapMovie);

    res.json({
      success: true,
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

    const { data } = await axios.get(
      "https://api.themoviedb.org/3/trending/tv/day",
      {
        params: {
          api_key: process.env.TMDB_API_KEY,
          language: "en-US",
        },
      }
    );

    const results = (data.results || []).slice(0, limit).map(mapTv);

    res.json({
      success: true,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getFeed, getFeedMovies, getFeedTv };