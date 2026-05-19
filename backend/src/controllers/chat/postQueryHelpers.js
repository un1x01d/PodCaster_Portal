export function createChatPostQueryHelpers(deps) {
  const {
    query,
    checkSheetAccess,
    hasReportSourceOwnerAccess,
    isPlatformAdminUser,
    loadSheetPermissionSets,
    buildRowFilterWhereClause,
    CHAT_MAX_ROWS,
  } = deps;
async function loadAccessibleRows(sheetId, user, activeTab = null, rowLimit = null) {
  const sheetRes = await query("SELECT headers, tabs, tab_name, semantic_profile FROM sheets WHERE id = $1", [sheetId]);
  if (!sheetRes.length) return { headers: [], tabs: [], rows: [], rowFiltersList: [], forbidden: true };
  const sheet = sheetRes[0];

  const hasFullAccess = (isPlatformAdminUser(user) || await hasReportSourceOwnerAccess(sheetId, user.id));

  let validCols = null;
  let rowFiltersList = [];

  if (!hasFullAccess) {
    const { allPerms, validCols: loadedCols, rowFiltersList: loadedFilters } = await loadSheetPermissionSets(sheetId, user.id);
    if (!allPerms.length) return { headers: [], tabs: [], rows: [], rowFiltersList: [], forbidden: true };
    rowFiltersList = loadedFilters;
    validCols = loadedCols;
    if (!validCols.length) return { headers: [], tabs: [], rows: [], rowFiltersList: [], forbidden: true };
  }

  // Build the SQL query for efficient retrieval
  let columnSelection = "row_data";
  const params = [sheetId];
  let where = "WHERE sheet_id = $1";

  if (validCols && !hasFullAccess) {
    columnSelection = `(SELECT jsonb_object_agg(key, value) FROM jsonb_each(row_data) WHERE key = ANY($${params.length + 1}::text[]))`;
    params.push(validCols);
  }

  if (activeTab) {
    where += ` AND tab_name = $${params.length + 1}`;
    params.push(activeTab);
  }

  // Apply RBAC row filters in SQL if not full access
  if (!hasFullAccess && rowFiltersList.length > 0) {
    const filterClauses = [];
    rowFiltersList.forEach(filters => {
        const entries = Object.entries(filters).filter(([k]) => !!k);
        if (entries.length > 0) {
            const groupPredicates = entries.map(([k, v]) => {
                params.push(k, String(v));
                return `(row_data->>$${params.length - 1}) = $${params.length}`;
            });
            filterClauses.push(`(${groupPredicates.join(" AND ")})`);
        }
    });
    if (filterClauses.length > 0) {
        where += ` AND (${filterClauses.join(" OR ")})`;
    }
  }

  let sql = `SELECT ${columnSelection} as row_data, tab_name FROM sheet_rows ${where} ORDER BY row_index ASC`;
  const effectiveLimit = rowLimit || (CHAT_MAX_ROWS + 1);
  if (effectiveLimit) {
    sql += ` LIMIT $${params.length + 1}`;
    params.push(effectiveLimit);
  }

  const rawHeaders = sheet.headers;
  let headers = Array.isArray(rawHeaders) ? rawHeaders : (typeof rawHeaders === "string" ? JSON.parse(rawHeaders || "[]") : []);
  const rows = await query(sql, params);

  // Enforce DLP masking scope for chat: masked fields are never exposed to chat logic.
  const blockedColumns = (() => {
    const out = new Set();
    const profile = sheet?.semantic_profile && typeof sheet.semantic_profile === "object" ? sheet.semantic_profile : {};
    const dlp = profile?.dlp && typeof profile.dlp === "object" ? profile.dlp : {};
    const maskedByTab = dlp?.maskedColumns && typeof dlp.maskedColumns === "object" ? dlp.maskedColumns : {};
    const maskedCellsByTab = dlp?.maskedCells && typeof dlp.maskedCells === "object" ? dlp.maskedCells : {};
    const collectTab = (tabName) => {
      const cols = maskedByTab?.[tabName];
      if (Array.isArray(cols)) cols.forEach((c) => out.add(String(c || "").trim().toLowerCase()));
      const cells = maskedCellsByTab?.[tabName];
      if (Array.isArray(cells)) {
        cells.forEach((cell) => {
          const col = String(cell?.column || "").trim().toLowerCase();
          if (col) out.add(col);
        });
      }
    };
    if (activeTab) {
      collectTab(activeTab);
    } else {
      Object.keys(maskedByTab || {}).forEach(collectTab);
      Object.keys(maskedCellsByTab || {}).forEach(collectTab);
    }
    return out;
  })();

  const stripBlockedFromRow = (row = {}) => {
    if (!row || typeof row !== "object" || blockedColumns.size === 0) return row || {};
    const next = { ...(row || {}) };
    Object.keys(next).forEach((k) => {
      if (blockedColumns.has(String(k || "").trim().toLowerCase())) delete next[k];
    });
    return next;
  };

  if (blockedColumns.size > 0) {
    headers = headers.filter((h) => !blockedColumns.has(String(h || "").trim().toLowerCase()));
  }
  if (!rowLimit && rows.length > CHAT_MAX_ROWS) {
    return {
      headers,
      tabs: Array.isArray(sheet.tabs) ? sheet.tabs : (sheet.tab_name ? [sheet.tab_name] : []),
      rows: [],
      rowFiltersList,
      allowedColumns: headers,
      semanticProfile: sheet.semantic_profile || {},
      tooLarge: true,
      forbidden: false,
    };
  }

  if (validCols && !hasFullAccess) {
      headers = headers.filter(h => validCols.includes(h));
  }

  return {
    headers,
    tabs: Array.isArray(sheet.tabs) ? sheet.tabs : (sheet.tab_name ? [sheet.tab_name] : []),
    rows: rows.map(r => ({ ...stripBlockedFromRow(r.row_data || {}), __tab_name: r.tab_name })),
    rowFiltersList,
    allowedColumns: headers,
    semanticProfile: sheet.semantic_profile || {},
    forbidden: false,
  };
}
function runtimeRegex(rules, key, fallback) {
  try {
    return new RegExp(String(rules?.[key] || fallback), "i");
  } catch {
    return new RegExp(String(fallback), "i");
  }
}

function buildSqlFastPathFromDeterministicPlan(plan) {
  if (!plan?.ok || String(plan.operation || "") !== "single_period") return null;
  const metric = String(plan.metric || "").trim().toLowerCase();
  const resolution = plan?.resolution || {};
  const mapped = resolution?.resolvedMappings || {};
  const targetByMetric = {
    total_revenue: mapped.total_revenue,
    total_expense: mapped.total_expense,
    cash: mapped.cash,
    ar_balance: mapped.ar_balance,
    ap_balance: mapped.ap_balance,
    net_revenue: mapped.net_revenue,
    gross_profit: mapped.gross_profit,
    net_income: mapped.net_income,
  };
  const targetColumn = String(targetByMetric[metric] || "").trim();
  if (!targetColumn) return null;
  const periodYear = Number(plan?.period);
  const dateColumn = String(
    resolution?.resolvedMappings?.date
      || resolution?.optionalMappings?.date
      || ""
  ).trim();
  const filters = Number.isFinite(periodYear) && dateColumn
    ? [{ column: dateColumn, operator: "year_equals", value: String(periodYear) }]
    : [];
  return { targetColumn, filters };
}
  return {
    loadAccessibleRows,
    runtimeRegex,
    buildSqlFastPathFromDeterministicPlan,
  };
}
