import { useState, useRef, useEffect } from "react";
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
            // Process Parsing
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

    const executeCommand = (parsed, sourceData, headers) => {
        const { operation, column, filter, aggregation } = parsed;
        let result = [...sourceData];

        // Pre-filter if needed (local filtering simulation)
        if (filter && operation !== 'FILTER' && operation !== 'APPLY_FILTER') {
            result = result.filter(r => String(r[filter.column]).toLowerCase().includes(filter.value.toLowerCase()));
        }

        switch (operation) {
            case 'SUM':
                if (!column) return "Which column should I sum?";
                const sum = result.reduce((acc, row) => acc + (Number(String(row[column]).replace(/[$,]/g, '')) || 0), 0);
                return `Total ${column}: ${formatValue(sum, column)}`;

            case 'AVG':
                if (!column) return "Which column to average?";
                const avg = result.reduce((acc, row) => acc + (Number(String(row[column]).replace(/[$,]/g, '')) || 0), 0) / (result.length || 1);
                return `Average ${column}: ${formatValue(avg, column)}`;

            case 'COUNT':
                return `Count: ${result.length} rows`;

            case 'MAX':
                if (!column) return "Which column?";
                const max = Math.max(...result.map(r => Number(String(r[column]).replace(/[$,]/g, '')) || -Infinity));
                return `Max ${column}: ${formatValue(max, column)}`;

            case 'MIN':
                if (!column) return "Which column?";
                const min = Math.min(...result.map(r => Number(String(r[column]).replace(/[$,]/g, '')) || Infinity));
                return `Min ${column}: ${formatValue(min, column)}`;

            case 'FILTER':
            case 'APPLY_FILTER':
                if (filter && onApplyFilter) {
                    // We can't easily merge filters with just onApplyFilter(col, val) if it expects a full object or single col?
                    // App.jsx: onApplyFilter(col, val) -> updates single column.
                    // If val is null, clears.
                    // Let's assume we pass the single new filter.
                    onApplyFilter(filter.column, filter.value);
                    return `Applied filter: ${filter.column} contains "${filter.value}"`;
                }
                return "I couldn't apply that filter.";

            case 'RESET_FILTER':
                if (onApplyFilter) {
                    // We need a way to clear ALL. App.jsx `onApplyFilter` might handles this if we pass null/empty?
                    // App.jsx: `if (!val) { delete next[col] }`.
                    // To clear ALL, we need to iterate or have a clear function. 
                    // current App.jsx doesn't expose `setColumnFilters` directly to Chatbot via props, only `onApplyFilter` wrapper.
                    // We might need to update App.jsx to pass `setColumnFilters` or a `clearFilters` prop.
                    // For now, prompt user "Use the UI to reset" or we just clear the specific column if mentioned.
                    if (column) {
                        onApplyFilter(column, "");
                        return `Cleared filter for ${column}`;
                    }
                    return "Please use the 'Clear All' button in the dashboard or specify a column to clear.";
                }
                return "Cannot reset filters.";

            case 'CHART':
                if (onUpdateChart) {
                    // This is a placeholder as App.jsx didn't strictly implement onUpdateChart logic yet 
                    // (App.jsx just passed `() => {}`).
                    return "Chart generation is not fully connected yet.";
                }
                return "Charts are not available.";

            default:
                return "I'm not sure how to do that yet. Try Sum, Avg, or Filter.";
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
