import React from "react";
import { Link } from "react-router-dom";
import {
  publicPageClass,
  themeTextClass,
  publicPanelClass,
  formLabelClass,
  formFieldClass,
  primaryActionClass,
  secondaryActionClass
} from "../../utils/theme";

export default function InviteAcceptScreen({
  inviteInfo,
  invitePassword,
  setInvitePassword,
  inviteRepeat,
  setInviteRepeat,
  onAccept,
  loading,
  error,
  onBackToLogin,
}) {
  return (
    <div className={`${publicPageClass} flex items-center justify-center`}>
      <div className="w-full max-w-5xl">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <section>
            <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
              <img
                src="/assets/tform-logo.png"
                alt="TFORN - Turn Financial Outputs into Real Numbers"
                className="h-16 w-auto max-w-[320px] object-contain"
              />
            </Link>
            <p className={`mt-10 text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>Workspace invitation</p>
            <h1 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-tight text-slate-950">
              Finish setting up your secure access.
            </h1>
            <p className="mt-4 max-w-xl text-base font-semibold leading-8 text-slate-600">
              Create your password to join {inviteInfo?.groupName || "the customer workspace"} and access the files shared with your account.
            </p>
          </section>

          <section className={publicPanelClass}>
            <div className="mb-6">
              <h2 className="text-2xl font-black tracking-tight text-slate-950">Accept invitation</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                Review the invited details and set your password.
              </p>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className={formLabelClass}>Email</span>
                <input className={`${formFieldClass} opacity-75`} value={inviteInfo?.email || ""} disabled />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={formLabelClass}>First name</span>
                  <input className={`${formFieldClass} opacity-75`} value={inviteInfo?.firstName || ""} disabled />
                </label>
                <label className="block">
                  <span className={formLabelClass}>Last name</span>
                  <input className={`${formFieldClass} opacity-75`} value={inviteInfo?.lastName || ""} disabled />
                </label>
              </div>
              <label className="block">
                <span className={formLabelClass}>Company</span>
                <input className={`${formFieldClass} opacity-75`} value={inviteInfo?.company || ""} disabled />
              </label>
              <label className="block">
                <span className={formLabelClass}>Set password</span>
                <input
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder="Set password"
                  className={formFieldClass}
                />
              </label>
              <label className="block">
                <span className={formLabelClass}>Repeat password</span>
                <input
                  type="password"
                  value={inviteRepeat}
                  onChange={(e) => setInviteRepeat(e.target.value)}
                  placeholder="Repeat password"
                  className={formFieldClass}
                />
              </label>
              {!!error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-700">
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={onAccept}
                disabled={loading || !inviteInfo}
                className={`${primaryActionClass} h-12 w-full ${loading || !inviteInfo ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {loading ? "Accepting..." : "Accept and continue"}
              </button>
              <button
                type="button"
                onClick={onBackToLogin}
                className={`${secondaryActionClass} h-12 w-full`}
              >
                Back to sign in
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
