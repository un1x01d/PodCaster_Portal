#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const OUTPUT_PATH = path.resolve(process.cwd(), "ai_ready_finance_dataset.csv");

const headers = [
  "Date",
  "Segment",
  "Region",
  "Product",
  "Customer",
  "Channel",
  "Units Sold",
  "Unit Price",
  "Discount Amount",
  "Net Sales",
  "COGS",
  "Gross Profit",
  "Operating Expense",
  "Marketing Spend",
  "Total Expense",
  "Net Income",
  "Order ID",
];

const segments = ["SMB", "Mid-Market", "Enterprise"];
const regions = ["North America", "Europe", "APAC", "Latin America", "Middle East"];
const products = ["Starter Plan", "Data Sync", "Integration Pack", "Analytics Suite", "Forecast Pro"];
const customers = ["Acme Corp", "Nova Retail", "Sakura Ltd", "Andes Group", "Orion Inc", "Atlas BV", "Zenith Co", "Helios AG", "Maple LLC", "Beta GmbH"];
const channels = ["Direct", "Online", "Partner", "In-Store"];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toIsoDate(year, month) {
  const day = randInt(1, 28);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isNumeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateRow(row) {
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(row[0]);
  if (!dateOk) return `invalid_date:${row[0]}`;
  for (let i = 6; i <= 15; i += 1) {
    if (!isNumeric(row[i])) return `non_numeric_metric:${headers[i]}=${String(row[i])}`;
  }
  if (!/^ORD-\d{4}-\d{6}$/.test(row[16])) return `invalid_order_id:${row[16]}`;
  return null;
}

function toCsvCell(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

const rows = [];
let orderCounter = 1;

for (let year = 2021; year <= 2025; year += 1) {
  for (let month = 1; month <= 12; month += 1) {
    for (let i = 0; i < 20; i += 1) {
      const segment = pick(segments);
      const region = pick(regions);
      const product = pick(products);
      const customer = pick(customers);
      const channel = pick(channels);

      const unitsSold = randInt(45, 600);
      const unitPrice = round2(
        segment === "Enterprise" ? randInt(26000, 52000) / 100 : segment === "Mid-Market" ? randInt(17000, 31000) / 100 : randInt(9000, 16000) / 100
      );
      const grossSales = round2(unitsSold * unitPrice);
      const discountRate = segment === "Enterprise" ? (randInt(3, 14) / 100) : (randInt(1, 11) / 100);
      const discountAmount = round2(grossSales * discountRate);
      const netSales = round2(grossSales - discountAmount);

      const cogsRate = product === "Analytics Suite" ? 0.52 : product === "Data Sync" ? 0.58 : 0.62;
      const cogs = round2(netSales * (cogsRate + (randInt(-2, 2) / 100)));
      const grossProfit = round2(netSales - cogs);
      const operatingExpense = round2(netSales * (randInt(8, 16) / 100));
      const marketingSpend = round2(netSales * (randInt(2, 7) / 100));
      const totalExpense = round2(operatingExpense + marketingSpend);
      const netIncome = round2(grossProfit - totalExpense);
      const orderId = `ORD-${year}-${String(orderCounter).padStart(6, "0")}`;
      orderCounter += 1;

      const row = [
        toIsoDate(year, month),
        segment,
        region,
        product,
        customer,
        channel,
        unitsSold,
        unitPrice,
        discountAmount,
        netSales,
        cogs,
        grossProfit,
        operatingExpense,
        marketingSpend,
        totalExpense,
        netIncome,
        orderId,
      ];

      const validationError = validateRow(row);
      if (validationError) {
        throw new Error(`row_validation_failed:${validationError}`);
      }
      rows.push(row);
    }
  }
}

const lines = [headers.join(",")].concat(rows.map((row) => row.map(toCsvCell).join(",")));
fs.writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");
console.log(`generated ${rows.length} rows -> ${OUTPUT_PATH}`);
