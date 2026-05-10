CREATE TABLE IF NOT EXISTS formula_registry (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  expression TEXT NOT NULL,
  output_unit TEXT,
  precision_digits INT NOT NULL DEFAULT 2,
  denominator_guard_key TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS formula_keys (
  id SERIAL PRIMARY KEY,
  formula_code TEXT NOT NULL REFERENCES formula_registry(code) ON DELETE CASCADE,
  key_code TEXT NOT NULL,
  key_type TEXT NOT NULL DEFAULT 'number',
  required BOOLEAN NOT NULL DEFAULT TRUE,
  header_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(formula_code, key_code)
);

CREATE TABLE IF NOT EXISTS formula_aliases (
  id SERIAL PRIMARY KEY,
  formula_code TEXT NOT NULL REFERENCES formula_registry(code) ON DELETE CASCADE,
  language TEXT NOT NULL,
  alias TEXT NOT NULL,
  UNIQUE(formula_code, language, alias)
);

INSERT INTO formula_registry (code, category, expression, output_unit, precision_digits, denominator_guard_key, enabled)
VALUES
  ('QUICK_RATIO', 'liquidity', '(ASSET_CURR - ASSET_INV) / LIAB_CURR', 'ratio', 2, 'LIAB_CURR', TRUE),
  ('NET_BURN', 'cashflow', 'EXP_OPEX - REV_MONTH', 'currency', 2, NULL, TRUE),
  ('RUNWAY_MONTHS', 'cashflow', 'CASH_TOTAL / NET_BURN', 'months', 2, 'NET_BURN', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO formula_keys (formula_code, key_code, key_type, required, header_patterns) VALUES
  ('QUICK_RATIO','ASSET_CURR','number',TRUE,'["\\\\bcurrent\\\\s*assets?\\\\b","activos?\\\\s*circulantes?","оборотн(ые|і)\\\\s*актив"]'::jsonb),
  ('QUICK_RATIO','ASSET_INV','number',TRUE,'["\\\\binventory\\\\b","inventario","запас"]'::jsonb),
  ('QUICK_RATIO','LIAB_CURR','number',TRUE,'["\\\\bcurrent\\\\s*liabilit(y|ies)\\\\b","pasivos?\\\\s*corrientes?","текущ(ие|і)\\\\s*обязат"]'::jsonb),
  ('NET_BURN','EXP_OPEX','number',TRUE,'["\\\\bopex\\\\b","operating\\\\s*expenses?","gastos?\\\\s*operativos","операционн(ые|і)\\\\s*расход"]'::jsonb),
  ('NET_BURN','REV_MONTH','number',TRUE,'["\\\\bmonthly\\\\s*revenue\\\\b","ingresos?\\\\s*mensuales","ежемесячн(ая|і)\\\\s*выручк"]'::jsonb),
  ('RUNWAY_MONTHS','CASH_TOTAL','number',TRUE,'["\\\\b(total\\\\s*)?cash\\\\b","efectivo\\\\s*total","денежн(ых|их)\\\\s*средств"]'::jsonb),
  ('RUNWAY_MONTHS','NET_BURN','number',TRUE,'[]'::jsonb)
ON CONFLICT (formula_code, key_code) DO NOTHING;

INSERT INTO formula_aliases (formula_code, language, alias) VALUES
  ('QUICK_RATIO','en','quick ratio'),('QUICK_RATIO','en','acid test'),
  ('QUICK_RATIO','es','prueba de ácido'),('QUICK_RATIO','ru','коэффициент быстрой ликвидности'),('QUICK_RATIO','uk','коефіцієнт швидкої ліквідності'),
  ('NET_BURN','en','net burn'),('NET_BURN','es','tasa de consumo mensual'),('NET_BURN','ru','среднемесячный расход средств'),('NET_BURN','uk','середньомісячна швидкість витрачання коштів'),
  ('RUNWAY_MONTHS','en','cash runway'),('RUNWAY_MONTHS','en','runway months'),
  ('RUNWAY_MONTHS','es','autonomía financiera'),('RUNWAY_MONTHS','ru','запас денежных средств'),('RUNWAY_MONTHS','uk','запас грошових коштів')
ON CONFLICT (formula_code, language, alias) DO NOTHING;

-- Expanded deterministic formulas
INSERT INTO formula_registry (code, category, expression, output_unit, precision_digits, denominator_guard_key, enabled) VALUES
('CURRENT_RATIO','liquidity','ASSET_CURR / LIAB_CURR','ratio',2,'LIAB_CURR',TRUE),
('DEBT_TO_EQUITY','solvency','LIAB_TOTAL / EQUITY_TOTAL','ratio',2,'EQUITY_TOTAL',TRUE),
('INTEREST_COVERAGE','solvency','EBIT / EXP_INTEREST','ratio',2,'EXP_INTEREST',TRUE),
('DEBT_TO_ASSETS','solvency','DEBT_TOTAL / ASSET_TOTAL','ratio',2,'ASSET_TOTAL',TRUE),
('ROI_PERCENT','profitability','(PROFIT_NET / INVESTMENT_COST) * 100','percent',2,'INVESTMENT_COST',TRUE),
('ROE_PERCENT','profitability','(PROFIT_NET / EQUITY_TOTAL) * 100','percent',2,'EQUITY_TOTAL',TRUE),
('GROSS_MARGIN_PERCENT','profitability','((REV_TOTAL - COGS_TOTAL) / REV_TOTAL) * 100','percent',2,'REV_TOTAL',TRUE),
('EBITDA_MARGIN_PERCENT','profitability','(EBITDA_TOTAL / REV_TOTAL) * 100','percent',2,'REV_TOTAL',TRUE),
('AR_TURNOVER','efficiency','REV_CREDIT / AR_AVG','ratio',2,'AR_AVG',TRUE),
('DSO_DAYS','efficiency','(AR_AVG / REV_TOTAL) * 365','days',2,'REV_TOTAL',TRUE),
('ASSET_TURNOVER','efficiency','REV_TOTAL / ASSET_TOTAL','ratio',2,'ASSET_TOTAL',TRUE),
('EPS','valuation','(PROFIT_NET - PREF_DIVIDENDS) / SHARES_WEIGHTED_AVG','currency',2,'SHARES_WEIGHTED_AVG',TRUE),
('PE_RATIO','valuation','PRICE_PER_SHARE / EPS','ratio',2,'EPS',TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO formula_keys (formula_code, key_code, key_type, required, header_patterns) VALUES
('CURRENT_RATIO','ASSET_CURR','number',TRUE,'["\\bcurrent\\s*assets?\\b","activos?\\s*circulantes?","оборотн(ые|і)\\s*актив"]'::jsonb),
('CURRENT_RATIO','LIAB_CURR','number',TRUE,'["\\bcurrent\\s*liabilit(y|ies)\\b","pasivos?\\s*corrientes?","текущ(ие|і)\\s*обязат"]'::jsonb),
('DEBT_TO_EQUITY','LIAB_TOTAL','number',TRUE,'["\\btotal\\s*liabilit(y|ies)\\b","pasivos?\\s*totales","обязательств(а|о)\\s*всего"]'::jsonb),
('DEBT_TO_EQUITY','EQUITY_TOTAL','number',TRUE,'["\\b(total\\s*)?equity\\b","capital\\s*contable","собственн(ый|ого)\\s*капитал"]'::jsonb),
('INTEREST_COVERAGE','EBIT','number',TRUE,'["\\bebit\\b"]'::jsonb),
('INTEREST_COVERAGE','EXP_INTEREST','number',TRUE,'["interest\\s*expense","gasto[s]?\\s*de\\s*intereses","процентн(ые|их)\\s*расход"]'::jsonb),
('DEBT_TO_ASSETS','DEBT_TOTAL','number',TRUE,'["\\btotal\\s*debt\\b","deuda\\s*total","общий\\s*долг"]'::jsonb),
('DEBT_TO_ASSETS','ASSET_TOTAL','number',TRUE,'["\\btotal\\s*assets?\\b","activos?\\s*totales","активы\\s*всего"]'::jsonb),
('ROI_PERCENT','PROFIT_NET','number',TRUE,'["\\bnet\\s*profit\\b","ingresos\\s*netos","чист(ая|ий)\\s*(прибыль|прибуток)"]'::jsonb),
('ROI_PERCENT','INVESTMENT_COST','number',TRUE,'["investment\\s*cost","costo\\s*de\\s*inversi[oó]n","стоимость\\s*инвестиц"]'::jsonb),
('ROE_PERCENT','PROFIT_NET','number',TRUE,'["\\bnet\\s*profit\\b","ingresos\\s*netos","чист(ая|ий)\\s*(прибыль|прибуток)"]'::jsonb),
('ROE_PERCENT','EQUITY_TOTAL','number',TRUE,'["\\b(total\\s*)?equity\\b","capital\\s*contable","собственн(ый|ого)\\s*капитал"]'::jsonb),
('GROSS_MARGIN_PERCENT','REV_TOTAL','number',TRUE,'["revenue\\s*total","gross\\s*revenue","ingresos\\s*brutos","валов(ая|а)\\s*выручк"]'::jsonb),
('GROSS_MARGIN_PERCENT','COGS_TOTAL','number',TRUE,'["\\bcogs\\b","cost\\s*of\\s*goods\\s*sold","coste\\s*de\\s*bienes","себестоим"]'::jsonb),
('EBITDA_MARGIN_PERCENT','EBITDA_TOTAL','number',TRUE,'["\\bebitda\\b"]'::jsonb),
('EBITDA_MARGIN_PERCENT','REV_TOTAL','number',TRUE,'["revenue\\s*total","gross\\s*revenue","ingresos\\s*brutos","валов(ая|а)\\s*выручк"]'::jsonb),
('AR_TURNOVER','REV_CREDIT','number',TRUE,'["net\\s*credit\\s*sales","ventas\\s*a\\s*cr[eé]dito","кредитн(ые|ых)\\s*продаж"]'::jsonb),
('AR_TURNOVER','AR_AVG','number',TRUE,'["average\\s*ar","cuentas\\s*por\\s*cobrar","дебиторск(ая|ої)\\s*задолж"]'::jsonb),
('DSO_DAYS','AR_AVG','number',TRUE,'["average\\s*ar","cuentas\\s*por\\s*cobrar","дебиторск(ая|ої)\\s*задолж"]'::jsonb),
('DSO_DAYS','REV_TOTAL','number',TRUE,'["revenue\\s*total","net\\s*sales","ingresos","выручк"]'::jsonb),
('ASSET_TURNOVER','REV_TOTAL','number',TRUE,'["revenue\\s*total","net\\s*sales","ingresos","выручк"]'::jsonb),
('ASSET_TURNOVER','ASSET_TOTAL','number',TRUE,'["\\btotal\\s*assets?\\b","activos?\\s*totales","активы\\s*всего"]'::jsonb),
('EPS','PROFIT_NET','number',TRUE,'["\\bnet\\s*income\\b","net\\s*profit","чист(ая|ий)\\s*(прибыль|прибуток)"]'::jsonb),
('EPS','PREF_DIVIDENDS','number',TRUE,'["preferred\\s*dividends","dividendos\\s*preferentes","привилегир\\s*дивиден"]'::jsonb),
('EPS','SHARES_WEIGHTED_AVG','number',TRUE,'["weighted\\s*average\\s*shares","acciones\\s*promedio\\s*ponderadas","средневзвешенн\\s*акц"]'::jsonb),
('PE_RATIO','PRICE_PER_SHARE','number',TRUE,'["price\\s*per\\s*share","precio\\s*por\\s*acci[oó]n","цена\\s*акции"]'::jsonb),
('PE_RATIO','EPS','number',TRUE,'[]'::jsonb)
ON CONFLICT (formula_code, key_code) DO NOTHING;

INSERT INTO formula_aliases (formula_code, language, alias) VALUES
('CURRENT_RATIO','en','current ratio'),('CURRENT_RATIO','es','razón circulante'),('CURRENT_RATIO','ru','коэффициент текущей ликвидности'),('CURRENT_RATIO','uk','коефіцієнт поточної ліквідності'),
('DEBT_TO_EQUITY','en','debt-to-equity'),('DEBT_TO_EQUITY','es','deuda sobre capital'),('DEBT_TO_EQUITY','ru','соотношение заемного и собственного капитала'),('DEBT_TO_EQUITY','uk','співвідношення заємного та власного капіталу'),
('INTEREST_COVERAGE','en','interest coverage ratio'),('INTEREST_COVERAGE','es','cobertura de intereses'),('INTEREST_COVERAGE','ru','коэффициент покрытия процентов'),('INTEREST_COVERAGE','uk','коефіцієнт покриття відсотків'),
('DEBT_TO_ASSETS','en','debt-to-assets'),('DEBT_TO_ASSETS','es','deuda sobre activos'),('DEBT_TO_ASSETS','ru','коэффициент задолженности'),('DEBT_TO_ASSETS','uk','коефіцієнт заборгованості'),
('ROI_PERCENT','en','roi'),('ROI_PERCENT','es','retorno de inversión'),('ROI_PERCENT','ru','окупаемость инвестиций'),('ROI_PERCENT','uk','окупність інвестицій'),
('ROE_PERCENT','en','roe'),('ROE_PERCENT','es','rentabilidad sobre capital'),('ROE_PERCENT','ru','рентабельность собственного капитала'),('ROE_PERCENT','uk','рентабельність власного капіталу'),
('GROSS_MARGIN_PERCENT','en','gross margin'),('GROSS_MARGIN_PERCENT','es','margen bruto'),('GROSS_MARGIN_PERCENT','ru','валовая маржа'),('GROSS_MARGIN_PERCENT','uk','валова маржа'),
('EBITDA_MARGIN_PERCENT','en','ebitda margin'),('EBITDA_MARGIN_PERCENT','es','margen ebitda'),('EBITDA_MARGIN_PERCENT','ru','маржа ebitda'),('EBITDA_MARGIN_PERCENT','uk','маржа ebitda'),
('AR_TURNOVER','en','accounts receivable turnover'),('AR_TURNOVER','es','rotación de cuentas por cobrar'),('AR_TURNOVER','ru','оборачиваемость дебиторской задолженности'),('AR_TURNOVER','uk','оборотність дебіторської заборгованості'),
('DSO_DAYS','en','days sales outstanding'),('DSO_DAYS','es','días de venta pendientes'),('DSO_DAYS','ru','период погашения дебиторской задолженности'),('DSO_DAYS','uk','період погашення дебіторської заборгованості'),
('ASSET_TURNOVER','en','asset turnover'),('ASSET_TURNOVER','es','rotación de activos'),('ASSET_TURNOVER','ru','оборачиваемость активов'),('ASSET_TURNOVER','uk','оборотність активів'),
('EPS','en','earnings per share'),('EPS','es','ganancia por acción'),('EPS','ru','прибыль на акцию'),('EPS','uk','прибуток на акцію'),
('PE_RATIO','en','price-to-earnings'),('PE_RATIO','es','relación precio-ganancia'),('PE_RATIO','ru','коэффициент цена/прибыль'),('PE_RATIO','uk','коефіцієнт ціна/прибуток')
ON CONFLICT (formula_code, language, alias) DO NOTHING;

-- Extra formulas and aliases
INSERT INTO formula_registry (code, category, expression, output_unit, precision_digits, denominator_guard_key, enabled) VALUES
('BURN_RATE_MONTHLY','cashflow','EXP_OPEX - REV_MONTH','currency',2,NULL,TRUE),
('CASH_RUNWAY','cashflow','CASH_TOTAL / BURN_RATE_MONTHLY','months',2,'BURN_RATE_MONTHLY',TRUE),
('WACC','valuation','((EQUITY_TOTAL/(EQUITY_TOTAL+DEBT_TOTAL))*COST_EQUITY)+((DEBT_TOTAL/(EQUITY_TOTAL+DEBT_TOTAL))*COST_DEBT*(1-TAX_RATE))','percent',4,NULL,TRUE),
('NPV','valuation','NPV_INPUT','currency',2,NULL,TRUE),
('IRR','valuation','IRR_INPUT','percent',4,NULL,TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO formula_aliases (formula_code, language, alias) VALUES
('BURN_RATE_MONTHLY','en','burn rate'),('BURN_RATE_MONTHLY','es','tasa de consumo mensual'),('BURN_RATE_MONTHLY','ru','среднемесячный расход средств'),('BURN_RATE_MONTHLY','uk','середньомісячна швидкість витрачання коштів'),
('CASH_RUNWAY','en','cash runway'),('CASH_RUNWAY','es','autonomía financiera'),('CASH_RUNWAY','ru','запас денежных средств'),('CASH_RUNWAY','uk','запас грошових коштів'),
('WACC','en','wacc'),('WACC','es','costo promedio ponderado de capital'),('WACC','ru','средневзвешенная стоимость капитала'),('WACC','uk','середньозважена вартість капіталу'),
('NPV','en','npv'),('NPV','es','valor presente neto'),('NPV','ru','чистая приведенная стоимость'),('NPV','uk','чиста теперішня вартість'),
('IRR','en','irr'),('IRR','es','tasa interna de retorno'),('IRR','ru','внутренняя норма доходности'),('IRR','uk','внутрішня норма прибутковості')
ON CONFLICT (formula_code, language, alias) DO NOTHING;

-- Deterministic key mappings requested
UPDATE formula_keys SET header_patterns='["\\bcurrent\\s*assets?\\b","activos?\\s*circulantes?","оборотные\\s*активы","оборотні\\s*активи"]'::jsonb
WHERE key_code='ASSET_CURR';

UPDATE formula_keys SET header_patterns='["\\binventory\\b","inventario","запасы","запаси"]'::jsonb
WHERE key_code='ASSET_INV';

UPDATE formula_keys SET header_patterns='["\\bcurrent\\s*liabilit(y|ies)\\b","pasivos?\\s*corrientes?","текущие\\s*обязательства","поточні\\s*зобов''язання"]'::jsonb
WHERE key_code='LIAB_CURR';

UPDATE formula_keys SET header_patterns='["\\b(total\\s*)?cash\\b","efectivo\\s*total","всего\\s*денежных\\s*средств","усього\\s*грошових\\s*коштів"]'::jsonb
WHERE key_code='CASH_TOTAL';

UPDATE formula_keys SET header_patterns='["\\bopex\\b","operating\\s*expenses?","gastos?\\s*operativos","операционные\\s*расходы","операційні\\s*витрати"]'::jsonb
WHERE key_code='EXP_OPEX';

UPDATE formula_keys SET header_patterns='["\\bmonthly\\s*revenue\\b","ingresos?\\s*mensuales","ежемесячная\\s*выручка","щомісячна\\s*виручка"]'::jsonb
WHERE key_code='REV_MONTH';

INSERT INTO formula_keys (formula_code, key_code, key_type, required, header_patterns) VALUES
('WACC','TAX_VAT','number',FALSE,'["\\bvat\\b","\\biva\\b","\\bндс\\b","\\bпдв\\b"]'::jsonb)
ON CONFLICT (formula_code, key_code) DO NOTHING;
