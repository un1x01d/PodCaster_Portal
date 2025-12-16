import React, { useState, useEffect, useRef } from "react";

export default function ChartMenu({ pivotOn, setPivotOn, twoOn, setTwoOn, trendsOn, setTrendsOn }) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef(null);
    const panelRef = useRef(null);

    useEffect(() => {
        const onDocClick = (e) => {
            if (!btnRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) {
                setOpen(false);
            }
        };
        const onEsc = (e) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onEsc);
        };
    }, []);

    return (
        <div className="relative inline-block">
            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 rounded-lg h-9 shadow-sm flex items-center gap-2 transition-all font-semibold text-sm"
                title="Chart options"
            >
                <span>Charts</span>
                <span className="opacity-50 text-xs">▼</span>
            </button>

            {open && (
                <div
                    ref={panelRef}
                    className="absolute z-50 mt-2 right-0 w-64 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden ring-1 ring-black/5"
                >
                    <div className="bg-slate-50 text-xs font-semibold px-4 py-2 border-b border-slate-200 text-slate-500 uppercase tracking-wider">
                        Toggle Charts
                    </div>
                    <div className="p-1">
                        <button
                            className="w-full text-left px-3 py-2.5 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-between rounded-lg transition-colors"
                            onClick={() => { setPivotOn((p) => !p); }}
                        >
                            <span className="font-medium text-sm">Pivot Table</span>
                            <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${pivotOn
                                    ? "bg-blue-50 text-blue-600 border-blue-100"
                                    : "bg-slate-50 text-slate-400 border-slate-200"
                                    }`}
                            >
                                {pivotOn ? "ON" : "OFF"}
                            </span>
                        </button>
                        <button
                            className="w-full text-left px-3 py-2.5 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-between rounded-lg transition-colors"
                            onClick={() => { setTwoOn((p) => !p); }}
                        >
                            <span className="font-medium text-sm">Two-Condition</span>
                            <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${twoOn
                                    ? "bg-blue-50 text-blue-600 border-blue-100"
                                    : "bg-slate-50 text-slate-400 border-slate-200"
                                    }`}
                            >
                                {twoOn ? "ON" : "OFF"}
                            </span>
                        </button>
                        <button
                            className="w-full text-left px-3 py-2.5 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-between rounded-lg transition-colors"
                            onClick={() => { setTrendsOn((p) => !p); }}
                        >
                            <span className="font-medium text-sm">Trends</span>
                            <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${trendsOn
                                    ? "bg-blue-50 text-blue-600 border-blue-100"
                                    : "bg-slate-50 text-slate-400 border-slate-200"
                                    }`}
                            >
                                {trendsOn ? "ON" : "OFF"}
                            </span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
