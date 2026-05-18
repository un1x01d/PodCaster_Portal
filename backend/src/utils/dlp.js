import isEmail from "validator/lib/isEmail.js";
import isIBAN from "validator/lib/isIBAN.js";
import { findPhoneNumbersInText } from "libphonenumber-js";
import validCreditCard from "card-validator";

export const DLP_SETTINGS_KEY = "dlp_settings";

const DEFAULT_DLP_SETTINGS = {
    enabled: true,
    mode: "block",
    checkSsn: true,
    checkCreditCard: true,
    checkEmail: true,
    checkPhone: true,
    checkIban: true,
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
    const normalizedMode = mode === "warn" || mode === "block" || mode === "mask" ? mode : DEFAULT_DLP_SETTINGS.mode;
    return {
        enabled: source.enabled !== false,
        mode: normalizedMode,
        checkSsn: source.checkSsn !== false,
        checkCreditCard: source.checkCreditCard !== false,
        checkEmail: source.checkEmail !== false,
        checkPhone: source.checkPhone !== false,
        checkIban: source.checkIban !== false,
        maskDetectedColumns: normalizedMode === "mask" || source.maskDetectedColumns === true,
        maxCellsScanned: normalizePositiveInt(source.maxCellsScanned, DEFAULT_DLP_SETTINGS.maxCellsScanned, 1000, 500000),
        maxFindings: normalizePositiveInt(source.maxFindings, DEFAULT_DLP_SETTINGS.maxFindings, 1, 1000),
    };
}

function pushFinding(findings, finding, maxFindings) {
    if (findings.length >= maxFindings) return false;
    findings.push(finding);
    return true;
}

export function scanRowsForDlp(sheets, settings) {
    const cfg = normalizeDlpSettings(settings || {});
    if (cfg.enabled === false) {
        return { findings: [], scannedCells: 0, capped: false, maskedColumns: {}, maskedCells: {}, disabled: true };
    }
    const findings = [];
    const maskedColumns = {};
    const maskedCells = {};
    let scannedCells = 0;
    let findingLimitReached = false;
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;
    const cardLikePattern = /\b(?:\d[ -]?){13,19}\b/g;
    const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
    const ibanPattern = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/gi;
    const seenCells = new Set();
    const markMaskedCell = (sheetName, row1Based, columnName) => {
        const key = `${sheetName}::${row1Based}::${columnName}`;
        if (seenCells.has(key)) return;
        seenCells.add(key);
        maskedColumns[sheetName] = maskedColumns[sheetName] || new Set();
        maskedColumns[sheetName].add(columnName);
        maskedCells[sheetName] = maskedCells[sheetName] || [];
        maskedCells[sheetName].push({ row: row1Based, column: columnName });
    };

    for (const [sheetName, rows] of Object.entries(sheets || {})) {
        if (!Array.isArray(rows)) continue;
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex] || {};
            for (const [columnName, raw] of Object.entries(row)) {
                if (scannedCells >= cfg.maxCellsScanned) {
                    return {
                        findings,
                        scannedCells,
                        capped: true,
                        maskedColumns: Object.fromEntries(Object.entries(maskedColumns).map(([k, set]) => [k, Array.from(set)])),
                        maskedCells,
                    };
                }
                scannedCells += 1;
                const value = String(raw ?? "");
                if (!value) continue;
                if (cfg.checkSsn) {
                    const ssnMatch = value.match(ssnPattern);
                    if (ssnMatch?.length) {
                        markMaskedCell(sheetName, rowIndex + 1, columnName);
                        const added = pushFinding(findings, {
                            type: "ssn",
                            sheet: sheetName,
                            row: rowIndex + 1,
                            column: columnName,
                            sample: ssnMatch[0],
                        }, cfg.maxFindings);
                        if (!added) findingLimitReached = true;
                    }
                }
                if (cfg.checkCreditCard) {
                    const candidates = value.match(cardLikePattern) || [];
                    for (const token of candidates) {
                        if (validCreditCard.number(token).isValid) {
                            markMaskedCell(sheetName, rowIndex + 1, columnName);
                            const added = pushFinding(findings, {
                                type: "credit_card",
                                sheet: sheetName,
                                row: rowIndex + 1,
                                column: columnName,
                                sample: token,
                            }, cfg.maxFindings);
                            if (!added) findingLimitReached = true;
                            break;
                        }
                    }
                }
                if (cfg.checkEmail) {
                    const candidates = value.match(emailPattern) || [];
                    for (const token of candidates) {
                        if (isEmail(token)) {
                            markMaskedCell(sheetName, rowIndex + 1, columnName);
                            const added = pushFinding(findings, {
                                type: "email",
                                sheet: sheetName,
                                row: rowIndex + 1,
                                column: columnName,
                                sample: token,
                            }, cfg.maxFindings);
                            if (!added) findingLimitReached = true;
                            break;
                        }
                    }
                }
                if (cfg.checkPhone) {
                    const phoneMatches = findPhoneNumbersInText(value, "US");
                    if (phoneMatches.length > 0) {
                        markMaskedCell(sheetName, rowIndex + 1, columnName);
                        const added = pushFinding(findings, {
                            type: "phone",
                            sheet: sheetName,
                            row: rowIndex + 1,
                            column: columnName,
                            sample: phoneMatches[0].number.number,
                        }, cfg.maxFindings);
                        if (!added) findingLimitReached = true;
                    }
                }
                if (cfg.checkIban) {
                    const candidates = value.match(ibanPattern) || [];
                    for (const token of candidates) {
                        if (isIBAN(token)) {
                            markMaskedCell(sheetName, rowIndex + 1, columnName);
                            const added = pushFinding(findings, {
                                type: "iban",
                                sheet: sheetName,
                                row: rowIndex + 1,
                                column: columnName,
                                sample: token,
                            }, cfg.maxFindings);
                            if (!added) findingLimitReached = true;
                            break;
                        }
                    }
                }
            }
        }
    }
    return {
        findings,
        scannedCells,
        capped: findingLimitReached,
        maskedColumns: Object.fromEntries(Object.entries(maskedColumns).map(([k, set]) => [k, Array.from(set)])),
        maskedCells,
    };
}

export function applyDlpColumnMasking(sheets, maskedColumns, maskValue = "[REDACTED]", maskedCells = null) {
    const next = {};
    for (const [sheetName, rows] of Object.entries(sheets || {})) {
        if (!Array.isArray(rows)) {
            next[sheetName] = rows;
            continue;
        }
        const cellsForSheet = Array.isArray(maskedCells?.[sheetName]) ? maskedCells[sheetName] : [];
        if (cellsForSheet.length) {
            const byRow = new Map();
            cellsForSheet.forEach((entry) => {
                const rowNum = Number(entry?.row);
                const col = String(entry?.column || "");
                if (!Number.isInteger(rowNum) || rowNum <= 0 || !col) return;
                if (!byRow.has(rowNum)) byRow.set(rowNum, new Set());
                byRow.get(rowNum).add(col);
            });
            next[sheetName] = rows.map((row, idx) => {
                const cols = byRow.get(idx + 1);
                if (!cols || !cols.size) return row;
                const cloned = { ...(row || {}) };
                for (const col of cols) {
                    if (Object.prototype.hasOwnProperty.call(cloned, col)) {
                        cloned[col] = maskValue;
                    }
                }
                return cloned;
            });
            continue;
        }
        // Backward compatibility fallback: column-level masking when maskedCells are unavailable.
        const columns = new Set(Array.isArray(maskedColumns?.[sheetName]) ? maskedColumns[sheetName] : []);
        if (!columns.size) {
            next[sheetName] = rows;
            continue;
        }
        next[sheetName] = rows.map((row) => {
            const cloned = { ...(row || {}) };
            for (const col of columns) {
                if (Object.prototype.hasOwnProperty.call(cloned, col)) cloned[col] = maskValue;
            }
            return cloned;
        });
    }
    return next;
}
