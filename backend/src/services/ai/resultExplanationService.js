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

function isScalarPercent(validatedPlan = null) {
  const steps = Array.isArray(validatedPlan?.analysisPlan?.steps) ? validatedPlan.analysisPlan.steps : [];
  const last = steps[steps.length - 1] || null;
  const op = String(last?.operation || "").toLowerCase();
  if (["ratio", "margin"].includes(op)) return true;
  const metricCol = String(last?.metric?.column || "").toLowerCase();
  return /(pct|percent|percentage|rate|ratio|margin|yield)/i.test(metricCol);
}


function buildYoYReasonMap(stepResults = []) {
  const map = new Map();
  for (const step of Array.isArray(stepResults) ? stepResults : []) {
    const op = String(step?.operation || "").toLowerCase();
    if (op !== "period_delta_by_dimension") continue;
    const rowsByYear = Array.isArray(step?.rows_by_year) ? step.rows_by_year : [];
    for (const y of rowsByYear) {
      const yr = Number(y?.year);
      const top = Array.isArray(y?.top_contributors) ? y.top_contributors[0] : null;
      if (!Number.isFinite(yr) || !top) continue;
      map.set(yr, {
        label: String(top?.label || ""),
        delta: top?.absolute_change ?? top?.delta ?? null,
      });
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
      if (top && String(top?.label || "").trim()) {
        return { label: String(top.label), delta: top?.absolute_change ?? top?.value ?? top?.delta ?? null };
      }
      const rowsByYear = Array.isArray(step?.rows_by_year) ? step.rows_by_year : [];
      const topYear = rowsByYear.find((y) => Array.isArray(y?.top_contributors) && y.top_contributors.length)?.top_contributors?.[0];
      if (topYear && String(topYear?.label || "").trim()) {
        return { label: String(topYear.label), delta: topYear?.absolute_change ?? topYear?.delta ?? null };
      }
    }
    if (op === "period_driver_delta") {
      const top = Array.isArray(step?.top_positive) && step.top_positive.length
        ? step.top_positive[0]
        : (Array.isArray(step?.drivers) && step.drivers.length ? step.drivers[0] : null);
      if (top && String(top?.label || top?.column || "").trim()) {
        return { label: String(top.label || top.column), delta: top?.delta ?? top?.absolute_change ?? null };
      }
    }
  }
  return null;
}

export function explainDeterministicResults({ validatedPlan = null, computed = null, locale = "en" }) {
  const uk = isUkrainian(locale);
  const ru = isRussian(locale);
  const reasonByYear = buildYoYReasonMap(computed?.step_results || []);
  const genericReason = buildGenericChangeReason(computed?.step_results || []);

  if (!computed?.ok) {
    if (uk) return "Не вдалося безпечно обчислити детермінований результат для цього плану.";
    if (ru) return "Не удалось безопасно выполнить детерминированный расчет для этого плана.";
    return "I could not compute a safe deterministic result for this plan.";
  }

  const stepResults = Array.isArray(computed.step_results) ? computed.step_results : [];
  if (stepResults.length > 1) {
    const sections = [];
    for (const step of stepResults) {
      const op = String(step?.operation || "").toLowerCase();
      const stepId = String(step?.step_id || "step");
      if (op === "year_over_year") {
        const rows = Array.isArray(step.rows) ? step.rows : [];
        const lines = rows.map((r) => {
          if (uk) return `${r.year}: ${fmtMoney(r.value)} | попер.: ${fmtMoney(r.previous_year_value)} | зміна ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)})`;
          if (ru) return `${r.year}: ${fmtMoney(r.value)} | пред.: ${fmtMoney(r.previous_year_value)} | изм. ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)})`;
          return `${r.year}: ${fmtMoney(r.value)} | prev ${fmtMoney(r.previous_year_value)} | change ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)})`;
        });
        sections.push((uk ? `Крок ${stepId} (рік-до-року):` : (ru ? `Шаг ${stepId} (год-к-году):` : `Step ${stepId} (YoY):`)) + `\n${lines.join("\n")}`);
        continue;
      }
      if (op === "period_driver_delta" || op === "period_delta_by_dimension" || op === "ranking") {
        const rows = Array.isArray(step.rows) ? step.rows : [];
        const top = rows.slice(0, 3).map((r, i) => `${i + 1}. ${r.label}: ${fmtMoney(r.absolute_change ?? r.value ?? r.delta)}`).join("\n");
        sections.push((uk ? `Крок ${stepId} (драйвери):` : (ru ? `Шаг ${stepId} (драйверы):` : `Step ${stepId} (drivers):`)) + `\n${top || (uk ? "немає" : (ru ? "нет" : "none"))}`);
        continue;
      }
      if (op === "period_delta") {
        sections.push(
          (uk ? `Крок ${stepId} (порівняння періодів):` : (ru ? `Шаг ${stepId} (сравнение периодов):` : `Step ${stepId} (period comparison):`)) +
          ` ${fmtMoney(step.baseline_value)} -> ${fmtMoney(step.comparison_value)}, ${fmtMoney(step.absolute_change)} (${fmtPct(step.percent_change)})`
        );
      }
    }
    if (sections.length) {
      const suffix = uk
        ? "\nЦе вимірювані драйвери, але не доведена причинність."
        : (ru ? "\nЭто измеримые драйверы, но не доказанная причинность." : "\nThese are measurable drivers, not proven causation.");
      return sections.join("\n\n") + suffix;
    }
  }

  if (computed.outputType === "period_delta") {
    if (uk) {
      const reason = genericReason
        ? ` Ймовірна вимірювана причина зміни: ${genericReason.label} (${fmtMoney(genericReason.delta)}).`
        : " Ймовірну причину зміни можна обґрунтувати після запуску кроку драйвер-аналізу.";
      return `Для базового періоду значення становило ${fmtMoney(computed.baseline_value)}, а для порівнюваного періоду — ${fmtMoney(computed.comparison_value)}. Абсолютна зміна: ${fmtMoney(computed.absolute_change)} (${fmtPct(computed.percent_change)}).${reason}`;
    }
    if (ru) {
      const reason = genericReason
        ? ` Вероятная измеримая причина изменения: ${genericReason.label} (${fmtMoney(genericReason.delta)}).`
        : " Вероятную причину изменения можно обосновать после шага анализа драйверов.";
      return `Для базового периода значение составило ${fmtMoney(computed.baseline_value)}, а для периода сравнения — ${fmtMoney(computed.comparison_value)}. Абсолютное изменение: ${fmtMoney(computed.absolute_change)} (${fmtPct(computed.percent_change)}).${reason}`;
    }
    const reason = genericReason
      ? ` Likely measurable reason for change: ${genericReason.label} (${fmtMoney(genericReason.delta)}).`
      : " The reason for change can be substantiated after running a driver-analysis step.";
    return `For the baseline period, the value was ${fmtMoney(computed.baseline_value)}, and for the comparison period it was ${fmtMoney(computed.comparison_value)}. The absolute change was ${fmtMoney(computed.absolute_change)} (${fmtPct(computed.percent_change)}).${reason}`;
  }

  if (computed.outputType === "yoy_table") {
    const rows = Array.isArray(computed.rows) ? computed.rows : [];
    if (!rows.length) {
      if (uk) return "Результати рік-до-року обчислені з даних таблиці. Рядків не знайдено.";
      if (ru) return "Результаты год-к-году рассчитаны по данным таблицы. Строки не найдены.";
      return "Year-over-year results computed from spreadsheet data. No rows matched.";
    }
    const lines = rows.map((r) => {
      const reason = reasonByYear.get(Number(r.year));
      if (uk) {
        const reasonText = reason
          ? ` Ймовірний вимірюваний драйвер: ${reason.label} (${fmtMoney(reason.delta)}).`
          : " Причину зміни можна обґрунтувати після запуску кроку драйвер-аналізу.";
        return `У ${r.year} році значення становило ${fmtMoney(r.value)}; попередній рік: ${fmtMoney(r.previous_year_value)}; зміна: ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)}).${reasonText}`;
      }
      if (ru) {
        const reasonText = reason
          ? ` Вероятный измеримый драйвер: ${reason.label} (${fmtMoney(reason.delta)}).`
          : " Причину изменения можно обосновать после запуска шага анализа драйверов.";
        return `В ${r.year} году значение составило ${fmtMoney(r.value)}; предыдущий год: ${fmtMoney(r.previous_year_value)}; изменение: ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)}).${reasonText}`;
      }
      const reasonText = reason
        ? ` Likely measurable driver: ${reason.label} (${fmtMoney(reason.delta)}).`
        : " The reason for change can be substantiated after running a driver-analysis step.";
      return `In ${r.year}, the value was ${fmtMoney(r.value)}; previous year: ${fmtMoney(r.previous_year_value)}; change: ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)}).${reasonText}`;
    });
    if (uk) return `Підсумок рік-до-року:\n${lines.join("\n")}`;
    if (ru) return `Итог год-к-году:\n${lines.join("\n")}`;
    return `Year-over-year summary:\n${lines.join("\n")}`;
  }

  if (computed.outputType === "drivers_yoy") {
    const rowsByYear = Array.isArray(computed.rows_by_year) ? computed.rows_by_year : [];
    if (!rowsByYear.length) {
      if (uk) return "Не знайдено драйверів рік-до-року для обраного виміру.";
      if (ru) return "Не найдены драйверы год-к-году для выбранного измерения.";
      return "No year-over-year drivers were found for the selected dimension.";
    }
    const lines = rowsByYear.map((y) => {
      const topOne = (y.top_contributors || [])[0];
      if (uk) return `З ${y.previous_year} до ${y.year} найбільшим драйвером був ${topOne ? `${topOne.label} (${fmtMoney(topOne.absolute_change)})` : "немає"}.`;
      if (ru) return `С ${y.previous_year} по ${y.year} крупнейшим драйвером был ${topOne ? `${topOne.label} (${fmtMoney(topOne.absolute_change)})` : "нет"}.`;
      return `From ${y.previous_year} to ${y.year}, the top driver was ${topOne ? `${topOne.label} (${fmtMoney(topOne.absolute_change)})` : "none"}.`;
    });
    if (uk) return `Найбільші драйвери рік-до-року:\n${lines.join("\n")}`;
    if (ru) return `Крупнейшие драйверы год-к-году:\n${lines.join("\n")}`;
    return `Top year-over-year drivers:\n${lines.join("\n")}`;
  }

  if (computed.outputType === "drivers") {
    const top = (computed.top_positive || []).slice(0, 3).map((r) => `${r.label} (${fmtMoney(r.delta)})`).join(", ");
    const neg = (computed.top_negative || []).slice(0, 3).map((r) => `${r.label} (${fmtMoney(r.delta)})`).join(", ");
    if (uk) return `Найбільші позитивні внески: ${top || "немає"}. Компенсуючі негативні внески: ${neg || "немає"}. Це показує вимірювані драйвери в таблиці, але не доводить причинність.`;
    if (ru) return `Крупнейшие положительные вклады: ${top || "нет"}. Компенсирующие отрицательные вклады: ${neg || "нет"}. Это показывает измеримые драйверы в таблице, но не доказывает причинность.`;
    return `The largest positive contributors were: ${top || "none"}. Offsetting negative contributors were: ${neg || "none"}. This shows measurable spreadsheet drivers, not guaranteed causation.`;
  }

  if (computed.outputType === "scalar") {
    const valueText = isScalarPercent(validatedPlan) ? fmtPct(computed.value) : fmtMoney(computed.value);
    if (uk) return `Обчислене значення становило ${valueText}.`;
    if (ru) return `Рассчитанное значение составило ${valueText}.`;
    return `The computed value was ${valueText}.`;
  }

  if (computed.outputType === "ranking") {
    const rows = (computed.rows || []).slice(0, 10);
    if (!rows.length) return uk ? "Результатів для ранжування немає." : (ru ? "Нет результатов для ранжирования." : "No ranking results were produced.");
    const valueOf = (r) => r?.absolute_change ?? r?.delta ?? r?.value ?? null;
    const first = rows[0];
    const list = rows.map((r, i) => `${i + 1}. ${r.label}: ${fmtMoney(valueOf(r))}`).join("\n");
    if (uk) return `Найвищий внесок мав ${first.label} (${fmtMoney(valueOf(first))}).\n${list}`;
    if (ru) return `Наибольший вклад у ${first.label} (${fmtMoney(valueOf(first))}).\n${list}`;
    return `The top contributor was ${first.label} at ${fmtMoney(valueOf(first))}.\n${list}`;
  }

  if (computed.outputType === "trend") {
    const rows = Array.isArray(computed.rows) ? computed.rows : [];
    if (!rows.length) {
      if (uk) return "Трендові дані не знайдено.";
      if (ru) return "Трендовые данные не найдены.";
      return "No trend rows were produced.";
    }
    const hasComparison = rows.some((r) => r && ("previous_year_value" in r || "previous_value" in r || "absolute_change" in r || "percent_change" in r));
    if (hasComparison) {
      const lines = rows.map((r) => {
        const label = r.year ?? r.period ?? "N/A";
        const prev = r.previous_year_value ?? r.previous_value ?? null;
        if (uk) {
          const reason = genericReason
            ? ` Ймовірна вимірювана причина: ${genericReason.label} (${fmtMoney(genericReason.delta)}).`
            : " Причину зміни можна обґрунтувати після запуску кроку драйвер-аналізу.";
          return `Для періоду ${label} значення становило ${fmtMoney(r.value)}; попередній період: ${fmtMoney(prev)}; зміна: ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)}).${reason}`;
        }
        if (ru) {
          const reason = genericReason
            ? ` Вероятная измеримая причина: ${genericReason.label} (${fmtMoney(genericReason.delta)}).`
            : " Причину изменения можно обосновать после шага анализа драйверов.";
          return `Для периода ${label} значение составило ${fmtMoney(r.value)}; предыдущий период: ${fmtMoney(prev)}; изменение: ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)}).${reason}`;
        }
        const reason = genericReason
          ? ` Likely measurable reason: ${genericReason.label} (${fmtMoney(genericReason.delta)}).`
          : " The reason for change can be substantiated after running a driver-analysis step.";
        return `For period ${label}, the value was ${fmtMoney(r.value)}; previous period: ${fmtMoney(prev)}; change: ${fmtMoney(r.absolute_change)} (${fmtPct(r.percent_change)}).${reason}`;
      });
      if (uk) return `Тренд із порівнянням періодів:\n${lines.join("\n")}`;
      if (ru) return `Тренд со сравнением периодов:\n${lines.join("\n")}`;
      return `Trend with period-over-period comparison:\n${lines.join("\n")}`;
    }
    const lines = rows.map((r) => {
      const label = r.period ?? r.year ?? "N/A";
      if (uk) return `У періоді ${label} значення становило ${fmtMoney(r.value ?? r.metric_value ?? null)}.`;
      if (ru) return `В периоде ${label} значение составило ${fmtMoney(r.value ?? r.metric_value ?? null)}.`;
      return `In period ${label}, the value was ${fmtMoney(r.value ?? r.metric_value ?? null)}.`;
    });
    if (uk) return `Тренд за періодами:\n${lines.join("\n")}`;
    if (ru) return `Тренд по периодам:\n${lines.join("\n")}`;
    return `Trend by period:\n${lines.join("\n")}`;
  }

  const stepSummary = Array.isArray(computed.step_results) && computed.step_results.length
    ? computed.step_results.map((st) => `${st.step_id || "step"}: ${st.operation || "operation"}`).join(", ")
    : null;
  if (uk) return `Обчислення виконано.${stepSummary ? ` Кроки: ${stepSummary}.` : ""}`;
  if (ru) return `Расчет выполнен.${stepSummary ? ` Шаги: ${stepSummary}.` : ""}`;
  return `Calculation completed.${stepSummary ? ` Steps: ${stepSummary}.` : ""}`;
}
