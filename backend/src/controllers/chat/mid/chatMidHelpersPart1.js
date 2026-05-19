export function chatMidHelpersPart1(deps) {
  const {
    query,
    getClient,
    writeAuditLog,
    buildSheetSemanticProfile,
    resolveProfileDateColumn,
    resolveProfileDimension,
    resolveProfileMetric,
    loadEffectiveAiRuntimeSettings,
    resolveChatCompletionProviderConfig,
    buildChatCompletionRequestBody,
    extractOpenAiAssistantText,
    minCompletionTokensForModel,
    enforceAiPromptBudget,
    OPENAI_BASE_URL,
    OPENAI_TIMEOUT_MS,
    AI_DEBUG_LOGS,
    CHAT_RUNTIME_RULES_DEFAULTS,
    HEADER_AI_SAMPLE_VALUES_PER_COLUMN,
    reserveAiQueryForSheet,
    resolveAiGroupIdForSheet,
    recordAiUsage,
    estimateOpenAiCostUsd,
    translateDashboardItems,
    isEnglishLocale,
    normalizeLocale,
    hasReportSourceOwnerAccess,
    isPlatformAdminUser,
    loadSheetPermissionSets,
    buildRowFilterWhereClause,
    resolveRuntimeGroupIdForUser,
    checkSheetAccess,
    groupHasFeature,
  } = deps;

async function computeDeterministicAnswer(operation, rows, targetColumn, groupBy, limit = 5, locale = "en", queryText = "") {
  const op = (operation || "none").toLowerCase();
  const lang = String(locale || "en").toLowerCase();
  const isUk = lang.startsWith("uk");
  const isRu = lang.startsWith("ru");
  const q = String(queryText || "").toLowerCase();
  const nLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 5;

  if (!rows || rows.length === 0) {
    return { answer: isUk ? "Дані за цими критеріями не знайдено." : (isRu ? "Данные по этим критериям не найдены." : "No data matched those criteria."), previewRows: [] };
  }

  if (op === "count") return { answer: isUk ? `Кількість: ${rows.length} рядків` : (isRu ? `Количество: ${rows.length} строк` : `Count: ${rows.length} rows`), previewRows: rows.slice(0, 15) };
  
  // --- Financial Ratio & Analysis Engine (Loaded from DB) ---
  const { ratios } = await loadSemanticBrain();

  const matchedRatio = ratios.find((r) => r?.match?.test?.(q));
  if (matchedRatio) {
    const ratioCols = Array.isArray(matchedRatio.cols) ? matchedRatio.cols : [];
    const rowHeaders = Object.keys(rows?.[0] || {});
    const resolvedCols = await Promise.all(
      ratioCols.map((c) => resolveColumn(rowHeaders, c, rows.slice(0, 10)))
    );
    if (resolvedCols.length > 0 && resolvedCols.every((c) => !!c)) {
        const sums = resolvedCols.map((c) => rows.reduce((acc, r) => acc + (toNum(r[c]) || 0), 0));
        if (sums.every(s => s !== 0 || matchedRatio.key === "rainy_day")) {
            const result = matchedRatio.calc(sums);
            let ans = "";
            if (matchedRatio.format === "percent") ans = `${matchedRatio.label}: ${result.toFixed(2)}%`;
            else if (matchedRatio.format === "ratio") ans = `${matchedRatio.label}: ${result.toFixed(2)}x`;
            else if (matchedRatio.format === "months") ans = `${matchedRatio.label}: ${result.toFixed(1)} months remaining`;
            else if (matchedRatio.format === "weeks") ans = `${matchedRatio.label}: ${result.toFixed(1)} weeks remaining`;
            else if (matchedRatio.format === "days") ans = `${matchedRatio.label}: ${Math.round(result)} days`;
            else ans = `${matchedRatio.label}: ${formatValue(result, locale, resolvedCols[0])}`;
            
            // Add custom pragmatic flavor to the answer
            if (matchedRatio.key === "rainy_day") {
                ans += result > 12 ? ". You can sleep well at night!" : ". This is a tight buffer, watch your expenses.";
            } else if (matchedRatio.key === "headache_ratio") {
                ans += result > 10 ? ". This category might be more trouble than it's worth." : ". This is a very healthy relationship.";
            }
            
            return { answer: ans, previewRows: rows.slice(0, 5) };
        }
    }
  }

  if (!targetColumn) return { answer: isUk ? "Записи знайдено, але відповідну метрику для розрахунку не визначено." : (isRu ? "Записи найдены, но подходящий столбец метрики для расчета не определен." : "I found the matching records, but no specific metric column was identified for calculation."), previewRows: rows.slice(0, 15) };

  const isPercentageCol = /percent|margin|rate|ratio|%/i.test(String(targetColumn));
  const effectiveOp = (op === "sum" && isPercentageCol) ? "avg" : op;

  // --- Year Over Year / Same Period Logic ---
  const isYoYQuery = effectiveOp === "year_over_year" || 
                    (groupBy && /year|дата|рік|год/i.test(String(groupBy)) && (effectiveOp === "sum" || effectiveOp === "top_n")) ||
                    (/previous year|last year|прошлый год|минулий рік/i.test(String(targetColumn || ""))) ||
                    (q.includes("previous year") || q.includes("last year") || q.includes("минулого року") || q.includes("прошлого года"));

  if (isYoYQuery) {
    const keys = Object.keys(rows[0] || {});
    let dateCol = keys.find(k => /date|period|month|year|дата|період|час/i.test(String(k))) || groupBy;
    const explicitYearCol = keys.find((k) => /\byear\b|рік|год/i.test(String(k)));
    const profitCandidates = [
      targetColumn,
      ...keys.filter((k) => /(^|\b)(net\s*profit|чист(ий|ая)\s+прибут(ок|ь))(\b|$)/i.test(String(k))),
      ...keys.filter((k) => /profit|прибут/i.test(String(k))),
    ].filter(Boolean);
    
    let targetRows = rows;

    // Special: "Latest Month" YoY
    if (q.includes("latest month") || q.includes("останній місяць") || q.includes("последний месяц")) {
        // Find latest month in the full set
        let latestDate = null;
        rows.forEach(r => {
            const d = parseDateValue(r[dateCol]);
            if (d && (!latestDate || d > latestDate)) latestDate = d;
        });
        if (latestDate) {
            const targetMonth = latestDate.getMonth();
            const monthName = latestDate.toLocaleString('en-US', { month: 'long' });
            targetRows = rows.filter(r => {
                const d = parseDateValue(r[dateCol]);
                return d && d.getMonth() === targetMonth;
            });
            // Adjust title
            targetColumn = `${targetColumn} for ${monthName}`;
        }
    }

    const yearlySums = {};
    targetRows.forEach(r => {
      const yearSources = [dateCol, explicitYearCol, ...keys.filter((k) => /year|рік|год|date|period|month|дата|період|час/i.test(String(k)))].filter(Boolean);
      let year = null;
      for (const ys of yearSources) {
        const d = parseDateValue(r[ys]);
        year = d ? d.getFullYear() : (Number.isInteger(Number(r[ys])) ? Number(r[ys]) : null);
        if (!year && ys) {
          const yv = Number(String(r?.[ys] ?? "").replace(/[^\d]/g, ""));
          if (Number.isInteger(yv) && yv >= 1900 && yv <= 2200) year = yv;
        }
        if (year) break;
      }
      if (!year && explicitYearCol) {
        const yv = Number(String(r?.[explicitYearCol] ?? "").replace(/[^\d]/g, ""));
        if (Number.isInteger(yv) && yv >= 1900 && yv <= 2200) year = yv;
      }
      if (!year) return;
      let val = null;
      for (const col of profitCandidates) {
        const parsed = toNum(r[col]);
        if (parsed !== null) {
          val = parsed;
          break;
        }
      }
      if (val !== null) yearlySums[year] = (yearlySums[year] || 0) + val;
    });

    const years = dropImplicitTrailingPartialYear(Object.keys(yearlySums), queryText);
    if (years.length >= 2) {
      const explicitYears = extractDistinctYearsInOrder(queryText);
      const asksYearDelta = asksDifferenceBetweenYears(queryText);
      if (asksYearDelta && explicitYears.length >= 2) {
        const startYear = explicitYears[0];
        const endYear = explicitYears[1];
        if (Number.isFinite(yearlySums[startYear]) && Number.isFinite(yearlySums[endYear])) {
          const delta = yearlySums[endYear] - yearlySums[startYear];
          if (asksNumberOnlyResponse(queryText)) {
            return { answer: formatPlainNumber(delta), previewRows: [] };
          }
          return {
            answer: `${endYear} vs ${startYear} ${targetColumn}: ${formatValue(delta, locale, targetColumn)}`,
            previewRows: [{ from_year: startYear, to_year: endYear, change: delta }],
          };
        }
      }

      let comparisonText = "";
      if (locale.startsWith("uk")) {
        comparisonText = `Аналіз року до року для ${targetColumn}:\n`;
      } else if (locale.startsWith("ru")) {
        comparisonText = `Анализ год к году для ${targetColumn}:\n`;
      } else {
        comparisonText = `Year over Year analysis for ${targetColumn}:\n`;
      }
      
      const previewRows = [];
      const growthPercentages = [];
      
      for (let i = 1; i < years.length; i++) {
        const currentYear = years[i];
        const prevYear = years[i - 1];
        const currentVal = yearlySums[currentYear];
        const prevVal = yearlySums[prevYear];
        const diff = currentVal - prevVal;
        const pct = prevVal !== 0 ? (diff / Math.abs(prevVal)) * 100 : 0;
        growthPercentages.push(pct);
        
        comparisonText += `• ${currentYear} vs ${prevYear}: ${formatValue(currentVal, locale, targetColumn)} vs ${formatValue(prevVal, locale, targetColumn)} `;
        comparisonText += `(${diff >= 0 ? "+" : ""}${formatValue(diff, locale, targetColumn)}, ${diff >= 0 ? "+" : ""}${pct.toFixed(2)}%)\n`;
        
        previewRows.push({ year: currentYear, value: currentVal, previous_year: prevYear, previous_value: prevVal, change: diff, change_percent: pct });
      }

      // Add Summary Insights
      const avgGrowth = growthPercentages.reduce((a, b) => a + b, 0) / growthPercentages.length;
      const bestYear = [...previewRows].sort((a, b) => b.change_percent - a.change_percent)[0];
      
      if (locale.startsWith("uk")) {
        comparisonText += `\n**Підсумок:**\n`;
        comparisonText += `• Середньорічне зростання: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(2)}%\n`;
        comparisonText += `• Кращий рік: ${bestYear.year} (${bestYear.change_percent >= 0 ? "+" : ""}${bestYear.change_percent.toFixed(2)}% зростання)`;
      } else if (locale.startsWith("ru")) {
        comparisonText += `\n**Итог:**\n`;
        comparisonText += `• Среднегодовой рост: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(2)}%\n`;
        comparisonText += `• Лучший год: ${bestYear.year} (${bestYear.change_percent >= 0 ? "+" : ""}${bestYear.change_percent.toFixed(2)}% роста)`;
      } else {
        comparisonText += `\n**Summary:**\n`;
        comparisonText += `• Average Annual Growth: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(2)}%\n`;
        comparisonText += `• Best Performing Year: ${bestYear.year} (${bestYear.change_percent >= 0 ? "+" : ""}${bestYear.change_percent.toFixed(2)}% growth)`;
      }

      return { answer: comparisonText.trim(), previewRows };
    }
  }

  if (groupBy && ["max", "min", "top_n", "sum", "avg"].includes(effectiveOp)) {
    const wantsProfitTop = effectiveOp === "top_n" && /\b(profit|margin|ebit|ebitda)\b|прибут|прибыл/i.test(String(targetColumn || ""));
    if (wantsProfitTop) {
      const keys = Object.keys(rows?.[0] || {});
      const revenueCol = keys.find((k) => /\b(net\s*revenue|revenue\s*total|revenue|sales|income)\b|выруч|доход|дохід|продаж/i.test(String(k || "")));
      const expenseCol = keys.find((k) => /\b(expense|cost|spend|cogs|opex|expense\s*billed)\b|расход|витрат/i.test(String(k || "")));
      if (revenueCol && expenseCol) {
        const groupedProfit = {};
        rows.forEach((r) => {
          const key = String(r?.[groupBy] ?? "Unknown");
          const rev = toNum(r?.[revenueCol]) || 0;
          const exp = toNum(r?.[expenseCol]) || 0;
          groupedProfit[key] = (groupedProfit[key] || 0) + (rev - exp);
        });
        const entries = Object.entries(groupedProfit)
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, nLimit);
        if (entries.length) {
          const answer = (isUk ? `Топ ${entries.length} ${groupBy} за прибутком:\n` : (isRu ? `Топ ${entries.length} ${groupBy} по прибыли:\n` : `Top ${entries.length} ${groupBy} by profit:\n`))
            + entries.map((r, i) => `${i + 1}. ${r.label}: ${formatValue(Number(r.value), locale, targetColumn)}`).join("\n");
          return { answer, previewRows: entries };
        }
      }
    }
    const grouped = {};
    const counts = {};
    let numericRowCount = 0;
    rows.forEach((r) => {
      const key = String(r?.[groupBy] ?? "Unknown");
      const val = toNum(r?.[targetColumn]);
      if (val === null) return;
      numericRowCount += 1;
      
      if (effectiveOp === "max") {
        if (grouped[key] === undefined || val > grouped[key]) grouped[key] = val;
      } else if (effectiveOp === "min") {
        if (grouped[key] === undefined || val < grouped[key]) grouped[key] = val;
      } else {
        grouped[key] = (grouped[key] || 0) + val;
        counts[key] = (counts[key] || 0) + 1;
      }
    });

    const sorted = Object.entries(grouped)
      .map(([label, value]) => {
        const finalValue = (effectiveOp === "avg" && counts[label]) ? value / counts[label] : value;
        return { label: enrichGroupedLabelWithName(groupBy, label, rows), value: finalValue };
      })
      .sort((a, b) => b.value - a.value);

    if (!sorted.length) return { answer: isUk ? "Відповідних даних не знайдено." : (isRu ? "Подходящие данные не найдены." : "No matching data."), previewRows: [] };
    const skippedRows = Math.max(0, Number(rows.length || 0) - numericRowCount);

    if (effectiveOp === "max") {
      const base = isUk ? `Найвище значення ${targetColumn}: ${sorted[0].label} — ${formatValue(sorted[0].value, locale, targetColumn)}` : (isRu ? `Максимум по ${targetColumn}: ${sorted[0].label} — ${formatValue(sorted[0].value, locale, targetColumn)}` : `Highest ${targetColumn}: ${sorted[0].label} with ${formatValue(sorted[0].value, locale, targetColumn)}`);
      return { answer: appendSkippedRowsNote(base, skippedRows, locale), previewRows: sorted.slice(0, 10) };
    }
    if (effectiveOp === "min") {
      const bottom = [...sorted].sort((a, b) => a.value - b.value)[0];
      const base = isUk ? `Найнижче значення ${targetColumn}: ${bottom.label} — ${formatValue(bottom.value, locale, targetColumn)}` : (isRu ? `Минимум по ${targetColumn}: ${bottom.label} — ${formatValue(bottom.value, locale, targetColumn)}` : `Lowest ${targetColumn}: ${bottom.label} with ${formatValue(bottom.value, locale, targetColumn)}`);
      return { answer: appendSkippedRowsNote(base, skippedRows, locale), previewRows: [...sorted].sort((a, b) => a.value - b.value).slice(0, 10) };
    }

    if (nLimit === 1) {
      const base = isUk
          ? `Топ ${groupBy} за ${targetColumn}: ${sorted[0].label} — ${formatValue(sorted[0].value, locale, targetColumn)}.`
          : (isRu
            ? `Топ ${groupBy} по ${targetColumn}: ${sorted[0].label} — ${formatValue(sorted[0].value, locale, targetColumn)}.`
            : `The top ${groupBy} by ${targetColumn} is ${sorted[0].label} with ${formatValue(sorted[0].value, locale, targetColumn)}.`);
      return { 
        answer: appendSkippedRowsNote(base, skippedRows, locale),
        previewRows: sorted.slice(0, 1)
      };
    }

    return {
      answer: appendSkippedRowsNote(
        (isUk ? `Топ ${nLimit} ${groupBy} за ${targetColumn}:\n` : (isRu ? `Топ ${nLimit} ${groupBy} по ${targetColumn}:\n` : `Top ${nLimit} ${groupBy} by ${targetColumn}:\n`))
          + sorted.slice(0, nLimit).map((x, i) => `${i + 1}. ${x.label}: ${formatValue(x.value, locale, targetColumn)}`).join("\n"),
        skippedRows,
        locale
      ),
      previewRows: sorted.slice(0, nLimit)
    };
  }

  const nums = rows.map((r) => toNum(r?.[targetColumn])).filter((n) => n !== null);
  if (!nums.length) return { answer: isUk ? `У стовпці ${targetColumn} не знайдено числових даних.` : (isRu ? `В столбце ${targetColumn} не найдено числовых данных.` : `No numeric data found in ${targetColumn}.`), previewRows: rows.slice(0, 15) };
  const skippedRows = Math.max(0, Number(rows.length || 0) - Number(nums.length || 0));
  
  if (effectiveOp === "sum") return { answer: appendSkippedRowsNote(isUk ? `Сума ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0), locale, targetColumn)}` : (isRu ? `Сумма ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0), locale, targetColumn)}` : `Total ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0), locale, targetColumn)}`), skippedRows, locale), previewRows: rows.slice(0, 15) };
  if (effectiveOp === "avg") return { answer: appendSkippedRowsNote(isUk ? `Середнє ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0) / nums.length, locale, targetColumn)}` : (isRu ? `Среднее ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0) / nums.length, locale, targetColumn)}` : `Average ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0) / nums.length, locale, targetColumn)}`), skippedRows, locale), previewRows: rows.slice(0, 15) };
  
  if (effectiveOp === "max") {
    let max = -Infinity;
    for (let i = 0; i < nums.length; i++) if (nums[i] > max) max = nums[i];
    return { answer: appendSkippedRowsNote(isUk ? `Максимум ${targetColumn}: ${formatValue(max, locale, targetColumn)}` : (isRu ? `Максимум ${targetColumn}: ${formatValue(max, locale, targetColumn)}` : `Max ${targetColumn}: ${formatValue(max, locale, targetColumn)}`), skippedRows, locale), previewRows: rows.slice(0, 15) };
  }
  if (effectiveOp === "min") {
    let min = Infinity;
    for (let i = 0; i < nums.length; i++) if (nums[i] < min) min = nums[i];
    return { answer: appendSkippedRowsNote(isUk ? `Мінімум ${targetColumn}: ${formatValue(min, locale, targetColumn)}` : (isRu ? `Минимум ${targetColumn}: ${formatValue(min, locale, targetColumn)}` : `Min ${targetColumn}: ${formatValue(min, locale, targetColumn)}`), skippedRows, locale), previewRows: rows.slice(0, 15) };
  }
  return { answer: "", previewRows: rows.slice(0, 15) };
}

const CACHE_TTL = 300000; // 5 minutes

async function loadSemanticBrain() {
    const now = Date.now();
    if (SEMANTIC_CACHE && RATIO_CACHE && (now - CACHE_TS < CACHE_TTL)) {
        return { buckets: SEMANTIC_CACHE, ratios: RATIO_CACHE };
    }

    try {
        const knowledge = await getSemanticKnowledge();
        const bucketsMap = {};
        Object.entries(knowledge).forEach(([cat, synonyms]) => {
            if (!bucketsMap[cat]) bucketsMap[cat] = { key: cat, synonyms: [] };
            bucketsMap[cat].synonyms = Array.from(new Set([...bucketsMap[cat].synonyms, ...synonyms]));
        });

        const ratioRows = await query(`SELECT name, match_pattern as match, formula_type as format, required_buckets as buckets FROM financial_ratios WHERE group_id IS NULL`, []);

        SEMANTIC_CACHE = Object.values(bucketsMap);
        RATIO_CACHE = ratioRows.map(r => ({
            ...r,
            match: new RegExp(r.match, 'i'),
            calc: (vals) => {
                if (r.name === 'Gross Margin') return ((vals[0] - vals[1]) / (vals[0] || 1)) * 100;
                if (r.name === 'Free Cash Flow') return vals[0] - vals[1];
                if (r.name === 'Burn Rate') return vals[0] / (vals[1] || 1);
                if (r.name === 'DSO') return (vals[0] / (vals[1] || 1)) * 365;
                if (r.name === 'Current Ratio') return vals[0] / (vals[1] || 1);
                if (r.name === 'Revenue per Employee') return vals[0] / (vals[1] || 1);
                return 0;
            }
        }));
        CACHE_TS = now;
        return { buckets: SEMANTIC_CACHE, ratios: RATIO_CACHE };
    } catch (e) {
        console.error("Failed to load semantic brain:", e);
        return { buckets: SEMANTIC_CACHE || [], ratios: RATIO_CACHE || [] };
    }
}

async function resolveColumn(headers, aiName, sampleRows = []) {
  if (!aiName || !headers.length) return null;
  const target = String(aiName).toLowerCase().trim();
  const normalizedTarget = target.replace(/\s+/g, " ");

  // High-priority deterministic mapping for key finance terms.
  const hasNetProfitIntent = /(^|\b)(net\s*profit|чист(ий|ая)\s+прибут(ок|ь))(\b|$)/i.test(normalizedTarget);
  if (hasNetProfitIntent) {
    const strict = headers.find((h) => /(^|\b)(net\s*profit|чист(ий|ая)\s+прибут(ок|ь))(\b|$)/i.test(String(h || "").toLowerCase()));
    if (strict) return strict;
    const loose = headers.find((h) => /profit|прибут/i.test(String(h || "").toLowerCase()));
    if (loose) return loose;
  }

  const direct = headers.find(h => String(h).toLowerCase() === target);
  if (direct) return direct;

  const { buckets } = await loadSemanticBrain();

  for (const bucket of buckets) {
    if (bucket.synonyms.some(s => target.includes(s) || s.includes(target))) {
        for (const synonym of bucket.synonyms) {
            const found = headers.find(h => String(h).toLowerCase().includes(synonym));
            if (found) return found;
        }
    }
  }

  // 3. Smart Fallback: If AI is asking for a date/number and we found no name match, check data patterns
  if (sampleRows.length > 0) {
    const isTargetDate = /date|year|period|month|рік|год|дата/i.test(target);
    const isTargetNumeric = /revenue|income|cost|expense|profit|amount|value|доход|расход|витрати/i.test(target);

    if (isTargetDate) {
      const bestDateCol = headers.find(h => {
        const sample = sampleRows.slice(0, 10).map(r => r[h]);
        return sample.filter(v => parseDateValue(v) !== null).length > sample.length / 2;
      });
      if (bestDateCol) return bestDateCol;
    }

    if (isTargetNumeric) {
      const bestNumCol = headers.find(h => {
        const sample = sampleRows.slice(0, 10).map(r => r[h]);
        return sample.filter(v => toNum(v) !== null).length > sample.length / 2;
      });
      if (bestNumCol) return bestNumCol;
    }
  }

  return headers.find(h => String(h).toLowerCase().includes(target)) || null;
}

function applyFilters(rows, filters) {
    if (!filters?.length) return rows;
    return rows.filter(row => {
        return filters.every(f => {
            if (f.operator === "in") {
                const values = Array.isArray(f.values) ? f.values.map((v) => String(v ?? "")) : [];
                if (!values.length) return true;
                return values.includes(String(row[f.column] ?? ""));
            }
            const val = toNum(row[f.column]);
            const filterVal = toNum(f.value);
            const cellStr = String(row[f.column] || "").toLowerCase();
            const searchStr = String(f.value || "").toLowerCase();
            
            switch(f.operator) {
                case 'equals': return cellStr === searchStr;
                case 'gt': return val !== null && filterVal !== null && val > filterVal;
                case 'gte': return val !== null && filterVal !== null && val >= filterVal;
                case 'lt': return val !== null && filterVal !== null && val < filterVal;
                case 'lte': return val !== null && filterVal !== null && val <= filterVal;
                default: return cellStr.includes(searchStr);
            }
        });
    });
}

function normalizeScopeColumns(input = [], availableHeaders = []) {
  if (!Array.isArray(input) || !input.length) return [];
  const byLower = new Map((availableHeaders || []).map((h) => [String(h).trim().toLowerCase(), h]));
  return input
    .map((c) => byLower.get(String(c || "").trim().toLowerCase()) || null)
    .filter(Boolean);
}

function projectRowsToHeaders(rows = [], headers = []) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(headers) || !headers.length) return rows || [];
  const allowed = new Set(headers.map((h) => String(h)));
  return rows.map((row) => {
    const next = {};
    Object.keys(row || {}).forEach((k) => {
      if (allowed.has(String(k))) next[k] = row[k];
    });
    return next;
  });
}

function extractExplicitYears(text = "") {
  return new Set(
    String(text || "")
      .match(/\b(19\d{2}|20\d{2}|21\d{2}|2200)\b/g)
      ?.map((year) => Number(year)) || []
  );
}

function shouldIncludeTrailingPartialYear(queryText = "", year = null, now = new Date()) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear)) return false;
  if (extractExplicitYears(queryText).has(numericYear)) return true;
  return /\b(current|this|latest|partial|ytd|year\s*to\s*date|year-to-date)\s+year\b|\bytd\b|поточн(ий|ого)\s+р(і|о)к|текущ(ий|его)\s+год|останн(ій|ього)\s+р(і|о)к|последн(ий|его)\s+год/i.test(String(queryText || ""));
}

function dropImplicitTrailingPartialYear(years = [], queryText = "", now = new Date()) {
  const sortedYears = (Array.isArray(years) ? years : [])
    .map((year) => Number(year))
    .filter((year) => Number.isInteger(year))
    .sort((a, b) => a - b);
  if (sortedYears.length < 2) return sortedYears;
  const latestYear = sortedYears[sortedYears.length - 1];
  const currentYear = now.getFullYear();
  if (latestYear >= currentYear && !shouldIncludeTrailingPartialYear(queryText, latestYear, now)) {
    return sortedYears.slice(0, -1);
  }
  return sortedYears;
}

function cleanAITechnicalNoise(text = "") {
  let out = String(text || "");
  // Remove technical sheet references only if they match exactly (e.g., Sheet1, Sheet2.00)
  out = out.replace(/\bSheet\d+(\.00)?\b/gi, "");
  // Remove empty-tab artifact phrases that can be left behind after sheet token stripping.
  out = out.replace(/\b(?:this is based on the data from|based on data from)\s*''\s*tab\.?/gi, "");
  // Remove specific technical version suffix .00 if it's isolated (not part of a currency/number)
  out = out.replace(/\s\.00\b/g, "");
  
  // Clean up spacing without collapsing newlines.
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s\./g, ".")
    .trim();
}

function normalizeChatMarkdownText(answer = "") {
  return String(answer || "")
    .replace(/\\r?\\n/g, "\n")
    .replace(/\s+\*\*([^*\n:]{1,80}):\*\*/g, "\n$1:")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\s+•\s+/g, "\n• ");
}

function formatDenseYoYComparisonBullets(text = "") {
  const raw = String(text || "").trim();
  if (!raw || raw.includes("\n")) return null;
  const looksLikeYoY = /\b(yoy|year[-\s]?over[-\s]?year|год к году|г\/г|р\/р|рік до року|річн)/i.test(raw);
  const hasDenseComparisons = raw.includes(";") || ((raw.match(/\b\d{4}\s+vs\s+\d{4}\b/gi) || []).length >= 2);
  if (!looksLikeYoY || !hasDenseComparisons) return null;
  const formatted = raw
    .replace(/:\s+(?=\d{4}\s+(?:год|рік|year)\b)/gi, ":\n• ")
    .replace(/;\s+(?=\d{4}\s+(?:год|рік|year)\b)/gi, "\n• ")
    .replace(/\.\s+(?=(?:YoY|Year[-\s]?over[-\s]?year|Год к году|Рост|Зростання|Ріст)[^:]{0,60}:)/gi, "\n")
    .replace(/:\s+(?=\d{4}\s+vs\s+\d{4}\b)/gi, ":\n• ")
    .replace(/,\s+(?=\d{4}\s+vs\s+\d{4}\b)/gi, "\n• ")
    .replace(/\.\s+(?=(?:Данные|Дані|Data)\b)/g, "\n• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return formatted.includes("\n• ") ? formatted : null;
}

function formatAnswerWithBullets(answer = "") {
  const text = typeof answer === "string" ? normalizeChatMarkdownText(answer).trim() : "";
  if (!text) return "";
  const denseYoYBullets = formatDenseYoYComparisonBullets(text);
  if (denseYoYBullets) return denseYoYBullets;
  // Do not auto-bullet plain numeric prose with decimals; it can split values like 34.91 into 34 + 91.
  if (!text.includes("\n") && /\d\.\d/.test(text)) return text;
  const normalizedExistingBullets = text
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n\s*[-*]\s+/g, "\n• ");
  if (normalizedExistingBullets.includes("\n• ") || normalizedExistingBullets.match(/\n\d+\.\s/)) return normalizedExistingBullets;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && text.length > 100) {
    const sentences = text.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 1) {
      return `${sentences[0].trim()}\n${sentences.slice(1).map(s => `• ${s.trim()}`).join("\n")}`;
    }
  }
  if (lines.length < 2) return text;
  const hasListMarkers = lines.some((l) => /^([-*]\s+|\d+\.\s+)/.test(l));
  if (hasListMarkers) return normalizedExistingBullets;
  if (lines[0].endsWith(":")) return `${lines[0]}\n${lines.slice(1).map((l) => `• ${l}`).join("\n")}`;
  return lines.map((l) => `• ${l}`).join("\n");
}

function enforceCommaThousands(answer = "") {
  const text = String(answer || "");
  // Convert spaced thousands like "12 000 000" -> "12,000,000"
  // Keep decimal part if present.
  return text.replace(/\b\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?\b/g, (raw) => {
    const compact = raw.replace(/\s+/g, "");
    const hasComma = compact.includes(",");
    const hasDot = compact.includes(".");
    if (hasComma && hasDot) {
      // treat commas as thousands separators and keep decimal dot
      const [intPart, decPart] = compact.split(".");
      return `${intPart.replace(/,/g, ",")}.${decPart}`;
    }
    if (hasComma || hasDot) {
      const sep = hasDot ? "." : ",";
      const idx = compact.lastIndexOf(sep);
      const intPart = compact.slice(0, idx).replace(/[.,]/g, "");
      const decPart = compact.slice(idx + 1);
      return `${Number(intPart).toLocaleString("en-US")}.${decPart}`;
    }
    return Number(compact).toLocaleString("en-US");
  });
}

function normalizeDatesAndRemoveTime(answer = "") {
  let text = String(answer || "");
  // Remove common time/timezone fragments.
  text = text
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/gi, "")
    .replace(/\b(?:UTC|GMT)\s*[+-]?\d{0,2}:?\d{0,2}\b/gi, "")
    .replace(/\b(?:EST|EDT|PST|PDT|CST|CDT|MST|MDT)\b/gi, "")
    .replace(/\s{2,}/g, " ");

  // YYYY-MM-DD -> MM-DD-YYYY
  text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${m}-${d}-${y}`);
  // YYYY/MM/DD -> MM-DD-YYYY
  text = text.replace(/\b(\d{4})\/(\d{2})\/(\d{2})\b/g, (_, y, m, d) => `${m}-${d}-${y}`);
  // MM/DD/YYYY or DD/MM/YYYY -> MM-DD-YYYY (assume first token is month by product rule)
  text = text.replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, (_, m, d, y) => `${m}-${d}-${y}`);

  return text.replace(/\s{2,}/g, " ").trim();
}

function enforceTwoDecimals(answer = "") {
  const text = String(answer || "");
  // Format numeric tokens (currency/percent/decimals) to 2 decimals.
  // We use a negative lookbehind (if supported) or logic to skip list indices like "1. "
  return text.replace(/([$-]?\d[\d,]*)(\.\d+)?(%?)/g, (raw, intPart, decPart, suffix, offset, fullString) => {
    // 1. Skip if it's a list index: check if it's at start of string or preceded by newline/bullet AND followed by a dot + space
    const before = fullString.slice(Math.max(0, offset - 2), offset);
    const after = fullString.slice(offset + intPart.length, offset + intPart.length + 2);
    const isAtLineStart = offset === 0 || /[\n•]/.test(before);
    if (isAtLineStart && after === ". ") return raw;

    // 2. Skip 4-digit years (isolated)
    const compact = String(intPart).replace(/[$,]/g, "");
    if (/^\d{4}$/.test(compact) && !decPart && !suffix) return raw;

    const n = Number(compact + (decPart || ""));
    if (!Number.isFinite(n)) return raw;
    
    // Only apply if it's monetary, a percentage, or already has a decimal
    if (!String(intPart).includes("$") && !suffix && !decPart) return raw;

    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const currency = String(intPart).includes("$") ? "$" : "";
    return `${sign}${currency}${abs}${suffix || ""}`;
  });
}

  return {
    computeDeterministicAnswer,
    loadSemanticBrain,
    resolveColumn,
    applyFilters,
    normalizeScopeColumns,
    projectRowsToHeaders,
    extractExplicitYears,
    shouldIncludeTrailingPartialYear,
    dropImplicitTrailingPartialYear,
    cleanAITechnicalNoise,
    normalizeChatMarkdownText,
    formatDenseYoYComparisonBullets,
    formatAnswerWithBullets,
    enforceCommaThousands,
    normalizeDatesAndRemoveTime,
    enforceTwoDecimals,
  };
}
