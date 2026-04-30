import express from "express";
import {
    listUsers, createUser, inviteCustomerUser, listCustomerInvitations, resendCustomerInvitation, revokeCustomerInvitation, updateUser, deleteUser, setDefaultView,
    getGoogleIntegrationSetting, setGoogleIntegrationSetting,
    getGoogleOauthSetting, setGoogleOauthSetting,
    testGoogleOauthSetting,
    getDropboxIntegrationSetting, setDropboxIntegrationSetting,
    getDropboxOauthSetting, setDropboxOauthSetting,
    testDropboxOauthSetting,
    getOneDriveIntegrationSetting, setOneDriveIntegrationSetting,
    getOneDriveOauthSetting, setOneDriveOauthSetting,
    testOneDriveOauthSetting,
    getSsoSetting, setSsoSetting,
    getSmtpSetting, setSmtpSetting,
    getInviteEmailTemplateSetting, setInviteEmailTemplateSetting, previewInviteEmailTemplate,
    getCustomerInvitationPolicy, setCustomerInvitationPolicy,
    getUserGroups,
    listGroups, createGroup, provisionGroupDatabase, updateGroup, deleteGroup, getGroupMembers, updateGroupMembers, getGroupSheets,
    addUserToGroup, removeUserFromGroup, toggleGroupAdmin,
    setPermissions, getPermissions, setReportSourcePermissions, getReportSourcePermissions,
    setGroupPermissions, getGroupPermissions, setReportSourceGroupPermissions, getReportSourceGroupPermissions,
    getUserKpiOverrides, setUserKpiOverrides,
    listAuditLogs
} from "../controllers/userController.js";
import { auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { invitationIssueRateLimit } from "../middleware/rateLimit.js";

const router = express.Router();
router.use(auth);

// Users
router.get("/users", asyncHandler(listUsers));
router.get("/users/:id/groups", asyncHandler(getUserGroups));
router.post("/users", asyncHandler(createUser));
router.post("/users/invitations", invitationIssueRateLimit, asyncHandler(inviteCustomerUser));
router.get("/users/invitations", asyncHandler(listCustomerInvitations));
router.post("/users/invitations/:id/resend", invitationIssueRateLimit, asyncHandler(resendCustomerInvitation));
router.post("/users/invitations/:id/revoke", asyncHandler(revokeCustomerInvitation));
router.patch("/users/:id", asyncHandler(updateUser));
router.delete("/users/:id", asyncHandler(deleteUser));
router.put("/users/:userId/default-view", asyncHandler(setDefaultView));
router.get("/admin/settings/google-integration", asyncHandler(getGoogleIntegrationSetting));
router.patch("/admin/settings/google-integration", asyncHandler(setGoogleIntegrationSetting));
router.get("/admin/settings/google-oauth", asyncHandler(getGoogleOauthSetting));
router.patch("/admin/settings/google-oauth", asyncHandler(setGoogleOauthSetting));
router.post("/admin/settings/google-oauth/test", asyncHandler(testGoogleOauthSetting));
router.get("/admin/settings/dropbox-integration", asyncHandler(getDropboxIntegrationSetting));
router.patch("/admin/settings/dropbox-integration", asyncHandler(setDropboxIntegrationSetting));
router.get("/admin/settings/dropbox-oauth", asyncHandler(getDropboxOauthSetting));
router.patch("/admin/settings/dropbox-oauth", asyncHandler(setDropboxOauthSetting));
router.post("/admin/settings/dropbox-oauth/test", asyncHandler(testDropboxOauthSetting));
router.get("/admin/settings/onedrive-integration", asyncHandler(getOneDriveIntegrationSetting));
router.patch("/admin/settings/onedrive-integration", asyncHandler(setOneDriveIntegrationSetting));
router.get("/admin/settings/onedrive-oauth", asyncHandler(getOneDriveOauthSetting));
router.patch("/admin/settings/onedrive-oauth", asyncHandler(setOneDriveOauthSetting));
router.post("/admin/settings/onedrive-oauth/test", asyncHandler(testOneDriveOauthSetting));
router.get("/admin/settings/sso", asyncHandler(getSsoSetting));
router.patch("/admin/settings/sso", asyncHandler(setSsoSetting));
router.get("/admin/settings/smtp", asyncHandler(getSmtpSetting));
router.patch("/admin/settings/smtp", asyncHandler(setSmtpSetting));
router.get("/admin/settings/invite-email-template", asyncHandler(getInviteEmailTemplateSetting));
router.patch("/admin/settings/invite-email-template", asyncHandler(setInviteEmailTemplateSetting));
router.post("/admin/settings/invite-email-template/preview", asyncHandler(previewInviteEmailTemplate));
router.get("/admin/settings/customer-invitations", asyncHandler(getCustomerInvitationPolicy));
router.patch("/admin/settings/customer-invitations", asyncHandler(setCustomerInvitationPolicy));

// Customers (legacy route names remain /groups for API compatibility)
router.post("/groups/:id/users/:userId/admin", asyncHandler(toggleGroupAdmin));
router.get("/groups", asyncHandler(listGroups));
router.post("/groups", asyncHandler(createGroup));
router.post("/groups/:id/provision-database", asyncHandler(provisionGroupDatabase));
router.patch("/groups/:id", asyncHandler(updateGroup));
router.delete("/groups/:id", asyncHandler(deleteGroup));
router.get("/groups/:id/members", asyncHandler(getGroupMembers));
router.post("/groups/:id/members", asyncHandler(updateGroupMembers));
router.get("/groups/:id/users", asyncHandler(getGroupMembers)); // Alias for frontend compatibility
router.post("/groups/:id/users", asyncHandler(addUserToGroup));
router.delete("/groups/:id/users/:userId", asyncHandler(removeUserFromGroup));
router.get("/groups/:id/sheets", asyncHandler(getGroupSheets));

// Permissions
router.post("/permissions", asyncHandler(setPermissions)); // User perms
router.get("/permissions", asyncHandler(getPermissions));
router.post("/report-source-permissions", asyncHandler(setReportSourcePermissions));
router.get("/report-source-permissions", asyncHandler(getReportSourcePermissions));
router.post("/group-permissions", asyncHandler(setGroupPermissions));
router.get("/group-permissions", asyncHandler(getGroupPermissions));
router.post("/report-source-group-permissions", asyncHandler(setReportSourceGroupPermissions));
router.get("/report-source-group-permissions", asyncHandler(getReportSourceGroupPermissions));
router.get("/users/me/kpi-overrides", asyncHandler(getUserKpiOverrides));
router.put("/users/me/kpi-overrides", asyncHandler(setUserKpiOverrides));
router.get("/audit-logs", asyncHandler(listAuditLogs));

export default router;
