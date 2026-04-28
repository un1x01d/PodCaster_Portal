// Chatbot Logic Utilities

export const analyzeColumns = (headers, sourceData) => {
    const types = {};
    headers.forEach(h => {
        const samples = sourceData.slice(0, 50).map(r => r[h]).filter(v => v != null && v !== '');
        const numericCount = samples.filter(v => {
            const clean = String(v).replace(/[$,%]/g, '');
            return !isNaN(Number(clean)) && clean.trim() !== '';
        }).length;
        const excelDateCount = samples.filter(v => {
            const n = Number(v);
            return !isNaN(n) && n > 35000 && n < 60000;
        }).length;
        const dateCount = samples.filter(v => !isNaN(Date.parse(v))).length;

        if (samples.length > 0 && excelDateCount > samples.length * 0.8) types[h] = 'date';
        else if (samples.length > 0 && numericCount > samples.length * 0.8) types[h] = 'number';
        else if (samples.length > 0 && dateCount > samples.length * 0.8) types[h] = 'date';
        else types[h] = 'text';
    });
    return types;
};

export const isNumericColumn = (col, headers, sourceData) => {
    const types = analyzeColumns(headers, sourceData);
    return types[col] === 'number';
};

export const isDateColumn = (col, headers, sourceData) => {
    const types = analyzeColumns(headers, sourceData);
    return types[col] === 'date';
};

export const formatValue = (val, colName = null, headers = [], sourceData = []) => {
    if (val === null || val === undefined) return '';
    const num = Number(val);
    if (!isNaN(num) && String(val).trim() !== '') {
        if (num > 35000 && num < 60000 && colName && isDateColumn(colName, headers, sourceData)) {
             // date serial, leave for specialized handler or fallthrough
        } else {
            const isCurrency = colName && /revenue|profit|sales|amount|price|cost|income|expense/i.test(colName) && !/%|percent|margin|rate|ratio/i.test(colName);
            const isPercent = colName && /%|percent|margin|rate|ratio/i.test(colName);
            if (isCurrency) return num.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
            if (isPercent) return num.toLocaleString(undefined, { style: 'percent', minimumFractionDigits: 1 });
            return num.toLocaleString();
        }
    }
    const strVal = String(val);
    if (strVal.includes('T00:00:00.000Z')) return strVal.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}T/.test(strVal)) return strVal.split('T')[0];
    return strVal;
};

export const excelDateToJSDate = (serial) => {
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    return new Date(utc_value * 1000);
};

export const parseDateRanges = (expr) => {
    const ranges = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const q = expr.toLowerCase();
    const add = (start, end, label) => {
        if (!ranges.some(r => r.start.getTime() === start.getTime() && r.end.getTime() === end.getTime())) {
            ranges.push({ start, end, label });
        }
    };
    if (q.includes('last year') || q.includes('previous year')) add(new Date(currentYear - 1, 0, 1), new Date(currentYear - 1, 11, 31), 'Last Year');
    if (q.includes('this year')) add(new Date(currentYear, 0, 1), new Date(currentYear, 11, 31), 'This Year');
    
    const years = [...q.matchAll(/\b(20\d{2})\b/g)];
    years.forEach(m => {
        const y = parseInt(m[1]);
        add(new Date(y, 0, 1), new Date(y, 11, 31), `${y}`);
    });

    return ranges.sort((a, b) => a.start - b.start);
};
