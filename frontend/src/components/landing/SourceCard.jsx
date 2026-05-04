import React from "react";
import SourceProviderIcon from "../common/SourceProviderIcon";
import { themeHoverBorderClass } from "../../utils/theme";

function LandingSourceIcon({ icon }) {
  const wideIcon = icon === "quickbooks";
  return <SourceProviderIcon provider={icon || "upload"} className={`${wideIcon ? "h-5 w-16" : "h-5 w-5"} shrink-0`} />;
}

export default function SourceCard({ title, body, icon = "storage" }) {
  return (
    <div className={`border-t border-slate-300 py-4 transition-colors duration-200 ${themeHoverBorderClass}`}>
      <div className="flex items-center gap-3">
        <LandingSourceIcon icon={icon} title={title} />
        <h3 className="min-w-0 text-sm font-black text-slate-950">{title}</h3>
      </div>
      <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">{body}</p>
    </div>
  );
}
