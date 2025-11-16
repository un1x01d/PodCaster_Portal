// frontend/src/utils.js
/* ---- Date helpers (force YYYY-MM-DD) ---- */
const ISO_START_RE = /^\d{4}-\d{2}-\d{2}/;
const ISO_FULL_RE = /^\d{4}-\d{2}-\d{2}T/;

export const fmtDateOnly = (v) => {
  if (v == null) return "";
  if (typeof v === "string") {
    const m = v.match(ISO_START_RE);
    if (m) return m[0];
  }
  const dt = new Date(v);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const DATE_COL_HINTS = ["date", "uploaded", "created", "updated", "timestamp"];
export const looksLikeDateColumn = (h = "") =>
  DATE_COL_HINTS.some((k) => h.toLowerCase().includes(k));

export const renderMaybeDate = (columnName, value) => {
  if (value == null) return "";
  if (typeof value === "string" && ISO_FULL_RE.test(value)) return fmtDateOnly(value);
  if (looksLikeDateColumn(columnName)) {
    const d = fmtDateOnly(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  }
  return value;
};