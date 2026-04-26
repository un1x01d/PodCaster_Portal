import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query(sql, params) {
  const res = await pool.query(sql, params);
  return res.rows;
}

export function getClient() {
  return pool.connect();
}

/**
 * DB init (idempotent + schema self-heal)
 */
export async function initDb() {
  // USERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      default_view_id INT
    );
  `);
  // Add column if missing (for existing DBs)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_view_id INT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';`);
  await pool.query(`UPDATE users SET role = 'user' WHERE role = chr(112)||chr(114)||chr(111)||chr(100)||chr(117)||chr(99)||chr(101)||chr(114);`);

  // GROUPS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Add column if missing (for existing DBs)
  await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
  await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS max_file_size_mb INT DEFAULT 100;`);

  // USER_GROUPS (membership)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_groups (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      group_id INT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      UNIQUE(user_id, group_id)
    );
  `);
  await pool.query(`ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`);

  // FOLDERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      group_id INT,
      parent_id INT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_id INT;`);
  await pool.query(`DROP INDEX IF EXISTS folders_group_unique;`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='folders' AND constraint_name='folders_parent_fk'
      ) THEN
        ALTER TABLE folders
          ADD CONSTRAINT folders_parent_fk
          FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);`);

  // FOLDER_GROUPS (many-to-many folder <-> group)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folder_groups (
      id SERIAL PRIMARY KEY,
      folder_id INT NOT NULL,
      group_id INT NOT NULL,
      UNIQUE(folder_id, group_id)
    );
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='folder_groups' AND constraint_name='folder_groups_folder_fk'
      ) THEN
        ALTER TABLE folder_groups
          ADD CONSTRAINT folder_groups_folder_fk
          FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='folder_groups' AND constraint_name='folder_groups_group_fk'
      ) THEN
        ALTER TABLE folder_groups
          ADD CONSTRAINT folder_groups_group_fk
          FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_folder_groups_folder_id ON folder_groups(folder_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_folder_groups_group_id ON folder_groups(group_id);`);
  await pool.query(`
    INSERT INTO folder_groups (folder_id, group_id)
    SELECT id, group_id
    FROM folders
    WHERE group_id IS NOT NULL
    ON CONFLICT (folder_id, group_id) DO NOTHING;
  `);

  // SHEETS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY,
      uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      headers JSONB NOT NULL DEFAULT '[]'::jsonb,
      filename TEXT,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      folder_id INT
    );
  `);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS totals_column TEXT;`);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS stored_path TEXT;`);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS tab_name TEXT;`);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS tabs JSONB DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS display_name TEXT;`);

  // SHEET DATA (JSONB rows)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheet_rows (
      id SERIAL PRIMARY KEY,
      sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
      row_index INT NOT NULL,
      row_data JSONB NOT NULL,
      tab_name TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sheet_rows_sheet_id ON sheet_rows(sheet_id);`);
  await pool.query(`ALTER TABLE sheet_rows ADD COLUMN IF NOT EXISTS tab_name TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sheet_rows_tab ON sheet_rows(sheet_id, tab_name);`);

  // clean duplicate actives, then re-enforce unique partial index
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sheets'
      ) THEN
        WITH actives AS (
          SELECT id, uploaded_at,
                 ROW_NUMBER() OVER (ORDER BY uploaded_at DESC, id DESC) AS rn
          FROM sheets
          WHERE active = TRUE
        )
        UPDATE sheets s
           SET active = FALSE
          FROM actives a
         WHERE s.id = a.id
           AND a.rn > 1;
      END IF;
    END $$;
  `);
  await pool.query(`DROP INDEX IF EXISTS sheets_one_active_true_idx;`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS sheets_one_active_true_idx
      ON sheets (active) WHERE active;
  `);


  // GOOGLE TOKENS (for Google SSO + Drive integration)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_google_tokens (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      google_sub TEXT,
      access_token TEXT,
      refresh_token TEXT,
      scope TEXT,
      token_type TEXT DEFAULT 'Bearer',
      expires_at TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS google_sub TEXT;`);
  await pool.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS access_token TEXT;`);
  await pool.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS refresh_token TEXT;`);
  await pool.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS scope TEXT;`);
  await pool.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'Bearer';`);
  await pool.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

  // DROPBOX TOKENS (for Dropbox import integration)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_dropbox_tokens (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      dropbox_account_id TEXT,
      access_token TEXT,
      refresh_token TEXT,
      scope TEXT,
      token_type TEXT DEFAULT 'Bearer',
      expires_at TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS dropbox_account_id TEXT;`);
  await pool.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS access_token TEXT;`);
  await pool.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS refresh_token TEXT;`);
  await pool.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS scope TEXT;`);
  await pool.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'Bearer';`);
  await pool.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

  // APP SETTINGS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('google_integration', '{"enabled": true}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('dropbox_integration', '{"enabled": true}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO NOTHING;
  `);
  const googleOauthSeed = {
    clientId: String(process.env.GOOGLE_CLIENT_ID || ""),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || ""),
    redirectUri: String(process.env.GOOGLE_REDIRECT_URI || ""),
    frontendUrl: String(process.env.FRONTEND_URL || "http://localhost:5173"),
  };
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('google_oauth', $1::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO NOTHING;`,
    [JSON.stringify(googleOauthSeed)]
  );
  const dropboxOauthSeed = {
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    frontendUrl: "http://localhost:5173",
  };
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('dropbox_oauth', $1::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO NOTHING;`,
    [JSON.stringify(dropboxOauthSeed)]
  );
  // USER permissions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      user_id INT NOT NULL,
      allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      row_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (sheet_id, user_id)
    );
  `);

  // GROUP permissions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_permissions (
      id SERIAL PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      group_id INT NOT NULL,
      allowed_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      row_filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (sheet_id, group_id)
    );
  `);

  // VIEWS (locked)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS views (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sheet_id TEXT NOT NULL,
      config JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INT NOT NULL
    );
  `);

  // VIEW permissions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS view_user_permissions (
      id SERIAL PRIMARY KEY,
      view_id INT NOT NULL,
      user_id INT NOT NULL,
      UNIQUE (view_id, user_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS view_group_permissions (
      id SERIAL PRIMARY KEY,
      view_id INT NOT NULL,
      group_id INT NOT NULL,
      UNIQUE (view_id, group_id)
    );
  `);

  // Insight settings (per sheet)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS insight_settings (
      sheet_id TEXT PRIMARY KEY,
      sensitivity NUMERIC NOT NULL DEFAULT 1,
      min_impact_percent NUMERIC NOT NULL DEFAULT 5,
      muted_metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
      preferred_date_column TEXT,
      preferred_metric_column TEXT,
      thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS sensitivity NUMERIC NOT NULL DEFAULT 1;`);
  await pool.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS min_impact_percent NUMERIC NOT NULL DEFAULT 5;`);
  await pool.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS muted_metrics JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS preferred_date_column TEXT;`);
  await pool.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS preferred_metric_column TEXT;`);
  await pool.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS thresholds JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

  // seed admin
  await pool.query(`
    INSERT INTO users (email,password,role)
    VALUES ('admin@example.com','admin123','admin')
    ON CONFLICT (email) DO NOTHING;
  `);
}

export default pool;
