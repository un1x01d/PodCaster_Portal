export async function runCompiledPlanPhase(ctx) {
  const {
    res,
    req,
    sheetId,
    message,
    locale,
    planningMessage,
    effectiveUserMessage,
    normalizedMessage,
    activeTab,
    semanticProfile,
    loadedSample,
    baseHeaders,
    aiHeaders,
    pendingClarification,
    selectedClarificationOption,
    resolvedDeterministicContext,
    clarificationKey,
    chatRuntimeRules,
    PENDING_CLARIFICATIONS,
    LAST_DETERMINISTIC_CONTEXT,
    analyzeAccountingIntent,
    compileDeterministicQueryPlan,
    buildSqlFastPathFromDeterministicPlan,
    computeSqlAggregation,
    loadAccessibleRows,
    executeDeterministicSpreadsheetPlan,
    writeAuditLog,
    presentDeterministicSpreadsheetResult,
    buildSimpleDeterministicAnswer,
    mergeRecentYears,
    formatAnswerWithBullets,
    cleanAITechnicalNoise,
    stripApproximationWords,
    normalizeDatesAndRemoveTime,
    enforceCommaThousands,
    enforceTwoDecimals,
    applyAnswerFormatDirectives,
    applyTimeWindowDirectives,
    applyConversationalAnswerStyle,
    enforcePerYearTopListSpacing,
    isDriverRankingQuery,
    query,
    buildHeaderExplanationResponse,
  } = ctx;

  const accountingIntent = await analyzeAccountingIntent({ message: planningMessage, runtime: ctx.runtime });
  const compiledPlan = await compileDeterministicQueryPlan({
    message: planningMessage,
    accountingIntent,
    headers: baseHeaders,
    semanticProfile,
    sampleRows: loadedSample?.rows || [],
    hints: {
      metric: pendingClarification?.kind === "metric"
        ? selectedClarificationOption
        : (pendingClarification?.metric || undefined),
      dateHeader: pendingClarification?.kind === "date" ? selectedClarificationOption : undefined,
      headerChoice: pendingClarification?.kind === "header" ? selectedClarificationOption : undefined,
      headerCanonical: pendingClarification?.kind === "header" ? String(pendingClarification?.field || "") : undefined,
      groupId: req.user?.customer_group_id || req.user?.resolved_group_id || null,
      context: resolvedDeterministicContext.context || {},
    },
  });
  if (compiledPlan.ok) {
    PENDING_CLARIFICATIONS.delete(clarificationKey);

    if (pendingClarification?.kind === "header" && pendingClarification?.field && selectedClarificationOption) {
      try {
        const currentProfile = semanticProfile || {};
        const mappings = { ...(currentProfile.headerMappings || {}), [pendingClarification.field]: selectedClarificationOption };
        const newProfile = { ...currentProfile, headerMappings: mappings };
        await query(
          "UPDATE sheets SET semantic_profile = $1 WHERE id = $2",
          [JSON.stringify(newProfile), sheetId]
        );

        const { recordSuccessfulMapping } = await import("../services/ai/semanticKnowledgeService.js");
        await recordSuccessfulMapping({
          canonicalField: pendingClarification.field,
          synonym: selectedClarificationOption,
          locale: locale || "en",
          groupId: req.user?.customer_group_id || req.user?.resolved_group_id || null,
          userId: req.user?.id || null,
        });
      } catch (e) {
        console.error("Failed to persist header mapping choice:", e);
      }
    }

    const selectedTab = String(activeTab || "").trim() || null;
    const sqlFastPath = buildSqlFastPathFromDeterministicPlan(compiledPlan);
    if (sqlFastPath) {
      const sqlAgg = await computeSqlAggregation({
        sheetId,
        user: req.user,
        operation: "sum",
        targetColumn: sqlFastPath.targetColumn,
        groupBy: null,
        filters: sqlFastPath.filters,
        rowFiltersList: loadedSample?.rowFiltersList || [],
        allowedColumns: aiHeaders || baseHeaders || [],
        limit: 1,
        locale,
        tabName: selectedTab,
        actualHeaders: baseHeaders,
      });
      if (sqlAgg?.answer) {
        let answer = String(sqlAgg.answer || "");
        const lower = answer.trim().toLowerCase();
        const noDataLike = lower === "no matching data found."
          || lower.includes("no numeric data found");
        if (noDataLike) {
          // Fall through to deterministic executor when SQL fast path is inconclusive.
        } else {
        answer = formatAnswerWithBullets(answer);
        answer = cleanAITechnicalNoise(answer);
        answer = stripApproximationWords(answer);
        answer = normalizeDatesAndRemoveTime(answer);
        answer = enforceCommaThousands(answer);
        answer = enforceTwoDecimals(answer);
        answer = applyAnswerFormatDirectives(answer, message);
        answer = applyTimeWindowDirectives(answer, message);
        answer = applyConversationalAnswerStyle(answer, message, locale);
        res.json({
          answer,
          actions: { reset_filters: false, filters: [], chart: null },
          preview_rows: [],
          meta: {
            phase: "accounting_sql_fast_path",
            metric_requested: compiledPlan.metric,
            target_column: sqlFastPath.targetColumn,
          },
        });
        return { handled: true, accountingIntent, compiledPlan };
        }
      }
    }

    const fullLoad = await loadAccessibleRows(sheetId, req.user, selectedTab);
    if (fullLoad?.forbidden) {
      res.status(403).json(ctx.aiError("forbidden"));
      return { handled: true, accountingIntent, compiledPlan };
    }
    const calcResult = executeDeterministicSpreadsheetPlan({
      plan: compiledPlan,
      rows: fullLoad?.rows || [],
      filters: accountingIntent?.filters || [],
      userContext: { allowedColumns: fullLoad?.allowedColumns || baseHeaders || aiHeaders, userId: req.user?.id || null, tenantId: req.user?.customer_id || null },
    });
    try {
      await writeAuditLog({
        req,
        actorUserId: req.user?.id || null,
        action: "accounting.metric_calculation",
        resourceType: "sheet",
        resourceId: sheetId || null,
        metadata: {
          tenantId: req.user?.customer_id || null,
          metric: compiledPlan.metric,
          headersUsed: calcResult?.headersUsed || {},
          period: calcResult?.period || null,
          comparisonPeriod: compiledPlan.comparisonPeriod || null,
          rowCount: calcResult?.rowCount || 0,
          invalidNumericCount: Number((calcResult?.notes || []).join(" ").match(/\d+/)?.[0] || 0),
          success: !!calcResult?.ok,
          errorCode: calcResult?.errorCode || null,
          at: new Date().toISOString(),
        },
      });
    } catch {}
    let answer = await presentDeterministicSpreadsheetResult({
      message: planningMessage,
      plan: compiledPlan,
      calcResult,
      accountingIntent,
      runtime: ctx.runtime,
    });

    if (typeof answer === "string" && (answer.trim().startsWith("{") || answer.trim().startsWith("["))) {
      try {
        JSON.parse(answer);
        answer = buildSimpleDeterministicAnswer({ metric: compiledPlan.metric, result: calcResult, periodLabel: calcResult?.period?.label || "selected period" });
      } catch {}
    }

    {
      const ctxKey = `${Number(req.user?.id || 0)}:${String(sheetId || "nosheet")}`;
      const priorCtx = LAST_DETERMINISTIC_CONTEXT.get(ctxKey) || null;
      const priorYears = Array.isArray(priorCtx?.lastYears) ? priorCtx.lastYears : [];
      const yearsFromPlan = Array.isArray(compiledPlan?.years) ? compiledPlan.years.map((y) => Number(y)).filter(Number.isFinite) : [];
      const yearsFromPeriod = Array.from(String(calcResult?.period?.label || "").matchAll(/\b(19\d{2}|20\d{2})\b/g), (m) => Number(m?.[1] || m?.[0])).filter(Number.isFinite);
      const lastYears = mergeRecentYears(priorYears, yearsFromPlan.length ? yearsFromPlan : yearsFromPeriod);
      LAST_DETERMINISTIC_CONTEXT.set(ctxKey, {
        ts: Date.now(),
        lastOperation: String(compiledPlan?.operation || ""),
        lastMetric: String(compiledPlan?.metric || ""),
        lastYears,
      });
    }
    answer = formatAnswerWithBullets(answer);
    answer = cleanAITechnicalNoise(answer);
    answer = stripApproximationWords(answer);
    answer = normalizeDatesAndRemoveTime(answer);
    answer = enforceCommaThousands(answer);
    answer = enforceTwoDecimals(answer);
    answer = applyAnswerFormatDirectives(answer, message);
    answer = applyTimeWindowDirectives(answer, message);
    answer = applyConversationalAnswerStyle(answer, message, locale);
    answer = enforcePerYearTopListSpacing(answer);
    res.json({
      answer,
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: {
        phase: "accounting_deterministic_calculation",
        metric_requested: compiledPlan.metric,
        calculation_result: calcResult,
        verification: compiledPlan?.verification || null,
        verification_gate: compiledPlan?.verification_gate || null,
      },
    });
    return { handled: true, accountingIntent, compiledPlan };
  }

  const allowCompositeDeltaCauseBypass = ctx.intentPlan?.twoYearDeltaCause;
  if (compiledPlan.message || compiledPlan.clarification_needed === true) {
    if (compiledPlan.clarification_needed === true) {
      if (allowCompositeDeltaCauseBypass) {
        PENDING_CLARIFICATIONS.delete(clarificationKey);
      } else {
        const options = Array.isArray(compiledPlan.clarification_options) ? compiledPlan.clarification_options : [];
        const reasonText = String(compiledPlan.reason || "");
        const kind = reasonText.includes("ambiguous_headers") || reasonText.includes("missing_required_headers")
          ? "header"
          : (reasonText.includes("date") ? "date" : "metric");
        PENDING_CLARIFICATIONS.set(clarificationKey, {
          ts: Date.now(),
          kind,
          metric: compiledPlan.metric || (typeof accountingIntent?.metric_requested === "string" ? accountingIntent.metric_requested : null),
          field: String(compiledPlan?.clarification_field || "").trim() || null,
          options,
          sourceMessage: effectiveUserMessage,
        });

        const optionsText = options.length
          ? `\n${options.map((opt, idx) => `${idx + 1}. ${opt}`).join("\n")}`
          : "";
        res.json({
          answer: `${compiledPlan.clarification_question || "I can answer that, but I need one clarification first."}${optionsText}`,
          actions: { reset_filters: false, filters: [], chart: null },
          preview_rows: [],
          meta: { phase: "accounting_clarification_required", reason: compiledPlan.reason || "clarification_needed", options },
        });
        return { handled: true, accountingIntent, compiledPlan };
      }
    }
    if (compiledPlan.message) {
      PENDING_CLARIFICATIONS.delete(clarificationKey);
      res.json({
        answer: compiledPlan.message,
        actions: { reset_filters: false, filters: [], chart: null },
        preview_rows: [],
        meta: { phase: "accounting_deterministic_preflight", reason: compiledPlan.reason || "preflight_failed" },
      });
      return { handled: true, accountingIntent, compiledPlan };
    }
    const debugHeaderResolutionResponse = chatRuntimeRules?.debugHeaderResolutionResponse === true;
    const answer = debugHeaderResolutionResponse
      ? buildHeaderExplanationResponse({ metricKey: null, resolution: {}, locale })
      : "I need clarification before calculating this accounting result.";
    PENDING_CLARIFICATIONS.delete(clarificationKey);
    res.json({
      answer,
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: {
        phase: "accounting_intent_header_resolution",
        intent: accountingIntent.intent,
        metric_requested: null,
        required_headers: accountingIntent.required_canonical_headers || [],
        confidence: accountingIntent.confidence || "medium",
        resolution: {},
      },
    });
    return { handled: true, accountingIntent, compiledPlan };
  }

  return { handled: false, accountingIntent, compiledPlan };
}

export async function runComplexAnalysisPhase(ctx) {
  const {
    res,
    req,
    sheetId,
    normalizedMessage,
    accountingIntent,
    aiHeaders,
    semanticProfile,
    loadedSample,
    runtime,
    METRIC_REGISTRY,
    COMPLEX_QUESTION_REQUIREMENTS,
    buildAccountingAnalysisPlan,
    validateAnalysisPlan,
    resolveAnalysisHeaders,
    executeAnalysisPlan,
    writeAuditLog,
    explainAccountingAnalysis,
  } = ctx;

  const complexTypes = new Set([
    "driver_analysis_profit",
    "driver_analysis_gross_margin",
    "driver_analysis_expenses",
    "period_comparison_revenue",
    "pnl_summary",
    "budget_vs_actual",
    "cash_flow_issue",
  ]);
  const shouldPlanComplex =
    accountingIntent?.safe_next_action === "build_analysis_plan"
    || complexTypes.has(String(accountingIntent?.question_type || ""));
  if (!shouldPlanComplex) return { handled: false };

  const plan = await buildAccountingAnalysisPlan({
    message: normalizedMessage,
    analyzerResult: accountingIntent,
    availableHeaders: aiHeaders,
    cachedFieldMetadata: semanticProfile?.headerMappings || {},
    supportedMetricKeys: Object.keys(METRIC_REGISTRY),
    metricHeaderRequirements: {},
    complexQuestionRequirements: COMPLEX_QUESTION_REQUIREMENTS,
    runtime,
  });
  const canonicalHeaders = ["date", "revenue", "expenses", "cogs", "gross_profit", "gross_margin_pct", "net_income", "actual", "budget", "category", "account", "department", "store", "region", "customer", "vendor", "cash", "cash_in", "cash_out", "accounts_receivable", "accounts_payable"];
  const validated = validateAnalysisPlan({ plan, supportedMetrics: Object.keys(METRIC_REGISTRY), supportedCanonicalHeaders: canonicalHeaders });
  if (!validated.ok) {
    res.json({
      answer: "I need clarification before running this analysis safely. Please confirm the metric and periods to compare.",
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: { phase: "complex_plan_validation", error: validated.errorCode, rejectedSteps: validated.rejectedSteps || [] },
    });
    return { handled: true };
  }
  const headerResolution = resolveAnalysisHeaders({
    approvedPlan: validated.approvedPlan,
    headers: aiHeaders,
    fieldMetadata: semanticProfile?.headerMappings || {},
    message: normalizedMessage,
  });
  if (!headerResolution.ok) {
    res.json({
      answer: headerResolution.message,
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: { phase: "complex_header_resolution", ...headerResolution },
    });
    return { handled: true };
  }
  const analysisResult = executeAnalysisPlan({
    approvedPlan: validated.approvedPlan,
    headerResolution,
    rows: loadedSample?.rows || [],
    userContext: { allowedColumns: aiHeaders, userId: req.user?.id || null, tenantId: req.user?.customer_id || null },
  });
  try {
    await writeAuditLog({
      req,
      actorUserId: req.user?.id || null,
      action: "accounting.complex_analysis",
      resourceType: "sheet",
      resourceId: sheetId || null,
      metadata: {
        tenantId: req.user?.customer_id || null,
        questionType: validated.approvedPlan?.question_type || null,
        primaryMetric: validated.approvedPlan?.primary_metric || null,
        period: validated.approvedPlan?.period || null,
        comparisonPeriod: validated.approvedPlan?.comparison_period || null,
        headersUsed: analysisResult?.headersUsed || {},
        optionalHeadersMissing: analysisResult?.missingOptionalFields || [],
        answerCompleteness: analysisResult?.answerCompleteness || null,
        rowCounts: analysisResult?.rowCounts || {},
        stepsExecuted: analysisResult?.stepsExecuted || [],
        success: !!analysisResult?.ok,
        errorCode: analysisResult?.errorCode || null,
        at: new Date().toISOString(),
      },
    });
  } catch {}
  const answer = await explainAccountingAnalysis({
    originalQuestion: normalizedMessage,
    analyzerOutput: accountingIntent,
    validatedPlan: validated.approvedPlan,
    headerResolution,
    analysisResult,
    runtime,
  });
  res.json({
    answer,
    actions: { reset_filters: false, filters: [], chart: null },
    preview_rows: [],
    meta: { phase: "complex_accounting_analysis", questionType: validated.approvedPlan?.question_type, analysisResult },
  });
  return { handled: true };
}
