-- FOLDER-LEVEL PERMISSIONS -----------------------------------------------
-- Applies to all sheets stored in a folder. Works for groups and/or users.

CREATE TABLE IF NOT EXISTS folder_permissions (
  id SERIAL PRIMARY KEY,
  folder_id INT NOT NULL,
  group_id INT,            -- nullable; set either group_id OR user_id
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

-- Ensure uniqueness per scope
CREATE UNIQUE INDEX IF NOT EXISTS folder_permissions_group_uniq
  ON folder_permissions (folder_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS folder_permissions_user_uniq
  ON folder_permissions (folder_id, user_id)
  WHERE user_id IS NOT NULL;

