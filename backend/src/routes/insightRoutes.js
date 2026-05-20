import express from "express";
import { auth } from "../middleware/auth.js";
import { aiRateLimit, expensiveTenantRateLimit } from "../middleware/rateLimit.js";
import { getInsights, updateInsightSettings } from "../controllers/insightController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = express.Router();

router.use(auth);
router.get("/insights/:sheetId", aiRateLimit, expensiveTenantRateLimit, asyncHandler(getInsights));
router.put("/insights/:sheetId/settings", expensiveTenantRateLimit, asyncHandler(updateInsightSettings));

export default router;
