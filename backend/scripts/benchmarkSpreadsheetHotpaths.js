import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { normalizeDlpSettings, scanRowsForDlp } from '../src/utils/dlp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../../tests/ai_chat_compatible_finance_2021_2025.csv');

if (!fs.existsSync(samplePath)) {
  console.error(`[benchmark] sample file not found: ${samplePath}`);
  process.exit(1);
}

const wb = XLSX.readFile(samplePath, { cellDates: false });
const firstSheet = wb.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { defval: '' });
const headers = rows.length ? Object.keys(rows[0]) : [];
const sheets = [{ sheetName: firstSheet, rows, headers }];

const dlp = normalizeDlpSettings({
  enabled: true,
  mode: 'mask',
  checkSsn: true,
  checkCreditCard: true,
  checkEmail: true,
  checkPhone: true,
  checkIban: true,
  maskDetectedColumns: true,
});

const started = process.hrtime.bigint();
const result = scanRowsForDlp(sheets, dlp);
const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

console.log(JSON.stringify({
  samplePath,
  rows: rows.length,
  headers: headers.length,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  findings: Number(result?.findings?.length || 0),
  scannedCells: Number(result?.scannedCells || 0),
  maskedColumns: result?.maskedColumns || {},
}, null, 2));
