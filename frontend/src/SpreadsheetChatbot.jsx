/**
 * SpreadsheetChatbot — thin wrapper around useChatbotLogic + ChatHistory + ChatInput.
 *
 * The 1769-line inline implementation has been replaced (H2 fix). All analysis logic
 * lives in src/hooks/useChatbotLogic.js and src/utils/chatbotParser.js.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useChatbotLogic } from './hooks/useChatbotLogic';
import ChatHistory from './components/chatbot/ChatHistory';
import ChatInput from './components/chatbot/ChatInput';

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
    activeFilters = {},
    mode = "floating",
}) {
    const inline = mode === "inline";
    const {
        messages,
        input,
        setInput,
        isOpen,
        setIsOpen,
        isMinimized,
        setIsMinimized,
        handleSend,
        messagesEndRef,
        clearMessages,
    } = useChatbotLogic({
        sheetId,
        data,
        headers,
        activeFilters,
        allData,
        onApplyFilter,
        onUpdateChart,
        onSwitchSheet,
        myFiles,
        activeFilename,
    });

    const [chatHeight, setChatHeight] = useState(460);
    const isResizing = useRef(false);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isResizing.current) return;
            // Calculate new height based on mouse Y position (window height - mouseY - bottom margin)
            let newHeight = window.innerHeight - e.clientY - 24; // 24 is roughly bottom-6 (1.5rem)
            // Constrain between reasonable min and max
            newHeight = Math.max(340, Math.min(newHeight, window.innerHeight - 100));
            setChatHeight(newHeight);
        };

        const handleMouseUp = () => {
            if (isResizing.current) {
                isResizing.current = false;
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

    const handleMouseDown = (e) => {
        if (isMinimized) return;
        isResizing.current = true;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none'; // prevent text selection while dragging
    };

    useEffect(() => {
        if (!inline) return;
        if (!isOpen) setIsOpen(true);
        if (isMinimized) setIsMinimized(false);
    }, [inline, isOpen, isMinimized, setIsOpen, setIsMinimized]);

    if (!data || data.length === 0) return null;

    if (inline) {
        return (
            <section className="h-full min-h-[420px] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex-1 min-h-0 flex flex-col">
                    <ChatHistory
                        messages={messages}
                        onApplyFilter={onApplyFilter}
                    />
                    <div className="border-t border-slate-200 bg-white">
                        <ChatInput
                            input={input}
                            setInput={setInput}
                            handleSend={handleSend}
                            isOpen={true}
                        />
                    </div>
                </div>
            </section>
        );
    }

    return (
        <>
            {/* Floating Chat Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-8 right-8 w-14 h-14 bg-indigo-600 text-white rounded-2xl shadow-2xl shadow-indigo-200 hover:bg-indigo-700 hover:scale-110 transition-all z-40 flex items-center justify-center focus:outline-none group animate-in slide-in-from-right-8 duration-500"
                    title="Open Data Assistant"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-12 transition-transform">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white"></span>
                </button>
            )}

            {/* Chat Panel */}
            {isOpen && (
                <div 
                    className="fixed bottom-8 right-8 w-[20rem] glass rounded-[1.75rem] flex flex-col z-[60] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 fade-in duration-500"
                    style={{ height: isMinimized ? 'auto' : `${chatHeight}px` }}
                >
                    {/* Draggable Top Handle */}
                    {!isMinimized && (
                        <div 
                            className="w-full h-3 cursor-ns-resize hover:bg-white/40 transition-colors absolute top-0 left-0 right-0 z-[70] flex items-center justify-center opacity-0 hover:opacity-100"
                            onMouseDown={handleMouseDown}
                        >
                            <div className="w-12 h-1 bg-slate-400/50 rounded-full"></div>
                        </div>
                    )}

                    {/* Header */}
                    <div
                        className="bg-indigo-600 text-white px-4 py-3 flex justify-between items-center cursor-pointer select-none"
                        onClick={() => setIsMinimized(!isMinimized)}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center backdrop-blur-md border border-white/20">
                                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2a10 10 0 1 0 10 10H12V2Z"></path>
                                    <path d="M12 12L2.1 11.9"></path>
                                    <path d="M12 2a10 10 0 0 1 10 10h-10V2Z"></path>
                                </svg>
                            </div>
                            <div>
                                <h3 className="font-bold text-xs tracking-tight leading-none mb-1">Data Assistant</h3>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                    <span className="text-[9px] font-bold text-indigo-100 uppercase tracking-widest">Online</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2 items-center">
                            <button
                                onClick={(e) => { e.stopPropagation(); clearMessages(); }}
                                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition-all flex items-center justify-center"
                                title="Reset Chat"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                    <path d="M3 3v5h5"></path>
                                </svg>
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
                                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition-all flex items-center justify-center"
                                title={isMinimized ? 'Expand' : 'Collapse'}
                            >
                                {isMinimized ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="15 3 21 3 21 9"></polyline>
                                        <polyline points="9 21 3 21 3 15"></polyline>
                                        <line x1="21" y1="3" x2="14" y2="10"></line>
                                        <line x1="3" y1="21" x2="10" y2="14"></line>
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="5" y1="12" x2="19" y2="12"></line>
                                    </svg>
                                )}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-red-500/80 transition-all flex items-center justify-center"
                                title="Close"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Body — only when not minimized */}
                    {!isMinimized && (
                        <div className="flex-1 flex flex-col min-h-0 bg-white/30 backdrop-blur-md">
                            <ChatHistory 
                                messages={messages} 
                                onApplyFilter={onApplyFilter}
                            />
                            <div className="p-4 bg-white/50 border-t border-slate-200/50">
                                <ChatInput
                                    input={input}
                                    setInput={setInput}
                                    handleSend={handleSend}
                                    isOpen={isOpen}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
