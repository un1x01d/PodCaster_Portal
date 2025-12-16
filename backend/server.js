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
const PORT = process.env.PORT || 4000;

// Wrappers
const corsOpts = {
  origin: true,
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
app.use("/", authRoutes);  // /login, /me (mounted at root to match legacy /auth/login if explicit, or just /login)
app.use("/auth", authRoutes); // Alias for /auth/login
app.use("/", sheetRoutes); // /sheets, /upload
app.use("/", userRoutes);  // /users, /groups, /folders, /permissions
app.use("/", viewRoutes);  // /views

// Health
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, xlsx: XLSX?.version || "unknown" })
);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({
    error: "internal_server_error",
    message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined
  });
});

// Init & Start
await initDb().catch((e) => console.error("DB init error", e));

app.listen(PORT, () =>
  console.log(`✅ Backend running on :${PORT} • SheetJS:`, XLSX?.version || "unknown")
);
