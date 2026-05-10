CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_settings (key, value, updated_at)
VALUES (
  'chat_runtime_rules',
  jsonb_build_object(
    'shortReasonFollowupRegex', '^(why|why\\?|because\\??|reason\\??|чому\\??|почему\\??|почему так\\??)$',
    'shortYearFollowupMaxChars', 40,
    'shortYearFollowupRegex', '\\b(19|20)\\d{2}\\b',
    'topNHistoryRegex', '\\btop\\s*\\d+\\b',
    'moneyHistoryRegex', '\\bby\\s+[a-zа-яіїєґ_ ]+:\\s*\\$',
    'comparisonIntentRegex', '\\b(yoy|year over year|year-over-year|compare|comparison|vs|versus|growth|growth rate|rate|change|delta|difference|what changed|changed between|between .* and .*|yearly diff|annual diff|month over month|mom|qoq|quarter over quarter)\\b|г\\/г|р\\/р|год к году|рік до року|порівн|сравн|рост|зрост|разниц|дельт|зміна|різниц',
    'singleYearMetricHistoryRegex', '\\bfor\\s+(19|20)\\d{2}\\b',
    'singleYearMetricKeywordRegex', '\\b(revenue|sales|income|profit|expense|cost)\\b|выруч|доход|дохід|прибут|расход|витрат',
    'driverIntentRegex', '\\b(driver|drivers|top|biggest|largest|main driver|leading contributor|contributor|impact|impacting|moved the needle|key factor|primary factor|who drove|what drove|top 1|top one)\\b|драйвер|топ|основн|фактор|вплив|влияни',
    'driverRankingIntentRegex', '\\b(top|highest|largest|biggest|best|most|leading|rank(?:ing)?|drivers?|drives|contributors?|sources?|main|primary|key|dominant|strongest|top\\s*\\d+|number\\s*one|#1)\\b|топ|главн|основн|ключев|домінант',
    'driverValueIntentRegex', '\\b(revenue|sales|income|profit|amount|value|brought|generated|drove|bring|earnings?)\\b',
    'breakdownIntentRegex', '\\b(by|per|group(?:ed)? by|breakdown|split by|segmented by|across|for each|each year|every year|by year|by quarter|per quarter|year by year|quarter by quarter)\\b|по\\s+|за\\s+категор|по\\s+категор|розбив|за\\s+категор|за\\s+кожен\\s+рік|по\\s+годам|по\\s+квартал',
    'ratioIntentRegex', '\\b(quick ratio|acid test|cash runway|runway|current ratio|debt[-\\s]?to[-\\s]?equity|interest coverage|roi|roe|roa|eps|p\\/e|wacc|irr|npv|dso|dpo|gross margin|ebitda margin)\\b|коэффициент|ліквідності|ліквідн|окупаемость|рентабельн|маржа|прибутковост',
    'metricIntentRevenueRegex', '\\b(revenue|sales|income|turnover|выручк|доход|дохід|продаж)\\b',
    'metricIntentExpenseRegex', '\\b(expense|cost|spend|cogs|opex|расход|витрат)\\b',
    'metricIntentProfitRegex', '\\b(profit|margin|ebit|ebitda|прибут|прибыл)\\b',
    'aggregateSingleYearRegex', '(?:\\bfor\\b|\\bin\\b|\\bза\\b)\\s*(?:19|20)\\d{2}\\b',
    'aggregateComparisonRegex', '\\b(yoy|year over year|year-over-year|annual growth|yearly growth|previous year|last year|vs\\.?|versus|compare|comparison|trend|over time|timeline|mom|qoq|delta|difference|between|changed|change from|growth by year|г\\/г|р\\/р|год к году|рік до року|разниц|дельт|різниц|зміна)\\b',
    'selfLearningEnabled', true,
    'selfLearningRetentionDays', 90,
    'selfLearningMaxMemories', 5000,
    'selfLearningMinConfidence', 0.6,
    'promptContextCarryForwardRule', 'For follow-up questions (e.g., "and 2024?", "what about 2025?", "only 2023"), keep prior metric and operation unless user explicitly names a different metric.',
    'promptSingleScalarRule', 'If the user asks for a single scalar value, return exactly one short sentence with value and context.',
    'promptTotalInYearShapeRule', 'If user asks "total <metric> in/for <year>", mirror that form directly in one sentence in output locale.',
    'promptStructuredSectionsRule', 'Interpret context in this order: schema_profile, conversation_history, user question, then constraints. Keep reasoning grounded to sheet data only.',
    'promptCompositeDecomposeRule', 'If user asks a composite question with multiple intents, decompose internally into sub-steps and return one merged concise answer.'
  ),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
