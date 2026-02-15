import React, { useRef, useEffect } from 'react';

export default function ChatHistory({ messages }) {
    const messagesEndRef = useRef(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    return (
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
    );
}
