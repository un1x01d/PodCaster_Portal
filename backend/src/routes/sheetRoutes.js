import express from "express";
import multer from "multer";
import {
    uploadSheet,
    getActiveSheet,
    listMySheets,
    listAllSheets,
    getSheetDetails,
    updateSheetDetails,
    getSheetTabs
} from "../controllers/sheetController.js";
import { auth } from "../middleware/auth.js";

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
});

// All routes here are protected
router.use(auth);

router.post("/upload", upload.single("file"), uploadSheet);
router.get("/sheets/active", getActiveSheet);
router.get("/my-sheets", listMySheets);
router.get("/sheets/all", listAllSheets); // For admin
router.get("/sheets/:id", getSheetDetails);
router.patch("/sheets/:id", updateSheetDetails);
router.get("/sheets/:id/tabs", getSheetTabs);

// Legacy/Compatibility alias for /sheets/list logic if needed, but listAllSheets covers it
router.get("/sheets/list", listAllSheets);

export default router;
