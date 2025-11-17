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
function sanitizeName(s = "") {
  return String(s).trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "folder";
}
function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/* ----------------------------------------------------------------------------
 * DB init (idempotent + schema self-heal)
 * ------------------------------------------------------------------------- */
async function initDb() {
  // USERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'producer'
    );
  `);

  // GROUPS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // USER_GROUPS (membership)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_groups (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      group_id INT NOT NULL,
      UNIQUE(user_id, group_id)
    );
  `);

  // FOLDERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      group_id INT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS folders_group_unique
      ON folders (group_id) WHERE group_id IS NOT NULL;
  `);

  // SHEETS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY,
      uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      headers JSONB NOT NULL DEFAULT '[]'::jsonb,
      filename TEXT,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      folder_id INT
    );
  `);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS totals_column TEXT;`);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS stored_path TEXT;`);

  // clean duplicate actives, then re-enforce unique partial index
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sheets'
      ) THEN
        WITH actives AS (
          SELECT id, uploaded_at,
                 ROW_NUMBER() OVER (ORDER BY uploaded_at DESC, id DESC) AS rn
          FROM sheets
          WHERE active = TRUE
        )
        UPDATE sheets s
           SET active = FALSE
          FROM actives a
         WHERE s.id = a.id
           AND a.rn > 1;
      END IF;
    END $$;
  `);
  await pool.query(`DROP INDEX IF EXISTS sheets_one_active_true_idx;`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS sheets_one_active_true_idx
      ON sheets (active) WHERE active;
  `);

  // USER permissions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      user_id INT NOT NULL,
      allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      row_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (sheet_id, user_id)
    );
  `);

  // GROUP permissions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_permissions (
      id SERIAL PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      group_id INT NOT NULL,
      allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      row_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (sheet_id, group_id)
    );
  `);

  // VIEWS (locked)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS views (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sheet_id TEXT NOT NULL,
      config JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INT NOT NULL
    );
  `);
  await pool.query(`ALTER TABLE views ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;`);

  // VIEW permissions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS view_user_permissions (
      id SERIAL PRIMARY KEY,
      view_id INT NOT NULL,
      user_id INT NOT NULL,
      UNIQUE (view_id, user_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS view_group_permissions (
      id SERIAL PRIMARY KEY,
      view_id INT NOT NULL,
      group_id INT NOT NULL,
      UNIQUE (view_id, group_id)
    );
  `);

  // seed admin
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
 * GROUP → SHEETS (group-only association)
 * ------------------------------------------------------------------------- */
app.get("/groups/:id/sheets", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const gid = Number(req.params.id);
  try {
    // Only sheets associated with this group:
    // - in a folder owned by this group, OR
    // - explicitly referenced by group_permissions for this group.
    const rows = await query(
      `SELECT DISTINCT s.id, s.filename, s.uploaded_at, s.folder_id, f.name AS folder_name
         FROM sheets s
         LEFT JOIN folders f ON f.id = s.folder_id
         LEFT JOIN group_permissions gp
                ON gp.sheet_id = s.id
               AND gp.group_id = $1
        WHERE (f.group_id = $1) OR (gp.group_id IS NOT NULL)
        ORDER BY s.uploaded_at DESC`,
      [gid]
    );
    res.json(rows);
  } catch (e) {
    console.error("group sheets failed:", e);
    res.status(500).json({ error: "group_sheets_failed" });
  }
});

/* ----------------------------------------------------------------------------
 * Multer
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
 * Upload
 * ------------------------------------------------------------------------- */
app.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    if (!req.file) return res.status(400).json({ error: "No file" });

    const originalName = req.file.originalname || "uploaded.xlsx";
    const tmpPath = req.file.path;
    const folderId = req.body?.folderId ? parseInt(req.body.folderId, 10) : null;

    console.log(`[upload] name=${originalName} mime=${req.file.mimetype} folderId=${folderId ?? "—"}`);

    let rows = [];
    try {
      const buf = fs.readFileSync(tmpPath);
      const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
      const sn = wb.SheetNames[0];
      if (!sn) throw new Error("no_sheets_buffer");
      rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });
    } catch (eBuf) {
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
          return res.status(422).json({
            error: "html_without_tables",
            message: "This file is HTML without <table>. Re-export as CSV/XLSX or include a table."
          });
        }
        return res.status(400).json({
          error: "unreadable_spreadsheet",
          message: "Could not parse file as CSV/XLSX/XML/HTML-table."
        });
      }
    }

    // Normalize to XLSX buffer
    const wbOut = XLSX.utils.book_new();
    const wsOut = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wbOut, wsOut, "Sheet1");
    const xbuf = XLSX.write(wbOut, { bookType: "xlsx", type: "buffer" });

    // 1) Write the app's current file
    const currentDest = path.join(UPLOADS_DIR, "current.xlsx");
    if (fs.existsSync(currentDest)) fs.unlinkSync(currentDest);
    fs.writeFileSync(currentDest, xbuf);

    // 2) If folderId provided, also persist a copy in that folder; track stored_path
    let assignedFolderId = null;
    let stored_relpath = null;
    if (Number.isInteger(folderId)) {
      const f = await query(
        `SELECT f.id, f.name, g.name AS group_name
           FROM folders f
           LEFT JOIN groups g ON g.id = f.group_id
          WHERE f.id = $1
          LIMIT 1`,
        [folderId]
      );
      if (f.length) {
        assignedFolderId = f[0].id;
        const safeFolderName = sanitizeName(`${f[0].id}-${f[0].name}`);
        const targetDir = path.join(UPLOADS_DIR, "folders", safeFolderName);
        ensureDir(targetDir);
        const stampedName = `${timestamp()}_${sanitizeName(originalName.replace(/\.[^/.]+$/, ""))}.xlsx`;
        const folderDest = path.join(targetDir, stampedName);
        fs.writeFileSync(folderDest, xbuf);
        stored_relpath = path.relative(UPLOADS_DIR, folderDest);
      }
    }

    fs.unlink(tmpPath, () => {});

    const headers = Object.keys(rows[0] || {});
    const sheetId = Date.now().toString();

    await query("UPDATE sheets SET active = FALSE", []);
    await query(
      "INSERT INTO sheets (id, headers, active, filename, folder_id, stored_path) VALUES ($1,$2,$3,$4,$5,$6)",
      [sheetId, JSON.stringify(headers), true, originalName, assignedFolderId, stored_relpath]
    );

    console.log(`[upload] OK sheetId=${sheetId} rows=${rows.length} headers=${headers.length} folder=${assignedFolderId ?? "—"}`);
    res.json({ sheetId, headers, rows: rows.length, active: true, filename: originalName, folderId: assignedFolderId });
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
  const s = await query("SELECT id, headers, filename, totals_column FROM sheets WHERE active = TRUE LIMIT 1", []);
  if (!s.length) return res.json(null);
  res.json({ sheetId: s[0].id, headers: s[0].headers, filename: s[0].filename, totals_column: s[0].totals_column || null });
});

app.get("/sheets/:id", auth, async (req, res) => {
  const s = await query("SELECT id, headers, active, filename, totals_column FROM sheets WHERE id=$1", [req.params.id]);
  if (!s.length) return res.status(404).json({ error: "not_found" });
  res.json(s[0]);
});

// set per-sheet totals column (admin)
app.patch("/sheets/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { totals_column } = req.body || {};
  await query("UPDATE sheets SET totals_column = $1 WHERE id = $2", [totals_column || null, req.params.id]);
  res.json({ success: true });
});

/* ----------------------------------------------------------------------------
 * Views
 * ------------------------------------------------------------------------- */
app.post("/views", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { name, sheetId, config, locked } = req.body || {};
  const r = await query(
    `INSERT INTO views (name, sheet_id, config, created_by, locked)
     VALUES ($1,$2,$3,$4, $5)
     RETURNING id, name, sheet_id, created_at, locked`,
    [name, sheetId, JSON.stringify(config || {}), req.user.id, locked || false]
  );
  res.json(r[0]);
});

app.post("/views/:id/duplicate", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name_required" });

  const [original] = await query("SELECT sheet_id, config FROM views WHERE id = $1", [id]);
  if (!original) return res.status(404).json({ error: "not_found" });

  const [newView] = await query(
    `INSERT INTO views (name, sheet_id, config, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, sheet_id, created_at`,
    [name, original.sheet_id, original.config, req.user.id]
  );
  res.json(newView);
});

app.patch("/views/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const { locked } = req.body || {};
  await query("UPDATE views SET locked = $1 WHERE id = $2", [locked, id]);
  res.json({ success: true });
});

app.get("/views/:sheetId", auth, async (req, res) => {
  const { sheetId } = req.params;
  if (req.user.role === "admin") {
    const rows = await query(
      `SELECT v.id, v.name, v.sheet_id, v.config, v.created_at, v.locked, u.email as created_by
         FROM views v
         JOIN users u ON u.id = v.created_by
        WHERE v.sheet_id = $1
        ORDER BY v.name ASC`,
      [sheetId]
    );
    return res.json(rows);
  }

  const rows = await query(
    `SELECT v.id, v.name, v.sheet_id, v.config, v.created_at, v.locked, u.email as created_by
       FROM views v
       JOIN users u ON u.id = v.created_by
      WHERE v.sheet_id = $1
        AND (
          EXISTS (
            SELECT 1 FROM view_user_permissions WHERE view_id = v.id AND user_id = $2
          ) OR EXISTS (
            SELECT 1 FROM view_group_permissions vgp
             WHERE vgp.view_id = v.id
               AND vgp.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)
          )
        )
      ORDER BY v.name ASC`,
    [sheetId, req.user.id]
  );
  res.json(rows);
});

app.get("/views/locked", auth, async (req, res) => {
  const rows = await query(
    `SELECT v.id, v.name, v.sheet_id, u.email as created_by
       FROM views v
       JOIN users u ON u.id = v.created_by
      WHERE v.locked = TRUE
      ORDER BY v.name ASC`
  );
  res.json(rows);
});

app.delete("/views/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  await query("DELETE FROM views WHERE id = $1", [id]);
  res.json({ success: true });
});

app.get("/views", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const rows = await query(
    `SELECT v.id, v.name, v.sheet_id, u.email as created_by
       FROM views v
       JOIN users u ON u.id = v.created_by
      ORDER BY v.name ASC`
  );
  res.json(rows);
});

app.get("/views/:viewId/permissions", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { viewId } = req.params;
  const users = await query(
    `SELECT u.id, u.email FROM view_user_permissions vup JOIN users u ON u.id = vup.user_id WHERE vup.view_id = $1`,
    [viewId]
  );
  const groups = await query(
    `SELECT g.id, g.name FROM view_group_permissions vgp JOIN groups g ON g.id = vgp.group_id WHERE vgp.view_id = $1`,
    [viewId]
  );
  res.json({ users, groups });
});

app.post("/views/user-permissions", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { viewId, userId } = req.body || {};
  await query(
    `INSERT INTO view_user_permissions (view_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [viewId, userId]
  );
  res.json({ success: true });
});

app.delete("/views/user-permissions/:viewId/:userId", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { viewId, userId } = req.params;
  await query(`DELETE FROM view_user_permissions WHERE view_id = $1 AND user_id = $2`, [
    viewId,
    userId,
  ]);
  res.json({ success: true });
});

app.get("/views/user-permissions/:userId", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { userId } = req.params;
  const rows = await query(
    `SELECT v.id, v.name FROM view_user_permissions vup JOIN views v ON v.id = vup.view_id WHERE vup.user_id = $1`,
    [userId]
  );
  res.json(rows);
});

app.get("/views/group-permissions/:groupId", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { groupId } = req.params;
  const rows = await query(
    `SELECT v.id, v.name FROM view_group_permissions vgp JOIN views v ON v.id = vgp.view_id WHERE vgp.group_id = $1`,
    [groupId]
  );
  res.json(rows);
});

app.post("/views/group-permissions", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { viewId, groupId } = req.body || {};
  await query(
    `INSERT INTO view_group_permissions (view_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [viewId, groupId]
  );
  res.json({ success: true });
});

app.delete("/views/group-permissions/:viewId/:groupId", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { viewId, groupId } = req.params;
  await query(`DELETE FROM view_group_permissions WHERE view_id = $1 AND group_id = $2`, [
    viewId,
    groupId,
  ]);
  res.json({ success: true });
});

/* ----------------------------------------------------------------------------
 * Load a stored sheet -> current.xlsx + set active
 * ------------------------------------------------------------------------- */
app.post("/load-sheet", auth, async (req, res) => {
  try {
    const { sheetId } = req.body || {};
    if (!sheetId) return res.status(400).json({ error: "sheetId_required" });

    const rows = await query(
      `SELECT s.id, s.filename, s.folder_id, s.stored_path, f.name AS folder_name, f.group_id
         FROM sheets s
         LEFT JOIN folders f ON f.id = s.folder_id
        WHERE s.id = $1
        LIMIT 1`,
      [sheetId]
    );
    if (!rows.length) return res.status(404).json({ error: "sheet_not_found" });
    const s = rows[0];

    // Access control: admin OR member of folder's group
    if (req.user.role !== "admin") {
      if (!s.group_id) return res.status(403).json({ error: "forbidden_no_group" });
      const m = await query(
        `SELECT 1 FROM user_groups WHERE user_id = $1 AND group_id = $2 LIMIT 1`,
        [req.user.id, s.group_id]
      );
      if (!m.length) return res.status(403).json({ error: "forbidden" });
    }

    // Resolve stored path (backfill if missing)
    let rel = s.stored_path;
    if (!rel) {
      if (!s.folder_id || !s.folder_name) {
        return res.status(409).json({ error: "no_stored_copy" });
      }
      const safeFolderName = sanitizeName(`${s.folder_id}-${s.folder_name}`);
      const dir = path.join(UPLOADS_DIR, "folders", safeFolderName);
      if (!fs.existsSync(dir)) return res.status(409).json({ error: "folder_dir_missing" });
      const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".xlsx"));
      if (!files.length) return res.status(409).json({ error: "no_xlsx_in_folder" });
      let newest = null;
      let newestTime = -1;
      for (const fn of files) {
        const fp = path.join(dir, fn);
        const st = fs.statSync(fp);
        if (st.mtimeMs > newestTime) { newestTime = st.mtimeMs; newest = fn; }
      }
      rel = path.relative(UPLOADS_DIR, path.join(dir, newest));
      await query(`UPDATE sheets SET stored_path=$1 WHERE id=$2`, [rel, sheetId]);
    }

    const abs = path.join(UPLOADS_DIR, rel);
    if (!fs.existsSync(abs)) return res.status(409).json({ error: "stored_file_missing" });

    const currentDest = path.join(UPLOADS_DIR, "current.xlsx");
    if (fs.existsSync(currentDest)) fs.unlinkSync(currentDest);
    fs.copyFileSync(abs, currentDest);

    await query("UPDATE sheets SET active = FALSE", []);
    await query("UPDATE sheets SET active = TRUE WHERE id = $1", [sheetId]);

    res.json({ success: true, sheetId });
  } catch (e) {
    console.error("load-sheet failed:", e);
    res.status(500).json({ error: "load_failed" });
  }
});

/* ----------------------------------------------------------------------------
 * Data (with user + group permissions)
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
      const userId = req.user.id;
      const sheetId = req.params.sheetId;

      // USER overrides GROUP
      const up = await query(
        "SELECT allowed_columns, row_filters FROM permissions WHERE sheet_id=$1 AND user_id=$2 LIMIT 1",
        [sheetId, userId]
      );
      const userAllowedArr = Array.isArray(up[0]?.allowed_columns)
        ? up[0].allowed_columns
        : (up[0]?.allowed_columns ? JSON.parse(up[0].allowed_columns) : []);
      const userAllowedSet = new Set(userAllowedArr.filter(Boolean));
      const userFiltersObj = typeof up[0]?.row_filters === "object"
        ? (up[0]?.row_filters || {})
        : JSON.parse(up[0]?.row_filters || "{}");

      const userHasCols = userAllowedSet.size > 0;
      const userHasFilter = Object.keys(userFiltersObj).length > 0;

      // Gather group perms
      let groupAllowedSet = new Set();
      let groupFilters = [];
      const gRows = await query(
        `SELECT g.id
           FROM groups g
           JOIN user_groups ug ON ug.group_id = g.id
          WHERE ug.user_id = $1`,
        [userId]
      );
      const groupIds = gRows.map(r => r.id);
      if (groupIds.length) {
        const gp = await query(
          `SELECT allowed_columns, row_filters
             FROM group_permissions
            WHERE sheet_id=$1
              AND group_id = ANY($2::int[])`,
          [sheetId, groupIds]
        );
        for (const r of gp) {
          const ac = Array.isArray(r.allowed_columns) ? r.allowed_columns
            : (r.allowed_columns ? JSON.parse(r.allowed_columns) : []);
          ac.forEach(c => { if (c) groupAllowedSet.add(c); });
          const fObj = typeof r.row_filters === "object" ? (r.row_filters || {}) : JSON.parse(r.row_filters || "{}");
          if (Object.keys(fObj).length) groupFilters.push(fObj);
        }
      }

      // row filters (user overrides)
      if (userHasFilter) {
        rows = rows.filter(row =>
          Object.entries(userFiltersObj).every(([k, v]) => String(row[k] ?? "") === String(v))
        );
      } else if (groupFilters.length) {
        rows = rows.filter(row =>
          groupFilters.every(fobj =>
            Object.entries(fobj).every(([k, v]) => String(row[k] ?? "") === String(v))
          )
        );
      }

      // column restrictions (user overrides)
      if (userHasCols) {
        rows = rows.map(r => {
          const o = {};
          userAllowedSet.forEach(c => { if (c in r) o[c] = r[c]; });
          return o;
        });
      } else if (groupAllowedSet.size > 0) {
        rows = rows.map(r => {
          const o = {};
          groupAllowedSet.forEach(c => { if (c in r) o[c] = r[c]; });
          return o;
        });
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
  await query("DELETE FROM user_groups WHERE user_id=$1", [id]);
  await query("DELETE FROM users WHERE id=$1", [id]);
  res.json({ success: true });
});

/* ----------------------------------------------------------------------------
 * User-level Permissions
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
 * Groups + Membership
 * ------------------------------------------------------------------------- */
app.get("/groups", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  try {
    const rows = await query(`SELECT id, name, created_at FROM groups ORDER BY name ASC`, []);
    res.json(rows);
  } catch (e) {
    console.error("groups list failed:", e);
    res.status(500).json({ error: "groups_list_failed" });
  }
});

app.post("/groups", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "name_required" });
  try {
    const r = await query(
      `INSERT INTO groups (name) VALUES ($1) RETURNING id, name, created_at`,
      [name.trim()]
    );
    res.json(r[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "group_exists" });
    console.error("group create failed:", e);
    res.status(500).json({ error: "group_create_failed" });
  }
});

app.delete("/groups/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const gid = Number(req.params.id);
  await query(`UPDATE folders SET group_id = NULL WHERE group_id = $1`, [gid]);
  await query(`DELETE FROM group_permissions WHERE group_id = $1`, [gid]);
  await query(`DELETE FROM user_groups WHERE group_id = $1`, [gid]);
  await query(`DELETE FROM groups WHERE id = $1`, [gid]);
  res.json({ success: true });
});

app.get("/groups/:id/users", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const gid = Number(req.params.id);
  const rows = await query(
    `SELECT u.id, u.email, u.role
       FROM user_groups ug
       JOIN users u ON u.id = ug.user_id
      WHERE ug.group_id = $1
      ORDER BY u.email ASC`,
    [gid]
  );
  res.json(rows);
});

app.post("/groups/:id/users", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const gid = Number(req.params.id);
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId_required" });
  await query(
    `INSERT INTO user_groups (user_id, group_id)
     VALUES ($1,$2)
     ON CONFLICT (user_id, group_id) DO NOTHING`,
    [userId, gid]
  );
  res.json({ success: true });
});

app.delete("/groups/:id/users/:userId", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const gid = Number(req.params.id);
  const uid = Number(req.params.userId);
  await query(`DELETE FROM user_groups WHERE user_id=$1 AND group_id=$2`, [uid, gid]);
  res.json({ success: true });
});

/* ----------------------------------------------------------------------------
 * Group-level Permissions
 * ------------------------------------------------------------------------- */
app.post("/group-permissions", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { sheetId, groupId, allowed_columns, row_filters } = req.body || {};
  await query(
    `INSERT INTO group_permissions (sheet_id, group_id, allowed_columns, row_filters)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (sheet_id, group_id) DO UPDATE
     SET allowed_columns = EXCLUDED.allowed_columns,
         row_filters = EXCLUDED.row_filters;`,
    [sheetId, groupId, JSON.stringify(allowed_columns || []), JSON.stringify(row_filters || {})]
  );
  res.json({ success: true });
});

app.get("/group-permissions", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { groupId, sheetId } = req.query;
  const rows = await query(
    `SELECT allowed_columns, row_filters
       FROM group_permissions
      WHERE sheet_id=$1 AND group_id=$2
      LIMIT 1`,
    [sheetId, groupId]
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
 * Folders
 * ------------------------------------------------------------------------- */
app.get("/folders", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const rows = await query(
    `SELECT f.id, f.name, f.group_id, g.name AS group_name, f.created_at
       FROM folders f
       LEFT JOIN groups g ON g.id = f.group_id
      ORDER BY f.id ASC`,
    []
  );
  res.json(rows);
});

app.post("/folders", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { name, groupId } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "name_required" });
  try {
    const vals = [name.trim(), groupId ?? null];
    const r = await query(
      `INSERT INTO folders (name, group_id)
       VALUES ($1, $2)
       RETURNING id, name, group_id, created_at`,
      vals
    );
    res.json(r[0]);
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "folder_or_group_conflict" });
    }
    console.error("folder create failed:", e);
    res.status(500).json({ error: "folder_create_failed" });
  }
});

// NEW: update a folder's group association
app.patch("/folders/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const fid = Number(req.params.id);
  const { groupId } = req.body || {};
  try {
    await query(`UPDATE folders SET group_id = $1 WHERE id = $2`, [groupId ?? null, fid]);
    res.json({ success: true });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "folder_or_group_conflict" });
    }
    console.error("folder update failed:", e);
    res.status(500).json({ error: "folder_update_failed" });
  }
});

app.delete("/folders/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const fid = Number(req.params.id);
  await query(`UPDATE sheets SET folder_id = NULL WHERE folder_id = $1`, [fid]);
  await query(`DELETE FROM folders WHERE id = $1`, [fid]);
  res.json({ success: true });
});

/* ----------------------------------------------------------------------------
 * My Files (files visible to the current user)
 * ------------------------------------------------------------------------- */
app.get("/my-files", auth, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      const rows = await query(
        `SELECT s.id, s.filename, s.uploaded_at, f.name AS folder_name
           FROM sheets s
           LEFT JOIN folders f ON f.id = s.folder_id
          ORDER BY s.uploaded_at DESC
          LIMIT 50`,
        []
      );
      return res.json(rows);
    }

    const rows = await query(
      `SELECT s.id, s.filename, s.uploaded_at, f.name AS folder_name
         FROM sheets s
         JOIN folders f ON f.id = s.folder_id
         WHERE f.group_id IN (
           SELECT ug.group_id
             FROM user_groups ug
            WHERE ug.user_id = $1
         )
        ORDER BY s.uploaded_at DESC
        LIMIT 50`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (e) {
    console.error("my-files failed:", e);
    res.status(500).json({ error: "my_files_failed" });
  }
});

/* ----------------------------------------------------------------------------
 * Folder files listing (admin)
 * ------------------------------------------------------------------------- */
app.get("/folders/:id/files", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const fid = Number(req.params.id);
  try {
    const rows = await query(
      `SELECT s.id, s.filename, s.uploaded_at, s.active
         FROM sheets s
        WHERE s.folder_id = $1
        ORDER BY s.uploaded_at DESC`,
      [fid]
    );
    res.json(rows);
  } catch (e) {
    console.error("folder files failed:", e);
    res.status(500).json({ error: "folder_files_failed" });
  }
});

/* ----------------------------------------------------------------------------
 * Delete a sheet (admin) + remove stored file + cleanup
 * ------------------------------------------------------------------------- */
app.delete("/sheets/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const sid = String(req.params.id);
  try {
    const rows = await query(
      `SELECT id, active, stored_path FROM sheets WHERE id = $1 LIMIT 1`,
      [sid]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const s = rows[0];

    // Remove file on disk if exists
    if (s.stored_path) {
      const abs = path.join(UPLOADS_DIR, s.stored_path);
      if (abs.startsWith(UPLOADS_DIR) && fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch {}
      }
    }

    // If active, clear current.xlsx and unset active
    if (s.active) {
      const currentDest = path.join(UPLOADS_DIR, "current.xlsx");
      if (fs.existsSync(currentDest)) {
        try { fs.unlinkSync(currentDest); } catch {}
      }
    }

    // Cleanup permissions
    await query(`DELETE FROM permissions WHERE sheet_id=$1`, [sid]);
    await query(`DELETE FROM group_permissions WHERE sheet_id=$1`, [sid]);
    // Delete sheet
    await query(`DELETE FROM sheets WHERE id=$1`, [sid]);

    res.json({ success: true });
  } catch (e) {
    console.error("delete sheet failed:", e);
    res.status(500).json({ error: "delete_sheet_failed" });
  }
});

/* ----------------------------------------------------------------------------
 * Start
 * ------------------------------------------------------------------------- */
app.listen(4000, () =>
  console.log("✅ Backend running on :4000 • SheetJS:", XLSX?.version || "unknown")
);

