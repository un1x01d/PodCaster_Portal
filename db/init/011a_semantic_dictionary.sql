CREATE TABLE IF NOT EXISTS semantic_dictionary (
    id BIGSERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    synonym TEXT NOT NULL,
    group_id BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_semantic_dictionary_key
  ON semantic_dictionary (category, language, synonym, group_id);

