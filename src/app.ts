import express from "express";
import cors from "cors";
import type { CorsOptions } from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import routes from "./routes/index.js";
import { requestLogger, errorHandler } from "./middleware/logging.js";

dotenv.config();

const app = express();

// Behind a reverse proxy (Render/NGINX/etc.) so req.ip reflects the real client
// (X-Forwarded-For) for rate limiting and audit logging.
app.set("trust proxy", 1);

// CORS: restrict to an explicit allowlist when CORS_ORIGINS is configured
// (comma-separated). Falls back to reflecting any origin if unset so local/dev
// keeps working — set CORS_ORIGINS in production.
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin:
    allowedOrigins.length > 0
      ? (origin, cb) => {
          // Allow same-origin / non-browser callers (no Origin header).
          if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
          return cb(new Error("Not allowed by CORS"));
        }
      : true,
};
app.use(cors(corsOptions));

// Baseline security headers (no extra dependency).
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
});

app.use(express.json({ limit: "2mb" }));

// Log customizado para debug
app.use(requestLogger);

// Morgan para log padrão
app.use(morgan("dev"));

app.use("/api", routes);

// Error handler deve ser o último middleware
app.use(errorHandler);

export default app;
