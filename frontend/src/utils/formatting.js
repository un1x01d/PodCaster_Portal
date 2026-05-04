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

// Helper for date formatting
export const renderMaybeDate = (columnName, value) => {
    if (value == null) return "";
    if (typeof value === "string" && value.endsWith("T00:00:00.000Z")) {
        return value.substring(0, value.indexOf("T"));
    }
    if (typeof value === "string" && ISO_FULL_RE.test(value)) return value.slice(0, 10);

    if (value !== "" && !isNaN(Number(value))) {
        return Number(value).toFixed(2);
    }
    return value;
};

// Helper to format numbers with currency detection (Smart Format)
export const formatSmart = (val, key = null) => {
    if (typeof val === 'number' && !isNaN(val)) {
        const isPercent = key && /(pct|percent|rate|ratio|%)/i.test(key);
        const isCurrency = !isPercent && key && /(price|cost|expense|income|budget|fee|amount|revenue|sales|total|value|profit|margin|ebitda|\$)/i.test(key);

        if (isPercent) {
            return new Intl.NumberFormat('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
                useGrouping: true,
            }).format(val) + '%';
        }

        const fmt = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: isCurrency ? 2 : 0,
            maximumFractionDigits: 2, // Standardize to 2 decimals max
            useGrouping: true,
        });
        return isCurrency ? `$${fmt.format(val)}` : fmt.format(val);
    }
    return val;
};
