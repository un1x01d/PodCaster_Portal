import "dotenv/config";
import { closeDbPool, initDb, migrateActiveTenantDatabases } from "../src/config/db.js";

try {
  await initDb();
  const migrated = await migrateActiveTenantDatabases();
  console.log(`[tenant-db] migrated=${migrated.length}`);
  for (const tenant of migrated) {
    console.log(`[tenant-db] customer_id=${tenant.customerId} group_id=${tenant.groupId} db=${tenant.dbName}`);
  }
} catch (err) {
  console.error("[tenant-db] migration failed:", err?.message || err);
  process.exitCode = 1;
} finally {
  await closeDbPool().catch(() => {});
}
