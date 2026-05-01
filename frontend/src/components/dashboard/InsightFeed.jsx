import React from "react";
import api from "../../api";
import { DASHBOARD_COPY_EN, formatTemplate } from "../../hooks/useDashboardI18n";

const INSIGHT_AUDIO_CACHE_NAME = "insight-ticket-audio-v1";

async function getCachedInsightAudioBlob(cacheKey) {
  try {
    if (typeof window === "undefined" || !("caches" in window)) return null;
    const cache = await window.caches.open(INSIGHT_AUDIO_CACHE_NAME);
    const response = await cache.match(new Request(`/__insight_audio_cache__/${encodeURIComponent(cacheKey)}`));
    if (!response) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

async function setCachedInsightAudioBlob(cacheKey, blob) {
  try {
    if (typeof window === "undefined" || !("caches" in window) || !blob) return;
    const cache = await window.caches.open(INSIGHT_AUDIO_CACHE_NAME);
    await cache.put(
      new Request(`/__insight_audio_cache__/${encodeURIComponent(cacheKey)}`),
      new Response(blob, { headers: { "Content-Type": "audio/mpeg" } })
    );
  } catch {
    // Best-effort local cache.
  }
}

function Sparkline({ graph, cardType, locale, copy, direction = null }) {
  const [hoveredIndex, setHoveredIndex] = React.useState(null);
  const [tooltipPos, setTooltipPos] = React.useState(null);
  const containerRef = React.useRef(null);
  const [chartWidth, setChartWidth] = React.useState(320);
  const clean = Array.isArray(graph?.values)
    ? graph.values.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];
  const labels = Array.isArray(graph?.labels) ? graph.labels : [];
  if (clean.length < 2) return null;
  React.useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") return undefined;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const width = Number(entries?.[0]?.contentRect?.width || 0);
      if (width > 0) setChartWidth(Math.max(220, Math.floor(width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = chartWidth;
  const h = 100; // Reduced from 132 to allow more space for text
  const padLeft = 30;
  const padRight = 8;
  const padTop = 10;
  const padBottom = 24;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const stepX = chartW / (clean.length - 1);
  const yFor = (v) => padTop + chartH - ((v - min) / span) * chartH;
  const formatMetric = (v) => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return Number(v).toLocaleString(locale, { maximumFractionDigits: 0 });
  };
  const formatLabel = (value) => {
    const text = String(value || "");
    if (/^\d{4}-\d{2}$/.test(text)) {
      const [y, m] = text.split("-").map((v) => Number(v));
      if (y && m) return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(new Date(y, m - 1, 1));
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [y, m, d] = text.split("-").map((v) => Number(v));
      if (y && m && d) return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(y, m - 1, d));
    }
    return text;
  };
  const isDateLabel = (value) => {
    const text = String(value || "");
    return /^\d{4}-\d{2}$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text);
  };
  const usesDateAxis = labels.some((label) => isDateLabel(label));
  const xAxisTitle = cardType === "driver_breakdown" && !usesDateAxis ? "Drivers" : copy.period;
  const coords = clean.map((v, i) => {
    const x = padLeft + i * stepX;
    const y = yFor(v);
    return [x, y];
  });
  const buildCurvedPath = (points) => {
    if (points.length < 2) return "";
    if (points.length === 2) {
      return `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)} C${points[0][0].toFixed(2)},${points[0][1].toFixed(2)} ${points[1][0].toFixed(2)},${points[1][1].toFixed(2)} ${points[1][0].toFixed(2)},${points[1][1].toFixed(2)}`;
    }
    const segments = [`M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`];
    for (let i = 0; i < points.length - 1; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const [xPrev, yPrev] = points[i - 1] || [x0, y0];
      const [xNext, yNext] = points[i + 2] || [x1, y1];
      const cp1x = x0 + (x1 - xPrev) / 6;
      const cp1y = y0 + (y1 - yPrev) / 6;
      const cp2x = x1 - (xNext - x0) / 6;
      const cp2y = y1 - (yNext - y0) / 6;
      segments.push(`C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`);
    }
    return segments.join(" ");
  };
  const d = buildCurvedPath(coords);
  const mid = min + span / 2;
  const forecastStartIndex = Number.isInteger(graph?.forecastStartIndex)
    ? Math.max(1, Math.min(clean.length - 1, graph.forecastStartIndex))
    : null;
  const palette = {
    change_alert: { line: "#2563eb", forecast: "#3b82f6" },
    driver_breakdown: { line: "#059669", forecast: "#10b981" },
    anomaly: { line: "#d97706", forecast: "#f59e0b" },
    threshold_breach: { line: "#dc2626", forecast: "#ef4444" },
    projection: { line: "#0f766e", forecast: "#14b8a6" },
    recommendation: { line: "#c2410c", forecast: "#f97316" },
    attention: { line: "#b91c1c", forecast: "#ef4444" },
    status: { line: "#1d4ed8", forecast: "#2563eb" },
    default: { line: "#1d4ed8", forecast: "#2563eb" },
  };
  const colors = (cardType === "major_warning" || cardType === "change_alert" || cardType === "attention")
    ? (direction === "down"
      ? { line: "#dc2626", forecast: "#ef4444" }
      : direction === "up"
        ? { line: "#059669", forecast: "#10b981" }
        : { line: "#d97706", forecast: "#f59e0b" })
    : (palette[cardType] || palette.default);
  const yTicks = [
    { value: max, y: yFor(max) },
    { value: mid, y: yFor(mid) },
    { value: min, y: yFor(min) },
  ];
  const xStart = labels[0] ? formatLabel(labels[0]) : copy.start;
  const xEnd = labels[labels.length - 1] ? formatLabel(labels[labels.length - 1]) : copy.end;
  const actualCoords = forecastStartIndex === null ? coords : coords.slice(0, forecastStartIndex + 1);
  const forecastCoords = forecastStartIndex === null ? [] : coords.slice(forecastStartIndex);
  const actualPath = buildCurvedPath(actualCoords);
  const forecastPath = buildCurvedPath(forecastCoords);
  const hoveredPoint = hoveredIndex !== null ? coords[hoveredIndex] : null;
  const hoveredValue = hoveredIndex !== null ? clean[hoveredIndex] : null;
  const hoveredLabel = hoveredIndex !== null ? formatLabel(labels[hoveredIndex] ?? `${copy.point} ${hoveredIndex + 1}`) : "";
  const isForecastPoint = hoveredIndex !== null && forecastStartIndex !== null && hoveredIndex >= forecastStartIndex;
  const tooltipWidth = 132;
  const tooltipHeight = 44;
  const shouldFlipLeft = hoveredPoint ? hoveredPoint[0] > w - (tooltipWidth / 2) - 18 : false;
  const shouldDropBelow = hoveredPoint ? hoveredPoint[1] < padTop + 30 : false;
  return (
    <div ref={containerRef} className="relative mt-2 w-full rounded border border-slate-200 bg-transparent p-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-[100px]"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * w;
          let nearestIndex = 0;
          let nearestDistance = Infinity;
          coords.forEach(([cx], idx) => {
            const dist = Math.abs(cx - x);
            if (dist < nearestDistance) {
              nearestDistance = dist;
              nearestIndex = idx;
            }
          });
          setHoveredIndex(nearestIndex);
          setTooltipPos({ x: coords[nearestIndex][0], y: coords[nearestIndex][1] });
        }}
        onMouseLeave={() => {
          setHoveredIndex(null);
          setTooltipPos(null);
        }}
      >
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={h - padBottom} stroke="#94a3b8" strokeWidth="1" />
        <line x1={padLeft} y1={h - padBottom} x2={w - padRight} y2={h - padBottom} stroke="#94a3b8" strokeWidth="1" />
        {yTicks.map((tick) => (
          <g key={`tick-${tick.value}`}>
            <line x1={padLeft} y1={tick.y} x2={w - padRight} y2={tick.y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={padLeft - 6} y={tick.y + 3} textAnchor="end" fill="#64748b" fontSize="9">
              {formatMetric(tick.value)}
            </text>
          </g>
        ))}
        {forecastStartIndex === null ? (
          <path
            d={d}
            fill="none"
            stroke={colors.line}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <path
              d={actualPath}
              fill="none"
              stroke={colors.line}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {forecastCoords.length > 1 && (
              <path
                d={forecastPath}
                fill="none"
                stroke={colors.forecast}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="6 4"
              />
            )}
          </>
        )}
        {coords.map(([x, y], idx) => (
          <circle
            key={`pt-${idx}`}
            cx={x}
            cy={y}
            r={idx === coords.length - 1 ? 3 : 2}
            fill={forecastStartIndex !== null && idx >= forecastStartIndex ? colors.forecast : colors.line}
            opacity={idx === coords.length - 1 ? 1 : 0.85}
          />
        ))}
        <text x={padLeft} y={h - 8} textAnchor="start" fill="#64748b" fontSize="9">{xStart}</text>
        <text x={w - padRight} y={h - 8} textAnchor="end" fill="#64748b" fontSize="9">{xEnd}</text>
        <text x={w / 2} y={h - 4} textAnchor="middle" fill="#64748b" fontSize="8" fontWeight="600">{xAxisTitle}</text>
      </svg>
      {forecastStartIndex !== null && (
        <div className="mt-1 flex justify-end pr-1">
          <span
            className="inline-flex items-center rounded-full border bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: colors.forecast, borderColor: colors.forecast }}
          >
            {copy.forecast}
          </span>
        </div>
      )}
      {hoveredPoint && tooltipPos && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-slate-300 bg-white/95 px-2 py-1 shadow-lg backdrop-blur-sm"
          style={{
            left: `${Math.max(10, Math.min(w - 10, tooltipPos.x + (shouldFlipLeft ? -tooltipWidth / 2 : tooltipWidth / 2))) }px`,
            top: `${Math.max(10, tooltipPos.y + (shouldDropBelow ? 14 : -12))}px`,
            transform: shouldDropBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            width: `${tooltipWidth}px`,
            fontFamily: "inherit",
          }}
        >
          <div className="text-[11px] font-semibold text-slate-900">{hoveredLabel}</div>
          <div className="text-[11px] text-slate-700">{formatMetric(hoveredValue)}</div>
          {isForecastPoint && (
            <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.forecast }}>
              {copy.forecast}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function InsightFeed({
  sheetId,
  context = "dashboard",
  user,
  onOpenChart,
  className = "",
  locale,
  copy = DASHBOARD_COPY_EN,
}) {
  const ui = copy || DASHBOARD_COPY_EN;
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [audioError, setAudioError] = React.useState("");
  const [cards, setCards] = React.useState([]);
  const [settings, setSettings] = React.useState(null);
  const [available, setAvailable] = React.useState({ dateColumns: [], metricColumns: [] });
  const [showSettings, setShowSettings] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [audioLoadingCardId, setAudioLoadingCardId] = React.useState("");
  const [audioPlayingCardId, setAudioPlayingCardId] = React.useState("");
  const [revisionKey, setRevisionKey] = React.useState("");
  const currentAudioRef = React.useRef(null);
  const autoChartKeyRef = React.useRef("");
  const renderDriverChangesBullet = React.useCallback((text, key) => {
    const line = String(text || "");
    const isDriverLine = line.startsWith("Drivers gained: ") || line.startsWith("Drivers lost: ");
    if (!isDriverLine) return <li key={key}>{line}</li>;
    const [prefix, restRaw] = line.split(": ");
    const rest = String(restRaw || "");
    if (!rest || rest.toLowerCase().includes("none in top changes")) {
      return <li key={key}>{line}</li>;
    }
    const parts = rest.split("; ").filter(Boolean);
    return (
      <li key={key}>
        {prefix}:{" "}
        {parts.map((part, idx) => {
          const markerIdx = part.indexOf(" (");
          if (markerIdx <= 0) return <React.Fragment key={`${key}-p-${idx}`}>{idx > 0 ? "; " : ""}{part}</React.Fragment>;
          const driver = part.slice(0, markerIdx);
          const details = part.slice(markerIdx);
          return (
            <React.Fragment key={`${key}-p-${idx}`}>
              {idx > 0 ? "; " : ""}
              <strong>{driver}</strong>
              {details}
            </React.Fragment>
          );
        })}
        .
      </li>
    );
  }, []);
  const renderEmphasizedBullet = React.useCallback((text, key) => {
    const line = String(text || "");
    if (!line.includes(" (")) return <li key={key}>{line}</li>;

    const [prefix, restRaw] = line.includes(": ") ? line.split(": ") : ["", line];
    const rest = String(restRaw || "");
    const parts = rest.split("; ").filter(Boolean);
    if (!parts.length) return <li key={key}>{line}</li>;

    return (
      <li key={key}>
        {prefix ? `${prefix}: ` : ""}
        {parts.map((part, idx) => {
          const markerIdx = part.indexOf(" (");
          if (markerIdx <= 0) return <React.Fragment key={`${key}-g-${idx}`}>{idx > 0 ? "; " : ""}{part}</React.Fragment>;
          const entity = part.slice(0, markerIdx);
          const details = part.slice(markerIdx);
          return (
            <React.Fragment key={`${key}-g-${idx}`}>
              {idx > 0 ? "; " : ""}
              <strong>{entity}</strong>
              {details}
            </React.Fragment>
          );
        })}
      </li>
    );
  }, []);
  const resolveCardDirectionTone = React.useCallback((card) => {
    const deltaPct = Number(card?.deltaPct);
    if (Number.isFinite(deltaPct) && deltaPct !== 0) return deltaPct > 0 ? "up" : "down";
    const delta = Number(card?.delta);
    if (Number.isFinite(delta) && delta !== 0) return delta > 0 ? "up" : "down";
    const projectedPct = Number(card?.projectedPct);
    if (Number.isFinite(projectedPct) && projectedPct !== 0) return projectedPct > 0 ? "up" : "down";
    const projectedDelta = Number(card?.projectedDelta);
    if (Number.isFinite(projectedDelta) && projectedDelta !== 0) return projectedDelta > 0 ? "up" : "down";
    if (card?.direction === "down") return "down";
    if (card?.direction === "up") return "up";
    return "neutral";
  }, []);

  const getInsightErrorMessage = React.useCallback((requestError) => {
    const errorCode = requestError?.response?.data?.error;
    if (errorCode === "sheet_too_large_for_insights") {
      return formatTemplate(ui.sheetTooLargeForInsights || DASHBOARD_COPY_EN.sheetTooLargeForInsights, {
        maxRows: requestError?.response?.data?.maxRows ?? "unknown",
      });
    }
    return errorCode || ui.failedToLoadInsights;
  }, [ui]);

  const loadInsights = React.useCallback(async ({ forceRefresh = false } = {}) => {
    if (!sheetId) {
      setCards([]);
      setSettings(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    setAudioError("");
    try {
      const res = await api.get(`/insights/${sheetId}`, { params: { context, locale, forceRefresh: forceRefresh ? "1" : undefined } });
      setCards(Array.isArray(res?.data?.cards) ? res.data.cards : []);
      setSettings(res?.data?.settings || null);
      setAvailable(res?.data?.available || { dateColumns: [], metricColumns: [] });
      setRevisionKey(String(res?.data?.meta?.revisionKey || ""));
    } catch (e) {
      setError(getInsightErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [sheetId, context, locale, getInsightErrorMessage]);

  React.useEffect(() => () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
  }, []);

  const stopCurrentAudio = React.useCallback(() => {
    if (!currentAudioRef.current) return;
    currentAudioRef.current.onended = null;
    currentAudioRef.current.onerror = null;
    currentAudioRef.current.pause();
    currentAudioRef.current.src = "";
    currentAudioRef.current = null;
    setAudioPlayingCardId("");
  }, []);

  const playCardAudio = React.useCallback(async (card) => {
    if (!sheetId || !card?.id) return;
    if (audioPlayingCardId && audioPlayingCardId === card.id) {
      stopCurrentAudio();
      return;
    }
    setAudioLoadingCardId(card.id);
    setAudioError("");
    try {
      stopCurrentAudio();
      const requestPayload = {
        cardId: String(card.id),
        revisionKey: String(revisionKey || "none"),
        locale: locale || "en",
        title: String(card.title || ""),
        bullets: Array.isArray(card.bullets) ? card.bullets : [],
      };
      const localCacheKey = JSON.stringify({
        sheetId: String(sheetId || ""),
        revisionKey: String(revisionKey || "none"),
        locale: locale || "en",
        cardId: String(card.id || ""),
        title: String(card.title || ""),
        bullets: Array.isArray(card.bullets) ? card.bullets.map((b) => String(b || "")) : [],
      });

      const playBlob = async (blob) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        setAudioPlayingCardId(card.id);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (currentAudioRef.current === audio) currentAudioRef.current = null;
          setAudioPlayingCardId("");
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (currentAudioRef.current === audio) currentAudioRef.current = null;
          setAudioPlayingCardId("");
          setAudioError("Failed to play ticket audio");
        };
        await audio.play();
      };

      let lastErr = null;
      const cachedBlob = await getCachedInsightAudioBlob(localCacheKey);
      if (cachedBlob) {
        await playBlob(cachedBlob);
        setAudioLoadingCardId("");
        return;
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await api.post(
            `/insights/${sheetId}/audio`,
            requestPayload,
            { responseType: "blob" }
          );
          const blob = response?.data instanceof Blob ? response.data : new Blob([response.data], { type: "audio/mpeg" });
          await setCachedInsightAudioBlob(localCacheKey, blob);
          await playBlob(blob);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
        }
      }
      if (lastErr) throw lastErr;
    } catch (e) {
      setAudioError(e?.response?.data?.error || "Failed to play ticket audio");
      setAudioPlayingCardId("");
    } finally {
      setAudioLoadingCardId("");
    }
  }, [audioPlayingCardId, locale, revisionKey, sheetId, stopCurrentAudio]);

  React.useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const displayCards = React.useMemo(() => {
    if (!Array.isArray(cards) || cards.length === 0) return [];
    const seen = new Set();
    const uniqueCards = cards.filter((card) => {
      const signature = JSON.stringify({
        type: String(card?.type || ""),
        title: String(card?.title || ""),
        bullets: Array.isArray(card?.bullets) ? card.bullets.map((b) => String(b || "")) : [],
        graph: {
          labels: Array.isArray(card?.graph?.labels) ? card.graph.labels : [],
          values: Array.isArray(card?.graph?.values) ? card.graph.values : [],
          forecastStartIndex: Number.isInteger(card?.graph?.forecastStartIndex) ? card.graph.forecastStartIndex : null,
        },
        delta: Number.isFinite(Number(card?.delta)) ? Number(card.delta) : null,
        deltaPct: Number.isFinite(Number(card?.deltaPct)) ? Number(card.deltaPct) : null,
        projectedDelta: Number.isFinite(Number(card?.projectedDelta)) ? Number(card.projectedDelta) : null,
        projectedPct: Number.isFinite(Number(card?.projectedPct)) ? Number(card.projectedPct) : null,
        direction: String(card?.direction || ""),
      });
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });

    const decorated = uniqueCards.map((card, index) => ({
      card,
      index,
      tone: resolveCardDirectionTone(card),
    }));
    const hasDown = decorated.some((entry) => entry.tone === "down");
    const priority = hasDown
      ? { down: 0, up: 1, neutral: 2 }
      : { up: 0, neutral: 1, down: 2 };
    decorated.sort((a, b) => {
      const pa = priority[a.tone] ?? 3;
      const pb = priority[b.tone] ?? 3;
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    });
    return decorated.map((entry) => entry.card);
  }, [cards, resolveCardDirectionTone]);

  React.useEffect(() => {
    if (!sheetId || !Array.isArray(displayCards) || displayCards.length === 0) return;
    const firstChart = displayCards.find((c) => c?.actions?.chart)?.actions?.chart;
    if (!firstChart) return;

    const chartKey = `${sheetId}:${JSON.stringify(firstChart)}`;
    if (autoChartKeyRef.current === chartKey) return;
    autoChartKeyRef.current = chartKey;
    onOpenChart?.(firstChart);
  }, [sheetId, displayCards, onOpenChart]);

  const updateSetting = (key, value) => {
    setSettings((prev) => ({ ...(prev || {}), [key]: value }));
  };

  const toggleMutedMetric = (metric) => {
    setSettings((prev) => {
      const muted = new Set(Array.isArray(prev?.muted_metrics) ? prev.muted_metrics : []);
      if (muted.has(metric)) muted.delete(metric);
      else muted.add(metric);
      return { ...(prev || {}), muted_metrics: Array.from(muted) };
    });
  };

  const saveSettings = async () => {
    if (!sheetId || !settings) return;
    setSaving(true);
    try {
      await api.put(`/insights/${sheetId}/settings`, settings);
      await loadInsights();
    } catch (e) {
      setError(e?.response?.data?.error || ui.failedToSaveSettings);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`rounded-md border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">{ui.insightFeed}</div>
          <div className="text-xs text-slate-500">{ui.automaticInsights}</div>
        </div>
        <div className="flex items-center gap-2">
          {user?.role === "admin" && (
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => setShowSettings((v) => !v)}
            >
              {showSettings ? ui.hideSettings : ui.settings}
            </button>
          )}
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
            onClick={() => loadInsights({ forceRefresh: true })}
          >
            {ui.refresh}
          </button>
        </div>
      </div>

      {showSettings && user?.role === "admin" && settings && (
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-slate-700 font-semibold">
              {ui.minImpactPercent}
              <input
                type="number"
                min="1"
                max="100"
                value={settings.min_impact_percent ?? 5}
                onChange={(e) => updateSetting("min_impact_percent", Number(e.target.value))}
                className="w-full mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-700 font-semibold">
              {ui.preferredDateColumn}
              <select
                value={settings.preferred_date_column || ""}
                onChange={(e) => updateSetting("preferred_date_column", e.target.value || null)}
                className="w-full mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">{ui.autoDetect}</option>
                {available.dateColumns.map((col) => <option key={col} value={col}>{col}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-700 font-semibold">
              {ui.preferredMetricColumn}
              <select
                value={settings.preferred_metric_column || ""}
                onChange={(e) => updateSetting("preferred_metric_column", e.target.value || null)}
                className="w-full mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">{ui.autoDetect}</option>
                {available.metricColumns.map((col) => <option key={col} value={col}>{col}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">{ui.mutedMetrics}</div>
            <div className="flex flex-wrap gap-2">
              {available.metricColumns.map((metric) => {
                const isMuted = Array.isArray(settings.muted_metrics) && settings.muted_metrics.includes(metric);
                return (
                  <button
                    key={metric}
                    type="button"
                    onClick={() => toggleMutedMetric(metric)}
                    className={`text-xs px-2 py-1 rounded border ${isMuted ? "bg-slate-200 text-slate-700 border-slate-300" : "bg-white text-slate-700 border-slate-300"}`}
                  >
                    {isMuted ? `${ui.unmute} ${metric}` : `${ui.mute} ${metric}`}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving}
              className={`text-xs px-3 py-1.5 rounded ${saving ? "bg-slate-300 text-slate-600" : "bg-blue-700 text-white hover:bg-blue-800"}`}
            >
              {saving ? ui.saving : ui.saveInsightSettings}
            </button>
          </div>
        </div>
      )}

      <div className="p-4">
        {loading && <div className="text-sm text-slate-500">{ui.loadingInsights}</div>}
        {error && <div className="text-sm text-rose-600">{error}</div>}
        {!error && audioError && <div className="text-sm text-amber-600">{audioError}</div>}
        {!loading && !error && displayCards.length === 0 && (
          <div className="text-sm text-slate-500">{ui.noInsightsYet}</div>
        )}

        {!loading && !error && displayCards.length > 0 && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(280px,1fr))]">
            {displayCards.map((card) => {
              const isMajorWarning = card.type === "major_warning";
              const isDirectional = ["major_warning", "change_alert", "attention"].includes(card.type);
              const hideChart = card.type === "driver_changes";
              const computedDirectionalTone = resolveCardDirectionTone(card);
              const directionalTone = isDirectional ? computedDirectionalTone : null;
              return (
                <article
                  key={card.id}
                  className={`flex ${hideChart ? "min-h-[220px]" : "h-[360px]"} w-full flex-col overflow-hidden rounded-md border p-3 whitespace-normal ${
                    isDirectional
                      ? (directionalTone === "down"
                        ? "border-rose-300 bg-rose-50/70 shadow-sm ring-1 ring-rose-100"
                        : directionalTone === "up"
                          ? "border-emerald-300 bg-emerald-50/70 shadow-sm ring-1 ring-emerald-100"
                          : "border-amber-300 bg-amber-50/70 shadow-sm ring-1 ring-amber-100")
                      : card.type === "recommendation"
                        ? "border-orange-300 bg-orange-50/60"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-none flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-900">{card.title}</h4>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => playCardAudio(card)}
                        disabled={audioLoadingCardId === card.id}
                        className={`rounded border bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          audioPlayingCardId === card.id
                            ? "border-indigo-300 text-indigo-700"
                            : "border-slate-300 text-slate-700 hover:bg-slate-50"
                        } ${audioLoadingCardId === card.id ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        {audioLoadingCardId === card.id ? "Loading Audio" : audioPlayingCardId === card.id ? "Stop Audio" : "Read Ticket"}
                      </button>
                      {(card.type === "recommendation" || card.type === "attention" || isMajorWarning || card.type === "change_alert") && (
                        <span
                          className={`rounded-full border bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            isDirectional
                              ? (directionalTone === "down"
                                ? "border-rose-300 text-rose-700"
                                : directionalTone === "up"
                                  ? "border-emerald-300 text-emerald-700"
                                  : "border-amber-300 text-amber-700")
                              : "border-orange-300 text-orange-700"
                          }`}
                        >
                          {isDirectional
                            ? (directionalTone === "down" ? "Warning Down" : directionalTone === "up" ? "Warning Up" : "Warning")
                            : card.type === "attention" ? ui.needsAttention : ui.recommendation}
                        </span>
                      )}
                    </div>
                  </div>
                  <ul className="mt-2 min-h-0 flex-1 overflow-y-auto list-disc pl-5 text-xs text-slate-700 space-y-1 custom-scrollbar">
                    {(card.bullets || []).map((b, idx) => {
                      const bulletKey = `${card.id}-b-${idx}`;
                      if (card.type === "driver_changes") {
                        return renderDriverChangesBullet(b, bulletKey);
                      }
                      return renderEmphasizedBullet(b, bulletKey);
                    })}
                  </ul>
                  {!hideChart && (
                    <div className="mt-3 shrink-0 border-t border-slate-200 pt-2">
                      <Sparkline graph={card.graph} cardType={card.type} direction={card.direction} locale={locale} copy={ui} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
