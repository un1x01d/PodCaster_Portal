import React, { useState, useEffect, useRef } from 'react';

export default function SpreadsheetChatbot({ data, headers, onApplyFilter, allData, onUpdateChart }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [context, setContext] = useState({}); // Conversation memory
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Initialize with welcome message
    useEffect(() => {
        if (messages.length === 0 && headers.length > 0) {
            setMessages([{
                type: 'bot',
                text: `Hi! I can help you analyze your data. Try asking:\n• "What's the total ${headers.find(h => isNumericColumn(h)) || 'amount'}?"\n• "Show me rows from last year"\n• "Compare revenue by region"\n• "Trend of sales (average)"`,
                timestamp: new Date()
            }]);
        }
    }, [headers]);

    // Analyze column types
    const analyzeColumns = () => {
        const types = {};
        const sourceData = (allData && allData.length > 0) ? allData : data;

        headers.forEach(h => {
            const samples = sourceData.slice(0, 50).map(r => r[h]).filter(v => v != null && v !== '');
            const numericCount = samples.filter(v => {
                const clean = String(v).replace(/[$,%]/g, '');
                return !isNaN(Number(clean)) && clean.trim() !== '';
            }).length;
            const dateCount = samples.filter(v => !isNaN(Date.parse(v))).length;

            if (samples.length > 0 && numericCount > samples.length * 0.8) types[h] = 'number';
            else if (samples.length > 0 && dateCount > samples.length * 0.8) types[h] = 'date';
            else types[h] = 'text';
        });
        return types;
    };

    const isNumericColumn = (col) => {
        const types = analyzeColumns();
        return types[col] === 'number';
    };

    const isDateColumn = (col) => {
        const types = analyzeColumns();
        return types[col] === 'date';
    };

    // Helper to format values for display (fixes T00:00:00.000Z issue)
    const formatValue = (val) => {
        if (typeof val !== 'string') return String(val ?? '');
        // Strip ISO time suffix
        if (val.includes('T00:00:00.000Z')) {
            return val.split('T')[0];
        }
        // Try strict ISO date regex
        if (/^\d{4}-\d{2}-\d{2}T/.test(val)) {
            return val.split('T')[0];
        }
        return val;
    };

    // Fuzzy match column name
    const findColumn = (query) => {
        const q = query.toLowerCase().replace(/[_\s-]/g, '');
        return headers.find(h => {
            const normalized = h.toLowerCase().replace(/[_\s-]/g, '');
            return normalized.includes(q) || q.includes(normalized);
        });
    };

    // Parse date expressions
    const parseDateRanges = (expr) => {
        const ranges = [];
        const now = new Date();
        const currentYear = now.getFullYear();
        const q = expr.toLowerCase();

        // Helper to add unique range
        const add = (start, end, label) => {
            if (!ranges.some(r => r.start.getTime() === start.getTime() && r.end.getTime() === end.getTime())) {
                ranges.push({ start, end, label });
            }
        };

        // 1. "Last Year" / "This Year"
        if (q.includes('last year') || q.includes('previous year')) {
            add(new Date(currentYear - 1, 0, 1), new Date(currentYear - 1, 11, 31), 'Last Year');
        }
        if (q.includes('this year')) {
            add(new Date(currentYear, 0, 1), new Date(currentYear, 11, 31), 'This Year');
        }

        // 2. Explicit Years (2021, 2022)
        const years = [...q.matchAll(/\b(20\d{2})\b/g)];
        years.forEach(m => {
            const y = parseInt(m[1]);
            add(new Date(y, 0, 1), new Date(y, 11, 31), `${y}`);
        });

        // 3. Short Years (21 vs 22) - conservative check
        const shortYears = [...q.matchAll(/\b(\d{2}) vs (\d{2})\b/g)];
        shortYears.forEach(m => {
            const y1 = 2000 + parseInt(m[1]);
            const y2 = 2000 + parseInt(m[2]);
            add(new Date(y1, 0, 1), new Date(y1, 11, 31), `${y1}`);
            add(new Date(y2, 0, 1), new Date(y2, 11, 31), `${y2}`);
        });

        // 4. Months (Month Year or just Month)
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
            'july', 'august', 'september', 'october', 'november', 'december'];

        // Regex for "Month Year" (e.g. Jan 2021)
        const monthYearRegex = new RegExp(`(${monthNames.join('|')})\\s*(\\d{4})`, 'gi');
        const monthYearMatches = [...q.matchAll(monthYearRegex)];
        monthYearMatches.forEach(m => {
            const mIdx = monthNames.indexOf(m[1].toLowerCase());
            const y = parseInt(m[2]);
            add(new Date(y, mIdx, 1), new Date(y, mIdx + 1, 0), `${m[1]} ${y}`);
        });

        // Regex for relative months
        if (q.includes('last month')) {
            const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            add(d, new Date(now.getFullYear(), now.getMonth(), 0), 'Last Month');
        }
        if (q.includes('this month')) {
            const d = new Date(now.getFullYear(), now.getMonth(), 1);
            add(d, new Date(now.getFullYear(), now.getMonth() + 1, 0), 'This Month');
        }

        return ranges.sort((a, b) => a.start - b.start);
    };

    // Parse query with enhanced natural language understanding
    const parseQuery = (query) => {
        const q = query.toLowerCase();
        const sourceData = (allData && allData.length > 0) ? allData : data;
        let operation = 'FILTER'; // Default
        let aggregation = 'none';

        // Parse date ranges early
        const dateRanges = parseDateRanges(q);
        const dateRange = dateRanges.length > 0 ? dateRanges[0] : null;
        let segmentBy = null;

        // Detect Aggregation Type
        if (q.match(/average|avg|mean|typical/)) aggregation = 'avg';
        else if (q.match(/count|how many/)) aggregation = 'count';

        // Detect Operation
        if (q.match(/^(?:for\s+)?(?:which|what)\s+(?:year|month|day|date|time|period)(?:\?|$)/) && !q.match(/(?:highest|lowest|most|least|best|worst|had|have|was|were)/)) {
            operation = 'QUESTION';
        }
        else if (q.match(/(?:reset|clear|remove|delete)\s+(?:all\s+)?filters?/)) operation = 'RESET_FILTER';
        else if (q.match(/(?:draw|plot|chart|graph|visualize|trend|see\s+trend)/)) operation = 'CHART';
        else if (q.match(/(?:apply|set|add|use)\s+filt[a-z]*|^filter\s+by/)) operation = 'APPLY_FILTER';
        else if (q.match(/(?:compare|difference|change|vs|versus|better|worse|increase|decrease|growth|drop|rose|fell)/)) operation = 'COMPARE'; // Could be text compare or chart compare
        else if (q.match(/total|sum|amount of|how much/)) operation = 'SUM';
        // "How many [column]" -> SUM if numeric, else COUNT
        else if (q.match(/how many\s+(\w+)/)) {
            const potentialColumn = q.match(/how many\s+(\w+)/)[1];
            const matchedColumn = headers.find(h => h.toLowerCase().includes(potentialColumn.toLowerCase()));
            const types = analyzeColumns();
            if (matchedColumn && types[matchedColumn] === 'number') operation = 'SUM';
            else operation = 'COUNT';
        }
        else if (q.match(/average|avg|mean|typical/)) operation = 'AVG';
        else if (q.match(/count|number of|how many.*rows/)) operation = 'COUNT';
        else if (q.match(/max|highest|maximum|most|largest|top|best/)) operation = 'MAX';
        else if (q.match(/min|lowest|minimum|least|worst|bottom/)) operation = 'MIN';
        else if (q.match(/show|find|list|view|only|just|where|contains?|filter/)) operation = 'FILTER';

        // Find primary column
        let column = null;
        const candidates = [];

        // 1. Direct Header Matches
        const sortedHeaders = [...headers].sort((a, b) => b.length - a.length);
        for (const h of sortedHeaders) {
            if (q.includes(h.toLowerCase())) {
                candidates.push({ col: h, type: 'direct' });
            }
        }

        // 2. Dictionary Matches
        const dictionary = {
            'revenue': ['revenue', 'sales', 'income', 'turnover', 'gross', 'amount', 'total', 'valuable'],
            'profit': ['profit', 'net income', 'earnings', 'gain', 'margin', 'surplus', 'bottom line', 'profitable'],
            'cost': ['cost', 'expense', 'spending', 'cogs', 'expenditure', 'fee', 'charge', 'overhead', 'expensive', 'costly'],
            'date': ['date', 'time', 'year', 'month', 'day', 'period', 'when'],
            'customer': ['customer', 'client', 'buyer', 'purchaser', 'account', 'company'],
            'product': ['product', 'item', 'goods', 'service', 'sku', 'commodity'],
            'region': ['region', 'location', 'area', 'country', 'state', 'zone', 'city', 'territory']
        };

        for (const [key, synonyms] of Object.entries(dictionary)) {
            if (synonyms.some(s => q.includes(s))) {
                const match = headers.find(h => synonyms.some(s => h.toLowerCase().includes(s)));
                if (match && !candidates.some(c => c.col === match)) {
                    candidates.push({ col: match, type: 'dictionary', keyword: key });
                }
            }
        }

        // 3. Fallback: Generic numeric for "how much"
        if (candidates.length === 0 && q.match(/how much|what.*make|money/)) {
            const types = analyzeColumns();
            const numericCols = headers.filter(h => types[h] === 'number');
            if (numericCols.length > 0) candidates.push({ col: numericCols[0], type: 'inference' });
        }

        // Select Best Candidate
        if (candidates.length > 0) {
            // Helper to detect ratio/percentage columns
            const isRatio = (name) => /%|percent|margin|rate|ratio/i.test(name);

            // Priority 1: If operation implies usage (Math -> Numeric)
            if (['SUM', 'AVG', 'MAX', 'MIN', 'COMPARE', 'CHART'].includes(operation)) {

                // Filter for numeric columns first
                let numericCandidates = candidates.filter(c => isNumericColumn(c.col));

                // Refinement: If looking for financial metrics (profit, revenue, cost), prefer "Amounts" over "Ratios"
                // e.g. "Gross Profit" > "Profit Margin %"
                const financialKeywords = ['profit', 'revenue', 'cost'];
                const hasFinancialIntent = candidates.some(c => c.keyword && financialKeywords.includes(c.keyword));

                if (hasFinancialIntent && numericCandidates.length > 1) {
                    const amountCandidates = numericCandidates.filter(c => !isRatio(c.col));
                    if (amountCandidates.length > 0) {
                        numericCandidates = amountCandidates;
                    }
                }

                if (numericCandidates.length > 0) {
                    // Pick the shortest one? Or the one that matches best?
                    // Usually shortest is the "main" column (Profit vs Gross Profit vs Profit Margin)
                    // Sort by length ASC to pick "Profit" over "Gross Profit" if both are valid amounts? 
                    // Or "Gross Profit" (12) vs "Profit" (6).
                    // But in user case: "Gross Profit" (12) vs "Profit Margin %" (15).
                    // We filtered Margin %.
                    // We have "Gross Profit".
                    // Pick the first remaining.
                    column = numericCandidates[0].col;
                }
            }

            // Priority 2: Direct match if no numeric requirement or no numeric found
            if (!column) {
                const direct = candidates.find(c => c.type === 'direct');
                if (direct) column = direct.col;
            }

            // Priority 3: First available
            if (!column) column = candidates[0].col;
        }

        // Context Fallback (if still null)
        if (!column && context.lastColumn) column = context.lastColumn;

        if (dateRange && column && isDateColumn(column)) column = null;


        // ---------------- Filter Parsing (Implicit & Explicit) ----------------
        let filter = null;

        // 1. Explicit Syntax: Column = Value | Column : Value | Column is Value
        if (!filter && column) {
            // Regex to match "Column = Value" or "Column is Value"
            const colName = column.toLowerCase();
            const escCol = colName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            // Allow optional "filter by" prefix
            const regex = new RegExp(`(?:filter\\s+by\\s+)?${escCol}\\s*(?:=|is|:|in)\\s+(.+?)(?:$|\\s+(?:and|or|with|using))`, 'i');
            const match = q.match(regex);
            if (match) {
                const val = match[1].trim();
                // Validate this value exists in source data to be sure
                if (val.length > 0) {
                    // Try strict match first
                    if (sourceData.some(r => String(r[column]).toLowerCase().includes(val))) {
                        filter = { column: column, value: val };
                    }
                }
            }
        }

        // 2. Pattern: "from X" or "for X"
        if (!filter && !filter) {
            const match = q.match(/(?:from|for|in|at|by)\s+(.+?)(?:\s+in\s+|\s+for\s+|\s+at\s+|\s+by\s+|\?|$)/);
            if (match) {
                const val = match[1].trim();
                // Exclude date keywords
                if (!['last year', 'this year', '2020', '2021', '2022', 'compare', 'trend'].some(d => val.includes(d))) {
                    // Search all columns for this value
                    for (const h of headers) {
                        // simple check
                        if (sourceData.some(r => String(r[h]).toLowerCase().includes(val))) {
                            filter = { column: h, value: val };
                            break;
                        }
                    }
                }
            }
        }

        // 3. Implicit Filter (Value only, very aggressive search)
        if (!filter && !q.match(/^(?:compare|show|what|how)/)) {
            // If query is just a word or phrase, try to find it as a value in ANY column
            let cleanQuery = q.replace(/[?.,!]/g, '').trim();
            // Remove common start verbs
            cleanQuery = cleanQuery.replace(/^(?:match|search|find|get|filter|by|only|just|show|me)\s+/, '').trim();

            if (cleanQuery.length > 1) {
                // Find longest value match? Or just any match.
                // Prefer columns with EXACT match
                let bestMatch = null;

                for (const h of headers) {
                    const hasExact = sourceData.some(r => String(r[h]).toLowerCase() === cleanQuery);
                    if (hasExact) {
                        bestMatch = { column: h, value: cleanQuery };
                        break; // strict match priority
                    }
                    const hasPartial = sourceData.some(r => String(r[h]).toLowerCase().includes(cleanQuery));
                    if (hasPartial && !bestMatch) {
                        bestMatch = { column: h, value: cleanQuery };
                    }
                }

                if (bestMatch) {
                    filter = bestMatch;
                    if (operation === 'UNKNOWN') operation = 'APPLY_FILTER';
                }
            }
        }

        // 4. Residual Search (if column known but value separate)
        if (!filter && column) {
            let residual = q.replace(column.toLowerCase(), '').replace(/show|me|calculate|find|what|is|how|many|total|sum|average|avg|filter|by/g, '').trim();
            // remove symbols
            residual = residual.replace(/[=:]/g, ' ').trim();

            if (residual.length > 1) {
                if (sourceData.some(r => String(r[column]).toLowerCase().includes(residual))) {
                    filter = { column: column, value: residual };
                    if (operation === 'UNKNOWN') operation = 'APPLY_FILTER';
                }
            }
        }

        // Chart override: If Compare intent + segmentBy, it becomes a CHART operation usually
        if ((operation === 'COMPARE' || q.includes('trend')) && segmentBy) {
            operation = 'CHART';
        }

        return { operation, column, dateRange, dateRanges, filter, segmentBy, aggregation };
    };

    // Execute query
    const executeQuery = (parsed) => {
        try {
            const isCurrencyColumn = (colName) => /revenue|profit|sales|amount|price|cost|income|expense/i.test(colName);
            const formatNumber = (num, colName) => {
                const formatted = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return isCurrencyColumn(colName) ? `$${formatted}` : formatted;
            };

            let result = [...data];

            // Handle CHART intent
            if (parsed.operation === 'CHART') {
                if (onUpdateChart) {
                    const dateCol = headers.find(h => isDateColumn(h));
                    onUpdateChart({
                        visible: true,
                        dateColumn: dateCol, // auto-detect date
                        valueColumn: parsed.column, // auto-detect value or explicitly strictly requested
                        segmentBy: parsed.segmentBy,
                        aggregation: parsed.aggregation
                    });

                    let msg = `📈 Generating chart`;
                    if (parsed.column) msg += ` for ${parsed.column}`;
                    if (parsed.segmentBy) msg += `, comparing by ${parsed.segmentBy}`;
                    if (parsed.aggregation === 'avg') msg += ` (Average)`;
                    return msg + '.';
                }
                return "I can't open the chart because the controls aren't connected.";
            }

            // Handle COMPARE (Text based)
            if (parsed.operation === 'COMPARE') {
                // If it wasn't picked up as a chart compare, maybe it's date compare
                if (parsed.dateRanges.length < 2) return "Please specify two time periods to compare (e.g., '2021 vs 2022').";

                const r1 = parsed.dateRanges[0];
                const r2 = parsed.dateRanges[1];
                const dateCol = headers.find(h => isDateColumn(h));
                if (!dateCol) return "I can't compare time periods because I couldn't find a Date column.";
                if (!parsed.column) return "What would you like to compare? (e.g., 'compare revenue 2021 vs 2022')";

                const getDataForRange = (range) => data.filter(r => {
                    const d = new Date(r[dateCol]);
                    return d >= range.start && d <= range.end;
                });

                const data1 = getDataForRange(r1);
                const data2 = getDataForRange(r2);

                const getVal = (d) => d.reduce((acc, row) => acc + (Number(row[parsed.column]) || 0), 0);
                const val1 = getVal(data1);
                const val2 = getVal(data2);

                const change = val2 - val1;
                const pctChange = val1 !== 0 ? (change / val1) * 100 : 0;
                const direction = change >= 0 ? 'increased' : 'decreased';
                const emoji = change >= 0 ? '📈' : '📉';

                return `Comparison of ${parsed.column}:\n\n• ${r1.label}: ${formatNumber(val1, parsed.column)}\n• ${r2.label}: ${formatNumber(val2, parsed.column)}\n\n${emoji} Did it go up? Yes, it ${direction} by ${formatNumber(Math.abs(change), parsed.column)} (${Math.abs(pctChange).toFixed(1)}%) from ${r1.label} to ${r2.label}.`;
            }

            // Apply date filter
            if (parsed.dateRange) {
                const dateCol = headers.find(h => isDateColumn(h));
                if (dateCol) {
                    result = result.filter(row => {
                        const rowDate = new Date(row[dateCol]);
                        return rowDate >= parsed.dateRange.start && rowDate <= parsed.dateRange.end;
                    });
                }
            }

            // Execute operation
            switch (parsed.operation) {
                case 'SUM':
                    if (!parsed.column) return 'Please specify which column to sum.';
                    if (!isNumericColumn(parsed.column)) return `I can't calculate the sum of "${parsed.column}" because it contains text, not numbers. Did you mean to count?`;
                    const sum = result.reduce((acc, row) => acc + (Number(row[parsed.column]) || 0), 0);
                    return `Total ${parsed.column}: ${formatNumber(sum, parsed.column)}\n(Based on ${result.length} rows)`;

                case 'AVG':
                    if (!parsed.column) return 'Please specify which column to average.';
                    if (!isNumericColumn(parsed.column)) return `I can't calculate the average of "${parsed.column}" because it contains text.`;
                    const avg = result.reduce((acc, row) => acc + (Number(row[parsed.column]) || 0), 0) / result.length;
                    return `Average ${parsed.column}: ${formatNumber(avg, parsed.column)}\n(Based on ${result.length} rows)`;

                case 'COUNT':
                    return `Count: ${result.length} rows`;

                case 'MAX':
                    if (!parsed.column) return 'Please specify which column to find maximum.';
                    if (!result.length) return "No data available.";

                    // Find row with max value
                    let maxVal = -Infinity;
                    let maxRow = null;
                    result.forEach(row => {
                        const val = Number(row[parsed.column]);
                        if (!isNaN(val) && val > maxVal) {
                            maxVal = val;
                            maxRow = row;
                        }
                    });

                    if (!maxRow) return `Could not find a maximum value for "${parsed.column}".`;
                    setContext(prev => ({ ...prev, lastResultRow: maxRow })); // Store for follow-up

                    // Find a label column to provide context
                    let maxLabel = '';
                    const labelCol = headers.find(h => h.toLowerCase().includes('month') || h.toLowerCase().includes('date') || h.toLowerCase().includes('name') || !isNumericColumn(h));
                    if (labelCol && labelCol !== parsed.column) {
                        maxLabel = `\n(${labelCol}: ${formatValue(maxRow[labelCol])})`;
                    }

                    return `Maximum ${parsed.column}: ${formatNumber(maxVal, parsed.column)}${maxLabel}`;

                case 'MIN':
                    if (!parsed.column) return 'Please specify which column to find minimum.';
                    if (!result.length) return "No data available.";

                    let minVal = Infinity;
                    let minRow = null;
                    result.forEach(row => {
                        const val = Number(row[parsed.column]);
                        if (!isNaN(val) && val < minVal) {
                            minVal = val;
                            minRow = row;
                        }
                    });

                    if (!minRow) return `Could not find a minimum value for "${parsed.column}".`;
                    setContext(prev => ({ ...prev, lastResultRow: minRow })); // Store for follow-up

                    let minLabel = '';
                    const minLabelCol = headers.find(h => h.toLowerCase().includes('month') || h.toLowerCase().includes('date') || h.toLowerCase().includes('name') || !isNumericColumn(h));
                    if (minLabelCol && minLabelCol !== parsed.column) {
                        minLabel = `\n(${minLabelCol}: ${formatValue(minRow[minLabelCol])})`;
                    }

                    return `Minimum ${parsed.column}: ${formatNumber(minVal, parsed.column)}${minLabel}`;

                case 'FILTER':
                    return `Found ${result.length} matching rows.\n\nFirst 5 rows:\n${result.slice(0, 5).map((row, i) =>
                        `${i + 1}. ${Object.entries(row).slice(0, 3).map(([k, v]) => `${k}: ${formatValue(v)}`).join(', ')}`
                    ).join('\n')}`;

                case 'QUESTION':
                    if (context.lastDateRange) {
                        const { start, end } = context.lastDateRange;
                        return `The previous query was for data from ${start.toLocaleDateString()} to ${end.toLocaleDateString()}.`;
                    } else {
                        return `The previous query used all available data (no date filter applied).`;
                    }

                default:
                    return "I'm not sure how to help with that. Try asking about totals, averages, counts, or filtering data.";
            }
        } catch (error) {
            return `Sorry, I encountered an error: ${error.message}`;
        }
    };

    const handleSend = () => {
        if (!input.trim()) return;

        // Add user message
        const userMessage = { type: 'user', text: input, timestamp: new Date() };
        setMessages(prev => [...prev, userMessage]);

        try {
            // Check if user is responding to a pending filter confirmation
            if (context.pendingFilter) {
                const { column, matchingValues } = context.pendingFilter;
                const userInput = input.trim().toLowerCase();

                // Check if user said "yes" or "all" to apply all values
                if (userInput === 'yes' || userInput === 'all' || userInput === 'apply filter') {
                    const filters = { ...context.activeFilters }; // Preserve existing
                    filters[column] = matchingValues;
                    onApplyFilter(filters);
                    setContext(prev => ({ ...prev, activeFilters: filters, pendingFilter: null }));

                    const botMessage = {
                        type: 'bot',
                        text: `✅ Applied filter to table!\n\n${column}: ${matchingValues.length} values\nShowing ${data.filter(row => matchingValues.includes(String(row[column]))).length} rows`,
                        timestamp: new Date()
                    };
                    setMessages(prev => [...prev, botMessage]);
                    setInput('');
                    return;
                }

                // Check if user provided an exact value from the list
                const exactMatch = matchingValues.find(v => v.toLowerCase() === userInput || formatValue(v).toLowerCase() === userInput);
                if (exactMatch) {
                    const filters = { ...context.activeFilters };
                    filters[column] = [exactMatch];
                    onApplyFilter(filters);
                    setContext(prev => ({ ...prev, activeFilters: filters, pendingFilter: null }));

                    const botMessage = {
                        type: 'bot',
                        text: `✅ Applied filter to table!\n\n${column}: "${formatValue(exactMatch)}"\nShowing ${data.filter(row => String(row[column]) === exactMatch).length} rows`,
                        timestamp: new Date()
                    };
                    setMessages(prev => [...prev, botMessage]);
                    setInput('');
                    return;
                }

                // If no match, clear pending filter and continue with normal parsing
                setContext(prev => ({ ...prev, pendingFilter: null }));
            }

            // Parse and execute query
            const parsed = parseQuery(input);

            // Contextual Follow-up: "Which customer?" -> Return value from lastResultRow
            if (context.lastResultRow && parsed.column && (!parsed.operation || parsed.operation === 'FILTER' || parsed.operation === 'UNKNOWN')) {
                // If it looks like a simple column inquiry
                // Check if the query is asking about this column
                // Or if parsed.column matches the query (it should)
                const val = context.lastResultRow[parsed.column];
                const botMessage = {
                    type: 'bot',
                    text: `${parsed.column}: ${formatValue(val)}`,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, botMessage]);
                setInput('');
                return;
            }

            // If no operation detected but we have context, try to reuse previous operation
            if (parsed.operation === 'UNKNOWN' && context.lastOperation) {
                parsed.operation = context.lastOperation;
            }
            if (!parsed.column && context.lastColumn) {
                parsed.column = context.lastColumn;
            }

            // Update context
            if (parsed.column) setContext(prev => ({ ...prev, lastColumn: parsed.column }));
            if (parsed.operation && parsed.operation !== 'UNKNOWN') setContext(prev => ({ ...prev, lastOperation: parsed.operation }));

            // For RESET_FILTER operations, clear all filters
            if (parsed.operation === 'RESET_FILTER' && onApplyFilter) {
                onApplyFilter({});
                setContext(prev => ({ ...prev, activeFilters: {} }));
                setMessages(prev => [...prev, { type: 'bot', text: '✅ All filters cleared!\n\nShowing all data.', timestamp: new Date() }]);
                setInput('');
                return;
            }

            // For APPLY_FILTER operations
            if ((parsed.operation === 'FILTER' || parsed.operation === 'APPLY_FILTER') && onApplyFilter) {
                if (!parsed.filter) {
                    const botMessage = { type: 'bot', text: '🤔 I couldn\'t understand what to filter. Try "Region = West" or "Show me Completed".', timestamp: new Date() };
                    setMessages(prev => [...prev, botMessage]);
                    setInput('');
                    return;
                }

                const matchingValues = [...new Set(
                    ((allData && allData.length > 0) ? allData : data)
                        .filter(row => String(row[parsed.filter.column]).toLowerCase().includes(parsed.filter.value.toLowerCase()))
                        .map(row => String(row[parsed.filter.column]))
                )];

                if (matchingValues.length === 0) {
                    setMessages(prev => [...prev, { type: 'bot', text: `❌ No values found matching "${parsed.filter.value}" in column "${parsed.filter.column}"`, timestamp: new Date() }]);
                    setInput('');
                    return;
                }

                // Multiple matches?
                if (matchingValues.length > 1) {
                    setContext(prev => ({
                        ...prev,
                        pendingFilter: { column: parsed.filter.column, matchingValues: matchingValues }
                    }));

                    const botMessage = {
                        type: 'bot',
                        text: `🤔 "${parsed.filter.value}" matches ${matchingValues.length} values in ${parsed.filter.column}:\n\n${matchingValues.slice(0, 10).map((v, i) => `${i + 1}. ${formatValue(v)}`).join('\n')}${matchingValues.length > 10 ? '\n...' : ''}\n\nDid you mean:\n• All of these? (Type "yes" or "all")\n• Just one? (Type the exact value)`,
                        timestamp: new Date()
                    };
                    setMessages(prev => [...prev, botMessage]);
                    setInput('');
                    return;
                }

                // Precise Application (Cumulative)
                const currentFilters = context.activeFilters || {};
                const potentialFilters = { ...currentFilters };
                potentialFilters[parsed.filter.column] = matchingValues;

                // Test if this results in empty set
                // We don't have easy access to filter logic here without replicating App.jsx logic
                // But we can check against allData
                const finalSet = ((allData && allData.length > 0) ? allData : data).filter(row => {
                    return Object.entries(potentialFilters).every(([col, vals]) => {
                        const cell = String(row[col]);
                        return vals.includes(cell);
                    });
                });

                let finalFilters = {};
                let message = '';

                if (finalSet.length > 0) {
                    // Cumulative success
                    finalFilters = potentialFilters;
                    message = `✅ Added filter! ${parsed.filter.column}: "${formatValue(matchingValues[0])}"\n(Combined with previous filters)\nShowing ${finalSet.length} rows`;
                } else {
                    // Conflict -> Auto Reset
                    finalFilters = {};
                    finalFilters[parsed.filter.column] = matchingValues;
                    const count = ((allData && allData.length > 0) ? allData : data).filter(row => matchingValues.includes(String(row[parsed.filter.column]))).length;
                    message = `🔄 No rows found with combined filters. Resetting view.\n\nFiltering only by ${parsed.filter.column}: "${formatValue(matchingValues[0])}"\nShowing ${count} rows`;
                }

                onApplyFilter(finalFilters);
                setContext(prev => ({ ...prev, activeFilters: finalFilters }));
                setMessages(prev => [...prev, { type: 'bot', text: message, timestamp: new Date() }]);
                setInput('');
                return;
            }

            // Standard response
            const responseText = executeQuery(parsed);
            const botMessage = { type: 'bot', text: responseText, timestamp: new Date() };
            setMessages(prev => [...prev, botMessage]);

        } catch (error) {
            console.error('Chatbot error:', error);
            const botMessage = { type: 'bot', text: `❌ Error: ${error.message}`, timestamp: new Date() };
            setMessages(prev => [...prev, botMessage]);
        }
        setInput('');
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    if (!data || data.length === 0) return null;

    return (
        <>
            {/* Floating Chat Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-full p-4 shadow-lg hover:shadow-xl transition-all z-40 flex items-center gap-2"
                >
                    <span className="text-2xl">💬</span>
                    <span className="font-semibold">Ask Me</span>
                </button>
            )}

            {/* Chat Panel */}
            {isOpen && (
                <div className={`fixed bottom-6 right-6 w-96 ${isMinimized ? 'h-auto' : 'h-[600px]'} bg-white rounded-xl shadow-2xl flex flex-col z-40 border border-gray-200`}>
                    {/* Header */}
                    <div className="bg-gradient-to-r from-cyan-600 to-teal-600 text-white p-4 rounded-t-xl flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">📊</span>
                            <span className="font-bold">Data Assistant</span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setIsMinimized(!isMinimized)}
                                className="text-white hover:bg-white/20 rounded-full w-8 h-8 flex items-center justify-center text-xl"
                                title={isMinimized ? "Maximize" : "Minimize"}
                            >
                                {isMinimized ? '□' : '−'}
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-white hover:bg-white/20 rounded-full w-8 h-8 flex items-center justify-center"
                                title="Close"
                            >
                                ×
                            </button>
                        </div>
                    </div>

                    {/* Messages - only show when not minimized */}
                    {!isMinimized && (
                        <>
                            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                {messages.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[80%] rounded-lg p-3 ${msg.type === 'user'
                                            ? 'bg-gradient-to-r from-teal-600 to-cyan-600 text-white'
                                            : 'bg-gray-100 text-gray-800'
                                            }`}>
                                            <div className="text-sm whitespace-pre-wrap">{msg.text}</div>
                                        </div>
                                    </div>
                                ))}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input */}
                            <div className="p-4 border-t border-gray-200">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyPress={handleKeyPress}
                                        placeholder="Ask about your data..."
                                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    />
                                    <button
                                        onClick={handleSend}
                                        className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white px-4 py-2 rounded-lg hover:from-teal-500 hover:to-cyan-500 transition-colors"
                                    >
                                        Send
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </>
    );
}
