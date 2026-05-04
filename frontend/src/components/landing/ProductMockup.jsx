import React from "react";
import { themeGlowClass } from "../../utils/theme";

export default function ProductMockup() {
  return (
    <figure className="relative mx-auto w-full max-w-[820px]">
      <div className={`absolute -inset-5 rounded-[2rem] ${themeGlowClass} blur-3xl`} aria-hidden="true" />
      <img
        src="/assets/landing-hero-product.png"
        alt="TFORN file control portal showing a file queue, reviewed versions, column checks, field labels, AI rules, access controls, and history"
        className="relative w-full rounded-[1.35rem] border border-slate-200 bg-white object-cover shadow-2xl shadow-slate-300/80"
      />
      <figcaption className="sr-only">
        A realistic TFORN product view focused on controlled recurring spreadsheet files instead of dashboards.
      </figcaption>
    </figure>
  );
}
