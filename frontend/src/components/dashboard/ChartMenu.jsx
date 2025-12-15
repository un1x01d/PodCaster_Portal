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
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 rounded-lg h-10 shadow flex items-center gap-2"
                title="Chart options"
            >
                Charts
                <span className="opacity-90">▾</span>
            </button>

            {open && (
                <div
                    ref={panelRef}
                    className="absolute z-50 mt-1 right-0 w-56 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
                >
                    <div className="bg-blue-50 text-xs px-3 py-2 border-b border-slate-100">
                        Toggle Charts
                    </div>
                    <button
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-gray-900 flex items-center justify-between"
                        onClick={() => { setPivotOn((p) => !p); }}
                    >
                        <span>Pivot</span>
                        <span className={`text-xs font-semibold ${pivotOn ? "text-blue-600" : "text-gray-400"}`}>
                            {pivotOn ? "ON" : "OFF"}
                        </span>
                    </button>
                    <button
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-gray-900 flex items-center justify-between"
                        onClick={() => { setTwoOn((p) => !p); }}
                    >
                        <span>Two-Condition</span>
                        <span className={`text-xs font-semibold ${twoOn ? "text-blue-600" : "text-gray-400"}`}>
                            {twoOn ? "ON" : "OFF"}
                        </span>
                    </button>
                    <button
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-gray-900 border-t border-gray-100 flex items-center justify-between"
                        onClick={() => { setTrendsOn((p) => !p); }}
                    >
                        <span>Trends</span>
                        <span className={`text-xs font-semibold ${trendsOn ? "text-blue-600" : "text-gray-400"}`}>
                            {trendsOn ? "ON" : "OFF"}
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
}
