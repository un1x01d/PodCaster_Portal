import Decimal from "decimal.js";
import { getMetricDefinition } from "./metricRegistry.js";
import { safeSum, roundCurrency, roundPercent } from "./numeric.js";
import { filterRowsByPeriod, inferComparisonPeriod, normalizePeriod } from "./periodFilter.js";

function ensureAllowed(header, userContext = {}) {
  const allowed = Array.isArray(userContext?.allowedColumns) ? userContext.allowedColumns : null;
  if (!allowed) return true;
  return allowed.includes(header);
}

function pickResolution(headerResolution, canonical) {
  return headerResolution?.resolvedMappings?.[canonical] || headerResolution?.optionalMappings?.[canonical] || null;
}

export function runDeterministicCalculation({ rows = [], metric, headerResolution, period, comparisonPeriod, filters = [], userContext = {} }) {
  const def = getMetricDefinition(metric);
  if (!def) return { ok: false, errorCode: "UNSUPPORTED_METRIC", message: `Unsupported metric: ${metric}`, metric };
  if (!headerResolution || headerResolution.ok === false || headerResolution.missingRequired?.length || headerResolution.ambiguous?.length) {
    return { ok: false, errorCode: "HEADER_RESOLUTION_NOT_READY", message: "Header resolution is missing or ambiguous.", metric };
  }

  const rev = pickResolution(headerResolution, "total_revenue");
  const netRevCol = pickResolution(headerResolution, "net_revenue");
  const exp = pickResolution(headerResolution, "total_expense");
  const cogs = pickResolution(headerResolution, "cogs");
  const gp = pickResolution(headerResolution, "gross_profit");
  const ni = pickResolution(headerResolution, "net_income");
  const ar = pickResolution(headerResolution, "ar_balance");
  const ap = pickResolution(headerResolution, "ap_balance");
  const budget = pickResolution(headerResolution, "budget_amount");
  const actual = pickResolution(headerResolution, "actual_amount");
  const date = pickResolution(headerResolution, "date");

  const headersUsed = { revenue: rev || undefined, net_revenue: netRevCol || undefined, expenses: exp || undefined, cogs: cogs || undefined, grossProfit: gp || undefined, netIncome: ni || undefined, ar: ar || undefined, ap: ap || undefined, budget: budget || undefined, actual: actual || undefined, date: date || undefined };

  for (const h of Object.values(headersUsed)) {
    if (h && !ensureAllowed(h, userContext)) return { ok: false, errorCode: "UNAUTHORIZED_OR_MISSING_COLUMNS", message: `Unauthorized column: ${h}`, metric };
  }

  const requiredSets = [def.requiredCanonicalHeaders || [], ...(def.alternateRequiredCanonicalHeaderSets || [])].filter((s) => s.length);
  const satisfies = requiredSets.length === 0 || requiredSets.some((set) => set.every((c) => !!pickResolution(headerResolution, c)));
  if (!satisfies) {
    const missingColumns = (def.requiredCanonicalHeaders || []).filter((c) => !pickResolution(headerResolution, c));
    return { ok: false, errorCode: "MISSING_REQUIRED_COLUMNS", message: `Metric ${metric} requires required columns.`, missingColumns, metric };
  }

  let working = Array.isArray(rows) ? rows : [];
  const p = normalizePeriod(period);
  let excludedInvalidDate = 0;
  if (p && date) {
    const f = filterRowsByPeriod(working, date, p);
    working = f.rows;
    excludedInvalidDate = f.excludedInvalidDate;
  }

  const sumRevenue = rev ? safeSum(working, rev) : { value: new Decimal(0), invalidCount: 0 };
  const sumNetRevenueDirect = netRevCol ? safeSum(working, netRevCol) : { value: new Decimal(0), invalidCount: 0 };
  const sumExpenses = exp ? safeSum(working, exp) : { value: new Decimal(0), invalidCount: 0 };
  const sumCogs = cogs ? safeSum(working, cogs) : { value: new Decimal(0), invalidCount: 0 };
  const sumGrossProfit = gp ? safeSum(working, gp) : { value: new Decimal(0), invalidCount: 0 };
  const sumNetIncome = ni ? safeSum(working, ni) : { value: new Decimal(0), invalidCount: 0 };
  const sumAR = ar ? safeSum(working, ar) : { value: new Decimal(0), invalidCount: 0 };
  const sumAP = ap ? safeSum(working, ap) : { value: new Decimal(0), invalidCount: 0 };
  const sumBudget = budget ? safeSum(working, budget) : { value: new Decimal(0), invalidCount: 0 };
  const sumActual = actual ? safeSum(working, actual) : { value: new Decimal(0), invalidCount: 0 };


  const miles = pickResolution(headerResolution, "total_miles");
  const fuel = pickResolution(headerResolution, "fuel_gallons");
  const units = pickResolution(headerResolution, "units_produced");
  const inv = pickResolution(headerResolution, "inventory");
  const asset = pickResolution(headerResolution, "asset_value");

  const sumMiles = miles ? safeSum(working, miles) : { value: new Decimal(0), invalidCount: 0 };
  const sumFuel = fuel ? safeSum(working, fuel) : { value: new Decimal(0), invalidCount: 0 };
  const sumUnits = units ? safeSum(working, units) : { value: new Decimal(0), invalidCount: 0 };
  const sumInv = inv ? safeSum(working, inv) : { value: new Decimal(0), invalidCount: 0 };
  const sumAsset = asset ? safeSum(working, asset) : { value: new Decimal(0), invalidCount: 0 };

  const revOffsetCol = pickResolution(headerResolution, "revenue_offsets");
  const payrollCol = pickResolution(headerResolution, "payroll");
  const burdenCol = pickResolution(headerResolution, "labor_burden");
  const nonCashCol = pickResolution(headerResolution, "non_cash_expense");
  const complianceCol = pickResolution(headerResolution, "compliance_expense");
  const agingCol = pickResolution(headerResolution, "aging_90");
  const unitsSoldCol = pickResolution(headerResolution, "units_sold");
  const onHandCol = pickResolution(headerResolution, "on_hand");

  const sumRevOffset = revOffsetCol ? safeSum(working, revOffsetCol) : { value: new Decimal(0), invalidCount: 0 };
  const sumPayroll = payrollCol ? safeSum(working, payrollCol) : { value: new Decimal(0), invalidCount: 0 };
  const sumBurden = burdenCol ? safeSum(working, burdenCol) : { value: new Decimal(0), invalidCount: 0 };
  const sumNonCash = nonCashCol ? safeSum(working, nonCashCol) : { value: new Decimal(0), invalidCount: 0 };
  const sumCompliance = complianceCol ? safeSum(working, complianceCol) : { value: new Decimal(0), invalidCount: 0 };
  const sumAging90 = agingCol ? safeSum(working, agingCol) : { value: new Decimal(0), invalidCount: 0 };
  const sumUnitsSold = unitsSoldCol ? safeSum(working, unitsSoldCol) : { value: new Decimal(0), invalidCount: 0 };
  const sumOnHand = onHandCol ? safeSum(working, onHandCol) : { value: new Decimal(0), invalidCount: 0 };

  let comparisonRevenue = new Decimal(0);
  if (metric === "revenue_growth_pct" && rev) {
    const cp = comparisonPeriod || inferComparisonPeriod(p);
    if (cp && date) {
      const cf = filterRowsByPeriod(Array.isArray(rows) ? rows : [], date, cp);
      comparisonRevenue = safeSum(cf.rows, rev).value;
    }
  }

  const calc = def.calculate({
    sums: {
      revenue: sumRevenue.value,
      net_revenue: sumNetRevenueDirect.value,
      expenses: sumExpenses.value,
      cogs: sumCogs.value,
      grossProfit: sumGrossProfit.value,
      netIncome: sumNetIncome.value,
      ar: sumAR.value,
      ap: sumAP.value,
      budget: sumBudget.value,
      actual: sumActual.value,
      miles: sumMiles.value,
      fuel_gallons: sumFuel.value,
      units_produced: sumUnits.value,
      inventory: sumInv.value,
      asset_value: sumAsset.value,
      revenue_offsets: sumRevOffset.value,
      payroll: sumPayroll.value,
      labor_burden: sumBurden.value,
      non_cash_expense: sumNonCash.value,
      compliance_expense: sumCompliance.value,
      aging_90: sumAging90.value,
      units_sold: sumUnitsSold.value,
      on_hand: sumOnHand.value,
    },
    headersUsed,
    currentRevenue: sumRevenue.value,
    comparisonRevenue,
  });

  const invalidNumericCount = [sumRevenue, sumNetRevenueDirect, sumExpenses, sumCogs, sumGrossProfit, sumNetIncome, sumAR, sumAP, sumBudget, sumActual, sumMiles, sumFuel, sumUnits, sumInv, sumAsset, sumRevOffset, sumPayroll, sumBurden, sumNonCash, sumCompliance, sumAging90, sumUnitsSold, sumOnHand].reduce((a, s) => a + Number(s.invalidCount || 0), 0);




  const notes = [];
  if (invalidNumericCount > 0) notes.push(`Ignored ${invalidNumericCount} invalid numeric cell(s).`);
  if (excludedInvalidDate > 0) notes.push(`Excluded ${excludedInvalidDate} row(s) due to unparseable dates.`);
  if (calc?.note) notes.push(calc.note);

  const outValue = def.outputType === "percent" ? roundPercent(calc.value) : roundCurrency(calc.value);
  return {
    ok: true,
    metric: def.key,
    label: def.label,
    formula: def.formula,
    value: outValue,
    outputType: def.outputType,
    inputs: {
      revenue: roundCurrency(sumRevenue.value),
      cogs: roundCurrency(sumCogs.value),
      grossProfit: roundCurrency(sumGrossProfit.value),
      expenses: roundCurrency(sumExpenses.value),
      netIncome: roundCurrency(sumNetIncome.value),
      budget: roundCurrency(sumBudget.value),
      actual: roundCurrency(sumActual.value),
      comparisonRevenue: roundCurrency(comparisonRevenue),
    },
    rowCount: working.length,
    notes,
    period: p,
    headersUsed,
  };
}
