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
      role TEXT NOT NULL DEFAULT 'producer',
      default_view_id INT
    );
  `);
  // Add column if missing (for existing DBs)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_view_id INT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN DEFAULT FALSE;`);

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

  // USER_GROUPS (membership)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_groups (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      group_id INT NOT NULL,
      UNIQUE(user_id, group_id)
    );
  `);

  // FOLDERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      group_id INT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`DROP INDEX IF EXISTS folders_group_unique;`);

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

  // seed admin
  await pool.query(`
    INSERT INTO users (email,password,role)
    VALUES ('admin@example.com','admin123','admin')
    ON CONFLICT (email) DO NOTHING;
  `);
}

export default pool;
