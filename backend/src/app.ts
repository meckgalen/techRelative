import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import responseTime from "response-time";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import apiRoutes from "./routes/api.js";

const app = express();

// Hop chain in production: Cloudflare -> host Nginx -> frontend Nginx -> Express.
// The host Nginx restores the visitor IP from Cloudflare's CF-Connecting-IP
// (realip module) and sets X-Forwarded-For to it, overwriting any client value.
// The frontend Nginx appends the host Nginx address it sees. Trusting two
// proxies (frontend Nginx, host Nginx) makes req.ip the visitor's IP.
app.set("trust proxy", 2);

// Security headers. X-Frame-Options, X-Content-Type-Options and Referrer-Policy
// are set once for every response by the frontend Nginx
// (frontend/security-headers.conf), so helmet does not send them.
app.use(
  helmet({
    xFrameOptions: false,
    xContentTypeOptions: false,
    referrerPolicy: false,
  })
);

// CORS — restrict to known origin in production
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: CORS_ORIGIN }));

app.use(compression());
app.use(responseTime());
app.use(express.json({ limit: "1mb" }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// Nginx proxy token validation (skipped if PROXY_TOKEN is not set)
const PROXY_TOKEN = process.env.PROXY_TOKEN;

function proxyAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!PROXY_TOKEN) return next();

  const provided = req.headers["x-proxy-token"];
  if (provided !== PROXY_TOKEN) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

app.use("/api", apiLimiter);
app.use("/api", proxyAuth);
app.use("/api", apiRoutes);

app.get("/health", async (_req, res) => {
  try {
    await mongoose.connection.db!.admin().ping();
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unhealthy", error: "Database unavailable" });
  }
});

export default app;
