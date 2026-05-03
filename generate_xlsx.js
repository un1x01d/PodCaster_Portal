import XLSX from 'xlsx';
import fs from 'fs';

const headers = [
    "Date", "Transaction_ID", "Client_Name", "Region", "Product_Category", 
    "Service_Line", "Unit_Price", "Quantity", "Gross_Revenue", "Discount_Rate", 
    "Net_Revenue", "COGS_Percent", "COGS_Amount", "Marketing_Spend", "Fixed_Costs", 
    "Operating_Expenses", "EBITDA", "EBITDA_Margin", "Tax_Rate", "Net_Profit"
];

const clients = ["GlobalCorp", "TechNova", "Starlight Media", "Alpha Logistics", "BlueSky Retail", "Nexus Health", "Omega Energy", "Peak Finance"];
const regions = ["North America", "EMEA", "APAC", "LATAM"];
const categories = ["Software", "Hardware", "Consulting", "Support"];
const services = ["SaaS Subscription", "Implementation", "Maintenance", "Strategy Audit", "Cloud Hosting"];

const rows = [];

for (let i = 0; i < 100; i++) {
    const date = new Date(2020 + Math.floor(Math.random() * 7), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);
    const unitPrice = parseFloat((Math.random() * 500 + 50).toFixed(2));
    const quantity = Math.floor(Math.random() * 100) + 1;
    const grossRevenue = unitPrice * quantity;
    const discountRate = parseFloat((Math.random() * 0.15).toFixed(4));
    const netRevenue = grossRevenue * (1 - discountRate);
    const cogsPercent = parseFloat((Math.random() * 0.2 + 0.3).toFixed(4));
    const cogsAmount = netRevenue * cogsPercent;
    const marketingSpend = netRevenue * parseFloat((Math.random() * 0.1 + 0.05).toFixed(4));
    const fixedCosts = 500 + Math.random() * 200;
    const opExpenses = marketingSpend + fixedCosts;
    const ebitda = netRevenue - cogsAmount - opExpenses;
    const ebitdaMargin = ebitda / netRevenue;
    const taxRate = 0.21;
    const netProfit = ebitda * (1 - taxRate);

    rows.push([
        date.toISOString().split('T')[0],
        `TXN-${1000 + i}`,
        clients[Math.floor(Math.random() * clients.length)],
        regions[Math.floor(Math.random() * regions.length)],
        categories[Math.floor(Math.random() * categories.length)],
        services[Math.floor(Math.random() * services.length)],
        unitPrice,
        quantity,
        parseFloat(grossRevenue.toFixed(2)),
        parseFloat((discountRate * 100).toFixed(2)) + "%",
        parseFloat(netRevenue.toFixed(2)),
        parseFloat((cogsPercent * 100).toFixed(2)) + "%",
        parseFloat(cogsAmount.toFixed(2)),
        parseFloat(marketingSpend.toFixed(2)),
        parseFloat(fixedCosts.toFixed(2)),
        parseFloat(opExpenses.toFixed(2)),
        parseFloat(ebitda.toFixed(2)),
        parseFloat((ebitdaMargin * 100).toFixed(2)) + "%",
        "21%",
        parseFloat(netProfit.toFixed(2))
    ]);
}

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
XLSX.utils.book_append_sheet(wb, ws, "Financial_Analysis");

const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
fs.writeFileSync("financial_analysis_2020_2026.xlsx", buf);
console.log("File generated: financial_analysis_2020_2026.xlsx");
