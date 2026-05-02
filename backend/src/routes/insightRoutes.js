import express from "express";
import { auth } from "../middleware/auth.js";
import { aiRateLimit, expensiveTenantRateLimit } from "../middleware/rateLimit.js";
import { getInsightCardAudio, getInsights, updateInsightSettings } from "../controllers/insightController.js";

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.use(auth);
router.get("/insights/:sheetId", aiRateLimit, expensiveTenantRateLimit, asyncHandler(getInsights));
router.post("/insights/:sheetId/audio", expensiveTenantRateLimit, asyncHandler(getInsightCardAudio));
router.put("/insights/:sheetId/settings", expensiveTenantRateLimit, asyncHandler(updateInsightSettings));

export default router;
