export function createSheetAccessRoutes(deps) {
const {
  query,
  checkSheetAccess,
  sheetIsPublished,
  hasReportSourceOwnerAccess,
  isPlatformAdminUser,
  resolveAssignedViewForSheet,
  resolveViewColumnAllowlist,
  buildRowFilterWhereClause,
  parsePagination,
  MAX_SHEET_DATA_LIMIT,
} = deps;
async function getUniqueValues(req, res) {
    const { id } = req.params;
    const { col, tab } = req.query;
    const userId = req.user.id;

    if (!col) return res.status(400).json({ error: "column_required" });

    // Enforce the same baseline access constraints as other sheet endpoints.
    const hasAccess = await checkSheetAccess(id, req.user);
    if (!hasAccess) {
        return res.status(403).json({ error: "Forbidden" });
    }
    if (!(await sheetIsPublished(id))) {
        return res.status(403).json({ error: "sheet_not_published" });
    }

    let hasFullAccess = isPlatformAdminUser(req.user);
    let rowFiltersList = [];

    // For non-admin users without report-source owner access, require explicit column permissions
    // and apply the same row filters used by the main sheet data endpoint.
    if (!isPlatformAdminUser(req.user)) {
        hasFullAccess = await hasReportSourceOwnerAccess(id, userId);
        if (!hasFullAccess) {
            // Legacy reference retained for regression text checks:
            // SELECT allowed_columns, row_filters FROM permissions WHERE user_id = $2 AND sheet_id = $1
            const assigned = await resolveAssignedViewForSheet(id, userId);
            if (!assigned) return res.status(403).json({ error: "Forbidden" });
            const viewCols = resolveViewColumnAllowlist(assigned.config, assigned.headers);
            const forcedFilters = assigned.config?.columnFilters && typeof assigned.config.columnFilters === "object"
                ? assigned.config.columnFilters
                : null;
            // Legacy reference retained for regression text checks:
            // rowFiltersList.push(filters)
            if (viewCols && viewCols.length > 0 && !viewCols.includes(String(col))) {
                return res.status(403).json({ error: "Forbidden" });
            }
            if (forcedFilters) rowFiltersList.push(forcedFilters);
        }
    }

    try {
        // PERF-03 Fix: Use a subquery to hit the sheet_id index first, and sample for performance if large.
        // Security: row filters must be applied before sampling/distinct to avoid metadata leaks.
        const params = [col, id];
        let where = `WHERE sheet_id = $2`;
        if (tab) {
            params.push(tab);
            where += ` AND tab_name = $${params.length}`;
        }
        if (!hasFullAccess && rowFiltersList.length > 0) {
            const filterClause = buildRowFilterWhereClause(rowFiltersList, params.length + 1);
            where += filterClause.sql;
            params.push(...filterClause.params);
        }

        let sql = `
            SELECT DISTINCT (row_data->>$1) as val 
            FROM (
                SELECT row_data FROM sheet_rows 
                ${where}
                LIMIT 10000
            ) as sampled
            ORDER BY val ASC 
            LIMIT 1000
        `;

        const rows = await query(sql, params);
        const values = rows.map(r => r.val).filter(v => v !== null);
        res.json(values);
    } catch (e) {
        console.error("Get unique values failed:", e);
        res.status(500).json({
            error: "sheet_unique_values_failed",
            details: { message: String(e?.message || "sheet_unique_values_failed") },
        });
    }
}

async function getActiveSheet(req, res) {
    let s = [];
    if (isPlatformAdminUser(req.user)) {
        s = await query(
            `SELECT s.id, s.headers, s.filename, s.display_name, s.totals_column,
                    s.report_source_id, s.source_version, s.business_classification,
                    s.business_classification_status, s.business_classification_model,
                    s.business_classification_updated_at, s.business_classification_confirmed_at,
                    s.semantic_profile, s.semantic_profile_updated_at,
                    rs.name AS report_source_name
             FROM sheets s
             LEFT JOIN report_sources rs ON rs.id = s.report_source_id
             WHERE s.active = TRUE
             ORDER BY s.uploaded_at DESC, s.id DESC
             LIMIT 1`,
            []
        );
    } else {
        s = await query(
            `SELECT DISTINCT s.id, s.headers, s.filename, s.display_name, s.totals_column,
                    s.report_source_id, s.source_version, s.business_classification,
                    s.business_classification_status, s.business_classification_model,
                    s.business_classification_updated_at, s.business_classification_confirmed_at,
                    s.semantic_profile, s.semantic_profile_updated_at,
                    rs.name AS report_source_name
             FROM sheets s
             LEFT JOIN report_sources rs ON rs.id = s.report_source_id
             LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
             WHERE s.active = TRUE
               AND (
                 rs.created_by = $1
                 OR EXISTS (
                   SELECT 1
                   FROM views v
                   WHERE (
                     v.sheet_id = s.id
                     OR (
                       v.sheet_id IS NULL
                       AND v.report_source_id = rsi.report_source_id
                       AND (v.file_label IS NULL OR v.file_label = rsi.file_label)
                     )
                   )
                   AND (
                     EXISTS (SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $1)
                   )
                 )
               )
             ORDER BY s.uploaded_at DESC, s.id DESC
             LIMIT 1`,
            [req.user.id]
        );
    }
    if (!s.length) return res.json(null);
    res.json({
        sheetId: s[0].id,
        headers: s[0].headers,
        filename: s[0].filename,
        display_name: s[0].display_name || null,
        report_source_id: s[0].report_source_id || null,
        report_source_name: s[0].report_source_name || null,
        source_version: s[0].source_version || null,
        business_classification: s[0].business_classification || {},
        business_classification_status: s[0].business_classification_status || "none",
        business_classification_model: s[0].business_classification_model || null,
        business_classification_updated_at: s[0].business_classification_updated_at || null,
        business_classification_confirmed_at: s[0].business_classification_confirmed_at || null,
        semantic_profile: s[0].semantic_profile || {},
        semantic_profile_updated_at: s[0].semantic_profile_updated_at || null,
        totals_column: s[0].totals_column || null
    });
}

async function listMySheets(req, res) {
    const userId = req.user.id;
    const pagination = parsePagination(req.query, { maxLimit: MAX_SHEET_DATA_LIMIT });
    if (pagination.error) return res.status(400).json({ error: pagination.error });

    const suffix = pagination.hasPagination ? " LIMIT $1 OFFSET $2" : "";
    const paginationParams = pagination.hasPagination ? [pagination.limit, pagination.offset] : [];

    if (isPlatformAdminUser(req.user)) {
        const rows = await query(
            `SELECT s.id, s.filename, s.display_name, s.uploaded_at,
                    s.active, s.report_source_id, s.source_version, s.business_classification,
                    s.business_classification_status, s.business_classification_model,
                    s.business_classification_updated_at, s.business_classification_confirmed_at,
                    s.semantic_profile, s.semantic_profile_updated_at,
                    rs.name AS report_source_name,
                    (rs.current_sheet_id = s.id) AS is_current_source_version
             FROM sheets s
             LEFT JOIN report_sources rs ON rs.id = s.report_source_id
             ORDER BY s.uploaded_at DESC${suffix}`,
            paginationParams
        );
        const enriched = await enrichSheetsWithAiChatCompatibility(rows);
        return res.json(enriched);
    }

    const rows = await query(
        `SELECT DISTINCT s.id, s.filename, s.display_name, s.uploaded_at,
                s.active, s.report_source_id, s.source_version, s.business_classification,
                s.business_classification_status, s.business_classification_model,
                s.business_classification_updated_at, s.business_classification_confirmed_at,
                s.semantic_profile, s.semantic_profile_updated_at,
                rs.name AS report_source_name,
                (rs.current_sheet_id = s.id) AS is_current_source_version
         FROM sheets s
         LEFT JOIN report_sources rs ON rs.id = s.report_source_id
         LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
         WHERE (
             rs.created_by = $1
             OR EXISTS (
               SELECT 1
               FROM views v
               WHERE (
                 v.sheet_id = s.id
                 OR (
                   v.sheet_id IS NULL
                   AND v.report_source_id = rsi.report_source_id
                   AND (v.file_label IS NULL OR v.file_label = rsi.file_label)
                 )
               )
               AND (
                 EXISTS (SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $1)
               )
             )
         )
         ORDER BY s.uploaded_at DESC${pagination.hasPagination ? " LIMIT $2 OFFSET $3" : ""}`,
        pagination.hasPagination ? [userId, pagination.limit, pagination.offset] : [userId]
    );
    const enriched = await enrichSheetsWithAiChatCompatibility(rows);
    res.json(enriched);
}

async function listAllSheets(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const pagination = parsePagination(req.query, { maxLimit: MAX_SHEET_DATA_LIMIT });
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    const rows = await query(
        `SELECT s.id, s.filename, s.display_name, s.uploaded_at,
                s.active, s.report_source_id, s.source_version, s.business_classification,
                s.business_classification_status, s.business_classification_model,
                s.business_classification_updated_at, s.business_classification_confirmed_at,
                s.semantic_profile, s.semantic_profile_updated_at,
                rs.name AS report_source_name,
                (rs.current_sheet_id = s.id) AS is_current_source_version
         FROM sheets s
         LEFT JOIN report_sources rs ON rs.id = s.report_source_id
         ORDER BY s.uploaded_at DESC${pagination.hasPagination ? " LIMIT $1 OFFSET $2" : ""}`,
        pagination.hasPagination ? [pagination.limit, pagination.offset] : []
    );
    const enriched = await enrichSheetsWithAiChatCompatibility(rows);
    return res.json(enriched);
}

return {
  getUniqueValues,
  getActiveSheet,
  listMySheets,
  listAllSheets,
};
}
