const axios = require("axios");
const { AppError } = require("../middleware/error-handler");

const VIDAPI_BASE = "https://vaplayer.ru";

/**
 * Build VidAPI embed URL with optional customization
 */
function buildVidapiEmbed(type, id, season = null, episode = null, options = {}) {
  let path;

  if (type === "tv" && season && episode) {
    path = `/embed/tv/${id}/${season}/${episode}`;
  } else if (type === "tv") {
    path = `/embed/tv/${id}`;
  } else {
    path = `/embed/movie/${id}`;
  }

  const params = new URLSearchParams();

  if (options.primaryColor) {
    params.set("primaryColor", options.primaryColor.replace("#", ""));
  }
  if (options.autoplay !== undefined) {
    params.set("autoplay", options.autoplay ? "1" : "0");
  }
  if (options.lang) {
    params.set("lang", options.lang);
  }

  const query = params.toString() ? `?${params.toString()}` : "";
  return `${VIDAPI_BASE}${path}${query}`;
}

/**
 * GET /api/movie/:tmdbId
 */
const getMoviePlayer = async (req, res, next) => {
  try {
    const { tmdbId } = req.params;

    if (!tmdbId) {
      throw new AppError("tmdbId is required", 400);
    }

    // Get movie details from TMDB
    const { data: details } = await axios.get(
      `https://api.themoviedb.org/3/movie/${tmdbId}`,
      {
        params: {
          api_key: process.env.TMDB_API_KEY,
          language: "en-US",
        },
      }
    );

    // Optional player customization from query params
    const options = {
      primaryColor: req.query.primaryColor,
      autoplay: req.query.autoplay === "1" || req.query.autoplay === "true",
      lang: req.query.lang,
    };

    const embedUrl = buildVidapiEmbed("movie", tmdbId, null, null, options);

    res.json({
      success: true,
      type: "movie",
      movie: {
        tmdbId: details.id,
        title: details.title,
        releaseDate: details.release_date,
        overview: details.overview,
        poster: details.poster_path
          ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
          : null,
        backdrop: details.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
          : null,
        runtime: details.runtime,
        genres: details.genres?.map((g) => g.name) || [],
        voteAverage: details.vote_average,
      },
      player: {
        embedUrl,
        iframeHtml: `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>`,
      },
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return next(new AppError("Movie not found on TMDB", 404));
    }
    next(err);
  }
};

/**
 * GET /api/tv/:tmdbId
 * GET /api/tv/:tmdbId?season=1&episode=1
 */
const getTvPlayer = async (req, res, next) => {
  try {
    const { tmdbId } = req.params;
    const season = req.query.season ? parseInt(req.query.season, 10) : null;
    const episode = req.query.episode ? parseInt(req.query.episode, 10) : null;

    if (!tmdbId) {
      throw new AppError("tmdbId is required", 400);
    }

    // Get TV show details from TMDB
    const { data: details } = await axios.get(
      `https://api.themoviedb.org/3/tv/${tmdbId}`,
      {
        params: {
          api_key: process.env.TMDB_API_KEY,
          language: "en-US",
        },
      }
    );

    const options = {
      primaryColor: req.query.primaryColor,
      autoplay: req.query.autoplay === "1" || req.query.autoplay === "true",
      lang: req.query.lang,
    };

    const embedUrl = buildVidapiEmbed("tv", tmdbId, season, episode, options);

    res.json({
      success: true,
      type: "tv",
      show: {
        tmdbId: details.id,
        title: details.name,
        firstAirDate: details.first_air_date,
        overview: details.overview,
        poster: details.poster_path
          ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
          : null,
        backdrop: details.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
          : null,
        numberOfSeasons: details.number_of_seasons,
        numberOfEpisodes: details.number_of_episodes,
        genres: details.genres?.map((g) => g.name) || [],
        voteAverage: details.vote_average,
      },
      requested: {
        season,
        episode,
      },
      player: {
        embedUrl,
        iframeHtml: `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>`,
      },
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return next(new AppError("TV show not found on TMDB", 404));
    }
    next(err);
  }
};

module.exports = { getMoviePlayer, getTvPlayer };