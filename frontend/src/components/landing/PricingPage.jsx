import React from "react";
import Header from "../common/Header";
import SectionHeading from "../common/SectionHeading";
import CTASection from "./CTASection";
import PricingPlanCard, { PRICING_BUNDLES } from "./PricingPlanCard";
import FeatureCard from "./FeatureCard";
import Icon from "../common/Icon";
import Badge from "../common/Badge";
import { themeGlowClass, primaryActionClass, secondaryActionClass, themeBorderClass, themeTextClass } from "../../utils/theme";
import { Link } from "react-router-dom";

export default function PricingPage({ user = null }) {
  const comparisonRows = [
    ["Read-only recipients", "10", "50", "250"],
    ["Recurring shared sheets", "3", "15", "100"],
    ["Recipient groups", "Simple", "Multiple", "Advanced"],
    ["Version comparison", "Basic", "Expanded", "Expanded"],
    ["Viewer actions", "Basic", "More", "Expanded"],
    ["Setup support", "Standard", "Standard", "Custom"],
  ];

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header user={user} />
      <main>
        <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-white via-slate-50 to-white px-5 py-14 md:px-8 lg:py-18">
          <div className={`absolute left-1/2 top-0 h-72 w-[48rem] -translate-x-1/2 rounded-full ${themeGlowClass} blur-3xl`} aria-hidden="true" />
          <div className="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
            <div>
              <Badge tone="blue">Pricing</Badge>
              <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Pricing based on sharing size.
              </h1>
              <p className="mt-5 max-w-2xl text-lg font-semibold leading-8 text-slate-600">
                Choose a bundle by how many remote users need read-only access and how many recurring spreadsheets the customer shares.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/demo" className={`${primaryActionClass} h-12`}>
                  Book pricing demo
                </Link>
                <Link to="/support" className={`${secondaryActionClass} h-12`}>
                  Ask billing question
                </Link>
              </div>
            </div>
            <figure className="relative">
              <div className={`absolute -inset-5 rounded-[2rem] ${themeGlowClass} blur-3xl`} aria-hidden="true" />
              <img
                src="/assets/landing-hero-product.png"
                alt="TFORN controlled file sharing workspace with version history, review state, access controls, and AI rules"
                className="relative w-full rounded-[1.35rem] border border-slate-200 bg-white object-cover shadow-2xl shadow-slate-300/80"
              />
            </figure>
          </div>
        </section>

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              eyebrow="Bundles"
              title="Start with the people and files."
              body="Core covers a small rollout. Growth adds room for regular monthly sharing. Enterprise supports larger customer workspaces."
            />
            <div className="mt-8 grid gap-x-10 gap-y-4 lg:grid-cols-3">
              {PRICING_BUNDLES.map((plan) => (
                <PricingPlanCard key={plan.key} plan={plan} />
              ))}
            </div>
          </div>
        </section>

        <section className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div>
              <SectionHeading
                eyebrow="What changes by tier"
                title="What grows by plan."
                body="The main differences are recipient count, recurring sheets, saved views, version depth, and setup support."
              />
              <div className={`mt-6 border-l-4 py-3 pl-4 text-sm font-black leading-6 ${themeBorderClass} ${themeTextClass}`}>
                <div className="flex items-start gap-3">
                  <Icon name="shield" className={`mt-0.5 h-5 w-5 shrink-0 ${themeTextClass}`} />
                  <p>
                    Higher limits are available. Bundle limits mirror the default recipient and shared sheet counts; larger customer workspaces can be quoted with custom limits.
                  </p>
                </div>
              </div>
            </div>
            <div className="border-y border-slate-300">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Included</th>
                      <th className={`px-4 py-4 text-xs font-black uppercase tracking-[0.16em] ${themeTextClass}`}>Core</th>
                      <th className={`px-4 py-4 text-xs font-black uppercase tracking-[0.16em] ${themeTextClass}`}>Growth</th>
                      <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-700">Enterprise</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map(([label, core, growth, enterprise]) => (
                      <tr key={label} className="border-b border-slate-200 last:border-b-0">
                        <th className="px-4 py-4 text-sm font-black text-slate-900">{label}</th>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-600">{core}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-600">{growth}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-600">{enterprise}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              eyebrow="Pricing inputs"
              title="What affects the quote."
              body="The quote follows the real workload: who needs access, what gets shared, which read-only actions are enabled, and how much setup is needed."
            />
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                ["Recipients", "Outside users who only view the shared data.", "users"],
                ["Shared sheets", "The recurring files the customer uploads each period.", "source"],
                ["Allowed actions", "Filters, exports, and approved answers where enabled.", "lock"],
                ["Setup help", "Support for organizing the first rollout.", "approval"],
              ].map(([title, body, icon]) => {
                return <FeatureCard key={title} title={title} body={body} icon={icon} />;
              })}
            </div>
          </div>
        </section>

        <CTASection />
      </main>
    </div>
  );
}
