import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

export default function ColumnFilterMenu({
    anchorMapRef,
    columnKey,
    column,
    allValues = [],
    appliedSelected = null,
    onApply,
    onClear,
    onClose,
    tableContainerRef,
}) {
    const panelRef = useRef(null);
    const [q, setQ] = useState("");
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const [measured, setMeasured] = useState(false);

    const values = Array.isArray(allValues) ? allValues : [];

    const [localSet, setLocalSet] = useState(new Set());
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (values.length > 0 && !initialized) {
            if (appliedSelected && appliedSelected.size > 0) {
                setLocalSet(new Set([...appliedSelected]));
            } else {
                setLocalSet(new Set(values.map((v) => String(v))));
            }
            setInitialized(true);
        }
    }, [values, appliedSelected, initialized]);

    const [allChecked, setAllChecked] = useState(
        !appliedSelected || appliedSelected.size === values.length
    );

    const shown = q
        ? values.filter((v) => String(v).toLowerCase().includes(q.toLowerCase()))
        : values;

    // Try to place the menu. Returns true if successful.
    const placeMenu = () => {
        const a = anchorMapRef?.current?.[columnKey];
        if (!a) return false;

        const r = a.getBoundingClientRect();
        // If rect is all zeros, it's likely not visible/laid out yet
        if (!r || (r.left === 0 && r.right === 0 && r.top === 0 && r.bottom === 0)) return false;

        const menuWidth = 256;
        const pad = 8;
        let left = r.left;

        // Keep within viewport
        if (left + menuWidth + pad > window.innerWidth) {
            left = Math.max(pad, window.innerWidth - menuWidth - pad);
        }
        const top = r.bottom + 6;

        setCoords({ top, left });
        setMeasured(true); // Make visible
        return true;
    };

    useLayoutEffect(() => {
        const scrollContainer = tableContainerRef.current;
        if (!scrollContainer) return;

        // Retry placement a few times to handle layout race conditions
        let attempts = 0;
        const maxAttempts = 10;

        // Initial try
        if (placeMenu()) return;

        const intervalId = setInterval(() => {
            attempts++;
            if (placeMenu() || attempts >= maxAttempts) {
                clearInterval(intervalId);
            }
        }, 50);

        return () => clearInterval(intervalId);
    }, [anchorMapRef, columnKey, tableContainerRef]);

    useEffect(() => {
        const onWin = () => placeMenu();
        window.addEventListener("resize", onWin);
        window.addEventListener("scroll", onWin, true);
        return () => {
            window.removeEventListener("resize", onWin);
            window.removeEventListener("scroll", onWin, true);
        };
    }, []);

    useEffect(() => {
        function onDocClick(e) {
            const p = panelRef.current;
            const a = anchorMapRef?.current?.[columnKey];
            if (!p || !a) return;
            if (p.contains(e.target) || a.contains(e.target)) return;
            onClose?.();
        }
        function onEsc(e) {
            if (e.key === "Escape") onClose?.();
        }
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onEsc);
        };
    }, [anchorMapRef, columnKey, onClose]);

    useEffect(() => {
        setAllChecked(localSet.size === values.length);
    }, [localSet, values.length]);

    const toggleValue = (val) => {
        const sv = String(val);
        const next = new Set(localSet);
        if (next.has(sv)) next.delete(sv);
        else next.add(sv);
        setLocalSet(next);
    };

    const handleSelectAll = () => setLocalSet(new Set(values.map((v) => String(v))));
    const handleClearAll = () => setLocalSet(new Set());
    const handleApply = () => {
        if (localSet.size === values.length) onApply(column, null);
        else onApply(column, localSet);
        onClose?.();
    };

    if (!measured) return null;

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[9999] bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 w-64 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-200 origin-top"
            style={{ top: coords.top, left: coords.left }}
            role="dialog"
            aria-label={`Filter ${column}`}
        >
            <div className="mb-3 font-bold text-[10px] uppercase tracking-widest text-slate-500 ml-1">Filter: {column}</div>

            <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search values…"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 mb-3 text-black placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all text-[11px] font-medium"
            />

            <div className="flex gap-2 mb-3">
                <button
                    className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 transition-all flex-1"
                    onClick={handleSelectAll}
                >
                    Select All
                </button>
                <button
                    className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 transition-all flex-1"
                    onClick={handleClearAll}
                >
                    None
                </button>
            </div>

            <div className="max-h-48 overflow-auto border border-slate-100 rounded-xl bg-slate-50/50 custom-scrollbar">
                {!values.length ? (
                    <div className="text-slate-400 text-[10px] font-bold uppercase p-8 text-center animate-pulse">Loading values…</div>
                ) : shown.length ? (
                    <div className="p-1">
                        {shown.slice(0, 100).map((v, i) => {
                            const sv = String(v);
                            const checked = localSet.has(sv);
                            return (
                                <label
                                    key={i}
                                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                                        checked ? "bg-indigo-50 text-indigo-700" : "hover:bg-white text-slate-600 hover:shadow-sm"
                                    }`}
                                    title={sv}
                                >
                                    <input
                                        type="checkbox"
                                        className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 transition-all"
                                        checked={checked}
                                        onChange={() => toggleValue(v)}
                                    />
                                    <span className="truncate">{sv || "—"}</span>
                                </label>
                            );
                        })}
                        {shown.length > 100 && (
                            <div className="text-[9px] font-bold text-slate-400 p-2 text-center border-t border-slate-100 mt-1 uppercase tracking-tighter">
                                +{shown.length - 100} more… search to refine
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-slate-400 text-[10px] font-bold uppercase p-4 text-center">No matches</div>
                )}
            </div>

            <div className="mt-4 flex justify-between items-center pt-3 border-t border-slate-100">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">
                    {allChecked ? "All active" : `${localSet.size} selected`}
                </div>
                <div className="flex gap-2">
                    <button
                        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-all"
                        onClick={() => {
                            onClear(column);
                            onClose?.();
                        }}
                    >
                        Reset
                    </button>
                    <button
                        className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-100 transition-all hover:scale-105 active:scale-95"
                        onClick={handleApply}
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
