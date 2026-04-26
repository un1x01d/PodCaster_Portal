import React, { useState, useEffect, useRef } from "react";

export default function SearchableSelect({
    options = [],
    value = "",
    onChange = () => { },
    onDelete = null,
    placeholder = "Select…",
    className = "",
    disabled = false,
    buttonClassName = "flex items-center justify-between w-full border border-slate-300 bg-white px-2.5 py-1 rounded-md text-xs transition-colors shadow-sm h-8 hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-200",
    panelWidth = "100%",
    panelMinWidth = "100%",
    panelMaxWidth = undefined,
    labelClassName = "",
    optionClassName = "",
    optionTextClassName = "",
    panelClassName = "",
    searchInputClassName = "",
    selectedOptionClassName = "bg-slate-100",
    panelStyle = {},
    optionStyle = {},
    selectedOptionStyle = {},
    optionTextStyle = {},
    searchInputStyle = {},
}) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const btnRef = useRef(null);
    const panelRef = useRef(null);

    const selected = options.find((o) => String(o.value) === String(value));
    const filtered = q
        ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
        : options;
    const resolvedPanelWidth = panelMaxWidth ? "max-content" : panelWidth;

    useEffect(() => {
        function onDocClick(e) {
            const b = btnRef.current;
            const p = panelRef.current;
            if (!b || !p) return;
            if (b.contains(e.target) || p.contains(e.target)) return;
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

    useEffect(() => {
        if (!open) setQ("");
    }, [open]);

    return (
        <div className={`relative inline-flex align-top ${className}`}>
            <button
                ref={btnRef}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setOpen((o) => !o)}
                className={`${buttonClassName} flex items-center justify-between gap-2 ${disabled ? "bg-gray-100 cursor-not-allowed text-gray-400" : ""
                    }`}
                title={selected?.label || placeholder}
                style={{ maxWidth: "100%" }}
            >
                <div className={`truncate text-left flex-1 min-w-0 ${labelClassName}`} style={{ maxWidth: "100%" }}>{selected?.label || placeholder}</div>
                <span className="opacity-70 shrink-0">▾</span>
            </button>

            {open && !disabled && (
                <div
                    ref={panelRef}
                    className={`absolute z-50 mt-1 bg-white text-slate-800 border border-gray-200 rounded-lg shadow-lg p-1.5 left-0 ${panelClassName}`}
                    style={{ width: resolvedPanelWidth, minWidth: panelMinWidth, maxWidth: panelMaxWidth, ...panelStyle }}
                >
                    <input
                        autoFocus
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Type to search…"
                        className={`w-full border border-gray-200 rounded-md px-2 py-1 mb-1.5 focus:outline-none focus:ring focus:ring-slate-100 placeholder:text-gray-400 text-xs ${searchInputClassName}`}
                        style={searchInputStyle}
                    />
                    <div className="max-h-56 overflow-auto custom-scrollbar">
                        {filtered.length ? (
                            filtered.map((o) => (
                                <div
                                    key={String(o.value)}
                                    className={`px-2 py-1 rounded-md flex items-center justify-between group cursor-pointer hover:bg-blue-50 ${optionClassName} ${String(o.value) === String(value) ? selectedOptionClassName : ""}
                                        `}
                                    title={o.label}
                                    style={String(o.value) === String(value) ? { ...optionStyle, ...selectedOptionStyle } : optionStyle}
                                >
                                    <div
                                        className={`flex-1 min-w-0 truncate mr-2 text-xs text-slate-800 ${optionTextClassName}`}
                                        style={optionTextStyle}
                                        onClick={() => {
                                            onChange({ target: { value: o.value } });
                                            setOpen(false);
                                        }}
                                    >
                                        {o.label}
                                    </div>
                                    {onDelete && o.value !== "" && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDelete(o.value);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 ml-1 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                            title="Delete"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                        </button>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="text-gray-500 text-xs px-2 py-1">No matches</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
