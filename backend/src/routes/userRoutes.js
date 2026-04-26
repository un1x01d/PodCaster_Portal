import express from "express";
import {
    listUsers, createUser, updateUser, deleteUser, setDefaultView,
    getGoogleIntegrationSetting, setGoogleIntegrationSetting,
    getGoogleOauthSetting, setGoogleOauthSetting,
    getUserGroups,
    listGroups, createGroup, updateGroup, deleteGroup, getGroupMembers, updateGroupMembers, getGroupSheets,
    addUserToGroup, removeUserFromGroup, toggleGroupAdmin,
    listFolders, createFolder, deleteFolder,
    setPermissions, getPermissions, setGroupPermissions, getGroupPermissions
} from "../controllers/userController.js";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = express.Router();
router.use(auth);

// Users
router.get("/users", asyncHandler(listUsers));
router.get("/users/:id/groups", asyncHandler(getUserGroups));
router.post("/users", asyncHandler(createUser));
router.patch("/users/:id", asyncHandler(updateUser));
router.delete("/users/:id", asyncHandler(deleteUser));
router.put("/users/:userId/default-view", asyncHandler(setDefaultView));
router.get("/admin/settings/google-integration", asyncHandler(getGoogleIntegrationSetting));
router.patch("/admin/settings/google-integration", asyncHandler(setGoogleIntegrationSetting));
router.get("/admin/settings/google-oauth", asyncHandler(getGoogleOauthSetting));
router.patch("/admin/settings/google-oauth", asyncHandler(setGoogleOauthSetting));

// Groups
router.use("/groups", (req, res, next) => {
    console.log(`[debug] Group request: ${req.method} ${req.url}`);
    next();
});
router.post("/groups/:id/users/:userId/admin", asyncHandler(toggleGroupAdmin));
router.get("/groups", asyncHandler(listGroups));
router.post("/groups", asyncHandler(createGroup));
router.patch("/groups/:id", asyncHandler(updateGroup));
router.delete("/groups/:id", asyncHandler(deleteGroup));
router.get("/groups/:id/members", asyncHandler(getGroupMembers));
router.post("/groups/:id/members", asyncHandler(updateGroupMembers));
router.get("/groups/:id/users", asyncHandler(getGroupMembers)); // Alias for frontend compatibility
router.post("/groups/:id/users", asyncHandler(addUserToGroup));
router.delete("/groups/:id/users/:userId", asyncHandler(removeUserFromGroup));
router.get("/groups/:id/sheets", asyncHandler(getGroupSheets));

// Folders
router.get("/folders", asyncHandler(listFolders));
router.post("/folders", asyncHandler(createFolder));
router.delete("/folders/:id", asyncHandler(deleteFolder));

// Permissions
router.post("/permissions", asyncHandler(setPermissions)); // User perms
router.get("/permissions", asyncHandler(getPermissions));
router.post("/group-permissions", asyncHandler(setGroupPermissions));
router.get("/group-permissions", asyncHandler(getGroupPermissions));

export default router;
