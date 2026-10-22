const axios = require("axios");
const { AppError } = require("../middleware/error-handler");

/**
 * Map a TMDB movie result to a clean response object
 */
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

/**
 * Map a TMDB TV result to a clean response object
 */
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

/**
 * GET /api/search?q=Invincible&type=all|movie|tv&limit=10
 * Unified search – returns movies, TV shows, or both
 */
const search = async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      throw new AppError('Missing query parameter "q"', 400);
    }

    const type = (req.query.type || "all").toLowerCase(); // all | movie | tv
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);

    let results = [];

    if (type === "movie" || type === "all") {
      const { data } = await axios.get(
        "https://api.themoviedb.org/3/search/movie",
        {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query,
            include_adult: false,
            language: "en-US",
            page: 1,
          },
        },
      );
      results = results.concat(
        (data.results || []).slice(0, limit).map(mapMovie),
      );
    }

    if (type === "tv" || type === "all") {
      const { data } = await axios.get(
        "https://api.themoviedb.org/3/search/tv",
        {
          params: {
            api_key: process.env.TMDB_API_KEY,
            query,
            include_adult: false,
            language: "en-US",
            page: 1,
          },
        },
      );
      results = results.concat((data.results || []).slice(0, limit).map(mapTv));
    }

    // Highest popularity first
    results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    res.json({
      success: true,
      query,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/search/movies?q=Avengers&limit=10
 * Movies only
 */
const searchMovies = async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      throw new AppError('Missing query parameter "q"', 400);
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);

    const { data } = await axios.get(
      "https://api.themoviedb.org/3/search/movie",
      {
        params: {
          api_key: process.env.TMDB_API_KEY,
          query,
          include_adult: false,
          language: "en-US",
          page: 1,
        },
      },
    );

    const results = (data.results || []).slice(0, limit).map(mapMovie);

    res.json({
      success: true,
      query,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/search/tv?q=Invincible&limit=10
 * TV shows only
 */
const searchTv = async (req, res, next) => {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      throw new AppError('Missing query parameter "q"', 400);
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);

    const { data } = await axios.get("https://api.themoviedb.org/3/search/tv", {
      params: {
        api_key: process.env.TMDB_API_KEY,
        query,
        include_adult: false,
        language: "en-US",
        page: 1,
      },
    });

    const results = (data.results || []).slice(0, limit).map(mapTv);

    res.json({
      success: true,
      query,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { search, searchMovies, searchTv };
