CREATE TABLE IF NOT EXISTS ai_learning_feedback (
  id BIGSERIAL PRIMARY KEY,
  sheet_id TEXT NULL,
  user_id INT NULL REFERENCES users(id) ON DELETE SET NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  question TEXT NOT NULL,
  bad_answer TEXT NOT NULL DEFAULT '',
  expected_answer TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_rule_id BIGINT NULL,
  reviewed_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_learning_rules (
  id BIGSERIAL PRIMARY KEY,
  source_feedback_id BIGINT NULL REFERENCES ai_learning_feedback(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global','group')),
  group_id INT NULL REFERENCES groups(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'en',
  phrase TEXT NOT NULL,
  mapped_intent TEXT NOT NULL,
  mapped_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','disabled')),
  approved_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_learning_feedback_approved_rule_id_fkey'
  ) THEN
    ALTER TABLE ai_learning_feedback
    ADD CONSTRAINT ai_learning_feedback_approved_rule_id_fkey
    FOREIGN KEY (approved_rule_id) REFERENCES ai_learning_rules(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ai_learning_feedback_status_created
  ON ai_learning_feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_learning_feedback_sheet_created
  ON ai_learning_feedback (sheet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_learning_rules_phrase_locale
  ON ai_learning_rules (locale, phrase);

INSERT INTO app_settings (key, value, updated_at)
VALUES (
  'ai_self_learning_settings',
  '{
    "enabled": false,
    "autoApplyApprovedRules": true,
    "autoApproveAllCandidates": false,
    "minConfidence": 0.75
  }'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO NOTHING;

UPDATE app_settings
SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{autoApproveAllCandidates}', 'false'::jsonb, true),
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'ai_self_learning_settings'
  AND NOT (COALESCE(value, '{}'::jsonb) ? 'autoApproveAllCandidates');
