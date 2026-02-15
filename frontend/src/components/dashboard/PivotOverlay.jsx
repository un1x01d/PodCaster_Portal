import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import SearchableSelect from "../common/SearchableSelect";
import TrendTooltip from "./TrendTooltip";
import { formatSmart } from "../../utils/formatting";

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#6366f1", "#14b9a6"];

export default function PivotOverlay({
    setPivotOn,
    pivotRowKey, setPivotRowKey,
    pivotColKey, setPivotColKey,
    pivotValKey, setPivotValKey,
    pivotAgg, setPivotAgg,
    resetPivot,
    displayHeaders,
    pieData,
    pivotRows,
    pivotHeaders
}) {
    return (
        <div className="p-4 bg-slate-50 border-y border-slate-200/70">
            <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-gray-200 pb-2 mb-2">
                    <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">📐 Pivot & Segmentation</h3>
                    <button onClick={() => setPivotOn(false)} className="text-gray-400 hover:text-gray-600">✕ Close</button>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <SearchableSelect
                        options={[{ value: "", label: "Row key…" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                        value={pivotRowKey}
                        onChange={(e) => setPivotRowKey(e.target.value)}
                        placeholder="Row key…"
                        buttonClassName="border border-slate-200 px-2 rounded-lg min-w-[14rem] bg-white h-8 text-xs"
                    />
                    <SearchableSelect
                        options={[{ value: "", label: "Dynamic header…" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                        value={pivotColKey}
                        onChange={(e) => setPivotColKey(e.target.value)}
                        placeholder="Dynamic header…"
                        buttonClassName="border border-slate-200 px-2 rounded-lg min-w-[14rem] bg-white h-8 text-xs"
                    />
                    <SearchableSelect
                        options={[
                            { value: "", label: pivotAgg === "count" ? "— (count)" : "Value…" },
                            ...displayHeaders.map((h) => ({ value: h, label: h })),
                        ]}
                        value={pivotValKey}
                        onChange={(e) => setPivotValKey(e.target.value)}
                        placeholder={pivotAgg === "count" ? "— (count)" : "Value…"}
                        disabled={pivotAgg === "count"}
                        buttonClassName="border border-slate-200 px-2 rounded-lg min-w-[14rem] bg-white h-8 text-xs"
                    />
                    <SearchableSelect
                        options={[
                            { value: "sum", label: "sum" },
                            { value: "count", label: "count" },
                            { value: "avg", label: "average" },
                        ]}
                        value={pivotAgg}
                        onChange={(e) => setPivotAgg(e.target.value)}
                        placeholder="Aggregation…"
                        panelWidth={180}
                        buttonClassName="border border-slate-200 px-2 rounded-lg min-w-[10rem] bg-white h-8 text-xs"
                    />
                    <div className="flex gap-2 ml-auto">
                        <button onClick={resetPivot} className="px-3 bg-white border border-slate-200 rounded-lg h-8 hover:bg-gray-50 text-xs font-semibold whitespace-nowrap">Reset</button>
                    </div>
                </div>

                {/* Pivot Chart & Table Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-96 mt-4">
                    <div className="col-span-2 bg-white border rounded-xl p-4 shadow-sm flex flex-col overflow-hidden">
                        <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase text-center tracking-wider">Distribution</h4>
                        {pieData && pieData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={pieData}
                                    margin={{ top: 10, right: 30, left: 10, bottom: 60 }}
                                >
                                    <XAxis
                                        dataKey="name"
                                        angle={-45}
                                        textAnchor="end"
                                        height={60}
                                        interval={0}
                                        tick={{ fontSize: 11, fill: '#6b7280' }}
                                    />
                                    <YAxis tickFormatter={(val) => formatSmart(val, pivotValKey || "Value")} width={80} tick={{ fontSize: 11 }} />
                                    <Tooltip content={<TrendTooltip />} cursor={{ fill: '#f1f5f9' }} />
                                    <Bar dataKey="value" fill="#8884d8">
                                        {pieData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-400">Select Row Key and Value to visualize</div>
                        )}
                    </div>
                    <div className="col-span-1 bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
                        <div className="bg-gray-50 font-bold border-b p-3 flex justify-between items-center">
                            <span className="uppercase text-xs tracking-wider text-gray-500">Pivot Table</span>
                            <span className="text-xs font-normal text-gray-400">{pivotRows?.length || 0} rows</span>
                        </div>
                        <div className="overflow-auto flex-1">
                            <table className="min-w-full text-xs text-left">
                                <thead className="bg-gray-100 font-bold border-b sticky top-0 z-10">
                                    <tr>
                                        {pivotHeaders && pivotHeaders.map((h, i) => (
                                            <th key={i} className={`p-3 whitespace-nowrap bg-gray-100 text-gray-600 ${i > 0 ? 'text-right' : ''} text-[11px]`}>
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pivotRows && pivotRows.map((row, i) => (
                                        <tr key={i} className="border-b last:border-0 hover:bg-blue-50 transition-colors">
                                            {pivotHeaders.map((h, j) => (
                                                <td key={j} className={`p-3 whitespace-nowrap ${j > 0 ? 'text-right font-mono text-blue-700' : 'font-medium text-gray-800'}`}>
                                                    {typeof row[h] === 'number'
                                                        ? formatSmart(row[h], h)
                                                        : (row[h] || '-')}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {(!pivotRows || pivotRows.length === 0) && (
                                        <tr>
                                            <td colSpan={pivotHeaders?.length || 1} className="p-8 text-center text-gray-400 italic">
                                                No pivot data. Select Group and Value columns.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
