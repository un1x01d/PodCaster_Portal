import express from "express";
import multer from "multer";
import cors from "cors";
import xlsx from "xlsx";
import fs from "fs";
import jwt from "jsonwebtoken";
import { parse } from "csv-parse/sync";

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 4000;
const JWT_SECRET = "supersecret"; // 🔒 replace with env var in production

app.use(cors());
app.use(express.json());

let parsedData = [];

// --- Users (Admin + Producers) ---
const users = [
  { email: "admin@example.com", password: "admin123", role: "admin" },

  { email: "producer1@example.com", password: "producer123", role: "producer", contentParent: "Jordan Berman" },
  { email: "producer2@example.com", password: "producer123", role: "producer", contentParent: "Maybe Both LLC" },
  { email: "producer3@example.com", password: "producer123", role: "producer", contentParent: "Lisa Damour, PHD, LLC" },
  { email: "producer4@example.com", password: "producer123", role: "producer", contentParent: "Your Zen Mama LLC" },
  { email: "producer5@example.com", password: "producer123", role: "producer", contentParent: "Angela Codella" },
];

// --- Auth Middleware ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// --- Header Sanitizer ---
function sanitizeHeader(header, i) {
  if (!header || header.trim() === "") return `Column${i + 1}`;
  return String(header)
    .trim()
    .replace(/\s+/g, "_") // spaces → underscores
    .replace(/[^\w\d_]/g, ""); // remove special chars
}

// --- Login ---
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = users.find((u) => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { email: user.email, role: user.role, contentParent: user.contentParent || null },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
  res.json({ token });
});

// --- Upload File (CSV/XLSX/XLS) ---
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = req.file.path;
  const fileExt = req.file.originalname.split(".").pop().toLowerCase();

  try {
    const fileBuffer = fs.readFileSync(filePath);
    let csvString;

    if (fileExt === "csv") {
      // Directly use CSV
      csvString = fileBuffer.toString("utf8");
    } else if (fileExt === "xlsx" || fileExt === "xls") {
      // Flatten Excel to CSV in-memory
      const workbook = xlsx.read(fileBuffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0]; // always take first sheet
      const sheet = workbook.Sheets[sheetName];
      csvString = xlsx.utils.sheet_to_csv(sheet, { FS: ",", strip: true });
    } else {
      return res.status(400).json({ error: "Unsupported file type" });
    }

    // Parse CSV safely
    let records = parse(csvString, {
      columns: true,
      skip_empty_lines: true,
    });

    // --- Safeguard: reject pivot-style XLSX ---
    if (Object.keys(records[0] || {}).length === 1) {
      return res.status(400).json({
        error:
          "❌ This Excel file only contains 1 column (likely a Pivot Table or filtered export).\n\n" +
          "👉 To fix: open the spreadsheet in Excel or LibreOffice, copy all data, paste as values into a new sheet, " +
          "remove filters/pivots, and then save as either:\n" +
          "   • CSV (UTF-8)\n" +
          "   • or a clean XLSX workbook\n\n" +
          "Then re-upload the file.",
      });
    }

    // Sanitize headers
    const headers = Object.keys(records[0] || {}).map((h, i) =>
      sanitizeHeader(h, i)
    );

    parsedData = records.map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        const originalKey = Object.keys(records[0])[i];
        obj[h] = row[originalKey];
      });
      return obj;
    });

    console.log(`✅ Parsed ${parsedData.length} rows, ${headers.length} columns`);
    console.log("Detected headers:", headers);

    fs.unlinkSync(filePath);

    res.json({
      success: true,
      rows: parsedData.length,
      cols: headers.length,
    });
  } catch (err) {
    console.error("❌ Parse error:", err);
    res.status(500).json({ error: "Failed to parse file" });
  }
});

// --- Get Data ---
app.get("/data", authenticateToken, (req, res) => {
  if (req.user.role === "admin") {
    return res.json(parsedData);
  }

  if (req.user.role === "producer") {
    const headers = Object.keys(parsedData[0] || {});
    const contentParentCol = headers.find(
      (h) => h.trim().toLowerCase() === "show_content_parent".toLowerCase()
    );

    if (!contentParentCol) {
      return res.json([]); // no matching column
    }

    const filtered = parsedData.filter(
      (row) => row[contentParentCol] === req.user.contentParent
    );
    return res.json(filtered);
  }

  res.status(403).json({ error: "Unauthorized" });
});

// --- Start Server ---
app.listen(PORT, () =>
  console.log(`✅ Backend running on http://localhost:${PORT}`)
);

