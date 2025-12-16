
import React, { useState, useEffect, useRef } from 'react';

export default function MultiSelect({
    options = [],
    value = [], // Array of selected values
    onChange = () => { },
    placeholder = "Select...",
    className = "",
    disabled = false
}) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);

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
        : value.length <= 2
            ? value.join(", ")
            : `${value.length} selected`;

    return (
        <div className={`relative inline-block ${className}`} ref={containerRef}>
            <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setOpen(!open)}
                className={`flex items-center justify-between w-full border border-slate-300 bg-white px-3 py-2 rounded-lg text-sm transition-colors
          ${disabled ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "hover:border-blue-400 focus:ring-2 focus:ring-blue-100"}
        `}
            >
                <span className="truncate mr-2 font-medium text-slate-700">{displayLabel}</span>
                <span className="text-slate-400 text-xs">▼</span>
            </button>

            {open && (
                <div className="absolute z-50 mt-1 w-full min-w-[160px] bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto p-1">
                    {options.length === 0 ? (
                        <div className="p-2 text-sm text-slate-400 italic text-center">No options</div>
                    ) : (
                        options.map((opt) => {
                            const label = typeof opt === 'object' ? opt.label : opt;
                            const val = typeof opt === 'object' ? opt.value : opt;
                            const isSelected = value.includes(val);

                            return (
                                <div
                                    key={val}
                                    onClick={() => toggleOption(val)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm
                    ${isSelected ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-600 hover:bg-slate-50"}
                  `}
                                >
                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors
                    ${isSelected ? "bg-blue-600 border-blue-600" : "border-slate-300 bg-white"}
                  `}>
                                        {isSelected && (
                                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        )}
                                    </div>
                                    <span>{label}</span>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
