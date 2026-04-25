import express from "express";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { chatQuery } from "../controllers/chatController.js";

const router = express.Router();

router.use(auth);
router.post("/chat/query", asyncHandler(chatQuery));

export default router;

