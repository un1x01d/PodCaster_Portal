import pg from "pg";
import { encryptSettingValue } from "../utils/settingsCrypto.js";
import { hashPassword } from "../utils/security.js";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query(sql, params) {
  const res = await pool.query(sql, params);
  return res.rows;
}

export function getClient() {
  return pool.connect();
}

export async function closeDbPool() {
  await pool.end();
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';`);

  if (process.env.NODE_ENV !== "production") {
    const adminEmail = process.env.DEV_ADMIN_EMAIL || "admin@example.com";
    const adminPassword = process.env.DEV_ADMIN_PASSWORD || "admin123";
    const adminHash = await hashPassword(adminPassword);

    await pool.query(
      `
        INSERT INTO users (email, password, role, password_reset_required)
        VALUES ($1, $2, 'admin', FALSE)
        ON CONFLICT (email)
        DO UPDATE SET
          password = EXCLUDED.password,
          role = 'admin',
          password_reset_required = FALSE
      `,
      [adminEmail, adminHash]
    );
  }

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
  await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS max_total_storage_mb INT DEFAULT 10240;`);

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
  await pool.query(`ALTER TABLE folders ADD COLUMN IF NOT EXISTS owner_user_id INT;`);
  await pool.query(`ALTER TABLE folders ADD COLUMN IF NOT EXISTS max_file_size_mb INT DEFAULT 100;`);
  await pool.query(`ALTER TABLE folders ADD COLUMN IF NOT EXISTS max_total_size_mb INT DEFAULT 1024;`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='folders' AND constraint_name='folders_owner_user_fk'
      ) THEN
        ALTER TABLE folders
          ADD CONSTRAINT folders_owner_user_fk
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
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

  // REPORT SOURCES: stable business objects that can receive recurring imports.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_sources (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      folder_id INT,
      created_by INT,
      current_sheet_id TEXT UNIQUE,
      is_inferred BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS folder_id INT;`);
  await pool.query(`ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS created_by INT;`);
  await pool.query(`ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS current_sheet_id TEXT UNIQUE;`);
  await pool.query(`ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS is_inferred BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_sources_folder_id ON report_sources(folder_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_sources_created_by ON report_sources(created_by);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_report_sources_current_sheet_id ON report_sources(current_sheet_id);`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='report_sources' AND constraint_name='report_sources_folder_fk'
      ) THEN
        ALTER TABLE report_sources
          ADD CONSTRAINT report_sources_folder_fk
          FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='report_sources' AND constraint_name='report_sources_created_by_fk'
      ) THEN
        ALTER TABLE report_sources
          ADD CONSTRAINT report_sources_created_by_fk
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
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
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS report_source_id INT;`);
  await pool.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS source_version INT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sheets_report_source_id ON sheets(report_source_id);`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='sheets' AND constraint_name='sheets_report_source_fk'
      ) THEN
        ALTER TABLE sheets
          ADD CONSTRAINT sheets_report_source_fk
          FOREIGN KEY (report_source_id) REFERENCES report_sources(id) ON DELETE SET NULL NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='report_sources' AND constraint_name='report_sources_current_sheet_fk'
      ) THEN
        ALTER TABLE report_sources
          ADD CONSTRAINT report_sources_current_sheet_fk
          FOREIGN KEY (current_sheet_id) REFERENCES sheets(id) ON DELETE SET NULL NOT VALID;
      END IF;
    END $$;
  `);

  await pool.query(`
    INSERT INTO report_sources (name, folder_id, current_sheet_id, is_inferred, created_at, updated_at)
    SELECT COALESCE(NULLIF(s.display_name, ''), s.filename, s.id), s.folder_id, s.id, TRUE, s.uploaded_at, CURRENT_TIMESTAMP
    FROM sheets s
    WHERE s.report_source_id IS NULL
    ON CONFLICT DO NOTHING;
  `);
  await pool.query(`
    UPDATE report_sources
       SET is_inferred = TRUE
     WHERE created_by IS NULL
       AND current_sheet_id IS NOT NULL
       AND COALESCE(is_inferred, FALSE) = FALSE;
  `);
  await pool.query(`
    UPDATE sheets s
       SET report_source_id = rs.id,
           source_version = COALESCE(s.source_version, 1)
      FROM report_sources rs
     WHERE s.report_source_id IS NULL
       AND rs.current_sheet_id = s.id;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_source_imports (
      id SERIAL PRIMARY KEY,
      report_source_id INT NOT NULL REFERENCES report_sources(id) ON DELETE CASCADE,
      sheet_id TEXT NOT NULL UNIQUE REFERENCES sheets(id) ON DELETE CASCADE,
      import_version INT NOT NULL,
      original_filename TEXT,
      imported_by INT REFERENCES users(id) ON DELETE SET NULL,
      schema_status TEXT NOT NULL DEFAULT 'new',
      schema_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(report_source_id, import_version)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_source_imports_source_id ON report_source_imports(report_source_id);`);

  // SHEET DATA (JSONB rows)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sheet_rows (
      id SERIAL PRIMARY KEY,
      sheet_id TEXT REFERENCES sheets(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      row_data JSONB NOT NULL,
      tab_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sheet_rows_sheet_id ON sheet_rows(sheet_id);
    CREATE INDEX IF NOT EXISTS idx_sheet_rows_pagination ON sheet_rows(sheet_id, row_index);
    CREATE INDEX IF NOT EXISTS idx_sheet_rows_row_data_gin ON sheet_rows USING gin(row_data);
  `);

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

  // ONEDRIVE TOKENS (for OneDrive import integration)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_onedrive_tokens (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      drive_id TEXT,
      access_token TEXT,
      refresh_token TEXT,
      scope TEXT,
      token_type TEXT DEFAULT 'Bearer',
      expires_at TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS drive_id TEXT;`);
  await pool.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS access_token TEXT;`);
  await pool.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS refresh_token TEXT;`);
  await pool.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS scope TEXT;`);
  await pool.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'Bearer';`);
  await pool.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
  await pool.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

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
  await pool.query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('onedrive_integration', '{"enabled": true}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (
      'chat_tts_settings',
      '{
        "voices": {"default":"nova","es":"shimmer","uk":"nova","ru":"nova"},
        "models": {"en":"tts-1","default":"tts-1-hd"},
        "speed": {"default":0.9}
      }'::jsonb,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (key) DO NOTHING;
  `);
  const googleOauthSeed = {
    clientId: encryptSettingValue(""),
    clientSecret: encryptSettingValue(""),
    redirectUri: "",
    frontendUrl: "http://localhost:5173",
  };
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('google_oauth', $1::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO NOTHING;`,
    [JSON.stringify(googleOauthSeed)]
  );
  const dropboxOauthSeed = {
    clientId: encryptSettingValue(""),
    clientSecret: encryptSettingValue(""),
    redirectUri: "",
    frontendUrl: "http://localhost:5173",
  };
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('dropbox_oauth', $1::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO NOTHING;`,
    [JSON.stringify(dropboxOauthSeed)]
  );
  const oneDriveOauthSeed = {
    clientId: encryptSettingValue(""),
    clientSecret: encryptSettingValue(""),
    redirectUri: "",
    frontendUrl: "http://localhost:5173",
  };
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('onedrive_oauth', $1::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO NOTHING;`,
    [JSON.stringify(oneDriveOauthSeed)]
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_permissions_sheet_id ON permissions(sheet_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_permissions_user_id ON permissions(user_id);`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='permissions' AND constraint_name='permissions_sheet_fk'
      ) THEN
        ALTER TABLE permissions
          ADD CONSTRAINT permissions_sheet_fk
          FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='permissions' AND constraint_name='permissions_user_fk'
      ) THEN
        ALTER TABLE permissions
          ADD CONSTRAINT permissions_user_fk
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_group_permissions_sheet_id ON group_permissions(sheet_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_group_permissions_group_id ON group_permissions(group_id);`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='group_permissions' AND constraint_name='group_permissions_sheet_fk'
      ) THEN
        ALTER TABLE group_permissions
          ADD CONSTRAINT group_permissions_sheet_fk
          FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='group_permissions' AND constraint_name='group_permissions_group_fk'
      ) THEN
        ALTER TABLE group_permissions
          ADD CONSTRAINT group_permissions_group_fk
          FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_views_sheet_id ON views(sheet_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_views_created_by ON views(created_by);`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='views' AND constraint_name='views_sheet_fk'
      ) THEN
        ALTER TABLE views
          ADD CONSTRAINT views_sheet_fk
          FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='views' AND constraint_name='views_created_by_fk'
      ) THEN
        ALTER TABLE views
          ADD CONSTRAINT views_created_by_fk
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_view_user_permissions_view_id ON view_user_permissions(view_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_view_user_permissions_user_id ON view_user_permissions(user_id);`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='view_user_permissions' AND constraint_name='view_user_permissions_view_fk'
      ) THEN
        ALTER TABLE view_user_permissions
          ADD CONSTRAINT view_user_permissions_view_fk
          FOREIGN KEY (view_id) REFERENCES views(id) ON DELETE CASCADE NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='view_user_permissions' AND constraint_name='view_user_permissions_user_fk'
      ) THEN
        ALTER TABLE view_user_permissions
          ADD CONSTRAINT view_user_permissions_user_fk
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS view_group_permissions (
      id SERIAL PRIMARY KEY,
      view_id INT NOT NULL,
      group_id INT NOT NULL,
      UNIQUE (view_id, group_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_view_group_permissions_view_id ON view_group_permissions(view_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_view_group_permissions_group_id ON view_group_permissions(group_id);`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='view_group_permissions' AND constraint_name='view_group_permissions_view_fk'
      ) THEN
        ALTER TABLE view_group_permissions
          ADD CONSTRAINT view_group_permissions_view_fk
          FOREIGN KEY (view_id) REFERENCES views(id) ON DELETE CASCADE NOT VALID;
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name='view_group_permissions' AND constraint_name='view_group_permissions_group_fk'
      ) THEN
        ALTER TABLE view_group_permissions
          ADD CONSTRAINT view_group_permissions_group_fk
          FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE NOT VALID;
      END IF;
    END $$;
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
  // --- SEMANTIC BRAIN & RATIOS ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS semantic_dictionary (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      language TEXT NOT NULL,
      synonym TEXT NOT NULL,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      UNIQUE (category, language, synonym, group_id)
    );
    CREATE TABLE IF NOT EXISTS financial_ratios (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      match_pattern TEXT NOT NULL,
      formula_type TEXT NOT NULL, -- 'margin', 'ratio', 'currency', 'months', 'weeks'
      required_buckets JSONB NOT NULL, -- e.g. ["revenue", "expense"]
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE
    );
  `);

  // SEED DICTIONARY (EN/RU/UK)
  const initialTerms = [
    { cat: 'revenue', lang: 'en', terms: ["revenue", "sales", "proceeds", "gross", "billings", "turnover", "receipts", "top line", "inflow", "collections", "volume", "top-line", "bookings", "gross-sales", "takings", "net-sales", "gross-revenue"] },
    { cat: 'revenue', lang: 'ru', terms: ["выручка", "оборот", "надходження", "продажі", "реализация", "реалізація", "кассовые", "чеки", "наторговали", "приход", "приток", "касса", "выработка", "дебет", "оборотка", "торговля"] },
    { cat: 'revenue', lang: 'uk', terms: ["виторг", "дохід", "оборот", "надходження", "продажі", "виторгували", "каса", "касові", "надходження", "прибутки"] },
    { cat: 'profit', lang: 'en', terms: ["income", "profit", "net", "earnings", "ebit", "ebitda", "margin", "gain", "profitability", "bottom line", "bottom-line", "surplus", "markup", "roi"] },
    { cat: 'profit', lang: 'ru', terms: ["доход", "прибыль", "маржа", "барыш", "заработок", "профит", "чистая прибыль", "рентабельность"] },
    { cat: 'profit', lang: 'uk', terms: ["прибуток", "чистий прибуток", "маржа", "рентабельність", "заробіток", "профіт", "надлишок"] },
    { cat: 'expense', lang: 'en', terms: ["expense", "cost", "spending", "cogs", "outgo", "expenditure", "burn", "overhead", "opex", "capex", "outflow", "payments", "disbursements", "fixed", "variable", "sg&a", "marketing", "procurement", "labor", "materials", "loss", "bill", "invoice", "charge", "refund", "discount", "fee", "payout", "cost-of-sales"] },
    { cat: 'expense', lang: 'ru', terms: ["расход", "издержки", "траты", "себестоимость", "опекс", "капекс", "закупка", "убыток", "минус", "оплата", "платеж", "списание", "счет", "усушка", "потеря", "трата", "амортизация", "налог", "аренда", "зарплата"] },
    { cat: 'expense', lang: 'uk', terms: ["витрати", "затрати", "видатки", "собівартість", "опекс", "капекс", "закупівля", "збиток", "мінус", "оплата", "платіж", "списання", "рахунок", "втрата", "трата", "амортизація", "податок", "оренда", "зарплата"] },

    { cat: 'asset', lang: 'en', terms: ["asset", "cash", "receivable", "inventory", "property", "equipment", "investment", "liquid", "balance", "capital", "reserves", "holdings", "bank", "treasury", "ar", "ppe", "equity", "resources", "stock", "fund", "wealth", "value", "security", "saving", "deposit", "portfolio"] },
    { cat: 'asset', lang: 'ru', terms: ["актив", "готівка", "наличность", "запаси", "имущество", "оборудование", "капитал", "дебиторка", "дебіторка", "склад", "остаток", "баланс", "власність", "кошти", "ресурс", "фонд", "вложение", "инвестиция", "собственность", "депозит", "счет", "нал"] },
    { cat: 'liability', lang: 'en', terms: ["liability", "debt", "loan", "payable", "obligation", "accrual", "ap", "credit", "mortgage", "borrowing", "interest", "tax", "due", "arrears", "unearned", "overdraft", "bond", "claim", "leverage", "finance", "draw"] },
    { cat: 'liability', lang: 'ru', terms: ["зобов'язання", "обязательство", "долг", "борг", "кредиторка", "задолженность", "пассив", "ссуда", "займ", "налоги", "податки", "пеня", "дефіцит", "кредит", "ипотека", "расписка", "вексель", "минус", "пассивы", "обязаловка", "недоимка"] },
    { cat: 'count', lang: 'en', terms: ["count", "employee", "headcount", "staff", "user", "customer", "client", "person", "member", "unit", "workforce", "personnel", "workers", "subscriber", "quantity", "volume", "lead", "seat", "head", "team", "people", "agent", "user-base", "population"] },
    { cat: 'count', lang: 'ru', terms: ["кількість", "сотрудник", "працівник", "штат", "персонал", "користувач", "клієнт", "участник", "единиц", "людей", "человек", "голов", "підписник", "база", "команда", "агент", "лид", "юзер", "рыло", "работник", "специалист", "кадры"] },
    { cat: 'date', lang: 'en', terms: ["date", "period", "time", "year", "month", "quarter", "fiscal", "timestamp", "occured", "day", "weekly", "daily", "annual", "dated", "timeline", "moment", "created", "hour", "history", "schedule", "calendar", "era", "term"] },
    { cat: 'date', lang: 'ru', terms: ["дата", "период", "період", "рік", "год", "місяць", "месяц", "час", "термін", "день", "квартал", "число", "момент", "строк", "время", "история", "график", "календарь", "эра", "срок", "длительность", "протяженность"] },
  ];

  for (const entry of initialTerms) {
    for (const term of entry.terms) {
      await pool.query(`INSERT INTO semantic_dictionary (category, language, synonym) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [entry.cat, entry.lang, term]);
    }
  }

  // SEED RATIOS
  const initialRatios = [
    { name: 'Gross Margin', match: 'gross margin|рентабельность|прибутковість', type: 'percent', buckets: ['revenue', 'expense'] },
    { name: 'Free Cash Flow', match: 'free cash flow|fcf|свободный денежный поток|вільний грошовий потік', type: 'currency', buckets: ['revenue', 'expense'] },
    { name: 'Burn Rate', match: 'burn rate|скорость сжигания|темп витрат', type: 'months', buckets: ['asset', 'expense'] },
    { name: 'DSO', match: 'dso|days sales outstanding|период оборачиваемости дебиторки', type: 'days', buckets: ['asset', 'revenue'] },
    { name: 'Current Ratio', match: 'current ratio|коэффициент ликвидности', type: 'ratio', buckets: ['asset', 'liability'] },
    { name: 'Revenue per Employee', match: 'revenue per employee|выручка на сотрудника', type: 'currency', buckets: ['revenue', 'count'] }
  ];

  for (const ratio of initialRatios) {
    await pool.query(`INSERT INTO financial_ratios (name, match_pattern, formula_type, required_buckets) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING`, [ratio.name, ratio.match, ratio.type, JSON.stringify(ratio.buckets)]);
  }
}

export default pool;
