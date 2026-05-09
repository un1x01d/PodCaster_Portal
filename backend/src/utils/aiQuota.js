import { query } from "../config/db.js";
import { normalizeGroupEntitlements, groupHasFeature } from "./entitlements.js";

const OPENAI_INPUT_COST_PER_1M = Number.parseFloat(process.env.OPENAI_INPUT_COST_PER_1M || "0.05");
const OPENAI_OUTPUT_COST_PER_1M = Number.parseFloat(process.env.OPENAI_OUTPUT_COST_PER_1M || "0.40");

function currentPeriodMonth(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function estimateOpenAiCostUsd(promptTokens = 0, completionTokens = 0, rates = null) {
  const inputTokens = Number(promptTokens || 0);
  const outputTokens = Number(completionTokens || 0);
  const inputRate = Number.parseFloat(String(rates?.inputPer1M ?? OPENAI_INPUT_COST_PER_1M));
  const outputRate = Number.parseFloat(String(rates?.outputPer1M ?? OPENAI_OUTPUT_COST_PER_1M));
  const safeInputRate = Number.isFinite(inputRate) && inputRate >= 0 ? inputRate : OPENAI_INPUT_COST_PER_1M;
  const safeOutputRate = Number.isFinite(outputRate) && outputRate >= 0 ? outputRate : OPENAI_OUTPUT_COST_PER_1M;
  const cost = ((inputTokens / 1_000_000) * safeInputRate)
    + ((outputTokens / 1_000_000) * safeOutputRate);
  return Number.isFinite(cost) ? cost : 0;
}

function quotaNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function resolveCustomerGroupForSheet(sheetId, user) {
  if (!sheetId) return null;
  const sheetScopedGroup = await query(
    `SELECT rs.sync_group_id AS group_id
       FROM sheets s
       JOIN report_sources rs ON rs.id = s.report_source_id
      WHERE s.id = $1
        AND rs.sync_group_id IS NOT NULL
      LIMIT 1`,
    [sheetId]
  ).catch(() => []);
  if (sheetScopedGroup?.[0]?.group_id) return sheetScopedGroup[0].group_id;
  const ownerScopedGroup = await query(
    `SELECT ug.group_id AS group_id
       FROM sheets s
       JOIN report_sources rs ON rs.id = s.report_source_id
       JOIN user_groups ug ON ug.user_id = rs.created_by
      WHERE s.id = $1
        AND ug.group_id IS NOT NULL
      ORDER BY ug.is_admin DESC, ug.group_id ASC
      LIMIT 1`,
    [sheetId]
  ).catch(() => []);
  if (ownerScopedGroup?.[0]?.group_id) return ownerScopedGroup[0].group_id;
  const tokenGroupId = Number.parseInt(String(user?.customer_group_id ?? user?.group_id ?? ""), 10);
  if (Number.isInteger(tokenGroupId) && tokenGroupId > 0) return tokenGroupId;
  if (String(user?.role || "") === "admin") return null;
  const rows = await query(
    `SELECT ug.group_id
       FROM user_groups ug
      WHERE ug.user_id = $2
        AND (
          EXISTS (
            SELECT 1
              FROM views v
              LEFT JOIN report_source_imports rsi ON rsi.sheet_id = $1
              JOIN view_user_permissions vup ON vup.view_id = v.id
             WHERE vup.user_id = $2
               AND (
                 v.sheet_id = $1
                 OR (
                   v.sheet_id IS NULL
                   AND v.report_source_id = rsi.report_source_id
                   AND (v.file_label IS NULL OR v.file_label = rsi.file_label)
                 )
               )
          )
          OR EXISTS (
            SELECT 1
              FROM sheets s
              JOIN report_sources rs ON rs.id = s.report_source_id
             WHERE s.id = $1
               AND rs.created_by = $2
          )
        )
      ORDER BY group_id ASC
      LIMIT 1`,
    [sheetId, user?.id]
  );
  return rows?.[0]?.group_id || null;
}

export async function resolveAiGroupIdForSheet({ sheetId, user } = {}) {
  return resolveCustomerGroupForSheet(sheetId, user);
}

async function loadCustomerQuota(groupId) {
  if (!groupId) return null;
  const rows = await query("SELECT id, name, entitlements FROM groups WHERE id = $1", [groupId]);
  const group = rows?.[0];
  if (!group) return null;
  const entitlements = normalizeGroupEntitlements(group.entitlements || {});
  return {
    group,
    entitlements,
    maxQueries: quotaNumber(entitlements.maxAiQueriesPerMonth),
    monthlyBudgetUsd: quotaNumber(entitlements.aiMonthlyBudgetUsd),
  };
}

export async function reserveAiQueryForSheet({ sheetId, user, kind = "chat_query" }) {
  const groupId = await resolveCustomerGroupForSheet(sheetId, user);
  if (!groupId) return { groupId: null, periodMonth: currentPeriodMonth(), enforced: false };

  const quota = await loadCustomerQuota(groupId);
  if (!quota) return { groupId, periodMonth: currentPeriodMonth(), enforced: false };
  if (!groupHasFeature(quota.group, "ai")) {
    const err = new Error("feature_not_enabled:ai");
    err.statusCode = 403;
    throw err;
  }

  const periodMonth = currentPeriodMonth();
  await query(
    `INSERT INTO ai_usage_monthly (group_id, period_month, query_count, updated_at)
     VALUES ($1, $2, 0, CURRENT_TIMESTAMP)
     ON CONFLICT (group_id, period_month) DO NOTHING`,
    [groupId, periodMonth]
  );

  const usageRows = await query(
    "SELECT query_count, estimated_cost_usd FROM ai_usage_monthly WHERE group_id = $1 AND period_month = $2",
    [groupId, periodMonth]
  );
  const usage = usageRows?.[0] || {};
  const currentQueries = Number(usage.query_count || 0);
  const currentCost = Number(usage.estimated_cost_usd || 0);

  if (quota.maxQueries && currentQueries >= quota.maxQueries) {
    const err = new Error("ai_query_quota_exceeded");
    err.statusCode = 429;
    err.details = { maxAiQueriesPerMonth: quota.maxQueries, usedAiQueries: currentQueries, periodMonth };
    throw err;
  }
  if (quota.monthlyBudgetUsd && currentCost >= quota.monthlyBudgetUsd) {
    const err = new Error("ai_budget_quota_exceeded");
    err.statusCode = 429;
    err.details = { aiMonthlyBudgetUsd: quota.monthlyBudgetUsd, estimatedCostUsd: Number(currentCost.toFixed(6)), periodMonth };
    throw err;
  }

  await query(
    `UPDATE ai_usage_monthly
        SET query_count = query_count + 1,
            last_kind = $3,
            updated_at = CURRENT_TIMESTAMP
      WHERE group_id = $1 AND period_month = $2`,
    [groupId, periodMonth, kind]
  );

  return { groupId, periodMonth, enforced: true, quota };
}

export async function reserveAiQueryForUser({ user, kind = "dashboard_translate" }) {
  const userId = Number(user?.id || 0);
  if (!Number.isInteger(userId) || userId <= 0) return { groupId: null, periodMonth: currentPeriodMonth(), enforced: false };
  if (String(user?.role || "").toLowerCase() === "admin") {
    return { groupId: null, periodMonth: currentPeriodMonth(), enforced: false };
  }

  const membershipRows = await query(
    `SELECT group_id
       FROM user_groups
      WHERE user_id = $1
      ORDER BY is_admin DESC, group_id ASC
      LIMIT 1`,
    [userId]
  );
  const groupId = Number(membershipRows?.[0]?.group_id || 0) || null;
  if (!groupId) return { groupId: null, periodMonth: currentPeriodMonth(), enforced: false };

  const quota = await loadCustomerQuota(groupId);
  if (!quota) return { groupId, periodMonth: currentPeriodMonth(), enforced: false };
  if (!groupHasFeature(quota.group, "ai")) {
    const err = new Error("feature_not_enabled:ai");
    err.statusCode = 403;
    throw err;
  }

  const periodMonth = currentPeriodMonth();
  await query(
    `INSERT INTO ai_usage_monthly (group_id, period_month, query_count, updated_at)
     VALUES ($1, $2, 0, CURRENT_TIMESTAMP)
     ON CONFLICT (group_id, period_month) DO NOTHING`,
    [groupId, periodMonth]
  );

  const usageRows = await query(
    "SELECT query_count, estimated_cost_usd FROM ai_usage_monthly WHERE group_id = $1 AND period_month = $2",
    [groupId, periodMonth]
  );
  const usage = usageRows?.[0] || {};
  const currentQueries = Number(usage.query_count || 0);
  const currentCost = Number(usage.estimated_cost_usd || 0);

  if (quota.maxQueries && currentQueries >= quota.maxQueries) {
    const err = new Error("ai_query_quota_exceeded");
    err.statusCode = 429;
    err.details = { maxAiQueriesPerMonth: quota.maxQueries, usedAiQueries: currentQueries, periodMonth };
    throw err;
  }
  if (quota.monthlyBudgetUsd && currentCost >= quota.monthlyBudgetUsd) {
    const err = new Error("ai_budget_quota_exceeded");
    err.statusCode = 429;
    err.details = { aiMonthlyBudgetUsd: quota.monthlyBudgetUsd, estimatedCostUsd: Number(currentCost.toFixed(6)), periodMonth };
    throw err;
  }

  await query(
    `UPDATE ai_usage_monthly
        SET query_count = query_count + 1,
            last_kind = $3,
            updated_at = CURRENT_TIMESTAMP
      WHERE group_id = $1 AND period_month = $2`,
    [groupId, periodMonth, kind]
  );

  return { groupId, periodMonth, enforced: true, quota };
}

export async function recordAiUsage({ reservation, provider = "openai", model = null, promptTokens = 0, completionTokens = 0, estimatedCostUsd = null }) {
  if (!reservation?.groupId) return;
  const inputTokens = Number(promptTokens || 0);
  const outputTokens = Number(completionTokens || 0);
  const cost = estimatedCostUsd === null || estimatedCostUsd === undefined
    ? estimateOpenAiCostUsd(inputTokens, outputTokens)
    : Number(estimatedCostUsd || 0);
  await query(
    `UPDATE ai_usage_monthly
        SET provider = $3,
            model = $4,
            prompt_tokens = prompt_tokens + $5,
            completion_tokens = completion_tokens + $6,
            estimated_cost_usd = estimated_cost_usd + $7,
            updated_at = CURRENT_TIMESTAMP
      WHERE group_id = $1 AND period_month = $2`,
    [
      reservation.groupId,
      reservation.periodMonth,
      provider,
      model,
      inputTokens,
      outputTokens,
      Number.isFinite(cost) ? cost : 0,
    ]
  );
}
