import { useState, useRef, useEffect, useCallback } from "react";
import api from "../api";

const CHAT_TRANSLATE_CACHE = new Map();
const CHAT_TRANSLATE_IN_FLIGHT = new Map();

function serializeActiveFilters(activeFilters = {}) {
  if (!activeFilters || typeof activeFilters !== "object") return {};
  const out = {};
  Object.entries(activeFilters).forEach(([k, v]) => {
    if (!v) return;
    if (v instanceof Set) {
      out[k] = Array.from(v);
      return;
    }
    if (Array.isArray(v)) {
      out[k] = v;
      return;
    }
    if (typeof v === "object" && v.type === "contains") {
      out[k] = { type: "contains", value: String(v.value || "") };
    }
  });
  return out;
}

function buildConversationHistory(messages = [], limit = 8) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.type === "user" || m.type === "bot") && typeof m.text === "string")
    .filter((m) => !m.isSystem)
    .slice(-limit)
    .map((m) => ({
      role: m.type === "user" ? "user" : "assistant",
      content: m.text.trim(),
    }))
    .filter((m) => m.content);
}

function makeChatStorageKey(sheetId, activeTab) {
  if (!sheetId) return "";
  const tabPart = activeTab ? String(activeTab) : "__all_tabs__";
  return `dashboardChat:${sheetId}:${tabPart}`;
}

function getInitialSystemMessage(copy = {}) {
  return {
    type: "bot",
    text: copy.chatInitialMessage || "Ask about what changed, why it changed, top drivers, and year-over-year differences in this dataset.",
    timestamp: new Date(),
    isSystem: true,
  };
}

function restoreMessagesFromStorage(key) {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((m) => m && typeof m.text === "string" && (m.type === "user" || m.type === "bot"))
      .map((m) => ({ ...m, timestamp: m.timestamp ? new Date(m.timestamp) : new Date() }));
  } catch (_) {
    return null;
  }
}

export function useChatbotLogic({
  sheetId,
  data,
  headers,
  activeFilters,
  onApplyFilter,
  onUpdateChart,
  activeTab,
  locale = "en",
  copy = {},
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const messagesEndRef = useRef(null);

  const prevSheetRef = useRef(sheetId);
  const prevTabRef = useRef(activeTab);
  const prevLocaleRef = useRef(locale);

  useEffect(() => {
    // Only reset if it's a real change, not the initial mount
    const sheetChanged = prevSheetRef.current !== sheetId;
    const tabChanged = prevTabRef.current !== activeTab;

    if (sheetChanged || tabChanged) {
      const key = makeChatStorageKey(sheetId, activeTab);
      const restored = restoreMessagesFromStorage(key);
      setMessages(restored && restored.length ? restored : [getInitialSystemMessage(copy)]);
      
      if (!restored?.length && onApplyFilter) {
        onApplyFilter("RESET_ALL");
      }
    }

    prevSheetRef.current = sheetId;
    prevTabRef.current = activeTab;
  }, [sheetId, activeTab, onApplyFilter, copy.chatInitialMessage]);

  useEffect(() => {
    if (messages.length === 0 && headers.length > 0) {
      const key = makeChatStorageKey(sheetId, activeTab);
      const restored = restoreMessagesFromStorage(key);
      setMessages(restored && restored.length ? restored : [getInitialSystemMessage(copy)]);
    }
  }, [headers, messages.length, sheetId, activeTab, copy.chatInitialMessage]);

  useEffect(() => {
    const key = makeChatStorageKey(sheetId, activeTab);
    if (!key || typeof window === "undefined" || !Array.isArray(messages) || messages.length === 0) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(messages));
    } catch (_) {
      // no-op: ignore storage quota or private mode failures
    }
  }, [messages, sheetId, activeTab]);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length !== 1 || !prev[0]?.isSystem) return prev;
      return [{
        ...prev[0],
        text: copy.chatInitialMessage || prev[0].text,
      }];
    });
  }, [copy.chatInitialMessage]);

  useEffect(() => {
    if (prevLocaleRef.current === locale) return;
    prevLocaleRef.current = locale;
    if (!Array.isArray(messages) || !messages.length) return;
    const normalizedLocale = String(locale || "").toLowerCase();
    if (!normalizedLocale || normalizedLocale.startsWith("en")) return;

    let cancelled = false;
    const items = messages
      .map((m, idx) => ({
        key: `m_${idx}`,
        text: String(m?.text || ""),
      }))
      .filter((item) => item.text);

    if (!items.length) return undefined;
    const requestKey = `${normalizedLocale}|${items.map((item) => `${item.key}:${item.text}`).join("||")}`;
    const applyTranslations = (translations) => {
      if (cancelled) return;
      setMessages((prev) => prev.map((m, idx) => ({
        ...m,
        text: translations[`m_${idx}`] || m.text,
      })));
    };

    const cached = CHAT_TRANSLATE_CACHE.get(requestKey);
    if (cached && typeof cached === "object") {
      applyTranslations(cached);
      return undefined;
    }

    const inFlight = CHAT_TRANSLATE_IN_FLIGHT.get(requestKey);
    if (inFlight) {
      inFlight.then((translations) => applyTranslations(translations || {}));
      return () => {
        cancelled = true;
      };
    }

    const request = api.post("/dashboard/translate", { locale: normalizedLocale, items })
      .then((res) => {
        const translations = res?.data?.translations || {};
        CHAT_TRANSLATE_CACHE.set(requestKey, translations);
        return translations;
      })
      .catch(() => {
        // no-op: keep existing text if translation fails
        return {};
      })
      .finally(() => {
        CHAT_TRANSLATE_IN_FLIGHT.delete(requestKey);
      });
    CHAT_TRANSLATE_IN_FLIGHT.set(requestKey, request);
    request.then((translations) => applyTranslations(translations || {}));

    return () => {
      cancelled = true;
    };
  }, [locale, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const clearMessages = useCallback(() => {
    const reset = [{
      type: "bot",
      text: copy.chatResetMessage || "Chat reset. Ask another question about this spreadsheet.",
      timestamp: new Date(),
      isSystem: true,
    }];
    setMessages(reset);
    const key = makeChatStorageKey(sheetId, activeTab);
    if (key && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(key, JSON.stringify(reset));
      } catch (_) {
        // no-op
      }
    }
  }, [copy.chatResetMessage, sheetId, activeTab]);

  const sendMessage = useCallback(async (rawMessage, meta = null) => {
    const q = String(rawMessage || "").trim();
    if (!q || !sheetId || isSending) return;
    const clearCommand = /^(clear chat|reset chat|очистить чат|очисти чат|скинь чат|сбросить чат|clear)$/i.test(q);
    if (clearCommand) {
      clearMessages();
      if (onApplyFilter) onApplyFilter("RESET_ALL");
      return;
    }

    setMessages((prev) => [...prev, { type: "user", text: q, timestamp: new Date() }]);
    setInput("");
    setIsSending(true);

    try {
      const res = await api.post("/chat/query", {
        sheetId,
        activeTab: activeTab || null,
        message: q,
        activeFilters: serializeActiveFilters(activeFilters),
        conversationHistory: buildConversationHistory(messages),
        locale,
      });

      const payload = res?.data || {};
      const answer = typeof payload.answer === "string" && payload.answer.trim()
        ? payload.answer
        : (copy.chatNoResponse || "I could not produce a response.");

      const actions = payload.actions || {};
      const filters = Array.isArray(actions.filters) ? actions.filters : [];

      if (onApplyFilter && actions.reset_filters) {
        onApplyFilter("RESET_ALL");
      }
      if (onApplyFilter && filters.length) {
        filters.forEach((f) => {
          if (!f?.column) return;
          onApplyFilter(f.column, String(f.value ?? ""), f.operator || "contains");
        });
      }

      if (onUpdateChart && actions.chart && actions.chart.valueColumn) {
        onUpdateChart({
          dateColumn: actions.chart.dateColumn || null,
          valueColumn: actions.chart.valueColumn,
          segmentBy: actions.chart.segmentBy || null,
          aggregation: actions.chart.aggregation || "sum",
        });
      }

      setMessages((prev) => [...prev, {
        type: "bot",
        text: answer,
        timestamp: new Date(),
        isFilter: filters.length > 0,
        filterCol: filters[0]?.column,
      }]);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("dashboard:chat-response", {
          detail: {
            sheetId,
            answer,
            meta,
          },
        }));
      }
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || copy.chatRequestFailed || "AI chat request failed.";
      setMessages((prev) => [...prev, { type: "bot", text: msg, timestamp: new Date() }]);
    } finally {
      setIsSending(false);
    }
  }, [sheetId, activeTab, isSending, activeFilters, messages, onApplyFilter, onUpdateChart, locale, copy.appliedFilters, copy.chatRequestFailed, clearMessages]);

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q) return;
    setInput("");
    await sendMessage(q);
  }, [input, sendMessage]);

  useEffect(() => {
    const onExternalSubmit = (event) => {
      const payload = event?.detail || {};
      if (!payload?.sheetId || String(payload.sheetId) !== String(sheetId)) return;
      const message = String(payload?.message || "").trim();
      if (!message) return;
      const meta = payload?.meta || null;
      if (meta?.silent) {
        (async () => {
          try {
            const res = await api.post("/chat/query", {
              sheetId,
              activeTab: activeTab || null,
              message,
              activeFilters: serializeActiveFilters(activeFilters),
              conversationHistory: buildConversationHistory(messages),
              locale,
            });
            const result = res?.data || {};
            const answer = typeof result.answer === "string" && result.answer.trim()
              ? result.answer
              : "";
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("dashboard:chat-response", {
                detail: {
                  sheetId,
                  answer,
                  meta,
                },
              }));
            }
          } catch (_) {
            // Silent pinned-metric calls should not alter chat UI on errors.
          }
        })();
        return;
      }
      sendMessage(message, meta);
    };
    window.addEventListener("dashboard:submit-chat", onExternalSubmit);
    return () => window.removeEventListener("dashboard:submit-chat", onExternalSubmit);
  }, [sheetId, sendMessage, activeTab, activeFilters, messages, locale]);

  return {
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
  };
}
