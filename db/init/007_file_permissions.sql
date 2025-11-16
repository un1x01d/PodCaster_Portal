-- db/init/007_file_permissions.sql
CREATE TABLE IF NOT EXISTS file_permissions (
  id SERIAL PRIMARY KEY,
  sheet_id TEXT NOT NULL,
  user_id INT NOT NULL,
  UNIQUE (sheet_id, user_id)
);
