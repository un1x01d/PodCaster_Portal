import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx"; // Used in healthz

import { initDb } from "./src/config/db.js";
import authRoutes from "./src/routes/authRoutes.js";
import sheetRoutes from "./src/routes/sheetRoutes.js";
import userRoutes from "./src/routes/userRoutes.js";
import viewRoutes from "./src/routes/viewRoutes.js";

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
    console.log(`[http] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - t0}ms)`)
  );
  next();
});

// Paths
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Routes
app.use("/auth", authRoutes); // /auth/login, /auth/me, /auth/change-password
app.use("/", sheetRoutes); // /sheets, /upload
app.use("/", userRoutes);  // /users, /groups, /folders, /permissions
app.use("/", viewRoutes);  // /views

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  if (res.headersSent) {
    return next(err);
  }
  const isDev = process.env.NODE_ENV !== "production";
  res.status(500).json({
    error: "internal_server_error",
    // Only expose details in dev — never leak them in production
    message: isDev ? err.message : undefined,
    stack: isDev ? err.stack : undefined
  });
});

// Init & Start
await initDb().catch((e) => console.error("DB init error", e));

app.listen(PORT, () =>
  console.log(`✅ Backend running on :${PORT} • SheetJS:`, XLSX?.version || "unknown")
);
