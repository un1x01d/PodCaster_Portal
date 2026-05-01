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
    splitContext = null,
    activeViewScope = null,
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
        onUpdateChart, onSwitchSheet, myFiles, activeFilename, activeTab, splitContext, activeViewScope, locale, copy: ui,
    });

    const [chatSize, setChatSize] = useState({ width: 300, height: 420 });
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
            <section className="h-full max-h-full min-h-0 flex flex-col rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden">
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
                    className="fixed bottom-5 right-5 w-11 h-11 bg-slate-900 text-white rounded-md shadow-lg z-[120] flex items-center justify-center hover:bg-slate-800 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                </button>
            )}

            {isOpen && (
                <div 
                    className="fixed bottom-5 right-5 flex flex-col z-[130] shadow-lg overflow-hidden bg-white border border-slate-300 rounded-md"
                    style={{ 
                        height: isMinimized ? 'auto' : `${chatSize.height}px`,
                        maxHeight: 'calc(100vh - 40px)',
                        width: isMinimized ? '18rem' : `${chatSize.width}px`,
                        maxWidth: 'calc(100vw - 40px)'
                    }}
                >
                    {!isMinimized && (
                        <>
                            <div className="w-full h-2 cursor-ns-resize absolute top-0 left-0 right-0 z-[70]" onMouseDown={startResizing('height')} />
                            <div className="h-full w-2 cursor-ew-resize absolute top-0 left-0 bottom-0 z-[70]" onMouseDown={startResizing('width')} />
                            <div className="w-4 h-4 cursor-nwse-resize absolute top-0 left-0 z-[80]" onMouseDown={startResizing('both')} />
                        </>
                    )}

                    <div className="cursor-pointer select-none border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-indigo-50 px-2.5 py-1.5 flex items-center justify-between" onClick={() => setIsMinimized(!isMinimized)}>
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_0_3px_rgba(79,70,229,0.12)]"></div>
                            <div className="min-w-0">
                                <div className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-700 leading-none">{ui.dataAssistant}</div>
                                <div className="text-[9px] font-medium text-slate-500 mt-0.5 leading-none">Workspace assistant</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }} className="w-6 h-6 inline-flex items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors" aria-label={isMinimized ? "Expand chat" : "Minimize chat"}>
                                {isMinimized ? "▲" : "▼"}
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} className="w-6 h-6 inline-flex items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-500 hover:text-rose-600 hover:border-rose-200 transition-colors" aria-label="Close chat">✕</button>
                        </div>
                    </div>

                    {!isMinimized && (
                        <div className="flex-1 flex flex-col min-h-0 bg-white relative z-[100] overflow-hidden">
                            <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                                <ChatHistory messages={messages} onApplyFilter={onApplyFilter} copy={ui} locale={locale} />
                            </div>
                            <div className="p-2.5 bg-white border-t border-slate-200 flex-shrink-0">
                                <ChatInput input={input} setInput={setInput} handleSend={handleSend} isOpen={isOpen} copy={ui} />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
