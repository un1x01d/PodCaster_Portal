import React from "react";
import SectionHeading from "../common/SectionHeading";
import { themeTextClass } from "../../utils/theme";

export default function ComparisonTable() {
  const rows = [
    ["Best for", "Passing along a file", "Publishing a static report", "Editing in a sheet", "Delivering a trusted client view"],
    ["Customer upload", "One-off handoff", "Already finalized", "Mixed with edits", "Becomes the reviewed source"],
    ["Outside stakeholders", "Get another copy", "See a snapshot", "May edit", "See only what is approved"],
    ["Current version", "Easy to lose", "Not the focus", "Can be unclear", "Front and center"],
    ["When columns change", "Found later", "Usually hidden", "Handled manually", "Flagged before sharing"],
    ["Questions", "Answered in side threads", "Limited by the published view", "Depends on formulas", "Answered from approved data"],
    ["Main value", "Fast transfer", "Static presentation", "Sheet collaboration", "Confident delivery"],
  ];

  const stateClass = (value, column) => {
    if (column === "managed") return "bg-emerald-50 text-emerald-700";
    if (value === "Manual" || value === "Upload only" || value === "Basic" || value === "Generic") return "bg-slate-100 text-slate-500";
    return "bg-amber-50 text-amber-700";
  };

  return (
    <section className="bg-white px-5 py-16 md:px-8" id="comparison">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          title="Shared spreadsheets need a controlled front door."
          body="TFORN is for recurring files that customers, clients, partners, lenders, boards, or teams need to trust after review. It keeps the latest version, source history, viewer access, and approved answers in one controlled experience."
        />
        <div className="mt-8 border-y border-slate-300">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse bg-white text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">What you need</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Random file upload</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Static report</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Spreadsheet work tool</th>
                  <th className={`px-4 py-4 text-xs font-black uppercase tracking-[0.16em] ${themeTextClass}`}>TFORN</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([capability, random, bi, workTool, managed]) => (
                  <tr key={capability} className="border-b border-slate-100 last:border-b-0">
                    <th className="px-4 py-4 text-sm font-black text-slate-900">{capability}</th>
                    <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${stateClass(random, "random")}`}>{random}</span></td>
                    <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${stateClass(bi, "bi")}`}>{bi}</span></td>
                    <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${stateClass(workTool, "workTool")}`}>{workTool}</span></td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${stateClass(managed, "managed")}`}>{managed}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-xs font-semibold leading-5 text-slate-500">
          TFORN is not middleware for reporting tools. It is the controlled destination for reviewed recurring spreadsheets that still need to be shared, revisited, governed, and explained.
        </p>
      </div>
    </section>
  );
}
