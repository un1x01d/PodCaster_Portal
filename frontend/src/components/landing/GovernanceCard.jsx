import React from "react";
import Icon from "../common/Icon";
import { themeTextClass, themeHoverBorderClass } from "../../utils/theme";

export default function GovernanceCard({ title, body, icon }) {
  return (
    <div className={`border-t border-slate-300 py-4 transition-colors duration-200 ${themeHoverBorderClass}`}>
      <div className="flex items-start gap-3">
        <Icon name={icon} className={`mt-0.5 h-5 w-5 shrink-0 ${themeTextClass}`} />
        <div>
          <h3 className="text-sm font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{body}</p>
        </div>
        </div>
    </div>
  );
}
