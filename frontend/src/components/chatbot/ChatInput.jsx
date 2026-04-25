import React, { useRef, useEffect } from 'react';
import { DASHBOARD_COPY_EN } from "../../hooks/useDashboardI18n";

export default function ChatInput({ input, setInput, handleSend, isOpen, copy = DASHBOARD_COPY_EN }) {
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    return (
        <div className="p-1.5 bg-white border-t border-slate-100">
            <div className="flex gap-1.5">
                <input
                    ref={inputRef}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder-slate-400 text-slate-700 font-medium"
                    placeholder={copy.askQuestion || "Ask a question..."}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                />
                <button
                    onClick={handleSend}
                    className="bg-blue-600 hover:bg-blue-700 text-white w-6 h-6 rounded-md transition-colors flex items-center justify-center shadow-sm self-center"
                    title={copy.send || "Send"}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
            </div>
        </div>
    );
}
