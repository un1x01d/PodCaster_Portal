import express from "express";
import multer from "multer";
import path from "path";
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
    getReportSourceImports,
    listImportJobs,
    getImportJob,
    publishReportSourceImport,
    rejectReportSourceImport,
    deleteSheet
} from "../controllers/sheetController.js";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { uploadRateLimit } from "../middleware/rateLimit.js";

import { fileURLToPath } from "url";

const UPLOADS_DIR = path.resolve("uploads");

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
    dest: UPLOADS_DIR,
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

// All routes here are protected
router.use(auth);

router.post("/upload", uploadRateLimit, upload.single("file"), asyncHandler(uploadSheet));
router.get("/sheets/active", asyncHandler(getActiveSheet));
router.get("/my-sheets", asyncHandler(listMySheets));
router.get("/sheets/all", asyncHandler(listAllSheets)); // For admin
router.get("/report-sources", asyncHandler(listReportSources));
router.get("/report-sources/:id/imports", asyncHandler(getReportSourceImports));
router.get("/import-jobs", asyncHandler(listImportJobs));
router.get("/import-jobs/:id", asyncHandler(getImportJob));
router.post("/report-source-imports/:id/publish", asyncHandler(publishReportSourceImport));
router.post("/report-source-imports/:id/reject", asyncHandler(rejectReportSourceImport));
router.get("/sheets/:id", asyncHandler(getSheetDetails));
router.patch("/sheets/:id", asyncHandler(updateSheetDetails));
router.get("/sheets/:id/tabs", asyncHandler(getSheetTabs));
router.get("/sheets/:id/data", asyncHandler(getSheetData));
router.get("/sheets/:id/unique-values", asyncHandler(getUniqueValues));
router.delete("/sheets/:id", asyncHandler(deleteSheet));

// Legacy/Compatibility alias for /sheets/list logic if needed, but listAllSheets covers it
router.get("/sheets/list", asyncHandler(listAllSheets));

export default router;
