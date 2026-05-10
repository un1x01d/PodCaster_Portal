BEGIN;
CREATE TEMP TABLE tmp_finance_terms(category text, synonym text);
INSERT INTO tmp_finance_terms(category, synonym) VALUES
('asset','Assets'),('liability','Liabilities'),('equity','Equity'),('asset','Accounts-Receivable'),('liability','Accounts-Payable'),('asset','Inventory-Asset'),('asset','Fixed-Assets'),('asset','Accumulated-Depreciation'),('asset','Intangible-Assets'),('asset','Goodwill'),('asset','Cash-Equivalents'),('asset','Prepaid-Expenses'),('liability','Accrued-Liabilities'),('liability','Deferred-Revenue'),('equity','Retained-Earnings'),('equity','Common-Stock'),('liability','Long-Term-Debt'),('liability','Short-Term-Debt'),('liability','Notes-Payable'),('asset','Current-Assets'),('liability','Current-Liabilities'),('asset','Working-Capital'),('asset','Contra-Asset'),('asset','Allowance-Doubtful-Accounts'),('asset','Marketable-Securities'),('equity','Treasury-Stock'),('equity','Paid-In-Capital'),('equity','Minority-Interest'),('liability','Lease-Liability'),('asset','Right-of-Use-Asset'),('asset','Net-Fixed-Assets'),('asset','Other-Current-Assets'),('liability','Line-of-Credit'),('liability','Dividends-Payable'),('liability','Unearned-Income'),('equity','Shareholder-Equity'),('equity','Par-Value'),('asset','Book-Value'),('asset','Liquidation-Value'),('asset','Fair-Market-Value'),
('revenue','Gross-Revenue'),('revenue','Net-Sales'),('revenue','Ad-Revenue'),('revenue','Subscription-Revenue'),('revenue','Licensing-Fees'),('revenue','Yield-Per-Impression'),('revenue','Inventory-Yield'),('revenue','Fill-Rate'),('revenue','CPM (Cost Per Mille)'),('revenue','eCPM (Effective CPM)'),('revenue','RevShare'),('profit','Gross-Margin'),('profit','Operating-Margin'),('profit','Contribution-Margin'),('revenue','Deferred-Income'),('revenue','Recognizable-Revenue'),('revenue','Accrued-Revenue'),('revenue','Billable-Amount'),('revenue','Non-Operating-Revenue'),('revenue','Recurring-Revenue (MRR)'),('revenue','Annual-Recurring-Revenue (ARR)'),('revenue','Churn-Rate'),('expense','Customer-Acquisition-Cost (CAC)'),('revenue','Lifetime-Value (LTV)'),('revenue','ARPU (Average Revenue Per User)'),('revenue','Gross-Bookings'),('profit','Net-Profit'),('profit','Pre-Tax-Income'),('profit','After-Tax-Profit'),('profit','EBITDA'),('profit','EBIT'),('profit','Operating-Income'),('revenue','Top-Line'),('profit','Bottom-Line'),('expense','Write-Downs'),('expense','Charge-Offs'),('revenue','Revenue-Leakage'),('expense','Refunds-Allowances'),('revenue','Volume-Discount'),('revenue','Rebates'),
('expense','COGS (Cost of Goods Sold)'),('expense','OPEX (Operating Expenses)'),('expense','CAPEX (Capital Expenditures)'),('expense','SG&A (Selling, General, Admin)'),('expense','Payroll-Expense'),('expense','Benefits-Expense'),('expense','Rent-Expense'),('expense','Utilities-Expense'),('expense','Depreciation-Expense'),('expense','Amortization-Expense'),('expense','Interest-Expense'),('expense','Tax-Provision'),('expense','Research-Development (R&D)'),('expense','Marketing-Spend'),('expense','Travel-Entertainment (T&E)'),('expense','Professional-Fees'),('expense','Audit-Fees'),('expense','Software-SaaS-Fees'),('expense','Cloud-Infrastructure-Costs'),('expense','Ad-Inventory-Costs'),('expense','Direct-Labor'),('expense','Indirect-Labor'),('expense','Overhead-Allocation'),('expense','Variance-Analysis'),('expense','Budget-vs-Actual'),('expense','Forecasted-Spend'),('expense','Committed-Spend'),('expense','Burn-Rate'),('expense','Discretionary-Spending'),('expense','Non-Discretionary'),('expense','Variable-Costs'),('expense','Fixed-Costs'),('expense','Semi-Variable-Costs'),('expense','Sunk-Costs'),('expense','Opportunity-Costs'),('expense','Bad-Debt-Expense'),('expense','Bank-Service-Charges'),('expense','Shipping-Handling'),('expense','Commissions-Paid'),('expense','Maintenance-Repair'),
('ledger','Debit'),('ledger','Credit'),('ledger','General-Ledger'),('ledger','Trial-Balance'),('ledger','Journal-Entry'),('ledger','Adjusting-Entry'),('ledger','Reversing-Entry'),('date','Posting-Date'),('date','Transaction-Date'),('date','Effective-Date'),('ledger','Reconciliation'),('ledger','Intercompany-Transfer'),('ledger','Elimination-Entry'),('ledger','Consolidation'),('ledger','Chart-of-Accounts (COA)'),('ledger','Cost-Center'),('ledger','Department-Code'),('ledger','Project-Code'),('ledger','Vendor-ID'),('ledger','Customer-ID'),('ledger','Invoice-Number'),('ledger','Purchase-Order (PO)'),('ledger','SKU-Number'),('ledger','Batch-ID'),('audit','Audit-Trail'),('audit','Internal-Control'),('audit','SOX-Compliance'),('audit','GAAP-Standard'),('audit','IFRS-Standard'),('date','Fiscal-Year'),('date','Fiscal-Quarter'),('date','Closing-Period'),('date','Year-to-Date (YTD)'),('date','Month-to-Date (MTD)'),('date','Quarter-to-Date (QTD)'),('date','Prior-Year-Comparison'),('ledger','Accrual-Basis'),('ledger','Cash-Basis'),('audit','Materiality-Threshold'),('audit','Segment-Reporting'),
('cashflow','Operating-Cash-Flow'),('cashflow','Investing-Cash-Flow'),('cashflow','Financing-Cash-Flow'),('cashflow','Free-Cash-Flow (FCF)'),('cashflow','Cash-Burn'),('cashflow','Net-Cash-Position'),('ratio','Liquidity-Ratio'),('ratio','Current-Ratio'),('ratio','Quick-Ratio (Acid-Test)'),('ratio','Debt-to-Equity'),('ratio','Return-on-Investment (ROI)'),('ratio','Return-on-Equity (ROE)'),('ratio','Return-on-Assets (ROA)'),('ratio','Inventory-Turnover'),('ratio','Days-Sales-Outstanding (DSO)'),('ratio','Days-Payable-Outstanding (DPO)'),('ratio','Asset-Turnover'),('ratio','Interest-Coverage-Ratio'),('ratio','Price-to-Earnings (P/E)'),('ratio','Earnings-Per-Share (EPS)'),('ratio','Diluted-EPS'),('ratio','Weighted-Average-Shares'),('ratio','Cost-of-Capital (WACC)'),('ratio','Internal-Rate-of-Return (IRR)'),('ratio','Net-Present-Value (NPV)'),('ratio','Payback-Period'),('ratio','Hurdle-Rate'),('ratio','Discount-Rate'),('ratio','Terminal-Value'),('ratio','Sensitivity-Analysis'),('ratio','Break-Even-Point'),('ratio','Operating-Leverage'),('ratio','Financial-Leverage'),('ratio','Solvency'),('ratio','Profit-Margin'),('ratio','Retention-Ratio'),('ratio','Payout-Ratio'),('ratio','Dividend-Yield'),('ratio','Capital-Gains'),('ratio','Realized-Loss');

INSERT INTO semantic_dictionary (category, language, synonym, group_id)
SELECT lower(trim(category)), 'en', lower(trim(synonym)), NULL
FROM tmp_finance_terms
ON CONFLICT (category, language, synonym, group_id) DO NOTHING;

COMMIT;

-- Multilingual date/period logic aliases
INSERT INTO semantic_dictionary (category, language, synonym, group_id) VALUES
('date','en','q1',NULL),('date','en','first quarter',NULL),
('date','es','q1',NULL),('date','es','primer trimestre',NULL),
('date','ru','q1',NULL),('date','ru','первый квартал',NULL),
('date','uk','q1',NULL),('date','uk','перший квартал',NULL),

('date','en','q2',NULL),('date','en','second quarter',NULL),
('date','es','q2',NULL),('date','es','segundo trimestre',NULL),
('date','ru','q2',NULL),('date','ru','второй квартал',NULL),
('date','uk','q2',NULL),('date','uk','другий квартал',NULL),

('date','en','q3',NULL),('date','en','third quarter',NULL),
('date','es','q3',NULL),('date','es','tercer trimestre',NULL),
('date','ru','q3',NULL),('date','ru','третий квартал',NULL),
('date','uk','q3',NULL),('date','uk','третій квартал',NULL),

('date','en','q4',NULL),('date','en','fourth quarter',NULL),
('date','es','q4',NULL),('date','es','cuarto trimestre',NULL),
('date','ru','q4',NULL),('date','ru','четвертый квартал',NULL),
('date','uk','q4',NULL),('date','uk','четвертий квартал',NULL),

('date','en','h1',NULL),('date','en','first half',NULL),
('date','es','h1',NULL),('date','es','primer semestre',NULL),
('date','ru','h1',NULL),('date','ru','первое полугодие',NULL),
('date','uk','h1',NULL),('date','uk','перше півріччя',NULL),

('date','en','h2',NULL),('date','en','second half',NULL),
('date','es','h2',NULL),('date','es','segundo semestre',NULL),
('date','ru','h2',NULL),('date','ru','второе полугодие',NULL),
('date','uk','h2',NULL),('date','uk','друге півріччя',NULL),

('date','en','fy',NULL),('date','en','fiscal year',NULL),
('date','es','fy',NULL),('date','es','año fiscal',NULL),
('date','ru','fy',NULL),('date','ru','финансовый год',NULL),
('date','uk','fy',NULL),('date','uk','фінансовий рік',NULL),

('date','en','ytd',NULL),('date','en','year to date',NULL),
('date','es','ytd',NULL),('date','es','año a la fecha',NULL),
('date','ru','ytd',NULL),('date','ru','с начала года',NULL),
('date','uk','ytd',NULL),('date','uk','з початку року',NULL)
ON CONFLICT (category, language, synonym, group_id) DO NOTHING;

-- Extended multilingual period and operator aliases
INSERT INTO semantic_dictionary (category, language, synonym, group_id) VALUES
-- EN periods
('date','en','quarter',NULL),('date','en','first quarter (q1)',NULL),('date','en','second quarter (q2)',NULL),('date','en','third quarter (q3)',NULL),('date','en','fourth quarter (q4)',NULL),('date','en','semi-annual',NULL),('date','en','first half (h1)',NULL),('date','en','second half (h2)',NULL),('date','en','fiscal year',NULL),('date','en','calendar year',NULL),('date','en','year-to-date (ytd)',NULL),('date','en','quarter-to-date (qtd)',NULL),('date','en','month-to-date (mtd)',NULL),('date','en','trailing twelve months (ttm)',NULL),('date','en','period end',NULL),('date','en','period start',NULL),('date','en','closing date',NULL),('date','en','opening date',NULL),('date','en','accrual period',NULL),('date','en','reporting window',NULL),('date','en','current period',NULL),('date','en','prior period',NULL),('date','en','year-over-year (yoy)',NULL),('date','en','month-over-month (mom)',NULL),('date','en','forecast period',NULL),('date','en','budget cycle',NULL),('date','en','audit year',NULL),('date','en','tax period',NULL),('date','en','fiscal close',NULL),('date','en','billing cycle',NULL),('date','en','pacing period',NULL),('date','en','flight dates',NULL),('date','en','ad inventory period',NULL),('date','en','yield window',NULL),('date','en','settlement date',NULL),('date','en','due date',NULL),('date','en','posting date',NULL),('date','en','effective date',NULL),('date','en','maturity date',NULL),('date','en','cut-off date',NULL),
-- ES periods
('date','es','trimestre',NULL),('date','es','primer trimestre (t1)',NULL),('date','es','segundo trimestre (t2)',NULL),('date','es','tercer trimestre (t3)',NULL),('date','es','cuarto trimestre (t4)',NULL),('date','es','semestral',NULL),('date','es','primer semestre (s1)',NULL),('date','es','segundo semestre (s2)',NULL),('date','es','año fiscal',NULL),('date','es','año calendario',NULL),('date','es','año a la fecha (aaa)',NULL),('date','es','trimestre a la fecha',NULL),('date','es','mes a la fecha',NULL),('date','es','últimos doce meses',NULL),('date','es','cierre de periodo',NULL),('date','es','inicio de periodo',NULL),('date','es','fecha de cierre',NULL),('date','es','fecha de apertura',NULL),('date','es','periodo de devengo',NULL),('date','es','ventana de reporte',NULL),('date','es','periodo actual',NULL),('date','es','periodo anterior',NULL),('date','es','año tras año',NULL),('date','es','mes tras mes',NULL),('date','es','periodo de pronóstico',NULL),('date','es','ciclo presupuestario',NULL),('date','es','año de auditoría',NULL),('date','es','periodo fiscal',NULL),('date','es','cierre contable',NULL),('date','es','ciclo de facturación',NULL),('date','es','periodo de ritmo',NULL),('date','es','fechas de campaña',NULL),('date','es','periodo de inventario',NULL),('date','es','ventana de rendimiento',NULL),('date','es','fecha de liquidación',NULL),('date','es','fecha de vencimiento',NULL),('date','es','fecha de contabilización',NULL),('date','es','fecha de vigencia',NULL),('date','es','fecha de vencimiento final',NULL),('date','es','fecha de corte',NULL),
-- RU periods
('date','ru','квартал',NULL),('date','ru','первый квартал (кв1)',NULL),('date','ru','второй квартал (кв2)',NULL),('date','ru','третий квартал (кв3)',NULL),('date','ru','четвертый квартал (кв4)',NULL),('date','ru','полугодие',NULL),('date','ru','первое полугодие (п1)',NULL),('date','ru','второе полугодие (п2)',NULL),('date','ru','финансовый год (фг)',NULL),('date','ru','календарный год',NULL),('date','ru','с начала года',NULL),('date','ru','с начала квартала',NULL),('date','ru','с начала месяца',NULL),('date','ru','последние 12 месяцев',NULL),('date','ru','конец периода',NULL),('date','ru','начало периода',NULL),('date','ru','дата закрытия',NULL),('date','ru','дата открытия',NULL),('date','ru','период начисления',NULL),('date','ru','отчетное окно',NULL),('date','ru','текущий период',NULL),('date','ru','прошлый период',NULL),('date','ru','год к году (г/г)',NULL),('date','ru','месяц к месяцу',NULL),('date','ru','прогнозный период',NULL),('date','ru','бюджетный цикл',NULL),('date','ru','аудиторский год',NULL),('date','ru','налоговый период',NULL),('date','ru','финансовое закрытие',NULL),('date','ru','цикл выставления счетов',NULL),('date','ru','период освоения',NULL),('date','ru','даты размещения',NULL),('date','ru','период рекламного инвентаря',NULL),('date','ru','окно доходности',NULL),('date','ru','дата расчета',NULL),('date','ru','дата платежа',NULL),('date','ru','дата проводки',NULL),('date','ru','дата вступления в силу',NULL),('date','ru','дата погашения',NULL),('date','ru','дата отсечки',NULL),
-- UK periods
('date','uk','квартал',NULL),('date','uk','перший квартал (кв1)',NULL),('date','uk','другий квартал (кв2)',NULL),('date','uk','третій квартал (кв3)',NULL),('date','uk','четвертий квартал (кв4)',NULL),('date','uk','півріччя',NULL),('date','uk','перше півріччя (п1)',NULL),('date','uk','друге півріччя (п2)',NULL),('date','uk','фінансовий рік',NULL),('date','uk','календарний рік',NULL),('date','uk','з початку року',NULL),('date','uk','з початку кварталу',NULL),('date','uk','з початку місяця',NULL),('date','uk','останні 12 місяців',NULL),('date','uk','кінець періоду',NULL),('date','uk','початок періоду',NULL),('date','uk','дата закриття',NULL),('date','uk','дата відкриття',NULL),('date','uk','період нарахування',NULL),('date','uk','звітне вікно',NULL),('date','uk','поточний період',NULL),('date','uk','минулий період',NULL),('date','uk','рік до року',NULL),('date','uk','місяць до місяця',NULL),('date','uk','прогнозний період',NULL),('date','uk','бюджетний цикл',NULL),('date','uk','аудиторський рік',NULL),('date','uk','податковий період',NULL),('date','uk','фінансове закриття',NULL),('date','uk','цикл виставлення рахунків',NULL),('date','uk','період освоєння бюджету',NULL),('date','uk','дати кампанії',NULL),('date','uk','період рекламного інвентарю',NULL),('date','uk','вікно прибутковості',NULL),('date','uk','дата розрахунку',NULL),('date','uk','дата платежу',NULL),('date','uk','дата проводки',NULL),('date','uk','дата набрання чинності',NULL),('date','uk','дата погашення',NULL),('date','uk','дата відсікання',NULL),
-- Logic operators EN/ES/RU/UK
('operator','en','match',NULL),('operator','es','coincidir',NULL),('operator','ru','совпадение',NULL),('operator','uk','збіг',NULL),
('operator','en','filter',NULL),('operator','es','filtrar',NULL),('operator','ru','фильтр',NULL),('operator','uk','фільтр',NULL),
('operator','en','equals',NULL),('operator','es','igual a',NULL),('operator','ru','равно',NULL),('operator','uk','дорівнює',NULL),
('operator','en','greater than',NULL),('operator','es','mayor que',NULL),('operator','ru','больше чем',NULL),('operator','uk','більше ніж',NULL),
('operator','en','less than',NULL),('operator','es','menor que',NULL),('operator','ru','меньше чем',NULL),('operator','uk','менше ніж',NULL),
('operator','en','range',NULL),('operator','es','rango',NULL),('operator','ru','диапазон',NULL),('operator','uk','діапазон',NULL),
('operator','en','include',NULL),('operator','es','incluir',NULL),('operator','ru','включить',NULL),('operator','uk','включити',NULL),
('operator','en','exclude',NULL),('operator','es','excluir',NULL),('operator','ru','исключить',NULL),('operator','uk','виключити',NULL),
('operator','en','validation',NULL),('operator','es','validación',NULL),('operator','ru','валидация',NULL),('operator','uk','валідація',NULL),
('operator','en','unique',NULL),('operator','es','único',NULL),('operator','ru','уникальный',NULL),('operator','uk','унікальний',NULL)
ON CONFLICT (category, language, synonym, group_id) DO NOTHING;

-- Multilingual accounting, tax, revenue/media, and budgeting terms
INSERT INTO semantic_dictionary (category, language, synonym, group_id) VALUES
-- Core statements and ledger
('ledger','es','balance general',NULL),('ledger','ru','бухгалтерский баланс',NULL),('ledger','uk','бухгалтерський баланс',NULL),
('profit','es','estado de resultados',NULL),('profit','ru','отчет о прибылях и убытках',NULL),('profit','uk','звіт про прибутки та збитки',NULL),
('cashflow','es','estado de flujo de efectivo',NULL),('cashflow','ru','отчет о движении денежных средств',NULL),('cashflow','uk','звіт про рух грошових коштів',NULL),
('ledger','es','balance de comprobación',NULL),('ledger','ru','оборотно-сальдовая ведомость',NULL),('ledger','uk','оборотно-сальдова відомість',NULL),
('equity','es','ganancias retenidas',NULL),('equity','ru','нераспределенная прибыль',NULL),('equity','uk','нерозподілений прибуток',NULL),
('liability','es','cuentas por pagar',NULL),('liability','ru','кредиторская задолженность',NULL),('liability','uk','кредиторська заборгованість',NULL),
('asset','es','cuentas por cobrar',NULL),('asset','ru','дебиторская задолженность',NULL),('asset','uk','дебіторська заборгованість',NULL),
('ledger','es','libro mayor',NULL),('ledger','ru','главная книга',NULL),('ledger','uk','головна книга',NULL),
('equity','es','capital contable',NULL),('equity','ru','собственный капитал',NULL),('equity','uk','власний капітал',NULL),
('liability','es','pasivos',NULL),('liability','ru','обязательства',NULL),('liability','uk','зобов''язання',NULL),

-- Tax and compliance
('tax','es','iva',NULL),('tax','ru','ндс',NULL),('tax','uk','пдв',NULL),
('tax','es','nif',NULL),('tax','es','cif',NULL),('tax','ru','инн',NULL),('tax','uk','іпн',NULL),
('tax','es','impuesto retenido',NULL),('tax','ru','налог у источника',NULL),('tax','uk','податок на репатріацію',NULL),
('tax','es','impuesto sobre sociedades',NULL),('tax','ru','налог на прибыль',NULL),('tax','uk','податок на прибуток',NULL),
('tax','es','declaración de impuestos',NULL),('tax','ru','налоговая декларация',NULL),('tax','uk','податкова декларація',NULL),
('audit','es','pista de auditoría',NULL),('audit','ru','аудиторский след',NULL),('audit','uk','аудиторський слід',NULL),
('tax','es','activo por impuesto diferido',NULL),('tax','ru','отложенный налоговый актив',NULL),('tax','uk','відстрочений податковий актив',NULL),
('tax','es','exento de impuestos',NULL),('tax','ru','освобожден от налогов',NULL),('tax','uk','звільнений від оподаткування',NULL),
('tax','es','obligación tributaria',NULL),('tax','ru','налоговое обязательство',NULL),('tax','uk','податкове зобов''язання',NULL),
('audit','es','informes estatutarios',NULL),('audit','ru','уставная отчетность',NULL),('audit','uk','статутна звітність',NULL),

-- Revenue/media
('revenue','es','ingresos brutos',NULL),('revenue','ru','валовая выручка',NULL),('revenue','uk','валова виручка',NULL),
('revenue','es','ingresos netos',NULL),('revenue','ru','чистая выручка',NULL),('revenue','uk','чиста виручка',NULL),
('revenue','es','inventario publicitario',NULL),('revenue','ru','рекламный инвентарь',NULL),('revenue','uk','рекламний інвентар',NULL),
('revenue','es','tasa de relleno',NULL),('revenue','ru','коэффициент заполнения',NULL),('revenue','uk','коефіцієнт заповнення',NULL),
('revenue','es','rendimiento por impresión',NULL),('revenue','ru','доход на показ',NULL),('revenue','uk','дохід на показ',NULL),
('revenue','es','participación en ingresos',NULL),('revenue','ru','доля выручки',NULL),('revenue','uk','частка виручки',NULL),
('ledger','es','discrepancia',NULL),('ledger','ru','расхождение',NULL),('ledger','uk','розбіжність',NULL),
('expense','es','pago',NULL),('expense','ru','выплата',NULL),('expense','uk','виплата',NULL),
('expense','es','comisión',NULL),('expense','ru','комиссия',NULL),('expense','uk','комісія',NULL),
('ledger','es','conciliación',NULL),('ledger','ru','сверка',NULL),('ledger','uk','звірка',NULL),

-- Expenses and budgeting
('expense','es','gastos operativos',NULL),('expense','ru','операционные расходы',NULL),('expense','uk','операційні витрати',NULL),
('expense','es','gasto de capital',NULL),('expense','ru','капитальные затраты',NULL),('expense','uk','капітальні витрати',NULL),
('expense','es','nómina',NULL),('expense','ru','фонд оплаты труда',NULL),('expense','uk','фонд оплати праці',NULL),
('ledger','es','devengos',NULL),('ledger','ru','начисления',NULL),('ledger','uk','нарахування',NULL),
('expense','es','depreciación',NULL),('expense','ru','амортизация ос',NULL),('expense','uk','амортизація оз',NULL),
('expense','es','amortización',NULL),('expense','ru','амортизация',NULL),('expense','uk','амортизація',NULL),
('expense','es','varianza',NULL),('expense','es','desviación',NULL),('expense','ru','отклонение',NULL),('expense','uk','відхилення',NULL),
('expense','es','gastos generales',NULL),('expense','ru','накладные расходы',NULL),('expense','uk','накладні витрати',NULL),
('expense','es','costo hundido',NULL),('expense','ru','безвозвратные издержки',NULL),('expense','uk','безповоротні витрати',NULL),
('expense','es','tasa de consumo',NULL),('expense','ru','скорость сжигания средств',NULL),('expense','uk','швидкість спалювання коштів',NULL)
ON CONFLICT (category, language, synonym, group_id) DO NOTHING;

-- Multilingual ratio aliases (liquidity, profitability, efficiency, valuation)
INSERT INTO semantic_dictionary (category, language, synonym, group_id) VALUES
('ratio','es','razón circulante',NULL),('ratio','ru','коэффициент текущей ликвидности',NULL),('ratio','uk','коефіцієнт поточної ліквідності',NULL),
('ratio','es','prueba de ácido',NULL),('ratio','ru','коэффициент быстрой ликвидности',NULL),('ratio','uk','коефіцієнт швидкої ліквідності',NULL),
('ratio','es','deuda sobre capital',NULL),('ratio','ru','соотношение заемного и собственного капитала',NULL),('ratio','uk','співвідношення заємного та власного капіталу',NULL),
('ratio','es','cobertura de intereses',NULL),('ratio','ru','коэффициент покрытия процентов',NULL),('ratio','uk','коефіцієнт покриття відсотків',NULL),
('ratio','es','deuda sobre activos',NULL),('ratio','ru','коэффициент задолженности',NULL),('ratio','uk','коефіцієнт заборгованості',NULL),
('ratio','es','retorno de inversión',NULL),('ratio','ru','окупаемость инвестиций',NULL),('ratio','uk','окупність інвестицій',NULL),
('ratio','es','rentabilidad sobre capital',NULL),('ratio','ru','рентабельность собственного капитала',NULL),('ratio','uk','рентабельність власного капіталу',NULL),
('ratio','es','margen bruto',NULL),('ratio','ru','валовая маржа',NULL),('ratio','uk','валова маржа',NULL),
('ratio','es','margen ebitda',NULL),('ratio','ru','маржа ebitda',NULL),('ratio','uk','маржа ebitda',NULL),
('ratio','es','rendimiento de inventario',NULL),('ratio','ru','доходность инвентаря',NULL),('ratio','uk','дохідність інвентарю',NULL),
('ratio','es','rotación de cuentas por cobrar',NULL),('ratio','ru','оборачиваемость дебиторской задолженности',NULL),('ratio','uk','оборотність дебіторської заборгованості',NULL),
('ratio','es','días de venta pendientes',NULL),('ratio','ru','период погашения дебиторской задолженности',NULL),('ratio','uk','період погашення дебіторської заборгованості',NULL),
('ratio','es','rotación de activos',NULL),('ratio','ru','оборачиваемость активов',NULL),('ratio','uk','оборотність активів',NULL),
('ratio','es','tasa de consumo mensual',NULL),('ratio','ru','среднемесячный расход средств',NULL),('ratio','uk','середньомісячна швидкість витрачання коштів',NULL),
('ratio','es','autonomía financiera',NULL),('ratio','ru','запас денежных средств',NULL),('ratio','uk','запас грошових коштів',NULL),
('ratio','es','ganancia por acción',NULL),('ratio','ru','прибыль на акцию',NULL),('ratio','uk','прибуток на акцію',NULL),
('ratio','es','relación precio-ganancia',NULL),('ratio','ru','коэффициент цена/прибыль',NULL),('ratio','uk','коефіцієнт ціна/прибуток',NULL),
('ratio','es','costo promedio ponderado de capital',NULL),('ratio','ru','средневзвешенная стоимость капитала',NULL),('ratio','uk','середньозважена вартість капіталу',NULL),
('ratio','es','tasa interna de retorno',NULL),('ratio','ru','внутренняя норма доходности',NULL),('ratio','uk','внутрішня норма прибутковості',NULL),
('ratio','es','valor presente neto',NULL),('ratio','ru','чистая приведенная стоимость',NULL),('ratio','uk','чиста теперішня вартість',NULL)
ON CONFLICT (category, language, synonym, group_id) DO NOTHING;

-- Extend financial ratio match patterns for multilingual aliases
UPDATE financial_ratios
SET match_pattern = match_pattern || '|razón circulante|коэффициент текущей ликвидности|коефіцієнт поточної ліквідності'
WHERE lower(name) IN ('current ratio')
  AND match_pattern NOT ILIKE '%коэффициент текущей ликвидности%';

UPDATE financial_ratios
SET match_pattern = match_pattern || '|prueba de ácido|коэффициент быстрой ликвидности|коефіцієнт швидкої ліквідності'
WHERE lower(name) IN ('current ratio')
  AND match_pattern NOT ILIKE '%коэффициент быстрой ликвидности%';

UPDATE financial_ratios
SET match_pattern = match_pattern || '|retorno de inversión|окупаемость инвестиций|окупність інвестицій'
WHERE lower(name) IN ('revenue per employee')
  AND match_pattern NOT ILIKE '%окупаемость инвестиций%';

UPDATE financial_ratios
SET match_pattern = match_pattern || '|margen bruto|валовая маржа|валова маржа'
WHERE lower(name) IN ('gross margin')
  AND match_pattern NOT ILIKE '%валовая маржа%';

UPDATE financial_ratios
SET match_pattern = match_pattern || '|relación precio-ganancia|коэффициент цена/прибыль|коефіцієнт ціна/прибуток'
WHERE lower(name) IN ('current ratio')
  AND match_pattern NOT ILIKE '%цена/прибыль%';
