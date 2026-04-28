CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  password TEXT,
  role TEXT,
  default_view_id INTEGER
);

CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  headers JSONB
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  sheet_id TEXT,
  user_id INT,
  allowed_columns JSONB,
  row_filters JSONB
);

INSERT INTO users (email, password, role)
VALUES ('admin@example.com', 'admin123', 'admin')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS views (
  id SERIAL PRIMARY KEY,
  name TEXT,
  sheet_id TEXT,
  config JSONB,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS view_user_permissions (
  view_id INTEGER,
  user_id INTEGER,
  PRIMARY KEY (view_id, user_id)
);

CREATE TABLE IF NOT EXISTS view_group_permissions (
  view_id INTEGER,
  group_id INTEGER,
  PRIMARY KEY (view_id, group_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id INTEGER,
  group_id INTEGER,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS group_sheet_permissions (
  id SERIAL PRIMARY KEY,
  group_id INTEGER,
  sheet_id TEXT,
  allowed_columns JSONB,
  row_filters JSONB
);

