import { parentPort, workerData } from 'worker_threads';
import * as XLSX from 'xlsx';

const SHEET_NAME_MAX_CHARS = Number.parseInt(process.env.XLSX_SHEET_NAME_MAX_CHARS || "120", 10);
const memoryLimitMb = Number.parseInt(workerData?.memoryLimitMb || "0", 10);
const memoryLimitBytes = Number.isInteger(memoryLimitMb) && memoryLimitMb > 0
  ? memoryLimitMb * 1024 * 1024
  : 0;

function memorySnapshot(stage) {
  const usage = process.memoryUsage();
  return {
    stage,
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    external: usage.external,
    limitBytes: memoryLimitBytes,
  };
}

function assertWithinMemoryLimit(stage) {
  if (!memoryLimitBytes) return;
  const snapshot = memorySnapshot(stage);
  if (snapshot.heapUsed > memoryLimitBytes || snapshot.rss > memoryLimitBytes) {
    const err = new Error("xlsx_worker_memory_limit_exceeded");
    err.memory = snapshot;
    throw err;
  }
}

const monitor = memoryLimitBytes
  ? setInterval(() => {
      try {
        assertWithinMemoryLimit("monitor");
      } catch (err) {
        parentPort.postMessage({
          success: false,
          error: "xlsx_worker_memory_limit_exceeded",
          memory: err.memory || memorySnapshot("monitor"),
        });
        process.exit(1);
      }
    }, 50)
  : null;
if (monitor?.unref) monitor.unref();

function cleanSheetName(name, fallbackIndex) {
  const cleaned = String(name || `Sheet ${fallbackIndex + 1}`)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || `Sheet ${fallbackIndex + 1}`).slice(0, SHEET_NAME_MAX_CHARS);
}

function uniqueSheetName(baseName, usedNames) {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }
  const suffixBase = baseName.slice(0, Math.max(1, SHEET_NAME_MAX_CHARS - 8));
  let n = 2;
  while (usedNames.has(`${suffixBase} (${n})`)) n += 1;
  const next = `${suffixBase} (${n})`;
  usedNames.add(next);
  return next;
}

function stripWorksheetFeatures(ws) {
  if (!ws || typeof ws !== "object") return { formulas: 0, metadata: 0 };
  const preservedMeta = new Set(["!ref"]);
  let formulas = 0;
  let metadata = 0;

  for (const key of Object.keys(ws)) {
    if (key.startsWith("!")) {
      if (!preservedMeta.has(key)) {
        delete ws[key];
        metadata += 1;
      }
      continue;
    }

    const cell = ws[key];
    if (!cell || typeof cell !== "object") continue;
    if ("f" in cell || "F" in cell || "D" in cell) formulas += 1;
    delete cell.f;
    delete cell.F;
    delete cell.D;
    delete cell.c;
    delete cell.l;
    delete cell.r;
    delete cell.h;
    delete cell.s;
    delete cell.z;
    delete cell.w;
  }

  return { formulas, metadata };
}

function rowsFromWorksheet(ws) {
  return XLSX.utils.sheet_to_json(ws, {
    defval: "",
    raw: false,
    blankrows: false,
  });
}

try {
  const { buffer, filePath, options } = workerData;
  assertWithinMemoryLimit("start");
  const workbookOptions = {
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      cellText: false,
      bookDeps: false,
      bookFiles: false,
      bookProps: false,
      bookVBA: false,
      WTF: false,
      ...options,
  };
  const wb = filePath
    ? XLSX.readFile(filePath, workbookOptions)
    : XLSX.read(buffer, { type: 'buffer', ...workbookOptions });
  assertWithinMemoryLimit("after_workbook_read");
  
  const result = {
    sheetNames: [],
    sheets: {},
    cleanup: {
      formulasStripped: 0,
      metadataEntriesStripped: 0,
    }
  };

  const usedSheetNames = new Set();
  for (let i = 0; i < wb.SheetNames.length; i += 1) {
    const originalName = wb.SheetNames[i];
    const cleanName = uniqueSheetName(cleanSheetName(originalName, i), usedSheetNames);
    assertWithinMemoryLimit(`before_sheet_${i}`);
    const stats = stripWorksheetFeatures(wb.Sheets[originalName]);
    result.cleanup.formulasStripped += stats.formulas;
    result.cleanup.metadataEntriesStripped += stats.metadata;
    result.sheetNames.push(cleanName);
    result.sheets[cleanName] = rowsFromWorksheet(wb.Sheets[originalName]);
    assertWithinMemoryLimit(`after_sheet_${i}`);
  }

  if (monitor) clearInterval(monitor);
  parentPort.postMessage({ success: true, result });
} catch (e) {
  if (monitor) clearInterval(monitor);
  parentPort.postMessage({
    success: false,
    error: e.message,
    memory: e.memory || (e.message === "xlsx_worker_memory_limit_exceeded" ? memorySnapshot("catch") : undefined),
  });
}
