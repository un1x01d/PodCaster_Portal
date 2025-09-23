// backend/server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import * as XLSX from "xlsx";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ----------------------------------------------------------------------------
 * App / middleware
 * ------------------------------------------------------------------------- */
const app = express();

/* Explicit CORS (preflight handled), tiny access log */
const corsOpts = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204,
};
app.use(cors(corsOpts));
app.options("*", cors(corsOpts));

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () =>
    console.log(`[http] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - t0}ms)`)
  );
  next();
});

app.use(express.json());

/* ----------------------------------------------------------------------------
 * Config
 * ------------------------------------------------------------------------- */
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* ----------------------------------------------------------------------------
 * Paths (ensure before Multer)
 * ------------------------------------------------------------------------- */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const TMP_DIR = path.join(UPLOADS_DIR, "tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

/* ----------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */
async function query(sql, params) {
  const res = await pool.query(sql, params);
  return res.rows;
}
function genTempPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/* ----------------------------------------------------------------------------
 * DB init (idempotent)
 * ------------------------------------------------------------------------- */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'producer'
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY,
      uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      headers JSONB NOT NULL DEFAULT '[]'::jsonb,
      filename TEXT,
      active BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS sheets_one_active_true_idx
      ON sheets (active) WHERE active;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      user_id INT NOT NULL,
      allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      row_filters JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS permissions_uniq
      ON permissions (sheet_id, user_id);
  `);
  await pool.query(`
    INSERT INTO users (email,password,role)
    VALUES ('admin@example.com','admin123','admin')
    ON CONFLICT (email) DO NOTHING;
  `);
}
initDb().catch((e) => console.error("DB init error", e));

/* ----------------------------------------------------------------------------
 * Auth
 * ------------------------------------------------------------------------- */
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const rows = await query("SELECT * FROM users WHERE email=$1 AND password=$2", [email, password]);
  if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });
  const u = rows[0];
  const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, JWT_SECRET);
  res.json({ token });
});

/* ----------------------------------------------------------------------------
 * Health
 * ------------------------------------------------------------------------- */
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, xlsx: XLSX?.version || "unknown" })
);

/* ----------------------------------------------------------------------------
 * Multer (simple: disk to tmp, 100MB limit, no type filter)
 * ------------------------------------------------------------------------- */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_DIR),
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

/* ----------------------------------------------------------------------------
 * Upload (SIMPLE PATH):
 * - Try buffer parse (XLSX/ODS/BIFF).
 * - If fails, try string parse (CSV/XML/HTML <table>).
 * - If still fails and error mentions "Invalid HTML: could not find <table>", return 422.
 * ------------------------------------------------------------------------- */
app.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    if (!req.file) return res.status(400).json({ error: "No file" });

    const originalName = req.file.originalname || "uploaded";
    const tmpPath = req.file.path;

    console.log(`[upload] name=${originalName} mime=${req.file.mimetype}`);

    let rows = [];
    // 1) Buffer parse first (handles real XLSX/ODS/legacy XLS containers)
    try {
      const buf = fs.readFileSync(tmpPath);
      const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
      const sn = wb.SheetNames[0];
      if (!sn) throw new Error("no_sheets_buffer");
      rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });
    } catch (eBuf) {
      // 2) String parse (CSV / SpreadsheetML XML / HTML with <table>)
      try {
        const str = fs.readFileSync(tmpPath, "utf8");
        const wb = XLSX.read(str, { type: "string", cellDates: true });
        const sn = wb.SheetNames[0];
        if (!sn) throw new Error("no_sheets_string");
        rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });
      } catch (eStr) {
        const msg = String(eStr?.message || eBuf?.message || "");
        fs.unlink(tmpPath, () => {});
        if (msg.includes("Invalid HTML: could not find <table>")) {
          console.warn("[upload] html content without tables");
          return res.status(422).json({
            error: "html_without_tables",
            message:
              "This file is an HTML page without <table> elements. Re-export as CSV/XLSX or upload HTML with a <table>."
          });
        }
        console.error("[upload] parse failed:", msg);
        return res.status(400).json({
          error: "unreadable_spreadsheet",
          message: "Could not parse file as CSV/XLSX/XML/HTML-table. Verify the export."
        });
      }
    }

    // Write normalized workbook to uploads/current.xlsx
    const dest = path.join(UPLOADS_DIR, "current.xlsx");
    const wbOut = XLSX.utils.book_new();
    const wsOut = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wbOut, wsOut, "Sheet1");
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    const xbuf = XLSX.write(wbOut, { bookType: "xlsx", type: "buffer" });
    fs.writeFileSync(dest, xbuf);
    fs.unlink(tmpPath, () => {});

    const headers = Object.keys(rows[0] || {});
    const sheetId = Date.now().toString();

    await query("UPDATE sheets SET active = FALSE", []);
    await query(
      "INSERT INTO sheets (id, headers, active, filename) VALUES ($1,$2,$3,$4)",
      [sheetId, JSON.stringify(headers), true, originalName]
    );

    console.log(`[upload] OK sheetId=${sheetId} rows=${rows.length} headers=${headers.length}`);
    res.json({ sheetId, headers, rows: rows.length, active: true, filename: originalName });
  } catch (e) {
    console.error("upload failed:", e);
    if (e?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file_too_large", maxMB: 100 });
    }
    res.status(500).json({ error: "upload_failed", message: String(e?.message || "unknown_error") });
  }
});

/* ----------------------------------------------------------------------------
 * Sheets meta
 * ------------------------------------------------------------------------- */
app.get("/sheets/active", auth, async (_req, res) => {
  const s = await query("SELECT id, headers, filename FROM sheets WHERE active = TRUE LIMIT 1", []);
  if (!s.length) return res.json(null);
  res.json({ sheetId: s[0].id, headers: s[0].headers, filename: s[0].filename });
});

app.get("/sheets/:id", auth, async (req, res) => {
  const s = await query("SELECT id, headers, active, filename FROM sheets WHERE id=$1", [req.params.id]);
  if (!s.length) return res.status(404).json({ error: "not_found" });
  res.json(s[0]);
});

/* ----------------------------------------------------------------------------
 * Data (reads uploads/current.xlsx)
 * ------------------------------------------------------------------------- */
app.get("/data/:sheetId", auth, async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, "current.xlsx");
    if (!fs.existsSync(filePath)) return res.json([]);

    const cbuf = fs.readFileSync(filePath);
    const wb = XLSX.read(cbuf, { type: "buffer", cellDates: true });
    const sn = wb.SheetNames[0];
    let rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });

    if (req.user.role !== "admin") {
      const p = await query(
        "SELECT allowed_columns, row_filters FROM permissions WHERE sheet_id=$1 AND user_id=$2 LIMIT 1",
        [req.params.sheetId, req.user.id]
      );
      if (p.length) {
        const allowed = p[0].allowed_columns ?? [];
        const filters = p[0].row_filters ?? {};
        if (filters && Object.keys(filters).length) {
          const fObj = typeof filters === "object" ? filters : JSON.parse(filters);
          rows = rows.filter((r) =>
            Object.entries(fObj).every(([col, val]) => String(r[col] ?? "") === String(val))
          );
        }
        const cols = Array.isArray(allowed) ? allowed : JSON.parse(allowed || "[]");
        if (cols.length) {
          rows = rows.map((r) => {
            const o = {};
            cols.forEach((c) => { if (c in r) o[c] = r[c]; });
            return o;
          });
        }
      }
    }

    res.json(rows);
  } catch (e) {
    console.error("data fetch failed:", e);
    res.status(500).json({ error: "data_failed" });
  }
});

/* ----------------------------------------------------------------------------
 * Users
 * ------------------------------------------------------------------------- */
app.get("/users", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const users = await query("SELECT id,email,role FROM users ORDER BY id ASC", []);
  res.json(users);
});

app.post("/users", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { email, password, role } = req.body || {};
  await query("INSERT INTO users (email,password,role) VALUES ($1,$2,$3)", [
    email,
    password,
    role || "producer",
  ]);
  res.json({ success: true });
});

app.patch("/users/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const { password, role, reset } = req.body || {};

  let newPassword = password;
  if (reset) newPassword = genTempPassword();

  if (newPassword && role) {
    await query("UPDATE users SET password=$1, role=$2 WHERE id=$3", [newPassword, role, id]);
  } else if (newPassword) {
    await query("UPDATE users SET password=$1 WHERE id=$2", [newPassword, id]);
  } else if (role) {
    await query("UPDATE users SET role=$1 WHERE id=$2", [role, id]);
  } else {
    return res.status(400).json({ error: "No changes provided" });
  }

  res.json({ success: true, newPassword: reset ? newPassword : undefined });
});

app.delete("/users/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  await query("DELETE FROM permissions WHERE user_id=$1", [id]);
  await query("DELETE FROM users WHERE id=$1", [id]);
  res.json({ success: true });
});

/* ----------------------------------------------------------------------------
 * Permissions (upsert)
 * ------------------------------------------------------------------------- */
app.post("/permissions", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { sheetId, userId, allowed_columns, row_filters } = req.body || {};

  await query(
    `INSERT INTO permissions (sheet_id,user_id,allowed_columns,row_filters)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (sheet_id, user_id) DO UPDATE
     SET allowed_columns = EXCLUDED.allowed_columns,
         row_filters = EXCLUDED.row_filters;`,
    [sheetId, userId, JSON.stringify(allowed_columns || []), JSON.stringify(row_filters || {})]
  );

  res.json({ success: true });
});

app.get("/permissions", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { userId, sheetId } = req.query;
  const rows = await query(
    "SELECT allowed_columns, row_filters FROM permissions WHERE sheet_id=$1 AND user_id=$2 LIMIT 1",
    [sheetId, userId]
  );
  if (!rows.length) return res.json({ allowed_columns: [], row_filters: {} });

  const allowed = rows[0].allowed_columns ?? [];
  const filters = rows[0].row_filters ?? {};
  res.json({
    allowed_columns: Array.isArray(allowed) ? allowed : JSON.parse(allowed),
    row_filters: typeof filters === "object" ? filters : JSON.parse(filters),
  });
});

/* ----------------------------------------------------------------------------
 * Start
 * ------------------------------------------------------------------------- */
app.listen(4000, () =>
  console.log("✅ Backend running on :4000 • SheetJS:", XLSX?.version || "unknown")
);

