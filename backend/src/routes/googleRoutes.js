import express from "express";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getGoogleStatus, getGoogleLoginUrl, googleCallback, exchangeGoogleCode, listGoogleDriveFiles, importGoogleDriveFile } from "../controllers/googleController.js";

const router = express.Router();

router.get("/auth/google/url", asyncHandler(getGoogleLoginUrl));
router.get("/auth/google/callback", asyncHandler(googleCallback));
router.post("/auth/google/exchange", asyncHandler(exchangeGoogleCode));
router.get("/auth/google/status", auth, asyncHandler(getGoogleStatus));
router.get("/google/drive/files", auth, asyncHandler(listGoogleDriveFiles));
router.post("/google/drive/import", auth, asyncHandler(importGoogleDriveFile));

export default router;
