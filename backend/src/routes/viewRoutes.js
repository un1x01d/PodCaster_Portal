import express from "express";
import {
    createView, duplicateView, listViews, deleteView, getViewsForSheet,
    createViewUserPerm, deleteViewUserPerm, getUserViewPerms,
    createViewGroupPerm, deleteViewGroupPerm, getGroupViewPerms
} from "../controllers/viewController.js";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = express.Router();
router.use(auth);

// View Management
router.get("/views", asyncHandler(listViews)); // For Admin List
router.post("/views", asyncHandler(createView));

// View Permissions (User) — must be before /:sheetId to avoid param collision
router.post("/views/user-permissions", asyncHandler(createViewUserPerm));
router.delete("/views/user-permissions/:viewId/:userId", asyncHandler(deleteViewUserPerm));
router.get("/views/user-permissions/:userId", asyncHandler(getUserViewPerms));

// View Permissions (Group) — must be before /:sheetId to avoid param collision
router.post("/views/group-permissions", asyncHandler(createViewGroupPerm));
router.delete("/views/group-permissions/:viewId/:groupId", asyncHandler(deleteViewGroupPerm));
router.get("/views/group-permissions/:groupId", asyncHandler(getGroupViewPerms));

// Parameterised routes last — these catch any remaining /views/:id patterns
router.post("/views/:id/duplicate", asyncHandler(duplicateView));
router.delete("/views/:id", asyncHandler(deleteView));
router.get("/views/:sheetId", asyncHandler(getViewsForSheet)); // For Dashboard/User

export default router;
