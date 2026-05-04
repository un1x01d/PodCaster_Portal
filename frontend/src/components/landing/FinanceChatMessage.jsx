import React from "react";
import Icon from "../common/Icon";
import { themeTextClass } from "../../utils/theme";

export default function FinanceChatMessage({ side, tone, children }) {
  const isUser = side === "user";
  const toneClass = isUser
    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm"
    : "border border-slate-200 bg-white text-slate-700";
  const iconClass = isUser ? "text-white/85" : themeTextClass;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`${isUser ? "max-w-[76%] rounded-tr-sm font-black" : "max-w-[82%] rounded-tl-sm font-semibold"} ${toneClass} flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] leading-3`}>
        {!isUser && <Icon name="speaker" className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${iconClass}`} />}
        <span>{children}</span>
        {isUser && <Icon name="speaker" className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${iconClass}`} />}
      </div>
    </div>
  );
}
