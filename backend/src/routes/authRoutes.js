import express from "express";
import { login, getMe, changePassword, logout } from "../controllers/authController.js";
import { auth } from "../middleware/auth.js";
import { loginRateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = express.Router();

router.post("/login", loginRateLimit, asyncHandler(login));
router.post("/logout", asyncHandler(logout));
router.get("/me", auth, asyncHandler(getMe));
router.post("/change-password", auth, asyncHandler(changePassword));

export default router;
