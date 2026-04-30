-- GROUPS ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id INT NOT NULL,
  group_id INT NOT NULL,
  PRIMARY KEY (user_id, group_id)
);

-- Optional FKs (safe if users table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'user_groups_user_fk'
  ) THEN
    ALTER TABLE user_groups
      ADD CONSTRAINT user_groups_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'groups'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'user_groups_group_fk'
  ) THEN
    ALTER TABLE user_groups
      ADD CONSTRAINT user_groups_group_fk
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
  END IF;
END $$;

-- GROUP PERMISSIONS (same shape as user permissions, for the active-sheet model)
CREATE TABLE IF NOT EXISTS group_permissions (
  id SERIAL PRIMARY KEY,
  sheet_id TEXT NOT NULL,
  group_id INT NOT NULL,
  allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_filters JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS group_permissions_uniq
  ON group_permissions (sheet_id, group_id);

-- GROUPS
CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- GROUP MEMBERS
CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  UNIQUE (group_id, user_id)
);

-- db/init/040_groups.sql
CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
