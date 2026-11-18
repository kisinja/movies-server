const { AppError } = require("./error-handler");

function rateLimit({
  windowMs,
  max,
  message = "Too many requests. Please try again later.",
}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    if (++entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new AppError(429, message));
    }
    next();
  };
}

module.exports = { rateLimit };
