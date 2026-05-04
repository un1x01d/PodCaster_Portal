import React from "react";
import Icon from "../common/Icon";
import { themeTextClass, themeHoverBorderClass } from "../../utils/theme";

export default function FeatureCard({ icon, title, body }) {
  return (
    <article className={`border-t border-slate-300 py-5 transition-colors duration-200 ${themeHoverBorderClass}`}>
      <div className={`flex items-center gap-3 ${themeTextClass}`}>
        <Icon name={icon} className="h-6 w-6 shrink-0" />
        <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
      </div>
      <h3 className="mt-5 text-lg font-black text-slate-950">{title}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{body}</p>
    </article>
  );
}
