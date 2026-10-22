require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const playerRoutes = require("./routes/player.route");
const authRoutes = require("./routes/auth.routes");
const paymentRoutes = require("./routes/payment.routes");
const searchRoutes = require("./routes/search.routes");
const meRoute = require("./routes/me.routes");
const { requireAuth } = require("./middleware/auth");
const { errorHandler, notFoundHandler } = require("./middleware/error-handler");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin:process.env.ALLOWED_ORIGINS
}));
app.use(
  express.json({
    // Paystack signs the exact raw bytes, so keep them for the webhook.
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf-8");
    },
  }),
);
app.use(morgan("dev"));

app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/me", meRoute);
app.use("/api/", playerRoutes);

/* app.get("/api/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user)
      return res.status(404).json({ success: false, error: "Not found." });
    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      subscription: {
        active:
          !!user.subscriptionExpiresAt &&
          user.subscriptionExpiresAt > new Date(),
        expiresAt: user.subscriptionExpiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
}); */

app.get("/", (req, res) => {
  res.json({
    message: "Movie discovery server (KES 30/week via Paystack)",
    endpoints: {
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        me: "GET /api/me",
      },
      payments: {
        initialize: "POST /api/payments/initialize",
        verify: "GET /api/payments/verify/:reference",
        webhook: "POST /api/payments/webhook (Paystack only)",
      },
      search: {
        unified: "GET /api/search?q=Invincible&type=all|movie|tv&limit=10",
        movies: "GET /api/search/movies?q=Avengers&limit=10",
        tv: "GET /api/search/tv?q=Invincible&limit=10",
      },
      player: {
        movie: "GET /api/movie/:tmdbId",
        tv: "GET /api/tv/:tmdbId",
        tvEpisode: "GET /api/tv/:tmdbId?season=1&episode=1",
      },
    },
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
