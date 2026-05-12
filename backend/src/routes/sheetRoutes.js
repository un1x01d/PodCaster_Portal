import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
    uploadSheet,
    getActiveSheet,
    listMySheets,
    listAllSheets,
    getSheetDetails,
    updateSheetDetails,
    getSheetTabs,
    getSheetData,
    getUniqueValues,
    listReportSources,
    updateReportSourceReviewPolicy,
    updateReportSourceAutosync,
    deleteReportSource,
    getReportSourceImports,
    listImportJobs,
    getImportJob,
    publishReportSourceImport,
    rejectReportSourceImport,
    confirmSheetBusinessClassification,
    updateSheetSemanticProfile,
    deleteSheet,
    getSheetAccountingMappings,
    approveSheetAccountingMapping,
    correctSheetAccountingMapping,
    rejectSheetAccountingMapping
} from "../controllers/sheetController.js";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { uploadRateLimit, expensiveTenantRateLimit } from "../middleware/rateLimit.js";

import { fileURLToPath } from "url";

const UPLOADS_DIR = path.resolve("uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const router = express.Router();
const UPLOAD_FILE_SIZE_LIMIT_MB = Math.max(
    1,
    Number.parseInt(process.env.MAX_UPLOAD_FILE_MB || process.env.MAX_BUFFERED_IMPORT_MB || "50", 10) || 50
);
const allowedExt = new Set([".xlsx", ".xls", ".csv"]);
const allowedMime = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
]);

const upload = multer({
    dest: UPLOADS_DIR,
    limits: { fileSize: UPLOAD_FILE_SIZE_LIMIT_MB * 1024 * 1024 },
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

// All routes here are protected
router.use(auth);

router.post("/upload", uploadRateLimit, expensiveTenantRateLimit, upload.single("file"), asyncHandler(uploadSheet));
router.get("/sheets/active", asyncHandler(getActiveSheet));
router.get("/my-sheets", asyncHandler(listMySheets));
router.get("/sheets/all", asyncHandler(listAllSheets)); // For admin
router.get("/report-sources", asyncHandler(listReportSources));
router.patch("/report-sources/:id/review-policy", asyncHandler(updateReportSourceReviewPolicy));
router.patch("/report-sources/:id/autosync", asyncHandler(updateReportSourceAutosync));
router.delete("/report-sources/:id", asyncHandler(deleteReportSource));
router.get("/report-sources/:id/imports", asyncHandler(getReportSourceImports));
router.get("/import-jobs", asyncHandler(listImportJobs));
router.get("/import-jobs/:id", asyncHandler(getImportJob));
router.post("/report-source-imports/:id/publish", expensiveTenantRateLimit, asyncHandler(publishReportSourceImport));
router.post("/report-source-imports/:id/reject", expensiveTenantRateLimit, asyncHandler(rejectReportSourceImport));
router.get("/sheets/:id", asyncHandler(getSheetDetails));
router.patch("/sheets/:id/business-classification", asyncHandler(confirmSheetBusinessClassification));
router.patch("/sheets/:id/semantic-profile", asyncHandler(updateSheetSemanticProfile));
router.patch("/sheets/:id", asyncHandler(updateSheetDetails));
router.get("/sheets/:id/tabs", asyncHandler(getSheetTabs));
router.get("/sheets/:id/data", asyncHandler(getSheetData));
router.get("/sheets/:id/unique-values", asyncHandler(getUniqueValues));
router.delete("/sheets/:id", asyncHandler(deleteSheet));
router.get("/api/sheets/:id/accounting-mappings", asyncHandler(getSheetAccountingMappings));
router.post("/api/sheets/:id/accounting-mappings/approve", asyncHandler(approveSheetAccountingMapping));
router.post("/api/sheets/:id/accounting-mappings/correct", asyncHandler(correctSheetAccountingMapping));
router.post("/api/sheets/:id/accounting-mappings/reject", asyncHandler(rejectSheetAccountingMapping));

// Legacy/Compatibility alias for /sheets/list logic if needed, but listAllSheets covers it
router.get("/sheets/list", asyncHandler(listAllSheets));

export default router;
