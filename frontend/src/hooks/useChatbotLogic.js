import { useState, useRef, useEffect, useCallback } from "react";
import { parseQuery } from "../utils/chatbotParser";
import { formatValue, isNumericColumn, isDateColumn, excelDateToJSDate } from "../utils/chatbotUtils";

export function useChatbotLogic({ data, headers, allData, onApplyFilter, onUpdateChart, onSwitchSheet, myFiles, activeFilename }) {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [context, setContext] = useState({}); // Conversation memory

    const messagesEndRef = useRef(null);

    // Initial Welcome
    useEffect(() => {
        if (messages.length === 0 && headers.length > 0) {
            setMessages([{
                type: 'bot',
                text: "Hi! I can help you analyze your data. Try asking:\n• \"Filter by Region West\"\n• \"Show top 5 Revenue\"\n• \"Sum of Cost\"",
                timestamp: new Date()
            }]);
        }
    }, [headers, messages.length]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    // executeCommand must be declared BEFORE handleSend (no hoisting for const/useCallback)
    const executeCommand = useCallback((parsed, sourceData, hdrs) => {
        const { operation, column, filter, dateRange, segmentBy } = parsed;
        let result = [...sourceData];

        // Pre-filter by date range (e.g. "in 2022", "last year")
        if (dateRange) {
            // Find a date column: prefer one explicitly matching the query column,
            // otherwise pick the first header that looks like a date column
            const dateCol = hdrs.find(h => isDateColumn(h, hdrs, sourceData))
                || hdrs.find(h => /date|month|year|period|time/i.test(h));
            if (dateCol) {
                result = result.filter(r => {
                    const raw = r[dateCol];
                    if (raw == null || raw === '') return false;
                    let d;
                    const n = Number(raw);
                    if (!isNaN(n) && n > 35000 && n < 60000) {
                        d = excelDateToJSDate(n);
                    } else {
                        d = new Date(raw);
                    }
                    if (isNaN(d.getTime())) return false;
                    return d >= dateRange.start && d <= dateRange.end;
                });
            }
        }

        // Pre-filter if a non-date filter was also present (non-FILTER operations)
        if (filter && operation !== 'FILTER' && operation !== 'APPLY_FILTER') {
            result = result.filter(r => String(r[filter.column]).toLowerCase().includes(filter.value.toLowerCase()));
        }

        const dateLabel = dateRange ? ` (${dateRange.label})` : '';

        switch (operation) {
            case 'SUM':
                if (!column) return "Which column should I sum?";
                const sum = result.reduce((acc, row) => acc + (Number(String(row[column]).replace(/[$,]/g, '')) || 0), 0);
                return `Total ${column}${dateLabel}: ${formatValue(sum, column)}`;

            case 'AVG':
                if (!column) return "Which column to average?";
                const avg = result.reduce((acc, row) => acc + (Number(String(row[column]).replace(/[$,]/g, '')) || 0), 0) / (result.length || 1);
                return `Average ${column}${dateLabel}: ${formatValue(avg, column)}`;

            case 'COUNT':
                return `Count${dateLabel}: ${result.length} rows`;

            case 'MAX':
                if (!column) return "Which column?";
                const max = Math.max(...result.map(r => Number(String(r[column]).replace(/[$,]/g, '')) || -Infinity));
                return `Max ${column}${dateLabel}: ${formatValue(max, column)}`;

            case 'MIN':
                if (!column) return "Which column?";
                const min = Math.min(...result.map(r => Number(String(r[column]).replace(/[$,]/g, '')) || Infinity));
                return `Min ${column}${dateLabel}: ${formatValue(min, column)}`;

            case 'MODE': {
                if (!column) return "Which column?";
                const freq = {};
                result.forEach(r => { const v = String(r[column]); freq[v] = (freq[v] || 0) + 1; });
                const topVal = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
                return topVal ? `Most common ${column}: "${topVal[0]}" (${topVal[1]} times)` : "No data.";
            }

            case 'TOP': {
                const rawQ = filter?.value || column || '';
                const nMatch = String(rawQ).match(/(\d+)/);
                const n = nMatch ? parseInt(nMatch[1]) : 5;
                if (!column) return `Showing top ${n} rows (no numeric column specified).`;
                const sorted = [...result].sort((a, b) =>
                    (Number(String(b[column]).replace(/[$,]/g, '')) || 0) - (Number(String(a[column]).replace(/[$,]/g, '')) || 0)
                ).slice(0, n);
                return `Top ${n} by ${column}:\n` + sorted.map((r, i) =>
                    `${i + 1}. ${formatValue(Number(String(r[column]).replace(/[$,]/g, '')), column)}`
                ).join('\n');
            }

            case 'UNIQUE': {
                if (!column) return "Which column should I count unique values for?";
                const unique = new Set(result.map(r => String(r[column])));
                return `Unique values in ${column}: ${unique.size}`;
            }

            case 'NULL': {
                if (!column) {
                    const counts = hdrs.map(h => ({
                        col: h,
                        n: result.filter(r => r[h] == null || String(r[h]).trim() === '').length
                    })).filter(x => x.n > 0);
                    if (!counts.length) return "No empty cells found.";
                    return "Empty cells per column:\n" + counts.map(x => `• ${x.col}: ${x.n}`).join('\n');
                }
                const nullCount = result.filter(r => r[column] == null || String(r[column]).trim() === '').length;
                return `Empty/null values in ${column}: ${nullCount} of ${result.length} rows`;
            }

            case 'SORT':
                return column
                    ? `To sort by ${column}, click the "${column}" column header in the table.`
                    : "To sort, click any column header in the table.";

            case 'COMPARE':
                return column
                    ? `Comparison across ${column}: use the Trends or Two-Condition overlays in the Chart menu for visual comparison.`
                    : "Use the Chart menu to compare data across dimensions.";

            case 'FILTER':
            case 'APPLY_FILTER':
                if (filter && onApplyFilter) {
                    onApplyFilter(filter.column, filter.value);
                    return `Applied filter: ${filter.column} contains "${filter.value}"`;
                }
                return "I couldn't apply that filter.";

            case 'RESET_FILTER':
                if (onApplyFilter) {
                    if (column) {
                        onApplyFilter(column, "");
                        return `Cleared filter for ${column}`;
                    }
                    return "Please use the 'Clear All' button in the dashboard or specify a column to clear.";
                }
                return "Cannot reset filters.";

            case 'SWITCH_SHEET':
                if (onSwitchSheet && myFiles?.length) {
                    const q = filter?.value || column || '';
                    const match = myFiles.find(f =>
                        (f.filename || f.name || '').toLowerCase().includes(q.toLowerCase())
                    );
                    if (match) {
                        onSwitchSheet(match.id);
                        return `Switching to sheet: ${match.filename || match.name}`;
                    }
                    return `No sheet found matching "${q}". Available: ${myFiles.map(f => f.filename || f.name).join(', ')}`;
                }
                return "Cannot switch sheets from here.";

            case 'LIST_SHEETS':
                if (myFiles?.length) {
                    return `Available sheets:\n` + myFiles.map((f, i) =>
                        `${i + 1}. ${f.filename || f.name}${f.filename === activeFilename ? ' ← active' : ''}`
                    ).join('\n');
                }
                return "No sheets available.";

            case 'FOLLOW_UP':
            case 'QUESTION':
                return context.lastColumn
                    ? `Let me try that with ${context.lastColumn}. Try a specific operation like "Sum of ${context.lastColumn}" or "Filter by ${context.lastColumn} = value".`
                    : "Could you be more specific? For example: \"Sum of Revenue\" or \"Filter by Region = West\".";

            case 'CHART': {
                const colTypes = analyzeColumns(hdrs, sourceData);
                const dateCols = hdrs.filter(h => colTypes[h] === 'date' || /date|month|year|period|time/i.test(h));
                const numCols = hdrs.filter(h => colTypes[h] === 'number');

                let dateColumn = null;
                let valueColumn = null;
                let groupBy = null;

                // Classify columns the parser detected
                if (column && colTypes[column] === 'date') dateColumn = column;
                else if (column && colTypes[column] === 'number') valueColumn = column;

                if (segmentBy && colTypes[segmentBy] === 'date' && !dateColumn) dateColumn = segmentBy;
                else if (segmentBy && colTypes[segmentBy] === 'number' && !valueColumn) valueColumn = segmentBy;
                else if (segmentBy) groupBy = segmentBy;

                // Fallback to first available of each type
                if (!dateColumn) dateColumn = dateCols[0] || null;
                if (!valueColumn) valueColumn = numCols[0] || null;

                if (!dateColumn && !valueColumn) {
                    return `To draw a chart I need a date column and a numeric column.\n` +
                        `Date columns available: ${dateCols.join(', ') || 'none found'}\n` +
                        `Numeric columns available: ${numCols.join(', ') || 'none found'}\n\n` +
                        `Try: "trend [date col] [value col]"`;
                }
                if (!valueColumn) {
                    return `Which value should I plot?\nNumeric columns: ${numCols.join(', ')}\nTry: "trend ${dateColumn} [value col]"`;
                }
                if (!dateColumn) {
                    return `Which date axis should I use?\nDate columns: ${dateCols.join(', ')}\nTry: "trend [date col] ${valueColumn}"`;
                }

                if (onUpdateChart) {
                    onUpdateChart({ dateColumn, valueColumn, segmentBy: groupBy, aggregation: parsed.aggregation || 'sum' });
                }
                return `📈 Drawing trend chart: ${valueColumn} over ${dateColumn}${groupBy ? ` grouped by ${groupBy}` : ''}.`;
            }

            default:
                return "I'm not sure how to do that yet. Try: Sum, Avg, Count, Max, Min, Filter, Top 5, Unique, or Trends.";
        }
    }, [context, onApplyFilter, onUpdateChart, onSwitchSheet, myFiles, activeFilename]);

    const handleSend = async () => {
        if (!input.trim()) return;

        const userMsg = { type: 'user', text: input, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        const currentInput = input;
        setInput("");

        // Small Talk
        const smallTalk = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'great'];
        if (smallTalk.includes(currentInput.toLowerCase().replace(/[!.?]/g, ''))) {
            setTimeout(() => {
                setMessages(prev => [...prev, { type: 'bot', text: '👋 Hello! How can I assist you with your data?', timestamp: new Date() }]);
            }, 500);
            return;
        }

        try {
            const sourceData = (allData && allData.length > 0) ? allData : data;
            const parsed = parseQuery(currentInput, headers, data, allData, context);

            // Update Context
            if (parsed.column) setContext(prev => ({ ...prev, lastColumn: parsed.column }));
            if (parsed.operation && parsed.operation !== 'UNKNOWN') setContext(prev => ({ ...prev, lastOperation: parsed.operation }));

            const response = executeCommand(parsed, sourceData, headers);

            setMessages(prev => [...prev, { type: 'bot', text: response, timestamp: new Date() }]);

        } catch (e) {
            console.error(e);
            setMessages(prev => [...prev, { type: 'bot', text: "Sorry, I encountered an error processing that.", timestamp: new Date() }]);
        }
    };

    return {
        messages,
        input,
        setInput,
        isOpen,
        setIsOpen,
        isMinimized,
        setIsMinimized,
        handleSend,
        messagesEndRef
    };
}
