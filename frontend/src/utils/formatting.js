// Helper for date formatting
export const renderMaybeDate = (columnName, value) => {
    if (value == null) return "";
    if (typeof value === "string" && value.endsWith("T00:00:00.000Z")) {
        return value.substring(0, value.indexOf("T"));
    }
    const ISO_FULL_RE = /^\d{4}-\d{2}-\d{2}T/;
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
        const isCurrency = !isPercent && key && /(price|cost|expense|income|budget|fee|amount|revenue|sales|total|value|profit|margin|\$)/i.test(key);

        if (isPercent) {
            return new Intl.NumberFormat('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }).format(val) + '%';
        }

        const fmt = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: isCurrency ? 2 : 0,
            maximumFractionDigits: 2, // Standardize to 2 decimals max
        });
        return isCurrency ? `$${fmt.format(val)}` : fmt.format(val);
    }
    return val;
};
