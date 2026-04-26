import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import MultiSelect from "../common/MultiSelect";
import TrendTooltip from "./TrendTooltip";
import { formatSmart } from "../../utils/formatting";

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6", "#0ea5e9", "#ec4899", "#84cc16"];

function formatTrendAxisLabel(label, trendGranularity, compareYears) {
    const raw = String(label ?? "");
    const hasCompare = Array.isArray(compareYears) && compareYears.length > 0;

    if (trendGranularity === "month") {
        if (hasCompare && /^\d{2}$/.test(raw)) {
            return new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(2000, Number(raw) - 1, 1));
        }
        if (/^\d{4}-\d{2}$/.test(raw)) {
            const [y, m] = raw.split("-").map(Number);
            return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(new Date(y, m - 1, 1));
        }
    }

    if (trendGranularity === "day") {
        if (hasCompare && /^\d{2}-\d{2}$/.test(raw)) {
            const [m, d] = raw.split("-").map(Number);
            return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(2000, m - 1, d));
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const [y, m, d] = raw.split("-").map(Number);
            return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
        }
    }

    return raw;
}

export default function TrendsOverlay({
    setTrendsOn,
    trendsDateKey, setTrendsDateKey,
    headers,
    tabs = [],
    activeTab = "",
    onTabChange,
    trendsValueKey, setTrendsValueKey,
    trendGranularity, setTrendGranularity,
    compareYears, setCompareYears,
    trendYearOptions,
    trendsData
}) {
    return (
        <div className="bg-white border-b p-6 shadow-inner animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex justify-between mb-6 border-b pb-2">
                <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2">📈 Trend Analysis</h3>
                <button onClick={() => setTrendsOn(false)} className="text-gray-400 hover:text-gray-600 transition-colors">✕ Close</button>
            </div>
            <div className="flex gap-4 mb-6 flex-wrap items-end">
                {Array.isArray(tabs) && tabs.length > 0 && (
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Tab</label>
                        <select
                            value={activeTab || tabs[0] || ""}
                            onChange={(e) => onTabChange && onTabChange(e.target.value)}
                            className="border border-slate-300 bg-white px-2.5 py-1 rounded-md text-xs font-bold min-w-[180px] h-8"
                        >
                            {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                )}
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Date Column</label>
                    <select value={trendsDateKey || ""} onChange={e => setTrendsDateKey(e.target.value)} className="border border-slate-300 bg-white px-2.5 py-1 rounded-md text-xs font-bold min-w-[180px] h-8">
                        <option value="">Auto-detect...</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Value to Plot</label>
                    <select value={trendsValueKey || ""} onChange={e => setTrendsValueKey(e.target.value)} className="border border-slate-300 bg-white px-2.5 py-1 rounded-md text-xs font-bold min-w-[180px] h-8">
                        <option value="">Select...</option>
                        {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Granularity</label>
                    <select value={trendGranularity} onChange={e => setTrendGranularity(e.target.value)} className="border border-slate-300 bg-white px-2.5 py-1 rounded-md text-xs font-bold h-8">
                        <option value="quarter">Quarterly</option>
                        <option value="month">Monthly</option>
                        <option value="year">Yearly</option>
                        <option value="day">Daily</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Select Years</label>
                    <MultiSelect
                        options={trendYearOptions}
                        value={compareYears}
                        onChange={setCompareYears}
                        placeholder="Select years..."
                        className="min-w-[160px] h-8"
                    />
                </div>
            </div>
            <div className="h-80 w-full bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                {trendsData && trendsData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendsData} margin={{ top: 8, right: 20, left: 24, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 12, fill: "#334155", fontWeight: 700 }}
                                tickLine={false}
                                axisLine={false}
                                dy={10}
                                tickFormatter={(label) => formatTrendAxisLabel(label, trendGranularity, compareYears)}
                            />
                            <YAxis
                                tick={{ fontSize: 12, fill: "#334155", fontWeight: 700 }}
                                tickLine={false}
                                axisLine={false}
                                dx={-4}
                                tickFormatter={(val) => formatSmart(val, trendsValueKey)}
                                width={130}
                            />
                            <Tooltip
                                content={<TrendTooltip />}
                                labelFormatter={(label) => formatTrendAxisLabel(label, trendGranularity, compareYears)}
                                cursor={{ stroke: "#cbd5e1", strokeWidth: 1, strokeDasharray: "4 4" }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700, color: "#1f2937" }} />

                            {(!compareYears || compareYears.length === 0) ? (
                                // Single Line
                                <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: 'white' }} activeDot={{ r: 8, fill: '#3b82f6' }} />
                            ) : (
                                // Comparison Lines (selected years)
                                [...compareYears].sort((a, b) => b - a).map((year, i) => (
                                    <Line
                                        key={year}
                                        type="monotone"
                                        dataKey={String(year)} // The key in data object is the year string
                                        stroke={COLORS[i % COLORS.length]}
                                        strokeWidth={3}
                                        dot={{ r: 4, strokeWidth: 2, fill: 'white' }}
                                        activeDot={{ r: 8 }}
                                        name={String(year)}
                                    />
                                ))
                            )}
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <span className="text-4xl mb-2">📉</span>
                        <span className="text-sm font-medium">Select a valid date and value column to see trends.</span>
                    </div>
                )}
            </div>
        </div>
    );
}
