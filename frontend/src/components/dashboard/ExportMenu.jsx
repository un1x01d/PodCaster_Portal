import React, { useState, useEffect, useRef } from "react";

export default function ExportMenu({ onCSV, onXLSX, onPDF }) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef(null);
    const panelRef = useRef(null);

    useEffect(() => {
        function onDocClick(e) {
            if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
            setOpen(false);
        }
        function onEsc(e) {
            if (e.key === "Escape") setOpen(false);
        }
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
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded-lg h-8 shadow-sm flex items-center gap-2 transition-all font-semibold text-xs whitespace-nowrap"
                title="Export options"
            >
                <span>Export</span>
                <span className="opacity-90 text-xs">▼</span>
            </button>

            {open && (
                <div
                    ref={panelRef}
                    className="absolute z-50 mt-1 right-0 w-48 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
                >
                    <div className="bg-slate-50 text-xs font-semibold px-4 py-2 border-b border-slate-200 text-slate-500 uppercase tracking-wider">
                        Download as…
                    </div>
                    <button
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-slate-700 font-medium text-sm transition-colors"
                        onClick={() => { setOpen(false); onCSV?.(); }}
                    >
                        CSV (.csv)
                    </button>
                    <button
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-slate-700 font-medium text-sm transition-colors"
                        onClick={() => { setOpen(false); onXLSX?.(); }}
                    >
                        Excel (.xlsx)
                    </button>
                    <button
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-slate-700 font-medium text-sm border-t border-slate-100 transition-colors"
                        onClick={() => { setOpen(false); onPDF?.(); }}
                    >
                        PDF (.pdf)
                    </button>
                </div>
            )}
        </div>
    );
}
