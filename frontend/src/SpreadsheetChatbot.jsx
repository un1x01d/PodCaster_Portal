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
}) {
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
        data,
        headers,
        allData,
        onApplyFilter,
        onUpdateChart,
        onSwitchSheet,
        myFiles,
        activeFilename,
    });

    const [chatHeight, setChatHeight] = useState(320);
    const isResizing = useRef(false);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isResizing.current) return;
            // Calculate new height based on mouse Y position (window height - mouseY - bottom margin)
            let newHeight = window.innerHeight - e.clientY - 24; // 24 is roughly bottom-6 (1.5rem)
            // Constrain between reasonable min and max
            newHeight = Math.max(250, Math.min(newHeight, window.innerHeight - 100));
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </button>
            )}

            {/* Chat Panel */}
            {isOpen && (
                <div 
                    className="fixed bottom-6 right-6 w-96 bg-white rounded-xl shadow-2xl flex flex-col z-40 border border-slate-200 font-sans overflow-hidden ring-1 ring-black/5"
                    style={{ height: isMinimized ? 'auto' : `${chatHeight}px` }}
                >
                    {/* Draggable Top Handle */}
                    {!isMinimized && (
                        <div 
                            className="w-full h-2 cursor-ns-resize hover:bg-slate-300 transition-colors absolute top-0 left-0 right-0 z-50 flex items-center justify-center opacity-0 hover:opacity-100"
                            onMouseDown={handleMouseDown}
                        >
                            <div className="w-10 h-1 bg-slate-400 rounded-full"></div>
                        </div>
                    )}

                    {/* Header */}
                    <div
                        className="bg-slate-900 text-white px-3 py-2 border-b border-slate-800 flex justify-between items-center shadow-sm cursor-pointer select-none relative"
                        onDoubleClick={() => setIsMinimized(!isMinimized)}
                    >
                        <div className="flex items-center gap-2">
                            <div className="w-5 h-5 bg-indigo-500 rounded flex items-center justify-center shadow-inner">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </div>
                            <span className="font-medium text-xs tracking-wide">Data Assistant</span>
                        </div>
                        <div className="flex gap-1.5 items-center">
                            <button
                                onClick={(e) => { e.stopPropagation(); clearMessages(); }}
                                className="text-slate-400 hover:text-red-400 transition-colors p-0.5"
                                title="Reset Chat"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                    <path d="M3 3v5h5"></path>
                                </svg>
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}
                                className="text-slate-400 hover:text-white transition-colors p-0.5"
                                title={isMinimized ? 'Maximize' : 'Minimize'}
                            >
                                {isMinimized ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="5" y1="12" x2="19" y2="12"></line>
                                    </svg>
                                )}
                            </button>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-slate-400 hover:text-white transition-colors p-0.5"
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
                        <>
                            <ChatHistory 
                                messages={messages} 
                                onApplyFilter={onApplyFilter}
                            />
                            <ChatInput
                                input={input}
                                setInput={setInput}
                                handleSend={handleSend}
                                isOpen={isOpen}
                            />
                        </>
                    )}
                </div>
            )}
        </>
    );
}
