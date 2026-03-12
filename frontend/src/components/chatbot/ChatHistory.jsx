import React, { useRef, useEffect } from 'react';

export default function ChatHistory({ messages, onApplyFilter }) {
    const messagesEndRef = useRef(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    return (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 bg-slate-50/50">
            {messages.map((msg, i) => {
                // Parse **bold** syntax into React elements
                const parts = msg.text.split(/(\*\*.*?\*\*)/g);
                
                return (
                    <div key={i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-sm ${msg.type === 'user'
                            ? 'bg-blue-600 text-white rounded-tr-sm'
                            : 'bg-white text-slate-600 border border-slate-200 rounded-tl-sm'
                            }`}>
                            <div className="whitespace-pre-wrap font-medium">
                                {parts.map((part, index) => {
                                    if (part.startsWith('**') && part.endsWith('**')) {
                                        return <strong key={index} className="font-bold text-slate-800">{part.slice(2, -2)}</strong>;
                                    }
                                    return <span key={index}>{part}</span>;
                                })}
                            </div>
                            {msg.isFilter && msg.filterCol && onApplyFilter && (
                                <div className="mt-2 pt-2 border-t border-slate-100/50">
                                    <button
                                        onClick={() => onApplyFilter(msg.filterCol, "")}
                                        className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 hover:underline transition-colors flex items-center gap-1"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                            <path d="M3 3v5h5"></path>
                                        </svg>
                                        Revert Filter
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
            <div ref={messagesEndRef} />
        </div>
    );
}
