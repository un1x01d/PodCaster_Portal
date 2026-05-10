CREATE TABLE IF NOT EXISTS ai_learning_events (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NULL,
  sheet_id TEXT NULL,
  user_id INT NULL REFERENCES users(id) ON DELETE SET NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  question TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  detected_intent TEXT NOT NULL DEFAULT 'unknown',
  resolved_metric TEXT NULL,
  years_detected JSONB NOT NULL DEFAULT '[]'::jsonb,
  executed_operation TEXT NOT NULL DEFAULT 'none',
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','no_data','error')),
  latency_ms INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_learning_candidates (
  id BIGSERIAL PRIMARY KEY,
  locale TEXT NOT NULL DEFAULT 'en',
  phrase TEXT NOT NULL,
  suggested_intent TEXT NOT NULL,
  suggested_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_count INT NOT NULL DEFAULT 1,
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_rule_id BIGINT NULL REFERENCES ai_learning_rules(id) ON DELETE SET NULL,
  reviewed_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_events_created ON ai_learning_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_learning_events_intent ON ai_learning_events (detected_intent, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_learning_candidates_unique_pending
  ON ai_learning_candidates (locale, phrase, suggested_intent)
  WHERE status = 'pending';
