import express from "express";
import cors from "cors";
import multer from "multer";
import xlsx from "xlsx";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------- helpers ----------
async function query(sql, params) {
  const res = await pool.query(sql, params);
  return res.rows;
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// multer target inside mounted uploads volume
const upload = multer({ dest: path.join(UPLOADS_DIR, "tmp") });

function genTempPassword(len = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ---------- init/migrations ----------
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY,
      uploaded_at TIMESTAMP DEFAULT NOW(),
      headers JSONB
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      sheet_id TEXT,
      user_id INT,
      allowed_columns JSONB,
      row_filters JSONB
    );
  `);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS filename TEXT;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS permissions_uniq ON permissions (sheet_id, user_id);`);

  await pool.query(
    `INSERT INTO users (email,password,role)
     VALUES ('admin@example.com','admin123','admin')
     ON CONFLICT (email) DO NOTHING;`
  );
}
initDb().catch((e) => console.error("DB init error", e));

// ---------- auth ----------
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

// ---------- upload (.xlsx or .csv) ----------
app.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    if (!req.file) return res.status(400).json({ error: "No file" });

    const tmpPath = req.file.path;
    const originalName = req.file.originalname || "uploaded";
    const ext = (originalName.split(".").pop() || "").toLowerCase();

    let rows = [];
    if (ext === "csv") {
      const buf = fs.readFileSync(tmpPath);
      const wb = xlsx.read(buf, { type: "buffer" });
      const sn = wb.SheetNames[0];
      rows = xlsx.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });
    } else {
      const wb = xlsx.readFile(tmpPath, { cellDates: true });
      const sn = wb.SheetNames[0];
      rows = xlsx.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });
    }
    const headers = Object.keys(rows[0] || {});
    const sheetId = Date.now().toString();

    const dest = path.join(UPLOADS_DIR, "current.xlsx");
    if (ext === "csv") {
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.json_to_sheet(rows);
      xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
      xlsx.writeFile(wb, dest);
      fs.unlinkSync(tmpPath);
    } else {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      fs.renameSync(tmpPath, dest);
    }

    await query("UPDATE sheets SET active = FALSE", []);
    await query(
      "INSERT INTO sheets (id, headers, active, filename) VALUES ($1,$2,$3,$4)",
      [sheetId, JSON.stringify(headers), true, originalName]
    );

    res.json({ sheetId, headers, rows: rows.length, active: true, filename: originalName });
  } catch (e) {
    console.error("upload failed:", e);
    res.status(500).json({ error: "upload_failed" });
  }
});

// ---------- sheet meta ----------
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

// ---------- data (reads uploads/current.xlsx) ----------
app.get("/data/:sheetId", auth, async (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, "current.xlsx");
    if (!fs.existsSync(filePath)) return res.json([]);

    const wb = xlsx.readFile(filePath, { cellDates: true });
    const sn = wb.SheetNames[0];
    let rows = xlsx.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });

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
            cols.forEach((c) => {
              if (c in r) o[c] = r[c];
            });
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

// ---------- users ----------
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

// EDIT user (password and/or role), or RESET password
app.patch("/users/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const { password, role, reset } = req.body || {};

  let newPassword = password;
  if (reset) {
    newPassword = genTempPassword();
  }

  if (newPassword && role) {
    await query("UPDATE users SET password=$1, role=$2 WHERE id=$3", [
      newPassword,
      role,
      id,
    ]);
  } else if (newPassword) {
    await query("UPDATE users SET password=$1 WHERE id=$2", [newPassword, id]);
  } else if (role) {
    await query("UPDATE users SET role=$1 WHERE id=$2", [role, id]);
  } else {
    return res.status(400).json({ error: "No changes provided" });
  }

  res.json({ success: true, newPassword: reset ? newPassword : undefined });
});

// DELETE user
app.delete("/users/:id", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  await query("DELETE FROM permissions WHERE user_id=$1", [id]);
  await query("DELETE FROM users WHERE id=$1", [id]);
  res.json({ success: true });
});

// ---------- permissions (upsert by composite) ----------
app.post("/permissions", auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { sheetId, userId, allowed_columns, row_filters } = req.body || {};

  await query(
    `
    INSERT INTO permissions (sheet_id,user_id,allowed_columns,row_filters)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (sheet_id, user_id) DO UPDATE
    SET allowed_columns = EXCLUDED.allowed_columns,
        row_filters = EXCLUDED.row_filters;
  `,
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

app.listen(4000, () => console.log("✅ Backend running on :4000"));

