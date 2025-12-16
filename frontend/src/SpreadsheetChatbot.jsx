import React, { useState, useEffect, useRef } from 'react';

export default function SpreadsheetChatbot({ sheetId, activeFilename, myFiles, onSwitchSheet, data, headers, onApplyFilter, allData, onUpdateChart, activeFilters = {} }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [context, setContext] = useState({}); // Conversation memory
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };






    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Initialize with welcome message
    useEffect(() => {
        if (messages.length === 0 && headers.length > 0) {
            // Generate dynamic prompts based on headers
            const getPrompts = () => {
                const prompts = [];
                const h = (name) => headers.find(hdr => hdr.toLowerCase().includes(name));
                const metric = h('gross profit') || h('revenue') || h('profit') || h('amount') || h('cost') || h('units');
                const dimension = h('region') || h('department') || h('customer') || h('product') || h('vendor');
                const date = h('date') || h('year') || h('month');

                if (metric) prompts.push(`"What is the total ${metric}?"`);
                if (metric && dimension) prompts.push(`"Which ${dimension} is the most profitable?"`); // Uses our new 'profitable' logic
                if (metric) prompts.push(`"Top 5 ${metric}"`);
                if (dimension) prompts.push(`"How many unique ${dimension}?"`);
                if (metric && date) prompts.push(`"Trend of ${metric} (average)"`);
                if (dimension) prompts.push(`"Filter by ${dimension}..."`);
                if (metric && date) prompts.push(`"Compare ${metric} 2023 vs 2024"`);

                return prompts.length > 0 ? prompts : ['"Show me all data"', '"Count rows"'];
            };

            const suggestions = getPrompts();

            setMessages([{
                type: 'bot',
                text: `Hi! I can help you analyze your data. Here is how you can prompt me:
• "Filter by [Column Name] [Value]" (e.g., "Filter by Region West")
• "Show top 5 [Column Name]"
• "Compare [Column] [Year] vs [Year]" (e.g., "Compare Revenue 2023 vs 2024")
• "Reset filters" or just type "/reset" to clear everything.

Try asking:
• ${suggestions.join('\n• ')}`,
                timestamp: new Date()
            }]);
        }
    }, [headers, messages.length]);

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

    const isNumericColumn = (col) => {
        const types = analyzeColumns();
        return types[col] === 'number';
    };

    const isDateColumn = (col) => {
        const types = analyzeColumns();
        return types[col] === 'date';
    };

    // Helper to format values for display (fixes T00:00:00.000Z issue)
    const formatValue = (val, colName = null) => {
        if (val === null || val === undefined) return '';

        // Handle Numbers
        const num = Number(val);
        if (!isNaN(num) && String(val).trim() !== '') {
            // Check if it's likely a date serial (large integer)
            if (num > 35000 && num < 60000 && colName && isDateColumn(colName)) {
                // It's a date, let it fall through to string handling or format here?
                // Usually handle lower down if we want to format date.
            } else {
                const isCurrency = colName && /revenue|profit|sales|amount|price|cost|income|expense/i.test(colName) && !/%|percent|margin|rate|ratio/i.test(colName);
                const isPercent = colName && /%|percent|margin|rate|ratio/i.test(colName);

                if (isCurrency) {
                    return num.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
                }
                if (isPercent) {
                    return num.toLocaleString(undefined, { style: 'percent', minimumFractionDigits: 1 });
                }
                // Standard number with commas
                return num.toLocaleString();
            }
        }

        const strVal = String(val);
        // Strip ISO time suffix
        if (strVal.includes('T00:00:00.000Z')) {
            return strVal.split('T')[0];
        }
        // Try strict ISO date regex
        if (/^\d{4}-\d{2}-\d{2}T/.test(strVal)) {
            return strVal.split('T')[0];
        }
        return strVal;
    };

    // Helper: Excel Serial Date to JS Date
    // Excel base date: Dec 30, 1899
    const excelDateToJSDate = (serial) => {
        // 25569 = Days between 1900-01-01 and 1970-01-01 plus 2 days for leap year bug in Excel?
        // Actually typically: (serial - 25569) * 86400 * 1000
        // But let's be more robust:
        const utc_days = Math.floor(serial - 25569);
        const utc_value = utc_days * 86400;
        const date_info = new Date(utc_value * 1000);
        return date_info;
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
        let column = null; // Hoisted declaration

        // Parse date ranges early
        const dateRanges = parseDateRanges(q);
        const dateRange = dateRanges.length > 0 ? dateRanges[0] : null;
        let segmentBy = null;

        // Detect "by [column]" for Segmentation / Grouping
        const segmentMatch = q.match(/\bby\s+([a-zA-Z0-9\s]+?)(?:\?$|$| in | for | at | on )/i);
        if (segmentMatch) {
            const potentialSeg = segmentMatch[1].trim();
            // Verify it's a valid column
            const matchedSeg = headers.find(h => h.toLowerCase() === potentialSeg.toLowerCase() || h.toLowerCase().includes(potentialSeg.toLowerCase()));
            if (matchedSeg) {
                segmentBy = matchedSeg;
            }
        }
        // Detect implicit "by [column]" from "Which [Dimension] is the most [Metric]?"
        const implicitSegmentMatch = q.match(/^(?:which|what)\s+([a-z0-9\s]+?)\s+(?:is|are|has|have|was|were)/i);
        if (implicitSegmentMatch && !segmentBy) {
            const potentialSeg = implicitSegmentMatch[1].trim();
            const matchedSeg = headers.find(h => h.toLowerCase() === potentialSeg.toLowerCase() || h.toLowerCase().includes(potentialSeg.toLowerCase()));
            // Only set segmentBy if it's NOT the primary column (e.g. "Which revenue is highest?" -> revenue is column, not segment)
            // But parsed.column isn't set yet. We'll validate later? 
            // Actually, we can check if it matches a header.
            if (matchedSeg) {
                segmentBy = matchedSeg;
            }
        }
        // Detect Aggregation Type
        if (q.match(/average|avg|mean|typical/)) aggregation = 'avg';
        else if (q.match(/count|how many/)) aggregation = 'count';

        // Detect Operation
        if (q.match(/^(?:for\s+)?(?:which|what)\s+(?:year|month|day|date|time|period|customer|region|product|project|account|vendor)(?:\?|$)/) && !q.match(/(?:highest|lowest|most|least|best|worst|had|have|was|were)/)) {
            operation = 'QUESTION';
        }
        else if (q.match(/^(?:reset|clear|remove|delete)(?:\s+all)?(?:\s+filters?|fitlers?|fliters?|filtes?)?$/) || q.startsWith('/reset') || q.startsWith('/clear') || q === 'reset' || q === 'clear') {
            operation = 'RESET_FILTER';
            column = null; // Enforce global reset for these matches
        }
        else if (q.startsWith('/help') || q.startsWith('/commands')) operation = 'HELP';
        else if (q.match(/^all\s+(?:of\s+)?(.+)/)) {
            // Check if "all [column]" -> Treat as Reset Filter for that column
            const potentialCol = q.match(/^all\s+(?:of\s+)?(.+)/)[1].trim();
            const matchedCol = headers.find(h => h.toLowerCase() === potentialCol.toLowerCase() || h.toLowerCase().includes(potentialCol.toLowerCase()));
            if (matchedCol) {
                operation = 'RESET_FILTER';
                // We need to set the column later, or set it here if we assume it works
                // But parseQuery usually finds column at the end. 
                // Let's rely on column detection? 
                // Or hint it? column detection looks for direct header matches. 
                // "customer type" will likely be found.
            }
        }
        else if (q.match(/(?:draw|plot|chart|graph|visualize|trend|see\s+trend)/)) operation = 'CHART';
        else if (q.match(/(?:apply|set|add|use)\s+filt[a-z]*|^filter\s+by/)) operation = 'APPLY_FILTER';
        else if (q.match(/(?:compare|difference|change|vs|versus|better|worse|increase|decrease|growth|drop|rose|fell)/)) operation = 'COMPARE';

        // Tab / Sheet Switching
        else if (q.match(/(?:switch|change|go|move|open|select)\s+(?:to\s+)?(?:tab|sheet|page)\s*(?:to\s+)?(.+)/)) operation = 'SWITCH_SHEET';
        else if (q.match(/(?:list|show|what)\s+(?:are\s+)?(?:the\s+)?(?:tabs|sheets|pages)/)) operation = 'LIST_SHEETS';

        // Generic Spreadsheet Rules
        else if (q.match(/how many unique|count unique|distinct/)) operation = 'UNIQUE';
        else if (q.match(/how many empty|missing|null|blank/)) operation = 'NULL';
        else if (q.match(/sort by|order by/)) operation = 'SORT';
        else if (q.match(/top\s+\d+|bottom\s+\d+|first\s+\d+|last\s+\d+/)) operation = 'TOP';

        else if (q.match(/total|\bsum\b|amount of|how much/)) operation = 'SUM';
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
        else if (q.match(/most common|most frequent|most popular|top|mode|common|busy|busiest/)) operation = 'MODE';
        else if (q.match(/max|highest|maximum|most|largest|best|biggest|greatest/)) operation = 'MAX';
        else if (q.match(/min|lowest|minimum|least|worst|bottom/)) operation = 'MIN';
        // Follow-up detection: "which [column]", "what [column]", "show [column]", "their [column]"
        else if (q.match(/^(?:which|what|show|their|the)\s+([a-z\s]+?)(?:\?|$|\s+(?:are|is|was|were))/i)) {
            // Check if we have recent results stored and the user is asking about a column
            operation = 'FOLLOW_UP';
        }
        else if (q.match(/show|find|list|view|only|just|where|contains?|filter/)) operation = 'FILTER';

        // Find primary column
        const candidates = [];

        // Skip candidate search if we already know it's a GLOBAL RESET
        if (operation !== 'RESET_FILTER') {

            // 1. Direct Header Matches
            const sortedHeaders = [...headers].sort((a, b) => b.length - a.length);
            for (const h of sortedHeaders) {
                if (q.includes(h.toLowerCase())) {
                    candidates.push({ col: h, type: 'direct' });
                }
            }

            // 2. Dictionary Matches
            const dictionary = {
                'revenue': ['revenue', 'sales', 'income', 'turnover', 'valuable', 'net revenue', 'revenue total', 'fixed fee', 'retainer', 'billing rate', 'amount', 'total'],
                'profit': ['profit', 'net income', 'earnings', 'gain', 'surplus', 'bottom line', 'profitable', 'profit total'],
                'margin': ['margin', 'rate', 'yield', 'return', 'percentage', 'margin pct', 'profit margin', 'discount pct', 'tax rate'],
                'cost': ['cost', 'expense', 'spending', 'cogs', 'expenditure', 'fee', 'charge', 'overhead', 'expensive', 'costly', 'cost labor', 'cost total', 'cost expense', 'cost overhead', 'expense billed'],
                'date': ['date', 'time', 'year', 'month', 'day', 'period', 'when', 'end date', 'paid date', 'start date', 'invoice date', 'retainer months'],
                'customer': ['customer', 'client', 'buyer', 'purchaser', 'account', 'company', 'customer id', 'customer name', 'customer type', 'account owner'],
                'product': ['product', 'item', 'goods', 'service', 'sku', 'commodity', 'service line', 'service tier', 'work scope', 'scope notes', 'project name', 'project type', 'project id', 'project status', 'delivery model', 'billing model'],
                'region': ['region', 'location', 'area', 'country', 'state', 'zone', 'city', 'territory', 'account region', 'business unit', 'industry type'],
                'status': ['status', 'state', 'condition', 'invoice status', 'project status', 'completed', 'pending', 'active']
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

                // Scoring Helper: Count how many words from query appear in the header
                const getScore = (colName) => {
                    const queryWords = q.toLowerCase().split(/\s+/);
                    const headerWords = colName.toLowerCase().split(/[_\s-]+/);
                    let score = 0;
                    // Reward exact word matches
                    headerWords.forEach(hw => {
                        if (queryWords.includes(hw)) score += 2;
                        else if (queryWords.some(qw => qw.includes(hw) || hw.includes(qw))) score += 0.5;
                    });
                    return score;
                };

                // Priority 1: If operation implies usage (Math -> Numeric)
                if (['SUM', 'AVG', 'MAX', 'MIN', 'COMPARE', 'CHART'].includes(operation)) {

                    // Filter for numeric candidates
                    let numericCandidates = candidates.filter(c => isNumericColumn(c.col));

                    // Refinement: If looking for financial metrics (profit, revenue, cost), prefer "Amounts" over "Ratios"
                    const financialKeywords = ['profit', 'revenue', 'cost'];
                    const hasFinancialIntent = candidates.some(c => c.keyword && financialKeywords.includes(c.keyword));

                    if (hasFinancialIntent && numericCandidates.length > 1) {
                        const amountCandidates = numericCandidates.filter(c => !isRatio(c.col));
                        if (amountCandidates.length > 0) {
                            numericCandidates = amountCandidates;
                        }
                    }

                    if (numericCandidates.length > 0) {
                        // Sort by Score (desc), then by Direct vs Dictionary, then Length
                        numericCandidates.sort((a, b) => {
                            const scoreA = getScore(a.col);
                            const scoreB = getScore(b.col);
                            if (scoreA !== scoreB) return scoreB - scoreA;

                            // Prefer direct
                            if (a.type === 'direct' && b.type !== 'direct') return -1;
                            if (b.type === 'direct' && a.type !== 'direct') return 1;

                            return a.col.length - b.col.length;
                        });

                        column = numericCandidates[0].col;
                    }
                }

                // Priority 2: Best overall match (if no numeric requirement or found)
                if (!column) {
                    // Sort all candidates by score
                    candidates.sort((a, b) => {
                        const scoreA = getScore(a.col);
                        const scoreB = getScore(b.col);
                        if (scoreA !== scoreB) return scoreB - scoreA;

                        if (a.type === 'direct' && b.type !== 'direct') return -1;
                        if (b.type === 'direct' && a.type !== 'direct') return 1;
                        return 0;
                    });
                    column = candidates[0].col;
                }
            }

        } // End of candidate search check

        // Context Fallback (if still null)
        // ONLY use context column if we aren't potentially doing a global search/filter
        // If operation is FILTER (implicit "only...", "find..."), we should look globally first.
        // But here we don't know the operation fully yet.
        // Heuristic: If q implies a filter command, don't default to lastColumn yet.
        // Actually, let's allow it but ensure subsequent logic can override it if a better match is found.
        if (!column && context.lastColumn && operation !== 'RESET_FILTER') {
            // If query contains "filter" or "only", maybe skip this?
            // But "filter by [value]" relies on column being known if value is ambiguous.
            // Let's keep it but handle overrides in logic.
            column = context.lastColumn;
        }



        // CRITICAL FIX: If we found a Date Range, do NOT search for value filters using the year string
        // This prevents "2023" from matching "20239" in a cost column.
        const qWithoutDates = dateRanges.reduce((acc, r) => acc.replace(r.label.toLowerCase(), ''), q.toLowerCase());
        const isDateOnlyQuery = qWithoutDates.trim().length === 0 || qWithoutDates.match(/^(?:in|on|for|from|to|at|by)\s*$/);


        // ---------------- Filter Parsing (Implicit & Explicit) ----------------
        let filter = null;

        // 0. Compound Query Pattern: "[operation] [metric] for [value] [column]"
        // E.g., "average total profit for all ci/cd work scopes"
        // This detects filter + aggregation in one pass
        if (!filter) {
            const compoundMatch = q.match(/(?:average|avg|total|sum|mean|count)\s+(?:of\s+)?(.+?)\s+(?:for|of|in|with|where)\s+(?:all\s+)?(.+?)\s+([\w\s]+?)(?:\?|$)/i);
            if (compoundMatch) {
                const metricPart = compoundMatch[1].trim();
                const valuePart = compoundMatch[2].trim();
                const columnPart = compoundMatch[3].trim();

                // Find the column that matches columnPart (e.g., "work scopes" -> "Work Scope")
                const filterCol = headers.find(h =>
                    h.toLowerCase() === columnPart.toLowerCase() ||
                    h.toLowerCase().includes(columnPart.toLowerCase()) ||
                    columnPart.toLowerCase().includes(h.toLowerCase()) ||
                    // Handle pluralization
                    h.toLowerCase() === columnPart.toLowerCase().replace(/s$/, '') ||
                    h.toLowerCase() + 's' === columnPart.toLowerCase()
                );

                if (filterCol) {
                    // Check if the value exists in that column
                    const hasMatch = sourceData.some(r => String(r[filterCol]).toLowerCase().includes(valuePart.toLowerCase()));
                    if (hasMatch) {
                        filter = { column: filterCol, value: valuePart };
                        // Don't override operation yet - let it flow naturally
                    }
                }
            }
        }

        // 0A. Adjective-Noun Pattern: "Finance Department", "West Region", "Q1 Sales"
        // This handles cases where Value comes BEFORE Column
        if (!filter && !q.match(/^(?:compare|show|what|how)/)) {
            for (const h of headers) {
                const colName = h.toLowerCase();
                // Regex: "value <space> column"
                // e.g. "finance department" -> val="finance", col="department"
                const regex = new RegExp('(.+?)\\s+' + colName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?:\\s+only|\\s+just)*$', 'i');
                const match = q.match(regex);
                if (match) {
                    let potentialVal = match[1].trim();
                    // Strip common start words if they got captured
                    potentialVal = potentialVal.replace(/^(?:show|me|find|get|filter|by|the|a|an)\s+/i, '').trim();

                    if (potentialVal.length > 0) {
                        // Verify value exists in column
                        const hasMatch = sourceData.some(r => String(r[h]).toLowerCase().includes(potentialVal));
                        if (hasMatch) {
                            filter = { column: h, value: potentialVal };
                            column = h; // Set primary column context
                            if (operation === 'FILTER' || operation === 'UNKNOWN') operation = 'APPLY_FILTER';
                            break;
                        }
                    }
                }
            }
        }

        // 0. Numerical Comparisons (>, <, >=, <=, larger than, etc.)
        // This must be detected BEFORE standard "equality" filters
        if (column && !filter) {
            // Regex for operators
            // Supports: "> 100", "greater than 100", "larger than 100", "over 100"
            // "< 50", "less than 50", "under 50", "smaller than 50"
            const operatorRegex = /(?:greater\s+than|larger\s+than|big(?:ger)?\s+than|more\s+than|less\s+than|small(?:er)?\s+than|lower\s+than|under|over|above|below|>=|<=|>|<)\s+(\d+(?:,\d+)*(?:\.\d+)?)/i;
            const match = q.match(operatorRegex);
            if (match) {
                const operatorStr = match[0].match(/^[^\d]+/)[0].trim().toLowerCase();
                const numericVal = parseFloat(match[1].replace(/,/g, ''));

                let operator = '';
                if (['>', 'greater than', 'larger than', 'bigger than', 'more than', 'over', 'above'].includes(operatorStr)) operator = '>';
                else if (['<', 'less than', 'smaller than', 'lower than', 'under', 'below'].includes(operatorStr)) operator = '<';
                else if (operatorStr === '>=') operator = '>=';
                else if (operatorStr === '<=') operator = '<=';

                if (operator) {
                    filter = { column: column, value: numericVal, operator: operator };
                    if (operation === 'UNKNOWN' || operation === 'FILTER') operation = 'APPLY_FILTER';
                }
            }
        }

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

        // 2. Pattern: "from X" or "for X" or "on X"
        if (!filter && !filter) {
            const match = q.match(/(?:from|for|in|at|by|on)\s+(.+?)(?:\s+in\s+|\s+for\s+|\s+at\s+|\s+by\s+|\s+on\s+|\?|$)/);
            if (match) {
                let val = match[1].trim();
                // Strip "only", "just" from the end of the value
                val = val.replace(/\s+(?:only|just)$/i, '');

                // Exclude date keywords and years (e.g. 2023, 2024)
                const isYear = /\b20\d{2}\b/.test(val);
                if (!isYear && !['last year', 'this year', 'compare', 'trend'].some(d => val.includes(d))) {
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
        // Only run if we don't already have a strong Date Range signal for a "Date Only" query
        if (!filter && !q.match(/^(?:compare|show|what|how)/) && !isDateOnlyQuery) {
            // If query is just a word or phrase, try to find it as a value in ANY column
            let cleanQuery = q.replace(/[?.,!]/g, '').trim();
            // Remove common start verbs
            // Remove common start verbs (allow combinations like "only show me")
            cleanQuery = cleanQuery.replace(/^(?:match|search|find|get|filter|by|only|just|show|me|\s)+/i, '').trim();

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
        if (!filter && column && !isDateOnlyQuery) {
            let residual = q.replace(column.toLowerCase(), '').replace(/show|me|calculate|find|what|is|how|many|total|sum|average|avg|filter|by|the|a|an|only|just/g, '').trim();
            // remove symbols
            residual = residual.replace(/[=:]/g, ' ').trim();

            if (residual.length > 1) {
                if (sourceData.some(r => String(r[column]).toLowerCase().includes(residual))) {
                    filter = { column: column, value: residual };
                    if (operation === 'UNKNOWN') operation = 'APPLY_FILTER';
                }
            }
        }

        // 5. Implicit "Sum" inference (e.g. "what is the gross profit?", "revenue")
        // If we found a column, it is numeric/currency, and we have NO filter value (just naming the column)
        // Then the user likely wants the total of that column.
        if ((operation === 'FILTER' || operation === 'APPLY_FILTER' || operation === 'UNKNOWN') && column && !filter) {
            const isNumeric = isNumericColumn(column);
            const isDate = isDateColumn(column);
            const isRate = /%|percent|margin|rate|ratio/i.test(column);

            // Only sum if it's numeric and NOT a date (e.g. don't sum Year)
            // Also if query looks like a question or just a label
            if (isNumeric && !isDate) {
                // For Rates/Percentages, Average is usually what is desired, not Sum
                if (isRate) operation = 'AVG';
                else operation = 'SUM';
            }
        }

        // Chart override: If Compare intent + segmentBy, it becomes a CHART operation usually

        if ((operation === 'COMPARE' || q.includes('trend')) && segmentBy) {
            operation = 'CHART';
        }

        // Date Range Override: If we have a date range but no strong operation, treat as Filter
        if (dateRange && (operation === 'FILTER' || operation === 'UNKNOWN')) {
            operation = 'APPLY_FILTER';
        }

        return { operation, column, dateRange, dateRanges, filter, segmentBy, aggregation };
    };

    // Execute query
    const executeQuery = (parsed) => {
        try {
            const isCurrencyColumn = (colName) => /revenue|profit|sales|amount|price|cost|income|expense/i.test(colName) && !/%|percent|margin|rate|ratio/i.test(colName);
            const isPercentColumn = (colName) => /%|percent|margin|rate|ratio/i.test(colName);

            const formatNumber = (num, colName) => {
                const formatted = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                if (isCurrencyColumn(colName)) return `$${formatted}`;
                if (isPercentColumn(colName)) return `${formatted}%`;
                return formatted;
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

                    let msg = `Generating chart`;
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

                return `Comparison of ${parsed.column}:\n\n• ${r1.label}: ${formatNumber(val1, parsed.column)}\n• ${r2.label}: ${formatNumber(val2, parsed.column)}\n\nDid it go up? Yes, it ${direction} by ${formatNumber(Math.abs(change), parsed.column)} (${Math.abs(pctChange).toFixed(1)}%) from ${r1.label} to ${r2.label}.`;
            }

            // Apply date filter
            let dateFilteredResult = [...result];
            if (parsed.dateRange) {
                // If the user specified a specific date column (e.g. "by End Date"), use it.
                // Otherwise find the first date column.
                const dateCol = (parsed.column && isDateColumn(parsed.column)) ? parsed.column : headers.find(h => isDateColumn(h));
                if (dateCol) {
                    dateFilteredResult = result.filter(row => {
                        const cellVal = row[dateCol];
                        let rowDate;

                        // Check if Excel Serial Date (Number)
                        if (typeof cellVal === 'number' && cellVal > 35000 && cellVal < 60000) {
                            rowDate = excelDateToJSDate(cellVal);
                        } else {
                            // Handle potential ISO strings or different formats
                            rowDate = new Date(cellVal);
                        }

                        return !isNaN(rowDate) && rowDate >= parsed.dateRange.start && rowDate <= parsed.dateRange.end;
                    });

                    // If we have a Date Range, use this result
                    result = dateFilteredResult;

                    // SYNC TO TABLE: If we filtered by date, update the main table view too
                    if (onApplyFilter) {
                        const matchingDates = [...new Set(result.map(r => String(r[dateCol])))];
                        const filters = { ...context.activeFilters };
                        filters[dateCol] = matchingDates;
                        // Avoid infinite loop if we already have this filter? App.jsx handles it?
                        // We just call it. But careful not to reset other filters unnecessarily.
                        // Actually, let's only call if it's different?
                        // For simplicity, just call it. The context update below handles local state.
                        onApplyFilter(filters);
                        // We also need to update context locally so we know we have these active
                        // But we can't update context inside executeQuery easily without triggering re-renders?
                        // executeQuery is called by handleSend.
                        // We should probably return a "sideEffect" or just do it here.
                        // However, onApplyFilter might trigger a re-render of Chatbot?
                        // If Chatbot receives new data, it might clearing things?
                        // Let's rely on onApplyFilter being stable.
                    }
                }
            }

            // Apply one-off filters (e.g. "Total Revenue for West") found in query
            // BUT: If the filter value is just a Year/Date string that we ALREADY handled with dateRange, default to NOT applying it?
            if (parsed.filter && parsed.operation !== 'FILTER' && parsed.operation !== 'APPLY_FILTER') {
                // Double check we aren't re-filtering the date string against random columns
                // But typically parseQuery prevents this now.
                result = result.filter(row => String(row[parsed.filter.column]).toLowerCase().includes(parsed.filter.value.toLowerCase()));
            }

            // Execute operation
            switch (parsed.operation) {
                case 'RESET_FILTER':
                    if (onApplyFilter) {
                        if (parsed.column) {
                            // Reset specific column
                            const newFilters = { ...activeFilters };
                            // Try to match column name in filters (case-insensitive keys?)
                            // activeFilters keys are usually exact from headers.
                            const filterKey = Object.keys(newFilters).find(k => k.toLowerCase() === parsed.column.toLowerCase());

                            if (filterKey) {
                                delete newFilters[filterKey];
                                onApplyFilter(newFilters);
                                return `Filter cleared for "${parsed.column}".`;
                            } else {
                                return `No active filter found for "${parsed.column}".`;
                            }
                        } else {
                            // Reset ALL
                            onApplyFilter({});
                            return "All filters have been reset.";
                        }
                    }
                    return "I can't reset filters because I'm not connected to the table.";

                case 'APPLY_FILTER':
                    if (parsed.filter) {
                        if (onApplyFilter) {
                            // Drill-down: Merge with existing filters
                            const newFilters = { ...activeFilters };
                            // Update specific column
                            // If value is array? We currently support single value partial match lists in App.jsx logic?
                            // App.jsx: if (allowed instanceof Set) ... else if (Array.isArray)

                            // Here we just set an array of ONE value for now (the search term)
                            // Wait, the App expects EXACT matches if it's a Set/Array of strings?
                            // Or partial matches?
                            // App.jsx logic: "if (!allowed.includes(String(row[col]))) return false;" -> EXACT match of string.
                            // BUT our NLU finds "value" based on "includes".
                            // If we say "Filter by West", we want rows where Region includes "West"? or equals "West"?
                            // If App.jsx does exact match check, we must provide the EXACT full value from data?
                            // parsed.filter.value is usually the substring or full value found.

                            // Let's Find ALL exact matches in data that match our filter value substring
                            // to support "West" matching "North West" if desired?
                            // Or usually chatbot "Filter by West" means "Region = West".
                            // If we found an exact match in data (implicit logic 3), we use it.

                            // Re-verify the values against data to get precise strings for the filter
                            const rawVal = parsed.filter.value.toLowerCase();
                            const col = parsed.filter.column;

                            // Find all unique values in this column that match the search term
                            // If user said "West", and we have "West" and "North West", do we filter both?
                            // Usually "Filter by West" implies "Contains West".

                            const matchingValues = [...new Set(sourceData
                                .map(r => r[col])
                                .filter(v => String(v).toLowerCase().includes(rawVal))
                                .map(v => String(v)) // Convert to string for filter
                            )];

                            if (matchingValues.length > 0) {
                                newFilters[col] = matchingValues;
                                onApplyFilter(newFilters);
                                const count = result.filter(r => matchingValues.includes(String(r[col]))).length; // approximate
                                return `Filtered by ${parsed.filter.column}: "${parsed.filter.value}".`;
                            } else {
                                return `I couldn't find any data matching "${parsed.filter.value}" in ${parsed.filter.column}.`;
                            }
                        }
                    }
                    return "I couldn't understand the filter. Try 'Filter by [Column] [Value]'.";

                case 'SUM':
                    if (!parsed.column) return 'Please specify which column to sum.';
                    if (!result.length) return "No data available.";

                    const sum = result.reduce((acc, row) => acc + (Number(String(row[parsed.column]).replace(/[$,%]/g, '')) || 0), 0);

                    const sumFilterContext = (parsed.filter && parsed.operation !== 'FILTER' && parsed.operation !== 'APPLY_FILTER')
                        ? `\nFiltered by ${parsed.filter.column}: "${parsed.filter.value}"`
                        : '';

                    // Check if there is segmentation
                    if (parsed.segmentBy) {
                        const groups = {};
                        result.forEach(row => {
                            const key = row[parsed.segmentBy];
                            if (key) {
                                const val = Number(String(row[parsed.column]).replace(/[$,%]/g, '')) || 0;
                                groups[key] = (groups[key] || 0) + val;
                            }
                        });
                        // Format top 5 groups
                        const sortedGroups = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 5);
                        return `Total ${parsed.column} by ${parsed.segmentBy}:\n\n${sortedGroups.map(([k, v]) => `• ${k}: ${formatNumber(v, parsed.column)}`).join('\n')}`;
                    }

                    return `Total ${parsed.column}: ${formatNumber(sum, parsed.column)}\n(Based on ${result.length} rows)${sumFilterContext}`;

                case 'MAX': {
                    if (!parsed.column) return 'Please specify which column to find the maximum of.';
                    if (!result.length) return "No data available.";

                    let targetCol = parsed.column;
                    let targetMetric = null;

                    // Smart Ranking: If max of non-numeric (e.g. "Biggest Customer"), find implied metric
                    if (!isNumericColumn(targetCol)) {
                        const numericCols = headers.filter(h => isNumericColumn(h));
                        // Priority: Revenue, Profit, Sales, Cost, Amount, etc.
                        const priorities = ['revenue', 'sales', 'profit', 'income', 'cost', 'expense', 'amount', 'total', 'price', 'value'];

                        targetMetric = numericCols.find(h => priorities.some(p => h.toLowerCase().includes(p))) || numericCols[0];

                        if (!targetMetric) return `I can't determine the "biggest" ${targetCol} because I couldn't find a numeric column (like Revenue or Sales) to rank them by.`;

                        // We will return the entity with the max metric
                    } else {
                        targetMetric = targetCol; // It is the metric
                    }

                    if (targetMetric !== targetCol) {
                        // Group by targetCol, Sum targetMetric
                        // Find max
                        const groups = {};
                        result.forEach(r => {
                            const key = r[targetCol];
                            const val = Number(r[targetMetric]) || 0;
                            groups[key] = (groups[key] || 0) + val;
                        });

                        let maxKey = null;
                        let maxVal = -Infinity;

                        Object.entries(groups).forEach(([k, v]) => {
                            if (v > maxVal) {
                                maxVal = v;
                                maxKey = k;
                            }
                        });

                        if (maxKey) {
                            return `The ${parsed.column} with the highest ${targetMetric} is "${maxKey}" (${formatNumber(maxVal, targetMetric)}).`;
                        } else {
                            return `I couldn't find any data for ${parsed.column}.`;
                        }
                    }

                    // Standard Numeric Max
                    const maxVal = result.reduce((acc, row) => Math.max(acc, Number(String(row[parsed.column]).replace(/[$,%]/g, '')) || -Infinity), -Infinity);
                    if (maxVal === -Infinity) return `No numeric data found in "${parsed.column}".`;

                    const maxFilterContext = (parsed.filter && parsed.operation !== 'FILTER' && parsed.operation !== 'APPLY_FILTER')
                        ? `\nFiltered by ${parsed.filter.column}: "${parsed.filter.value}"`
                        : '';
                    return `Maximum ${parsed.column}: ${formatNumber(maxVal, parsed.column)}\n(Based on ${result.length} rows)${maxFilterContext}`;
                }

                case 'AVG':
                    if (!parsed.column) return 'Please specify which column to average.';
                    if (!isNumericColumn(parsed.column)) return `I can't calculate the average of "${parsed.column}" because it contains text.`;
                    const avg = result.reduce((acc, row) => acc + (Number(row[parsed.column]) || 0), 0) / result.length;
                    const avgFilterContext = (parsed.filter && parsed.operation !== 'FILTER' && parsed.operation !== 'APPLY_FILTER')
                        ? `\nFiltered by ${parsed.filter.column}: "${parsed.filter.value}"`
                        : '';
                    return `Average ${parsed.column}: ${formatNumber(avg, parsed.column)}\n(Based on ${result.length} rows)${avgFilterContext}`;

                case 'COUNT':
                    return `Count: ${result.length} rows`;

                case 'LIST_SHEETS': {
                    if (!activeFilename || !myFiles) return "I can't list tabs right now.";
                    const ext = activeFilename.split('.').pop();
                    const nameWithoutExt = activeFilename.replace(`.${ext}`, '');
                    const baseMatch = nameWithoutExt.match(/^(.*?)\s*\(/);
                    const baseName = baseMatch ? baseMatch[1] : nameWithoutExt;

                    const siblings = myFiles.filter(f => f.filename.startsWith(baseName)).sort((a, b) => a.filename.localeCompare(b.filename));

                    if (siblings.length < 2) return `I only see one sheet: ${activeFilename}`;

                    const tabNames = siblings.map(s => {
                        if (s.tab_name) return s.tab_name;
                        // Fallback
                        const sNameNoExt = s.filename.replace(`.${ext}`, '');
                        const m = sNameNoExt.match(/\s+\((.*?)\)$/);
                        return m ? m[1] : "Main";
                    });

                    return `Available Tabs:\n\n${tabNames.map(t => `• ${t}`).join('\n')}\n\nYou can say "Switch to ${tabNames[1] || 'Tab'}" to change views.`;
                }

                case 'SWITCH_SHEET': {
                    if (!activeFilename || !myFiles || !onSwitchSheet) return "I can't switch sheets right now.";

                    const match = input.match(/(?:switch|change|go|move|open|select)\s+(?:to\s+)?(?:tab|sheet|page)\s*(?:to\s+)?(.+)/i);
                    if (!match) return "Which tab should I switch to?";

                    const targetName = match[1].trim().toLowerCase();

                    const ext = activeFilename.split('.').pop();
                    const nameWithoutExt = activeFilename.replace(`.${ext}`, '');
                    const baseMatch = nameWithoutExt.match(/^(.*?)\s*\(/);
                    const baseName = baseMatch ? baseMatch[1] : nameWithoutExt;

                    const siblings = myFiles.filter(f => f.filename.startsWith(baseName));

                    const targetFile = siblings.find(s => {
                        // Check exact tab name first
                        if (s.tab_name && s.tab_name.toLowerCase() === targetName) return true;

                        // Fallback check
                        const sNameNoExt = s.filename.replace(`.${ext}`, '');
                        const m = sNameNoExt.match(/\s+\((.*?)\)$/);
                        const tabName = m ? m[1] : "Main";
                        return tabName.toLowerCase() === targetName || tabName.toLowerCase().includes(targetName);
                    });

                    if (targetFile) {
                        onSwitchSheet(targetFile.id);
                        return `Switched to tab: ${targetFile.filename}`;
                    }

                    return `I couldn't find a tab named "${match[1]}". Try asking "List tabs" to see available options.`;
                }



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

                    // AGGREGATION HANDLER (If segmentBy is present)
                    if (parsed.segmentBy) {
                        const groups = {};
                        result.forEach(row => {
                            const key = row[parsed.segmentBy];
                            if (key) {
                                const val = Number(String(row[parsed.column]).replace(/[$,%]/g, '')) || 0;
                                groups[key] = (groups[key] || 0) + val;
                            }
                        });

                        let minGroupVal = Infinity;
                        let minGroupKey = null;

                        Object.entries(groups).forEach(([key, val]) => {
                            if (val < minGroupVal) {
                                minGroupVal = val;
                                minGroupKey = key;
                            }
                        });

                        if (minGroupKey) {
                            setContext(prev => ({ ...prev, lastResultLabel: parsed.segmentBy, lastResultValue: minGroupVal }));
                            return `The ${parsed.segmentBy} with the lowest total ${parsed.column} is:\n\n• ${minGroupKey}: ${formatNumber(minGroupVal, parsed.column)}`;
                        }
                    }

                    setContext(prev => ({ ...prev, lastResultRow: minRow }));

                    // Check if user asked "what [column] has the lowest [metric]?"
                    // Or "least profitable [column]?" / "lowest [metric] [column]?"
                    // Extract the requested label column from the query
                    let minLabel = '';
                    let requestedMinLabelCol = null;

                    // Pattern 1: "what/which X has the lowest Y"
                    const minQueryMatch = input.match(/(?:what|which)\s+(.+?)\s+(?:has|have|had|with|got|gets)\s+(?:the\s+)?(?:lowest|min|minimum|least|smallest|worst)/i);
                    if (minQueryMatch) {
                        const requestedMinColName = minQueryMatch[1].trim();
                        requestedMinLabelCol = headers.find(h =>
                            h.toLowerCase() === requestedMinColName.toLowerCase() ||
                            h.toLowerCase().includes(requestedMinColName.toLowerCase()) ||
                            requestedMinColName.toLowerCase().includes(h.toLowerCase().replace(/\s+/g, ' '))
                        );
                    }

                    // Pattern 2: "least profitable X?" / "lowest revenue X?" / "worst X?"
                    let minSearchTerm = null;
                    if (!requestedMinLabelCol) {
                        const altMinMatch = input.match(/(?:least|lowest|worst|smallest|minimum)\s+(?:\w+\s+)?(\w[\w\s]*?)(?:\?|$)/i);
                        if (altMinMatch) {
                            minSearchTerm = altMinMatch[1].trim();
                            // Find a column that matches the last part of the query (the noun)
                            requestedMinLabelCol = headers.find(h =>
                                h.toLowerCase() === minSearchTerm.toLowerCase() ||
                                h.toLowerCase().includes(minSearchTerm.toLowerCase()) ||
                                minSearchTerm.toLowerCase().includes(h.toLowerCase().replace(/\s+/g, ' '))
                            );
                            // Make sure we don't pick the same column we're aggregating on
                            if (requestedMinLabelCol === parsed.column) {
                                requestedMinLabelCol = null;
                            }
                        }
                    }

                    if (requestedMinLabelCol && requestedMinLabelCol !== parsed.column) {
                        // User specifically asked for this column
                        return `${requestedMinLabelCol} with lowest ${parsed.column}: ${formatValue(minRow[requestedMinLabelCol])}\n(${parsed.column}: ${formatNumber(minVal, parsed.column)})`;
                    }

                    // If user asked for a column but we couldn't find it, suggest similar ones
                    if (minSearchTerm && !requestedMinLabelCol) {
                        const similarMinCols = headers.filter(h =>
                            h.toLowerCase().includes(minSearchTerm.split(' ')[0].toLowerCase()) ||
                            minSearchTerm.split(' ').some(word => h.toLowerCase().includes(word.toLowerCase()))
                        ).filter(h => h !== parsed.column).slice(0, 5);

                        if (similarMinCols.length > 0) {
                            return `Minimum ${parsed.column}: ${formatNumber(minVal, parsed.column)}\n\n🤔 I couldn't find a column matching "${minSearchTerm}". Did you mean one of these?\n${similarMinCols.map(c => `• ${c}: ${formatValue(minRow[c])}`).join('\n')}`;
                        }
                    }

                    // Fallback to default label column detection
                    const minLabelCol = headers.find(h => h.toLowerCase().includes('month') || h.toLowerCase().includes('date') || h.toLowerCase().includes('name') || !isNumericColumn(h));
                    if (minLabelCol && minLabelCol !== parsed.column) {
                        minLabel = `\n(${minLabelCol}: ${formatValue(minRow[minLabelCol])})`;
                    }

                    return `Minimum ${parsed.column}: ${formatNumber(minVal, parsed.column)}${minLabel}`;

                case 'UNIQUE':
                    if (!parsed.column) return 'Please specify which column to count unique values for.';
                    const uniqueCount = new Set(result.map(r => r[parsed.column])).size;
                    return `There are ${uniqueCount} unique values in "${parsed.column}".`;

                case 'NULL':
                    if (!parsed.column) return 'Please specify which column to check for empty values.';
                    const nullCount = result.filter(r => r[parsed.column] === null || r[parsed.column] === undefined || String(r[parsed.column]).trim() === '').length;
                    return `There are ${nullCount} empty/missing values in "${parsed.column}".`;

                case 'TOP':
                    const topMatch = input.match(/(?:top|bottom|first|last)\s+(\d+)/i);
                    const n = topMatch ? parseInt(topMatch[1], 10) : 5;
                    const isBottom = input.match(/bottom|last/i);

                    const sortedTop = [...result].sort((a, b) => {
                        const valA = Number(String(a[parsed.column]).replace(/[$,%]/g, '')) || 0;
                        const valB = Number(String(b[parsed.column]).replace(/[$,%]/g, '')) || 0;
                        return isBottom ? valA - valB : valB - valA;
                    });

                    const slice = sortedTop.slice(0, n);
                    const topLabelCol = headers.find(h => !isNumericColumn(h) && h !== parsed.column) || headers[0];

                    // Store results in context for follow-up questions
                    setContext(prev => ({
                        ...prev,
                        lastResults: slice,
                        lastResultColumn: parsed.column,
                        lastResultLabel: topLabelCol,
                        lastOperation: isBottom ? 'BOTTOM' : 'TOP'
                    }));

                    return `${isBottom ? 'Bottom' : 'Top'} ${n} ${parsed.column}:\n${slice.map((r, i) => `${i + 1}. ${formatValue(r[topLabelCol], topLabelCol)}: ${formatValue(r[parsed.column], parsed.column)}`).join('\n')}`;

                case 'SORT':
                    if (!parsed.column) return 'Please specify which column to sort by.';
                    const isDesc = input.match(/desc|descending|high to low/i);
                    const sorted = [...result].sort((a, b) => {
                        const valA = a[parsed.column];
                        const valB = b[parsed.column];
                        if (isNumericColumn(parsed.column)) {
                            const numA = Number(String(valA).replace(/[$,%]/g, '')) || 0;
                            const numB = Number(String(valB).replace(/[$,%]/g, '')) || 0;
                            return isDesc ? numB - numA : numA - numB;
                        }
                        return isDesc ? String(valB).localeCompare(String(valA)) : String(valA).localeCompare(String(valB));
                    });

                    return `Sorted by ${parsed.column} (${isDesc ? 'Descending' : 'Ascending'}):\n${sorted.slice(0, 5).map((r, i) => `${i + 1}. ${formatValue(r[parsed.column], parsed.column)}`).join('\n')}\n(Showing first 5 rows)`;


                case 'FILTER':
                    return `Found ${result.length} matching rows.\n\nFirst 5 rows:\n${result.slice(0, 5).map((row, i) =>
                        `${i + 1}. ${Object.entries(row).slice(0, 3).map(([k, v]) => `${k}: ${formatValue(v, k)}`).join(', ')}`
                    ).join('\n')}`;

                case 'QUESTION':
                    if (parsed.column) {
                        const activeVal = (context.activeFilters && context.activeFilters[parsed.column]) ? context.activeFilters[parsed.column] : null;
                        if (parsed.filter && parsed.filter.column === parsed.column) {
                            return `The current query is filtered by ${parsed.column}: "${formatValue(parsed.filter.value, parsed.column)}".`;
                        }
                        if (activeVal) {
                            return `This data is filtered by ${parsed.column}: "${activeVal.map(v => formatValue(v, parsed.column)).join(', ')}".`;
                        }
                        const uniqueVals = [...new Set(result.map(r => r[parsed.column]))];
                        if (uniqueVals.length < 10) {
                            return `There are ${uniqueVals.length} ${parsed.column}s: ${uniqueVals.map(v => formatValue(v, parsed.column)).join(', ')}`;
                        }
                        return `There are ${uniqueVals.length} different ${parsed.column}s in the current view.`;
                    }

                    if (context.lastDateRange) {
                        const { start, end } = context.lastDateRange;
                        return `The previous query was for data from ${start.toLocaleDateString()} to ${end.toLocaleDateString()}.`;
                    } else {
                        return `The previous query used all available data (no date filter applied).`;
                    }

                case 'HELP':
                    return `Here are some things I can do:

**Commands:**
• \`/reset\` or "Reset filters" - Clear all active filters
• \`/help\` - Show this message

**Analysis:**
• "Show top 5 [Column]"
• "Filter by [Column] [Value]"
• "Compare [Column] 2023 vs 2024"
• "Which [Region/Dept] is the most profitable?"
• "Trend of [Column]"`;

                case 'MODE':
                    if (!parsed.column) return 'Please specify which column to find the most common value for.';
                    if (!result.length) return "No data available.";

                    const counts = {};
                    const isDate = isDateColumn(parsed.column);

                    result.forEach(row => {
                        let val = row[parsed.column];
                        if (isDate) {
                            const d = new Date(val);
                            if (!isNaN(d)) {
                                val = d.toLocaleString('default', { month: 'long', year: 'numeric' });
                            } else {
                                val = String(val);
                            }
                        } else {
                            val = String(val);
                        }

                        if (val && val !== 'undefined' && val !== 'null' && val.trim() !== '') {
                            counts[val] = (counts[val] || 0) + 1;
                        }
                    });

                    let maxCount = 0;
                    let modeVal = null;
                    Object.entries(counts).forEach(([val, count]) => {
                        if (count > maxCount) {
                            maxCount = count;
                            modeVal = val;
                        }
                    });

                    if (!modeVal) return `Could not calculate most common value for "${parsed.column}".`;

                    if (!modeVal) return `Could not calculate most common value for "${parsed.column}".`;

                    return `Most common ${parsed.column}: "${formatValue(modeVal, parsed.column)}" (${maxCount} occurrences).`;

                case 'FOLLOW_UP':
                    // Handle follow-up questions about previous results
                    if (!context.lastResults || context.lastResults.length === 0) {
                        return "🤔 I don't have any recent results to reference. Try asking a question first like \"Top 5 revenue\".";
                    }

                    // Find the column the user is asking about
                    let followUpCol = parsed.column;
                    if (!followUpCol) {
                        // Try to extract from query
                        const colMatch = input.match(/(?:which|what|show|their|the)\s+([a-z\s]+?)(?:\?|$|\s+(?:are|is|was|were))/i);
                        if (colMatch) {
                            const potentialCol = colMatch[1].trim();
                            followUpCol = findColumn(potentialCol);
                        }
                    }

                    if (!followUpCol) {
                        return `🤔 I couldn't understand which column you want from the previous results. Available columns: ${headers.slice(0, 5).join(', ')}...`;
                    }

                    // Extract the requested column from stored results
                    const followUpResults = context.lastResults.map((row, i) => {
                        const labelVal = formatValue(row[context.lastResultLabel], context.lastResultLabel);
                        const requestedVal = formatValue(row[followUpCol], followUpCol);
                        return `${i + 1}. ${labelVal}: ${followUpCol} = ${requestedVal}`;
                    });

                    return `${followUpCol} from the ${context.lastOperation || 'previous'} results:\n${followUpResults.join('\n')}`;

                default:
                    return "I'm not sure how to help with that. Try asking about totals, averages, counts, or filtering data.";
            }

        } catch (error) {
            return `Sorry, I encountered an error: ${error.message}`;
        }
    };

    // Focus input on open
    // Keyboard handling
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const handleSend = async () => {
        if (!input.trim()) return;




        // Chit-Chat / Small Talk Handler
        const smallTalk = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'thx', 'nice', 'cool', 'awesome', 'good job', 'ok', 'okay', 'great'];
        const lowerInput = input.trim().toLowerCase().replace(/[!.?]/g, '');
        if (smallTalk.includes(lowerInput)) {
            setMessages(prev => [...prev, { type: 'user', text: input, timestamp: new Date() }]);
            const replies = {
                'hi': 'Hello! How can I help you analyze your data?',
                'hello': 'Hi there! Ready to crunch some numbers?',
                'hey': 'Hey! What data are we looking at today?',
                'thanks': 'You\'re welcome!',
                'thank you': 'Anytime!',
                'thx': 'No problem!',
                'nice': 'Glad I could help!',
                'cool': 'Indeed!',
                'awesome': 'I try my best! 😎',
                'good job': 'Thank you!',
                'great': 'Excellent!',
                'ok': '👌',
                'okay': '👍'
            };
            const reply = replies[lowerInput] || '👋';
            setTimeout(() => {
                setMessages(prev => [...prev, { type: 'bot', text: reply, timestamp: new Date() }]);
            }, 500);
            setInput('');
            return;
        }

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

                // Check if user provided a number (e.g. "1", "2")
                const index = parseInt(userInput, 10);
                if (!isNaN(index) && index >= 1 && index <= matchingValues.length) {
                    const selectedValue = matchingValues[index - 1];
                    const filters = { ...context.activeFilters };
                    filters[column] = [selectedValue];
                    onApplyFilter(filters);
                    setContext(prev => ({ ...prev, activeFilters: filters, pendingFilter: null }));

                    const botMessage = {
                        type: 'bot',
                        text: `✅ Applied filter to table!\n\n${column}: "${formatValue(selectedValue)}"\nShowing ${data.filter(row => String(row[column]) === selectedValue).length} rows`,
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

                // Check for unique partial match (fuzzy)
                const fuzzyMatches = matchingValues.filter(v => v.toLowerCase().includes(userInput));
                if (fuzzyMatches.length === 1) {
                    const match = fuzzyMatches[0];
                    const filters = { ...context.activeFilters };
                    filters[column] = [match];
                    onApplyFilter(filters);
                    setContext(prev => ({ ...prev, activeFilters: filters, pendingFilter: null }));

                    const botMessage = {
                        type: 'bot',
                        text: `✅ Applied filter to table!\n\n${column}: "${formatValue(match)}"\nShowing ${data.filter(row => String(row[column]) === match).length} rows`,
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
            // Only trigger if operation is NOT a filter command (to avoid "only p-002" showing "Submittal Status: Pending")
            if (context.lastResultRow && parsed.column && (!parsed.operation || parsed.operation === 'UNKNOWN' || parsed.operation === 'QUESTION') && parsed.operation !== 'FILTER') {
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
            // BUT: Don't reuse if input is very short or looks like just a number/word unless it's a specific flow
            if (parsed.operation === 'UNKNOWN' && context.lastOperation && input.length > 2) {
                parsed.operation = context.lastOperation;
            }
            if (!parsed.column && context.lastColumn) {
                parsed.column = context.lastColumn;
            }

            // Reuse Date Context (Sticky Date Filter)
            if (!parsed.dateRange && context.lastDateRange && ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'chart', 'COMPARE', 'TOP'].includes(parsed.operation)) {
                // Check if user explicitly asked for "all time" or "total" which might imply removing date filter?
                // For now, assume sticky unless "all time" is present
                if (!input.match(/all time|total history|no date/i)) {
                    parsed.dateRange = context.lastDateRange;
                }
            }

            // Update context
            if (parsed.column) setContext(prev => ({ ...prev, lastColumn: parsed.column }));
            if (parsed.operation && parsed.operation !== 'UNKNOWN') setContext(prev => ({ ...prev, lastOperation: parsed.operation }));
            if (parsed.dateRange) setContext(prev => ({ ...prev, lastDateRange: parsed.dateRange }));

            // For RESET_FILTER operations, clear all filters OR specific filter
            if (parsed.operation === 'RESET_FILTER' && onApplyFilter) {
                if (parsed.column) {
                    const filters = { ...context.activeFilters };
                    if (filters[parsed.column]) {
                        delete filters[parsed.column];
                        onApplyFilter(filters);
                        setContext(prev => ({ ...prev, activeFilters: filters }));
                        setMessages(prev => [...prev, { type: 'bot', text: `Cleared filter for "${parsed.column}".`, timestamp: new Date() }]);
                    } else {
                        setMessages(prev => [...prev, { type: 'bot', text: `No active filter found for "${parsed.column}".`, timestamp: new Date() }]);
                    }
                } else {
                    onApplyFilter({});
                    setContext(prev => ({ ...prev, activeFilters: {}, lastColumn: null, lastResultRow: null, lastOperation: null }));
                    setMessages(prev => [...prev, { type: 'bot', text: 'All filters cleared & context reset!\n\nShowing all data.', timestamp: new Date() }]);
                }
                setInput('');
                return;
            }

            // For APPLY_FILTER operations
            if ((parsed.operation === 'FILTER' || parsed.operation === 'APPLY_FILTER') && onApplyFilter) {
                if (!parsed.filter) {
                    const botMessage = { type: 'bot', text: 'I couldn\'t understand what to filter. Try "Region = West" or "Show me Completed".', timestamp: new Date() };
                    setMessages(prev => [...prev, botMessage]);
                    setInput('');
                    return;
                }

                let matchingValues = [];

                // Handle Numerical Comparison (Range Filter)
                if (parsed.filter.operator) {
                    const op = parsed.filter.operator;
                    const val = parsed.filter.value;

                    matchingValues = [...new Set(
                        ((allData && allData.length > 0) ? allData : data)
                            .filter(row => {
                                const rowVal = Number(String(row[parsed.filter.column]).replace(/[$,%]/g, ''));
                                if (isNaN(rowVal)) return false;
                                if (op === '>') return rowVal > val;
                                if (op === '<') return rowVal < val;
                                if (op === '>=') return rowVal >= val;
                                if (op === '<=') return rowVal <= val;
                                return false;
                            })
                            .map(row => String(row[parsed.filter.column]))
                    )];

                    if (matchingValues.length > 0) {
                        // For ranges, we generally assume "Apply All" rather than asking to pick one, 
                        // because the user asked for a condition, not a specific value match.
                        const filters = { ...context.activeFilters };
                        filters[parsed.filter.column] = matchingValues;
                        onApplyFilter(filters);
                        setContext(prev => ({ ...prev, activeFilters: filters, pendingFilter: null }));

                        const botMessage = {
                            type: 'bot',
                            text: `Applied range filter: ${parsed.filter.column} ${op} ${val}\n\nFound ${matchingValues.length} distinct values matching criteria.\nShowing ${matchingValues.length} rows.`,
                            timestamp: new Date()
                        };
                        setMessages(prev => [...prev, botMessage]);
                        setInput('');
                        return;
                    }
                    // No matches found, fall through to error message below
                }
                else {
                    // Standard String Matching
                    matchingValues = [...new Set(
                        ((allData && allData.length > 0) ? allData : data)
                            .filter(row => String(row[parsed.filter.column]).toLowerCase().includes(parsed.filter.value.toLowerCase()))
                            .map(row => String(row[parsed.filter.column]))
                    )];

                    // Refinement: If explicit exact match exists, prefer it to avoid ambiguity (e.g. "West" vs "Midwest")
                    if (matchingValues.length > 1) {
                        const exact = matchingValues.find(v => v.toLowerCase() === parsed.filter.value.toLowerCase());
                        if (exact) {
                            matchingValues = [exact];
                        }
                    }
                }

                if (matchingValues.length === 0) {
                    setMessages(prev => [...prev, { type: 'bot', text: `No values found matching "${parsed.filter.value}" in column "${parsed.filter.column}"`, timestamp: new Date() }]);
                    setInput('');
                    return;
                }

                // Multiple matches? Auto-apply all of them without asking for confirmation
                if (matchingValues.length > 1) {
                    // Check if combined with existing filters would yield results
                    const currentFilters = context.activeFilters || {};
                    const potentialFilters = { ...currentFilters };
                    potentialFilters[parsed.filter.column] = matchingValues;

                    const testSet = ((allData && allData.length > 0) ? allData : data).filter(row => {
                        return Object.entries(potentialFilters).every(([col, vals]) => {
                            const cell = String(row[col]);
                            return vals.includes(cell);
                        });
                    });

                    let finalFilters = {};
                    let message = '';

                    if (testSet.length > 0) {
                        // Cumulative success
                        finalFilters = potentialFilters;
                        message = `Applied filter to table!\n\n${parsed.filter.column}: ${matchingValues.length} values\nShowing ${testSet.length} rows`;
                    } else {
                        // Conflict -> Auto Reset
                        finalFilters = { [parsed.filter.column]: matchingValues };
                        const count = ((allData && allData.length > 0) ? allData : data).filter(row => matchingValues.includes(String(row[parsed.filter.column]))).length;
                        message = `No rows found with combined filters. Resetting view.\n\nFiltering only by ${parsed.filter.column}: ${matchingValues.length} values\nShowing ${count} rows`;
                    }

                    onApplyFilter(finalFilters);
                    setContext(prev => ({ ...prev, activeFilters: finalFilters, pendingFilter: null }));
                    setMessages(prev => [...prev, { type: 'bot', text: message, timestamp: new Date() }]);
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

                if (finalSet.length === 0) {
                    // AUTO-RESET LOGIC:
                    // If combined filters yield 0 rows, BUT the new filter alone yields matches (which we know it does, since matchingValues > 0),
                    // then we should clear old filters and apply ONLY this new one.
                    onApplyFilter({ [parsed.filter.column]: matchingValues });
                    setContext(prev => ({
                        ...prev,
                        activeFilters: { [parsed.filter.column]: matchingValues },
                        pendingFilter: null
                    }));

                    const botMessage = {
                        type: 'bot',
                        text: `No rows found with combined filters. Resetting view.\n\nFiltering only by ${parsed.filter.column}: "${formatValue(matchingValues[0])}"\nShowing ${matchingValues.length === 1 ? 'matching rows' : matchingValues.length + ' values'}`,
                        timestamp: new Date()
                    };
                    setMessages(prev => [...prev, botMessage]);
                    setInput('');
                    return;
                }

                let finalFilters = {};
                let message = '';

                if (finalSet.length > 0) {
                    // Cumulative success
                    finalFilters = potentialFilters;
                    message = `Added filter! ${parsed.filter.column}: "${formatValue(matchingValues[0])}"\n(Combined with previous filters)\nShowing ${finalSet.length} rows`;
                } else {
                    // Conflict -> Auto Reset
                    finalFilters = {};
                    finalFilters[parsed.filter.column] = matchingValues;
                    const count = ((allData && allData.length > 0) ? allData : data).filter(row => matchingValues.includes(String(row[parsed.filter.column]))).length;
                    message = `No rows found with combined filters. Resetting view.\n\nFiltering only by ${parsed.filter.column}: "${formatValue(matchingValues[0])}"\nShowing ${count} rows`;
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
            const botMessage = { type: 'bot', text: `Error: ${error.message}`, timestamp: new Date() };
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
                    className="fixed bottom-6 right-6 w-10 h-10 bg-slate-900 text-white rounded-full shadow-xl hover:bg-slate-800 hover:shadow-2xl transition-all z-40 flex items-center justify-center focus:outline-none ring-1 ring-white/10"
                    title="Open Chat"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                </button>
            )}

            {/* Chat Panel */}
            {isOpen && (
                <div className={`fixed bottom-6 right-6 w-96 ${isMinimized ? 'h-auto' : 'h-[320px]'} bg-white rounded-xl shadow-2xl flex flex-col z-40 border border-slate-200 font-sans overflow-hidden ring-1 ring-black/5`}>
                    {/* Header */}
                    <div
                        className="bg-slate-900 text-white px-3 py-2 border-b border-slate-800 flex justify-between items-center shadow-sm cursor-pointer select-none"
                        onDoubleClick={() => setIsMinimized(!isMinimized)}
                    >
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 bg-indigo-500 rounded flex items-center justify-center shadow-inner">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </div>
                            <span className="font-medium text-xs tracking-wide">Data Assistant</span>
                        </div>
                        <div className="flex gap-1.5 items-center">
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
                                className="text-slate-400 hover:text-white transition-colors p-0.5"
                                title={isMinimized ? "Maximize" : "Minimize"}
                            >
                                {isMinimized ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                )}
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-slate-400 hover:text-white transition-colors p-0.5"
                                title="Close"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                    </div>

                    {/* Messages - only show when not minimized */}
                    {!isMinimized && (
                        <>
                            <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 bg-slate-50/50">
                                {messages.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-sm ${msg.type === 'user'
                                            ? 'bg-blue-600 text-white rounded-tr-sm'
                                            : 'bg-white text-slate-600 border border-slate-200 rounded-tl-sm'
                                            }`}>
                                            <div className="whitespace-pre-wrap font-medium">{msg.text}</div>
                                        </div>
                                    </div>
                                ))}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input */}
                            <div className="p-2 bg-white border-t border-slate-100">
                                <div className="flex gap-1.5">
                                    <input
                                        ref={inputRef}
                                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder-slate-400 text-slate-700 font-medium"
                                        placeholder="Ask a question..."
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                                    />
                                    <button
                                        onClick={handleSend}
                                        className="bg-blue-600 hover:bg-blue-700 text-white w-7 h-[26px] rounded-lg transition-colors flex items-center justify-center shadow-sm self-center"
                                        title="Send"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
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
