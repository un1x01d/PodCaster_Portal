import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("sheet data view access does not grant global bypass to any group admin", () => {
  const source = read("src/controllers/sheetController.js");

  assert.doesNotMatch(source, /canBypassViewAssignmentCheck\s*=\s*isPlatformAdmin\s*\|\|\s*isGroupAdmin/);
  assert.match(source, /OR\s+\$4\s+=\s+TRUE/);
  assert.match(source, /OR\s+v\.created_by\s+=\s+\$5/);
  assert.match(source, /EXISTS \(SELECT 1 FROM view_user_permissions WHERE view_id = v\.id AND user_id = \$5\)/);
});

test("sheet data AI enrichment samples only projected authorized columns", () => {
  const source = read("src/controllers/sheetController.js");

  assert.match(source, /const safeAiHeaders = \(hasFullAccess/);
  assert.match(source, /storedHeaders\.filter\(\(header\) => validCols\.includes\(header\)\)/);
  assert.match(source, /SELECT \$\{columnSelection\} AS row_data/);
  assert.equal(
    source.includes(`SELECT row_data
                           FROM sheet_rows
                          WHERE sheet_id = $1
                            AND ($2::text IS NULL OR tab_name = $2)`),
    false
  );
});

test("group admins may assign only views they created to users in managed groups", () => {
  const source = read("src/controllers/viewController.js");

  assert.match(source, /await assertCustomerAdminOwnsView\(normalizedViewId, req\.user\.id\)/);
  assert.match(source, /await assertUserWithinManagedGroups\(normalizedUserId, managedGroupIds\)/);
});

test("sheet data cursor pagination adds predicate before ordering and uses actual row_index cursor", () => {
  const source = read("src/controllers/sheetController.js");
  const selectIdx = source.indexOf("SELECT row_index, ${columnSelection} AS row_data FROM sheet_rows WHERE sheet_id = $1");
  const cursorPredicateIdx = source.indexOf("sql += ` AND row_index > $${params.length + 1}`", selectIdx);
  const orderIdx = source.indexOf("// Apply sorting after all predicates have been added.", selectIdx);

  assert.ok(selectIdx > 0, "query must select row_index for cursor generation");
  assert.ok(cursorPredicateIdx > selectIdx, "cursor predicate must be present");
  assert.ok(orderIdx > cursorPredicateIdx, "cursor predicate must be appended before ORDER BY");
  assert.match(source, /const lastRowIndex = pageRows\.length \? Number\(pageRows\[pageRows\.length - 1\]\?\.row_index\) : null;/);
  assert.match(source, /JSON\.stringify\(\{ rowIndex: lastRowIndex \}\)/);
  assert.doesNotMatch(source, /decodedCursor\?\.rowIndex \|\| 0\) \+ items\.length/);
});
