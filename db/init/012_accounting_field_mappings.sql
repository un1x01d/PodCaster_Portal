CREATE TABLE IF NOT EXISTS accounting_field_mappings (
  id SERIAL PRIMARY KEY,
  tenant_id INT NULL,
  user_id INT NULL,
  sheet_id TEXT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  source_id INT NULL,
  original_header TEXT NOT NULL,
  normalized_header TEXT NOT NULL,
  canonical_field TEXT NOT NULL,
  display_label TEXT NULL,
  data_type TEXT NOT NULL DEFAULT 'unknown',
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  approved_by_user BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by_user_id INT NULL,
  approved_at TIMESTAMP NULL,
  rejected_at TIMESTAMP NULL,
  rejected_by_user_id INT NULL,
  rejection_reason TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_afm_sheet ON accounting_field_mappings(sheet_id);
CREATE INDEX IF NOT EXISTS idx_afm_tenant ON accounting_field_mappings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_afm_canonical ON accounting_field_mappings(canonical_field);
CREATE INDEX IF NOT EXISTS idx_afm_active ON accounting_field_mappings(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_afm_active_mapping
  ON accounting_field_mappings(sheet_id, normalized_header, canonical_field, is_active)
  WHERE is_active = TRUE;
