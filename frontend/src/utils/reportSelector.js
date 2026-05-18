export function resolveImportSheetId(item) {
  if (!item || typeof item !== "object") return "";
  const sid = item.sheet_id ?? item.sheetId ?? item.id ?? "";
  return String(sid || "").trim();
}

export function resolveImportVersion(item) {
  return Number(item?.import_version ?? item?.importVersion ?? 0) || 0;
}

export function resolveFileLabel(item) {
  return (
    item?.file_label ||
    item?.display_name ||
    item?.import_name ||
    item?.original_filename ||
    item?.filename ||
    `Version ${resolveImportVersion(item) || ""}`.trim()
  );
}

export function normalizeImportItem(item) {
  const sid = resolveImportSheetId(item);
  if (!sid) return null;
  return {
    ...item,
    sheet_id: sid,
    import_version: resolveImportVersion(item),
  };
}

export function isSelectableImport(item, { publishedSheetIds = new Set(), accessibleSheetIds = new Set() } = {}) {
  const sid = resolveImportSheetId(item);
  if (!sid) return false;
  if (typeof item?.selectable === "boolean") return item.selectable === true;
  const status = String(item?.status || "").trim().toLowerCase();
  if (status) return status === "published";
  if (publishedSheetIds.size > 0) return publishedSheetIds.has(sid);
  return accessibleSheetIds.has(sid);
}

export function buildSourceImports({
  sourceId,
  reportSourceImports = {},
  myFiles = [],
  selectableContext = {},
  includeAll = false,
}) {
  const key = String(sourceId || "");
  const fromApiRaw = Array.isArray(reportSourceImports?.[key]) ? reportSourceImports[key] : [];
  const fromApi = fromApiRaw
    .filter((item) => (includeAll ? true : isSelectableImport(item, selectableContext)))
    .map((item) => normalizeImportItem(item))
    .filter(Boolean);

  const derived = (Array.isArray(myFiles) ? myFiles : [])
    .filter((f) => String(f?.report_source_id || "") === key && f?.active === true)
    .map((f) => normalizeImportItem({
      id: `sheet:${f.id}`,
      sheet_id: f.id,
      import_version: Number(f?.source_version || 0) || 0,
      file_label: f?.display_name || f?.filename || `File ${f.id}`,
      display_name: f?.display_name || "",
      filename: f?.filename || "",
      uploaded_at: f?.uploaded_at || null,
      created_at: f?.uploaded_at || null,
      imported_by_name: null,
    }))
    .filter(Boolean);

  const bySheetId = new Map();
  fromApi.forEach((item) => bySheetId.set(String(item.sheet_id), item));
  if (bySheetId.size === 0) {
    derived.forEach((item) => bySheetId.set(String(item.sheet_id), item));
  }
  return Array.from(bySheetId.values()).sort(
    (a, b) => new Date(b?.uploaded_at || b?.created_at || 0) - new Date(a?.uploaded_at || a?.created_at || 0)
  );
}

export function groupImportsByLabel(imports = []) {
  const groups = {};
  (Array.isArray(imports) ? imports : []).forEach((item) => {
    const label = resolveFileLabel(item);
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  });
  Object.values(groups).forEach((g) => g.sort((a, b) => resolveImportVersion(b) - resolveImportVersion(a)));
  return Object.values(groups).sort((a, b) => new Date(b?.[0]?.uploaded_at || 0) - new Date(a?.[0]?.uploaded_at || 0));
}
