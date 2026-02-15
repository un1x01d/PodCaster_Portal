import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import TrendTooltip from "./TrendTooltip";
import { formatSmart } from "../../utils/formatting";

export default function TwoConditionOverlay({
    setTwoOn,
    condCol1, setCondCol1,
    headers,
    condCol2, setCondCol2,
    valueCol, setValueCol,
    summaryData
}) {
    return (
        <div className="bg-white border-b p-6 shadow-inner animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex justify-between mb-6 border-b pb-2">
                <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2">🔬 Multi-Condition Breakdown</h3>
                <button onClick={() => setTwoOn(false)} className="text-gray-400 hover:text-gray-600 transition-colors">✕ Close</button>
            </div>
            <div className="flex gap-4 mb-6 items-end flex-wrap">
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Condition 1 (Filter Context)</label>
                    <select value={condCol1 || ""} onChange={e => setCondCol1(e.target.value)} className="border border-slate-300 bg-white p-2 rounded-lg text-sm min-w-[200px] h-10">
                        <option value="">(Any)</option>
                        {headers.map(h => <option key={h}>{h}</option>)}
                    </select>
                </div>
                <div className="pb-3 text-gray-400 font-bold">+</div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Condition 2 (Group By)</label>
                    <select value={condCol2 || ""} onChange={e => setCondCol2(e.target.value)} className="border border-slate-300 bg-white p-2 rounded-lg text-sm min-w-[200px] h-10">
                        <option value="">(None)</option>
                        {headers.map(h => <option key={h}>{h}</option>)}
                    </select>
                </div>
                <div className="pb-3 text-gray-400 font-bold">→</div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Value to Sum</label>
                    <select value={valueCol || ""} onChange={e => setValueCol(e.target.value)} className="border border-slate-300 bg-white p-2 rounded-lg text-sm min-w-[200px] h-10">
                        <option value="">Select...</option>
                        {headers.map(h => <option key={h}>{h}</option>)}
                    </select>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="col-span-1 bg-gradient-to-br from-blue-50 to-white p-6 rounded-2xl border border-blue-100 flex flex-col justify-center items-center shadow-sm">
                    <span className="text-xs text-blue-600 font-bold uppercase tracking-widest mb-2">Total Result</span>
                    <span className="text-4xl font-extrabold text-blue-900 tracking-tight">
                        {summaryData?.total != null ? formatSmart(summaryData.total, valueCol) : '$0'}
                    </span>
                    <span className="text-xs text-blue-400 mt-2 font-medium">Based on current filters</span>
                </div>

                <div className="col-span-2 h-64 border rounded-xl p-4 bg-white shadow-sm flex flex-col">
                    <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Distribution by Group</h4>
                    {summaryData?.chartData?.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={summaryData.chartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                <XAxis type="number" hide />
                                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} interval={0} />
                                <Tooltip content={<TrendTooltip />} cursor={{ fill: '#f1f5f9' }} />
                                <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
                            <span className="text-sm font-medium">Select 'Condition 2' and 'Value' to see breakdown</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
