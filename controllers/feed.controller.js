const axios = require("axios");
const { AppError } = require("../middleware/error-handler");

const VIDAPI_BASE = "https://vidapi.ru";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";
const BACKDROP_CACHE_TTL_MS = 5 * 60 * 1000;
const backdropCache = new Map();
const backdropPending = new Map();

function getCachedBackdrop(key) {
  const cached = backdropCache.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.createdAt > BACKDROP_CACHE_TTL_MS) {
    backdropCache.delete(key);
    return undefined;
  }
  return cached.value;
}

function setCachedBackdrop(key, value) {
  if (backdropCache.size >= 1000) backdropCache.clear();
  backdropCache.set(key, { value, createdAt: Date.now() });
}

async function resolveBackdrop(item, type) {
  const tmdbId = item.tmdbId || item.tmdb_id || null;
  const imdbId = item.imdbId || item.imdb_id || null;
  const cacheKey = tmdbId
    ? `${type}:tmdb:${tmdbId}`
    : imdbId
      ? `${type}:imdb:${imdbId}`
      : null;

  if (!cacheKey) return { tmdbId, backdrop: null };

  const cached = getCachedBackdrop(cacheKey);
  if (cached !== undefined) return cached;

  const pending = backdropPending.get(cacheKey);
  if (pending) return pending;

  const lookup = (async () => {
    let resolvedTmdbId = tmdbId;
    let backdrop = null;

    try {
      if (!resolvedTmdbId && imdbId && process.env.TMDB_API_KEY) {
        const { data } = await axios.get(
          `${TMDB_BASE}/find/${encodeURIComponent(imdbId)}`,
          {
            params: {
              api_key: process.env.TMDB_API_KEY,
              external_source: "imdb_id",
              language: "en-US",
            },
            timeout: 10000,
          }
        );

        const matches =
          type === "tv" ? data.tv_results || [] : data.movie_results || [];
        resolvedTmdbId = matches[0]?.id || null;
      }

      if (resolvedTmdbId && process.env.TMDB_API_KEY) {
        const { data } = await axios.get(
          `${TMDB_BASE}/${type}/${resolvedTmdbId}`,
          {
            params: {
              api_key: process.env.TMDB_API_KEY,
              language: "en-US",
            },
            timeout: 10000,
          }
        );
        backdrop = data.backdrop_path
          ? `${TMDB_IMAGE_BASE}${data.backdrop_path}`
          : null;
      }
    } catch (_err) {
      // A backdrop failure is non-fatal for feed responses.
    }

    const value = { tmdbId: resolvedTmdbId, backdrop };
    setCachedBackdrop(cacheKey, value);
    if (resolvedTmdbId) {
      setCachedBackdrop(`${type}:tmdb:${resolvedTmdbId}`, value);
    }
    return value;
  })();

  backdropPending.set(cacheKey, lookup);
  try {
    return await lookup;
  } finally {
    backdropPending.delete(cacheKey);
  }
}

async function enrichFeedItems(items, type) {
  const lookups = await Promise.all(
    items.map((item) => resolveBackdrop(item, type))
  );

  return items.map((item, index) => ({
    ...item,
    tmdbId: lookups[index].tmdbId,
    backdrop: lookups[index].backdrop,
  }));
}

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

    const trendingMovies = await enrichFeedItems(
      (moviesRes.data.items || []).slice(0, limit).map(mapVidapiMovie),
      "movie"
    );
    const trendingTv = await enrichFeedItems(
      (tvRes.data.items || []).slice(0, limit).map(mapVidapiTv),
      "tv"
    );

    // Using latest movies also as "popular" for now
    const popularMovies = await enrichFeedItems(
      (moviesRes.data.items || []).slice(0, limit).map(mapVidapiMovie),
      "movie"
    );

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

    const results = await enrichFeedItems(
      (data.items || []).slice(0, limit).map(mapVidapiMovie),
      "movie"
    );

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

    const results = await enrichFeedItems(
      (data.items || []).slice(0, limit).map(mapVidapiTv),
      "tv"
    );

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