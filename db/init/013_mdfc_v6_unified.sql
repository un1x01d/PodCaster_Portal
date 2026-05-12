-- MDFC v6.0 UNIFIED INDUSTRY ENGINE - KNOWLEDGE BASE PERSISTENCE
-- Consolidates all industry synonyms and deterministic intent rules.

-- 1. CLEAR OLD STATE (Optional, for clean restoration)
DELETE FROM semantic_dictionary WHERE group_id IS NULL;
DELETE FROM ai_learning_rules WHERE scope = 'global';

-- 2. SEMANTIC DICTIONARY (SYNONYMS)
INSERT INTO semantic_dictionary (category, language, synonym) VALUES
-- Finance & Contra-Accounts
('total_revenue', 'en', 'Revenue'), ('total_revenue', 'en', 'Sales'), ('total_revenue', 'en', 'Billings'), ('total_revenue', 'en', 'Top-Line'), ('total_revenue', 'en', 'Ingresos'), ('total_revenue', 'en', 'Выручка'), ('total_revenue', 'en', 'Виручка'),
('revenue_offsets', 'en', 'Returns'), ('revenue_offsets', 'en', 'Refunds'), ('revenue_offsets', 'en', 'Allowances'), ('revenue_offsets', 'en', 'Discounts'), ('revenue_offsets', 'en', 'Rebates'), ('revenue_offsets', 'en', 'Chargebacks'), ('revenue_offsets', 'en', 'Customer-Credits'),
('cash', 'en', 'Bank Balance'), ('cash', 'en', 'Liquidity'), ('cash', 'en', 'Petty Cash'), ('cash', 'en', 'Efectivo'), ('cash', 'en', 'Наличные'), ('cash', 'en', 'Cash on Hand'),
('tax_amount', 'en', 'VAT'), ('tax_amount', 'en', 'IVA'), ('tax_amount', 'en', 'Sales-Tax'), ('tax_amount', 'en', 'GST'), ('tax_amount', 'en', 'НДС'), ('tax_amount', 'en', 'ПДВ'), ('tax_amount', 'en', 'Withholding'),

-- Trucking & Logistics
('total_expense', 'en', 'Fuel'), ('total_expense', 'en', 'Tolls'), ('total_expense', 'en', 'ELD'), ('total_expense', 'en', 'IFTA'), ('total_expense', 'en', 'Bobtail'), ('total_expense', 'en', 'Deadhead'), ('total_expense', 'en', 'Detention'), ('total_expense', 'en', 'Lumper'), ('total_expense', 'en', 'Layover'), ('total_expense', 'en', 'Reefer-Fuel'), ('total_expense', 'en', 'Scale-Fees'), ('total_expense', 'en', 'PrePass'), ('total_expense', 'en', 'Permits'), ('total_expense', 'en', 'IRP'), ('total_expense', 'en', 'Hazmat'), ('total_expense', 'en', 'Dispatch-Fee'), ('total_expense', 'en', 'Brokerage-Cut'), ('total_expense', 'en', 'Tire-Retread'), ('total_expense', 'en', 'Cargo-Insurance'),
('total_revenue', 'en', 'Rate-Per-Mile'), ('total_revenue', 'en', 'Fuel-Surcharge'), ('total_revenue', 'en', 'Accessorial'), ('total_revenue', 'en', 'Backhaul'), ('total_revenue', 'en', 'Detention-Pay'),
('total_miles', 'en', 'Total-Miles'), ('total_miles', 'en', 'Miles'), ('total_miles', 'en', 'Distance'),
('fuel_gallons', 'en', 'Fuel-Gallons'), ('fuel_gallons', 'en', 'Gallons'), ('fuel_gallons', 'en', 'Fuel-Usage'),

-- Manufacturing
('inventory', 'en', 'WIP'), ('inventory', 'en', 'Raw-Materials'), ('inventory', 'en', 'Finished-Goods'), ('inventory', 'en', 'MRO'), ('inventory', 'en', 'Tooling'), ('inventory', 'en', 'Dies'), ('inventory', 'en', 'Jigs'), ('inventory', 'en', 'Molds'), ('inventory', 'en', 'CNC-Machinery'),
('total_expense', 'en', 'Direct-Labor'), ('total_expense', 'en', 'Scrap'), ('total_expense', 'en', 'Rework'), ('total_expense', 'en', 'Spoilage'), ('total_expense', 'en', 'Packaging-Film'), ('total_expense', 'en', 'Shrink-wrap'), ('total_expense', 'en', 'Coolant'), ('total_expense', 'en', 'PPE'), ('total_expense', 'en', 'ISO-Audit'), ('total_expense', 'en', 'Calibration'), ('total_expense', 'en', 'Tool-Crib'), ('total_expense', 'en', 'Electricity-Industrial'), ('total_expense', 'en', 'Duty-Drawback'),
('units_produced', 'en', 'Units-Produced'), ('units_produced', 'en', 'Production-Volume'), ('units_produced', 'en', 'Output-Units'),

-- Real Estate
('total_revenue', 'en', 'GPR'), ('total_revenue', 'en', 'CAM-Recovery'), ('total_revenue', 'en', 'RUBS'), ('total_revenue', 'en', 'Pet-Rent'), ('total_revenue', 'en', 'Parking-Revenue'), ('total_revenue', 'en', 'Move-in-Fees'), ('total_revenue', 'en', 'Application-Fees'),
('total_expense', 'en', 'Property-Tax'), ('total_expense', 'en', 'Special-Assessments'), ('total_expense', 'en', 'Insurance-Hazard'), ('total_expense', 'en', 'Management-Fee'), ('total_expense', 'en', 'Leasing-Commission'), ('total_expense', 'en', 'Snow-Removal'), ('total_expense', 'en', 'HVAC-Filter'), ('total_expense', 'en', 'Pool-Service'), ('total_expense', 'en', 'Turnover-Paint'), ('total_expense', 'en', 'Ground-Lease'),
('asset_value', 'en', 'Property-Valuation'), ('asset_value', 'en', 'Escrow-Balance'), ('asset_value', 'en', 'Capital-Reserves'),

-- Retail & E-Comm
('total_revenue', 'en', 'POS-Sales'), ('total_revenue', 'en', 'GMV'), ('total_revenue', 'en', 'AOV'), ('total_revenue', 'en', 'Marketplace-Rev'), ('total_revenue', 'en', 'Online-Sales'), ('total_revenue', 'en', 'Gift-Card-Redemptions'),
('total_expense', 'en', 'COGS'), ('total_expense', 'en', 'Shipping-Labels'), ('total_expense', 'en', 'Fulfillment-Fees'), ('total_expense', 'en', 'Pick-and-Pack'), ('total_expense', 'en', 'Interchange-Fees'), ('total_expense', 'en', 'Shrinkage'), ('total_expense', 'en', 'Bag-Tax'),
('units_sold', 'en', 'Units Sold'), ('units_sold', 'en', 'Qty Sold'), ('units_sold', 'en', 'Sales Volume'),
('on_hand', 'en', 'On Hand'), ('on_hand', 'en', 'In Stock'), ('on_hand', 'en', 'Available Qty'),

-- AR/AP & Liquidity
('ar_balance', 'en', 'Receivables'), ('ar_balance', 'en', 'Open-Invoices'), ('ar_balance', 'en', 'Unbilled-Revenue'), ('ar_balance', 'en', 'Doubtful-Accounts'),
('ap_balance', 'en', 'Payables'), ('ap_balance', 'en', 'Vendor-Balance'), ('ap_balance', 'en', 'Accrued-Expenses'), ('ap_balance', 'en', 'Trade-Credit'),
('aging_90', 'en', 'Over-90-Days'), ('aging_90', 'en', 'Delinquent'), ('aging_90', 'en', 'Stale-Invoices'), ('aging_90', 'en', 'Collections'),

-- Advanced Accounting
('labor_burden', 'en', 'FICA'), ('labor_burden', 'en', 'FUTA'), ('labor_burden', 'en', 'SUTA'), ('labor_burden', 'en', '401k-Matching'), ('labor_burden', 'en', 'Health-Premium-ER'), ('labor_burden', 'en', 'Workers-Comp'), ('labor_burden', 'en', 'Payroll-Processing-Fee'),
('non_cash_expense', 'en', 'Depreciation'), ('non_cash_expense', 'en', 'Amortization'), ('non_cash_expense', 'en', 'Stock-Based-Compensation'),
('compliance_expense', 'en', 'Audit-Engagement'), ('compliance_expense', 'en', 'SEC-Filing'), ('compliance_expense', 'en', 'Legal-Retainer'), ('compliance_expense', 'en', 'Business-License-Renewal');

-- 3. DETERMINISTIC INTENT RULES
INSERT INTO ai_learning_rules (scope, locale, phrase, mapped_intent, mapped_payload, confidence, status) VALUES
('global', 'en', 'total revenue', 'single_year_total', '{"metric_requested": "total_revenue"}', 1.0, 'approved'),
('global', 'en', 'net profit', 'single_year_total', '{"metric_requested": "net_income"}', 1.0, 'approved'),
('global', 'en', 'gross margin', 'single_year_total', '{"metric_requested": "gross_margin_pct"}', 1.0, 'approved'),
('global', 'en', 'how is the fleet doing?', 'complex', '{"metrics": ["trucking_rpm", "fuel_efficiency"], "question_type": "industry_health"}', 1.0, 'approved'),
('global', 'en', 'factory health?', 'complex', '{"metrics": ["mfg_unit_cost", "inventory_turnover"], "question_type": "industry_health"}', 1.0, 'approved'),
('global', 'en', 'property performance?', 'complex', '{"metrics": ["re_noi", "re_cap_rate"], "question_type": "industry_health"}', 1.0, 'approved'),
('global', 'en', 'what is our actual cash burn?', 'single_year_total', '{"metric_requested": "actual_cash_burn"}', 1.0, 'approved'),
('global', 'en', 'cost of our employees', 'single_year_total', '{"metric_requested": "personnel_cost_total"}', 1.0, 'approved'),
('global', 'en', 'runway', 'single_year_total', '{"metric_requested": "runway_months"}', 1.0, 'approved'),
('global', 'en', 'sell-thru', 'single_year_total', '{"metric_requested": "retail_sell_thru"}', 1.0, 'approved'),
('global', 'en', 'dso', 'single_year_total', '{"metric_requested": "ar_dso"}', 1.0, 'approved');

-- 4. FORMULA REGISTRY (MDFC v6.0)
INSERT INTO formula_registry (code, category, expression, output_unit, precision_digits, denominator_guard_key, enabled) VALUES
('TRUCKING_RPM', 'logistics', 'REV_LOG / MILES_TOTAL', 'currency', 2, 'MILES_TOTAL', TRUE),
('MFG_UNIT_COST', 'manufacturing', 'EXP_BURN_MFG / UNITS_PRODUCED', 'currency', 2, 'UNITS_PRODUCED', TRUE),
('RE_NOI', 'realestate', 'REV_RE - EXP_RE', 'currency', 2, NULL, TRUE),
('RETAIL_SELL_THRU', 'retail', '(UNITS_SOLD / (UNITS_SOLD + ON_HAND)) * 100', 'percent', 2, NULL, TRUE),
('RUNWAY_MDFC', 'cashflow', 'CASH_TOTAL / (EXP_BURN - REV_NET)', 'months', 2, NULL, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO formula_keys (formula_code, key_code, key_type, required, header_patterns) VALUES
('TRUCKING_RPM', 'REV_LOG', 'number', TRUE, '["rate per mile", "rpm revenue", "miles revenue"]'::jsonb),
('TRUCKING_RPM', 'MILES_TOTAL', 'number', TRUE, '["total miles", "distance", "miles travelled"]'::jsonb),
('MFG_UNIT_COST', 'EXP_BURN_MFG', 'number', TRUE, '["manufacturing costs", "production expense"]'::jsonb),
('MFG_UNIT_COST', 'UNITS_PRODUCED', 'number', TRUE, '["units produced", "production volume"]'::jsonb),
('RETAIL_SELL_THRU', 'UNITS_SOLD', 'number', TRUE, '["units sold", "qty sold"]'::jsonb),
('RETAIL_SELL_THRU', 'ON_HAND', 'number', TRUE, '["on hand", "inventory qty"]'::jsonb)
ON CONFLICT (formula_code, key_code) DO NOTHING;

INSERT INTO formula_aliases (formula_code, language, alias) VALUES
('TRUCKING_RPM', 'en', 'rpm'), ('TRUCKING_RPM', 'en', 'rate per mile'),
('MFG_UNIT_COST', 'en', 'unit cost'), ('MFG_UNIT_COST', 'en', 'manufacturing cost per unit'),
('RE_NOI', 'en', 'noi'), ('RE_NOI', 'en', 'net operating income'),
('RETAIL_SELL_THRU', 'en', 'sell-thru'), ('RETAIL_SELL_THRU', 'en', 'inventory conversion'),
('RUNWAY_MDFC', 'en', 'mdfc runway'), ('RUNWAY_MDFC', 'en', 'actual cash runway')
ON CONFLICT (formula_code, language, alias) DO NOTHING;

