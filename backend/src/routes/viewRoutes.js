import express from "express";
import {
    createView, duplicateView, listViews, deleteView, getViewsForSheet,
    createViewUserPerm, deleteViewUserPerm, getUserViewPerms,
    createViewGroupPerm, deleteViewGroupPerm, getGroupViewPerms
} from "../controllers/viewController.js";
import { auth } from "../middleware/auth.js";

const router = express.Router();
router.use(auth);

// View Management
router.get("/views", listViews); // For Admin List
router.post("/views", createView);

// View Permissions (User) — must be before /:sheetId to avoid param collision
router.post("/views/user-permissions", createViewUserPerm);
router.delete("/views/user-permissions/:viewId/:userId", deleteViewUserPerm);
router.get("/views/user-permissions/:userId", getUserViewPerms);

// View Permissions (Group) — must be before /:sheetId to avoid param collision
router.post("/views/group-permissions", createViewGroupPerm);
router.delete("/views/group-permissions/:viewId/:groupId", deleteViewGroupPerm);
router.get("/views/group-permissions/:groupId", getGroupViewPerms);

// Parameterised routes last — these catch any remaining /views/:id patterns
router.post("/views/:id/duplicate", duplicateView);
router.delete("/views/:id", deleteView);
router.get("/views/:sheetId", getViewsForSheet); // For Dashboard/User

export default router;
