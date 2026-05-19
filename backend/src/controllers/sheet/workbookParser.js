export function normalizeWorkerMemoryLimitMb(value, fallback, limits = {}) {
  const { minMemoryMb = 64, maxMemoryMb = 4096 } = limits;
  const parsed = Number.parseInt(value, 10);
  const fallbackParsed = Number.parseInt(fallback, 10);
  const base = Number.isInteger(parsed) && parsed > 0
    ? parsed
    : (Number.isInteger(fallbackParsed) && fallbackParsed > 0 ? fallbackParsed : 512);
  const min = Math.max(16, Number.isInteger(minMemoryMb) ? minMemoryMb : 64);
  const max = Math.max(min, Number.isInteger(maxMemoryMb) ? maxMemoryMb : 4096);
  return Math.min(max, Math.max(min, base));
}

export function assertBufferedImportSizeAllowed({ fileSize, parseMemoryLimitMb, bufferedImportLimitBytes, fallbackMemoryMb, limits }) {
  const size = Number(fileSize || 0);
  const parseLimitBytes = normalizeWorkerMemoryLimitMb(parseMemoryLimitMb, fallbackMemoryMb, limits) * 1024 * 1024;
  const maxBytes = Math.min(bufferedImportLimitBytes, parseLimitBytes);
  if (Number.isFinite(size) && size > maxBytes) {
    const err = new Error("file_too_large");
    err.statusCode = 413;
    err.details = { maxMB: Math.max(1, Math.floor(maxBytes / 1024 / 1024)) };
    throw err;
  }
}

export async function resolveTenantParseMemoryLimitMb({ user, query, resolveRuntimeGroupIdForUser, normalizeGroupEntitlements, fallbackMemoryMb, limits }) {
  const defaultLimit = normalizeWorkerMemoryLimitMb(null, fallbackMemoryMb, limits);
  try {
    const groupId = await resolveRuntimeGroupIdForUser(user);
    let rows = [];
    if (Number.isInteger(groupId) && groupId > 0) {
      rows = await query("SELECT entitlements FROM groups WHERE id = $1 LIMIT 1", [groupId]);
    } else if (Number.isInteger(Number(user?.id)) && Number(user?.id) > 0) {
      rows = await query(
        `SELECT g.entitlements
           FROM groups g
           JOIN user_groups ug ON ug.group_id = g.id
          WHERE ug.user_id = $1
          ORDER BY g.id ASC
          LIMIT 1`,
        [user.id]
      );
    }
    const entitlements = normalizeGroupEntitlements(rows?.[0]?.entitlements || {});
    return normalizeWorkerMemoryLimitMb(entitlements.maxImportParseMemoryMb, defaultLimit, limits);
  } catch (err) {
    console.warn("[upload] failed to resolve tenant parse memory limit:", err?.message || err);
    return defaultLimit;
  }
}

export function parseWorkbookInWorker({ buffer, memoryLimitMb = null, fallbackMemoryMb, limits, Worker, workerPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const parseMemoryLimitMb = normalizeWorkerMemoryLimitMb(memoryLimitMb, fallbackMemoryMb, limits);
    const memoryLimitBytes = parseMemoryLimitMb * 1024 * 1024;
    if (Buffer.byteLength(buffer || Buffer.alloc(0)) > memoryLimitBytes) {
      reject(new Error("xlsx_worker_memory_limit_exceeded"));
      return;
    }
    const worker = new Worker(workerPath, {
      workerData: { buffer, memoryLimitMb: parseMemoryLimitMb },
      resourceLimits: {
        maxOldGenerationSizeMb: parseMemoryLimitMb,
      },
    });
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
    };
    const timer = setTimeout(async () => {
      if (settled) return;
      try {
        await worker.terminate();
      } catch {
        // Ignore terminate errors; timeout error is primary signal.
      }
      cleanup();
      reject(new Error("xlsx_worker_timeout"));
    }, timeoutMs);
    worker.on("message", (msg) => {
      if (settled) return;
      cleanup();
      if (msg.success) resolve(msg.result);
      else reject(new Error(msg.error));
    });
    worker.on("error", (err) => {
      if (settled) return;
      cleanup();
      if (String(err?.message || "").toLowerCase().includes("memory")) {
        reject(new Error("xlsx_worker_memory_limit_exceeded"));
        return;
      }
      reject(err);
    });
    worker.on("exit", (code) => {
      if (settled) return;
      cleanup();
      if (code !== 0) reject(new Error("xlsx_worker_memory_limit_exceeded"));
    });
  });
}

export function parseWorkbookInWorkerStreamed({ buffer, memoryLimitMb = null, fallbackMemoryMb, limits, Worker, workerPath, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const parseMemoryLimitMb = normalizeWorkerMemoryLimitMb(memoryLimitMb, fallbackMemoryMb, limits);
    const memoryLimitBytes = parseMemoryLimitMb * 1024 * 1024;
    if (Buffer.byteLength(buffer || Buffer.alloc(0)) > memoryLimitBytes) {
      reject(new Error("xlsx_worker_memory_limit_exceeded"));
      return;
    }
    const worker = new Worker(workerPath, {
      workerData: { buffer, memoryLimitMb: parseMemoryLimitMb, options: { streamMode: true } },
      resourceLimits: { maxOldGenerationSizeMb: parseMemoryLimitMb },
    });
    const result = {
      sheetNames: [],
      sheets: {},
      cleanup: { formulasStripped: 0, metadataEntriesStripped: 0 },
    };
    let settled = false;
    const cleanup = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      return true;
    };
    const timer = setTimeout(async () => {
      if (!cleanup()) return;
      try { await worker.terminate(); } catch {}
      reject(new Error("xlsx_worker_timeout"));
    }, timeoutMs);
    worker.on("message", (msg) => {
      if (settled) return;
      if (!msg?.success) {
        cleanup();
        reject(new Error(msg?.error || "unreadable_spreadsheet"));
        return;
      }
      if (msg?.mode !== "stream") return;
      const ev = String(msg?.event || "");
      if (ev === "sheet_start") {
        const sn = String(msg.sheetName || "").trim();
        if (!sn) return;
        if (!result.sheetNames.includes(sn)) result.sheetNames.push(sn);
        if (!Array.isArray(result.sheets[sn])) result.sheets[sn] = [];
        return;
      }
      if (ev === "rows_chunk") {
        const sn = String(msg.sheetName || "").trim();
        if (!sn) return;
        if (!Array.isArray(result.sheets[sn])) result.sheets[sn] = [];
        const rows = Array.isArray(msg.rows) ? msg.rows : [];
        result.sheets[sn].push(...rows);
        return;
      }
      if (ev === "done") {
        const summary = msg.summary || {};
        result.cleanup = {
          formulasStripped: Number(summary?.cleanup?.formulasStripped || 0),
          metadataEntriesStripped: Number(summary?.cleanup?.metadataEntriesStripped || 0),
        };
        cleanup();
        resolve(result);
      }
    });
    worker.on("error", (err) => {
      if (!cleanup()) return;
      if (String(err?.message || "").toLowerCase().includes("memory")) {
        reject(new Error("xlsx_worker_memory_limit_exceeded"));
        return;
      }
      reject(err);
    });
    worker.on("exit", (code) => {
      if (settled) return;
      cleanup();
      if (code !== 0) reject(new Error("xlsx_worker_memory_limit_exceeded"));
      else reject(new Error("unreadable_spreadsheet"));
    });
  });
}

export function parseWorkbookFromBufferWithFallback({ fileBuffer, options = {}, XLSX }) {
  const readOptions = {
    type: "buffer",
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
  const normalized = Buffer.isBuffer(fileBuffer)
    ? fileBuffer
    : (fileBuffer instanceof ArrayBuffer ? Buffer.from(new Uint8Array(fileBuffer)) : Buffer.from(fileBuffer || ""));
  const sample = normalized.slice(0, 4096);
  const likelyText = (() => {
    if (!sample.length) return false;
    for (let i = 0; i < sample.length; i += 1) {
      if (sample[i] === 0x00) return false;
    }
    const text = sample.toString("utf8");
    return /<html|<table|,|\t|\r|\n/i.test(text);
  })();

  const attempts = [
    { type: "buffer", value: normalized },
    { type: "array", value: new Uint8Array(normalized) },
  ];
  if (likelyText) {
    attempts.push({ type: "string", value: normalized.toString("utf8") });
    attempts.push({ type: "binary", value: normalized.toString("binary") });
  }

  let parseError;
  for (const attempt of attempts) {
    try {
      return XLSX.read(attempt.value, { ...readOptions, type: attempt.type });
    } catch (err) {
      parseError = err;
    }
  }
  throw parseError || new Error("Unable to parse workbook data with fallback readers.");
}

export async function parseWorkbookBufferOrThrow({ fileBuffer, options = {}, parseWorkbookInWorkerFn, parseWorkbookFromBufferWithFallbackFn, toImportError }) {
  try {
    const parsed = await parseWorkbookInWorkerFn(fileBuffer, options);
    if (parsed && Array.isArray(parsed.sheetNames) && parsed.sheetNames.length >= 0) {
      return parsed;
    }
    throw toImportError("empty_parsed_workbook", 400, "Workbook parser returned no sheet data.");
  } catch (err) {
    if (String(err?.message || "") === "xlsx_worker_memory_limit_exceeded") {
      const mapped = toImportError(
        "xlsx_worker_memory_limit_exceeded",
        413,
        "Spreadsheet parsing exceeded this customer's memory limit. Reduce the file size/complexity or raise the customer import memory limit."
      );
      mapped.cause = err;
      throw mapped;
    }
    const directWorkerErr = err;
    try {
      return parseWorkbookFromBufferWithFallbackFn(fileBuffer, options);
    } catch (directErr) {
      const message = String(directErr?.message || "").toLowerCase();
      if (message.includes("password") || message.includes("encrypted")) {
        const mapped = toImportError(
          "unreadable_spreadsheet",
          400,
          "Uploaded spreadsheet appears encrypted/password-protected or compressed in an unsupported way."
        );
        mapped.cause = { worker: directWorkerErr, direct: directErr };
        mapped.rootError = String(directErr?.message || directErr);
        throw mapped;
      }
      const mapped = toImportError(
        "unreadable_spreadsheet",
        400,
        "Could not parse file as CSV/XLSX/XML/HTML-table."
      );
      mapped.cause = { worker: directWorkerErr, direct: directErr };
      mapped.workerMessage = String(directWorkerErr?.message || "");
      mapped.directMessage = String(directErr?.message || "");
      mapped.rootError = String(directErr?.message || directErr);
      throw mapped;
    }
  }
}

export async function parseWorkbookFileOrThrow({ filePath, options = {}, fs, parseWorkbookBufferOrThrowFn }) {
  const fileBuffer = await fs.promises.readFile(filePath);
  return parseWorkbookBufferOrThrowFn(fileBuffer, options);
}
