import express from "express";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { aiRateLimit, expensiveTenantRateLimit } from "../middleware/rateLimit.js";
import { getChatAudio, submitChatLearningFeedback } from "../controllers/chatController.js";
import { chatQueryV3 } from "../controllers/chatQueryV3Controller.js";

const router = express.Router();

router.post("/chat/query", auth, aiRateLimit, expensiveTenantRateLimit, asyncHandler(chatQueryV3));
router.post("/chat/audio", auth, aiRateLimit, expensiveTenantRateLimit, asyncHandler(getChatAudio));
router.post("/chat/feedback", auth, asyncHandler(submitChatLearningFeedback));

export default router;
