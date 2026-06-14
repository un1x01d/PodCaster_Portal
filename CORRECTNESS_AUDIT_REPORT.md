# Deep Correctness Audit Report

## Executive Verdict

Overall risk: **HIGH**
Production readiness: **NOT READY**
Confidence: **HIGH**

Biggest confirmed defect: **Silent Privilege Demotion** (Promoting a user to Group Admin silently strips admin rights from all other admins in the group).
Biggest likely hidden defect: **Socket / Memory Leak** on AI TTS upstream errors.
Most dangerous data correctness risk: **Dynamic SQL Crash** in `deleteSheet` when executed against legacy database schemas.
Most dangerous auth/permission risk: **Tenant PII Desync** (Deleted users remain indefinitely in isolated tenant databases).
Most broken or incomplete flow: **Group Admin Management** (Fundamentally breaks multi-admin setups).
First fix to make: **Remove the blanket `is_admin = FALSE` update from `toggleGroupAdmin`.**

## Execution Map

* frontend entry: `frontend/src/main.jsx`
* backend entry: `backend/server.js`
* route registration: `server.js` directly mounts routers (`authRoutes`, `userRoutes`, `sheetRoutes`, etc.)
* auth middleware: `backend/src/middleware/auth.js` enforces JWT verification and initializes the tenant-specific AsyncLocalStorage context.
* database layer: `backend/src/config/db.js` handles both a central control pool and isolated tenant connection pools.
* major services: `sheetController.js` (monolithic spreadsheet orchestrator), `chatController.js` (AI TTS stream handling), `chatQueryV3Controller.js` (LLM-driven analysis).
* build/start commands: `npm start` -> `node --max-old-space-size=8192 server.js`

## Flow Results

| Flow            | Status                                   | Evidence      | Main Issue |
| --------------- | ---------------------------------------- | ------------- | ---------- |
| Startup         | Working                                  | `server.js`   | N/A |
| Auth/session    | Working                                  | `auth.js`     | JWT and tenant isolation functioning correctly. |
| API contract    | **Broken**                               | `sheetController.js:2892`| `persistImportJobPayload` is undefined, crashing email ingest. |
| Database access | **Broken**                               | `sheetController.js:5025`| Dynamically crafted SQL causes syntax crash on legacy schemas. |
| Upload/import   | Working                                  | `workbookParser.js`| File parsing is safely delegated to workers. |
| Permissions     | **Broken**                               | `userController.js:3152` | `toggleGroupAdmin` silently demotes other admins. |
| AI/calculation  | **Partial**                              | `chatController.js:636` | Upstream stream errors leak server sockets. |
| Export/download | Not present                              | N/A | N/A |
| Tests           | **Misleading**                           | `security.test.js` | Uses regex against source files instead of asserting runtime behavior. |

## Confirmed Defects

### DEFECT-001 — Silent Privilege Demotion in Group Admin Toggle

Severity: **Critical**
Category: Logic / Permission
Status: Confirmed
Confidence: High

Files:
* `backend/src/controllers/userController.js` (lines 3152-3153)
* `backend/src/controllers/user/groupRoutes.js` (lines 452-453)

What is broken:
When a platform admin or an existing group admin uses the UI to grant "Admin" rights to another user in their group, the backend silently strips admin rights from ALL other admins in that group.

Evidence:
```javascript
// backend/src/controllers/userController.js
if (!!isAdmin) {
    ...
    await client.query("UPDATE user_groups SET is_admin = FALSE WHERE group_id = $1", [numericGroupId]);
    await client.query("UPDATE user_groups SET is_admin = TRUE WHERE group_id = $1 AND user_id = $2", ...);
}
```

Why it fails:
The code explicitly forces `is_admin = FALSE` for every single member of the group before promoting the target user. However, the system fundamentally expects multiple admins to coexist (proven by the `adminCount <= 1` check in the demotion branch).

Impact:
If a company has three administrators, and Admin A tries to promote User B to admin, Admin A and Admin C instantly and silently lose their administrative privileges. 

How to reproduce:
Create a group with Admin A. Add User B. Have Admin A click the "Admin" button next to User B in the UI. Admin A immediately loses access to the admin dashboard.

Recommended fix:
Remove the `UPDATE user_groups SET is_admin = FALSE` line entirely. Only execute the `UPDATE ... SET is_admin = TRUE` for the specific `user_id`.

Regression test:
Create a group with User A and User B. Grant both admin status. Assert that `SELECT count(*) FROM user_groups WHERE is_admin=TRUE` equals `2`.

---

### DEFECT-002 — Server Socket / Memory Leak on AI TTS Error

Severity: **High**
Category: Logic / Backend / AI
Status: Confirmed
Confidence: High

Files:
* `backend/src/controllers/chatController.js`

What is broken:
When the backend streams synthesized text-to-speech audio from OpenAI to the client, it fails to close the Express response writable stream if the upstream readable stream emits an error.

Evidence:
```javascript
// backend/src/controllers/chatController.js:636
const stream = Readable.fromWeb(response.body);
stream.on("end", () => clearTimeout(timeout));
stream.on("error", () => clearTimeout(timeout)); // <-- timeout is cleared, but `res` is left open
stream.pipe(res);
```

Why it fails:
In Node.js, `stream.pipe()` does *not* automatically forward errors to the destination, nor does it destroy the destination stream. If the OpenAI API throws a mid-stream error (e.g., connection reset), the pipeline halts but the Express `res` object is never closed.

Impact:
The client browser hangs indefinitely waiting for the final audio chunk. The Express server leaks an open HTTP connection and associated memory for every failed TTS request, eventually leading to socket exhaustion.

How to reproduce:
Trigger an audio generation request and forcibly terminate the upstream connection to OpenAI mid-stream. The Express response will hang open.

Recommended fix:
Update the error handler to destroy the response object:
`stream.on("error", (err) => { clearTimeout(timeout); res.destroy(err); });`

Regression test:
Mock the OpenAI fetch to return a stream that emits an error after 1 byte. Assert that the Express request immediately terminates with an error rather than timing out.

---

### DEFECT-003 — Dynamic SQL Syntax Crash in `deleteSheet`

Severity: **Medium**
Category: Database / Logic
Status: Confirmed
Confidence: High

Files:
* `backend/src/controllers/sheetController.js`

What is broken:
The `deleteSheet` function checks if the `import_id` column exists on the `import_jobs` table before executing an update, but incorrectly embeds `import_id` directly in the `WHERE` clause regardless of the check.

Evidence:
```javascript
// backend/src/controllers/sheetController.js:5020
if (hasImportJobsTable && (importJobsHasImportId || importJobsHasSheetId)) {
    const sets = [];
    if (importJobsHasImportId) sets.push("import_id = NULL");
    if (importJobsHasSheetId) sets.push("sheet_id = NULL");
    await client.query(
        `UPDATE import_jobs
            SET ${sets.join(", ")}
          WHERE import_id = ANY($1::int[])`, // <-- Always references import_id
        [importIds]
    );
}
```

Why it fails:
If the code executes against a legacy database where `import_id` does not exist (`importJobsHasImportId === false`), the query effectively becomes `UPDATE import_jobs SET sheet_id = NULL WHERE import_id = ANY(...)`. PostgreSQL will immediately throw a `column "import_id" does not exist` syntax error.

Impact:
If the app connects to an older schema that lacks this column, administrators will be permanently unable to delete spreadsheets (returns 500 Internal Server Error).

How to reproduce:
Drop the `import_id` column from the `import_jobs` table and attempt to delete a spreadsheet.

Recommended fix:
Modify the `WHERE` clause to dynamically match the column being scrubbed, or fallback to filtering by `sheet_id = $1` when `import_id` is missing.

---

## Dead, Duplicate, or Misleading Code

| File/Module | Problem | Why It Matters |
| ----------- | ------- | -------------- |
| `backend/src/controllers/sheet/` (Entire Directory) | The entire folder (including `uploadHandlers.js`, `orchestration.js`) is dead code. The `createSheetUploadHandlers` factory is never instantiated in `server.js`. | Developers attempting to fix bugs (like the missing `persistImportJobPayload` function) will edit these modular files, test them, and deploy, only to find the monolith `sheetController.js` is still running the broken production code. |
| `backend/src/controllers/user/` | `groupRoutes.js` contains a massive exact duplication of functions from `userController.js`. | Identical logic bugs (like the `toggleGroupAdmin` silent demotion) exist in both places, doubling the maintenance burden. |

## Weak or Misleading Tests

| Test | Problem | Missing Coverage |
| ---- | ------- | ---------------- |
| `backend/test/sheetDataSecurityRegression.test.js` | Uses `assert.match(source, /regex/)` to check if a specific string exists inside the raw JavaScript source code file. | The test passes purely based on text syntax. It does not execute the server, intercept requests, or prove that authorization logic is actually wired up and blocking unauthorized tenants. This provides 0% runtime security assurance. |
