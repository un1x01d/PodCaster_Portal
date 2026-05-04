import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  publicPageClass,
  themeHoverTextClass,
  themeTextClass,
  publicMiniPanelClass,
  themeSoftClass,
  publicPanelClass,
  secondaryActionClass,
  primaryActionClass,
  formLabelClass,
  formFieldClass,
  formTextareaClass
} from "../../utils/theme";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function SupportScreen() {
  const [reason, setReason] = useState("");
  const [formData, setFormData] = useState({ name: "", email: "", company: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [serviceStatus, setServiceStatus] = useState(null); // 'online', 'offline', null

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await axios.get(`${API}/healthz`, { timeout: 3000 });
        if (res.status === 200 && res.data?.ok) {
          setServiceStatus("online");
        } else {
          setServiceStatus("offline");
        }
      } catch (err) {
        setServiceStatus("offline");
      }
    };
    checkHealth();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Simulate API call
    console.log("Support request simulated");
    setSubmitted(true);
  };

  const supportTopics = [
    ["password", "Password or access", "Sign-in problems, invitations, workspace permissions, or account access."],
    ["tech", "Workspace support", "File sources, viewer behavior, shared pages, imports, or controlled AI."],
    ["billing", "Billing or account", "Plan fit, invoice questions, workspace limits, or account updates."],
    ["other", "General question", "Anything that does not fit the other support paths."],
  ];
  const selectedTopic = supportTopics.find(([value]) => value === reason);

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

        <main className="py-10 lg:py-14">
          <section className="border-b border-slate-300 pb-10">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <div>
                <p className={`text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>Contact</p>
                <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
                  Tell us what needs attention.
                </h1>
              </div>
              <div>
                <p className="max-w-2xl text-base font-semibold leading-8 text-slate-600">
                  Send account, billing, access, or workspace questions with the file names, source names, and user details that help explain the issue.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  <span>Status</span>
                  <span className={serviceStatus === "online" ? "text-emerald-600" : serviceStatus === "offline" ? "text-red-600" : "text-slate-600"}>
                    {serviceStatus === "online" ? "Operational" : serviceStatus === "offline" ? "Connection failed" : "Checking"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-10 py-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-slate-950">Choose a path</h2>
                <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              </div>
              <div className="mt-5 border-y border-slate-300">
                {supportTopics.map(([value, label, body]) => {
                  const active = reason === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setReason(value)}
                      className={`group flex w-full items-start gap-4 border-b border-slate-200 py-4 text-left last:border-b-0 ${active ? "text-[hsl(var(--primary))]" : "text-slate-800"}`}
                    >
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border ${active ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]" : "border-slate-300 group-hover:border-[hsl(var(--primary)/0.45)]"}`} />
                      <span>
                        <span className="block text-sm font-black">{label}</span>
                        <span className="mt-1 block text-sm font-semibold leading-6 text-slate-600">{body}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-y border-slate-300 py-5">
              {submitted ? (
                <div className="py-10 text-center">
                  <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-base font-black text-white">✓</div>
                  <h2 className="text-2xl font-black text-slate-950">Request received</h2>
                  <p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-7 text-slate-600">
                    Your message has been recorded. The team will review it and respond as soon as possible.
                  </p>
                  <button onClick={() => setSubmitted(false)} className={`${secondaryActionClass} mt-6 h-11 px-5`}>
                    Submit another request
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-black tracking-tight text-slate-950">Send the details</h2>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {selectedTopic ? selectedTopic[1] : "Select a topic to route the request."}
                      </p>
                    </div>
                    <div className="hidden h-px flex-1 bg-slate-200 sm:block" aria-hidden="true" />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="group block">
                      <span className={formLabelClass}>Full name</span>
                      <input
                        type="text"
                        className={formFieldClass}
                        placeholder="Jane Doe"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </label>
                    <label className="group block">
                      <span className={formLabelClass}>Work email</span>
                      <input
                        type="email"
                        className={formFieldClass}
                        placeholder="jane@company.com"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        required
                      />
                    </label>
                  </div>

                  <label className="group block">
                    <span className={formLabelClass}>Company</span>
                    <input
                      type="text"
                      className={formFieldClass}
                      placeholder="Acme Corp"
                      value={formData.company}
                      onChange={e => setFormData({ ...formData, company: e.target.value })}
                      required
                    />
                  </label>

                  <label className="group block">
                    <div className="flex justify-between px-1">
                      <span className={formLabelClass}>Request details</span>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${formData.message.length > 1900 ? "text-amber-600" : "text-slate-400"}`}>
                        {formData.message.length} / 2000
                      </span>
                    </div>
                    <textarea
                      rows="6"
                      maxLength="2000"
                      className={formTextareaClass}
                      placeholder={reason === "password" ? "Include your workspace, email address, and what changed..." : "Describe the request, affected users, files, or source names..."}
                      value={formData.message}
                      onChange={e => setFormData({ ...formData, message: e.target.value })}
                      required
                    />
                  </label>

                  {!reason && (
                    <p className="border-t border-slate-200 pt-3 text-sm font-semibold leading-6 text-slate-500">
                      Choose a path before sending so the request is routed correctly.
                    </p>
                  )}

                  <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <Link to="/login" className={`text-xs font-black uppercase tracking-[0.16em] text-slate-500 transition-colors ${themeHoverTextClass}`}>
                      Back to sign in
                    </Link>
                    <button
                      type="submit"
                      disabled={!reason}
                      className={`${primaryActionClass} h-12 px-6 ${!reason ? "cursor-not-allowed opacity-55" : ""}`}
                    >
                      Send request
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
