import React, { useRef, useEffect } from 'react';
import { DASHBOARD_COPY_EN } from "../../hooks/useDashboardI18n";

export default function ChatHistory({ sheetId = null, messages, copy = DASHBOARD_COPY_EN, locale = "en" }) {
    const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
    const containerRef = useRef(null);
    const [speakingIndex, setSpeakingIndex] = React.useState(null);
    const [chatAudioEnabled, setChatAudioEnabled] = React.useState(true);
    const utteranceRef = useRef(null);
    const liveSentenceBufferRef = useRef("");
    const liveSentenceQueueRef = useRef([]);
    const liveSpeakingRef = useRef(false);
    const readCookie = (name) => {
        if (typeof document === "undefined") return "";
        const prefix = `${name}=`;
        const hit = document.cookie
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith(prefix));
        return hit ? decodeURIComponent(hit.slice(prefix.length)) : "";
    };
    const readBearerToken = () => {
        if (typeof window === "undefined") return "";
        const raw = [
            window.localStorage?.getItem("token"),
            window.localStorage?.getItem("authToken"),
            window.localStorage?.getItem("jwt"),
            window.localStorage?.getItem("jwtToken"),
        ].find((v) => String(v || "").trim());
        const token = String(raw || "").trim();
        if (!token) return "";
        if (
            token.startsWith("cookie-session:")
            || token === "null"
            || token === "undefined"
        ) return "";
        return token;
    };
    const formatMessageForDisplay = (text = "") => {
        let out = String(text || "");
        out = out.replace(/\\r?\\n/g, "\n");
        out = out.replace(/\s+\*\*([^*\n:]{1,80}):\*\*/g, "\n$1:");
        out = out.replace(/\*\*([^*\n]+)\*\*/g, "$1");
        // Convert only explicit colon-introduced inline lists.
        // Avoid rewriting generic hyphenated labels (e.g. "Name - email").
        out = out.replace(/([:])\s+-\s+/g, "$1\n- ");
        return out;
    };

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [messages]);

    useEffect(() => {
        try {
            window.localStorage?.removeItem("dashboard-chat-audio-recent-v1");
            if (typeof caches !== "undefined") {
                caches.delete("dashboard-chat-audio-v1").catch(() => {});
            }
        } catch {
            // no-op: storage cleanup is best effort
        }
    }, []);

    useEffect(() => {
        let ignore = false;
        const normalizeBoolean = (value) => {
            if (value === true || value === 1) return true;
            if (value === false || value === 0 || value === null || value === undefined) return false;
            if (typeof value === "string") {
                const normalized = value.trim().toLowerCase();
                if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") return true;
                if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") return false;
            }
            return false;
        };
        const load = async () => {
            try {
                const token =
                    localStorage.getItem("token") ||
                    localStorage.getItem("authToken") ||
                    localStorage.getItem("jwt") ||
                    localStorage.getItem("jwtToken") ||
                    "";
                const headers = token ? { Authorization: `Bearer ${token}` } : {};
                const [userRes, runtimeRes] = await Promise.all([
                  fetch(`${API}/users/me/ai-features`, {
                    method: "GET",
                    headers,
                    credentials: "include",
                  }),
                  fetch(`${API}/admin/settings/ai-runtime`, {
                    method: "GET",
                    headers,
                    credentials: "include",
                  }),
                ]);
                const userPayload = userRes && userRes.ok ? await userRes.json() : null;
                const runtimePayload = runtimeRes && runtimeRes.ok ? await runtimeRes.json() : null;
                if (ignore) return;
                const userEnabled = userPayload && Object.prototype.hasOwnProperty.call(userPayload, "chatAudioEnabled")
                  ? normalizeBoolean(userPayload.chatAudioEnabled)
                  : false;
                const runtimeEnabled = runtimePayload && Object.prototype.hasOwnProperty.call(runtimePayload, "chatAudioEnabled")
                  ? (runtimePayload.globalAiDisabled === true ? false : normalizeBoolean(runtimePayload.chatAudioEnabled))
                  : false;
                setChatAudioEnabled(userEnabled || runtimeEnabled);
            } catch (err) {
                console.warn("Failed to resolve chat audio feature flags", err);
                setChatAudioEnabled(false);
            }
        };
        load();
        return () => { ignore = true; };
    }, [API]);

    const [voices, setVoices] = React.useState([]);
    const [showWorkByMessage, setShowWorkByMessage] = React.useState({});

    const toggleShowWork = React.useCallback((index) => {
        setShowWorkByMessage((prev) => ({ ...prev, [index]: !prev[index] }));
    }, []);

    const normalizeConfidencePct = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return Math.max(0, Math.min(100, Math.round(n * 100)));
    };

    const renderVerificationAudit = (msg) => {
        const verification = msg?.meta?.verification || null;
        const gate = msg?.meta?.verification_gate || null;
        if (!verification) return null;

        const confidencePct = normalizeConfidencePct(verification?.confidence);
        const ambiguityDelta = Number(verification?.ambiguity_delta);
        const ambiguityPct = Number.isFinite(ambiguityDelta) ? normalizeConfidencePct(ambiguityDelta) : null;
        const candidates = Array.isArray(verification?.evidence?.candidates) ? verification.evidence.candidates : [];
        const mappings = verification?.evidence?.resolvedMappings && typeof verification.evidence.resolvedMappings === "object"
            ? verification.evidence.resolvedMappings
            : {};

        return (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-700">
                <div className="font-semibold text-slate-900">Verification Audit</div>
                <div className="mt-1">Method: {String(verification?.method || "n/a")}</div>
                <div>Confidence: {confidencePct === null ? "n/a" : `${confidencePct}%`}</div>
                <div>Band: {String(verification?.band || gate?.band || "n/a")}</div>
                <div>Fallback used: {verification?.fallback_used === true ? "Yes" : "No"}</div>
                {ambiguityPct !== null && <div>Ambiguity delta: {ambiguityPct}%</div>}
                {Object.keys(mappings).length > 0 && (
                    <div className="mt-1">
                        <div className="font-semibold text-slate-900">Chosen Headers</div>
                        {Object.entries(mappings).map(([key, value]) => (
                            <div key={key}>{key}: {String(value)}</div>
                        ))}
                    </div>
                )}
                {candidates.length > 0 && (
                    <div className="mt-1">
                        <div className="font-semibold text-slate-900">Rejected Candidates</div>
                        {candidates.map((c, idx) => {
                            const header = String(c?.header || "unknown");
                            const scorePct = normalizeConfidencePct(c?.confidence);
                            return (
                                <div key={`${header}-${idx}`}>{header}{scorePct === null ? "" : ` (${scorePct}%)`}</div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

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
        liveSentenceQueueRef.current = [];
        liveSentenceBufferRef.current = "";
        liveSpeakingRef.current = false;
    };

    const splitCompleteSentences = (bufferText = "") => {
        const text = String(bufferText || "");
        const out = [];
        let start = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
                const piece = text.slice(start, i + 1).trim();
                if (piece.length >= 2) out.push(piece);
                start = i + 1;
            }
        }
        return { sentences: out, rest: text.slice(start) };
    };

    const playLiveQueue = async () => {
        if (liveSpeakingRef.current) return;
        liveSpeakingRef.current = true;
        try {
            while (liveSentenceQueueRef.current.length && !window._stopPlayback) {
                const next = liveSentenceQueueRef.current.shift();
                if (!next) continue;
                await streamTextToAudio(next).catch(() => false);
            }
        } finally {
            liveSpeakingRef.current = false;
        }
    };

    const handleSpeak = async (text, index) => {
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
            const played = await streamTextToAudio(text);
            if (played === false) {
                fallbackSpeak(text, index, (localeBase === "ru" || localeBase === "uk") ? { slavicSafe: true } : {});
                return;
            }
            if (!window._stopPlayback) setSpeakingIndex(null);
        } catch (err) {
            if (!window._stopPlayback) fallbackSpeak(text, index, (localeBase === "ru" || localeBase === "uk") ? { slavicSafe: true } : {});
        }
    };

    const streamTextToAudio = async (text) => {
        if (!String(text || "").trim()) return false;
        window._stopPlayback = false;
        window._audioQueue = [];
        window._audioAbortControllers = [];
        const controller = new AbortController();
        window._audioAbortControllers.push(controller);
        const csrfToken = readCookie("csrf_token");
        const bearerToken = readBearerToken();
        if (!sheetId) return false;

        const response = await fetch(`${API}/chat/audio`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
                ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
            },
            body: JSON.stringify({ text, locale, sheetId }),
            signal: controller.signal,
            credentials: "include",
        });
        if (!response.ok) {
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

            await new Promise((resolve) => {
                let doneOnce = false;
                const done = () => {
                    if (doneOnce) return;
                    doneOnce = true;
                    resolve();
                };
                audio.onended = done;
                audio.onerror = done;
                // Do not treat transient buffering pauses as completion.
                audio.onpause = () => {
                    if (window._stopPlayback) done();
                };
            });
            URL.revokeObjectURL(objectUrl);
            return true;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        window._currentAudio = audio;
        window._audioQueue.push(audio);
        await new Promise((resolve, reject) => {
            let doneOnce = false;
            const done = () => {
                if (doneOnce) return;
                doneOnce = true;
                URL.revokeObjectURL(url);
                resolve();
            };
            audio.onended = done;
            // Do not treat transient buffering pauses as completion.
            audio.onpause = () => {
                if (window._stopPlayback) done();
            };
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
        const speechText = ((slavicLang === "ru")
                ? normalizeSlavicPronunciation(normalizeSlavicSpeechNumbers(text, slavicLang), slavicLang)
                : ((slavicLang === "uk")
                    ? normalizeSlavicSpeechNumbers(text, slavicLang)
                    : String(text || "")))
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

    // Manual-only audio: do not auto-play streamed assistant text.
    useEffect(() => {
        return () => {
            liveSentenceQueueRef.current = [];
            liveSentenceBufferRef.current = "";
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="flex-1 overflow-y-auto p-2 space-y-2 bg-slate-50/50 min-h-0"
            style={{ fontFamily: "'IBM Plex Sans', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" }}
        >
            {messages.map((msg, i) => {
                const isSpeaking = speakingIndex === i;
                const botLike = msg.type !== 'user' && !msg.isSystem;
                const hasVerification = !!(msg?.meta?.verification && typeof msg.meta.verification === "object");
                const hasUncertaintyWarning = msg?.meta?.verification_gate?.warning === true;
                return (
                    <div key={i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'} mb-1`}>
                        <div className={`rounded-xl px-2.5 py-1.5 text-[11px] leading-snug shadow-sm group relative transition-all break-words overflow-wrap-anywhere ${
                            msg.type === 'user'
                              ? 'max-w-[88%] bg-blue-600 text-white rounded-tr-sm'
                              : `w-full max-w-none bg-white text-slate-600 border border-slate-200 rounded-tl-sm pr-8 ${isSpeaking ? 'bg-indigo-50/30' : ''}`
                        }`}>
                            {botLike && (
                                <button 
                                    onClick={() => handleSpeak(msg.text, i)}
                                    title={isSpeaking ? "Stop speaking" : "Play response audio"}
                                    aria-label={isSpeaking ? "Stop speaking" : "Play response audio"}
                                    disabled={false}
                                    className={`absolute right-1.5 top-1.5 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all shadow-sm z-[120] border
                                        ${isSpeaking
                                          ? 'bg-orange-500 text-white border-orange-500 cursor-pointer'
                                          : 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-500 cursor-pointer'
                                        }
                                    `}
                                >
                                    {isSpeaking ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                                    )}
                                </button>
                            )}
                            <div className="whitespace-pre-wrap font-semibold tracking-[0.01em]">{formatMessageForDisplay(msg.text)}</div>
                            {botLike && hasUncertaintyWarning && (
                                <div className="mt-1 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                    Uncertainty: high-prob mapping
                                </div>
                            )}
                            {botLike && hasVerification && (
                                <div className="mt-1">
                                    <button
                                        type="button"
                                        onClick={() => toggleShowWork(i)}
                                        className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                                    >
                                        {showWorkByMessage[i] ? "Hide Work" : "Show My Work"}
                                    </button>
                                    {showWorkByMessage[i] && renderVerificationAudit(msg)}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
