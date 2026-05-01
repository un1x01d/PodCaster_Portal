import express from "express";
import multer from "multer";
import path from "path";
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

router.post(
    "/email-ingest/inbound",
    uploadRateLimit,
    upload.fields([
        { name: "file", maxCount: 1 },
        { name: "attachment", maxCount: 1 },
    ]),
    asyncHandler(ingestEmailAttachment)
);

export default router;
