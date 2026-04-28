import { query } from "../config/db.js";

export async function checkSheetAccess(sheetId, user) {
  if (user.role === "admin") return true;
  const res = await query(
    `SELECT COUNT(s.id) FROM sheets s
     LEFT JOIN folders f ON f.id = s.folder_id
     WHERE s.id = $1 AND (
       (
         EXISTS (
           SELECT 1
           FROM folder_groups fg
           JOIN user_groups ug ON ug.group_id = fg.group_id
           WHERE fg.folder_id = f.id AND ug.user_id = $2
         )
         OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)
       )
       OR (s.id IN (SELECT sheet_id FROM permissions WHERE user_id = $2))
       OR (s.id IN (SELECT sheet_id FROM group_permissions WHERE group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)))
     )`,
    [sheetId, user.id]
  );
  return res?.[0]?.count !== "0";
}

export async function hasFolderAccess(sheetId, userId) {
  const rows = await query(
    `SELECT 1
     FROM sheets s
     LEFT JOIN folders f ON f.id = s.folder_id
     WHERE s.id = $1
       AND (
         EXISTS (
           SELECT 1
           FROM folder_groups fg
           JOIN user_groups ug ON ug.group_id = fg.group_id
           WHERE fg.folder_id = f.id AND ug.user_id = $2
         )
         OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)
       )
     LIMIT 1`,
    [sheetId, userId]
  );
  return rows.length > 0;
}

export async function loadSheetPermissionSets(sheetId, userId) {
  const userPerms = await query(
    `SELECT allowed_columns, row_filters FROM permissions WHERE user_id = $2 AND sheet_id = $1`,
    [sheetId, userId]
  );
  const groupPerms = await query(
    `SELECT gp.allowed_columns, gp.row_filters
     FROM group_permissions gp
     JOIN user_groups ug ON ug.group_id = gp.group_id
     WHERE ug.user_id = $2 AND gp.sheet_id = $1`,
    [sheetId, userId]
  );
  const allPerms = [...userPerms, ...groupPerms];
  const validCols = new Set();
  const rowFiltersList = [];
  allPerms.forEach((p) => {
    const cols = typeof p.allowed_columns === "string" ? JSON.parse(p.allowed_columns) : (p.allowed_columns || []);
    cols.forEach((c) => validCols.add(c));
    const filters = typeof p.row_filters === "string" ? JSON.parse(p.row_filters) : (p.row_filters || {});
    rowFiltersList.push(filters);
  });
  return { allPerms, validCols: Array.from(validCols), rowFiltersList };
}
