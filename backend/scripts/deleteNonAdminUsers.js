import { getClient } from "../src/config/db.js";

async function run() {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const idsRes = await client.query("SELECT id FROM users WHERE LOWER(role) <> 'admin'");
    const userIds = idsRes.rows.map((r) => Number(r.id)).filter((v) => Number.isInteger(v));
    if (!userIds.length) {
      await client.query("COMMIT");
      console.log(JSON.stringify({ success: true, deletedUsers: 0, deletedMemberships: 0 }));
      return;
    }

    const membershipsRes = await client.query("DELETE FROM user_groups WHERE user_id = ANY($1::int[])", [userIds]);
    const usersRes = await client.query("DELETE FROM users WHERE id = ANY($1::int[])", [userIds]);

    await client.query("COMMIT");
    console.log(JSON.stringify({
      success: true,
      deletedUsers: usersRes.rowCount || 0,
      deletedMemberships: membershipsRes.rowCount || 0,
    }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err?.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

run();
