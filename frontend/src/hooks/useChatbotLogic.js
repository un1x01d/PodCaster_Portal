import { useState, useRef, useEffect, useCallback } from "react";
import api from "../api";

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

    let cancelled = false;
    const items = messages
      .map((m, idx) => ({
        key: `m_${idx}`,
        text: String(m?.text || ""),
      }))
      .filter((item) => item.text);

    if (!items.length) return undefined;

    api.post("/dashboard/translate", { locale, items })
      .then((res) => {
        if (cancelled) return;
        const translations = res?.data?.translations || {};
        setMessages((prev) => prev.map((m, idx) => ({
          ...m,
          text: translations[`m_${idx}`] || m.text,
        })));
      })
      .catch(() => {
        // no-op: keep existing text if translation fails
      });

    return () => {
      cancelled = true;
    };
  }, [locale, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if (!q || !sheetId || isSending) return;

    setMessages((prev) => [...prev, { type: "user", text: q, timestamp: new Date() }]);
    setInput("");
    setIsSending(true);

    try {
      const res = await api.post("/chat/query", {
        sheetId,
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
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || copy.chatRequestFailed || "AI chat request failed.";
      setMessages((prev) => [...prev, { type: "bot", text: msg, timestamp: new Date() }]);
    } finally {
      setIsSending(false);
    }
  }, [input, sheetId, isSending, activeFilters, messages, onApplyFilter, onUpdateChart, locale, copy.appliedFilters, copy.chatRequestFailed]);

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
