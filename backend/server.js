import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx"; // Used in healthz

import { initDb, query as dbQuery } from "./src/config/db.js";
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

const app = express();
// Force restart
const PORT = process.env.PORT || 4000;

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
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOpts));
app.options("*", cors(corsOpts));
app.use(express.json());

// Logging
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () =>
    console.log(`[http] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - t0}ms)`)
  );
  next();
});

// Paths
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Routes
app.use("/auth", authRoutes); // /auth/login, /auth/me, /auth/change-password
app.use("/", sheetRoutes); // /sheets, /upload
app.use("/", userRoutes);  // /users, /groups, /folders, /permissions
app.use("/", viewRoutes);  // /views
app.use("/", chatRoutes);  // /chat/query
app.use("/", insightRoutes); // /insights/:sheetId
app.use("/", localeRoutes); // /dashboard/translate
app.use("/", googleRoutes); // /auth/google/*, /google/drive/files
app.use("/", dropboxRoutes); // /auth/dropbox/*, /dropbox/files
app.use("/", oneDriveRoutes); // /auth/onedrive/*, /onedrive/files

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

app.listen(PORT, () =>
  console.log(`✅ Backend running on :${PORT} • SheetJS:`, XLSX?.version || "unknown")
);
