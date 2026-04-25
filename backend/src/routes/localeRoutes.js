import express from "express";
import { auth } from "../middleware/auth.js";
import { translateDashboardCopy } from "../controllers/localeController.js";

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.use(auth);
router.post("/dashboard/translate", asyncHandler(translateDashboardCopy));

export default router;

