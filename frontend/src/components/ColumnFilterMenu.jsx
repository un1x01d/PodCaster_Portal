import React, { useState, useEffect, useRef, useLayoutEffect } from "react";

export default function ColumnFilterMenu({
  anchorMapRef,
  columnKey,
  column,
  allValues = [],
  appliedSelected = null,
  onApply,
  onClear,
  onClose,
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

  const placeMenu = () => {
    const a = anchorMapRef?.current?.[columnKey];
    if (!a) return false;
    const r = a.getBoundingClientRect();
    if (!r || (r.left === 0 && r.right === 0 && r.top === 0 && r.bottom === 0)) return false;

    const menuWidth = 256;
    const pad = 8;
    let left = r.left;
    if (left + menuWidth + pad > window.innerWidth) {
      left = Math.max(pad, window.innerWidth - menuWidth - pad);
    }
    const top = r.bottom + 6;
    setCoords({ top, left });
    setMeasured(true);
    return true;
  };

  useLayoutEffect(() => {
    let ok = placeMenu();
    if (!ok) {
      const id = requestAnimationFrame(() => placeMenu());
      return () => cancelAnimationFrame(id);
    }
  }, [anchorMapRef, columnKey]);

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

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] bg-white border border-gray-200 rounded-xl shadow-2xl p-3 w-64"
      style={{ top: coords.top, left: coords.left, visibility: measured ? "visible" : "hidden" }}
      role="dialog"
      aria-label={`Filter ${column}`}
    >
      <div className="mb-2 font-semibold text-sm text-gray-800">Filter: {column}</div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search values…"
        className="w-full border border-gray-200 rounded-md px-2 py-1 mb-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring focus:ring-emerald-100"
      />

      <div className="flex gap-2 mb-2">
        <button
          className="text-[11px] px-2 py-1 rounded-md bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 focus:outline-none focus:ring focus:ring-emerald-100"
          onClick={handleSelectAll}
          title="Select all values"
        >
          Select All
        </button>
        <button
          className="text-[11px] px-2 py-1 rounded-md bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 focus:outline-none focus:ring focus:ring-emerald-100"
          onClick={handleClearAll}
          title="Clear all selections"
        >
          Clear
        </button>
      </div>

      <div className="max-h-56 overflow-auto border border-gray-200 rounded-md">
        {shown.length ? (
          shown.map((v, i) => {
            const sv = String(v);
            const checked = localSet.has(sv);
            return (
              <label
                key={i}
                className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-emerald-50 cursor-pointer text-gray-900"
                title={sv}
              >
                <input
                  type="checkbox"
                  className="cursor-pointer accent-emerald-600"
                  checked={checked}
                  onChange={() => toggleValue(v)}
                />
                <span className="truncate">{sv || "—"}</span>
              </label>
            );
          })
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
            className="px-3 py-1 text-sm rounded-md bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 focus:outline-none focus:ring focus:ring-emerald-100"
            onClick={() => {
              onClear(column);
              onClose?.();
            }}
          >
            Clear Filter
          </button>
          <button
            className="px-3 py-1 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 shadow focus:outline-none focus:ring focus:ring-emerald-100"
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
