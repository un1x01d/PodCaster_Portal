import React, { useRef, useEffect } from 'react';
import { DASHBOARD_COPY_EN } from "../../hooks/useDashboardI18n";

const CHAT_AUDIO_CACHE_NAME = "dashboard-chat-audio-v1";
const CHAT_AUDIO_RECENT_KEY = "dashboard-chat-audio-recent-v1";
const CHAT_AUDIO_RECENT_LIMIT = 5;

export default function ChatHistory({ messages, onApplyFilter, copy = DASHBOARD_COPY_EN, locale = "en" }) {
    const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
    const containerRef = useRef(null);
    const [speakingIndex, setSpeakingIndex] = React.useState(null);
    const [chatAudioEnabled, setChatAudioEnabled] = React.useState(false);
    const utteranceRef = useRef(null);
    const readCookie = (name) => {
        if (typeof document === "undefined") return "";
        const prefix = `${name}=`;
        const hit = document.cookie
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith(prefix));
        return hit ? decodeURIComponent(hit.slice(prefix.length)) : "";
    };
    const formatMessageForDisplay = (text = "") => {
        let out = String(text || "");
        out = out.replace(/\\r?\\n/g, "\n");
        out = out.replace(/\s+\*\*([^*\n:]{1,80}):\*\*/g, "\n$1:");
        out = out.replace(/\*\*([^*\n]+)\*\*/g, "$1");
        // Turn inline dash lists into real bullet lines:
        // "... shows: - A - B - C" -> "... shows:\n- A\n- B\n- C"
        out = out.replace(/([:])\s+-\s+/g, "$1\n- ");
        out = out.replace(/\s+-\s+(?=\S)/g, "\n- ");
        return out;
    };

    const normalizeCacheText = (text = "") => String(text || "").trim().replace(/\s+/g, " ");

    const getAudioCacheKey = async (text = "", lang = "en") => {
        const raw = `${String(lang || "en").toLowerCase()}::${normalizeCacheText(text)}`;
        if (!raw.trim()) return "";
        if (window.crypto?.subtle?.digest) {
            const bytes = new TextEncoder().encode(raw);
            const digest = await window.crypto.subtle.digest("SHA-256", bytes);
            return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
        }
        return raw;
    };

    const readRecentAudioKeys = () => {
        try {
            const raw = window.localStorage.getItem(CHAT_AUDIO_RECENT_KEY);
            const parsed = JSON.parse(raw || "[]");
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch {
            return [];
        }
    };

    const writeRecentAudioKeys = (keys) => {
        try {
            window.localStorage.setItem(CHAT_AUDIO_RECENT_KEY, JSON.stringify((keys || []).slice(0, CHAT_AUDIO_RECENT_LIMIT)));
        } catch {
            // ignore storage errors
        }
    };

    const rememberRecentAudioKey = (key) => {
        if (!key) return;
        const next = [key, ...readRecentAudioKeys().filter((item) => item !== key)].slice(0, CHAT_AUDIO_RECENT_LIMIT);
        writeRecentAudioKeys(next);
    };

    const cacheAudioBlob = async (cacheKey, blob) => {
        if (!cacheKey || !blob || typeof caches === "undefined") return;
        try {
            const cache = await caches.open(CHAT_AUDIO_CACHE_NAME);
            await cache.put(
                new Request(`/__chat_audio_cache__/${encodeURIComponent(cacheKey)}`),
                new Response(blob, {
                    headers: {
                        "Content-Type": "audio/mpeg",
                        "X-Chat-Audio-Key": cacheKey,
                    },
                })
            );
            rememberRecentAudioKey(cacheKey);
        } catch {
            // ignore cache failures
        }
    };

    const readCachedAudioBlob = async (cacheKey) => {
        if (!cacheKey || typeof caches === "undefined") return null;
        try {
            const cache = await caches.open(CHAT_AUDIO_CACHE_NAME);
            const cached = await cache.match(new Request(`/__chat_audio_cache__/${encodeURIComponent(cacheKey)}`));
            if (!cached) return null;
            return await cached.blob();
        } catch {
            return null;
        }
    };

    const fetchAndCacheAudio = async (text, lang, signal = undefined) => {
        const cacheKey = await getAudioCacheKey(text, lang);
        const cachedBlob = await readCachedAudioBlob(cacheKey);
        if (cachedBlob) return { cacheKey, blob: cachedBlob, fromCache: true };

        const token =
            localStorage.getItem("token")
            || localStorage.getItem("authToken")
            || localStorage.getItem("jwt")
            || localStorage.getItem("jwtToken")
            || "";
        const csrfToken = readCookie("csrf_token");
        const response = await fetch(`${API}/chat/audio`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
            },
            body: JSON.stringify({ text, locale: lang }),
            signal,
            credentials: "include",
        });
        if (!response.ok) {
            if (response.status === 403) setChatAudioEnabled(false);
            return { cacheKey, blob: null, fromCache: false };
        }
        const blob = await response.blob();
        await cacheAudioBlob(cacheKey, blob);
        return { cacheKey, blob, fromCache: false };
    };

    const warmRecentAudioCache = React.useCallback(async () => {
        const recentBotMessages = [...(messages || [])]
            .filter((m) => m && m.type === "bot" && !m.isSystem && String(m.text || "").trim())
            .slice(-CHAT_AUDIO_RECENT_LIMIT);
        for (const msg of recentBotMessages) {
            const cacheKey = await getAudioCacheKey(msg.text, locale);
            const cachedBlob = await readCachedAudioBlob(cacheKey);
            if (cachedBlob) continue;
            try {
                const { blob } = await fetchAndCacheAudio(msg.text, locale);
                if (blob) continue;
            } catch {
                // ignore warm failures
            }
        }
    }, [messages, locale]);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [messages]);

    useEffect(() => {
        const token =
            localStorage.getItem("token")
            || localStorage.getItem("authToken")
            || localStorage.getItem("jwt")
            || localStorage.getItem("jwtToken")
            || "";
        if (!token) return;
        fetch(`${API}/users/me/ai-features`, {
            method: "GET",
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            credentials: "include",
        })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!data || typeof data !== "object") return;
                setChatAudioEnabled(data.chatAudioEnabled === true);
            })
            .catch(() => {
                setChatAudioEnabled(false);
            });
    }, [API]);

    useEffect(() => {
        warmRecentAudioCache();
    }, [warmRecentAudioCache]);

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
        const denomByLen = lang === "uk"
            ? { 1: "десятих", 2: "сотих", 3: "тисячних", 4: "десятитисячних", 5: "стотисячних", 6: "мільйонних" }
            : { 1: "десятых", 2: "сотых", 3: "тысячных", 4: "десятитысячных", 5: "стотысячных", 6: "миллионных" };

        const expandCompact = (numText, scalePow) => {
            const neg = numText.startsWith("-");
            const src = neg ? numText.slice(1) : numText;
            const [intRaw, fracRaw = ""] = src.split(/[.,]/);
            const intPart = intRaw.replace(/\D/g, "") || "0";
            const fracPart = fracRaw.replace(/\D/g, "");
            const digits = `${intPart}${fracPart}`.replace(/^0+/, "") || "0";
            const val = BigInt(digits) * (10n ** BigInt(scalePow));
            const div = 10n ** BigInt(fracPart.length || 0);
            const out = (val / div).toString();
            return `${neg ? "-" : ""}${out}`;
        };

        const parseToken = (raw) => {
            let s = String(raw || "").trim().replace(/\s/g, "");
            if (!s) return null;
            if (s.startsWith(".") || s.startsWith(",")) s = `0${s}`;
            const neg = s.startsWith("-");
            if (neg) s = s.slice(1);

            const lastComma = s.lastIndexOf(",");
            const lastDot = s.lastIndexOf(".");
            let decSep = "";
            if (lastComma >= 0 && lastDot >= 0) decSep = lastComma > lastDot ? "," : ".";
            else if (lastComma >= 0) decSep = (s.split(",").length - 1) === 1 ? "," : "";
            else if (lastDot >= 0) decSep = (s.split(".").length - 1) === 1 ? "." : "";

            const parts = decSep ? s.split(decSep) : [s, ""];
            const intDigits = (parts[0] || "0").replace(/[.,]/g, "");
            const fracDigits = (parts[1] || "").replace(/[^\d]/g, "");
            if (!/^\d+$/.test(intDigits) || (fracDigits && !/^\d+$/.test(fracDigits))) return null;
            return { neg, intDigits: intDigits.replace(/^0+/, "") || "0", fracDigits: fracDigits.replace(/0+$/, "") };
        };

        let prepared = String(text || "");
        prepared = prepared.replace(/\b(-?\d+(?:[.,]\d+)?)\s*([kKmMbB])\b/g, (_, n, suf) => {
            const p = suf.toLowerCase() === "k" ? 3 : suf.toLowerCase() === "m" ? 6 : 9;
            return expandCompact(String(n), p);
        });

        return prepared.replace(/-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)(?:[.,]\d+)?|-?[.,]\d+/g, (raw) => {
            const parsed = parseToken(raw);
            if (!parsed) return raw;
            const intNum = Number(`${parsed.neg ? "-" : ""}${parsed.intDigits}`);
            if (!Number.isFinite(intNum)) return raw;
            const base = toWords(intNum);
            if (!parsed.fracDigits) return base;

            // 0.5 / 2.5 style -> natural "half" phrasing.
            if (parsed.fracDigits === "5") {
                return `${base} ${lang === "uk" ? "з половиною" : "с половиной"}`;
            }

            const fracNum = Number(parsed.fracDigits);
            const fracWords = toWords(fracNum);
            const denom = denomByLen[Math.min(parsed.fracDigits.length, 6)] || (lang === "uk" ? "десятих" : "десятых");
            return `${base} ${lang === "uk" ? "цілих" : "целых"} ${fracWords} ${denom}`;
        });
    };

    const normalizeSlavicPronunciation = (text, lang) => {
        const mapRu = {
            shch: "щ", yo: "ё", zh: "ж", kh: "х", ts: "ц", ch: "ч", sh: "ш", yu: "ю", ya: "я",
            a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "дж",
            k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т",
            u: "у", v: "в", w: "в", x: "кс", y: "й", z: "з"
        };
        const mapUk = {
            shch: "щ", yo: "йо", zh: "ж", kh: "х", ts: "ц", ch: "ч", sh: "ш", yu: "ю", ya: "я",
            a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "г", i: "і", j: "дж",
            k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т",
            u: "у", v: "в", w: "в", x: "кс", y: "и", z: "з"
        };
        const map = lang === "uk" ? mapUk : mapRu;
        const translit = (word) => {
            let out = "";
            let i = 0;
            const s = String(word || "").toLowerCase();
            while (i < s.length) {
                const four = s.slice(i, i + 4);
                const three = s.slice(i, i + 3);
                const two = s.slice(i, i + 2);
                if (map[four]) { out += map[four]; i += 4; continue; }
                if (map[three]) { out += map[three]; i += 3; continue; }
                if (map[two]) { out += map[two]; i += 2; continue; }
                out += map[s[i]] || s[i];
                i += 1;
            }
            return out;
        };
        return String(text || "").replace(/\b[A-Za-z][A-Za-z0-9&.'’-]*\b/g, (w) => translit(w));
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
        if (!chatAudioEnabled) return;
        const synth = window.speechSynthesis;
        const localeBase = String(locale || "en").toLowerCase().split("-")[0];
        if (synth) synth.cancel();

        if (speakingIndex === index) {
            stopCurrentAudio();
            setSpeakingIndex(null);
            return;
        }

        stopCurrentAudio();
        window._stopPlayback = false;
        setSpeakingIndex(index);

        try {
            const cacheKey = await getAudioCacheKey(text, locale);
            const cachedBlob = await readCachedAudioBlob(cacheKey);
            if (cachedBlob) {
                const url = URL.createObjectURL(cachedBlob);
                const audio = new Audio(url);
                window._currentAudio = audio;
                window._audioQueue.push(audio);
                await new Promise((resolve, reject) => {
                    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
                    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("cached_audio_failed")); };
                    audio.play().catch(reject);
                });
                if (!window._stopPlayback) setSpeakingIndex(null);
                return;
            }

            const played = await streamTextToAudio(text);
            if (played === false) {
                fallbackSpeak(text, index, (localeBase === "ru" || localeBase === "uk") ? { slavicSafe: true } : {});
                return;
            }
            if (!window._stopPlayback) setSpeakingIndex(null);
        } catch (err) {
            if (!window._stopPlayback) fallbackSpeak(text, index);
        }
    };

    const streamTextToAudio = async (text) => {
        if (!chatAudioEnabled) return false;
        window._stopPlayback = false;
        window._audioQueue = [];
        window._audioAbortControllers = [];
        const controller = new AbortController();
        window._audioAbortControllers.push(controller);
        const cacheKey = await getAudioCacheKey(text, locale);
        const cachedBlob = await readCachedAudioBlob(cacheKey);
        if (cachedBlob) {
            const url = URL.createObjectURL(cachedBlob);
            const audio = new Audio(url);
            window._currentAudio = audio;
            window._audioQueue.push(audio);
            await new Promise((resolve, reject) => {
                audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
                audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("cached_audio_failed")); };
                audio.play().catch(reject);
            });
            return true;
        }

        const token =
            localStorage.getItem("token")
            || localStorage.getItem("authToken")
            || localStorage.getItem("jwt")
            || localStorage.getItem("jwtToken")
            || "";
        const csrfToken = readCookie("csrf_token");

        const response = await fetch(`${API}/chat/audio`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
            },
            body: JSON.stringify({ text, locale }),
            signal: controller.signal,
            credentials: "include",
        });
        if (!response.ok) {
            if (response.status === 403) setChatAudioEnabled(false);
            return false;
        }
        if (!response.body) return false;

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
            const audioParts = [];
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
                    const part = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
                    queue.push(part);
                    audioParts.push(part);
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
                return false;
            }

            await Promise.race([
              new Promise((resolve) => {
                audio.onended = resolve;
                audio.onerror = resolve;
              }),
              new Promise((resolve) => setTimeout(resolve, 15000)),
            ]);
            URL.revokeObjectURL(objectUrl);
            try {
                if (audioParts.length > 0) {
                    await cacheAudioBlob(cacheKey, new Blob(audioParts, { type: "audio/mpeg" }));
                }
            } catch {
                // ignore cache write failures
            }
            return true;
        }

        const blob = await response.blob();
        await cacheAudioBlob(cacheKey, blob);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        window._currentAudio = audio;
        window._audioQueue.push(audio);
        await new Promise((resolve, reject) => {
            audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
            audio.onerror = reject;
            audio.play().catch(reject);
        });
        return true;
    };

    const fallbackSpeak = (text, index, opts = {}) => {
        const synth = window.speechSynthesis;
        if (!synth) {
            setSpeakingIndex((prev) => (prev === index ? null : prev));
            return false;
        }
        window._stopPlayback = false;
        const slavicLang = (locale || "en").split("-")[0].toLowerCase();
        const speechText = (opts?.slavicSafe
            ? String(text || "")
            : ((slavicLang === "ru" || slavicLang === "uk")
                ? normalizeSlavicPronunciation(normalizeSlavicSpeechNumbers(text, slavicLang), slavicLang)
                : text))
            .replace(/[()]/g, " ");
        const localeMap = { 'es': 'es-ES', 'uk': 'uk-UA', 'ru': 'ru-RU', 'en': 'en-US' };
        const targetLang = localeMap[locale] || locale || 'en-US';
        const utterance = new SpeechSynthesisUtterance(speechText);
        utterance.lang = targetLang;
        
        const currentVoices = voices.length > 0 ? voices : synth.getVoices();
        const baseLang = targetLang.split('-')[0].toLowerCase();
        const bestVoice = currentVoices.find(v => String(v.lang || "").toLowerCase().startsWith(baseLang))
          || currentVoices.find(v => /google|microsoft|apple|native/i.test(String(v.name || "")))
          || currentVoices[0];
        if (bestVoice) utterance.voice = bestVoice;
        utterance.rate = (slavicLang === "ru" || slavicLang === "uk") ? 0.88 : 0.95;
        utterance.pitch = 1.0;

        utterance.onend = () => {
            setSpeakingIndex((prev) => (prev === index ? null : prev));
        };
        utterance.onerror = () => {
            // Do not stop silently: fallback to backend stream when browser TTS fails.
            streamTextToAudio(String(text || ""))
              .then((ok) => {
                if (ok !== true) setSpeakingIndex((prev) => (prev === index ? null : prev));
              })
              .catch(() => {
                setSpeakingIndex((prev) => (prev === index ? null : prev));
              });
        };

        synth.speak(utterance);
        return true;
    };

    return (
        <div
            ref={containerRef}
            className="flex-1 overflow-y-auto p-2 space-y-2 bg-slate-50/50 min-h-0"
            style={{ fontFamily: "'IBM Plex Sans', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" }}
        >
            {messages.map((msg, i) => {
                const isSpeaking = speakingIndex === i;
                return (
                    <div key={i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} mb-1`}>
                        <div className={`rounded-xl px-2.5 py-1.5 text-[11px] leading-snug shadow-sm group relative transition-all break-words overflow-wrap-anywhere ${
                            msg.type === 'user'
                              ? 'max-w-[88%] bg-blue-600 text-white rounded-tr-sm'
                              : `w-full max-w-none bg-white text-slate-600 border border-slate-200 rounded-tl-sm pr-8 ${isSpeaking ? 'bg-indigo-50/30' : ''}`
                        }`}>
                            {msg.type === 'bot' && chatAudioEnabled && (
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
                            <div className="whitespace-pre-wrap font-semibold tracking-[0.01em]">{formatMessageForDisplay(msg.text)}</div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
