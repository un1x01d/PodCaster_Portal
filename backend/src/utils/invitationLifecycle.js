import { query } from "../config/db.js";

const DEFAULT_TTL_HOURS = Number.parseInt(process.env.CUSTOMER_INVITE_TTL_HOURS || "72", 10);
const DEFAULT_RETENTION_DAYS = Number.parseInt(process.env.CUSTOMER_INVITE_RETENTION_DAYS || "30", 10);

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizePolicy(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    ttlHours: clampInt(cfg.ttlHours, clampInt(DEFAULT_TTL_HOURS, 72, 1, 720), 1, 720),
    retentionDays: clampInt(cfg.retentionDays, clampInt(DEFAULT_RETENTION_DAYS, 30, 1, 365), 1, 365),
  };
}

export async function loadInvitationPolicy() {
  const rows = await query(
    "SELECT value FROM app_settings WHERE key = 'customer_invitation_policy' LIMIT 1",
    []
  );
  return normalizePolicy(rows?.[0]?.value || {});
}

export async function saveInvitationPolicy(input) {
  const next = normalizePolicy(input);
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('customer_invitation_policy', $1::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(next)]
  );
  return next;
}

export function computeInvitationExpiryDate(policy, now = Date.now()) {
  const ttlHours = clampInt(policy?.ttlHours, clampInt(DEFAULT_TTL_HOURS, 72, 1, 720), 1, 720);
  return new Date(now + ttlHours * 60 * 60 * 1000);
}

export async function cleanupOldInvitations() {
  const policy = await loadInvitationPolicy();
  const retentionDays = clampInt(policy?.retentionDays, clampInt(DEFAULT_RETENTION_DAYS, 30, 1, 365), 1, 365);
  const rows = await query(
    `DELETE FROM customer_user_invitations
      WHERE (
        accepted_at IS NOT NULL
        AND accepted_at < (CURRENT_TIMESTAMP - ($1::text || ' days')::interval)
      ) OR (
        revoked_at IS NOT NULL
        AND revoked_at < (CURRENT_TIMESTAMP - ($1::text || ' days')::interval)
      ) OR (
        accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at < (CURRENT_TIMESTAMP - ($1::text || ' days')::interval)
      )
      RETURNING id`,
    [retentionDays]
  );
  return {
    deletedCount: rows.length,
    retentionDays,
  };
}
