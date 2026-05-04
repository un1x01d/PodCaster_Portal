import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  DemoInput,
  DemoSelect,
  DemoTextarea,
  DemoCheckboxGroup,
  DemoFormSection
} from "../landing/DemoFormComponents";
import {
  publicPageClass,
  themeHoverTextClass,
  themeTextClass,
  publicMiniPanelClass,
  themeSoftClass,
  publicPanelClass,
  secondaryActionClass,
  primaryActionClass
} from "../../utils/theme";

export default function DemoBookingScreen() {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    role: "",
    companySize: "1-10",
    fileVolume: "Under 25",
    currentProcess: "",
    biDestination: "",
    timeline: "Just researching",
    notes: "",
    fileSources: [],
    needs: [],
  });

  const fileSources = ["Customer upload", "Current shared view", "Past versions", "Column notes", "Read-only tools"];
  const needs = [
    "Track versions",
    "Review files before sharing",
    "Catch column changes",
    "Choose who can view",
    "Send cleaner data to BI",
    "Answer finance questions safely",
  ];
  const fitPoints = [
    ["Recurring files", "Financial spreadsheets the customer uploads and shares repeatedly."],
    ["Review before sharing", "A clear step before remote users see the new file."],
    ["Clear file history", "A record of what changed and which version is current."],
  ];

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleListValue = (field, value) => {
    setFormData((prev) => {
      const current = prev[field] || [];
      return {
        ...prev,
        [field]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
      };
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    console.log("Demo request simulated", formData);
    setSubmitted(true);
  };

  return (
    <div className={publicPageClass}>
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
            <img
              src="/assets/tform-logo.png"
              alt="TFORN - Turn Financial Outputs into Real Numbers"
              className="h-14 w-auto max-w-[260px] object-contain sm:h-16 sm:max-w-[340px]"
            />
          </Link>
          <Link to="/login" className={`hidden rounded-lg px-3 py-2 text-sm font-bold text-slate-700 ${themeHoverTextClass} sm:inline-flex`}>
            Sign in
          </Link>
        </header>

        <main className="grid gap-8 py-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-start lg:py-14">
          <section className="lg:sticky lg:top-8">
            <p className={`text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>Book a demo</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
              See how TFORN shares recurring business files with control.
            </h1>
            <p className="mt-5 max-w-xl text-base font-semibold leading-8 text-slate-600">
              Tell us what the customer uploads, who needs read-only access, and where the numbers are used next. We will tailor the demo to that flow.
            </p>

            <div className="mt-8 grid gap-3">
              {fitPoints.map(([title, body], index) => (
                <div key={title} className={publicMiniPanelClass}>
                  <div className="flex gap-3">
                  <div className={`shrink-0 pt-0.5 text-xs font-black uppercase tracking-[0.18em] ${themeTextClass}`}>0{index + 1}</div>
                  <div>
                    <h2 className="text-sm font-black text-slate-950">{title}</h2>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{body}</p>
                  </div>
                  </div>
                </div>
              ))}
            </div>

            <div className={`mt-6 rounded-xl border p-5 shadow-[0_14px_30px_hsl(var(--primary)/0.08)] ${themeSoftClass}`}>
              <p className={`text-sm font-black ${themeTextClass}`}>Best fit for teams asking:</p>
              <p className={`mt-2 text-sm font-semibold leading-6 ${themeTextClass} opacity-80`}>
                Which file is current? What changed? Who reviewed it? Can this data be used in reports or answers?
              </p>
            </div>
          </section>

          <section className={publicPanelClass}>
            {submitted ? (
              <div className="flex min-h-[520px] flex-col justify-center rounded-xl border border-[hsl(var(--primary)/0.18)] bg-[hsl(var(--primary)/0.06)] p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-xl font-black text-white">✓</div>
                <h2 className="mt-5 text-2xl font-black text-slate-950">Demo request received</h2>
                <p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-7 text-slate-700">
                  We have the details needed to shape the conversation around your file workflow, review needs, and reporting goals.
                </p>
                <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setSubmitted(false)}
                    className={`${secondaryActionClass} h-11 px-5`}
                  >
                    Edit request
                  </button>
                  <Link to="/" className={`${primaryActionClass} h-11 px-5`}>
                    Back to homepage
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-950">Tell us about your workflow</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                    These questions help us show the parts that match your sharing process.
                  </p>
                </div>

                <DemoFormSection title="Your details" description="Enough context for the right person to follow up.">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DemoInput label="Full name" value={formData.name} onChange={(value) => updateField("name", value)} placeholder="Jane Doe" required />
                    <DemoInput label="Work email" type="email" value={formData.email} onChange={(value) => updateField("email", value)} placeholder="jane@company.com" required />
                    <DemoInput label="Company" value={formData.company} onChange={(value) => updateField("company", value)} placeholder="Company name" required />
                    <DemoInput label="Role" value={formData.role} onChange={(value) => updateField("role", value)} placeholder="Finance Ops" />
                  </div>
                </DemoFormSection>

                <DemoFormSection title="Scale and timing" description="This helps us size the demo around your real file flow.">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <DemoSelect
                      label="Team size"
                      value={formData.companySize}
                      onChange={(value) => updateField("companySize", value)}
                      options={["1-10", "11-50", "51-200", "201-1000", "1000+"]}
                    />
                    <DemoSelect
                      label="Files per month"
                      value={formData.fileVolume}
                      onChange={(value) => updateField("fileVolume", value)}
                      options={["Under 25", "25-100", "100-500", "500+", "Not sure"]}
                    />
                    <DemoSelect
                      label="Timeline"
                      value={formData.timeline}
                      onChange={(value) => updateField("timeline", value)}
                      options={["Just researching", "This quarter", "This month", "Urgent issue now"]}
                    />
                  </div>
                </DemoFormSection>

                <DemoFormSection title="Shared file flow" description="Choose what the remote users need to see.">
                  <DemoCheckboxGroup
                    label="What should be part of the shared page?"
                    options={fileSources}
                    selected={formData.fileSources}
                    onToggle={(value) => toggleListValue("fileSources", value)}
                  />
                </DemoFormSection>

                <DemoFormSection title="What needs control" description="Pick the problems the demo should focus on.">
                  <DemoCheckboxGroup
                    label="What do you need to control?"
                    options={needs}
                    selected={formData.needs}
                    onToggle={(value) => toggleListValue("needs", value)}
                  />
                </DemoFormSection>

                <DemoFormSection title="Workflow notes" description="Short answers are fine. Specific examples help.">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DemoTextarea
                      label="How does this work today?"
                      value={formData.currentProcess}
                      onChange={(value) => updateField("currentProcess", value)}
                      placeholder="We upload monthly finance files and share a read-only view."
                    />
                    <DemoTextarea
                      label="Where should trusted data go next?"
                      value={formData.biDestination}
                      onChange={(value) => updateField("biDestination", value)}
                      placeholder="BI, reports, or exports."
                    />
                  </div>
                  <div className="mt-3">
                    <DemoTextarea
                      label="Anything specific you want to see?"
                      value={formData.notes}
                      onChange={(value) => updateField("notes", value)}
                      placeholder="Files, viewers, or finance questions."
                      rows={3}
                    />
                  </div>
                </DemoFormSection>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Demo focus</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                    We will focus on the customer upload, current shared view, past versions, column changes, viewer access, and safe finance answers.
                  </p>
                </div>

                <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-end">
                  <Link to="/support" className={`${secondaryActionClass} h-10 px-4 text-xs`}>
                    Need support instead?
                  </Link>
                  <button
                    type="submit"
                    className={`${primaryActionClass} h-10 px-5 text-xs`}
                  >
                    Request demo
                  </button>
                </div>
              </form>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
