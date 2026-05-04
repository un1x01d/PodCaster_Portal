import React from "react";
import { themeSoftClass } from "../../utils/theme";

export default function Badge({ children, tone = "blue" }) {
  const tones = {
    blue: themeSoftClass,
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${tones[tone] || tones.blue}`}>
      {children}
    </span>
  );
}
