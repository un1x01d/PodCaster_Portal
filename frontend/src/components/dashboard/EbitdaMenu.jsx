import React, { useState, useEffect, useRef } from "react";
import SearchableSelect from "../common/SearchableSelect";

// Define the available formulas and their required inputs
const FORMULAS = {
    standard: {
        id: "standard",
        label: "Standard EBITDA",
        requirements: ["Net Income", "Interest", "Taxes", "Depreciation", "Amortization"],
        calculate: (vals) => vals["Net Income"] + vals["Interest"] + vals["Taxes"] + vals["Depreciation"] + vals["Amortization"]
    },
    operating: {
        id: "operating",
        label: "Operating EBITDA",
        requirements: ["Operating Income", "Depreciation", "Amortization"],
        calculate: (vals) => vals["Operating Income"] + vals["Depreciation"] + vals["Amortization"]
    },
    adjusted: {
        id: "adjusted",
        label: "Adjusted EBITDA",
        requirements: [
            "Net Income", "Interest", "Taxes", "Depreciation", "Amortization",
            "Stock-Based Comp", "Restructuring/One-Time"
        ],
        calculate: (vals) =>
            vals["Net Income"] +
            vals["Interest"] +
            vals["Taxes"] +
            vals["Depreciation"] +
            vals["Amortization"] +
            vals["Stock-Based Comp"] +
            vals["Restructuring/One-Time"]
    }
};

export default function EbitdaMenu({ headers, onCalculate, embedded = false }) {
    const [open, setOpen] = useState(false);
    const [selectedFormulaId, setSelectedFormulaId] = useState("");
    const [columnMap, setColumnMap] = useState({});

    const btnRef = useRef(null);
    const panelRef = useRef(null);

    // Close on click outside or escape
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

    // Reset mapping when formula changes
    useEffect(() => {
        setColumnMap({});
    }, [selectedFormulaId]);

    const activeFormula = selectedFormulaId ? FORMULAS[selectedFormulaId] : null;

    // Prep column dropdown options
    const colOptions = [
        { value: "", label: "Select Column..." },
        ...headers.map(h => ({ value: h, label: h }))
    ];

    const isReadyToCalculate = activeFormula && activeFormula.requirements.every(req => columnMap[req]);

    const handleCalculate = () => {
        if (!isReadyToCalculate) return;

        // Pass the configuration up to App.jsx to process the entire dataset
        onCalculate(activeFormula.label, columnMap, activeFormula.calculate);
        setOpen(false);
    };

    const content = (
        <>
            <div className={`text-xs font-semibold px-4 py-2 border-b uppercase tracking-wider flex justify-between items-center ${embedded
                ? "bg-blue-900/70 border-blue-800 text-white"
                : "bg-slate-50 border-slate-200 text-slate-500"
                }`}>
                <span>EBITDA Calculator</span>
                {activeFormula && (
                    <button
                        onClick={() => setSelectedFormulaId("")}
                        className={embedded ? "text-[10px] text-white/80 hover:text-rose-200 underline" : "text-[10px] text-slate-400 hover:text-red-500 underline"}
                    >
                        Change Formula
                    </button>
                )}
            </div>

            <div className="p-4 flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
                {!activeFormula ? (
                    <div className="flex flex-col gap-2">
                        <label className={embedded ? "text-xs font-bold text-white" : "text-xs font-semibold text-slate-600"}>Choose Formula Type:</label>
                        {Object.values(FORMULAS).map(f => (
                            <button
                                key={f.id}
                                onClick={() => setSelectedFormulaId(f.id)}
                                className={embedded
                                    ? "text-left px-3 py-2 text-sm text-white font-bold border border-blue-800 rounded-lg hover:bg-blue-900 transition-colors"
                                    : "text-left px-3 py-2 text-sm text-slate-700 border border-slate-200 rounded-lg hover:bg-purple-50 hover:border-purple-300 hover:text-purple-700 transition-colors"}
                            >
                                <div className="font-semibold">{f.label}</div>
                                <div className={embedded ? "text-[10px] text-white/80 mt-1 pb-1" : "text-[10px] text-slate-500 mt-1 pb-1"}>
                                    Reqs: {f.requirements.join(", ")}
                                </div>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <p className={embedded ? "text-xs text-white font-bold leading-tight" : "text-xs text-slate-500 leading-tight"}>
                            Map your spreadsheet columns to the standard variables required for <b>{activeFormula.label}</b>.
                        </p>

                        {activeFormula.requirements.map(req => (
                            <div key={req} className="flex flex-col gap-1.5">
                                <label className={embedded ? "text-[11px] font-bold text-white uppercase tracking-wider" : "text-[11px] font-semibold text-slate-600 uppercase tracking-wider"}>
                                    {req} <span className="text-red-400">*</span>
                                </label>
                                <SearchableSelect
                                    options={colOptions}
                                    value={columnMap[req] || ""}
                                    onChange={(e) => setColumnMap(prev => ({ ...prev, [req]: e.target.value }))}
                                    placeholder="Select a column..."
                                    className="w-full text-xs"
                                    buttonClassName={embedded
                                        ? "w-full border border-blue-700 rounded-lg h-9 bg-blue-900 text-white px-2 font-bold text-[10px] tracking-tight"
                                        : "w-full border border-slate-300 rounded-lg h-9 bg-slate-50 text-slate-700 px-3"}
                                    labelClassName={embedded ? "text-[10px]" : ""}
                                    optionClassName={embedded ? "hover:bg-blue-800/80" : ""}
                                    optionTextClassName={embedded ? "text-[10px] font-semibold text-white" : ""}
                                    selectedOptionClassName={embedded ? "bg-blue-800/70" : "bg-slate-100"}
                                    panelClassName={embedded ? "bg-blue-900 text-white border-0 shadow-none" : ""}
                                    searchInputClassName={embedded ? "bg-blue-950 border-0 text-white placeholder:text-blue-200 focus:ring-blue-400/40" : ""}
                                    panelStyle={embedded ? {
                                        backgroundColor: "#0b2a56",
                                        color: "#ffffff",
                                        border: "none",
                                        boxShadow: "none",
                                    } : {}}
                                    optionStyle={embedded ? {
                                        backgroundColor: "transparent",
                                        color: "#ffffff",
                                    } : {}}
                                    selectedOptionStyle={embedded ? {
                                        backgroundColor: "rgba(30, 64, 175, 0.65)",
                                    } : {}}
                                    optionTextStyle={embedded ? {
                                        color: "#ffffff",
                                    } : {}}
                                    searchInputStyle={embedded ? {
                                        backgroundColor: "#082246",
                                        color: "#ffffff",
                                        border: "none",
                                    } : {}}
                                    panelWidth={embedded ? "100%" : 260}
                                />
                            </div>
                        ))}

                        <button
                            className={`mt-2 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${isReadyToCalculate
                                ? "bg-purple-600 hover:bg-purple-700 text-white"
                                : embedded
                                    ? "bg-blue-900/60 text-white/60 cursor-not-allowed border border-blue-700"
                                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                                }`}
                            onClick={handleCalculate}
                            disabled={!isReadyToCalculate}
                        >
                            Calculate & Append
                        </button>
                    </div>
                )}
            </div>
        </>
    );

    if (embedded) {
        return (
            <div className="border border-blue-800 rounded-xl overflow-hidden bg-blue-950/40">
                {content}
            </div>
        );
    }

    return (
        <div className="relative inline-block">
            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 px-4 rounded-lg h-8 shadow-sm flex items-center gap-2 transition-all font-semibold text-xs whitespace-nowrap"
                title="EBITDA Calculator"
            >
                <span>➕ EBITDA</span>
                <span className="opacity-50 text-xs">▼</span>
            </button>

            {open && (
                <div
                    ref={panelRef}
                    className="absolute z-50 mt-2 right-0 w-80 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden ring-1 ring-black/5"
                >
                    {content}
                </div>
            )}
        </div>
    );
}
