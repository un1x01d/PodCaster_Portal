#!/usr/bin/env node
import XLSX from 'xlsx';

const ROWS = 10000;
const OUT = process.argv[2] || '/home/zed/git/tforn/PodCaster_Portal/accounting_standard_10000.xlsx';

const regions = ['North America', 'Europe', 'APAC', 'Latin America', 'Middle East'];
const businessUnits = ['Enterprise', 'SMB', 'Public Sector', 'Mid-Market'];
const productLines = ['Cloud Ops', 'Analytics Suite', 'Security Platform', 'Data Services'];
const accountGroups = ['Service Revenue', 'Subscription Revenue', 'Product Revenue', 'Partner Revenue'];
const channels = ['Direct', 'Partner', 'Online', 'Reseller'];
const currencies = ['USD'];

function rand(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function pick(arr, idx) {
  return arr[idx % arr.length];
}

function fmtDate(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function quarterFromMonth(m) {
  if (m <= 3) return 'Q1';
  if (m <= 6) return 'Q2';
  if (m <= 9) return 'Q3';
  return 'Q4';
}

const rawHeaders = [
  'Transaction ID',
  'Date',
  'Year',
  'Month',
  'Quarter',
  'Region',
  'Business Unit',
  'Product Line',
  'Account Group',
  'Customer Segment',
  'Sales Channel',
  'Currency',
  'Units Sold',
  'Unit Price',
  'Discount Amount',
  'Revenue Total',
  'COGS',
  'Expense Billed',
  'Gross Profit',
  'Net Revenue',
];

const rawRows = [rawHeaders];
const byYear = new Map();

for (let i = 1; i <= ROWS; i += 1) {
  const year = 2021 + (i % 6);
  const monthNum = (i % 12) + 1;
  const day = ((i * 7) % 28) + 1;
  const date = new Date(Date.UTC(year, monthNum - 1, day));

  const region = pick(regions, i);
  const bu = pick(businessUnits, i * 2);
  const product = pick(productLines, i * 3);
  const group = pick(accountGroups, i * 5);
  const segment = i % 3 === 0 ? 'Enterprise' : (i % 3 === 1 ? 'Commercial' : 'SMB');
  const channel = pick(channels, i * 7);
  const currency = currencies[0];

  const units = 50 + Math.floor(rand(i) * 950);
  const unitPrice = 120 + Math.floor(rand(i + 13) * 1880);
  const baseRevenue = units * unitPrice;
  const discount = Math.round(baseRevenue * (0.02 + rand(i + 21) * 0.12) * 100) / 100;
  const revenueTotal = Math.round((baseRevenue - discount) * 100) / 100;
  const cogs = Math.round((revenueTotal * (0.28 + rand(i + 34) * 0.33)) * 100) / 100;
  const expense = Math.round((revenueTotal * (0.12 + rand(i + 55) * 0.2)) * 100) / 100;
  const grossProfit = Math.round((revenueTotal - cogs) * 100) / 100;
  const netRevenue = Math.round((revenueTotal - cogs - expense) * 100) / 100;

  rawRows.push([
    `TXN-${String(i).padStart(6, '0')}`,
    fmtDate(date),
    year,
    date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    quarterFromMonth(monthNum),
    region,
    bu,
    product,
    group,
    segment,
    channel,
    currency,
    units,
    unitPrice,
    discount,
    revenueTotal,
    cogs,
    expense,
    grossProfit,
    netRevenue,
  ]);

  const y = byYear.get(year) || { revenue: 0, cogs: 0, expense: 0, gross: 0, net: 0, units: 0, tx: 0 };
  y.revenue += revenueTotal;
  y.cogs += cogs;
  y.expense += expense;
  y.gross += grossProfit;
  y.net += netRevenue;
  y.units += units;
  y.tx += 1;
  byYear.set(year, y);
}

const summaryHeaders = [
  'Year',
  'Transactions',
  'Units Sold',
  'Revenue Total',
  'COGS',
  'Expense Billed',
  'Gross Profit',
  'Net Revenue',
  'Gross Margin %',
  'Net Margin %',
  'Avg Revenue / Txn',
  'Avg Units / Txn',
];
const summaryRows = [summaryHeaders];
const years = Array.from(byYear.keys()).sort((a, b) => a - b);
for (const y of years) {
  const v = byYear.get(y);
  const grossMargin = v.revenue ? (v.gross / v.revenue) * 100 : 0;
  const netMargin = v.revenue ? (v.net / v.revenue) * 100 : 0;
  summaryRows.push([
    y,
    v.tx,
    Math.round(v.units),
    Math.round(v.revenue * 100) / 100,
    Math.round(v.cogs * 100) / 100,
    Math.round(v.expense * 100) / 100,
    Math.round(v.gross * 100) / 100,
    Math.round(v.net * 100) / 100,
    Math.round(grossMargin * 100) / 100,
    Math.round(netMargin * 100) / 100,
    Math.round((v.revenue / v.tx) * 100) / 100,
    Math.round((v.units / v.tx) * 100) / 100,
  ]);
}

const analyticsRows = [
  ['Metric', 'Chart Type', 'Source Sheet', 'Category Axis', 'Value Axis', 'Notes'],
  ['Revenue Total by Year', 'Line', 'Accounting_Summary', 'Year', 'Revenue Total', 'Trend of top-line revenue'],
  ['Net Revenue by Year', 'Bar', 'Accounting_Summary', 'Year', 'Net Revenue', 'Profitability trend after COGS and expense'],
  ['Gross Margin % by Year', 'Line', 'Accounting_Summary', 'Year', 'Gross Margin %', 'Margin trend before opex'],
  ['Net Margin % by Year', 'Area', 'Accounting_Summary', 'Year', 'Net Margin %', 'Bottom-line margin trend'],
  ['COGS vs Expense by Year', 'Clustered Column', 'Accounting_Summary', 'Year', 'COGS|Expense Billed', 'Cost structure comparison'],
  [],
  ['Dashboard Instructions', '', '', '', '', 'Use this tab to configure frontend charts from summarized data.'],
];

const wb = XLSX.utils.book_new();
const wsRaw = XLSX.utils.aoa_to_sheet(rawRows);
const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
const wsAnalytics = XLSX.utils.aoa_to_sheet(analyticsRows);

XLSX.utils.book_append_sheet(wb, wsRaw, 'Raw_Data');
XLSX.utils.book_append_sheet(wb, wsSummary, 'Accounting_Summary');
XLSX.utils.book_append_sheet(wb, wsAnalytics, 'Analytics');

XLSX.writeFile(wb, OUT);
console.log(`Created ${OUT}`);
