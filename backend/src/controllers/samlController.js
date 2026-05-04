import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { SAML } from "@node-saml/node-saml";
import { query, isTenantDbIsolationEnabled } from "../config/db.js";
import { decryptSettingValue } from "../utils/settingsCrypto.js";
import { generateToken, setAuthCookie } from "../middleware/auth.js";
import { writeAuditLog } from "../utils/auditLog.js";

const SAML_LOGIN_CODE_TTL_MS = Number.parseInt(process.env.SAML_LOGIN_CODE_TTL_MS || "60000", 10);
const DEFAULT_FRONTEND_URL = String(process.env.FRONTEND_URL || "http://localhost:5173").trim();
const DEFAULT_NAME_ID_FORMAT = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function appSettingKeyForGroup(baseKey, groupId) {
  return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}:${baseKey}` : baseKey;
}

async function getAppSettingValueWithScopedFallback(baseKey, groupId) {
  const scopedKey = appSettingKeyForGroup(baseKey, groupId);
  const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
  if (scopedRows.length) return scopedRows[0]?.value;
  return null;
}

function getSamlLoginCodeSecret() {
  const candidate = String(process.env.SAML_LOGIN_CODE_SECRET || process.env.JWT_SECRET || "").trim();
  if (!candidate) throw new Error("saml_login_code_secret_missing");
  return candidate;
}

function signSamlLoginCode(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function issueSamlLoginCode(user, now = Date.now()) {
  const token = generateToken(user);
  const payload = {
    tok: token,
    exp: now + SAML_LOGIN_CODE_TTL_MS,
    nonce: randomBytes(12).toString("base64url"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signSamlLoginCode(payloadB64, getSamlLoginCodeSecret());
  return `${payloadB64}.${signature}`;
}

function consumeSamlLoginCode(code, now = Date.now()) {
  const raw = String(code || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payloadB64, signature] = raw.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = signSamlLoginCode(payloadB64, getSamlLoginCodeSecret());
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    const exp = Number(payload?.exp || 0);
    const token = String(payload?.tok || "").trim();
    if (!token || !Number.isFinite(exp) || exp <= now) return null;
    return token;
  } catch {
    return null;
  }
}

async function resolveGroupAdminFlags(userId) {
  const rows = await query(
    "SELECT COUNT(*)::int AS c FROM user_groups WHERE user_id = $1 AND is_admin = TRUE",
    [userId]
  );
  const isGroupAdmin = Number(rows?.[0]?.c || 0) > 0;
  return {
    is_group_admin: isGroupAdmin,
    group_admin: isGroupAdmin,
  };
}

async function resolveTenantContextForUser(userRow) {
  if (!isTenantDbIsolationEnabled()) return {};
  if (String(userRow?.role || "").toLowerCase() === "admin") return {};
  const rows = await query(
    `SELECT c.id AS customer_id, c.group_id AS customer_group_id, c.db_name AS tenant_database
       FROM user_groups ug
       JOIN customers c ON c.group_id = ug.group_id
      WHERE ug.user_id = $1
        AND c.status = 'active'
      ORDER BY c.id ASC`,
    [userRow.id]
  );
  if (rows.length !== 1) return {};
  return {
    customer_id: rows[0].customer_id,
    customer_group_id: rows[0].customer_group_id,
    tenant_database: rows[0].tenant_database,
  };
}

function decryptSamlSsoConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    idpSsoUrl: String(cfg.idpSsoUrl || "").trim(),
    idpEntityId: String(cfg.idpEntityId || "").trim(),
    spEntityId: String(cfg.spEntityId || "").trim(),
    acsUrl: String(cfg.acsUrl || "").trim(),
    nameIdFormat: String(cfg.nameIdFormat || DEFAULT_NAME_ID_FORMAT).trim(),
    x509Certificate: String(cfg.x509Certificate || "").trim(),
    defaultRelayState: String(cfg.defaultRelayState || "").trim(),
  };
}

function samlConfigIsComplete(cfg) {
  return !!(
    String(cfg?.idpSsoUrl || "").trim()
    && String(cfg?.idpEntityId || "").trim()
    && String(cfg?.spEntityId || "").trim()
    && String(cfg?.acsUrl || "").trim()
    && String(cfg?.x509Certificate || "").trim()
  );
}

function normalizePemCertificate(rawCert) {
  const cert = String(rawCert || "").trim();
  if (!cert) return "";
  if (cert.includes("BEGIN CERTIFICATE")) return cert;
  const chunks = cert.replace(/\s+/g, "").match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${chunks.join("\n")}\n-----END CERTIFICATE-----`;
}

async function isSsoEnabledForGroup(groupId) {
  if (!Number.isInteger(groupId) || groupId <= 0) return false;
  const rows = await query("SELECT entitlements FROM groups WHERE id = $1 LIMIT 1", [groupId]);
  const entitlements = rows?.[0]?.entitlements;
  const features = entitlements && typeof entitlements === "object" && !Array.isArray(entitlements)
    ? entitlements.features || {}
    : {};
  return features?.sso !== false;
}

async function findUserBySamlProfile(profile) {
  const directEmail = normalizeEmail(profile?.email || profile?.mail);
  const nameId = normalizeEmail(profile?.nameID);
  const attrEmail = normalizeEmail(profile?.["urn:oid:0.9.2342.19200300.100.1.3"]);
  const candidates = Array.from(new Set([directEmail, nameId, attrEmail].filter(Boolean)));
  for (const email of candidates) {
    const rows = await query(
      `SELECT id, email, role, password_reset_required
         FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [email]
    );
    if (rows.length) return rows[0];
  }
  return null;
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  const one = String(value || "").trim();
  return one ? [one] : [];
}

function extractGroupHintsFromProfile(profile) {
  const hintKeys = [
    "groupId",
    "group_id",
    "customerGroupId",
    "customer_group_id",
    "https://schemas.tfron.app/group_id",
    "https://schemas.tfron.app/customer_group_id",
    "urn:oid:2.5.4.10",
  ];
  const hints = new Set();
  for (const key of hintKeys) {
    const values = toStringArray(profile?.[key]);
    for (const value of values) {
      const parsed = parsePositiveInt(value);
      if (parsed) hints.add(parsed);
    }
  }
  return Array.from(hints);
}

async function listUserGroupIds(userId) {
  const rows = await query("SELECT group_id FROM user_groups WHERE user_id = $1", [userId]);
  return rows
    .map((row) => parsePositiveInt(row?.group_id))
    .filter((id) => Number.isInteger(id));
}

async function resolveEffectiveGroupIdForSamlLogin({ profile, userId, requestedGroupId = null }) {
  if (Number.isInteger(requestedGroupId) && requestedGroupId > 0) {
    return requestedGroupId;
  }
  const userGroupIds = await listUserGroupIds(userId);
  if (!userGroupIds.length) return null;

  const hintedGroupIds = extractGroupHintsFromProfile(profile);
  const hintedMembershipMatches = hintedGroupIds.filter((groupId) => userGroupIds.includes(groupId));
  if (hintedMembershipMatches.length === 1) return hintedMembershipMatches[0];
  if (hintedMembershipMatches.length > 1) return null;

  const ssoEnabledGroupIds = [];
  for (const groupId of userGroupIds) {
    const enabled = await isSsoEnabledForGroup(groupId);
    if (enabled) ssoEnabledGroupIds.push(groupId);
  }
  if (ssoEnabledGroupIds.length === 1) return ssoEnabledGroupIds[0];
  return null;
}

async function createSamlRuntime({ groupId = null } = {}) {
  const value = await getAppSettingValueWithScopedFallback("saml_sso", groupId);
  const cfg = decryptSamlSsoConfig(value || {});
  if (!samlConfigIsComplete(cfg)) {
    const err = new Error("saml_not_configured");
    err.statusCode = 400;
    throw err;
  }
  const saml = new SAML({
    issuer: cfg.spEntityId,
    callbackUrl: cfg.acsUrl,
    entryPoint: cfg.idpSsoUrl,
    idpIssuer: cfg.idpEntityId,
    idpCert: normalizePemCertificate(cfg.x509Certificate),
    identifierFormat: cfg.nameIdFormat || DEFAULT_NAME_ID_FORMAT,
    audience: cfg.spEntityId,
    wantAssertionsSigned: true,
    validateInResponseTo: "ifPresent",
    requestIdExpirationPeriodMs: 5 * 60 * 1000,
    acceptedClockSkewMs: 5000,
  });
  return { saml, cfg };
}

function frontendUrlWithQuery(frontendUrl, params) {
  const url = new URL(frontendUrl || DEFAULT_FRONTEND_URL);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export async function getSamlLoginUrl(req, res) {
  try {
    const groupId = parsePositiveInt(req.query?.groupId);
    if (!groupId) return res.status(400).json({ error: "group_id_required" });
    const { saml, cfg } = await createSamlRuntime({ groupId });
    const relayState = JSON.stringify({
      groupId,
      frontendUrl: DEFAULT_FRONTEND_URL,
      fallbackRelayState: cfg.defaultRelayState || "",
    });
    const host = new URL(cfg.acsUrl).host;
    const url = await saml.getAuthorizeUrlAsync(relayState, host, {});
    return res.json({ url });
  } catch (err) {
    return res.status(err?.statusCode || 400).json({ error: err?.message || "saml_login_url_failed" });
  }
}

export async function samlAcs(req, res) {
  const relayStateRaw = String(req.body?.RelayState || "");
  let relay = {};
  try { relay = relayStateRaw ? JSON.parse(relayStateRaw) : {}; } catch { relay = {}; }
  const groupId = parsePositiveInt(relay?.groupId);
  const frontendUrl = String(relay?.frontendUrl || DEFAULT_FRONTEND_URL).trim() || DEFAULT_FRONTEND_URL;

  try {
    const { saml } = await createSamlRuntime({ groupId });
    const result = await saml.validatePostResponseAsync({
      SAMLResponse: String(req.body?.SAMLResponse || ""),
      RelayState: relayStateRaw,
    });
    const profile = result?.profile || {};
    const appUser = await findUserBySamlProfile(profile);
    if (!appUser) {
      return res.redirect(frontendUrlWithQuery(frontendUrl, { saml_error: "sso_user_not_provisioned" }));
    }
    if (String(appUser.role || "").toLowerCase() === "admin") {
      return res.redirect(frontendUrlWithQuery(frontendUrl, { saml_error: "admin_manual_login_required" }));
    }
    const effectiveGroupId = await resolveEffectiveGroupIdForSamlLogin({
      profile,
      userId: appUser.id,
      requestedGroupId: groupId,
    });
    if (!effectiveGroupId) {
      return res.redirect(frontendUrlWithQuery(frontendUrl, { saml_error: "saml_group_resolution_failed" }));
    }
    const ssoEnabled = await isSsoEnabledForGroup(effectiveGroupId);
    if (!ssoEnabled) {
      return res.redirect(frontendUrlWithQuery(frontendUrl, { saml_error: "saml_sso_disabled" }));
    }
    const membershipRows = await query(
      "SELECT 1 FROM user_groups WHERE user_id = $1 AND group_id = $2 LIMIT 1",
      [appUser.id, effectiveGroupId]
    );
    if (!membershipRows.length) {
      return res.redirect(frontendUrlWithQuery(frontendUrl, { saml_error: "sso_group_membership_required" }));
    }

    const tenantContext = await resolveTenantContextForUser(appUser);
    const tokenUser = { ...appUser, ...tenantContext };
    const token = generateToken(tokenUser);
    setAuthCookie(req, res, token);
    await writeAuditLog({
      req,
      actorUserId: appUser.id,
      action: "auth.saml_login_success",
      resourceType: "user",
      resourceId: appUser.id,
      metadata: { groupId: effectiveGroupId, relayGroupId: groupId || null },
    });
    const code = issueSamlLoginCode(tokenUser);
    return res.redirect(frontendUrlWithQuery(frontendUrl, { saml_code: code }));
  } catch (err) {
    return res.redirect(frontendUrlWithQuery(frontendUrl, { saml_error: "saml_login_failed" }));
  }
}

export async function exchangeSamlCode(req, res) {
  const code = String(req.body?.code || "").trim();
  const token = consumeSamlLoginCode(code);
  if (!token) return res.status(400).json({ error: "invalid_saml_code" });
  setAuthCookie(req, res, token);
  return res.json({ success: true });
}

export async function getSamlMetadata(req, res) {
  try {
    const groupId = parsePositiveInt(req.query?.groupId);
    if (!groupId) return res.status(400).json({ error: "group_id_required" });
    const { saml } = await createSamlRuntime({ groupId });
    const metadata = saml.generateServiceProviderMetadata(null, null);
    res.setHeader("Content-Type", "application/samlmetadata+xml");
    return res.status(200).send(metadata);
  } catch (err) {
    return res.status(err?.statusCode || 400).json({ error: err?.message || "saml_metadata_failed" });
  }
}

export async function getSamlMe(req, res) {
  const userId = Number.parseInt(String(req.user?.id || ""), 10);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(401).json({ error: "Unauthorized" });
  const rows = await query(
    `SELECT id, email, role, password_reset_required
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId]
  );
  if (!rows.length) return res.status(401).json({ error: "Unauthorized" });
  const user = rows[0];
  const tenantContext = await resolveTenantContextForUser(user);
  const groupFlags = await resolveGroupAdminFlags(user.id);
  return res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    password_reset_required: user.password_reset_required,
    ...tenantContext,
    ...groupFlags,
  });
}
