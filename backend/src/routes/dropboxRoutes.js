import express from "express";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  getDropboxStatus,
  getDropboxAuthUrl,
  dropboxCallback,
  listDropboxFiles,
  importDropboxFile,
} from "../controllers/dropboxController.js";

const router = express.Router();

router.get("/auth/dropbox/status", asyncHandler(getDropboxStatus));
router.get("/auth/dropbox/url", auth, asyncHandler(getDropboxAuthUrl));
router.get("/auth/dropbox/callback", asyncHandler(dropboxCallback));
router.get("/dropbox/files", auth, asyncHandler(listDropboxFiles));
router.post("/dropbox/import", auth, asyncHandler(importDropboxFile));

export default router;
