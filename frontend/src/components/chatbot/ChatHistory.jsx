import React, { useRef, useEffect } from 'react';
import api from "../../api";
import { DASHBOARD_COPY_EN } from "../../hooks/useDashboardI18n";

export default function ChatHistory({ messages, onApplyFilter, copy = DASHBOARD_COPY_EN, locale = "en" }) {
    const containerRef = useRef(null);
    const [speakingIndex, setSpeakingIndex] = React.useState(null);
    const utteranceRef = useRef(null);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [messages]);

    const [voices, setVoices] = React.useState([]);

    useEffect(() => {
        const synth = window.speechSynthesis;
        if (!synth) return;
        const updateVoices = () => {
            const v = synth.getVoices();
            if (v.length > 0) setVoices(v);
        };
        updateVoices();
        if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = updateVoices;
    }, []);

    const stopCurrentAudio = () => {
        window._stopPlayback = true;
        if (window._audioQueue) {
            window._audioQueue.forEach(a => { a.pause(); a.src = ""; });
            window._audioQueue = [];
        }
        if (window._currentAudio) {
            window._currentAudio.pause();
            window._currentAudio.src = "";
            window._currentAudio = null;
        }
        const synth = window.speechSynthesis;
        if (synth) synth.cancel();
    };

    const handleSpeak = async (text, index) => {
        const synth = window.speechSynthesis;
        if (synth) synth.cancel();

        if (speakingIndex === index) {
            stopCurrentAudio();
            setSpeakingIndex(null);
            return;
        }

        stopCurrentAudio();
        setSpeakingIndex(index);

        const chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
        try {
            await playChunksSequentially(chunks, index);
        } catch (err) {
            if (!window._stopPlayback) fallbackSpeak(text, index);
        }
    };

    const playChunksSequentially = async (chunks, index) => {
        window._stopPlayback = false;
        window._audioQueue = [];
        const preFetchedUrls = new Map();

        const fetchChunk = async (t) => {
            const response = await api.post("/chat/audio", { text: t, locale }, { responseType: 'blob' });
            return URL.createObjectURL(response.data);
        };

        const activeChunks = chunks.map(c => c.trim()).filter(Boolean);
        for (let i = 0; i < activeChunks.length; i++) {
            if (window._stopPlayback) break;
            const chunkText = activeChunks[i];
            
            let url = preFetchedUrls.get(i);
            if (!url) {
                try { url = await fetchChunk(chunkText); } catch (e) { continue; }
            }

            if (i + 1 < activeChunks.length && !preFetchedUrls.has(i + 1)) {
                (async () => {
                    try {
                        const nextUrl = await fetchChunk(activeChunks[i + 1]);
                        preFetchedUrls.set(i + 1, nextUrl);
                    } catch (e) {}
                })();
            }

            const audio = new Audio(url);
            window._currentAudio = audio;
            window._audioQueue.push(audio);

            await new Promise((resolve, reject) => {
                audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
                audio.onerror = reject;
                audio.play().catch(reject);
            });
        }
        preFetchedUrls.forEach(url => URL.revokeObjectURL(url));
        if (!window._stopPlayback) setSpeakingIndex(null);
    };

    const fallbackSpeak = (text, index) => {
        const synth = window.speechSynthesis;
        if (!synth) return;
        const utterance = new SpeechSynthesisUtterance(text);
        const localeMap = { 'es': 'es-ES', 'uk': 'uk-UA', 'ru': 'ru-RU', 'en': 'en-US' };
        const targetLang = localeMap[locale] || locale || 'en-US';
        utterance.lang = targetLang;
        
        const currentVoices = voices.length > 0 ? voices : synth.getVoices();
        const baseLang = targetLang.split('-')[0].toLowerCase();
        const bestVoice = currentVoices.find(v => v.lang.toLowerCase().startsWith(baseLang));
        if (bestVoice) utterance.voice = bestVoice;

        synth.speak(utterance);
    };

    return (
        <div ref={containerRef} className="flex-1 overflow-y-auto p-2 space-y-2 bg-slate-50/50 min-h-0">
            {messages.map((msg, i) => {
                const isSpeaking = speakingIndex === i;
                return (
                    <div key={i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} mb-1`}>
                        <div className={`max-w-[90%] rounded-xl px-2.5 py-1.5 text-[11px] leading-snug shadow-sm group relative transition-all break-words overflow-wrap-anywhere ${
                            msg.type === 'user' ? 'bg-blue-600 text-white rounded-tr-sm' : `bg-white text-slate-600 border border-slate-200 rounded-tl-sm pr-8 ${isSpeaking ? 'bg-indigo-50/30' : ''}`
                        }`}>
                            {msg.type === 'bot' && (
                                <button 
                                    onClick={() => handleSpeak(msg.text, i)}
                                    className={`absolute right-1.5 top-1.5 w-6 h-6 rounded-full flex items-center justify-center transition-all shadow-md z-[120] cursor-pointer ${isSpeaking ? 'bg-orange-500 text-white' : 'bg-white text-slate-400 border border-slate-100 opacity-0 group-hover:opacity-100 hover:text-indigo-600'}`}
                                >
                                    {isSpeaking ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                                    )}
                                </button>
                            )}
                            <div className="whitespace-pre-wrap font-medium">{msg.text}</div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
