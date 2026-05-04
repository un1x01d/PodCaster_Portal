import React from "react";
import { Link } from "react-router-dom";
import Icon from "../common/Icon";
import { themeTextClass, themeHoverBorderClass, secondaryActionClass } from "../../utils/theme";

export const PRICING_BUNDLES = [
  {
    key: "core",
    label: "Core",
    tagline: "Start sharing",
    audience: "For a small customer workspace sharing a few recurring spreadsheets.",
    users: "Up to 10 remote users",
    sources: "Up to 3 shared sheets",
    tools: "Basic read-only tools",
    accent: "blue",
    features: [
      "A simple place for shared files",
      "Read-only recipients",
      "Current version label",
      "Basic filters and exports",
    ],
  },
  {
    key: "growth",
    label: "Growth",
    tagline: "Regular sharing",
    audience: "For customers sending recurring monthly files to more outside recipients.",
    users: "Up to 50 remote users",
    sources: "Up to 15 shared sheets",
    tools: "More viewer tools",
    accent: "green",
    featured: true,
    features: [
      "Everything in Core",
      "More recurring sheets",
      "Recipient groups",
      "Version comparison",
      "Saved views for repeat use",
    ],
  },
  {
    key: "enterprise",
    label: "Enterprise",
    tagline: "Larger rollout",
    audience: "For larger customers with many shared sheets, recipient groups, and setup needs.",
    users: "Up to 250 remote users",
    sources: "Up to 100 shared sheets",
    tools: "Expanded viewer tools",
    accent: "slate",
    features: [
      "Everything in Growth",
      "Higher file and viewer limits",
      "More workspace structure",
      "Longer version history",
      "Finance workflow setup",
      "Custom rollout planning",
    ],
  },
];

export default function PricingPlanCard({ plan }) {
  return (
    <article className={`relative flex h-full flex-col border-t border-slate-300 py-6 transition-colors duration-200 ${themeHoverBorderClass}`}>
      <div className={`flex items-center gap-3 ${themeTextClass}`}>
        <Icon name={plan.key === "enterprise" ? "shield" : plan.key === "growth" ? "approval" : "source"} className="h-6 w-6 shrink-0" />
        <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
        {plan.featured && (
          <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.16em] text-[hsl(var(--primary))]">
            Most common
          </span>
        )}
      </div>
      <div className="mt-5">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{plan.tagline}</div>
        <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-950">{plan.label}</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{plan.audience}</p>
      </div>
      <div className="mt-5 border-y border-slate-200 py-4">
        <div className="grid gap-3 text-sm">
          {[plan.users, plan.sources, plan.tools].map((item) => (
            <div key={item} className="flex items-start gap-2 font-black text-slate-900">
              <Icon name="check" className={`mt-0.5 h-4 w-4 shrink-0 ${themeTextClass}`} />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs font-bold leading-5 text-slate-500">Final pricing depends on workspace needs.</p>
      </div>
      <ul className="mt-5 flex-1 space-y-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2 text-sm font-semibold leading-6 text-slate-700">
            <Icon name="check" className={`mt-1 h-4 w-4 shrink-0 ${themeTextClass}`} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link to="/demo" className={`${secondaryActionClass} mt-6 h-11 px-4`}>
        Discuss {plan.label}
      </Link>
    </article>
  );
}
