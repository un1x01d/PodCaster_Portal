export function createUserSettingsRoutesA(deps) {
const {
  query,
  isPlatformAdminUser,
  APP_SETTING_KEYS,
  normalizeAppSettingValue,
  readDecryptedSetting,
  writeEncryptedSetting,
  ensureOauthFrontendUrl,
  stripOauthTestSecrets,
  parseBooleanLike,
  testGoogleOauthConfig,
  testDropboxOauthConfig,
  testOneDriveOauthConfig,
  testQuickbooksOauthConfig,
  testSamlSsoConfig,
  readSmtpSetting,
  writeSmtpSetting,
  previewInviteEmailTemplateWithSettings,
} = deps;

async function setDefaultView(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { userId } = req.params;
    const { viewId } = req.body;
    await query(
        "UPDATE users SET default_view_id = $1 WHERE id = $2",
        [viewId || null, userId]
    );
    res.json({ success: true });
}

async function getGoogleIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("google_integration", scope.groupId);
        const enabled = value ? !!value?.enabled : true;
        res.json({ enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setGoogleIntegrationSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const enabled = !!req.body?.enabled;
        const key = appSettingKeyForGroup("google_integration", scope.groupId);
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify({ enabled })]
        );
        res.json({ success: true, enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

function maskIfPresent(value) {
    return String(value || "").trim() ? "***" : "";
}

function decryptOauthConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    clientId: decryptSettingValue(String(cfg.clientId || "")),
        clientSecret: decryptSettingValue(String(cfg.clientSecret || "")),
        redirectUri: String(cfg.redirectUri || ""),
        frontendUrl: String(cfg.frontendUrl || ""),
  };
}

function decryptQuickbooksOauthConfig(raw) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    const base = decryptOauthConfig(cfg);
    const environment = String(cfg.environment || "production").trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
    const companyId = String(cfg.companyId || "").trim();
    const selectedDataTypes = Array.isArray(cfg.selectedDataTypes)
        ? cfg.selectedDataTypes.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
    return {
        ...base,
        environment,
        companyId,
        selectedDataTypes,
    };
}

function normalizeOauthConfigForSave(current, body) {
    const incomingClientIdRaw = typeof body?.clientId === "string" ? body.clientId.trim() : undefined;
    const incomingClientSecretRaw = typeof body?.clientSecret === "string" ? body.clientSecret.trim() : undefined;
    const incomingRedirectRaw = typeof body?.redirectUri === "string" ? body.redirectUri.trim() : undefined;
    const incomingFrontendRaw = typeof body?.frontendUrl === "string" ? body.frontendUrl.trim() : undefined;

    const nextClientId = (incomingClientIdRaw && incomingClientIdRaw !== "***") ? incomingClientIdRaw : String(current.clientId || "");
    const nextClientSecret = (incomingClientSecretRaw && incomingClientSecretRaw !== "***") ? incomingClientSecretRaw : String(current.clientSecret || "");

    return {
        clientId: encryptSettingValue(nextClientId),
        clientSecret: encryptSettingValue(nextClientSecret),
        redirectUri: incomingRedirectRaw !== undefined ? incomingRedirectRaw : String(current.redirectUri || ""),
        frontendUrl: incomingFrontendRaw !== undefined ? incomingFrontendRaw : String(current.frontendUrl || ""),
    };
}

function normalizeQuickbooksOauthConfigForSave(current, body) {
    const base = normalizeOauthConfigForSave(current, body);
    const incomingEnvironment = String(body?.environment || current.environment || "production").trim().toLowerCase();
    const environment = incomingEnvironment === "sandbox" ? "sandbox" : "production";
    const companyId = typeof body?.companyId === "string" ? body.companyId.trim() : String(current.companyId || "");
    const selectedDataTypes = Array.isArray(body?.selectedDataTypes)
        ? body.selectedDataTypes.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 25)
        : (Array.isArray(current.selectedDataTypes) ? current.selectedDataTypes : []);
    return {
        ...base,
        environment,
        companyId,
        selectedDataTypes,
    };
}

function appSettingKeyForGroup(baseKey, groupId) {
    return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}:${baseKey}` : baseKey;
}

async function resolveScopedGroupForIntegrationSettings(req) {
    const requestedGroupId = parsePositiveInt(req.query?.groupId ?? req.body?.groupId);
    if (isPlatformAdminUser(req.user)) {
        return { groupId: requestedGroupId };
    }

    const adminGroups = await getAdminGroups(req.user.id);
    if (!adminGroups.length) {
        const err = new Error("Forbidden");
        err.statusCode = 403;
        throw err;
    }
    if (requestedGroupId) {
        if (!adminGroups.includes(requestedGroupId)) {
            const err = new Error("Forbidden");
            err.statusCode = 403;
            throw err;
        }
        return { groupId: requestedGroupId };
    }
    if (adminGroups.length === 1) {
        return { groupId: adminGroups[0] };
    }
    const err = new Error("group_id_required");
    err.statusCode = 400;
    throw err;
}

async function getAppSettingValueWithScopedFallback(baseKey, groupId) {
    const scopedKey = appSettingKeyForGroup(baseKey, groupId);
    const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
    if (scopedRows.length) return scopedRows[0]?.value;
    return null;
}

function oauthConfigIsComplete(cfg) {
    return !!(
        String(cfg?.clientId || "").trim()
        && String(cfg?.clientSecret || "").trim()
        && String(cfg?.redirectUri || "").trim()
    );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function runOauthCredentialsProbe(provider, cfg) {
    if (!oauthConfigIsComplete(cfg)) {
        return { ok: false, error: "oauth_not_configured" };
    }

    const redirectUri = String(cfg.redirectUri || "").trim();
    const clientId = String(cfg.clientId || "").trim();
    const clientSecret = String(cfg.clientSecret || "").trim();
    let tokenUrl = "";
    let body;
    let headers = { "Content-Type": "application/x-www-form-urlencoded" };

    if (provider === "google") {
        tokenUrl = "https://oauth2.googleapis.com/token";
        body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: "codex_probe_invalid_code",
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
        });
    } else if (provider === "dropbox") {
        tokenUrl = "https://api.dropboxapi.com/oauth2/token";
        body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: "codex_probe_invalid_code",
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
        });
    } else if (provider === "onedrive") {
        tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
        body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: "codex_probe_invalid_code",
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
            scope: "offline_access User.Read Files.Read",
        });
    } else if (provider === "quickbooks") {
        tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
        body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: "codex_probe_invalid_code",
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
        });
    } else {
        return { ok: false, error: "unknown_provider" };
    }

    try {
        const res = await fetchWithTimeout(tokenUrl, {
            method: "POST",
            headers,
            body,
        });
        const text = await res.text();
        const lower = String(text || "").toLowerCase();
        if (res.ok) {
            return { ok: true, message: "oauth_probe_success" };
        }
        if (
            lower.includes("invalid_client")
            || lower.includes("unauthorized_client")
            || lower.includes("client authentication failed")
        ) {
            return { ok: false, error: "invalid_client_credentials" };
        }
        if (
            lower.includes("invalid_grant")
            || lower.includes("bad_verification_code")
            || lower.includes("authorization code")
            || lower.includes("invalid code")
        ) {
            return { ok: true, message: "oauth_credentials_valid_code_rejected" };
        }
        return { ok: false, error: "oauth_probe_failed", details: text.slice(0, 300) };
    } catch (err) {
        return { ok: false, error: "oauth_probe_network_error", details: String(err?.message || err) };
    }
}

async function getGoogleOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("google_oauth", scope.groupId);
        const cfg = decryptOauthConfig(value || {});
        const clientId = String(cfg.clientId || "");
        const clientSecret = String(cfg.clientSecret || "");
        const redirectUri = String(cfg.redirectUri || "");
        const frontendUrl = String(cfg.frontendUrl || "");

        res.json({
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            clientIdMasked: maskIfPresent(clientId),
            clientSecretMasked: maskIfPresent(clientSecret),
            redirectUri,
            frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setGoogleOauthSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["clientId", "clientSecret", "redirectUri", "frontendUrl", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("google_oauth", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("google_oauth", scope.groupId);
        const current = decryptOauthConfig(currentRaw || {});
        const next = normalizeOauthConfigForSave(current, req.body);

        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(next)]
        );

        res.json({
            success: true,
            hasClientId: !!decryptSettingValue(next.clientId),
            hasClientSecret: !!decryptSettingValue(next.clientSecret),
            clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
            clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
            redirectUri: next.redirectUri,
            frontendUrl: next.frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function getDropboxIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("dropbox_integration", scope.groupId);
        const enabled = value ? !!value?.enabled : true;
        res.json({ enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setDropboxIntegrationSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const enabled = !!req.body?.enabled;
        const key = appSettingKeyForGroup("dropbox_integration", scope.groupId);
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify({ enabled })]
        );
        res.json({ success: true, enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function getDropboxOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("dropbox_oauth", scope.groupId);
        const cfg = decryptOauthConfig(value || {});
        const clientId = String(cfg.clientId || "");
        const clientSecret = String(cfg.clientSecret || "");
        const redirectUri = String(cfg.redirectUri || "");
        const frontendUrl = String(cfg.frontendUrl || "");

        res.json({
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            clientIdMasked: maskIfPresent(clientId),
            clientSecretMasked: maskIfPresent(clientSecret),
            redirectUri,
            frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setDropboxOauthSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["clientId", "clientSecret", "redirectUri", "frontendUrl", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("dropbox_oauth", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("dropbox_oauth", scope.groupId);
        const current = decryptOauthConfig(currentRaw || {});
        const next = normalizeOauthConfigForSave(current, req.body);

        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(next)]
        );

        res.json({
            success: true,
            hasClientId: !!decryptSettingValue(next.clientId),
            hasClientSecret: !!decryptSettingValue(next.clientSecret),
            clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
            clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
            redirectUri: next.redirectUri,
            frontendUrl: next.frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function getOneDriveIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("onedrive_integration", scope.groupId);
        const enabled = value ? !!value?.enabled : true;
        res.json({ enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function getQuickbooksIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("quickbooks_integration", scope.groupId);
        const enabled = value ? !!value?.enabled : true;
        res.json({ enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setQuickbooksIntegrationSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const enabled = !!req.body?.enabled;
        const key = appSettingKeyForGroup("quickbooks_integration", scope.groupId);
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify({ enabled })]
        );
        res.json({ success: true, enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setOneDriveIntegrationSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const enabled = !!req.body?.enabled;
        const key = appSettingKeyForGroup("onedrive_integration", scope.groupId);
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify({ enabled })]
        );
        res.json({ success: true, enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function getOneDriveOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("onedrive_oauth", scope.groupId);
        const cfg = decryptOauthConfig(value || {});
        const clientId = String(cfg.clientId || "");
        const clientSecret = String(cfg.clientSecret || "");
        const redirectUri = String(cfg.redirectUri || "");
        const frontendUrl = String(cfg.frontendUrl || "");

        res.json({
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            clientIdMasked: maskIfPresent(clientId),
            clientSecretMasked: maskIfPresent(clientSecret),
            redirectUri,
            frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setOneDriveOauthSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["clientId", "clientSecret", "redirectUri", "frontendUrl", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("onedrive_oauth", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("onedrive_oauth", scope.groupId);
        const current = decryptOauthConfig(currentRaw || {});
        const next = normalizeOauthConfigForSave(current, req.body);

        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(next)]
        );

        res.json({
            success: true,
            hasClientId: !!decryptSettingValue(next.clientId),
            hasClientSecret: !!decryptSettingValue(next.clientSecret),
            clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
            clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
            redirectUri: next.redirectUri,
            frontendUrl: next.frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function getQuickbooksOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("quickbooks_oauth", scope.groupId);
        const cfg = decryptQuickbooksOauthConfig(value || {});
        const clientId = String(cfg.clientId || "");
        const clientSecret = String(cfg.clientSecret || "");
        const redirectUri = String(cfg.redirectUri || "");
        const frontendUrl = String(cfg.frontendUrl || "");
        const environment = String(cfg.environment || "production");
        const companyId = String(cfg.companyId || "");
        const selectedDataTypes = Array.isArray(cfg.selectedDataTypes) ? cfg.selectedDataTypes : [];

        res.json({
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            clientIdMasked: maskIfPresent(clientId),
            clientSecretMasked: maskIfPresent(clientSecret),
            redirectUri,
            frontendUrl,
            environment,
            companyId,
            selectedDataTypes,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setQuickbooksOauthSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["clientId", "clientSecret", "redirectUri", "frontendUrl", "environment", "companyId", "selectedDataTypes", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("quickbooks_oauth", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("quickbooks_oauth", scope.groupId);
        const current = decryptQuickbooksOauthConfig(currentRaw || {});
        const next = normalizeQuickbooksOauthConfigForSave(current, req.body);

        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(next)]
        );

        res.json({
            success: true,
            hasClientId: !!decryptSettingValue(next.clientId),
            hasClientSecret: !!decryptSettingValue(next.clientSecret),
            clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
            clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
            redirectUri: next.redirectUri,
            frontendUrl: next.frontendUrl,
            environment: next.environment || "production",
            companyId: next.companyId || "",
            selectedDataTypes: Array.isArray(next.selectedDataTypes) ? next.selectedDataTypes : [],
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function loadScopedDecryptedOauthConfig(req, baseKey) {
    const scope = await resolveScopedGroupForIntegrationSettings(req);
    const value = await getAppSettingValueWithScopedFallback(baseKey, scope.groupId);
    const cfg = decryptOauthConfig(value || {});
    return { scope, cfg };
}

async function testGoogleOauthSetting(req, res) {
    try {
        const { scope, cfg } = await loadScopedDecryptedOauthConfig(req, "google_oauth");
        const result = await runOauthCredentialsProbe("google", cfg);
        if (!result.ok) return res.status(400).json({ ...result, groupId: scope.groupId || null });
        return res.json({ ...result, groupId: scope.groupId || null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function testDropboxOauthSetting(req, res) {
    try {
        const { scope, cfg } = await loadScopedDecryptedOauthConfig(req, "dropbox_oauth");
        const result = await runOauthCredentialsProbe("dropbox", cfg);
        if (!result.ok) return res.status(400).json({ ...result, groupId: scope.groupId || null });
        return res.json({ ...result, groupId: scope.groupId || null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function testOneDriveOauthSetting(req, res) {
    try {
        const { scope, cfg } = await loadScopedDecryptedOauthConfig(req, "onedrive_oauth");
        const result = await runOauthCredentialsProbe("onedrive", cfg);
        if (!result.ok) return res.status(400).json({ ...result, groupId: scope.groupId || null });
        return res.json({ ...result, groupId: scope.groupId || null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function testQuickbooksOauthSetting(req, res) {
    try {
        const { scope, cfg } = await loadScopedDecryptedOauthConfig(req, "quickbooks_oauth");
        const result = await runOauthCredentialsProbe("quickbooks", cfg);
        if (!result.ok) return res.status(400).json({ ...result, groupId: scope.groupId || null });
        return res.json({ ...result, groupId: scope.groupId || null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

function decryptSamlSsoConfig(raw) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    return {
        idpSsoUrl: String(cfg.idpSsoUrl || "").trim(),
        idpEntityId: String(cfg.idpEntityId || "").trim(),
        spEntityId: String(cfg.spEntityId || "").trim(),
        acsUrl: String(cfg.acsUrl || "").trim(),
        nameIdFormat: String(cfg.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress").trim(),
        x509Certificate: String(cfg.x509Certificate || "").trim(),
        defaultRelayState: String(cfg.defaultRelayState || "").trim(),
    };
}

function normalizeSamlSsoConfigForSave(current, body) {
    const next = {
        idpSsoUrl: typeof body?.idpSsoUrl === "string" ? body.idpSsoUrl.trim() : String(current.idpSsoUrl || ""),
        idpEntityId: typeof body?.idpEntityId === "string" ? body.idpEntityId.trim() : String(current.idpEntityId || ""),
        spEntityId: typeof body?.spEntityId === "string" ? body.spEntityId.trim() : String(current.spEntityId || ""),
        acsUrl: typeof body?.acsUrl === "string" ? body.acsUrl.trim() : String(current.acsUrl || ""),
        nameIdFormat: typeof body?.nameIdFormat === "string" && body.nameIdFormat.trim()
            ? body.nameIdFormat.trim()
            : String(current.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"),
        x509Certificate: typeof body?.x509Certificate === "string" ? body.x509Certificate.trim() : String(current.x509Certificate || ""),
        defaultRelayState: typeof body?.defaultRelayState === "string" ? body.defaultRelayState.trim() : String(current.defaultRelayState || ""),
    };
    return next;
}

function isValidHttpUrl(value) {
    try {
        const u = new URL(String(value || ""));
        return u.protocol === "https:" || u.protocol === "http:";
    } catch (_) {
        return false;
    }
}

function samlConfigIsComplete(cfg) {
    return !!(
        String(cfg?.idpSsoUrl || "").trim()
        && String(cfg?.idpEntityId || "").trim()
        && String(cfg?.spEntityId || "").trim()
        && String(cfg?.acsUrl || "").trim()
    );
}

async function getSamlSsoSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("saml_sso", scope.groupId);
        const cfg = decryptSamlSsoConfig(value || {});
        res.json({
            ...cfg,
            hasX509Certificate: !!String(cfg.x509Certificate || "").trim(),
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setSamlSsoSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["idpSsoUrl", "idpEntityId", "spEntityId", "acsUrl", "nameIdFormat", "x509Certificate", "defaultRelayState", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("saml_sso", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("saml_sso", scope.groupId);
        const current = decryptSamlSsoConfig(currentRaw || {});
        const next = normalizeSamlSsoConfigForSave(current, req.body);

        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(next)]
        );

        res.json({
            success: true,
            ...next,
            hasX509Certificate: !!String(next.x509Certificate || "").trim(),
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function testSamlSsoSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("saml_sso", scope.groupId);
        const cfg = decryptSamlSsoConfig(value || {});
        if (!samlConfigIsComplete(cfg)) {
            return res.status(400).json({ ok: false, error: "saml_not_configured", groupId: scope.groupId || null });
        }
        if (!isValidHttpUrl(cfg.idpSsoUrl) || !isValidHttpUrl(cfg.acsUrl)) {
            return res.status(400).json({ ok: false, error: "saml_invalid_url", groupId: scope.groupId || null });
        }
        return res.json({ ok: true, message: "saml_configuration_valid", groupId: scope.groupId || null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

function decryptSmtpConfig(raw) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    return {
        host: String(cfg.host || ""),
        port: Number.parseInt(cfg.port, 10) || 587,
        secure: !!cfg.secure,
        username: String(cfg.username || ""),
        password: decryptSettingValue(String(cfg.password || "")),
        fromEmail: String(cfg.fromEmail || ""),
        fromName: String(cfg.fromName || ""),
    };
}

function normalizeSmtpConfigForSave(current, body) {
    const incomingPasswordRaw = typeof body?.password === "string" ? body.password.trim() : undefined;
    const nextPassword = (incomingPasswordRaw && incomingPasswordRaw !== "***")
        ? incomingPasswordRaw
        : String(current.password || "");
    const portCandidate = Number.parseInt(body?.port, 10);
    const safePort = Number.isInteger(portCandidate) && portCandidate > 0 ? portCandidate : Number(current.port || 587) || 587;

    return {
        host: typeof body?.host === "string" ? body.host.trim() : String(current.host || ""),
        port: safePort,
        secure: body?.secure === undefined ? !!current.secure : !!body.secure,
        username: typeof body?.username === "string" ? body.username.trim() : String(current.username || ""),
        password: encryptSettingValue(nextPassword),
        fromEmail: typeof body?.fromEmail === "string" ? body.fromEmail.trim() : String(current.fromEmail || ""),
        fromName: typeof body?.fromName === "string" ? body.fromName.trim() : String(current.fromName || ""),
    };
}

async function getSmtpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'smtp_config' LIMIT 1", []);
    const cfg = decryptSmtpConfig(rows[0]?.value || {});
    res.json({
        hasPassword: !!String(cfg.password || "").trim(),
        passwordMasked: maskIfPresent(cfg.password),
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        username: cfg.username,
        fromEmail: cfg.fromEmail,
        fromName: cfg.fromName,
    });
}

async function setSmtpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["host", "port", "secure", "username", "password", "fromEmail", "fromName"]);
    const rows = await query("SELECT value FROM app_settings WHERE key = 'smtp_config' LIMIT 1", []);
    const current = decryptSmtpConfig(rows[0]?.value || {});
    const next = normalizeSmtpConfigForSave(current, req.body);
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('smtp_config', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(next)]
    );
    res.json({
        success: true,
        hasPassword: !!decryptSettingValue(next.password),
        passwordMasked: maskIfPresent(decryptSettingValue(next.password)),
        host: next.host,
        port: next.port,
        secure: next.secure,
        username: next.username,
        fromEmail: next.fromEmail,
        fromName: next.fromName,
    });
}

async function getInviteEmailTemplateSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const template = await loadInviteEmailTemplate();
    return res.json(template);
}

async function setInviteEmailTemplateSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["subject", "html", "text", "logoUrl"]);
    const current = await loadInviteEmailTemplate();
    const next = normalizeInviteEmailTemplateForSave(req.body || {}, current);
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('invite_email_template', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "invite_email_template.updated",
        resourceType: "app_settings",
        resourceId: "invite_email_template",
    });
    return res.json({ success: true, ...next });
}

async function previewInviteEmailTemplate(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const current = await loadInviteEmailTemplate();
    const template = normalizeInviteEmailTemplateForSave(req.body || {}, current);
    const sample = req.body && typeof req.body === "object" ? req.body : {};
    const rendered = renderInviteTemplate(template, {
        customerName: String(sample.customerName || "Acme Corp"),
        inviterEmail: String(sample.inviterEmail || req.user.email || "admin@example.com"),
        inviteUrl: String(sample.inviteUrl || "https://app.example.com/?invite=preview-token"),
        expiresAt: String(sample.expiresAt || new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()),
        logoUrl: String(sample.logoUrl || template.logoUrl || ""),
    });
    return res.json(rendered);
}

async function getCustomerInvitationPolicy(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const policy = await loadInvitationPolicy();
    return res.json(policy);
}

async function setCustomerInvitationPolicy(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const policy = await saveInvitationPolicy(req.body || {});
    await writeAuditLog({
        req,
        action: "customer_invitation.policy_updated",
        resourceType: "app_settings",
        resourceId: "customer_invitation_policy",
        metadata: policy,
    });
    return res.json({ success: true, ...policy });
}

function normalizeInsightTranslationCacheSettings(raw = {}) {
    const ttlMinutesRaw = Number.parseInt(String(raw?.ttlMinutes ?? ""), 10);
    const ttlMinutes = Number.isFinite(ttlMinutesRaw) ? ttlMinutesRaw : DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MINUTES;
    return {
        ttlMinutes: Math.max(1, Math.min(1440, ttlMinutes)),
    };
}

function assertAllowedKeys(raw, allowedKeys = []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        const err = new Error("invalid_settings_payload");
        err.statusCode = 400;
        throw err;
    }
    const allowed = new Set(allowedKeys);
    const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
    if (unknown.length) {
        const err = new Error("unknown_settings_keys");
        err.statusCode = 400;
        err.details = { unknown };
        throw err;
    }
}

return {
  setDefaultView,
  getGoogleIntegrationSetting,
  setGoogleIntegrationSetting,
  appSettingKeyForGroup,
  resolveScopedGroupForIntegrationSettings,
  getAppSettingValueWithScopedFallback,
  getGoogleOauthSetting,
  setGoogleOauthSetting,
  getDropboxIntegrationSetting,
  setDropboxIntegrationSetting,
  getDropboxOauthSetting,
  setDropboxOauthSetting,
  getOneDriveIntegrationSetting,
  getQuickbooksIntegrationSetting,
  setQuickbooksIntegrationSetting,
  setOneDriveIntegrationSetting,
  getOneDriveOauthSetting,
  setOneDriveOauthSetting,
  getQuickbooksOauthSetting,
  setQuickbooksOauthSetting,
  testGoogleOauthSetting,
  testDropboxOauthSetting,
  testOneDriveOauthSetting,
  testQuickbooksOauthSetting,
  getSamlSsoSetting,
  setSamlSsoSetting,
  testSamlSsoSetting,
  getSmtpSetting,
  setSmtpSetting,
  getInviteEmailTemplateSetting,
  setInviteEmailTemplateSetting,
  previewInviteEmailTemplate,
  getCustomerInvitationPolicy,
  setCustomerInvitationPolicy,
};
}
