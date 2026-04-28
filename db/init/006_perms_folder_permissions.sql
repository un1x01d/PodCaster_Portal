-- 006_permissions_and_folder_perms.sql

-- 1) Ensure permissions has group_id
ALTER TABLE permissions
  ADD COLUMN IF NOT EXISTS group_id INT;

-- (Optional) FK to groups if you want referential integrity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'permissions_group_fk'
  ) THEN
    ALTER TABLE permissions
      ADD CONSTRAINT permissions_group_fk
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Ensure unique indexes that the backend expects are present
CREATE UNIQUE INDEX IF NOT EXISTS permissions_user_uniq
  ON permissions (sheet_id, user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS permissions_group_uniq
  ON permissions (sheet_id, group_id) WHERE group_id IS NOT NULL;

-- 2) Create folder_permissions (applies to all sheets in a folder)
CREATE TABLE IF NOT EXISTS folder_permissions (
  id SERIAL PRIMARY KEY,
  folder_id INT NOT NULL,
  group_id INT,
  user_id INT,
  allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT folder_permissions_scope_chk
    CHECK ((group_id IS NOT NULL AND user_id IS NULL) OR
           (group_id IS NULL AND user_id IS NOT NULL)),
  CONSTRAINT folder_permissions_folder_fk
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
  CONSTRAINT folder_permissions_group_fk
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  CONSTRAINT folder_permissions_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Uniqueness for each scope
CREATE UNIQUE INDEX IF NOT EXISTS folder_permissions_group_uniq
  ON folder_permissions (folder_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS folder_permissions_user_uniq
  ON folder_permissions (folder_id, user_id)
  WHERE user_id IS NOT NULL;

