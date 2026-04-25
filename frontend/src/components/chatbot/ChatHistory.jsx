import React, { useRef, useEffect } from 'react';
import { DASHBOARD_COPY_EN } from "../../hooks/useDashboardI18n";

export default function ChatHistory({ messages, onApplyFilter, copy = DASHBOARD_COPY_EN, locale = "en" }) {
    const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
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

    const numberToWordsRu = (num) => {
        const ones = ["ноль","один","два","три","четыре","пять","шесть","семь","восемь","девять"];
        const teens = ["десять","одиннадцать","двенадцать","тринадцать","четырнадцать","пятнадцать","шестнадцать","семнадцать","восемнадцать","девятнадцать"];
        const tens = ["","", "двадцать","тридцать","сорок","пятьдесят","шестьдесят","семьдесят","восемьдесят","девяносто"];
        const hundreds = ["","сто","двести","триста","четыреста","пятьсот","шестьсот","семьсот","восемьсот","девятьсот"];
        const under1000 = (n) => {
            const parts = [];
            const h = Math.floor(n / 100);
            const rest = n % 100;
            if (h) parts.push(hundreds[h]);
            if (rest >= 10 && rest < 20) parts.push(teens[rest - 10]);
            else {
                const t = Math.floor(rest / 10);
                const o = rest % 10;
                if (t) parts.push(tens[t]);
                if (o) parts.push(ones[o]);
            }
            return parts.join(" ");
        };
        let n = Math.floor(Math.abs(num));
        if (n === 0) return ones[0];
        const parts = [];
        const millions = Math.floor(n / 1_000_000); n %= 1_000_000;
        const thousands = Math.floor(n / 1_000); n %= 1_000;
        if (millions) parts.push(`${under1000(millions)} миллион`);
        if (thousands) parts.push(`${under1000(thousands)} тысяч`);
        if (n) parts.push(under1000(n));
        return `${num < 0 ? "минус " : ""}${parts.join(" ")}`.trim();
    };

    const numberToWordsUk = (num) => {
        const ones = ["нуль","один","два","три","чотири","пʼять","шість","сім","вісім","девʼять"];
        const teens = ["десять","одинадцять","дванадцять","тринадцять","чотирнадцять","пʼятнадцять","шістнадцять","сімнадцять","вісімнадцять","девʼятнадцять"];
        const tens = ["","", "двадцять","тридцять","сорок","пʼятдесят","шістдесят","сімдесят","вісімдесят","девʼяносто"];
        const hundreds = ["","сто","двісті","триста","чотириста","пʼятсот","шістсот","сімсот","вісімсот","девʼятсот"];
        const under1000 = (n) => {
            const parts = [];
            const h = Math.floor(n / 100);
            const rest = n % 100;
            if (h) parts.push(hundreds[h]);
            if (rest >= 10 && rest < 20) parts.push(teens[rest - 10]);
            else {
                const t = Math.floor(rest / 10);
                const o = rest % 10;
                if (t) parts.push(tens[t]);
                if (o) parts.push(ones[o]);
            }
            return parts.join(" ");
        };
        let n = Math.floor(Math.abs(num));
        if (n === 0) return ones[0];
        const parts = [];
        const millions = Math.floor(n / 1_000_000); n %= 1_000_000;
        const thousands = Math.floor(n / 1_000); n %= 1_000;
        if (millions) parts.push(`${under1000(millions)} мільйон`);
        if (thousands) parts.push(`${under1000(thousands)} тисяч`);
        if (n) parts.push(under1000(n));
        return `${num < 0 ? "мінус " : ""}${parts.join(" ")}`.trim();
    };

    const normalizeSlavicSpeechNumbers = (text, lang) => {
        const toWords = lang === "uk" ? numberToWordsUk : numberToWordsRu;
        return String(text || "").replace(/\b-?\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d+)?\b/g, (raw) => {
            const normalized = raw.replace(/\s/g, "").replace(",", ".");
            const parsed = Number(normalized);
            if (!Number.isFinite(parsed)) return raw;
            const intPart = Math.trunc(parsed);
            const frac = Math.abs(parsed - intPart);
            const base = toWords(intPart);
            if (!frac) return base;
            const fracDigits = String(normalized.split(".")[1] || "");
            return `${base} ${lang === "uk" ? "цілих" : "целых"} ${fracDigits}`;
        });
    };

    const normalizeSlavicPronunciation = (text, lang) => {
        const letterR = lang === "uk" ? "ер" : "эр";
        let out = String(text || "");
        // Convert latin words to cyrillic-ish phonetics so browser TTS does not use English "R".
        out = out.replace(/\b[A-Za-z]{2,}\b/g, (w) => {
            const lower = w.toLowerCase();
            return lower
                .replace(/shch/g, "щ")
                .replace(/zh/g, "ж")
                .replace(/ch/g, "ч")
                .replace(/sh/g, "ш")
                .replace(/kh/g, "х")
                .replace(/ya/g, "я")
                .replace(/yu/g, "ю")
                .replace(/yo/g, "ё")
                .replace(/a/g, "а")
                .replace(/b/g, "б")
                .replace(/c/g, "к")
                .replace(/d/g, "д")
                .replace(/e/g, "е")
                .replace(/f/g, "ф")
                .replace(/g/g, "г")
                .replace(/h/g, "х")
                .replace(/i/g, "и")
                .replace(/j/g, "дж")
                .replace(/k/g, "к")
                .replace(/l/g, "л")
                .replace(/m/g, "м")
                .replace(/n/g, "н")
                .replace(/o/g, "о")
                .replace(/p/g, "п")
                .replace(/q/g, "к")
                .replace(/r/g, "р")
                .replace(/s/g, "с")
                .replace(/t/g, "т")
                .replace(/u/g, "у")
                .replace(/v/g, "в")
                .replace(/w/g, "в")
                .replace(/x/g, "кс")
                .replace(/y/g, "й")
                .replace(/z/g, "з");
        });
        // Standalone Latin R/r (codes, abbreviations) => spoken local letter name.
        out = out.replace(/\b[rR]\b/g, letterR);
        return out;
    };

    const stopCurrentAudio = () => {
        window._stopPlayback = true;
        if (window._audioAbortControllers) {
            window._audioAbortControllers.forEach((controller) => {
                try { controller.abort(); } catch (_) {}
            });
            window._audioAbortControllers = [];
        }
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

        // Prefer native browser voices for Slavic languages to avoid English-accented TTS.
        if (locale === "ru" || locale === "uk") {
            const localVoices = voices.length > 0 ? voices : (synth ? synth.getVoices() : []);
            const hasNativeVoice = localVoices.some(v => {
                const lang = String(v.lang || "").toLowerCase();
                return locale === "ru" ? lang.startsWith("ru") : lang.startsWith("uk");
            });
            if (hasNativeVoice) {
                fallbackSpeak(text, index);
                return;
            }
        }

        try {
            await streamTextToAudio(text);
            if (!window._stopPlayback) setSpeakingIndex(null);
        } catch (err) {
            if (!window._stopPlayback) fallbackSpeak(text, index);
        }
    };

    const streamTextToAudio = async (text) => {
        window._stopPlayback = false;
        window._audioQueue = [];
        window._audioAbortControllers = [];
        const token = window.localStorage.getItem("token");
        const controller = new AbortController();
        window._audioAbortControllers.push(controller);

        const response = await fetch(`${API}/chat/audio`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ text, locale }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`audio_stream_failed_${response.status}`);
        if (!response.body) throw new Error("audio_stream_missing_body");

        if ("MediaSource" in window && MediaSource.isTypeSupported("audio/mpeg")) {
            const mediaSource = new MediaSource();
            const objectUrl = URL.createObjectURL(mediaSource);
            const audio = new Audio();
            audio.src = objectUrl;
            window._currentAudio = audio;
            window._audioQueue.push(audio);

            await new Promise((resolve, reject) => {
                mediaSource.addEventListener("sourceopen", resolve, { once: true });
                mediaSource.addEventListener("error", () => reject(new Error("media_source_error")), { once: true });
            });

            const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
            const reader = response.body.getReader();
            let started = false;
            let done = false;
            const queue = [];
            const maybeEndStream = () => {
                if (done && !queue.length && !sourceBuffer.updating && mediaSource.readyState === "open") {
                    try { mediaSource.endOfStream(); } catch (_) {}
                }
            };

            const flushQueue = () => {
                if (sourceBuffer.updating || !queue.length) return;
                sourceBuffer.appendBuffer(queue.shift());
            };
            sourceBuffer.addEventListener("updateend", () => {
                flushQueue();
                maybeEndStream();
            });

            while (!window._stopPlayback) {
                const { done: streamDone, value } = await reader.read();
                if (streamDone) break;
                if (value?.length) {
                    queue.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
                    flushQueue();
                    if (!started) {
                        started = true;
                        audio.play().catch(() => {});
                    }
                }
            }
            done = true;
            flushQueue();
            maybeEndStream();

            if (!started) {
                URL.revokeObjectURL(objectUrl);
                return;
            }

            await Promise.race([
              new Promise((resolve) => {
                audio.onended = resolve;
                audio.onerror = resolve;
              }),
              new Promise((resolve) => setTimeout(resolve, 15000)),
            ]);
            URL.revokeObjectURL(objectUrl);
            return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        window._currentAudio = audio;
        window._audioQueue.push(audio);
        await new Promise((resolve, reject) => {
            audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
            audio.onerror = reject;
            audio.play().catch(reject);
        });
    };

    const fallbackSpeak = (text, index) => {
        const synth = window.speechSynthesis;
        if (!synth) return;
        const slavicLang = (locale || "en").split("-")[0].toLowerCase();
        const speechText = (slavicLang === "ru" || slavicLang === "uk")
            ? normalizeSlavicPronunciation(normalizeSlavicSpeechNumbers(text, slavicLang), slavicLang)
            : text;
        const utterance = new SpeechSynthesisUtterance(speechText);
        const localeMap = { 'es': 'es-ES', 'uk': 'uk-UA', 'ru': 'ru-RU', 'en': 'en-US' };
        const targetLang = localeMap[locale] || locale || 'en-US';
        utterance.lang = targetLang;
        
        const currentVoices = voices.length > 0 ? voices : synth.getVoices();
        const baseLang = targetLang.split('-')[0].toLowerCase();
        const bestVoice = currentVoices.find(v => v.lang.toLowerCase().startsWith(baseLang));
        if (bestVoice) utterance.voice = bestVoice;
        utterance.rate = (slavicLang === "ru" || slavicLang === "uk") ? 0.88 : 0.95;
        utterance.pitch = 1.0;

        utterance.onend = () => {
            setSpeakingIndex((prev) => (prev === index ? null : prev));
        };
        utterance.onerror = () => {
            setSpeakingIndex((prev) => (prev === index ? null : prev));
        };

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
