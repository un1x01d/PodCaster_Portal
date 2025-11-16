import React, { useState, useEffect, useRef } from "react";

/* ---------------- Pretty Export Menu ---------------- */
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
        className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-600 hover:to-emerald-600 text-white px-3 rounded-lg h-10 shadow flex items-center gap-2"
        title="Export options"
      >
        Export
        <span className="opacity-90">▾</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute z-50 mt-1 right-0 w-48 bg-white border border-emerald-200 rounded-xl shadow-xl overflow-hidden"
        >
          <div className="bg-gradient-to-r from-emerald-50 to-white text-xs px-3 py-2 border-b border-emerald-100">
            Download as…
          </div>
          <button
            className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-gray-900"
            onClick={() => { setOpen(false); onCSV?.(); }}
          >
            CSV (.csv)
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-gray-900"
            onClick={() => { setOpen(false); onXLSX?.(); }}
          >
            Excel (.xlsx)
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-gray-900 border-t border-emerald-100"
            onClick={() => { setOpen(false); onPDF?.(); }}
          >
            PDF (.pdf)
          </button>
        </div>
      )}
    </div>
  );
}