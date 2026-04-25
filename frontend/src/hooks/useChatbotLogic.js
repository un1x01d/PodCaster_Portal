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

  useEffect(() => {
    // Only reset if it's a real change, not the initial mount
    const sheetChanged = prevSheetRef.current !== sheetId;
    const tabChanged = prevTabRef.current !== activeTab;

    if (sheetChanged || tabChanged) {
      setMessages([{
        type: "bot",
        text: copy.chatInitialMessage || "Ask about what changed, why it changed, top drivers, and year-over-year differences in this dataset.",
        timestamp: new Date(),
        isSystem: true,
      }]);
      
      if (onApplyFilter) {
        onApplyFilter("RESET_ALL");
      }
    }

    prevSheetRef.current = sheetId;
    prevTabRef.current = activeTab;
  }, [sheetId, activeTab, onApplyFilter, copy.chatInitialMessage]);

  useEffect(() => {
    if (messages.length === 0 && headers.length > 0) {
      setMessages([{
        type: "bot",
        text: copy.chatInitialMessage || "Ask about what changed, why it changed, top drivers, and year-over-year differences in this dataset.",
        timestamp: new Date(),
        isSystem: true,
      }]);
    }
  }, [headers, messages.length, copy.chatInitialMessage]);

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
    setMessages([{
      type: "bot",
      text: copy.chatResetMessage || "Chat reset. Ask another question about this spreadsheet.",
      timestamp: new Date(),
      isSystem: true,
    }]);
  }, [copy.chatResetMessage]);

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
