import express from "express";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { chatQuery, getChatAudio } from "../controllers/chatController.js";

const router = express.Router();

router.post("/chat/query", auth, asyncHandler(chatQuery));
router.post("/chat/audio", auth, asyncHandler(getChatAudio));

export default router;

