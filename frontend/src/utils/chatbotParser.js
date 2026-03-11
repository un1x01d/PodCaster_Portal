import { analyzeColumns, isNumericColumn, isDateColumn, parseDateRanges } from "./chatbotUtils";

export const parseQuery = (query, headers, data, allData, context = {}) => {
    // Strip conversational preambles so NLP sees the intent directly
    const PREAMBLES = [
        /^(?:give\s+me|show\s+me|tell\s+me|can\s+you|please|what\s+(?:is|are|was|were)(?:\s+the)?|i\s+(?:want|need)(?:\s+to\s+(?:see|know))?(?:\s+the)?)\s+/i,
    ];
    let cleaned = query;
    for (const re of PREAMBLES) cleaned = cleaned.replace(re, '');
    const q = cleaned.toLowerCase();
    const sourceData = (allData && allData.length > 0) ? allData : data;
    let operation = 'UNKNOWN'; // Default
    let aggregation = 'none';
    let column = null;
    let filter = null;

    // Parse date ranges early
    const dateRanges = parseDateRanges(q);
    const dateRange = dateRanges.length > 0 ? dateRanges[0] : null;
    let segmentBy = null;

    // Detect "by [column]" for Segmentation / Grouping
    const segmentMatch = q.match(/\bby\s+([a-zA-Z0-9\s]+?)(?:\?$|$| in | for | at | on )/i);
    if (segmentMatch) {
        const potentialSeg = segmentMatch[1].trim();
        const matchedSeg = headers.find(h => h.toLowerCase() === potentialSeg.toLowerCase() || h.toLowerCase().includes(potentialSeg.toLowerCase()));
        if (matchedSeg) {
            segmentBy = matchedSeg;
        }
    }

    // Detect Implicit Segmentation (e.g. "Which Region is most profitable?")
    const implicitSegmentMatch = q.match(/^(?:which|what)\s+([a-z0-9\s]+?)\s+(?:is|are|has|have|was|were)/i);
    if (implicitSegmentMatch && !segmentBy) {
        const potentialSeg = implicitSegmentMatch[1].trim();
        const matchedSeg = headers.find(h => h.toLowerCase() === potentialSeg.toLowerCase() || h.toLowerCase().includes(potentialSeg.toLowerCase()));
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
        column = null;
    }
    else if (q.startsWith('/help') || q.startsWith('/commands')) operation = 'HELP';
    else if (q.match(/^all\s+(?:of\s+)?(.+)/)) {
        const potentialCol = q.match(/^all\s+(?:of\s+)?(.+)/)[1].trim();
        const matchedCol = headers.find(h => h.toLowerCase() === potentialCol.toLowerCase() || h.toLowerCase().includes(potentialCol.toLowerCase()));
        if (matchedCol) {
            operation = 'RESET_FILTER';
            column = matchedCol; // Specific column reset intent
        }
    }
    else if (q.match(/(?:draw|plot|chart|graph|visualize|trend|see\s+trend)/)) operation = 'CHART';
    else if (q.match(/(?:apply|set|add|use)\s+filt[a-z]*|^filter\s+by|^filter/)) operation = 'APPLY_FILTER';
    else if (q.match(/(?:compare|difference|change|vs|versus|better|worse|increase|decrease|growth|drop|rose|fell)/)) operation = 'COMPARE';
    else if (q.match(/(?:switch|change|go|move|open|select)\s+(?:to\s+)?(?:tab|sheet|page)\s*(?:to\s+)?(.+)/)) operation = 'SWITCH_SHEET';
    else if (q.match(/(?:list|show|what)\s+(?:are\s+)?(?:the\s+)?(?:tabs|sheets|pages)/)) operation = 'LIST_SHEETS';
    else if (q.match(/how many unique|count unique|distinct/)) operation = 'UNIQUE';
    else if (q.match(/how many empty|missing|null|blank/)) operation = 'NULL';
    else if (q.match(/sort by|order by/)) operation = 'SORT';
    else if (q.match(/top\s+\d+|bottom\s+\d+|first\s+\d+|last\s+\d+/)) operation = 'TOP';
    else if (q.match(/total|\bsum\b|amount of|how much/)) operation = 'SUM';
    else if (q.match(/how many\s+(\w+)/)) {
        const potentialColumn = q.match(/how many\s+(\w+)/)[1];
        const matchedColumn = headers.find(h => h.toLowerCase().includes(potentialColumn.toLowerCase()));
        const types = analyzeColumns(headers, sourceData);
        if (matchedColumn && types[matchedColumn] === 'number') operation = 'SUM';
        else operation = 'COUNT';
    }
    else if (q.match(/average|avg|mean|typical/)) operation = 'AVG';
    else if (q.match(/count|number of|how many.*rows/)) operation = 'COUNT';
    else if (q.match(/most common|most frequent|most popular|top|mode|common|busy|busiest/)) operation = 'MODE';
    else if (q.match(/max|highest|maximum|most|largest|best|biggest|greatest/)) operation = 'MAX';
    else if (q.match(/min|lowest|minimum|least|worst|bottom/)) operation = 'MIN';
    else if (q.match(/^(?:which|what|show|their|the)\s+([a-z\s]+?)(?:\?|$|\s+(?:are|is|was|were))/i)) {
        operation = 'FOLLOW_UP';
    }
    else if (q.match(/show|find|list|view|only|just|where|contains?|filter/)) operation = 'FILTER';

    // Identify Primary Column
    const candidates = [];
    if (operation !== 'RESET_FILTER' && operation !== 'SWITCH_SHEET' && operation !== 'LIST_SHEETS' && operation !== 'HELP') {
        const sortedHeaders = [...headers].sort((a, b) => b.length - a.length);

        // 1. Direct Header Matches
        for (const h of sortedHeaders) {
            if (q.includes(h.toLowerCase())) {
                candidates.push({ col: h, type: 'direct' });
            }
        }

        // 2. Dictionary Matches
        const dictionary = {
            'revenue': ['revenue', 'sales', 'income', 'turnover', 'amount', 'total', 'billing'],
            'profit': ['profit', 'net income', 'earnings', 'gain', 'margin'],
            'cost': ['cost', 'expense', 'spending', 'cogs', 'fee', 'charge'],
            'date': ['date', 'time', 'year', 'month', 'day', 'period', 'when'],
            'customer': ['customer', 'client', 'buyer', 'account'],
            'product': ['product', 'item', 'goods', 'service', 'project'],
            'region': ['region', 'location', 'area', 'country', 'city', 'state'],
            'status': ['status', 'state', 'condition']
        };

        for (const [key, synonyms] of Object.entries(dictionary)) {
            if (synonyms.some(s => q.includes(s))) {
                const match = headers.find(h => synonyms.some(s => h.toLowerCase().includes(s)));
                if (match && !candidates.some(c => c.col === match)) {
                    candidates.push({ col: match, type: 'dictionary', keyword: key });
                }
            }
        }

        // 3. Fallback Inference
        if (candidates.length === 0 && q.match(/how much|what.*make|money/)) {
            const types = analyzeColumns(headers, sourceData);
            const numericCols = headers.filter(h => types[h] === 'number');
            if (numericCols.length > 0) candidates.push({ col: numericCols[0], type: 'inference' });
        }

        // Select Best Candidate
        if (candidates.length > 0) {
            const getScore = (colName) => {
                const queryWords = q.toLowerCase().split(/\s+/);
                const headerWords = colName.toLowerCase().split(/[_\s-]+/);
                let score = 0;
                headerWords.forEach(hw => {
                    if (queryWords.includes(hw)) score += 2;
                    else if (queryWords.some(qw => qw.includes(hw) || hw.includes(qw))) score += 0.5;
                });
                return score;
            };

            candidates.sort((a, b) => {
                const scoreA = getScore(a.col);
                const scoreB = getScore(b.col);
                if (scoreA !== scoreB) return scoreB - scoreA;
                if (a.type === 'direct' && b.type !== 'direct') return -1;
                if (b.type === 'direct' && a.type !== 'direct') return 1;
                return a.col.length - b.col.length;
            });
            column = candidates[0].col;
        }
    }

    // Context Fallback for Column
    if (!column && context.lastColumn && operation !== 'RESET_FILTER' && operation !== 'SWITCH_SHEET' && operation !== 'HELP') {
        const qWithoutDates = dateRanges.reduce((acc, r) => acc.replace(r.label.toLowerCase(), ''), q.toLowerCase());
        const isDateOnlyQuery = qWithoutDates.trim().length === 0 || qWithoutDates.match(/^(?:in|on|for|from|to|at|by)\s*$/);

        // Don't inherit column if query is just a date filter (implies global filter usually)
        if (!isDateOnlyQuery) {
            column = context.lastColumn;
        }
    }

    // Filter Parsing Logic
    // Detect "for [value]" patterns, numeric comparisons, etc.
    if (!filter) {
        // ... (Simplified logic for brevity, reusing core patterns)
        // 1. "Column = Value"
        if (column) {
            const colName = column.toLowerCase();
            const escCol = colName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`(?:filter\\s+by\\s+)?${escCol}\\s*(?:=|is|:|in)\\s+(.+?)(?:$|\\s+(?:and|or|with|using))`, 'i');
            const match = q.match(regex);
            if (match) filter = { column: column, value: match[1].trim() };
        }

        // 2. Implicit "Value only" search (if not a command)
        if (!filter && !q.match(/^(?:compare|show|what|how)/) && operation === 'UNKNOWN') {
            let cleanQuery = q.replace(/^(?:match|search|find|get|filter|by|only|just|show|me|\s)+/i, '').trim();
            // Try to match against source data
            if (cleanQuery.length > 1) {
                for (const h of headers) {
                    if (sourceData.some(r => String(r[h]).toLowerCase().includes(cleanQuery))) {
                        filter = { column: h, value: cleanQuery };
                        if (operation === 'UNKNOWN') operation = 'APPLY_FILTER';
                        break;
                    }
                }
            }
        }
    }

    // Implicit Sum Inference
    if ((operation === 'UNKNOWN' || operation === 'FILTER') && column && !filter) {
        const types = analyzeColumns(headers, sourceData);
        if (types[column] === 'number') operation = 'SUM';
    }

    // Chart Override
    if ((operation === 'COMPARE' || q.includes('trend')) && segmentBy) {
        operation = 'CHART';
    }

    // Date Override
    if (dateRange && (operation === 'FILTER' || operation === 'UNKNOWN')) {
        operation = 'APPLY_FILTER';
    }

    return { operation, column, dateRange, dateRanges, filter, segmentBy, aggregation };
};
