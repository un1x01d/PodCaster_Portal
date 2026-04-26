import express from "express";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  getOneDriveStatus,
  getOneDriveAuthUrl,
  oneDriveCallback,
  listOneDriveFiles,
  importOneDriveFile,
} from "../controllers/onedriveController.js";

const router = express.Router();

router.get("/auth/onedrive/status", asyncHandler(getOneDriveStatus));
router.get("/auth/onedrive/url", auth, asyncHandler(getOneDriveAuthUrl));
router.get("/auth/onedrive/callback", asyncHandler(oneDriveCallback));
router.get("/onedrive/files", auth, asyncHandler(listOneDriveFiles));
router.post("/onedrive/import", auth, asyncHandler(importOneDriveFile));

export default router;

