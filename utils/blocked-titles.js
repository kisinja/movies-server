const prisma = require("../lib/prisma");

const CACHE_TTL_MS = 60 * 1000;
let cached = null;
let cachedAt = 0;
let pendingLoad = null;
let cacheVersion = 0;

async function getBlockedTitleSet() {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  if (pendingLoad && pendingLoad.version === cacheVersion) {
    return pendingLoad.promise;
  }

  const version = cacheVersion;
  const entry = { version, promise: null };
  entry.promise = prisma.blockedTitle
    .findMany({ select: { type: true, tmdbId: true } })
    .then((titles) => {
      const blocked = new Set(titles.map(({ type, tmdbId }) => `${type}:${tmdbId}`));
      if (version === cacheVersion) {
        cached = blocked;
        cachedAt = Date.now();
      }
      return blocked;
    })
    .finally(() => {
      if (pendingLoad === entry) pendingLoad = null;
    });
  pendingLoad = entry;

  return entry.promise;
}

async function isTitleBlocked(type, tmdbId) {
  const blocked = await getBlockedTitleSet();
  return blocked.has(`${type}:${Number(tmdbId)}`);
}

function clearBlockedTitleCache() {
  cacheVersion += 1;
  cached = null;
  cachedAt = 0;
  pendingLoad = null;
}

module.exports = {
  getBlockedTitleSet,
  isTitleBlocked,
  clearBlockedTitleCache,
};
