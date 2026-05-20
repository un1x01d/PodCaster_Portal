import express from "express";
import { auth } from "../middleware/auth.js";
import { aiRateLimit } from "../middleware/rateLimit.js";
import { translateDashboardCopy } from "../controllers/localeController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = express.Router();

router.use(auth);
router.post("/dashboard/translate", aiRateLimit, asyncHandler(translateDashboardCopy));

export default router;
