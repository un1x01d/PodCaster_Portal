import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
test("business type detection is runtime configurable and confirmed per sheet", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const runtimePath = path.join(repoRoot, "backend", "src", "utils", "aiRuntimeSettings.js");
  const classifierPath = path.join(repoRoot, "backend", "src", "utils", "businessClassification.js");
  const sheetControllerPath = path.join(repoRoot, "backend", "src", "controllers", "sheetController.js");
  const sheetRoutesPath = path.join(repoRoot, "backend", "src", "routes", "sheetRoutes.js");
  const dbPath = path.join(repoRoot, "backend", "src", "config", "db.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "components", "admin", "IntegrationSettingsPanel.jsx");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");
  const dashboardBodyPath = path.join(repoRoot, "frontend", "src", "components", "dashboard", "DashboardBody.jsx");
  const storageImportPickerPath = path.join(repoRoot, "frontend", "src", "components", "common", "StorageImportPicker.jsx");
  const envPath = path.join(repoRoot, ".env.example");

  const runtimeSource = fs.readFileSync(runtimePath, "utf8");
  const classifierSource = fs.readFileSync(classifierPath, "utf8");
  const sheetSource = fs.readFileSync(sheetControllerPath, "utf8");
  const sheetRoutesSource = fs.readFileSync(sheetRoutesPath, "utf8");
  const dbSource = fs.readFileSync(dbPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const appSource = fs.readFileSync(appPath, "utf8");
  const dashboardBodySource = fs.readFileSync(dashboardBodyPath, "utf8");
  const storageImportPickerSource = fs.readFileSync(storageImportPickerPath, "utf8");
  const env = fs.readFileSync(envPath, "utf8");

  assert.match(runtimeSource, /businessClassificationEnabled: false/);
  assert.match(runtimeSource, /businessClassificationModel/);
  assert.match(runtimeSource, /businessClassificationApplyUploads/);
  assert.match(runtimeSource, /businessClassificationApplyEmailIngest/);
  assert.match(runtimeSource, /businessClassificationApplyAutosync/);
  assert.match(runtimeSource, /businessClassificationMaxSampleRows/);
  assert.match(classifierSource, /export async function classifySheetBusinessContext/);
  assert.match(classifierSource, /sourceKindEnabled\(runtime, sourceKind\)/);
  assert.match(classifierSource, /responseFormat: \{ type: "json_object" \}/);
  assert.match(classifierSource, /isBusinessData/);
  assert.match(classifierSource, /Prefer a specific sheet\/business type over a broad domain/);
  assert.match(classifierSource, /Advertising Performance/);
  assert.match(classifierSource, /Sales Performance/);
  assert.match(classifierSource, /Lead Generation Performance/);
  assert.match(dbSource, /ALTER TABLE sheets ADD COLUMN IF NOT EXISTS business_classification JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(dbSource, /ALTER TABLE sheets ADD COLUMN IF NOT EXISTS business_classification_status TEXT NOT NULL DEFAULT 'none'/);
  assert.doesNotMatch(dbSource, /ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS business_classification JSONB/);
  assert.match(sheetSource, /classifyAndPersistBusinessContext/);
  assert.match(sheetSource, /carryForwardBusinessClassificationIfPrompted/);
  assert.match(sheetSource, /already_prompted/);
  assert.match(sheetSource, /promptSuppressed: true/);
  assert.match(sheetSource, /business_classification = \$2::jsonb/);
  assert.match(sheetSource, /business_classification_status = 'pending'/);
  assert.match(sheetSource, /export async function confirmSheetBusinessClassification/);
  assert.match(sheetSource, /business_classification_status = \$3/);
  assert.match(sheetSource, /classificationSourceKind: "email_ingest"/);
  assert.match(sheetSource, /classificationSourceKind: "autosync"/);
  assert.match(sheetSource, /classificationSourceKind: autosyncConfig\?\.enabled \? "autosync" : "manual_upload"/);
  assert.match(sheetSource, /s\.business_classification/);
  assert.doesNotMatch(sheetSource, /rs\.business_classification/);
  assert.match(sheetRoutesSource, /router\.patch\("\/sheets\/:id\/business-classification", asyncHandler\(confirmSheetBusinessClassification\)\)/);
  assert.match(appSource, /Confirm Sheet Type/);
  assert.match(appSource, /maybePromptBusinessClassification\(res\.data\)/);
  assert.match(appSource, /answerBusinessClassificationPrompt\(true\)/);
  assert.match(appSource, /answerBusinessClassificationPrompt\(false\)/);
  assert.doesNotMatch(appSource, /setFolderFiles/);
  assert.match(dashboardBodySource, /const getLabelOptionsForSource = React\.useCallback/);
  assert.match(dashboardBodySource, /reportSourceImports\?\.\[String\(sourceId\)\]/);
  assert.match(dashboardBodySource, /CREATE_NEW_LABEL_VALUE/);
  assert.match(dashboardBodySource, /label: "Create new label"/);
  assert.match(dashboardBodySource, /selectedReportSourceId && labelOptions\.length > 0/);
  assert.doesNotMatch(dashboardBodySource, /labelOptions\.length > 1/);
  assert.match(storageImportPickerSource, /selectedReportSourceId && labelOptions\.length > 0/);
  assert.match(storageImportPickerSource, /CREATE_NEW_LABEL_VALUE/);
  assert.match(uiSource, /Business Type Detection Enabled/);
  assert.match(uiSource, /businessClassificationModel/);
  assert.match(uiSource, /businessClassificationApplyEmailIngest/);
  assert.match(env, /OPENAI_BUSINESS_CLASSIFICATION_MODEL=gpt-5-nano/);
});

test("business type detection refines generic marketing labels for ad and sales sheets", async () => {
  const mod = await import(`../src/utils/businessClassification.js?t=${Date.now()}_marketing_refine`);
  const refineBusinessType = mod.__businessClassificationTestHooks?.refineBusinessType;
  assert.equal(typeof refineBusinessType, "function");

  assert.equal(
    refineBusinessType("Marketing Performance", {
      headers: ["Campaign", "Ad Spend", "Impressions", "Clicks", "CTR", "ROAS"],
    }),
    "Advertising Performance"
  );
  assert.equal(
    refineBusinessType("Marketing Performance", {
      headers: ["Lead Source", "MQL", "SQL", "CPL", "Form Fills"],
    }),
    "Lead Generation Performance"
  );
  assert.equal(
    refineBusinessType("Marketing Analytics", {
      headers: ["Campaign", "Ad Spend", "Revenue", "Orders", "Conversion Rate"],
    }),
    "Advertising and Sales Performance"
  );
});

test("sheet semantic profiles are generated, stored, learned, and used by chat", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const profilePath = path.join(repoRoot, "backend", "src", "utils", "sheetSemanticProfile.js");
  const sheetControllerPath = path.join(repoRoot, "backend", "src", "controllers", "sheetController.js");
  const chatControllerPath = path.join(repoRoot, "backend", "src", "controllers", "chatController.js");
  const sheetRoutesPath = path.join(repoRoot, "backend", "src", "routes", "sheetRoutes.js");
  const dbPath = path.join(repoRoot, "backend", "src", "config", "db.js");

  const profileSource = fs.readFileSync(profilePath, "utf8");
  const sheetSource = fs.readFileSync(sheetControllerPath, "utf8");
  const chatSource = fs.readFileSync(chatControllerPath, "utf8");
  const routesSource = fs.readFileSync(sheetRoutesPath, "utf8");
  const dbSource = fs.readFileSync(dbPath, "utf8");

  assert.match(dbSource, /ALTER TABLE sheets ADD COLUMN IF NOT EXISTS semantic_profile JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(dbSource, /ALTER TABLE sheets ADD COLUMN IF NOT EXISTS semantic_profile_updated_at TIMESTAMP/);
  assert.match(profileSource, /export function buildSheetSemanticProfile/);
  assert.match(profileSource, /export function resolveProfileMetric/);
  assert.match(profileSource, /export function resolveProfileDimension/);
  assert.match(profileSource, /export function mergeSheetSemanticProfileLearning/);
  assert.match(profileSource, /SEMANTIC_PROFILE_RULES_SETTINGS_KEY = "semantic_profile_rules"/);
  assert.match(profileSource, /export async function loadSemanticProfileRules/);
  assert.match(profileSource, /export function normalizeSemanticProfileRules/);
  assert.match(profileSource, /serviceLine/);
  assert.match(profileSource, /valueSemantics/);
  assert.doesNotMatch(profileSource, /SERVICE_LINE_RECURRING_PATTERN/);
  assert.doesNotMatch(profileSource, /SERVICE_LINE_PROJECT_PATTERN/);
  assert.match(profileSource, /serviceLineColumn/);
  assert.match(profileSource, /revenueModelColumn/);
  assert.match(dbSource, /SEMANTIC_PROFILE_RULES_SETTINGS_KEY/);
  assert.match(dbSource, /DEFAULT_SEMANTIC_PROFILE_RULES/);
  assert.match(sheetSource, /const semanticRules = await loadSemanticProfileRules\(\)/);
  assert.match(sheetSource, /buildSheetSemanticProfile\(\{ headers, sampleRows: firstTabRowsRaw, rules: semanticRules \}\)/);
  assert.match(sheetSource, /semantic_profile, semantic_profile_updated_at/);
  assert.match(sheetSource, /semantic_profile: semanticProfile/);
  assert.match(sheetSource, /export async function updateSheetSemanticProfile/);
  assert.match(sheetSource, /sanitizeSemanticProfileDefaults/);
  assert.match(sheetSource, /mergeSheetSemanticProfileLearning/);
  assert.match(sheetSource, /semantic_profile = \$2::jsonb/);
  assert.match(sheetSource, /semantic_profile_updated_at = CURRENT_TIMESTAMP/);
  assert.match(routesSource, /router\.patch\("\/sheets\/:id\/semantic-profile", asyncHandler\(updateSheetSemanticProfile\)\)/);
  assert.match(chatSource, /import \{\s+buildSheetSemanticProfile,\s+resolveProfileDateColumn,\s+resolveProfileDimension,\s+resolveProfileMetric,/);
  assert.match(chatSource, /restrictSemanticProfileToHeaders\(loadedSample\.semanticProfile, aiHeaders, scopedSampleRows\)/);
  assert.match(chatSource, /semantic_profile: compactSemanticProfileForPrompt\(semanticProfile\)/);
  assert.match(chatSource, /SELECT headers, tabs, tab_name, semantic_profile FROM sheets WHERE id = \$1/);
  assert.match(chatSource, /semanticProfile: sheet\.semantic_profile \|\| \{\}/);
  assert.match(chatSource, /semanticProfile,/);
});

test("semantic profile treats Service Line as a PSA operating dimension with revenue model groups", async () => {
  const mod = await import(`../src/utils/sheetSemanticProfile.js?t=${Date.now()}_service_line`);
  const rules = mod.normalizeSemanticProfileRules({
    meanings: {
      serviceLine: { headerPatterns: ["\\b(line\\s*of\\s*work|service\\s*line)\\b"] },
    },
    valueSemantics: {
      revenueModel: {
        recurring: ["\\b(saas|subscription|maintenance|retained\\s*support)\\b"],
        project: ["\\b(implementation|strategy|launch\\s*project)\\b"],
      },
    },
    dimensionPreference: ["serviceLine", "product", "category"],
  });
  const profile = mod.buildSheetSemanticProfile({
    headers: ["Product Category", "Service Line", "Gross Revenue", "COGS Amount"],
    sampleRows: [
      { "Product Category": "Software", "Service Line": "SaaS Subscription", "Gross Revenue": "1000", "COGS Amount": "200" },
      { "Product Category": "Software", "Service Line": "Maintenance", "Gross Revenue": "750", "COGS Amount": "150" },
      { "Product Category": "Software", "Service Line": "Implementation", "Gross Revenue": "500", "COGS Amount": "350" },
      { "Product Category": "Services", "Service Line": "Strategy", "Gross Revenue": "300", "COGS Amount": "180" },
    ],
    rules,
  });

  const serviceLine = profile.columns.find((col) => col.name === "Service Line");
  assert.ok(serviceLine);
  assert.ok(serviceLine.roles.includes("dimension"));
  assert.ok(serviceLine.meanings.includes("serviceLine"));
  assert.ok(serviceLine.meanings.includes("revenueModel"));
  assert.equal(profile.defaults.serviceLineColumn, "Service Line");
  assert.equal(profile.defaults.revenueModelColumn, "Service Line");
  assert.equal(profile.defaults.driverDimensionColumn, "Service Line");
  assert.deepEqual(serviceLine.valueSemantics.revenueModel.recurring, ["SaaS Subscription", "Maintenance"]);
  assert.deepEqual(serviceLine.valueSemantics.revenueModel.project, ["Implementation", "Strategy"]);
  assert.equal(mod.resolveProfileDimension(profile, "What percentage of revenue is recurring vs one-time implementations?"), "Service Line");
});

test("customer-scoped SSO toggle is wired and enforced for Google auth", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const entitlementsPath = path.join(repoRoot, "backend", "src", "utils", "entitlements.js");
  const routesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const googleControllerPath = path.join(repoRoot, "backend", "src", "controllers", "googleController.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");

  const entitlementsSource = fs.readFileSync(entitlementsPath, "utf8");
  const routesSource = fs.readFileSync(routesPath, "utf8");
  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const googleControllerSource = fs.readFileSync(googleControllerPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const appSource = fs.readFileSync(appPath, "utf8");

  assert.match(entitlementsSource, /sso:\s*true/);
  assert.match(routesSource, /router\.get\("\/admin\/settings\/sso"/);
  assert.match(routesSource, /router\.patch\("\/admin\/settings\/sso"/);
  assert.match(userControllerSource, /export async function getSsoSetting/);
  assert.match(userControllerSource, /export async function setSsoSetting/);
  assert.match(googleControllerSource, /assertGroupFeatureEnabled\(requestedGroupId,\s*"sso"/);
  assert.match(googleControllerSource, /assertGroupFeatureEnabled\(requiredGroupId,\s*"sso"/);
  assert.doesNotMatch(uiSource, /\["sso",\s*"SSO"\]/);
  assert.match(appSource, /google_sso_disabled/);
});

test("system settings endpoints use platform admin helper consistently", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const source = fs.readFileSync(userControllerPath, "utf8");

  assert.match(source, /export async function getSmtpSetting\(req, res\)/);
  assert.match(source, /export async function setSmtpSetting\(req, res\)/);
  assert.match(source, /export async function getInviteEmailTemplateSetting\(req, res\)/);
  assert.match(source, /export async function setInviteEmailTemplateSetting\(req, res\)/);
  assert.match(source, /export async function previewInviteEmailTemplate\(req, res\)/);
  assert.match(source, /export async function getCustomerInvitationPolicy\(req, res\)/);
  assert.match(source, /export async function setCustomerInvitationPolicy\(req, res\)/);
  assert.match(source, /if \(!isPlatformAdminUser\(req\.user\)\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\);/);
});

test("DLP settings default to feature-based rules and support column masking workflow", async () => {
  const dlp = await import(`../src/utils/dlp.js?t=${Date.now()}_dlp_defaults`);
  const normalized = dlp.normalizeDlpSettings({});
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.mode, "block");
  assert.equal(normalized.maskDetectedColumns, false);

  const sheets = {
    Main: [
      { Name: "Alice", SSN: "123-45-6789", Notes: "ok" },
      { Name: "Bob", Card: "4111 1111 1111 1111", Notes: "ok" },
    ],
  };
  const scan = dlp.scanRowsForDlp(sheets, { enabled: true, checkSsn: true, checkCreditCard: true });
  assert.ok(Array.isArray(scan.findings));
  assert.ok(scan.findings.length >= 2);
  assert.deepEqual(new Set(scan.maskedColumns.Main || []), new Set(["SSN", "Card"]));

  const disabledScan = dlp.scanRowsForDlp(sheets, { enabled: false, checkSsn: true, checkCreditCard: true });
  assert.equal(disabledScan.findings.length, 0);
  assert.equal(disabledScan.scannedCells, 0);

  const masked = dlp.applyDlpColumnMasking(sheets, scan.maskedColumns);
  assert.equal(masked.Main[0].SSN, "[REDACTED]");
  assert.equal(masked.Main[1].Card, "[REDACTED]");
  assert.equal(masked.Main[0].Name, "Alice");
});

test("autosync interval is configurable in system settings and read dynamically by the worker", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userRoutesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const sheetControllerPath = path.join(repoRoot, "backend", "src", "controllers", "sheetController.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");
  const integrationsPanelPath = path.join(repoRoot, "frontend", "src", "components", "admin", "IntegrationSettingsPanel.jsx");

  const userRoutesSource = fs.readFileSync(userRoutesPath, "utf8");
  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const sheetControllerSource = fs.readFileSync(sheetControllerPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const integrationsPanelSource = fs.readFileSync(integrationsPanelPath, "utf8");

  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/autosync-interval", asyncHandler\(getAutosyncPollIntervalSetting\)\)/);
  assert.match(userRoutesSource, /router\.patch\("\/admin\/settings\/autosync-interval", asyncHandler\(setAutosyncPollIntervalSetting\)\)/);
  assert.match(userControllerSource, /export async function getAutosyncPollIntervalSetting\(req, res\)/);
  assert.match(userControllerSource, /export async function setAutosyncPollIntervalSetting\(req, res\)/);
  assert.match(userControllerSource, /autosync_poll_interval_settings/);
  assert.match(sheetControllerSource, /async function loadAutosyncPollIntervalMs\(\)/);
  assert.match(sheetControllerSource, /const AUTOSYNC_POLL_SETTINGS_KEY = "autosync_poll_interval_settings";/);
  assert.match(sheetControllerSource, /loadAutosyncPollIntervalMs\(\)/);
  assert.match(integrationsPanelSource, /Autosync Check Interval/);
  assert.match(uiSource, /fetchAutosyncIntervalSetting/);
  assert.match(uiSource, /saveAutosyncIntervalSetting/);
});

test("email ingest settings are exposed in system settings and linked to Google Workspace routing docs", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userRoutesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const uiPath = path.join(
    repoRoot,
    "frontend",
    "src",
    "components",
    "admin",
    "IntegrationSettingsPanel.jsx"
  );

  const userRoutesSource = fs.readFileSync(userRoutesPath, "utf8");
  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const integrationsPanelPath = path.join(repoRoot, "frontend", "src", "components", "admin", "IntegrationSettingsPanel.jsx");
  const integrationsPanelSource = fs.readFileSync(integrationsPanelPath, "utf8");

  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/email-ingest", asyncHandler\(getEmailIngestSetting\)\)/);
  assert.match(userRoutesSource, /router\.patch\("\/admin\/settings\/email-ingest", asyncHandler\(setEmailIngestSetting\)\)/);
  assert.match(userControllerSource, /export async function getEmailIngestSetting\(req, res\)/);
  assert.match(userControllerSource, /export async function setEmailIngestSetting\(req, res\)/);
  assert.match(userControllerSource, /EMAIL_INGEST_SETTINGS_KEY = "email_ingest_settings"/);
  assert.match(integrationsPanelSource, /Email Ingest/);
  assert.match(integrationsPanelSource, /Add a domain or domain alias/);
  assert.match(integrationsPanelSource, /Set up Default routing for your organization/);
  assert.match(integrationsPanelSource, /Get misaddressed email in a catch-all mailbox/);
});

test("email ingest allowlist is normalized and route wiring is public but CSRF-exempt", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const emailRoutesPath = path.join(repoRoot, "backend", "src", "routes", "emailRoutes.js");
  const csrfPath = path.join(repoRoot, "backend", "src", "middleware", "csrf.js");
  const dbPath = path.join(repoRoot, "backend", "src", "config", "db.js");

  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const emailRoutesSource = fs.readFileSync(emailRoutesPath, "utf8");
  const csrfSource = fs.readFileSync(csrfPath, "utf8");
  const dbSource = fs.readFileSync(dbPath, "utf8");

  assert.match(userControllerSource, /EMAIL_INGEST_ALLOWLIST_KEY = "email_ingest_allowlist"/);
  assert.match(userControllerSource, /normalizeEmailIngestSenderAllowlist/);
  assert.match(userControllerSource, /resolveScopedGroupForIntegrationSettings\(req\)/);
  assert.match(emailRoutesSource, /router\.post\(\s*"\/email-ingest\/inbound",\s*uploadRateLimit,\s*verifyIngestSecret,\s*upload\.fields\(\[/s);
  assert.match(csrfSource, /"\/email-ingest\/inbound"/);
  assert.match(dbSource, /idx_report_sources_email_sync_source/);
});

test("email ingest allowlist normalization lowercases and dedupes domains", async () => {
  const mod = await import(`../src/controllers/userController.js?t=${Date.now()}_email_allowlist`);
  const normalized = mod.normalizeEmailIngestSenderAllowlist({
    allowedSenderDomains: ["Customer.com", "customer.com", "  Partner.ORG  ", "", null],
  });
  assert.deepEqual(normalized, ["customer.com", "partner.org"]);
});

test("storage options are exposed in system settings and wire connection tests for SFTP, GCS, S3, and Azure Blob Storage", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userRoutesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const storageControllerPath = path.join(repoRoot, "backend", "src", "controllers", "storageController.js");
  const uiPath = path.join(
    repoRoot,
    "frontend",
    "src",
    "components",
    "admin",
    "IntegrationSettingsPanel.jsx"
  );
  const uiConfigPath = path.join(repoRoot, "frontend", "src", "components", "admin", "userManagementConfig.js");
  const cardPath = path.join(repoRoot, "frontend", "src", "components", "common", "StorageOptionCard.jsx");

  const userRoutesSource = fs.readFileSync(userRoutesPath, "utf8");
  const storageControllerSource = fs.readFileSync(storageControllerPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const uiConfigSource = fs.readFileSync(uiConfigPath, "utf8");
  const cardSource = fs.readFileSync(cardPath, "utf8");

  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/sftp-storage", asyncHandler\(getSftpStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/admin\/settings\/sftp-storage\/test", asyncHandler\(testSftpStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/gcs-storage", asyncHandler\(getGcsStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/admin\/settings\/gcs-storage\/test", asyncHandler\(testGcsStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/s3-storage", asyncHandler\(getS3StorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/admin\/settings\/s3-storage\/test", asyncHandler\(testS3StorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/azure-blob-storage", asyncHandler\(getAzureBlobStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/admin\/settings\/azure-blob-storage\/test", asyncHandler\(testAzureBlobStorageSetting\)\)/);
  assert.match(storageControllerSource, /export async function getSftpStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function testSftpStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function getGcsStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function testGcsStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function getS3StorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function testS3StorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function getAzureBlobStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function testAzureBlobStorageSetting\(req, res\)/);
  assert.match(uiSource, /STORAGE_PROVIDER_DEFS\.map/);
  assert.match(uiConfigSource, /SCP \/ SFTP/);
  assert.match(uiConfigSource, /Google Cloud Storage/);
  assert.match(uiConfigSource, /Amazon S3/);
  assert.match(uiConfigSource, /Azure Blob Storage/);
  assert.match(cardSource, /export default function StorageOptionCard/);
});

test("admin settings reject unknown payload keys with structured error code", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const userControllerPath = path.join(__dirname, "..", "src", "controllers", "userController.js");
  const storageControllerPath = path.join(__dirname, "..", "src", "controllers", "storageController.js");
  const userSource = fs.readFileSync(userControllerPath, "utf8");
  const storageSource = fs.readFileSync(storageControllerPath, "utf8");

  assert.match(userSource, /function assertAllowedKeys\(raw, allowedKeys = \[\]\)/);
  assert.match(userSource, /new Error\("unknown_settings_keys"\)/);
  assert.match(storageSource, /function assertAllowedStorageKeys\(body, fields = \[\]\)/);
  assert.match(storageSource, /new Error\("unknown_settings_keys"\)/);
});

test("import publish\\/reject handlers are idempotent for repeated state transitions", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sheetControllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(sheetControllerPath, "utf8");

  assert.match(source, /if \(record\.status === "published"\) \{[\s\S]*idempotent: true/);
  assert.match(source, /if \(record\.status === "rejected"\) \{[\s\S]*idempotent: true/);
});

test("metrics endpoint is exposure-gated and returns Prometheus text only when enabled", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverPath = path.join(__dirname, "..", "..", "backend", "server.js");
  const source = fs.readFileSync(serverPath, "utf8");

  assert.match(source, /app\.get\("\/metrics", async/);
  assert.match(source, /metrics_exposure_settings/);
  assert.match(source, /if \(!enabled\) return res\.status\(404\)\.send\("Not Found"\)/);
  assert.match(source, /Content-Type", "text\/plain; version=0\.0\.4; charset=utf-8/);
});

test("DLP flow supports warn\\/block decision and mandatory audit logging", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sheetControllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(sheetControllerPath, "utf8");

  assert.match(source, /action: "dlp\.findings_detected"/);
  assert.match(source, /if \(scan\.findings\.length > 0 && dlp\.mode === "block"\)/);
  assert.match(source, /applyDlpColumnMasking/);
});

test("customer-scoped OAuth settings do not fall back to global config", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const googleControllerPath = path.join(repoRoot, "backend", "src", "controllers", "googleController.js");

  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const googleControllerSource = fs.readFileSync(googleControllerPath, "utf8");

  assert.doesNotMatch(userControllerSource, /const globalRows = await query\("SELECT value FROM app_settings WHERE key = \$1 LIMIT 1", \[baseKey\]\);/);
  assert.doesNotMatch(googleControllerSource, /const globalRows = await query\("SELECT value FROM app_settings WHERE key = \$1 LIMIT 1", \[baseKey\]\);/);
});

test("customer users are invitation-only and invitation auth flow is wired", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const userRoutesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const authControllerPath = path.join(repoRoot, "backend", "src", "controllers", "authController.js");
  const authRoutesPath = path.join(repoRoot, "backend", "src", "routes", "authRoutes.js");
  const dbPath = path.join(repoRoot, "backend", "src", "config", "db.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");

  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const userRoutesSource = fs.readFileSync(userRoutesPath, "utf8");
  const authControllerSource = fs.readFileSync(authControllerPath, "utf8");
  const authRoutesSource = fs.readFileSync(authRoutesPath, "utf8");
  const dbSource = fs.readFileSync(dbPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const appSource = fs.readFileSync(appPath, "utf8");

  assert.match(userControllerSource, /customer_users_invite_only/);
  assert.match(userControllerSource, /export async function inviteCustomerUser/);
  assert.match(userControllerSource, /export async function listCustomerInvitations/);
  assert.match(userControllerSource, /export async function resendCustomerInvitation/);
  assert.match(userControllerSource, /export async function revokeCustomerInvitation/);
  assert.match(userControllerSource, /export async function getCustomerInvitationPolicy/);
  assert.match(userControllerSource, /export async function setCustomerInvitationPolicy/);
  assert.match(userRoutesSource, /router\.post\("\/users\/invitations", invitationIssueRateLimit, asyncHandler\(inviteCustomerUser\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/users\/invitations", asyncHandler\(listCustomerInvitations\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/users\/invitations\/:id\/resend", invitationIssueRateLimit, asyncHandler\(resendCustomerInvitation\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/users\/invitations\/:id\/revoke", asyncHandler\(revokeCustomerInvitation\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/customer-invitations", asyncHandler\(getCustomerInvitationPolicy\)\)/);
  assert.match(userRoutesSource, /router\.patch\("\/admin\/settings\/customer-invitations", asyncHandler\(setCustomerInvitationPolicy\)\)/);
  assert.match(authControllerSource, /export async function getInvitationInfo/);
  assert.match(authControllerSource, /export async function acceptInvitation/);
  assert.match(authRoutesSource, /router\.get\("\/invitations\/:token", invitationLookupRateLimit, asyncHandler\(getInvitationInfo\)\)/);
  assert.match(authRoutesSource, /router\.post\("\/invitations\/accept", invitationAcceptRateLimit, asyncHandler\(acceptInvitation\)\)/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS customer_user_invitations/);
  assert.match(uiSource, /\/users\/invitations/);
  assert.match(uiSource, /\/admin\/settings\/customer-invitations/);
  assert.match(appSource, /auth\/invitations\/accept/);
});
