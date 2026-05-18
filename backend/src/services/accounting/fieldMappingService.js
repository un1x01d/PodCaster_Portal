import { query } from "../../config/db.js";
import { normalizeHeaderName, ACCOUNTING_HEADER_ALIASES } from "../ai/accountingHeaderDictionary.js";
import { writeAuditLog } from "../../utils/auditLog.js";

const VALID_SOURCES = new Set(["auto_detected", "ai_suggested", "synonym_match", "fuzzy_match", "user_approved", "user_corrected", "system_imported"]);
const VALID_TYPES = new Set(["currency", "number", "percent", "date", "text", "category", "unknown"]);

function isCanonicalAllowed(field) {
  return Object.prototype.hasOwnProperty.call(ACCOUNTING_HEADER_ALIASES, String(field || ""));
}

export async function getMappingsForSource({ sourceId = null, sheetId = null, tenantId = null, userId = null }) {
  return query(
    `SELECT * FROM accounting_field_mappings
      WHERE is_active = TRUE
        AND ($1::text IS NULL OR sheet_id = $1)
        AND ($2::int IS NULL OR source_id = $2)
        AND ($3::int IS NULL OR tenant_id = $3)
      ORDER BY approved_by_user DESC, confidence DESC, updated_at DESC`,
    [sheetId, sourceId, tenantId]
  );
}

export async function getApprovedMappings({ sourceId = null, sheetId = null, tenantId = null }) {
  return query(
    `SELECT * FROM accounting_field_mappings
      WHERE is_active = TRUE AND approved_by_user = TRUE
        AND ($1::text IS NULL OR sheet_id = $1)
        AND ($2::int IS NULL OR source_id = $2)
        AND ($3::int IS NULL OR tenant_id = $3)
      ORDER BY updated_at DESC`,
    [sheetId, sourceId, tenantId]
  );
}

export async function saveDetectedMapping(input) {
  const {
    sourceId = null, sheetId = null, tenantId = null,
    originalHeader, canonicalField, displayLabel = null,
    dataType = "unknown", confidence = 0, source = "auto_detected", req = null,
  } = input || {};
  if (!originalHeader || !isCanonicalAllowed(canonicalField)) return { ok: false, error: "invalid_mapping" };
  if (!VALID_SOURCES.has(source)) return { ok: false, error: "invalid_source" };
  if (!VALID_TYPES.has(dataType)) return { ok: false, error: "invalid_data_type" };
  if (Number(confidence) < 0.8) return { ok: false, error: "low_confidence_not_saved" };
  if (source === "fuzzy_match" && Number(confidence) < 0.85) return { ok: false, error: "low_fuzzy_confidence_not_saved" };

  const normalized = normalizeHeaderName(originalHeader);
  const approvedExisting = await query(
    `SELECT id FROM accounting_field_mappings
     WHERE is_active = TRUE AND approved_by_user = TRUE
       AND sheet_id = $1 AND normalized_header = $2 AND canonical_field = $3
     LIMIT 1`,
    [sheetId, normalized, canonicalField]
  );
  if (approvedExisting.length) return { ok: true, skipped: "approved_exists" };

  const rows = await query(
    `INSERT INTO accounting_field_mappings
      (tenant_id, user_id, sheet_id, source_id, original_header, normalized_header, canonical_field, display_label, data_type, confidence, source, approved_by_user, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,TRUE)
     ON CONFLICT (sheet_id, normalized_header, canonical_field, is_active)
     WHERE is_active = TRUE
     DO UPDATE SET confidence = GREATEST(accounting_field_mappings.confidence, EXCLUDED.confidence),
                   source = EXCLUDED.source,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [tenantId, null, sheetId, sourceId, originalHeader, normalized, canonicalField, displayLabel, dataType, Number(confidence), source]
  );
  await writeAuditLog({ req, action: "mapping_detected", resourceType: "sheet", resourceId: sheetId, metadata: { header: originalHeader, canonicalField, confidence, source } }).catch(() => {});
  return { ok: true, mapping: rows[0] };
}

export async function approveMapping({ sourceId = null, sheetId = null, tenantId = null, userId = null, originalHeader, canonicalField, req = null }) {
  if (!originalHeader || !isCanonicalAllowed(canonicalField)) return { ok: false, error: "invalid_mapping" };
  const normalized = normalizeHeaderName(originalHeader);
  const rows = await query(
    `UPDATE accounting_field_mappings
        SET approved_by_user = TRUE,
            approved_by_user_id = $1,
            approved_at = CURRENT_TIMESTAMP,
            source = 'user_approved',
            updated_at = CURRENT_TIMESTAMP
      WHERE is_active = TRUE
        AND sheet_id = $2
        AND normalized_header = $3
        AND canonical_field = $4
      RETURNING *`,
    [userId, sheetId, normalized, canonicalField]
  );
  if (!rows.length) {
    const inserted = await query(
      `INSERT INTO accounting_field_mappings
        (tenant_id, user_id, sheet_id, source_id, original_header, normalized_header, canonical_field, display_label, data_type, confidence, source, approved_by_user, approved_by_user_id, approved_at, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unknown',1.0,'user_approved',TRUE,$2,CURRENT_TIMESTAMP,TRUE)
       RETURNING *`,
      [tenantId, userId, sheetId, sourceId, originalHeader, normalized, canonicalField, canonicalField]
    );
    await writeAuditLog({ req, action: "mapping_approved", resourceType: "sheet", resourceId: sheetId, metadata: { header: originalHeader, canonicalField } }).catch(() => {});
    return { ok: true, mapping: inserted[0] };
  }
  await writeAuditLog({ req, action: "mapping_approved", resourceType: "sheet", resourceId: sheetId, metadata: { header: originalHeader, canonicalField } }).catch(() => {});
  return { ok: true, mapping: rows[0] };
}

export async function rejectMapping({ sourceId = null, sheetId = null, tenantId = null, userId = null, originalHeader, canonicalField, reason = "", req = null }) {
  const normalized = normalizeHeaderName(originalHeader);
  await query(
    `UPDATE accounting_field_mappings
        SET is_active = FALSE,
            rejected_at = CURRENT_TIMESTAMP,
            rejected_by_user_id = $1,
            rejection_reason = $2,
            updated_at = CURRENT_TIMESTAMP
      WHERE sheet_id = $3 AND normalized_header = $4 AND canonical_field = $5 AND is_active = TRUE`,
    [userId, reason || "rejected_by_user", sheetId, normalized, canonicalField]
  );
  await writeAuditLog({ req, action: "mapping_rejected", resourceType: "sheet", resourceId: sheetId, metadata: { header: originalHeader, canonicalField, reason } }).catch(() => {});
  return { ok: true };
}

export async function correctMapping({ sourceId = null, sheetId = null, tenantId = null, userId = null, originalHeader, oldCanonicalField, newCanonicalField, req = null }) {
  if (!isCanonicalAllowed(newCanonicalField)) return { ok: false, error: "invalid_new_canonical_field" };
  const normalized = normalizeHeaderName(originalHeader);
  await rejectMapping({ sourceId, sheetId, tenantId, userId, originalHeader, canonicalField: oldCanonicalField, reason: "corrected_by_user", req });
  const approved = await approveMapping({ sourceId, sheetId, tenantId, userId, originalHeader, canonicalField: newCanonicalField, req });
  await writeAuditLog({ req, action: "mapping_corrected", resourceType: "sheet", resourceId: sheetId, metadata: { header: originalHeader, oldCanonicalField, newCanonicalField } }).catch(() => {});
  return approved;
}
