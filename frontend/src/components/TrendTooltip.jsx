import React from 'react';

/* ---------- Trend Tooltip ---------- */
export default function TrendTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-sky-200 rounded-md px-3 py-2 text-sm shadow">
      <div className="font-semibold mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: p.color,
              borderRadius: 2,
            }}
          />
          <span>{p.name}: <b>{Number(p.value ?? 0).toLocaleString()}</b></span>
        </div>
      ))}
    </div>
  );
}