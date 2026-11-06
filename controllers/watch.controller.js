const { AppError } = require("../middleware/error-handler");

const VIDAPI_BASE = "https://vaplayer.ru";

/**
 * Build embed URL with optional customization
 */
function buildEmbedUrl(path, options = {}) {
  const params = new URLSearchParams();

  if (options.primaryColor) {
    params.set("primaryColor", options.primaryColor.replace("#", ""));
  }
  if (options.secondaryColor) {
    params.set("secondaryColor", options.secondaryColor.replace("#", ""));
  }
  if (options.autoplay !== undefined) {
    params.set("autoplay", options.autoplay ? "1" : "0");
  }
  if (options.title !== undefined) {
    params.set("title", options.title ? "true" : "false");
  }
  if (options.poster !== undefined) {
    params.set("poster", options.poster ? "true" : "false");
  }
  if (options.lang) {
    params.set("lang", options.lang); // e.g. "en", "es", "fr"
  }

  const query = params.toString() ? `?${params.toString()}` : "";
  return `${VIDAPI_BASE}${path}${query}`;
}

/**
 * GET /api/watch/movie/:id
 * id can be TMDB or IMDB (tt...)
 */
const getMovieEmbed = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) throw new AppError("Missing movie id", 400);

    const options = {
      primaryColor: req.query.primaryColor,
      secondaryColor: req.query.secondaryColor,
      autoplay: req.query.autoplay === "1" || req.query.autoplay === "true",
      title: req.query.title !== "false",
      poster: req.query.poster !== "false",
      lang: req.query.lang,
    };

    const embedUrl = buildEmbedUrl(`/embed/movie/${id}`, options);

    res.json({
      success: true,
      type: "movie",
      id,
      embedUrl,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/watch/tv/:id/:season/:episode
 */
const getTvEmbed = async (req, res, next) => {
  try {
    const { id, season, episode } = req.params;
    if (!id || !season || !episode) {
      throw new AppError("Missing id, season or episode", 400);
    }

    const options = {
      primaryColor: req.query.primaryColor,
      secondaryColor: req.query.secondaryColor,
      autoplay: req.query.autoplay === "1" || req.query.autoplay === "true",
      title: req.query.title !== "false",
      poster: req.query.poster !== "false",
      lang: req.query.lang,
    };

    const embedUrl = buildEmbedUrl(
      `/embed/tv/${id}/${season}/${episode}`,
      options
    );

    res.json({
      success: true,
      type: "tv",
      id,
      season: Number(season),
      episode: Number(episode),
      embedUrl,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getMovieEmbed,
  getTvEmbed,
};