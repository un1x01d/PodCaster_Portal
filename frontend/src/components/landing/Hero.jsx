import React from "react";
import { Link } from "react-router-dom";
import Badge from "../common/Badge";
import ProductMockup from "./ProductMockup";
import { themeGlowClass, primaryActionClass, secondaryActionClass } from "../../utils/theme";

export default function Hero() {
  return (
    <section id="product" className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-slate-50 via-white to-slate-50 px-5 py-14 md:px-8 lg:py-20">
      <div className={`absolute left-1/2 top-0 h-72 w-[48rem] -translate-x-1/2 rounded-full ${themeGlowClass} blur-3xl`} />
      <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <div>
          <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            The last spreadsheet your clients have to chase.
          </h1>
          <p className="mt-6 max-w-2xl text-lg font-semibold leading-8 text-slate-600">
            TFORN turns recurring customer uploads into polished, permissioned pages where every stakeholder sees the right numbers, the latest version, and the story behind the changes.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/demo"
              className={`${primaryActionClass} h-12`}
            >
              Book a demo
            </Link>
            <a
              href="#workflow"
              className={`${secondaryActionClass} h-12`}
            >
              See the workflow
            </a>
          </div>
          <p className="mt-6 max-w-xl text-sm font-black leading-6 text-slate-500">
            Fewer attachments. Fewer version debates. More confidence in every number you share.
          </p>
        </div>
        <ProductMockup />
      </div>
    </section>
  );
}
