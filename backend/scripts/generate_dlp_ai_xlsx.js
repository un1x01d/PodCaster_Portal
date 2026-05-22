import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const outPath = '/home/zed/git/tforn/PodCaster_Portal/test-data/ai_dlp_5year_financial.xlsx';

const headers = [
  'Date',
  'Year',
  'Month',
  'Quarter',
  'Region',
  'Account Group',
  'Account',
  'Revenue Total',
  'Gross Revenue',
  'COGS',
  'Expense Billed',
  'Gross Profit',
  'Net Revenue',
  'Units Sold',
  'Customer Email',
  'Contact Phone'
];

const regions = ['North America', 'Europe', 'Middle East', 'APAC'];
const accountGroups = ['Service Revenue', 'Product Revenue', 'Subscription Revenue', 'Partner Revenue'];
const accounts = ['Advisory', 'Platform', 'Managed Services', 'Licensing'];
const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const rows = [];
for (let year = 2021; year <= 2025; year += 1) {
  for (let m = 0; m < 12; m += 1) {
    const idx = rows.length;
    const date = `${year}-${String(m + 1).padStart(2, '0')}-01`;

    // Strictly positive, purpose-aligned values
    const base = 85000 + (idx * 1650);
    const seasonal = (m === 10 || m === 11) ? 14000 : (m >= 5 && m <= 7 ? 4500 : 0);
    const grossRevenue = Number((base + seasonal).toFixed(2));
    const cogs = Number((grossRevenue * 0.33).toFixed(2));
    const operatingExpense = Number((grossRevenue * 0.24).toFixed(2));
    const grossProfit = Number((grossRevenue - cogs).toFixed(2));
    const netRevenue = Number((grossRevenue - operatingExpense).toFixed(2));
    const unitsSold = 900 + (idx * 11);

    rows.push({
      Date: date,
      Year: year,
      Month: monthNames[m],
      Quarter: `Q${Math.floor(m / 3) + 1}`,
      Region: regions[idx % regions.length],
      'Account Group': accountGroups[idx % accountGroups.length],
      Account: accounts[idx % accounts.length],
      'Revenue Total': grossRevenue,
      'Gross Revenue': grossRevenue,
      COGS: cogs,
      'Expense Billed': operatingExpense,
      'Gross Profit': grossProfit,
      'Net Revenue': netRevenue,
      'Units Sold': unitsSold,
      'Customer Email': `client${1001 + idx}@example.com`,
      'Contact Phone': `+1202555${String(1001 + idx).padStart(4, '0')}`
    });
  }
}

const ws = XLSX.utils.json_to_sheet(rows, { header: headers });

// Explicit formats to keep values clean and purpose-aligned
for (let r = 2; r <= rows.length + 1; r += 1) {
  if (ws[`B${r}`]) ws[`B${r}`].z = '0';
  for (const col of ['H','I','J','K','L','M']) {
    if (ws[`${col}${r}`]) ws[`${col}${r}`].z = '#,##0.00';
  }
  if (ws[`N${r}`]) ws[`N${r}`].z = '#,##0';
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Financials');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

console.log(outPath);
console.log('rows=', rows.length);
console.log('first=', rows[0].Date);
console.log('last=', rows[rows.length - 1].Date);
console.log('sample=', JSON.stringify(rows[0]));
