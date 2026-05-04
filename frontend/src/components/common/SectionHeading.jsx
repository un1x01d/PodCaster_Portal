import React from "react";
import { themeTextClass } from "../../utils/theme";

export default function SectionHeading({ eyebrow, title, body, centered = false }) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow && <div className={`text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>{eyebrow}</div>}
      <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-base font-semibold leading-8 text-slate-600">{body}</p>}
    </div>
  );
}
