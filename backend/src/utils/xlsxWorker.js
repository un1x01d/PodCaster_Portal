import { parentPort, workerData } from 'worker_threads';
import * as XLSX from 'xlsx';

try {
  const { buffer, options } = workerData;
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, ...options });
  
  const result = {
    sheetNames: wb.SheetNames,
    sheets: {}
  };

  for (const sn of wb.SheetNames) {
    // For large sheets, we might want to avoid JSON.stringify-ing the whole thing at once
    // but for now, we'll return the parsed objects.
    result.sheets[sn] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });
  }

  parentPort.postMessage({ success: true, result });
} catch (e) {
  parentPort.postMessage({ success: false, error: e.message });
}
