-- USERS ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  password TEXT,
  role TEXT
);

-- SHEETS ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY,                                -- keep your TEXT PK
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  headers JSONB DEFAULT '[]'::jsonb,                  -- default for safety
  filename TEXT,                                      -- <-- needed by backend
  active BOOLEAN DEFAULT FALSE                        -- <-- needed by backend
);

-- At most one active sheet at a time
CREATE UNIQUE INDEX IF NOT EXISTS sheets_one_active_true_idx
  ON sheets (active) WHERE active;

-- PERMISSIONS ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  sheet_id TEXT,
  user_id INT,
  allowed_columns JSONB DEFAULT '[]'::jsonb,
  row_filters JSONB DEFAULT '{}'::jsonb
);

-- (Optional) lightweight FKs (won't fail if you ingest unknown sheet/user)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'permissions_user_fk'
  ) THEN
    ALTER TABLE permissions
      ADD CONSTRAINT permissions_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'permissions_sheet_fk'
  ) THEN
    ALTER TABLE permissions
      ADD CONSTRAINT permissions_sheet_fk
      FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE;
  END IF;
END $$;

-- SEED ADMIN -----------------------------------------------------------------
INSERT INTO users (email, password, role)
VALUES ('admin@example.com', 'admin123', 'admin')
ON CONFLICT (email) DO NOTHING;

