-- USERS ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password TEXT,            -- plain for now; switch to hash later
  role TEXT NOT NULL DEFAULT 'user'
);

-- helpful index for lookups by email (unique already, but keep explicit)
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- SHEETS ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY,                                -- backend expects TEXT PK
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  headers JSONB NOT NULL DEFAULT '[]'::jsonb,         -- safe default
  filename TEXT,
  display_name TEXT,
  active BOOLEAN NOT NULL DEFAULT FALSE               -- used by backend
);

ALTER TABLE sheets ADD COLUMN IF NOT EXISTS display_name TEXT;

-- At most one active sheet at a time
CREATE UNIQUE INDEX IF NOT EXISTS sheets_one_active_true_idx
  ON sheets (active) WHERE active;

-- PERMISSIONS ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  sheet_id TEXT NOT NULL,
  user_id INT NOT NULL,
  allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_filters JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Composite uniqueness for UPSERT in backend
CREATE UNIQUE INDEX IF NOT EXISTS permissions_uniq
  ON permissions (sheet_id, user_id);

-- Optional lightweight FKs ---------------------------------------------------
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
