/**
 * SpreadsheetChatbot — thin wrapper around useChatbotLogic + ChatHistory + ChatInput.
 */
import React, { useState, useRef, useEffect } from "react";
import ChatHistory from './components/chatbot/ChatHistory';
import ChatInput from './components/chatbot/ChatInput';
import { useChatbotLogic } from './hooks/useChatbotLogic';
import { DASHBOARD_COPY_EN } from "./hooks/useDashboardI18n";

export default function SpreadsheetChatbot({
    sheetId,
    activeFilename,
    myFiles,
    onSwitchSheet,
    data,
    headers,
    onApplyFilter,
    allData,
    onUpdateChart,
    activeTab,
    activeFilters = {},
    mode = "floating",
    locale = "en",
    copy = DASHBOARD_COPY_EN,
}) {
    const ui = copy || DASHBOARD_COPY_EN;
    const inline = mode === "inline";
    const chatData = Array.isArray(data) && data.length ? data : (Array.isArray(allData) ? allData : []);

    const {
        messages, input, setInput, isOpen, setIsOpen, isMinimized, setIsMinimized,
        handleSend, messagesEndRef, clearMessages,
    } = useChatbotLogic({
        sheetId, data: chatData, headers, activeFilters, allData, onApplyFilter,
        onUpdateChart, onSwitchSheet, myFiles, activeFilename, activeTab, locale, copy: ui,
    });

    const [chatSize, setChatSize] = useState({ width: 320, height: 460 });
    const isResizing = useRef(null);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isResizing.current) return;
            setChatSize(prev => {
                const next = { ...prev };
                if (isResizing.current === 'height' || isResizing.current === 'both') {
                    let newHeight = window.innerHeight - e.clientY - 24;
                    next.height = Math.max(340, Math.min(newHeight, window.innerHeight - 100));
                }
                if (isResizing.current === 'width' || isResizing.current === 'both') {
                    let newWidth = window.innerWidth - e.clientX - 24;
                    next.width = Math.max(280, Math.min(newWidth, window.innerWidth - 100));
                }
                return next;
            });
        };
        const handleMouseUp = () => {
            if (isResizing.current) {
                isResizing.current = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const startResizing = (type) => (e) => {
        if (isMinimized) return;
        isResizing.current = type;
        document.body.style.cursor = type === 'both' ? 'nwse-resize' : type === 'width' ? 'ew-resize' : 'ns-resize';
        document.body.style.userSelect = 'none';
    };

    if (!sheetId) return null;

    if (inline) {
        return (
            <section className="h-full max-h-full flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                    <ChatHistory messages={messages} onApplyFilter={onApplyFilter} copy={ui} locale={locale} />
                    <div className="border-t border-slate-200 bg-white flex-shrink-0">
                        <ChatInput input={input} setInput={setInput} handleSend={handleSend} isOpen={true} copy={ui} />
                    </div>
                </div>
            </section>
        );
    }

    return (
        <>
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 text-white rounded-2xl shadow-2xl z-[120] flex items-center justify-center hover:scale-110 transition-all"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                </button>
            )}

            {isOpen && (
                <div 
                    className="fixed bottom-6 right-6 glass rounded-[1.75rem] flex flex-col z-[130] shadow-2xl overflow-hidden"
                    style={{ 
                        height: isMinimized ? 'auto' : `${chatSize.height}px`,
                        maxHeight: 'calc(100vh - 48px)',
                        width: isMinimized ? '20rem' : `${chatSize.width}px`,
                        maxWidth: 'calc(100vw - 48px)'
                    }}
                >
                    {!isMinimized && (
                        <>
                            <div className="w-full h-2 cursor-ns-resize absolute top-0 left-0 right-0 z-[70]" onMouseDown={startResizing('height')} />
                            <div className="h-full w-2 cursor-ew-resize absolute top-0 left-0 bottom-0 z-[70]" onMouseDown={startResizing('width')} />
                            <div className="w-4 h-4 cursor-nwse-resize absolute top-0 left-0 z-[80]" onMouseDown={startResizing('both')} />
                        </>
                    )}

                    <div className="bg-indigo-600 text-white px-4 py-3 flex justify-between items-center cursor-pointer select-none" onClick={() => setIsMinimized(!isMinimized)}>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                            <span className="font-bold text-xs uppercase tracking-widest">{ui.dataAssistant}</span>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }} className="hover:bg-white/20 p-1 rounded transition-colors text-white">
                                {isMinimized ? "▲" : "▼"}
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} className="hover:bg-white/20 p-1 rounded transition-colors text-white">✕</button>
                        </div>
                    </div>

                    {!isMinimized && (
                        <div className="flex-1 flex flex-col min-h-0 bg-white/30 backdrop-blur-md relative z-[100] overflow-hidden">
                            <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                                <ChatHistory messages={messages} onApplyFilter={onApplyFilter} copy={ui} locale={locale} />
                            </div>
                            <div className="p-4 bg-white/50 border-t border-slate-200/50 flex-shrink-0">
                                <ChatInput input={input} setInput={setInput} handleSend={handleSend} isOpen={isOpen} copy={ui} />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
