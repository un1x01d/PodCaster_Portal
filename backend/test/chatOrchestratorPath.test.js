import test from "node:test";
import assert from "node:assert/strict";

test("auth refresh applies tenant context from DB row and does not trust stale token context", async () => {
  process.env.ALLOW_EPHEMERAL_JWT_SECRET = "true";
  const { applyRefreshedAuthContext } = await import(`../src/middleware/auth.js?t=${Date.now()}`);
  const stale = { id: 7, role: "user", tenant_database: "old_tenant", customer_id: 11 };
  const refreshed = applyRefreshedAuthContext(stale, {
    role: "user",
    is_group_admin: false,
    resolved_group_id: 17,
    customer_id: 99,
    customer_group_id: 17,
    tenant_database: "tenant_g17",
  });
  assert.equal(refreshed.customer_id, 99);
  assert.equal(refreshed.customer_group_id, 17);
  assert.equal(refreshed.tenant_database, "tenant_g17");
  assert.equal(refreshed.resolved_group_id, 17);
  assert.equal(refreshed.role, "user");
});
