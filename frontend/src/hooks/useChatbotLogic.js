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

function sanitizeAiText(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

function buildConversationHistory(messages = [], limit = 40, maxCharsPerMessage = 4000) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.type === "user" || m.type === "bot") && typeof m.text === "string")
    .filter((m) => !m.isSystem)
    .slice(-limit)
    .map((m) => ({
      role: m.type === "user" ? "user" : "assistant",
      content: m.text.trim().slice(0, maxCharsPerMessage),
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
  return null;
}

export function useChatbotLogic({
  sheetId,
  data,
  headers,
  activeFilters,
  splitContext,
  activeViewScope,
  onApplyFilter,
  onUpdateChart,
  activeTab,
  locale = "en",
  copy = {},
  applyActionsDefault = true,
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
    if (typeof window === "undefined") return;
    try {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("dashboardChat:"))
        .forEach((key) => window.localStorage.removeItem(key));
    } catch (_) {
      // no-op: private mode or locked-down storage
    }
  }, []);

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
    const headerCount = Array.isArray(headers) ? headers.length : 0;
    if (messages.length === 0 && headerCount > 0) {
      const key = makeChatStorageKey(sheetId, activeTab);
      const restored = restoreMessagesFromStorage(key);
      setMessages(restored && restored.length ? restored : [getInitialSystemMessage(copy)]);
    }
  }, [headers, messages.length, sheetId, activeTab, copy.chatInitialMessage]);

  // Update initial message when copy/language changes
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 0) return [getInitialSystemMessage(copy)];
      return prev.map(m => {
        if (m.isSystem) {
          return {
            ...m,
            text: copy.chatInitialMessage || m.text
          };
        }
        return m;
      });
    });
  }, [copy.chatInitialMessage]);

  // Translate existing messages when locale changes (except English)
  useEffect(() => {
    const normalizedLocale = String(locale || "").toLowerCase();
    if (!normalizedLocale || normalizedLocale.startsWith("en")) return;
    if (!messages.length) return;

    // We only translate if the locale actually changed from what's currently in messages
    // To keep it simple and avoid loops, we check a ref
    if (prevLocaleRef.current === locale) return;
    prevLocaleRef.current = locale;

    const items = messages
      .filter(m => !m.isSystem) // System message is already handled above
      .map((m, idx) => ({
        key: `msg_${idx}`,
        text: m.text,
      }));

    if (!items.length) return;

    api.post("/dashboard/translate", { locale: normalizedLocale, items })
      .then((res) => {
        const translations = res?.data?.translations || {};
        setMessages((prev) => {
          const next = [...prev];
          let itemIdx = 0;
          return next.map(m => {
            if (m.isSystem) return m;
            const translatedText = translations[`msg_${itemIdx}`];
            itemIdx++;
            return translatedText ? { ...m, text: translatedText } : m;
          });
        });
      })
      .catch(err => console.error("Chat translation failed:", err));
  }, [locale]); // Only re-run when locale changes

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
  }, [copy.chatResetMessage, sheetId, activeTab]);

  const applyChatActions = useCallback((actions = {}, meta = null) => {
    const allowUiActions = meta?.applyActions !== false;
    if (!allowUiActions || !onApplyFilter) return { filters: [], reset_filters: false };

    const filters = Array.isArray(actions.filters) ? actions.filters : [];
    if (actions.reset_filters) {
      onApplyFilter("RESET_ALL");
    }
    if (filters.length) {
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

    return { filters, reset_filters: !!actions.reset_filters };
  }, [onApplyFilter, onUpdateChart]);

  const sendMessage = useCallback(async (rawMessage, meta = null) => {
    const q = String(rawMessage || "").trim();
    if (!q || isSending) return;
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
      const payload = {
        sheetId: sheetId || null,
        activeTab: activeTab || null,
        message: q,
        activeFilters: serializeActiveFilters(activeFilters),
        splitContext: splitContext && typeof splitContext === "object" ? splitContext : null,
        activeViewScope: activeViewScope && typeof activeViewScope === "object" ? activeViewScope : null,
        conversationHistory: buildConversationHistory(messages),
        locale,
      };
      const res = await api.post("/chat/query", payload);
      const body = res?.data || {};
      const answer = typeof body.answer === "string" && body.answer.trim()
        ? sanitizeAiText(body.answer)
        : sanitizeAiText(copy.chatNoResponse || "I could not produce a response.");
      const actions = body.actions || {};
      const { filters } = applyChatActions(actions, meta);
      setMessages((prev) => [...prev, {
        type: "bot",
        text: answer,
        timestamp: new Date(),
        isFilter: filters.length > 0,
        filterCol: filters[0]?.column,
      }]);
    } catch (e) {
      const code = String(e?.response?.data?.error || "").trim();
      const msg = code === "chat_prompt_budget_exceeded"
        ? sanitizeAiText("Your request context is too large for the current AI budget. Reduce filters/history or ask a narrower question.")
        : sanitizeAiText(e?.response?.data?.message || e?.response?.data?.error || copy.chatRequestFailed || "AI chat request failed.");
      setMessages((prev) => [...prev, { type: "bot", text: msg, timestamp: new Date() }]);
    } finally {
      setIsSending(false);
    }
  }, [sheetId, activeTab, isSending, activeFilters, splitContext, activeViewScope, messages, onApplyFilter, onUpdateChart, locale, copy.appliedFilters, copy.chatRequestFailed, clearMessages, applyChatActions]);

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q) return;
    setInput("");
    await sendMessage(q, { applyActions: !!applyActionsDefault });
  }, [input, sendMessage, applyActionsDefault]);

  // Keep state refs for the event listener to avoid re-binding
  const stateRef = useRef({ sheetId, activeTab, activeFilters, splitContext, activeViewScope, messages, locale });
  useEffect(() => {
    stateRef.current = { sheetId, activeTab, activeFilters, splitContext, activeViewScope, messages, locale };
  }, [sheetId, activeTab, activeFilters, splitContext, activeViewScope, messages, locale]);

  useEffect(() => {
    const onExternalSubmit = (event) => {
      const payload = event?.detail || {};
      const current = stateRef.current;
      
      if (!payload?.sheetId || String(payload.sheetId) !== String(current.sheetId)) return;
      const message = String(payload?.message || "").trim();
      if (!message) return;
      const requestLocale = String(payload?.locale || current.locale || "en");
      const meta = payload?.meta || null;
      
      if (meta?.silent) {
        (async () => {
          try {
            const res = await api.post("/chat/query", {
              sheetId: current.sheetId,
              activeTab: current.activeTab || null,
              message,
              activeFilters: serializeActiveFilters(current.activeFilters),
              splitContext: current.splitContext && typeof current.splitContext === "object" ? current.splitContext : null,
              activeViewScope: current.activeViewScope && typeof current.activeViewScope === "object" ? current.activeViewScope : null,
              conversationHistory: buildConversationHistory(current.messages),
              locale: requestLocale,
            });
            const result = res?.data || {};
            const answer = typeof result.answer === "string" && result.answer.trim()
              ? sanitizeAiText(result.answer)
              : "";
            applyChatActions(result.actions || {}, meta);
            
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("dashboard:chat-response", {
                detail: {
                  sheetId: current.sheetId,
                  answer,
                  meta,
                },
              }));
            }
          } catch (err) {
            if (typeof window !== "undefined") {
              const code = String(err?.response?.data?.error || "").trim();
              const errMsg =
                (code === "chat_prompt_budget_exceeded"
                  ? "Your request context is too large for the current AI budget. Reduce filters/history or ask a narrower question."
                  : (err?.response?.data?.message
                    || err?.response?.data?.error
                    || "AI chat request failed."));
              window.dispatchEvent(new CustomEvent("dashboard:chat-response", {
                detail: {
                  sheetId: current.sheetId,
                  answer: "",
                  error: sanitizeAiText(errMsg),
                  meta,
                },
              }));
            }
          }
        })();
        return;
      }
      sendMessage(message, meta);
    };
    window.addEventListener("dashboard:submit-chat", onExternalSubmit);
    return () => window.removeEventListener("dashboard:submit-chat", onExternalSubmit);
  }, [sendMessage]); // Stable dependencies

  const submitFeedback = useCallback(async ({ question, badAnswer, expectedAnswer, plan = null }) => {
    try {
      await api.post("/chat/feedback", {
        sheetId,
        question,
        badAnswer,
        expectedAnswer,
        plan,
        locale
      });
      return { success: true };
    } catch (e) {
      console.error("Feedback submission failed:", e);
      return { success: false, error: e?.response?.data?.message || "Failed to submit feedback" };
    }
  }, [sheetId, locale]);

  return {
    messages,
    input,
    setInput,
    isOpen,
    setIsOpen,
    isMinimized,
    setIsMinimized,
    handleSend,
    submitFeedback,
    messagesEndRef,
    clearMessages,
  };
}

