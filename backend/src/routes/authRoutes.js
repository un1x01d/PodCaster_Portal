import express from "express";
import {
  login, getMe, changePassword, logout, getInvitationInfo, acceptInvitation,
  verifyTwoFactorLogin, resendTwoFactorSms,
  getTwoFactorStatus, startTotpSetup, enableTotp, startSmsSetup, confirmSmsSetup, disableTwoFactor
} from "../controllers/authController.js";
import { auth } from "../middleware/auth.js";
import { loginRateLimit, invitationAcceptRateLimit, invitationLookupRateLimit, twoFactorRateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { exchangeSamlCode, getSamlLoginUrl, getSamlMetadata, samlAcs } from "../controllers/samlController.js";

const router = express.Router();
const samlFormParser = express.urlencoded({ extended: false, limit: "1mb" });

router.post("/login", loginRateLimit, asyncHandler(login));
router.get("/saml/url", loginRateLimit, asyncHandler(getSamlLoginUrl));
router.get("/saml/metadata", asyncHandler(getSamlMetadata));
router.post("/saml/acs", samlFormParser, asyncHandler(samlAcs));
router.post("/saml/exchange", loginRateLimit, asyncHandler(exchangeSamlCode));
router.post("/logout", asyncHandler(logout));
router.get("/invitations/:token", invitationLookupRateLimit, asyncHandler(getInvitationInfo));
router.post("/invitations/accept", invitationAcceptRateLimit, asyncHandler(acceptInvitation));
router.post("/2fa/verify", twoFactorRateLimit, asyncHandler(verifyTwoFactorLogin));
router.post("/2fa/sms/resend", twoFactorRateLimit, asyncHandler(resendTwoFactorSms));
router.get("/2fa/status", auth, asyncHandler(getTwoFactorStatus));
router.post("/2fa/totp/start", auth, asyncHandler(startTotpSetup));
router.post("/2fa/totp/enable", auth, asyncHandler(enableTotp));
router.post("/2fa/sms/start", auth, asyncHandler(startSmsSetup));
router.post("/2fa/sms/confirm", auth, asyncHandler(confirmSmsSetup));
router.post("/2fa/disable", auth, asyncHandler(disableTwoFactor));
router.get("/me", auth, asyncHandler(getMe));
router.post("/change-password", auth, asyncHandler(changePassword));

export default router;
