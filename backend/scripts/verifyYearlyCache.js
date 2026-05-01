import { query } from "../src/config/db.js";
import { computeLargeDatasetAggregateFallback } from "../src/controllers/chatController.js";

async function main() {
  const sheetId = process.argv[2] || "1777415427247_8y90t";
  const tabName = process.argv[3] || "Sheet1";
  const dateColumn = process.argv[4] || "Fiscal Year";
  const metricColumn = process.argv[5] || "Net Revenue";

  const headersRow = await query("SELECT headers FROM sheets WHERE id = $1 LIMIT 1", [sheetId]);
  if (!headersRow.length) {
    console.error("sheet not found");
    process.exit(1);
  }
  const headers = Array.isArray(headersRow[0].headers) ? headersRow[0].headers : JSON.parse(headersRow[0].headers || "[]");

  const sample = await query(
    "SELECT row_data FROM sheet_rows WHERE sheet_id = $1 AND tab_name = $2 ORDER BY row_index ASC LIMIT 20",
    [sheetId, tabName]
  );
  const sampleRows = sample.map((r) => r.row_data || {});

  await query(
    `DELETE FROM sheet_metric_yearly_cache
      WHERE sheet_id = $1 AND tab_name = $2 AND date_column = $3 AND metric_column = $4`,
    [sheetId, tabName, dateColumn, metricColumn]
  );

  const before = await query(
    `SELECT COUNT(*)::int AS c FROM sheet_metric_yearly_cache
      WHERE sheet_id = $1 AND tab_name = $2 AND date_column = $3 AND metric_column = $4`,
    [sheetId, tabName, dateColumn, metricColumn]
  );

  const payload = {
    sheetId,
    user: { id: 1, role: "admin" },
    operation: "year_over_year",
    targetColumn: metricColumn,
    groupBy: dateColumn,
    message: "What is the year-over-year change in net revenue?",
    ai: { operation: "year_over_year", target_column: metricColumn, group_by: dateColumn },
    headers,
    sampleRows,
    activeFilters: [],
    rowFiltersList: [],
    tabName,
    locale: "en",
  };

  const first = await computeLargeDatasetAggregateFallback(payload);
  const afterFirst = await query(
    `SELECT COUNT(*)::int AS c FROM sheet_metric_yearly_cache
      WHERE sheet_id = $1 AND tab_name = $2 AND date_column = $3 AND metric_column = $4`,
    [sheetId, tabName, dateColumn, metricColumn]
  );

  const second = await computeLargeDatasetAggregateFallback(payload);
  const afterSecond = await query(
    `SELECT COUNT(*)::int AS c FROM sheet_metric_yearly_cache
      WHERE sheet_id = $1 AND tab_name = $2 AND date_column = $3 AND metric_column = $4`,
    [sheetId, tabName, dateColumn, metricColumn]
  );

  const rows = await query(
    `SELECT period_year, value
       FROM sheet_metric_yearly_cache
      WHERE sheet_id = $1 AND tab_name = $2 AND date_column = $3 AND metric_column = $4
      ORDER BY period_year ASC`,
    [sheetId, tabName, dateColumn, metricColumn]
  );

  console.log(JSON.stringify({
    sheetId,
    tabName,
    dateColumn,
    metricColumn,
    cacheCountBefore: before[0]?.c || 0,
    cacheCountAfterFirst: afterFirst[0]?.c || 0,
    cacheCountAfterSecond: afterSecond[0]?.c || 0,
    firstAnswer: String(first?.answer || "").slice(0, 220),
    secondAnswer: String(second?.answer || "").slice(0, 220),
    cacheRows: rows,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
