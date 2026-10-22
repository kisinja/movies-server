const axios = require("axios");
const { AppError } = require("../middleware/error-handler");

const VIDSRC_MIRRORS = [
  "https://vidsrc.sh",
  "https://vidsrc2.ru",
  "https://vidsrc.ir",
];

/**
 * Check which VidSrc mirrors are currently responding
 */
async function getWorkingEmbeds(type, tmdbId, season = null, episode = null) {
  const path =
    type === "tv" && season && episode
      ? `/embed/tv/${tmdbId}/${season}/${episode}`
      : type === "tv"
        ? `/embed/tv/${tmdbId}`
        : `/embed/movie/${tmdbId}`;

  const working = [];

  await Promise.all(
    VIDSRC_MIRRORS.map(async (base) => {
      const embedUrl = `${base}${path}`;
      try {
        const response = await axios.head(embedUrl, {
          timeout: 3500,
          validateStatus: (status) => status < 500,
        });
        if (response.status) working.push(embedUrl);
      } catch {
        // mirror down – ignore
      }
    }),
  );

  // Keep preferred order
  return VIDSRC_MIRRORS.map((base) => `${base}${path}`).filter((url) =>
    working.includes(url),
  );
}

/**
 * GET /api/movie/:tmdbId
 * or GET /movie/:tmdbId
 */
const getMoviePlayer = async (req, res, next) => {
  try {
    const { tmdbId } = req.params;

    if (!tmdbId) {
      throw new AppError("tmdbId is required", 400);
    }

    const { data: details } = await axios.get(
      `https://api.themoviedb.org/3/movie/${tmdbId}`,
      {
        params: {
          api_key: process.env.TMDB_API_KEY,
          language: "en-US",
        },
      },
    );

    const workingEmbeds = await getWorkingEmbeds("movie", tmdbId);
    const embedUrl =
      workingEmbeds[0] || `${VIDSRC_MIRRORS[0]}/embed/movie/${tmdbId}`;

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
        runtime: details.runtime,
        genres: details.genres?.map((g) => g.name) || [],
      },
      player: {
        embedUrl,
        allWorkingEmbeds: workingEmbeds,
        iframeHtml: `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>`,
      },
    });
  } catch (err) {
    // TMDB 404
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

    const { data: details } = await axios.get(
      `https://api.themoviedb.org/3/tv/${tmdbId}`,
      {
        params: {
          api_key: process.env.TMDB_API_KEY,
          language: "en-US",
        },
      },
    );

    const workingEmbeds = await getWorkingEmbeds("tv", tmdbId, season, episode);
    const embedUrl =
      workingEmbeds[0] ||
      (season && episode
        ? `${VIDSRC_MIRRORS[0]}/embed/tv/${tmdbId}/${season}/${episode}`
        : `${VIDSRC_MIRRORS[0]}/embed/tv/${tmdbId}`);

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
        numberOfSeasons: details.number_of_seasons,
        numberOfEpisodes: details.number_of_episodes,
        genres: details.genres?.map((g) => g.name) || [],
      },
      requested: {
        season,
        episode,
      },
      player: {
        embedUrl,
        allWorkingEmbeds: workingEmbeds,
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
