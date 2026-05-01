export const DLP_SETTINGS_KEY = "dlp_settings";

const DEFAULT_DLP_SETTINGS = {
    enabled: false,
    mode: "block",
    checkSsn: true,
    checkCreditCard: true,
    maskDetectedColumns: false,
    maxCellsScanned: 50000,
    maxFindings: 50,
};

function normalizePositiveInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

export function normalizeDlpSettings(raw = {}) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const mode = String(source.mode || DEFAULT_DLP_SETTINGS.mode).trim().toLowerCase();
    return {
        enabled: source.enabled === undefined ? DEFAULT_DLP_SETTINGS.enabled : source.enabled !== false,
        mode: mode === "warn" || mode === "log" || mode === "block" ? mode : DEFAULT_DLP_SETTINGS.mode,
        checkSsn: source.checkSsn !== false,
        checkCreditCard: source.checkCreditCard !== false,
        maskDetectedColumns: source.maskDetectedColumns === true,
        maxCellsScanned: normalizePositiveInt(source.maxCellsScanned, DEFAULT_DLP_SETTINGS.maxCellsScanned, 1000, 500000),
        maxFindings: normalizePositiveInt(source.maxFindings, DEFAULT_DLP_SETTINGS.maxFindings, 1, 1000),
    };
}

function luhnValid(candidate) {
    const digits = String(candidate || "").replace(/\D+/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
        let d = Number.parseInt(digits[i], 10);
        if (shouldDouble) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
        shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
}

function pushFinding(findings, finding, maxFindings) {
    if (findings.length >= maxFindings) return;
    findings.push(finding);
}

export function scanRowsForDlp(sheets, settings) {
    const cfg = normalizeDlpSettings(settings || {});
    const findings = [];
    const maskedColumns = {};
    let scannedCells = 0;
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
    const cardLikePattern = /\b(?:\d[ -]?){13,19}\b/g;

    for (const [sheetName, rows] of Object.entries(sheets || {})) {
        if (!Array.isArray(rows)) continue;
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex] || {};
            for (const [columnName, raw] of Object.entries(row)) {
                if (scannedCells >= cfg.maxCellsScanned) {
                    return { findings, scannedCells, capped: true };
                }
                scannedCells += 1;
                const value = String(raw ?? "");
                if (!value) continue;
                if (cfg.checkSsn) {
                    const ssnMatch = value.match(ssnPattern);
                    if (ssnMatch?.length) {
                        maskedColumns[sheetName] = maskedColumns[sheetName] || new Set();
                        maskedColumns[sheetName].add(columnName);
                        pushFinding(findings, {
                            type: "ssn",
                            sheet: sheetName,
                            row: rowIndex + 1,
                            column: columnName,
                            sample: ssnMatch[0],
                        }, cfg.maxFindings);
                    }
                }
                if (cfg.checkCreditCard) {
                    const candidates = value.match(cardLikePattern) || [];
                    for (const token of candidates) {
                        if (luhnValid(token)) {
                            maskedColumns[sheetName] = maskedColumns[sheetName] || new Set();
                            maskedColumns[sheetName].add(columnName);
                            pushFinding(findings, {
                                type: "credit_card",
                                sheet: sheetName,
                                row: rowIndex + 1,
                                column: columnName,
                                sample: token,
                            }, cfg.maxFindings);
                            break;
                        }
                    }
                }
                if (findings.length >= cfg.maxFindings) {
                    return {
                        findings,
                        scannedCells,
                        capped: true,
                        maskedColumns: Object.fromEntries(Object.entries(maskedColumns).map(([k, set]) => [k, Array.from(set)])),
                    };
                }
            }
        }
    }
    return {
        findings,
        scannedCells,
        capped: false,
        maskedColumns: Object.fromEntries(Object.entries(maskedColumns).map(([k, set]) => [k, Array.from(set)])),
    };
}

export function applyDlpColumnMasking(sheets, maskedColumns, maskValue = "[REDACTED]") {
    const next = {};
    for (const [sheetName, rows] of Object.entries(sheets || {})) {
        const columns = new Set(Array.isArray(maskedColumns?.[sheetName]) ? maskedColumns[sheetName] : []);
        if (!columns.size || !Array.isArray(rows)) {
            next[sheetName] = rows;
            continue;
        }
        next[sheetName] = rows.map((row) => {
            const cloned = { ...(row || {}) };
            for (const col of columns) {
                if (Object.prototype.hasOwnProperty.call(cloned, col)) {
                    cloned[col] = maskValue;
                }
            }
            return cloned;
        });
    }
    return next;
}
