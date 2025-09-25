-- FOLDERS (per group)
CREATE TABLE IF NOT EXISTS folders (
  id SERIAL PRIMARY KEY,
  group_id INT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS folders_group_name_uniq
  ON folders (group_id, name);

-- S HEETS: add folder_id (active per folder)
ALTER TABLE sheets
  ADD COLUMN IF NOT EXISTS group_id INT,
  ADD COLUMN IF NOT EXISTS folder_id INT;

-- Only one active sheet per folder
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'sheets_one_active_per_folder_idx'
  ) THEN
    CREATE UNIQUE INDEX sheets_one_active_per_folder_idx
      ON sheets (folder_id)
      WHERE active;
  END IF;
END $$;

-- Lightweight FKs (optional)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'folders_group_fk'
  ) THEN
    ALTER TABLE folders
      ADD CONSTRAINT folders_group_fk
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sheets_folder_fk'
  ) THEN
    ALTER TABLE sheets
      ADD CONSTRAINT sheets_folder_fk
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- USER FOLDER PERMISSIONS
CREATE TABLE IF NOT EXISTS user_folder_permissions (
  id SERIAL PRIMARY KEY,
  folder_id INT NOT NULL,
  user_id INT NOT NULL,
  allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_filters JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS user_folder_permissions_uniq
  ON user_folder_permissions (folder_id, user_id);

-- GROUP FOLDER PERMISSIONS
CREATE TABLE IF NOT EXISTS group_folder_permissions (
  id SERIAL PRIMARY KEY,
  folder_id INT NOT NULL,
  group_id INT NOT NULL,
  allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_filters JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS group_folder_permissions_uniq
  ON group_folder_permissions (folder_id, group_id);

