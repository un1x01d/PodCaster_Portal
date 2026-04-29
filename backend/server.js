import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx"; // Used in healthz

import { initDb, query as dbQuery, closeDbPool } from "./src/config/db.js";
import { validateProductionConfig } from "./src/config/runtime.js";
import authRoutes from "./src/routes/authRoutes.js";
import sheetRoutes from "./src/routes/sheetRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import viewRoutes from "./src/routes/viewRoutes.js";
import chatRoutes from "./src/routes/chatRoutes.js";
import insightRoutes from "./src/routes/insightRoutes.js";
import localeRoutes from "./src/routes/localeRoutes.js";
import googleRoutes from "./src/routes/googleRoutes.js";
import dropboxRoutes from "./src/routes/dropboxRoutes.js";
import oneDriveRoutes from "./src/routes/oneDriveRoutes.js";
import { ensureCsrfCookie, csrfProtect } from "./src/middleware/csrf.js";
import { recordHttpRequest, renderPrometheusMetrics } from "./src/utils/metrics.js";

const app = express();
// Force restart
const PORT = process.env.PORT || 4000;

const configErrors = validateProductionConfig();
if (configErrors.length) {
  console.error("Production config validation failed:");
  configErrors.forEach((err) => console.error(`- ${err}`));
  process.exit(1);
}

// CORS – explicit allowlist (H5 fix)
// Set ALLOWED_ORIGINS env var to a comma-separated list for production.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:5173", "http://localhost:4000"];

const corsOpts = {
  origin: (origin, cb) => {
    // Allow server-to-server requests (no Origin header) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-CSRF-Token", "x-csrf-token"],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOpts));
app.options("*", cors(corsOpts));
app.use(express.json());
app.use(ensureCsrfCookie);
app.use(csrfProtect);

app.use((req, res, next) => {
  const requestId = String(req.headers["x-request-id"] || "").trim() || randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
});

// Logging
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - t0;
    const routeLabel = req.route?.path
      ? `${req.baseUrl || ""}${req.route.path}`
      : req.path;
    console.log(`[http] request_id=${req.id} ${req.method} ${req.path} -> ${res.statusCode} (${durationMs}ms)`);
    recordHttpRequest({
      method: req.method,
      route: routeLabel,
      statusCode: res.statusCode,
      durationMs,
    });
  });
  next();
});

// Paths
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/metrics", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderPrometheusMetrics());
});
app.get("/readyz", async (_req, res) => {
  try {
    await dbQuery("SELECT 1", []);
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "db_unavailable" });
  }
});

// Routes
app.use("/auth", authRoutes); // /auth/login, /auth/me, /auth/change-password
app.use("/", sheetRoutes); // /sheets, /upload
app.use("/", userRoutes);  // /users, /groups (customers), /folders, /permissions
app.use("/", viewRoutes);  // /views
app.use("/", chatRoutes);  // /chat/query
app.use("/", insightRoutes); // /insights/:sheetId
app.use("/", localeRoutes); // /dashboard/translate
app.use("/", googleRoutes); // /auth/google/*, /google/drive/files
app.use("/", dropboxRoutes); // /auth/dropbox/*, /dropbox/files
app.use("/", oneDriveRoutes); // /auth/onedrive/*, /onedrive/files

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  if (res.headersSent) {
    return next(err);
  }
  if (err?.message === "unsupported_file_type") {
    return res.status(415).json({ error: "unsupported_file_type" });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file_too_large", maxMB: 100 });
  }
  const isDev = process.env.NODE_ENV !== "production";
  res.status(500).json({
    error: "internal_server_error",
    message: isDev ? err.message : undefined,
    stack: isDev ? err.stack : undefined
  });
});

// Serve frontend in production
const frontendDist = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    // Skip if it's an API call or health check
    if (req.path.startsWith("/auth") || 
        req.path.startsWith("/sheets") || 
        req.path.startsWith("/users") || 
        req.path.startsWith("/groups") || 
        req.path.startsWith("/folders") || 
        req.path.startsWith("/permissions") || 
        req.path.startsWith("/views") || 
        req.path.startsWith("/chat") || 
        req.path.startsWith("/insights") || 
        req.path.startsWith("/dashboard") || 
        req.path.startsWith("/google") || 
        req.path.startsWith("/dropbox") || 
        req.path.startsWith("/onedrive") || 
        req.path.startsWith("/healthz") || 
        req.path.startsWith("/readyz")) {
      return next();
    }
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// Init & Start
try {
  await initDb();
} catch (e) {
  console.error("DB init error", e);
  process.exit(1);
}

const server = app.listen(PORT, () =>
  console.log(`✅ Backend running on :${PORT} • SheetJS:`, XLSX?.version || "unknown")
);

let isShuttingDown = false;
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] received ${signal}, closing server...`);

  const forceTimer = setTimeout(() => {
    console.error("[shutdown] timeout reached, forcing exit");
    process.exit(1);
  }, Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS || "10000", 10));
  forceTimer.unref?.();

  try {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await closeDbPool();
    clearTimeout(forceTimer);
    console.log("[shutdown] completed");
    process.exit(0);
  } catch (err) {
    clearTimeout(forceTimer);
    console.error("[shutdown] failed", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
