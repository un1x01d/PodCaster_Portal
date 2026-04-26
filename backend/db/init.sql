-- backend/db/init.sql
-- Postgres 15+

-- === USERS ===
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,               -- bcrypt hash
  role            VARCHAR(50) NOT NULL DEFAULT 'user',  -- admin | user | client | etc.
  allowed_columns JSONB DEFAULT '[]'::jsonb,   -- optional column allow-list per user
  row_filters     JSONB DEFAULT '{}'::jsonb,   -- optional row-level filters per user
  assigned_sheet  VARCHAR(255),                -- default sheet filename or label
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- === SHEETS ===
CREATE TABLE IF NOT EXISTS sheets (
  id          SERIAL PRIMARY KEY,
  filename    VARCHAR(255) NOT NULL,  -- original uploaded filename
  display_name VARCHAR(255),
  headers     JSONB NOT NULL,         -- normalized header list
  uploaded_at TIMESTAMP DEFAULT NOW(),
  active      BOOLEAN DEFAULT FALSE
);

ALTER TABLE sheets ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_sheets_filename ON sheets (filename);
CREATE INDEX IF NOT EXISTS idx_sheets_active ON sheets (active);

-- === PERMISSIONS (optional fine-grained controls) ===
CREATE TABLE IF NOT EXISTS permissions (
  id        SERIAL PRIMARY KEY,
  user_id   INT REFERENCES users(id) ON DELETE CASCADE,
  sheet_id  INT REFERENCES sheets(id) ON DELETE CASCADE,
  filters   JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_permissions_user ON permissions (user_id);
CREATE INDEX IF NOT EXISTS idx_permissions_sheet ON permissions (sheet_id);

-- === SEED ADMIN ===
-- Password is bcrypt hash of 'admin123'
-- To change, generate a new bcrypt hash and replace below.
INSERT INTO users (email, password_hash, role)
VALUES (
  'admin@example.com',
  '$2b$10$kPq2Nyp7E8QYy2sk6Y1teOQ7YF/4r0hYQ8N.XiS3I/4J0Y2PvjRae', -- bcrypt("admin123")
  'admin'
)
ON CONFLICT (email) DO NOTHING;

-- === OPTIONAL SAMPLE USERS (commented out) ===
-- INSERT INTO users (email, password_hash, role) VALUES
-- ('user1@example.com', '$2b$10$kPq2Nyp7E8QYy2sk6Y1teOQ7YF/4r0hYQ8N.XiS3I/4J0Y2PvjRae', 'user'),
-- ('client1@example.com',   '$2b$10$kPq2Nyp7E8QYy2sk6Y1teOQ7YF/4r0hYQ8N.XiS3I/4J0Y2PvjRae', 'client')
-- ON CONFLICT (email) DO NOTHING;
