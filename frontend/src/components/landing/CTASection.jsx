import React from "react";
import { Link } from "react-router-dom";

export default function CTASection() {
  return (
    <section className="bg-slate-950 px-5 py-16 text-white md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-black tracking-tight md:text-4xl">Give every number a place people can trust.</h2>
          <p className="mt-4 text-base font-semibold leading-8 text-slate-300">
            Upload the file, approve the view, and send stakeholders to one clean page instead of one more attachment.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
          <Link to="/demo" className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-6 text-sm font-black text-slate-950 shadow-[0_14px_32px_rgba(255,255,255,0.14)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-100 hover:shadow-[0_18px_40px_rgba(255,255,255,0.18)] active:translate-y-0">
            Book a demo
          </Link>
          <a href="#workflow" className="inline-flex h-12 items-center justify-center rounded-xl border border-white/30 bg-white/5 px-6 text-sm font-black text-white shadow-[0_14px_32px_rgba(0,0,0,0.16)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/10 active:translate-y-0">
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}
