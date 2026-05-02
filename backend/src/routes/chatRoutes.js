import express from "express";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { aiRateLimit, expensiveTenantRateLimit } from "../middleware/rateLimit.js";
import { chatQuery, getChatAudio } from "../controllers/chatController.js";

const router = express.Router();

router.post("/chat/query", auth, aiRateLimit, expensiveTenantRateLimit, asyncHandler(chatQuery));
router.post("/chat/audio", auth, aiRateLimit, expensiveTenantRateLimit, asyncHandler(getChatAudio));

export default router;
