// -----------------------------------------------------------------------------
// Admin Dashboard Backend (Excel/CSV + Auth by Show Content Parent)
// -----------------------------------------------------------------------------
// - Admin can upload + see all data
// - Producers log in, filtered by "Show Content Parent"
// -----------------------------------------------------------------------------

import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import csvParser from "csv-parser";
import cors from "cors";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

const JWT_SECRET = "super-secret-key"; // ⚠️ replace with env var in production

// -----------------------------------------------------------------------------
// User store (replace with DB later)
// -----------------------------------------------------------------------------
const users = [
  {
    id: 1,
    name: "Admin",
    email: "admin@test.com",
    password: bcrypt.hashSync("admin123", 10),
    role: "admin"
  },
  {
    id: 2,
    name: "Jordan Berman",
    email: "jordan@test.com",
    password: bcrypt.hashSync("producer123", 10),
    role: "producer",
    contentParent: "Jordan Berman"
  },
  {
    id: 3,
    name: "Maybe Both LLC",
    email: "maybe@test.com",
    password: bcrypt.hashSync("producer123", 10),
    role: "producer",
    contentParent: "Maybe Both LLC"
  },
  {
    id: 4,
    name: "Lisa Damour, PHD, LLC",
    email: "lisa@test.com",
    password: bcrypt.hashSync("producer123", 10),
    role: "producer",
    contentParent: "Lisa Damour, PHD, LLC"
  }
];

// -----------------------------------------------------------------------------
// Middleware: JWT authentication
// -----------------------------------------------------------------------------
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: "Invalid token" });
  }
}

// -----------------------------------------------------------------------------
// Auth endpoint
// -----------------------------------------------------------------------------
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      contentParent: user.contentParent || null
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({ token });
});

// -----------------------------------------------------------------------------
// Upload data (admin only)
// -----------------------------------------------------------------------------
app.post("/upload", authenticate, upload.single("file"), (req, res) => {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admins only" });

  const filePath = path.resolve(req.file.path);
  const ext = path.extname(req.file.originalname).toLowerCase();
  let rows = [];

  if (ext === ".xlsx" || ext === ".xls") {
    // Parse Excel
    const workbook = xlsx.readFile(filePath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    rows = xlsx.utils.sheet_to_json(sheet, { defval: "", raw: false });
  } else {
    // Parse CSV/TSV (streaming)
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.trim().split(/\r?\n/);
    const separator = raw.includes("\t") ? "\t" : ",";
    const headers = lines[0].split(separator).map((h) => h.trim());
    rows = lines.slice(1).map((line) => {
      const cols = line.split(separator);
      let obj = {};
      headers.forEach((h, i) => {
        obj[h] = cols[i] ?? "";
      });
      return obj;
    });
  }

  fs.unlinkSync(filePath);

  // Store rows in memory (replace with DB later)
  app.locals.data = rows;

  res.json({ success: true, rows: rows.length });
});

// -----------------------------------------------------------------------------
// Get data (admin = all, producer = filtered by Show Content Parent)
// -----------------------------------------------------------------------------
app.get("/data", authenticate, (req, res) => {
  const rows = app.locals.data || [];

  if (req.user.role === "admin") {
    return res.json(rows);
  } else {
    const filtered = rows.filter(
      (r) =>
        r["Show Content Parent"] &&
        r["Show Content Parent"].trim().toLowerCase() ===
          req.user.contentParent.trim().toLowerCase()
    );
    return res.json(filtered);
  }
});

// -----------------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});

