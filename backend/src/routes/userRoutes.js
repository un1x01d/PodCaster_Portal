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
    getQuickbooksIntegrationSetting, setQuickbooksIntegrationSetting,
    getQuickbooksOauthSetting, setQuickbooksOauthSetting,
    testQuickbooksOauthSetting,
    getSamlSsoSetting, setSamlSsoSetting, testSamlSsoSetting,
    getSsoSetting, setSsoSetting,
    getSmtpSetting, setSmtpSetting,
    getInviteEmailTemplateSetting, setInviteEmailTemplateSetting, previewInviteEmailTemplate,
    getCustomerInvitationPolicy, setCustomerInvitationPolicy,
    getInsightTranslationCacheSetting, setInsightTranslationCacheSetting,
    getDlpSetting, setDlpSetting,
    getMetricsExposureSetting, setMetricsExposureSetting, getMyMetricsExposureSetting,
    getTwoFactorTotpSetting, setTwoFactorTotpSetting,
    getSmsOtpSetting, setSmsOtpSetting,
    getAutosyncPollIntervalSetting, setAutosyncPollIntervalSetting,
    getEmailIngestSetting, setEmailIngestSetting,
    getUserGroups,
    listGroups, createGroup, provisionGroupDatabase, updateGroup, deleteGroup, getGroupMembers, updateGroupMembers, getGroupSheets,
    addUserToGroup, removeUserFromGroup, toggleGroupAdmin,
    getUserKpiOverrides, setUserKpiOverrides,
    listAuditLogs, getAiUsageSummary
} from "../controllers/userController.js";
import {
    getSftpStorageSetting, setSftpStorageSetting, testSftpStorageSetting,
    getGcsStorageSetting, setGcsStorageSetting, testGcsStorageSetting,
    getS3StorageSetting, setS3StorageSetting, testS3StorageSetting,
    getAzureBlobStorageSetting, setAzureBlobStorageSetting, testAzureBlobStorageSetting,
    getStorageProviderStatus, listStorageProviderFiles, importStorageProviderFile,
} from "../controllers/storageController.js";
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
router.get("/admin/settings/quickbooks-integration", asyncHandler(getQuickbooksIntegrationSetting));
router.patch("/admin/settings/quickbooks-integration", asyncHandler(setQuickbooksIntegrationSetting));
router.get("/admin/settings/quickbooks-oauth", asyncHandler(getQuickbooksOauthSetting));
router.patch("/admin/settings/quickbooks-oauth", asyncHandler(setQuickbooksOauthSetting));
router.post("/admin/settings/quickbooks-oauth/test", asyncHandler(testQuickbooksOauthSetting));
router.get("/admin/settings/saml-sso", asyncHandler(getSamlSsoSetting));
router.patch("/admin/settings/saml-sso", asyncHandler(setSamlSsoSetting));
router.post("/admin/settings/saml-sso/test", asyncHandler(testSamlSsoSetting));
router.get("/admin/settings/sso", asyncHandler(getSsoSetting));
router.patch("/admin/settings/sso", asyncHandler(setSsoSetting));
router.get("/admin/settings/smtp", asyncHandler(getSmtpSetting));
router.patch("/admin/settings/smtp", asyncHandler(setSmtpSetting));
router.get("/admin/settings/invite-email-template", asyncHandler(getInviteEmailTemplateSetting));
router.patch("/admin/settings/invite-email-template", asyncHandler(setInviteEmailTemplateSetting));
router.post("/admin/settings/invite-email-template/preview", asyncHandler(previewInviteEmailTemplate));
router.get("/admin/settings/customer-invitations", asyncHandler(getCustomerInvitationPolicy));
router.patch("/admin/settings/customer-invitations", asyncHandler(setCustomerInvitationPolicy));
router.get("/admin/settings/insight-translation-cache", asyncHandler(getInsightTranslationCacheSetting));
router.patch("/admin/settings/insight-translation-cache", asyncHandler(setInsightTranslationCacheSetting));
router.get("/admin/settings/dlp", asyncHandler(getDlpSetting));
router.patch("/admin/settings/dlp", asyncHandler(setDlpSetting));
router.get("/admin/settings/metrics-exposure", asyncHandler(getMetricsExposureSetting));
router.patch("/admin/settings/metrics-exposure", asyncHandler(setMetricsExposureSetting));
router.get("/admin/settings/two-factor-totp", asyncHandler(getTwoFactorTotpSetting));
router.patch("/admin/settings/two-factor-totp", asyncHandler(setTwoFactorTotpSetting));
router.get("/admin/settings/sms-otp", asyncHandler(getSmsOtpSetting));
router.patch("/admin/settings/sms-otp", asyncHandler(setSmsOtpSetting));
router.get("/admin/settings/autosync-interval", asyncHandler(getAutosyncPollIntervalSetting));
router.patch("/admin/settings/autosync-interval", asyncHandler(setAutosyncPollIntervalSetting));
router.get("/admin/settings/email-ingest", asyncHandler(getEmailIngestSetting));
router.patch("/admin/settings/email-ingest", asyncHandler(setEmailIngestSetting));
router.get("/admin/settings/sftp-storage", asyncHandler(getSftpStorageSetting));
router.patch("/admin/settings/sftp-storage", asyncHandler(setSftpStorageSetting));
router.post("/admin/settings/sftp-storage/test", asyncHandler(testSftpStorageSetting));
router.get("/admin/settings/gcs-storage", asyncHandler(getGcsStorageSetting));
router.patch("/admin/settings/gcs-storage", asyncHandler(setGcsStorageSetting));
router.post("/admin/settings/gcs-storage/test", asyncHandler(testGcsStorageSetting));
router.get("/admin/settings/s3-storage", asyncHandler(getS3StorageSetting));
router.patch("/admin/settings/s3-storage", asyncHandler(setS3StorageSetting));
router.post("/admin/settings/s3-storage/test", asyncHandler(testS3StorageSetting));
router.get("/admin/settings/azure-blob-storage", asyncHandler(getAzureBlobStorageSetting));
router.patch("/admin/settings/azure-blob-storage", asyncHandler(setAzureBlobStorageSetting));
router.post("/admin/settings/azure-blob-storage/test", asyncHandler(testAzureBlobStorageSetting));
router.get("/storage/:provider/status", asyncHandler(getStorageProviderStatus));
router.get("/storage/:provider/files", asyncHandler(listStorageProviderFiles));
router.post("/storage/:provider/import", asyncHandler(importStorageProviderFile));

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

router.get("/users/me/kpi-overrides", asyncHandler(getUserKpiOverrides));
router.put("/users/me/kpi-overrides", asyncHandler(setUserKpiOverrides));
router.get("/users/me/metrics-exposure", asyncHandler(getMyMetricsExposureSetting));
router.get("/audit-logs", asyncHandler(listAuditLogs));
router.get("/admin/ai-usage-summary", asyncHandler(getAiUsageSummary));

export default router;
