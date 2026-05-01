
import React, { useState, useEffect, useRef } from 'react';

export default function MultiSelect({
    options = [],
    value = [], // Array of selected values
    onChange = () => { },
    placeholder = "Select...",
    className = "",
    disabled = false,
    activeColor = "blue", // "blue" or "emerald"
    dense = false,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const containerRef = useRef(null);
    
    const colorClasses = activeColor === "emerald" 
        ? "bg-emerald-600 border-emerald-600" 
        : "bg-blue-600 border-blue-600";
    
    const activeBg = activeColor === "emerald" ? "bg-emerald-50" : "bg-blue-50";

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const toggleOption = (val) => {
        const newVal = value.includes(val)
            ? value.filter(v => v !== val)
            : [...value, val];
        onChange(newVal);
    };

    const displayLabel = value.length === 0
        ? placeholder
        : value.length === options.length && options.length > 0
            ? "All"
        : value.length <= 2
            ? value.join(", ")
            : `${value.length} selected`;

    const norm = (v) => String(v || "").toLowerCase();
    const renderLabel = (v) => {
        const s = String(v || "");
        return s.length > 30 ? `${s.slice(0, 30)}...` : s;
    };
    const filteredOptions = (options || []).filter((opt) => {
        const label = typeof opt === "object" ? opt.label : opt;
        if (!query.trim()) return true;
        return norm(label).includes(norm(query.trim()));
    });

    return (
        <div className={`relative inline-block ${className}`} ref={containerRef}>
            <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setOpen(!open)}
                className={`flex items-center justify-between w-full border border-slate-300 bg-white transition-colors shadow-sm ${dense ? "h-7 px-2 rounded-md text-[10px]" : "h-8 px-2.5 rounded-md text-xs"}
          ${disabled ? "bg-slate-50 text-slate-400 cursor-not-allowed" : "hover:border-slate-400 hover:bg-slate-50 focus:ring-2 focus:ring-slate-200"}
        `}
            >
                <span className={`truncate mr-2 font-bold text-slate-700 ${dense ? "text-[10px]" : "text-xs"}`}>{displayLabel}</span>
                <span className={`text-slate-400 ${dense ? "text-[9px]" : "text-xs"}`}>▼</span>
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full min-w-[140px] bg-white border border-slate-200 rounded-md shadow-xl max-h-56 overflow-y-auto p-1 ring-1 ring-black/5">
                    <div className="sticky top-0 z-10 bg-white px-1 pb-1">
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search columns..."
                            className={`w-full border border-slate-200 rounded px-2 focus:outline-none focus:ring-1 focus:ring-slate-300 ${dense ? "py-0.5 text-[10px] font-semibold text-slate-700" : "py-1 text-[11px] font-semibold text-slate-700"}`}
                        />
                    </div>
                    {filteredOptions.length === 0 ? (
                        <div className="p-2 text-xs text-slate-400 italic text-center">No options</div>
                    ) : (
                        filteredOptions.map((opt) => {
                            const label = typeof opt === 'object' ? opt.label : opt;
                            const val = typeof opt === 'object' ? opt.value : opt;
                            const isSelected = value.includes(val);

                            return (
                                <div
                                    key={val}
                                    onClick={() => toggleOption(val)}
                                    className={`flex items-center gap-2 px-2 rounded-md cursor-pointer ${dense ? "py-0.5 text-[10px]" : "py-1 text-xs"}
                    ${isSelected ? `${activeBg} text-slate-900 font-bold` : "text-slate-700 hover:bg-slate-50"}
                  `}
                                >
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors
                    ${isSelected ? colorClasses : "border-slate-300 bg-white"}
                  `}>
                                        {isSelected && (
                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        )}
                                    </div>
                                    <span title={String(label || "")}>{renderLabel(label)}</span>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
