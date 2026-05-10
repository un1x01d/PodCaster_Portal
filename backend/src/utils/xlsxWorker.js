import { parentPort, workerData } from 'worker_threads';
import * as XLSX from 'xlsx';
import fs from 'fs';

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

function chunkRows(rows, chunkSize = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunkSize) out.push(rows.slice(i, i + chunkSize));
  return out;
}

function parseWorkbookWithFallbacks(sourceBuffer, baseOptions) {
  const normalized = Buffer.isBuffer(sourceBuffer)
    ? sourceBuffer
    : (sourceBuffer instanceof ArrayBuffer ? Buffer.from(new Uint8Array(sourceBuffer)) : Buffer.from(sourceBuffer || ""));
  const sample = normalized.slice(0, 4096);
  const isLikelyText = (() => {
    if (!sample.length) return false;
    for (let i = 0; i < sample.length; i += 1) {
      if (sample[i] === 0x00) return false;
    }
    const text = sample.toString("utf8");
    return /<html|<table|<tbody|,|\t|\r|\n/i.test(text);
  })();

  const attempts = [
    { type: "buffer", input: normalized },
    { type: "array", input: new Uint8Array(normalized) },
  ];
  if (isLikelyText) {
    attempts.push({ type: "string", input: normalized.toString("utf8") });
    attempts.push({ type: "binary", input: normalized.toString("binary") });
    attempts.push({ type: "base64", input: normalized.toString("base64") });
  }

  let lastError;
  for (const attempt of attempts) {
    try {
      return XLSX.read(attempt.input, {
        ...baseOptions,
        type: attempt.type,
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Unable to parse workbook with available reader modes.");
}

try {
  const { buffer, filePath, options } = workerData;
  const streamMode = options?.streamMode === true;
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
  const workbookData = filePath ? fs.readFileSync(filePath) : buffer;
  const wb = parseWorkbookWithFallbacks(workbookData, workbookOptions);
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
  if (streamMode) parentPort.postMessage({ success: true, mode: "stream", event: "start" });
  for (let i = 0; i < wb.SheetNames.length; i += 1) {
    const originalName = wb.SheetNames[i];
    const cleanName = uniqueSheetName(cleanSheetName(originalName, i), usedSheetNames);
    assertWithinMemoryLimit(`before_sheet_${i}`);
    const stats = stripWorksheetFeatures(wb.Sheets[originalName]);
    result.cleanup.formulasStripped += stats.formulas;
    result.cleanup.metadataEntriesStripped += stats.metadata;
    result.sheetNames.push(cleanName);
    const rows = rowsFromWorksheet(wb.Sheets[originalName]);
    if (streamMode) {
      parentPort.postMessage({ success: true, mode: "stream", event: "sheet_start", sheetName: cleanName, rowCount: rows.length });
      const chunks = chunkRows(rows, 500);
      for (let c = 0; c < chunks.length; c += 1) {
        parentPort.postMessage({
          success: true,
          mode: "stream",
          event: "rows_chunk",
          sheetName: cleanName,
          chunkIndex: c,
          rows: chunks[c],
        });
      }
      parentPort.postMessage({ success: true, mode: "stream", event: "sheet_end", sheetName: cleanName });
    } else {
      result.sheets[cleanName] = rows;
    }
    assertWithinMemoryLimit(`after_sheet_${i}`);
  }

  if (monitor) clearInterval(monitor);
  if (streamMode) {
    parentPort.postMessage({ success: true, mode: "stream", event: "done", summary: { sheetNames: result.sheetNames, cleanup: result.cleanup } });
  } else {
    parentPort.postMessage({ success: true, result });
  }
} catch (e) {
  if (monitor) clearInterval(monitor);
  parentPort.postMessage({
    success: false,
    error: e.message,
    memory: e.memory || (e.message === "xlsx_worker_memory_limit_exceeded" ? memorySnapshot("catch") : undefined),
  });
}
