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

const PHONE_SEP_PATTERN = /[()+\-\s.]/;
const DIGITS_ONLY_PATTERN = /\d/g;

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

function normalizeCellText(value) {
    return String(value ?? "").trim();
}

function toNumberOrNull(value) {
    const text = normalizeCellText(value);
    if (!text) return null;
    const cleaned = text.replace(/[$,%\s]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

function analyzeColumnKind(_columnName, sampleValues = []) {
    let nonEmpty = 0;
    let numeric = 0;
    let integerLike = 0;
    let currencyLike = 0;
    for (const value of sampleValues) {
        const text = normalizeCellText(value);
        if (!text) continue;
        nonEmpty += 1;
        const num = toNumberOrNull(text);
        if (num !== null) {
            numeric += 1;
            if (Number.isInteger(num)) integerLike += 1;
        }
        if (/[$€£¥]|,\d{3}\b/.test(text)) currencyLike += 1;
    }
    const numericRatio = nonEmpty > 0 ? (numeric / nonEmpty) : 0;
    const integerRatio = nonEmpty > 0 ? (integerLike / nonEmpty) : 0;
    const currencyRatio = nonEmpty > 0 ? (currencyLike / nonEmpty) : 0;
    const financialMetric = nonEmpty >= 5
        && (
            numericRatio >= 0.9
            || (numericRatio >= 0.75 && currencyRatio >= 0.25)
            || (numericRatio >= 0.85 && integerRatio >= 0.7)
        );
    return {
        nonEmpty,
        financialMetric,
        numericRatio,
        integerRatio,
        currencyRatio,
    };
}

function buildSheetColumnProfiles(rows = []) {
    const profiles = {};
    const sample = rows.slice(0, 500);
    const columns = new Set();
    sample.forEach((row) => {
        Object.keys(row || {}).forEach((key) => columns.add(key));
    });
    columns.forEach((col) => {
        const values = sample.map((row) => row?.[col]);
        profiles[col] = analyzeColumnKind(col, values);
    });
    return profiles;
}

function confidenceThresholdForType(type) {
    if (type === "phone") return 0.9;
    if (type === "credit_card") return 0.9;
    return 0.8;
}

function computeFindingConfidence({ type, value, token, columnName, columnProfile }) {
    let score = 1.0;
    const text = normalizeCellText(value);
    const profile = columnProfile || {};

    if (type === "phone") {
        const digits = (text.match(DIGITS_ONLY_PATTERN) || []).length;
        if (digits < 10) score -= 0.5;
        if (!PHONE_SEP_PATTERN.test(text)) score -= 0.35;
        if (profile.financialMetric) score -= 0.6;
    }

    if (type === "credit_card") {
        if (profile.financialMetric) score -= 0.5;
        if (String(token || "").replace(/\D/g, "").length < 13) score -= 0.4;
    }

    if (type === "email") {
        if (profile.financialMetric) score -= 0.4;
    }

    return Math.max(0, Math.min(1, score));
}

function shouldAcceptSparseSensitiveCandidate({ type, columnProfile, columnCandidateCount }) {
    if (type !== "phone" && type !== "credit_card") return true;
    const nonEmpty = Number(columnProfile?.nonEmpty || 0);
    if (columnCandidateCount >= 2) return true;
    if (nonEmpty >= 200) return columnCandidateCount / nonEmpty >= 0.015;
    if (nonEmpty >= 80) return columnCandidateCount / nonEmpty >= 0.025;
    return false;
}

function shouldAcceptFinding({ type, confidence, columnProfile }) {
    if ((type === "phone" || type === "credit_card") && columnProfile?.financialMetric) {
        return false;
    }
    return confidence >= confidenceThresholdForType(type);
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
    const candidateCountsBySheetColumnType = {};
    const pendingFindings = [];
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
    const candidateKey = (sheetName, columnName, type) => `${sheetName}::${columnName}::${type}`;
    const incrementCandidate = (sheetName, columnName, type) => {
        const key = candidateKey(sheetName, columnName, type);
        candidateCountsBySheetColumnType[key] = (candidateCountsBySheetColumnType[key] || 0) + 1;
    };
    const addPendingFinding = (finding) => {
        pendingFindings.push(finding);
    };

    for (const [sheetName, rows] of Object.entries(sheets || {})) {
        if (!Array.isArray(rows)) continue;
        const columnProfiles = buildSheetColumnProfiles(rows);
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
                const columnProfile = columnProfiles?.[columnName] || {};
                if (cfg.checkSsn) {
                    const ssnMatch = value.match(ssnPattern);
                    if (ssnMatch?.length) {
                        const confidence = computeFindingConfidence({ type: "ssn", value, token: ssnMatch[0], columnName, columnProfile });
                        if (!shouldAcceptFinding({ type: "ssn", confidence, columnProfile })) continue;
                        const finding = {
                            type: "ssn",
                            sheet: sheetName,
                            row: rowIndex + 1,
                            column: columnName,
                            sample: ssnMatch[0],
                            confidence,
                        };
                        addPendingFinding(finding);
                    }
                }
                if (cfg.checkCreditCard) {
                    const candidates = value.match(cardLikePattern) || [];
                    for (const token of candidates) {
                        if (validCreditCard.number(token).isValid) {
                            const confidence = computeFindingConfidence({ type: "credit_card", value, token, columnName, columnProfile });
                            if (!shouldAcceptFinding({ type: "credit_card", confidence, columnProfile })) continue;
                            incrementCandidate(sheetName, columnName, "credit_card");
                            const finding = {
                                type: "credit_card",
                                sheet: sheetName,
                                row: rowIndex + 1,
                                column: columnName,
                                sample: token,
                                confidence,
                            };
                            addPendingFinding(finding);
                            break;
                        }
                    }
                }
                if (cfg.checkEmail) {
                    const candidates = value.match(emailPattern) || [];
                    for (const token of candidates) {
                        if (isEmail(token)) {
                            const confidence = computeFindingConfidence({ type: "email", value, token, columnName, columnProfile });
                            if (!shouldAcceptFinding({ type: "email", confidence, columnProfile })) continue;
                            const finding = {
                                type: "email",
                                sheet: sheetName,
                                row: rowIndex + 1,
                                column: columnName,
                                sample: token,
                                confidence,
                            };
                            addPendingFinding(finding);
                            break;
                        }
                    }
                }
                if (cfg.checkPhone) {
                    const phoneMatches = findPhoneNumbersInText(value, "US");
                    if (phoneMatches.length > 0) {
                        const phoneToken = phoneMatches[0].number.number;
                        const confidence = computeFindingConfidence({ type: "phone", value, token: phoneToken, columnName, columnProfile });
                        if (!shouldAcceptFinding({ type: "phone", confidence, columnProfile })) continue;
                        incrementCandidate(sheetName, columnName, "phone");
                        const finding = {
                            type: "phone",
                            sheet: sheetName,
                            row: rowIndex + 1,
                            column: columnName,
                            sample: phoneToken,
                            confidence,
                        };
                        addPendingFinding(finding);
                    }
                }
                if (cfg.checkIban) {
                    const candidates = value.match(ibanPattern) || [];
                    for (const token of candidates) {
                        if (isIBAN(token)) {
                            const confidence = computeFindingConfidence({ type: "iban", value, token, columnName, columnProfile });
                            if (!shouldAcceptFinding({ type: "iban", confidence, columnProfile })) continue;
                            const finding = {
                                type: "iban",
                                sheet: sheetName,
                                row: rowIndex + 1,
                                column: columnName,
                                sample: token,
                                confidence,
                            };
                            addPendingFinding(finding);
                            break;
                        }
                    }
                }
            }
        }
    }
    const profileCache = {};
    for (const [sheetName, rows] of Object.entries(sheets || {})) {
        if (Array.isArray(rows)) profileCache[sheetName] = buildSheetColumnProfiles(rows);
    }
    for (const finding of pendingFindings) {
        const columnProfile = profileCache?.[finding.sheet]?.[finding.column] || {};
        const countKey = candidateKey(finding.sheet, finding.column, finding.type);
        const columnCandidateCount = candidateCountsBySheetColumnType[countKey] || 0;
        if (!shouldAcceptSparseSensitiveCandidate({ type: finding.type, columnProfile, columnCandidateCount })) {
            continue;
        }
        markMaskedCell(finding.sheet, finding.row, finding.column);
        const added = pushFinding(findings, finding, cfg.maxFindings);
        if (!added) {
            findingLimitReached = true;
            break;
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
