import pg from "pg";
import { AsyncLocalStorage } from "async_hooks";
import { encryptSettingValue } from "../utils/settingsCrypto.js";
import { hashPassword } from "../utils/security.js";
const { Pool } = pg;

const tenantDbContext = new AsyncLocalStorage();
const tenantPools = new Map();

function parsePositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildConnectionConfig(overrides = {}) {
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (connectionString) {
    if (!overrides.database) return { connectionString };
    const next = new URL(connectionString);
    next.pathname = `/${encodeURIComponent(overrides.database)}`;
    return { connectionString: next.toString() };
  }
  const host = String(process.env.POSTGRES_HOST || process.env.PGHOST || "").trim();
  const user = String(process.env.POSTGRES_USER || process.env.PGUSER || "").trim();
  const database = String(process.env.POSTGRES_DB || process.env.PGDATABASE || "").trim();
  const password = String(process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || "").trim();
  const port = parsePositiveIntEnv("POSTGRES_PORT", parsePositiveIntEnv("PGPORT", 5432));
  return {
    host: host || undefined,
    user: user || undefined,
    database: overrides.database || database || undefined,
    password: password || undefined,
    port,
  };
}

const pool = new Pool({
  ...buildConnectionConfig(),
  max: parsePositiveIntEnv("DB_POOL_MAX", 10),
  idleTimeoutMillis: parsePositiveIntEnv("DB_POOL_IDLE_TIMEOUT_MS", 30000),
  connectionTimeoutMillis: parsePositiveIntEnv("DB_POOL_CONNECTION_TIMEOUT_MS", 10000),
  query_timeout: parsePositiveIntEnv("DB_QUERY_TIMEOUT_MS", 60000),
  statement_timeout: parsePositiveIntEnv("DB_STATEMENT_TIMEOUT_MS", 60000),
  idle_in_transaction_session_timeout: parsePositiveIntEnv("DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS", 60000),
});

function createPool(connectionConfig) {
  return new Pool({
    ...connectionConfig,
    max: parsePositiveIntEnv("TENANT_DB_POOL_MAX", parsePositiveIntEnv("DB_POOL_MAX", 10)),
    idleTimeoutMillis: parsePositiveIntEnv("TENANT_DB_POOL_IDLE_TIMEOUT_MS", parsePositiveIntEnv("DB_POOL_IDLE_TIMEOUT_MS", 30000)),
    connectionTimeoutMillis: parsePositiveIntEnv("DB_POOL_CONNECTION_TIMEOUT_MS", 10000),
    query_timeout: parsePositiveIntEnv("DB_QUERY_TIMEOUT_MS", 60000),
    statement_timeout: parsePositiveIntEnv("DB_STATEMENT_TIMEOUT_MS", 60000),
    idle_in_transaction_session_timeout: parsePositiveIntEnv("DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS", 60000),
  });
}

function activePool() {
  return tenantDbContext.getStore()?.pool || pool;
}

export async function query(sql, params) {
  const res = await activePool().query(sql, params);
  return res.rows;
}

export async function controlQuery(sql, params) {
  const res = await pool.query(sql, params);
  return res.rows;
}

export function getClient() {
  return activePool().connect();
}

export async function closeDbPool() {
  for (const tenantPool of tenantPools.values()) {
    await tenantPool.end();
  }
  tenantPools.clear();
  await pool.end();
}

export function isTenantDbIsolationEnabled() {
  const raw = String(process.env.TENANT_DB_ISOLATION_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw);
}

function assertSafeIdentifier(value, label = "identifier") {
  const text = String(value || "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(text)) {
    throw new Error(`invalid_${label}`);
  }
  return text;
}

function quoteIdentifier(value) {
  return `"${assertSafeIdentifier(value).replace(/"/g, '""')}"`;
}

function normalizeTenantDbPrefix() {
  const raw = String(process.env.TENANT_DB_PREFIX || "tenant").trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(normalized) ? normalized.slice(0, 32) : `t_${normalized}`.slice(0, 32);
}

export function tenantDatabaseNameForGroupId(groupId) {
  const gid = Number.parseInt(groupId, 10);
  if (!Number.isInteger(gid) || gid <= 0) throw new Error("invalid_group_id");
  return assertSafeIdentifier(`${normalizeTenantDbPrefix()}_g${gid}`, "tenant_database_name");
}

export async function getTenantPool(dbName) {
  const safeName = assertSafeIdentifier(dbName, "tenant_database_name");
  const existing = tenantPools.get(safeName);
  if (existing) return existing;
  const next = createPool(buildConnectionConfig({ database: safeName }));
  tenantPools.set(safeName, next);
  return next;
}

export function runWithDbPool(dbPool, callback) {
  return tenantDbContext.run({ pool: dbPool }, callback);
}

export async function forEachActiveTenantPool(callback) {
  if (!isTenantDbIsolationEnabled()) return;
  const rows = await controlQuery(
    "SELECT id, group_id, db_name FROM customers WHERE status = 'active' ORDER BY id ASC",
    []
  );
  for (const row of rows) {
    const tenantPool = await getTenantPool(row.db_name);
    await runWithDbPool(tenantPool, () => callback({ ...row, pool: tenantPool }));
  }
}

export async function migrateActiveTenantDatabases() {
  const migrated = [];
  await forEachActiveTenantPool(async (tenant) => {
    await initDb(tenant.pool, { seedDevAdmin: false, includeControlSchema: false });
    migrated.push({ customerId: tenant.id, groupId: tenant.group_id, dbName: tenant.db_name });
  });
  return migrated;
}

async function ensureDatabaseExists(dbName) {
  const safeName = assertSafeIdentifier(dbName, "tenant_database_name");
  const rows = await controlQuery("SELECT 1 FROM pg_database WHERE datname = $1 LIMIT 1", [safeName]);
  if (rows.length) return false;
  await pool.query(`CREATE DATABASE ${quoteIdentifier(safeName)}`);
  return true;
}

function slugifyCustomerName(name, groupId) {
  const base = String(name || "customer").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "customer";
  return `${base}-${groupId}`;
}

async function initControlSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      group_id INT UNIQUE REFERENCES groups(id) ON DELETE SET NULL,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      db_name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      schema_version INT NOT NULL DEFAULT 1,
      provisioned_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS group_id INT;`);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS slug TEXT;`);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;`);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS db_name TEXT;`);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1;`);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMP;`);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_group_id ON customers(group_id);`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_slug ON customers(slug);`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_db_name ON customers(db_name);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);`);
}

async function seedTenantCustomerShell(tenantPool, group) {
  const entitlements = group.entitlements && typeof group.entitlements === "object" ? group.entitlements : {};
  await tenantPool.query(
    `INSERT INTO groups (id, name, max_file_size_mb, max_total_storage_mb, entitlements, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6, CURRENT_TIMESTAMP))
     ON CONFLICT (id)
     DO UPDATE SET name = EXCLUDED.name,
                   max_file_size_mb = EXCLUDED.max_file_size_mb,
                   max_total_storage_mb = EXCLUDED.max_total_storage_mb,
                   entitlements = EXCLUDED.entitlements`,
    [
      group.id,
      group.name,
      group.max_file_size_mb || 100,
      group.max_total_storage_mb || 10240,
      JSON.stringify(entitlements),
      group.created_at || null,
    ]
  );
  await tenantPool.query("SELECT setval(pg_get_serial_sequence('groups','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM groups), 1), true)");
}

export async function provisionCustomerDatabase({ groupId, name }) {
  const gid = Number.parseInt(groupId, 10);
  if (!Number.isInteger(gid) || gid <= 0) throw new Error("invalid_group_id");
  const groupRows = await controlQuery(
    "SELECT id, name, max_file_size_mb, max_total_storage_mb, entitlements, created_at FROM groups WHERE id = $1 LIMIT 1",
    [gid]
  );
  if (!groupRows.length) throw new Error("group_not_found");
  const group = groupRows[0];
  const dbName = tenantDatabaseNameForGroupId(gid);
  const slug = slugifyCustomerName(name || group.name, gid);

  await controlQuery(
    `INSERT INTO customers (group_id, slug, name, db_name, status, updated_at)
     VALUES ($1, $2, $3, $4, 'provisioning', CURRENT_TIMESTAMP)
     ON CONFLICT (group_id)
     DO UPDATE SET name = EXCLUDED.name,
                   slug = EXCLUDED.slug,
                   db_name = EXCLUDED.db_name,
                   status = CASE WHEN customers.status = 'active' THEN customers.status ELSE 'provisioning' END,
                   updated_at = CURRENT_TIMESTAMP`,
    [gid, slug, group.name, dbName]
  );

  try {
    await ensureDatabaseExists(dbName);
    const tenantPool = await getTenantPool(dbName);
    await initDb(tenantPool, { seedDevAdmin: false, includeControlSchema: false });
    await seedTenantCustomerShell(tenantPool, group);
    const rows = await controlQuery(
      `UPDATE customers
          SET status = 'active',
              provisioned_at = COALESCE(provisioned_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
        WHERE group_id = $1
        RETURNING id, group_id, slug, name, db_name, status, schema_version, provisioned_at`,
      [gid]
    );
    return rows[0] || null;
  } catch (err) {
    await controlQuery(
      `UPDATE customers
          SET status = 'provisioning_failed',
              updated_at = CURRENT_TIMESTAMP
        WHERE group_id = $1`,
      [gid]
    ).catch(() => {});
    throw err;
  }
}

export async function syncCustomerGroupToTenant(groupId) {
  const gid = Number.parseInt(groupId, 10);
  if (!Number.isInteger(gid) || gid <= 0) return { synced: false, reason: "invalid_group_id" };
  const rows = await controlQuery(
    `SELECT c.db_name, c.status, g.id, g.name, g.max_file_size_mb, g.max_total_storage_mb, g.entitlements, g.created_at
       FROM customers c
       JOIN groups g ON g.id = c.group_id
      WHERE c.group_id = $1
      LIMIT 1`,
    [gid]
  );
  const record = rows[0];
  if (!record || record.status !== "active") return { synced: false, reason: "tenant_not_active" };
  const tenantPool = await getTenantPool(record.db_name);
  await seedTenantCustomerShell(tenantPool, record);
  return { synced: true, dbName: record.db_name };
}

export async function syncCustomerPrincipalToTenant({ groupId, userId }) {
  const gid = Number.parseInt(groupId, 10);
  const uid = Number.parseInt(userId, 10);
  if (!Number.isInteger(gid) || gid <= 0 || !Number.isInteger(uid) || uid <= 0) {
    return { synced: false, reason: "invalid_ids" };
  }
  const customerRows = await controlQuery(
    `SELECT c.db_name, c.status,
            g.id AS group_id, g.name AS group_name, g.max_file_size_mb, g.max_total_storage_mb, g.entitlements, g.created_at AS group_created_at,
            u.id AS user_id, u.email, u.password, u.role, u.default_view_id, u.first_name, u.last_name, u.company,
            u.password_reset_required, u.two_factor_enabled, u.two_factor_method, u.two_factor_totp_secret, u.two_factor_phone,
            ug.is_admin
       FROM customers c
       JOIN groups g ON g.id = c.group_id
       JOIN user_groups ug ON ug.group_id = g.id
       JOIN users u ON u.id = ug.user_id
      WHERE c.group_id = $1
        AND u.id = $2
      LIMIT 1`,
    [gid, uid]
  );
  const record = customerRows[0];
  if (!record || record.status !== "active") return { synced: false, reason: "tenant_not_active" };

  const tenantPool = await getTenantPool(record.db_name);
  await seedTenantCustomerShell(tenantPool, {
    id: record.group_id,
    name: record.group_name,
    max_file_size_mb: record.max_file_size_mb,
    max_total_storage_mb: record.max_total_storage_mb,
    entitlements: record.entitlements,
    created_at: record.group_created_at,
  });
  await tenantPool.query(
    `INSERT INTO users
        (id, email, password, role, default_view_id, first_name, last_name, company,
         password_reset_required, two_factor_enabled, two_factor_method, two_factor_totp_secret, two_factor_phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, FALSE), COALESCE($10, FALSE), $11, $12, $13)
     ON CONFLICT (id)
     DO UPDATE SET email = EXCLUDED.email,
                   password = EXCLUDED.password,
                   role = EXCLUDED.role,
                   default_view_id = EXCLUDED.default_view_id,
                   first_name = EXCLUDED.first_name,
                   last_name = EXCLUDED.last_name,
                   company = EXCLUDED.company,
                   password_reset_required = EXCLUDED.password_reset_required,
                   two_factor_enabled = EXCLUDED.two_factor_enabled,
                   two_factor_method = EXCLUDED.two_factor_method,
                   two_factor_totp_secret = EXCLUDED.two_factor_totp_secret,
                   two_factor_phone = EXCLUDED.two_factor_phone`,
    [
      record.user_id,
      record.email,
      record.password,
      record.role === "admin" ? "user" : record.role,
      record.default_view_id,
      record.first_name,
      record.last_name,
      record.company,
      record.password_reset_required,
      record.two_factor_enabled,
      record.two_factor_method,
      record.two_factor_totp_secret,
      record.two_factor_phone,
    ]
  );
  await tenantPool.query(
    `INSERT INTO user_groups (user_id, group_id, is_admin)
     VALUES ($1, $2, COALESCE($3, FALSE))
     ON CONFLICT (user_id, group_id)
     DO UPDATE SET is_admin = EXCLUDED.is_admin`,
    [record.user_id, record.group_id, record.is_admin]
  );
  await tenantPool.query("SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1), true)");
  await tenantPool.query("SELECT setval(pg_get_serial_sequence('user_groups','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM user_groups), 1), true)");
  return { synced: true, dbName: record.db_name };
}

export async function removeCustomerPrincipalFromTenant({ groupId, userId }) {
  const gid = Number.parseInt(groupId, 10);
  const uid = Number.parseInt(userId, 10);
  if (!Number.isInteger(gid) || gid <= 0 || !Number.isInteger(uid) || uid <= 0) {
    return { removed: false, reason: "invalid_ids" };
  }
  const rows = await controlQuery(
    "SELECT db_name, status FROM customers WHERE group_id = $1 LIMIT 1",
    [gid]
  );
  const customer = rows[0];
  if (!customer || customer.status !== "active") return { removed: false, reason: "tenant_not_active" };
  const tenantPool = await getTenantPool(customer.db_name);
  await tenantPool.query("DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2", [gid, uid]);
  return { removed: true, dbName: customer.db_name };
}

/**
 * DB init (idempotent + schema self-heal)
 */
export async function initDb(targetPool = pool, options = {}) {
  const db = targetPool;
  const seedDevAdmin = options.seedDevAdmin !== false;
  const includeControlSchema = options.includeControlSchema !== false;
  // USERS
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      default_view_id INT,
      two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      two_factor_method TEXT,
      two_factor_totp_secret TEXT,
      two_factor_phone TEXT
    );
  `);
  // Add column if missing (for existing DBs)
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_view_id INT;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN DEFAULT FALSE;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_method TEXT;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_totp_secret TEXT;`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_phone TEXT;`);
  await db.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';`);

  if (seedDevAdmin && process.env.NODE_ENV !== "production") {
    const adminEmail = process.env.DEV_ADMIN_EMAIL || "admin@example.com";
    const adminPassword = process.env.DEV_ADMIN_PASSWORD || "admin123";
    const adminHash = await hashPassword(adminPassword);

    await db.query(
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Add column if missing (for existing DBs)
  await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
  await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS max_file_size_mb INT DEFAULT 100;`);
  await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS max_total_storage_mb INT DEFAULT 10240;`);
  await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS entitlements JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  if (includeControlSchema) {
    await initControlSchema(db);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_monthly (
      group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      period_month TEXT NOT NULL,
      query_count INT NOT NULL DEFAULT 0,
      prompt_tokens BIGINT NOT NULL DEFAULT 0,
      completion_tokens BIGINT NOT NULL DEFAULT 0,
      estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
      provider TEXT,
      model TEXT,
      last_kind TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, period_month)
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_monthly_period ON ai_usage_monthly(period_month);`);

  // USER_GROUPS (membership)
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_groups (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      group_id INT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      UNIQUE(user_id, group_id)
    );
  `);
  await db.query(`ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`);

  // CUSTOMER USER INVITATIONS
  await db.query(`
    CREATE TABLE IF NOT EXISTS customer_user_invitations (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      company TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMP NOT NULL,
      accepted_at TIMESTAMP,
      accepted_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      revoked_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS company TEXT;`);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS token_hash TEXT;`);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS invited_by_user_id INT;`);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;`);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS accepted_user_id INT;`);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;`);
  await db.query(`ALTER TABLE customer_user_invitations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_user_invitations_token_hash ON customer_user_invitations(token_hash);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_user_invitations_group_email ON customer_user_invitations(group_id, email);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_user_invitations_expires_at ON customer_user_invitations(expires_at);`);

  // AUTH 2FA CHALLENGES
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_2fa_challenges (
      id TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT 'login',
      code_hash TEXT,
      phone TEXT,
      expires_at TIMESTAMP NOT NULL,
      consumed_at TIMESTAMP,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_2fa_challenges_user_created ON auth_2fa_challenges(user_id, created_at DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_2fa_challenges_expires ON auth_2fa_challenges(expires_at);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_totp_pending (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_user_totp_pending_expires ON user_totp_pending(expires_at);`);

  // Legacy folder model is deprecated. Report sources are now customer-scoped without folder dependencies.

  // REPORT SOURCES: stable business objects that can receive recurring imports.
  await db.query(`
    CREATE TABLE IF NOT EXISTS report_sources (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_by INT,
      current_sheet_id TEXT UNIQUE,
      is_inferred BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS created_by INT;`);
  await db.query(`ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS current_sheet_id TEXT UNIQUE;`);
  await db.query(`ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS is_inferred BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.query(`ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_report_sources_created_by ON report_sources(created_by);`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_report_sources_current_sheet_id ON report_sources(current_sheet_id);`);
  await db.query(`
    DO $$
    BEGIN
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS sheets (
      id TEXT PRIMARY KEY,
      uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      headers JSONB NOT NULL DEFAULT '[]'::jsonb,
      filename TEXT,
      active BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
  await db.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS totals_column TEXT;`);
  await db.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS stored_path TEXT;`);
  await db.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS tab_name TEXT;`);
  await db.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS tabs JSONB DEFAULT '[]'::jsonb;`);
  await db.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS display_name TEXT;`);
  await db.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS report_source_id INT;`);
  await db.query(`ALTER TABLE sheets ADD COLUMN IF NOT EXISTS source_version INT;`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sheets_report_source_id ON sheets(report_source_id);`);
  await db.query(`
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

  await db.query(`
    INSERT INTO report_sources (name, current_sheet_id, is_inferred, created_at, updated_at)
    SELECT COALESCE(NULLIF(s.display_name, ''), s.filename, s.id), s.id, TRUE, s.uploaded_at, CURRENT_TIMESTAMP
    FROM sheets s
    WHERE s.report_source_id IS NULL
    ON CONFLICT DO NOTHING;
  `);
  await db.query(`
    UPDATE report_sources
       SET is_inferred = TRUE
     WHERE created_by IS NULL
       AND current_sheet_id IS NOT NULL
       AND COALESCE(is_inferred, FALSE) = FALSE;
  `);
  await db.query(`
    UPDATE sheets s
       SET report_source_id = rs.id,
           source_version = COALESCE(s.source_version, 1)
      FROM report_sources rs
     WHERE s.report_source_id IS NULL
       AND rs.current_sheet_id = s.id;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS report_source_imports (
      id SERIAL PRIMARY KEY,
      report_source_id INT NOT NULL REFERENCES report_sources(id) ON DELETE CASCADE,
      sheet_id TEXT NOT NULL UNIQUE REFERENCES sheets(id) ON DELETE CASCADE,
      import_version INT NOT NULL,
      original_filename TEXT,
      imported_by INT REFERENCES users(id) ON DELETE SET NULL,
      schema_status TEXT NOT NULL DEFAULT 'new',
      schema_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS file_label TEXT;`);
  await db.query(`ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';`);
  await db.query(`ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;`);
  await db.query(`ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS published_by INT REFERENCES users(id) ON DELETE SET NULL;`);
  await db.query(`ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;`);
  await db.query(`ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS rejected_by INT REFERENCES users(id) ON DELETE SET NULL;`);
  await db.query(`ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS review_notes TEXT;`);
  await db.query(`ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS job_id TEXT;`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      mode TEXT NOT NULL DEFAULT 'sync',
      stage TEXT,
      requested_by INT REFERENCES users(id) ON DELETE SET NULL,
      report_source_id INT REFERENCES report_sources(id) ON DELETE SET NULL,
      sheet_id TEXT REFERENCES sheets(id) ON DELETE SET NULL,
      import_id INT,
      original_filename TEXT,
      error TEXT,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      -- Durable queue controls: attempts + lease fields support safe retries across restarts/scaling.
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,
      next_attempt_at TIMESTAMP,
      lease_owner TEXT,
      lease_expires_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;`);
  await db.query(`ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3;`);
  await db.query(`ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMP;`);
  await db.query(`ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT;`);
  await db.query(`ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP;`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_import_jobs_requested_by ON import_jobs(requested_by, created_at DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_import_jobs_report_source_id ON import_jobs(report_source_id, created_at DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status, created_at DESC);`);
  // Claim index keeps queue polling/claiming bounded under load.
  await db.query(`CREATE INDEX IF NOT EXISTS idx_import_jobs_queue_claim ON import_jobs(status, next_attempt_at, created_at ASC);`);

  // Temporary payload storage for async imports; payload is deleted after terminal job states.
  await db.query(`
    CREATE TABLE IF NOT EXISTS import_job_payloads (
      job_id TEXT PRIMARY KEY REFERENCES import_jobs(id) ON DELETE CASCADE,
      file_bytes BYTEA NOT NULL,
      content_type TEXT,
      byte_size BIGINT NOT NULL,
      payload_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_import_job_payloads_expires_at ON import_job_payloads(expires_at);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      request_id TEXT,
      ip TEXT,
      user_agent TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id, created_at DESC);`);
  await db.query(`
    UPDATE report_source_imports
       SET status = 'published',
           published_at = COALESCE(published_at, created_at),
           published_by = COALESCE(published_by, imported_by)
     WHERE status IS NULL OR status = 'published';
  `);
  
  // Migration: set file_label from sheet display_name if null
  await db.query(`
    UPDATE report_source_imports rsi
       SET file_label = COALESCE(s.display_name, s.filename, 'File')
      FROM sheets s
     WHERE s.id = rsi.sheet_id
       AND rsi.file_label IS NULL;
  `);

  // Drop old constraints/indexes that interfere with version recalculation
  await db.query(`ALTER TABLE report_source_imports DROP CONSTRAINT IF EXISTS report_source_imports_report_source_id_import_version_key CASCADE;`);
  await db.query(`DROP INDEX IF EXISTS idx_report_source_imports_source_version;`);

  // Migration: Recalculate versions to be scoped by (source, label)
  await db.query(`
    WITH new_versions AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY report_source_id, file_label ORDER BY created_at ASC) as new_v
        FROM report_source_imports
    )
    UPDATE report_source_imports
    SET import_version = nv.new_v
    FROM new_versions nv
    WHERE report_source_imports.id = nv.id;
  `);

  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rsi_source_label_version ON report_source_imports(report_source_id, file_label, import_version);`);
  
  await db.query(`CREATE INDEX IF NOT EXISTS idx_report_source_imports_source_id ON report_source_imports(report_source_id);`);

  // SHEET DATA (JSONB rows)
  await db.query(`
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

  await db.query(`ALTER TABLE sheet_rows ADD COLUMN IF NOT EXISTS tab_name TEXT;`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sheet_rows_tab ON sheet_rows(sheet_id, tab_name);`);

  // Multiple active sheets can coexist (customer/source scoped behavior).
  await db.query(`DROP INDEX IF EXISTS sheets_one_active_true_idx;`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sheets_active ON sheets(active);`);


  // GOOGLE TOKENS (for Google SSO + Drive integration)
  await db.query(`
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
  await db.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS google_sub TEXT;`);
  await db.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS access_token TEXT;`);
  await db.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS refresh_token TEXT;`);
  await db.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS scope TEXT;`);
  await db.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'Bearer';`);
  await db.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
  await db.query(`ALTER TABLE user_google_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

  // DROPBOX TOKENS (for Dropbox import integration)
  await db.query(`
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
  await db.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS dropbox_account_id TEXT;`);
  await db.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS access_token TEXT;`);
  await db.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS refresh_token TEXT;`);
  await db.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS scope TEXT;`);
  await db.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'Bearer';`);
  await db.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
  await db.query(`ALTER TABLE user_dropbox_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

  // ONEDRIVE TOKENS (for OneDrive import integration)
  await db.query(`
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
  await db.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS drive_id TEXT;`);
  await db.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS access_token TEXT;`);
  await db.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS refresh_token TEXT;`);
  await db.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS scope TEXT;`);
  await db.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'Bearer';`);
  await db.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
  await db.query(`ALTER TABLE user_onedrive_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);

  // APP SETTINGS
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('google_integration', '{"enabled": true}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO NOTHING;
  `);
  await db.query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('dropbox_integration', '{"enabled": true}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO NOTHING;
  `);
  await db.query(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('onedrive_integration', '{"enabled": true}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO NOTHING;
  `);
  await db.query(`
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
  await db.query(
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
  await db.query(
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
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('onedrive_oauth', $1::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO NOTHING;`,
    [JSON.stringify(oneDriveOauthSeed)]
  );
  // Legacy permissions tables were replaced by view-based assignment model.
  await db.query(`DROP TABLE IF EXISTS permissions;`);
  await db.query(`DROP TABLE IF EXISTS group_permissions;`);

  // VIEWS (locked)
  await db.query(`
    CREATE TABLE IF NOT EXISTS views (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sheet_id TEXT,
      report_source_id INT REFERENCES report_sources(id) ON DELETE CASCADE,
      file_label TEXT,
      is_global BOOLEAN DEFAULT FALSE,
      config JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INT NOT NULL
    );
  `);
  await db.query(`ALTER TABLE views ALTER COLUMN sheet_id DROP NOT NULL;`);
  await db.query(`ALTER TABLE views ADD COLUMN IF NOT EXISTS report_source_id INT REFERENCES report_sources(id) ON DELETE CASCADE;`);
  await db.query(`ALTER TABLE views ADD COLUMN IF NOT EXISTS file_label TEXT;`);
  await db.query(`ALTER TABLE views ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT FALSE;`);
  
  await db.query(`CREATE INDEX IF NOT EXISTS idx_views_sheet_id ON views(sheet_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_views_report_source_id ON views(report_source_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_views_is_global ON views(is_global);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_views_created_by ON views(created_by);`);
  await db.query(`
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS view_user_permissions (
      id SERIAL PRIMARY KEY,
      view_id INT NOT NULL,
      user_id INT NOT NULL,
      UNIQUE (view_id, user_id)
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_view_user_permissions_view_id ON view_user_permissions(view_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_view_user_permissions_user_id ON view_user_permissions(user_id);`);
  await db.query(`
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
  await db.query(`DROP TABLE IF EXISTS view_group_permissions;`);

  // Insight settings (per sheet)
  await db.query(`
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
  await db.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS sensitivity NUMERIC NOT NULL DEFAULT 1;`);
  await db.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS min_impact_percent NUMERIC NOT NULL DEFAULT 5;`);
  await db.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS muted_metrics JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await db.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS preferred_date_column TEXT;`);
  await db.query(`ALTER TABLE insight_settings ADD COLUMN IF NOT EXISTS preferred_metric_column TEXT;`);
  // --- SEMANTIC BRAIN & RATIOS ---
  await db.query(`
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
      await db.query(`INSERT INTO semantic_dictionary (category, language, synonym) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [entry.cat, entry.lang, term]);
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
    await db.query(`INSERT INTO financial_ratios (name, match_pattern, formula_type, required_buckets) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING`, [ratio.name, ratio.match, ratio.type, JSON.stringify(ratio.buckets)]);
  }
}

export default pool;
