const axios = require("axios");
const { AppError } = require("../middleware/error-handler");

const isId = (v) => /^\d+$/.test(String(v));

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";

function getTrailerKey(videos = []) {
  if (!Array.isArray(videos)) return null;

  // Prefer official YouTube Trailer
  const trailer =
    videos.find(
      (v) =>
        v.site === "YouTube" &&
        v.type === "Trailer" &&
        v.official === true
    ) ||
    videos.find(
      (v) => v.site === "YouTube" && v.type === "Trailer"
    ) ||
    videos.find((v) => v.site === "YouTube");

  return trailer?.key || null;
}

/**
 * GET /api/movie/:tmdbId
 */
const getMovieDetails = async (req, res, next) => {
  try {
    const { tmdbId } = req.params;

    if (!isId(tmdbId)) throw new AppError(400, "tmdbId must be a number.");

    const { data } = await axios.get(`${TMDB_BASE}/movie/${tmdbId}`, {
      params: {
        api_key: process.env.TMDB_API_KEY,
        language: "en-US",
        append_to_response: "videos",
      },
    });

    const trailerKey = getTrailerKey(data.videos?.results);

    res.json({
      success: true,
      type: "movie",
      tmdbId: data.id,
      title: data.title,
      originalTitle: data.original_title,
      overview: data.overview,
      releaseDate: data.release_date || null,
      year: data.release_date ? data.release_date.slice(0, 4) : null,
      runtime: data.runtime,
      voteAverage: data.vote_average,
      voteCount: data.vote_count,
      popularity: data.popularity,
      genres: data.genres?.map((g) => g.name) || [],
      poster: data.poster_path
        ? `${TMDB_IMG}/w500${data.poster_path}`
        : null,
      backdrop: data.backdrop_path
        ? `${TMDB_IMG}/w1280${data.backdrop_path}`
        : null,
      trailerKey,
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return next(new AppError(404,"Movie not found"));
    }
    next(err);
  }
};

/**
 * GET /api/tv/:tmdbId
 */
const getTvDetails = async (req, res, next) => {
  try {
    const { tmdbId } = req.params;

    if (!isId(tmdbId)) throw new AppError(400, "tmdbId must be a number.");

    const { data } = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, {
      params: {
        api_key: process.env.TMDB_API_KEY,
        language: "en-US",
        append_to_response: "videos",
      },
    });

    const trailerKey = getTrailerKey(data.videos?.results);

    res.json({
      success: true,
      type: "tv",
      tmdbId: data.id,
      title: data.name,
      originalTitle: data.original_name,
      overview: data.overview,
      firstAirDate: data.first_air_date || null,
      year: data.first_air_date ? data.first_air_date.slice(0, 4) : null,
      numberOfSeasons: data.number_of_seasons,
      numberOfEpisodes: data.number_of_episodes,
      voteAverage: data.vote_average,
      voteCount: data.vote_count,
      popularity: data.popularity,
      genres: data.genres?.map((g) => g.name) || [],
      poster: data.poster_path
        ? `${TMDB_IMG}/w500${data.poster_path}`
        : null,
      backdrop: data.backdrop_path
        ? `${TMDB_IMG}/w1280${data.backdrop_path}`
        : null,
      trailerKey,
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return next(new AppError(404,"TV show not found"));
    }
    next(err);
  }
};

module.exports = { getMovieDetails, getTvDetails };