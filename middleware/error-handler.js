class AppError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function notFoundHandler(req, res, next) {
  next(new AppError(404, "The requested endpoint was not found."));
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err.code === "P2002" && String(err.meta?.target).includes("email")) {
    return res.status(409).json({
      success: false,
      error: "An account with this email address already exists.",
    });
  }
  if (err.code === "P2002") {
    return res.status(409).json({
      success: false,
      error: "A record with these details already exists.",
    });
  }
  if (err.code === "P2025") {
    return res.status(404).json({
      success: false,
      error: "The requested record could not be found.",
    });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      error: "Request body contains invalid JSON.",
    });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error: "Request body is too large.",
    });
  }

  if (err.isAxiosError) {
    if (err.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: "That title was not found.",
      });
    }
    console.error("Upstream error:", err.response?.data || err.message);
    return res.status(502).json({
      success: false,
      error: "An upstream service failed. Please try again.",
    });
  }

  const statusCode = err.statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({
      success: false,
      error: err instanceof AppError
        ? err.message
        : "The request could not be processed.",
    });
  }

  console.error(err);
  return res.status(500).json({
    success: false,
    error: "Something went wrong. Please try again later.",
  });
}

module.exports = { AppError, errorHandler, notFoundHandler };
