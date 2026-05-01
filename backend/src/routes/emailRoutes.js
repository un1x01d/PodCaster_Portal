import express from "express";
import multer from "multer";
import path from "path";
import { timingSafeEqual } from "crypto";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { uploadRateLimit } from "../middleware/rateLimit.js";
import { ingestEmailAttachment } from "../controllers/sheetController.js";

const router = express.Router();

const allowedExt = new Set([".xlsx", ".xls", ".csv"]);
const allowedMime = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
    "application/octet-stream",
    "text/plain",
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        if (!allowedExt.has(ext)) {
            return cb(new Error("unsupported_file_type"));
        }
        if (!allowedMime.has(file.mimetype)) {
            return cb(new Error("unsupported_file_type"));
        }
        return cb(null, true);
    },
});

function verifyIngestSecret(req, res, next) {
    const expected = String(process.env.EMAIL_INGEST_SHARED_SECRET || "").trim();
    if (!expected) {
        if (process.env.NODE_ENV === "production") {
            return res.status(403).json({ error: "email_ingest_unauthorized" });
        }
        return next();
    }
    const provided = String(
        req.headers["x-email-ingest-secret"]
        || req.headers["x-ingest-secret"]
        || req.query?.ingest_secret
        || ""
    ).trim();
    if (!provided) return res.status(403).json({ error: "email_ingest_unauthorized" });
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return res.status(403).json({ error: "email_ingest_unauthorized" });
    }
    return next();
}

router.post(
    "/email-ingest/inbound",
    uploadRateLimit,
    verifyIngestSecret,
    upload.fields([
        { name: "file", maxCount: 1 },
        { name: "attachment", maxCount: 1 },
    ]),
    asyncHandler(ingestEmailAttachment)
);

export default router;
