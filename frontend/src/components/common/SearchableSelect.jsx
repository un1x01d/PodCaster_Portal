import React, { useState, useEffect, useRef } from "react";

export default function SearchableSelect({
    options = [],
    value = "",
    onChange = () => { },
    placeholder = "Select…",
    className = "",
    disabled = false,
    buttonClassName = "border p-2 rounded min-w-[10rem] bg-white",
    panelWidth = 260,
}) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const btnRef = useRef(null);
    const panelRef = useRef(null);

    const selected = options.find((o) => String(o.value) === String(value));
    const filtered = q
        ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
        : options;

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
        <div className={`relative inline-block ${className}`}>
            <button
                ref={btnRef}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setOpen((o) => !o)}
                className={`${buttonClassName} flex items-center justify-between gap-2 ${disabled ? "bg-gray-100 cursor-not-allowed text-gray-400" : ""
                    }`}
                title={selected?.label || placeholder}
            >
                <span className="truncate">{selected?.label || placeholder}</span>
                <span className="opacity-70">▾</span>
            </button>

            {open && !disabled && (
                <div
                    ref={panelRef}
                    className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl p-2"
                    style={{ width: panelWidth }}
                >
                    <input
                        autoFocus
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Type to search…"
                        className="w-full border border-gray-200 rounded-md px-2 py-1 mb-2 focus:outline-none focus:ring focus:ring-slate-100"
                    />
                    <div className="max-h-56 overflow-auto">
                        {filtered.length ? (
                            filtered.map((o) => (
                                <div
                                    key={String(o.value)}
                                    className={`px-2 py-1 rounded-md cursor-pointer hover:bg-blue-50 ${String(o.value) === String(value) ? "bg-slate-100" : ""
                                        }`}
                                    title={o.label}
                                    onClick={() => {
                                        onChange({ target: { value: o.value } });
                                        setOpen(false);
                                    }}
                                >
                                    {o.label}
                                </div>
                            ))
                        ) : (
                            <div className="text-gray-500 text-sm px-2 py-1">No matches</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
