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

    const [localSet, setLocalSet] = useState(() => {
        if (appliedSelected && appliedSelected.size > 0) {
            return new Set([...appliedSelected]);
        }
        return new Set(values.map((v) => String(v)));
    });

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

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[9999] bg-white border border-slate-200 rounded-xl shadow-2xl p-3 w-64 ring-1 ring-black/5"
            style={{ top: coords.top, left: coords.left, visibility: measured ? "visible" : "hidden" }}
            role="dialog"
            aria-label={`Filter ${column}`}
        >
            <div className="mb-2 font-semibold text-sm text-gray-800">Filter: {column}</div>

            <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search values…"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-2 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all text-sm"
            />

            <div className="flex gap-2 mb-2">
                <button
                    className="text-[11px] px-2 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors"
                    onClick={handleSelectAll}
                    title="Select all values"
                >
                    Select All
                </button>
                <button
                    className="text-[11px] px-2 py-1 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition-colors"
                    onClick={handleClearAll}
                    title="Clear all selections"
                >
                    Clear
                </button>
            </div>

            <div className="max-h-56 overflow-auto border border-slate-200 rounded-lg">
                {shown.length ? (
                    <>
                        {shown.slice(0, 100).map((v, i) => {
                            const sv = String(v);
                            const checked = localSet.has(sv);
                            return (
                                <label
                                    key={i}
                                    className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-blue-50 cursor-pointer text-gray-900"
                                    title={sv}
                                >
                                    <input
                                        type="checkbox"
                                        className="cursor-pointer accent-blue-600"
                                        checked={checked}
                                        onChange={() => toggleValue(v)}
                                    />
                                    <span className="truncate">{sv || "—"}</span>
                                </label>
                            );
                        })}
                        {shown.length > 100 && (
                            <div className="text-xs text-gray-400 p-2 text-center border-t border-gray-100 bg-gray-50 italic">
                                Showing top 100 of {shown.length} values. Search to find others.
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-gray-500 text-xs p-2">No values</div>
                )}
            </div>

            <div className="mt-3 flex justify-between items-center">
                <div className="text-xs text-gray-600">
                    {allChecked ? "All selected" : `${localSet.size} selected`}
                </div>
                <div className="flex gap-2">
                    <button
                        className="px-3 py-1.5 text-sm rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 transition-all font-medium"
                        onClick={() => {
                            onClear(column);
                            onClose?.();
                        }}
                    >
                        Clear
                    </button>
                    <button
                        className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-all font-semibold"
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
