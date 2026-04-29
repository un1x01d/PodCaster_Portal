import express from "express";
import { login, getMe, changePassword, logout, getInvitationInfo, acceptInvitation } from "../controllers/authController.js";
import { auth } from "../middleware/auth.js";
import { loginRateLimit, invitationAcceptRateLimit, invitationLookupRateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = express.Router();

router.post("/login", loginRateLimit, asyncHandler(login));
router.post("/logout", asyncHandler(logout));
router.get("/invitations/:token", invitationLookupRateLimit, asyncHandler(getInvitationInfo));
router.post("/invitations/accept", invitationAcceptRateLimit, asyncHandler(acceptInvitation));
router.get("/me", auth, asyncHandler(getMe));
router.post("/change-password", auth, asyncHandler(changePassword));

export default router;
