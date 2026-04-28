import express from "express";
import {
    listUsers, createUser, updateUser, deleteUser, setDefaultView,
    getGoogleIntegrationSetting, setGoogleIntegrationSetting,
    getGoogleOauthSetting, setGoogleOauthSetting,
    getDropboxIntegrationSetting, setDropboxIntegrationSetting,
    getDropboxOauthSetting, setDropboxOauthSetting,
    getOneDriveIntegrationSetting, setOneDriveIntegrationSetting,
    getOneDriveOauthSetting, setOneDriveOauthSetting,
    getUserGroups,
    listGroups, createGroup, updateGroup, deleteGroup, getGroupMembers, updateGroupMembers, getGroupSheets,
    addUserToGroup, removeUserFromGroup, toggleGroupAdmin,
    listFolders, createFolder, updateFolder, deleteFolder,
    setPermissions, getPermissions, setGroupPermissions, getGroupPermissions,
    getUserKpiOverrides, setUserKpiOverrides
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
router.get("/admin/settings/dropbox-integration", asyncHandler(getDropboxIntegrationSetting));
router.patch("/admin/settings/dropbox-integration", asyncHandler(setDropboxIntegrationSetting));
router.get("/admin/settings/dropbox-oauth", asyncHandler(getDropboxOauthSetting));
router.patch("/admin/settings/dropbox-oauth", asyncHandler(setDropboxOauthSetting));
router.get("/admin/settings/onedrive-integration", asyncHandler(getOneDriveIntegrationSetting));
router.patch("/admin/settings/onedrive-integration", asyncHandler(setOneDriveIntegrationSetting));
router.get("/admin/settings/onedrive-oauth", asyncHandler(getOneDriveOauthSetting));
router.patch("/admin/settings/onedrive-oauth", asyncHandler(setOneDriveOauthSetting));

// Groups
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
router.patch("/folders/:id", asyncHandler(updateFolder));
router.delete("/folders/:id", asyncHandler(deleteFolder));

// Permissions
router.post("/permissions", asyncHandler(setPermissions)); // User perms
router.get("/permissions", asyncHandler(getPermissions));
router.post("/group-permissions", asyncHandler(setGroupPermissions));
router.get("/group-permissions", asyncHandler(getGroupPermissions));
router.get("/users/me/kpi-overrides", asyncHandler(getUserKpiOverrides));
router.put("/users/me/kpi-overrides", asyncHandler(setUserKpiOverrides));

export default router;
