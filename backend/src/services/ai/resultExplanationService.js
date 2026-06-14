function isUkrainian(locale = "en") {
  return String(locale || "").toLowerCase().startsWith("uk");
}

function isRussian(locale = "en") {
  return String(locale || "").toLowerCase().startsWith("ru");
}

function fmtMoney(value) {
  if (value === null || value === undefined) return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtPct(value) {
  if (value === null || value === undefined) return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n.toFixed(2)}%`;
}

function fmtSignedPct(value) {
  if (value === null || value === undefined) return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function metricLabel(step = {}) {
  const primary = String(step?.metadata?.columns_used?.metric || step?.metric?.column || "").trim();
  if (primary) return primary;
  const firstMetric = String(step?.metadata?.columns_used?.metrics?.[0] || step?.metrics?.[0]?.column || "").trim();
  if (firstMetric) return firstMetric;
  return "Metric";
}

function dimensionLabel(step = {}) {
  return String(step?.metadata?.columns_used?.dimension || step?.dimension || step?.metadata?.columns_used?.group_by?.[0] || "dimension");
}

function isFormulaPercent(step = {}, validatedPlan = null) {
  const op = String(step?.operation || "").toLowerCase();
  if (["ratio", "margin"].includes(op)) return true;
  const steps = Array.isArray(validatedPlan?.analysisPlan?.steps) ? validatedPlan.analysisPlan.steps : [];
  const planStep = steps.find((s) => String(s?.step_id || "") === String(step?.step_id || "")) || steps[steps.length - 1] || null;
  const metricCol = String(planStep?.metric?.column || step?.metadata?.columns_used?.metric || "").toLowerCase();
  return /(pct|percent|percentage|rate|ratio|margin|yield)/i.test(metricCol);
}

function fmtValueForStep(value, step = {}, validatedPlan = null) {
  return isFormulaPercent(step, validatedPlan) ? fmtPct(value) : fmtMoney(value);
}

function topRows(rows = [], limit = 10) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit);
}

function rowChangeValue(row = {}) {
  return row.absolute_change ?? row.delta ?? row.value ?? null;
}

function buildYoYReasonMap(stepResults = []) {
  const map = new Map();
  for (const step of Array.isArray(stepResults) ? stepResults : []) {
    if (String(step?.operation || "").toLowerCase() !== "period_delta_by_dimension") continue;
    for (const y of Array.isArray(step?.rows_by_year) ? step.rows_by_year : []) {
      const yr = Number(y?.year);
      const top = Array.isArray(y?.top_contributors) ? y.top_contributors[0] : null;
      if (!Number.isFinite(yr) || !top) continue;
      map.set(yr, { label: String(top?.label || ""), delta: top?.absolute_change ?? top?.delta ?? null });
    }
  }
  return map;
}

function buildGenericChangeReason(stepResults = []) {
  for (const step of Array.isArray(stepResults) ? stepResults : []) {
    const op = String(step?.operation || "").toLowerCase();
    if (op === "period_delta_by_dimension" || op === "ranking") {
      const rows = Array.isArray(step?.rows) ? step.rows : [];
      const top = rows[0];
      if (top && String(top?.label || "").trim()) return { label: String(top.label), delta: rowChangeValue(top) };
      const rowsByYear = Array.isArray(step?.rows_by_year) ? step.rows_by_year : [];
      const topYear = rowsByYear.find((y) => Array.isArray(y?.top_contributors) && y.top_contributors.length)?.top_contributors?.[0];
      if (topYear && String(topYear?.label || "").trim()) return { label: String(topYear.label), delta: rowChangeValue(topYear) };
    }
    if (op === "period_driver_delta") {
      const top = Array.isArray(step?.top_positive) && step.top_positive.length
        ? step.top_positive[0]
        : (Array.isArray(step?.rows) && step.rows.length ? step.rows[0] : null);
      if (top && String(top?.label || top?.column || "").trim()) return { label: String(top.label || top.column), delta: rowChangeValue(top) };
    }
  }
  return null;
}

function sectionTitle(op, { uk, ru }) {
  if (op === "aggregate") return uk ? "Підсумок" : (ru ? "Итог" : "Summary");
  if (op === "period_delta") return uk ? "Порівняння періодів" : (ru ? "Сравнение периодов" : "Period comparison");
  if (op === "year_over_year") return uk ? "Підсумок рік-до-року" : (ru ? "Итог год-к-году" : "Year-over-year summary");
  if (op === "period_driver_delta") return uk ? "Варіації числових драйверів" : (ru ? "Вариации числовых драйверов" : "Numeric driver variances");
  if (op === "period_delta_by_dimension") return uk ? "Вимірювані драйвери за виміром" : (ru ? "Измеримые драйверы по измерению" : "Measurable drivers by dimension");
  if (op === "ranking") return uk ? "Ранжування" : (ru ? "Рейтинг" : "Ranking");
  if (op === "trend") return uk ? "Тренд" : (ru ? "Тренд" : "Trend");
  if (op === "ratio") return uk ? "Коефіцієнт" : (ru ? "Коэффициент" : "Ratio");
  if (op === "margin") return uk ? "Маржа" : (ru ? "Маржа" : "Margin");
  if (op === "variance") return uk ? "Відхилення" : (ru ? "Отклонение" : "Variance");
  return uk ? "Результат" : (ru ? "Результат" : "Result");
}

function causationWarning({ uk, ru }) {
  if (uk) return "Це вимірювані драйвери, але не доведена причинність.";
  if (ru) return "Это измеримые драйверы, но не доказанная причинность.";
  return "These are measurable drivers, not proven causation.";
}

function hasDriverContent(stepResults = []) {
  return stepResults.some((s) => ["period_driver_delta", "period_delta_by_dimension"].includes(String(s?.operation || "").toLowerCase()));
}

function formatAggregate(step, ctx) {
  const { uk, ru, validatedPlan } = ctx;
  const metric = metricLabel(step);
  if (Array.isArray(step.rows)) {
    const lines = topRows(step.rows).map((r, i) => `${i + 1}. ${r.label}: ${fmtValueForStep(r.value, step, validatedPlan)}`);
    return [`${sectionTitle("aggregate", ctx)} - ${metric}`, ...lines].join("\n");
  }
  if (uk) return `${sectionTitle("aggregate", ctx)} - ${metric}: ${fmtValueForStep(step.value, step, validatedPlan)}.`;
  if (ru) return `${sectionTitle("aggregate", ctx)} - ${metric}: ${fmtValueForStep(step.value, step, validatedPlan)}.`;
  return `${sectionTitle("aggregate", ctx)} - ${metric}: ${fmtValueForStep(step.value, step, validatedPlan)}.`;
}

function formatPeriodDelta(step, ctx) {
  const { uk, ru, genericReason } = ctx;
  const metric = metricLabel(step);
  const reason = genericReason
    ? (uk
      ? ` Ймовірний вимірюваний драйвер: ${genericReason.label} (${fmtMoney(genericReason.delta)}).`
      : (ru
        ? ` Вероятный измеримый драйвер: ${genericReason.label} (${fmtMoney(genericReason.delta)}).`
        : ` Likely measurable driver: ${genericReason.label} (${fmtMoney(genericReason.delta)}).`))
    : "";
  if (uk) return `${sectionTitle("period_delta", ctx)} - ${metric}: базовий період ${fmtMoney(step.baseline_value)}, порівнюваний період ${fmtMoney(step.comparison_value)}, зміна ${fmtMoney(step.absolute_change)} (${fmtPct(step.percent_change)}).${reason}`;
  if (ru) return `${sectionTitle("period_delta", ctx)} - ${metric}: базовый период ${fmtMoney(step.baseline_value)}, период сравнения ${fmtMoney(step.comparison_value)}, изменение ${fmtMoney(step.absolute_change)} (${fmtPct(step.percent_change)}).${reason}`;
  return `${sectionTitle("period_delta", ctx)} - ${metric}: baseline ${fmtMoney(step.baseline_value)}, comparison ${fmtMoney(step.comparison_value)}, change ${fmtMoney(step.absolute_change)} (${fmtPct(step.percent_change)}).${reason}`;
}

function formatYoY(step, ctx) {
  const { uk, ru, reasonByYear } = ctx;
  const metric = metricLabel(step);
  const rows = Array.isArray(step.rows) ? step.rows : [];
  if (!rows.length) {
    if (uk) return `${sectionTitle("year_over_year", ctx)} - ${metric}: рядків не знайдено.`;
    if (ru) return `${sectionTitle("year_over_year", ctx)} - ${metric}: строки не найдены.`;
    return `${sectionTitle("year_over_year", ctx)} - ${metric}: no rows matched.`;
  }
  const lines = rows.map((r) => {
    const reason = reasonByYear.get(Number(r.year));
    const suffix = reason
      ? (uk
        ? ` Драйвер: ${reason.label} (${fmtMoney(reason.delta)}).`
        : (ru ? ` Драйвер: ${reason.label} (${fmtMoney(reason.delta)}).` : ` Driver: ${reason.label} (${fmtMoney(reason.delta)}).`))
      : "";
    if (uk) return `${r.year}: значення ${fmtMoney(r.value)}, попередній рік ${fmtMoney(r.previous_year_value)}, зміна ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)}).${suffix}`;
    if (ru) return `${r.year}: значение ${fmtMoney(r.value)}, предыдущий год ${fmtMoney(r.previous_year_value)}, изменение ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)}).${suffix}`;
    return `${r.year}: value ${fmtMoney(r.value)}, previous year ${fmtMoney(r.previous_year_value)}, change ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)}).${suffix}`;
  });
  return `${sectionTitle("year_over_year", ctx)} - ${metric}:\n${lines.join("\n")}`;
}

function formatPeriodDriverDelta(step, ctx) {
  const rows = Array.isArray(step.rows) ? step.rows : [];
  const baselineLabel = ctx.uk ? "базовий період" : (ctx.ru ? "базовый период" : "baseline");
  const comparisonLabel = ctx.uk ? "порівнюваний період" : (ctx.ru ? "период сравнения" : "comparison");
  const changeLabel = ctx.uk ? "зміна" : (ctx.ru ? "изменение" : "change");
  const lines = topRows(rows).map((r, i) => `${i + 1}. ${r.label}: ${baselineLabel} ${fmtMoney(r.baseline_value)}, ${comparisonLabel} ${fmtMoney(r.comparison_value)}, ${changeLabel} ${fmtMoney(r.delta)}`);
  return `${sectionTitle("period_driver_delta", ctx)}:\n${lines.length ? lines.join("\n") : (ctx.uk ? "немає" : (ctx.ru ? "нет" : "none"))}`;
}

function formatDimensionDelta(step, ctx) {
  const { uk, ru } = ctx;
  const dim = dimensionLabel(step);
  const rowsByYear = Array.isArray(step.rows_by_year) ? step.rows_by_year : [];
  if (rowsByYear.length) {
    const lines = [];
    for (const y of rowsByYear) {
      const contributors = topRows(y.top_contributors || [], 5);
      if (!contributors.length) {
        lines.push(uk ? `З ${y.previous_year} до ${y.year}: немає` : (ru ? `С ${y.previous_year} по ${y.year}: нет` : `From ${y.previous_year} to ${y.year}: none`));
        continue;
      }
      const formatted = contributors.map((c, i) => `${i + 1}. ${c.label}: ${fmtMoney(c.absolute_change)} (${fmtPct(c.percent_change)})`).join("; ");
      lines.push(uk ? `З ${y.previous_year} до ${y.year}: ${formatted}` : (ru ? `С ${y.previous_year} по ${y.year}: ${formatted}` : `From ${y.previous_year} to ${y.year}: ${formatted}`));
    }
    return `${sectionTitle("period_delta_by_dimension", ctx)} - ${dim}:\n${lines.join("\n")}`;
  }

  const rows = Array.isArray(step.rows) ? step.rows : [];
  const baselineLabel = uk ? "базовий період" : (ru ? "базовый период" : "baseline");
  const comparisonLabel = uk ? "порівнюваний період" : (ru ? "период сравнения" : "comparison");
  const changeLabel = uk ? "зміна" : (ru ? "изменение" : "change");
  const lines = topRows(rows).map((r, i) => `${i + 1}. ${r.label}: ${baselineLabel} ${fmtMoney(r.baseline_value)}, ${comparisonLabel} ${fmtMoney(r.comparison_value)}, ${changeLabel} ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)})`);
  return `${sectionTitle("period_delta_by_dimension", ctx)} - ${dim}:\n${lines.length ? lines.join("\n") : (uk ? "немає" : (ru ? "нет" : "none"))}`;
}

function formatRanking(step, ctx) {
  const dim = dimensionLabel(step);
  const rowsByYear = Array.isArray(step.rows_by_year) ? step.rows_by_year : [];
  if (rowsByYear.length) {
    const lines = rowsByYear.map((bucket) => {
      const year = bucket?.year ?? "N/A";
      const ranked = topRows(bucket?.top_ranked || [], 10);
      if (!ranked.length) return `${year}: ${ctx.uk ? "немає" : (ctx.ru ? "нет" : "none")}`;
      const yoyLabel = ctx.uk ? "зміна р/р" : (ctx.ru ? "изм. г/г" : "YoY");
      const shareLabel = ctx.uk ? "частка року" : (ctx.ru ? "доля года" : "share");
      return `${year}: ${ranked.map((r, i) => `${i + 1}. ${r.label}: ${fmtMoney(r.value)} (${yoyLabel} ${fmtSignedPct(r.percent_change)}, ${shareLabel} ${fmtPct(r.share_of_year_percent)})`).join("; ")}`;
    });
    return `${sectionTitle("ranking", ctx)} - ${dim}:\n${lines.join("\n")}`;
  }

  const rows = Array.isArray(step.rows) ? step.rows : [];
  if (!rows.length) return `${sectionTitle("ranking", ctx)} - ${dim}: ${ctx.uk ? "результатів немає" : (ctx.ru ? "нет результатов" : "no results")}.`;
  const lines = topRows(rows).map((r, i) => `${i + 1}. ${r.label}: ${fmtMoney(r.value)}`);
  return `${sectionTitle("ranking", ctx)} - ${dim}:\n${lines.join("\n")}`;
}

function formatTrend(step, ctx) {
  const rows = Array.isArray(step.rows) ? step.rows : [];
  const metric = metricLabel(step);
  if (!rows.length) return `${sectionTitle("trend", ctx)} - ${metric}: ${ctx.uk ? "дані не знайдено" : (ctx.ru ? "данные не найдены" : "no rows")}.`;
  const lines = rows.map((r) => {
    const label = r.year ?? r.period ?? "N/A";
    if ("absolute_change" in r || "percent_change" in r) {
      return `${label}: ${fmtMoney(r.value)}, previous ${fmtMoney(r.previous_year_value ?? r.previous_value)}, change ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)})`;
    }
    return `${label}: ${fmtMoney(r.value ?? r.metric_value ?? null)}`;
  });
  return `${sectionTitle("trend", ctx)} - ${metric}:\n${lines.join("\n")}`;
}

function formatFormula(step, ctx) {
  return `${sectionTitle(String(step?.operation || ""), ctx)}: ${fmtValueForStep(step.value, step, ctx.validatedPlan)}.`;
}

function formatLegacyDriverOutput(computed, ctx) {
  const positives = Array.isArray(computed?.top_positive) ? computed.top_positive : [];
  const negatives = Array.isArray(computed?.top_negative) ? computed.top_negative : [];
  const pos = topRows(positives, 5).map((r, i) => `${i + 1}. ${r.label}: ${fmtMoney(r.delta ?? r.absolute_change ?? r.value)}`).join("\n");
  const neg = topRows(negatives, 5).map((r, i) => `${i + 1}. ${r.label}: ${fmtMoney(r.delta ?? r.absolute_change ?? r.value)}`).join("\n");
  const positiveTitle = ctx.uk ? "Позитивні внески" : (ctx.ru ? "Положительные вклады" : "Positive contributors");
  const negativeTitle = ctx.uk ? "Компенсуючі негативні внески" : (ctx.ru ? "Компенсирующие отрицательные вклады" : "Offsetting negative contributors");
  return [
    `${sectionTitle("period_driver_delta", ctx)}:`,
    `${positiveTitle}:\n${pos || (ctx.uk ? "немає" : (ctx.ru ? "нет" : "none"))}`,
    `${negativeTitle}:\n${neg || (ctx.uk ? "немає" : (ctx.ru ? "нет" : "none"))}`,
    (ctx.uk ? "Це показує вимірювані драйвери в таблиці, але не доводить причинність." : (ctx.ru ? "Это показывает измеримые драйверы в таблице, но не доказывает причинность." : "This shows measurable spreadsheet drivers, not guaranteed causation.")),
  ].join("\n");
}

function formatStep(step, ctx) {
  const op = String(step?.operation || step?.outputType || "").toLowerCase();
  if (op === "aggregate") return formatAggregate(step, ctx);
  if (op === "period_delta") return formatPeriodDelta(step, ctx);
  if (op === "year_over_year") return formatYoY(step, ctx);
  if (op === "period_driver_delta") return formatPeriodDriverDelta(step, ctx);
  if (op === "period_delta_by_dimension") return formatDimensionDelta(step, ctx);
  if (op === "ranking") return formatRanking(step, ctx);
  if (op === "trend") return formatTrend(step, ctx);
  if (["ratio", "margin", "variance"].includes(op)) return formatFormula(step, ctx);
  if (op === "drivers") return formatLegacyDriverOutput(step, ctx);
  if (op === "yoy_table") return formatYoY({ ...step, operation: "year_over_year" }, ctx);
  return `${sectionTitle(op, ctx)}: ${fmtMoney(step?.value ?? null)}.`;
}

export function explainDeterministicResults({ validatedPlan = null, computed = null, locale = "en" }) {
  const uk = isUkrainian(locale);
  const ru = isRussian(locale);

  if (!computed?.ok) {
    if (uk) return "Не вдалося безпечно обчислити детермінований результат для цього плану.";
    if (ru) return "Не удалось безопасно выполнить детерминированный расчет для этого плана.";
    return "I could not compute a safe deterministic result for this plan.";
  }

  const stepResults = Array.isArray(computed.step_results) ? computed.step_results : [];
  const ctx = {
    uk,
    ru,
    validatedPlan,
    reasonByYear: buildYoYReasonMap(stepResults),
    genericReason: buildGenericChangeReason(stepResults),
  };

  if (stepResults.length) {
    const rawSections = stepResults.map((step) => formatStep(step, ctx)).filter(Boolean);
    const sections = [];
    for (const section of rawSections) {
      if (!sections.length || String(sections[sections.length - 1]) !== String(section)) {
        sections.push(section);
      }
    }
    if (hasDriverContent(stepResults)) sections.push(causationWarning({ uk, ru }));
    return sections.join("\n\n");
  }

  return formatStep(computed, ctx);
}
