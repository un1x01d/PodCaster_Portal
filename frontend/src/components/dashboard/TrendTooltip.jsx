import React from "react";

export default function TrendTooltip({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null;

    return (
        <div className="bg-white/95 backdrop-blur-sm border border-slate-200/60 rounded-xl shadow-2xl p-3 min-w-[180px] animate-in fade-in zoom-in-95 duration-200 ring-1 ring-black/5">
            {label && (
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 pb-1.5 border-b border-slate-100">
                    {label}
                </div>
            )}
            <div className="space-y-2">
                {payload.map((p, i) => {
                    const isPercent = p.name && /(pct|percent|rate|ratio|%)/i.test(p.name);
                    const isCurrency = !isPercent && p.name && /(price|cost|expense|income|budget|fee|amount|revenue|sales|total|value|profit|margin|\$)/i.test(p.name);

                    let val = p.value;
                    if (typeof p.value === 'number') {
                        const fmt = new Intl.NumberFormat('en-US', {
                            minimumFractionDigits: (isCurrency || isPercent) ? 2 : 0,
                            maximumFractionDigits: 2
                        }).format(p.value);

                        if (isCurrency) val = `$${fmt}`;
                        else if (isPercent) val = `${fmt}%`;
                        else val = fmt;
                    }

                    return (
                        <div key={i} className="flex justify-between items-center gap-4">
                            <div className="flex items-center gap-2">
                                <span
                                    className="w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm"
                                    style={{ backgroundColor: p.color || p.fill || '#3b82f6' }}
                                />
                                <span className="font-medium text-xs text-slate-600">{p.name}</span>
                            </div>
                            <span className="font-mono font-bold text-sm text-slate-900 tracking-tight">
                                {val}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
