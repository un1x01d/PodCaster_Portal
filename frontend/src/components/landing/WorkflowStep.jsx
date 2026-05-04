import React from "react";
import Icon from "../common/Icon";
import { themeTextClass } from "../../utils/theme";

export default function WorkflowStep({ icon, title, body }) {
  return (
    <div className="border-t border-slate-300 py-5">
      <div className={`flex items-center gap-3 ${themeTextClass}`}>
        <Icon name={icon} className="h-5 w-5 shrink-0" />
        <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-sm font-black text-slate-950">{title}</h3>
      <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{body}</p>
    </div>
  );
}
