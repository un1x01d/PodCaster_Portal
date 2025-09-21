CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  password TEXT,
  role TEXT
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

