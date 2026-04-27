import pg from "pg";
import { encryptSettingValue } from "../utils/settingsCrypto.js";
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';`);

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
      sheet_id TEXT REFERENCES sheets(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      row_data JSONB NOT NULL,
      tab_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sheet_rows_sheet_id ON sheet_rows(sheet_id);
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
    { cat: 'revenue', lang: 'en', terms: ["revenue", "income", "sales", "proceeds", "gross", "billings", "turnover", "ebit", "earn", "receipts", "top line", "inflow", "collections", "volume", "top-line", "accruals", "yield", "bookings", "gross-sales", "gain", "profitability", "takings", "earnings", "net-sales", "gross-revenue"] },
    { cat: 'revenue', lang: 'ru', terms: ["доход", "выручка", "прибуток", "оборот", "надходження", "продажі", "реализация", "кассовые", "чеки", "наторговали", "приход", "приток", "касса", "выработка", "дебет", "заработок", "профит", "маржа", "барыш", "оборотка", "торговля"] },
    { cat: 'expense', lang: 'en', terms: ["expense", "cost", "spending", "cogs", "outgo", "expenditure", "burn", "overhead", "opex", "capex", "outflow", "payments", "disbursements", "fixed", "variable", "sg&a", "marketing", "procurement", "labor", "materials", "loss", "bill", "invoice", "charge", "refund", "discount", "fee", "payout", "cost-of-sales"] },
    { cat: 'expense', lang: 'ru', terms: ["расход", "витрати", "затраты", "издержки", "траты", "себестоимость", "видатки", "собівартість", "опекс", "капекс", "закупка", "убыток", "минус", "оплата", "платеж", "списание", "счет", "усушка", "потеря", "трата", "амортизация", "налог", "аренда", "зарплата"] },
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
