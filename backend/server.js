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
import emailRoutes from "./src/routes/emailRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import viewRoutes from "./src/routes/viewRoutes.js";
import chatRoutes from "./src/routes/chatRoutes.js";
import insightRoutes from "./src/routes/insightRoutes.js";
import localeRoutes from "./src/routes/localeRoutes.js";
import googleRoutes from "./src/routes/googleRoutes.js";
import dropboxRoutes from "./src/routes/dropboxRoutes.js";
import oneDriveRoutes from "./src/routes/oneDriveRoutes.js";
import { ensureCsrfCookie, csrfProtect } from "./src/middleware/csrf.js";
import { applyBodyParsingMiddleware } from "./src/middleware/bodyParsing.js";
import { recordHttpRequest, renderPrometheusMetrics } from "./src/utils/metrics.js";
import { cleanupOldInvitations } from "./src/utils/invitationLifecycle.js";
import { startImportJobWorker, stopImportJobWorker, startReportSourceAutosyncWorker, stopReportSourceAutosyncWorker } from "./src/controllers/sheetController.js";

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
  exposedHeaders: ["X-DLP-Masked-Columns", "X-Next-Cursor", "X-Has-More", "X-Request-ID"],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOpts));
app.options("*", cors(corsOpts));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' http://localhost:* https: ws://localhost:* wss:",
      "media-src 'self' blob:",
      "form-action 'self'",
    ].join("; ")
  );
  next();
});

applyBodyParsingMiddleware(app, process.env);
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
app.get("/readyz", async (_req, res) => {
  try {
    await dbQuery("SELECT 1", []);
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: "db_unavailable" });
  }
});

app.get("/metrics", async (_req, res) => {
  try {
    const rows = await dbQuery("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", ["metrics_exposure_settings"]);
    const enabled = rows?.[0]?.value?.enabled === true;
    if (!enabled) return res.status(404).send("Not Found");
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return res.status(200).send(renderPrometheusMetrics());
  } catch (err) {
    console.error("[metrics] failed to render", err?.message || err);
    return res.status(500).send("internal_server_error");
  }
});

// Routes
app.use("/auth", authRoutes); // /auth/login, /auth/me, /auth/change-password
app.use("/", sheetRoutes); // /sheets, /upload
app.use("/", emailRoutes); // /email-ingest/inbound
app.use("/", userRoutes);  // /users, /groups (customers), /permissions
app.use("/", viewRoutes);  // /views
app.use("/", chatRoutes);  // /chat/query
app.use("/", insightRoutes); // /insights/:sheetId
app.use("/", localeRoutes); // /dashboard/translate
app.use("/", googleRoutes); // /auth/google/*, /google/drive/files
app.use("/", dropboxRoutes); // /auth/dropbox/*, /dropbox/files
app.use("/", oneDriveRoutes); // /auth/onedrive/*, /onedrive/files

// Global Error Handler
app.use((err, req, res, next) => {
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  const code = String(err?.code || err?.name || "internal_server_error");
  const message = String(err?.message || "internal_server_error").slice(0, 300);
  console.error("[http_error]", {
    request_id: req.id || null,
    method: req.method,
    path: req.path,
    status,
    code,
    message,
  });
  if (res.headersSent) {
    return next(err);
  }
  if (err?.message === "unsupported_file_type") {
    return res.status(415).json({ error: "unsupported_file_type" });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file_too_large", maxMB: 100 });
  }
  if (Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 600) {
    return res.status(err.statusCode).json({
      error: String(err?.message || "request_error"),
      details: err?.details || undefined,
    });
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
        req.path.startsWith("/permissions") || 
        req.path.startsWith("/views") || 
        req.path.startsWith("/chat") || 
        req.path.startsWith("/insights") || 
        req.path.startsWith("/dashboard") || 
        req.path.startsWith("/google") || 
        req.path.startsWith("/dropbox") || 
        req.path.startsWith("/onedrive") || 
        req.path.startsWith("/email-ingest") ||
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

// Starts the in-process DB import worker. Work durability is provided by Postgres job state.
startImportJobWorker();
startReportSourceAutosyncWorker();

const server = app.listen(PORT, () =>
  console.log(`✅ Backend running on :${PORT} • SheetJS:`, XLSX?.version || "unknown")
);

const INVITATION_CLEANUP_INTERVAL_MS = Number.parseInt(process.env.INVITATION_CLEANUP_INTERVAL_MS || `${60 * 60 * 1000}`, 10);
const invitationCleanupTimer = Number.isFinite(INVITATION_CLEANUP_INTERVAL_MS) && INVITATION_CLEANUP_INTERVAL_MS >= 60000
  ? setInterval(async () => {
      try {
        const result = await cleanupOldInvitations();
        if (result.deletedCount > 0) {
          console.log(`[invitation_cleanup] deleted=${result.deletedCount} retention_days=${result.retentionDays}`);
        }
      } catch (err) {
        console.error("[invitation_cleanup] failed", err?.message || err);
      }
    }, INVITATION_CLEANUP_INTERVAL_MS)
  : null;
if (invitationCleanupTimer?.unref) invitationCleanupTimer.unref();

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
    if (invitationCleanupTimer) clearInterval(invitationCleanupTimer);
    // Stop claim loop before closing DB pool to avoid mid-shutdown lease/claim failures.
    await stopReportSourceAutosyncWorker();
    await stopImportJobWorker();
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
