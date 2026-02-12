import express from "express";
import { login, getMe, changePassword } from "../controllers/authController.js";
import { auth } from "../middleware/auth.js";

const router = express.Router();

router.post("/login", login);
router.get("/me", auth, getMe);
router.post("/change-password", auth, changePassword);

export default router;
