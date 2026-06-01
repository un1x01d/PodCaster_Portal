import React from "react";
import { Link } from "react-router-dom";
import {
  publicPageClass,
  themeTextClass,
  publicMiniPanelClass,
  publicPanelClass,
  formLabelClass,
  formFieldClass,
  primaryActionClass,
  secondaryActionClass,
  themeHoverTextClass
} from "../../utils/theme";

export default function AuthScreen({ email, setEmail, password, setPassword, onSubmit, onGoogleLogin, onSamlLogin, googleEnabled, error = "", twoFactorChallenge = null, twoFactorCode = "", setTwoFactorCode = () => {}, onVerifyTwoFactor = () => {}, onResendTwoFactorSms = null, onCancelTwoFactor = () => {}, twoFactorVerifying = false }) {
  return (
    <div className={publicPageClass}>
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-8 lg:grid-cols-[1fr_480px] lg:items-center">
        <section className="hidden lg:block">
          <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
            <img
              src="/assets/tform-logo.png"
              alt="TFORN - Turn Financial Outputs into Real Numbers"
              className="h-16 w-auto max-w-[320px] object-contain"
            />
          </Link>
          <p className={`mt-12 text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>Workspace sign in</p>
          <h1 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-tight text-slate-950">
            Continue to your controlled file workspace.
          </h1>
          <p className="mt-4 max-w-xl text-base font-semibold leading-8 text-slate-600">
            Access reviewed sources, file versions, user permissions, and safe answers from data your team has organized.
          </p>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            {["Reviewed files", "Source history", "Admin controls"].map((item) => (
              <div key={item} className={publicMiniPanelClass}>
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className={publicPanelClass}>
          <div className="mb-6 text-center lg:text-left">
            <Link to="/" className="mb-5 inline-flex justify-center lg:hidden" aria-label="TFORN home">
              <img
                src="/assets/tform-logo.png"
                alt="TFORN - Turn Financial Outputs into Real Numbers"
                className="h-12 w-auto max-w-[230px] object-contain"
              />
            </Link>
            <h2 className="text-2xl font-black tracking-tight text-slate-950">Sign in</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">Open your TFORN workspace.</p>
          </div>

        {twoFactorChallenge ? (
          <form onSubmit={onVerifyTwoFactor} className="space-y-3">
            {error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {error}
              </div>
            ) : null}
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Two-factor verification</div>
              <p className="mt-2 leading-6">
                {twoFactorChallenge.method === "sms"
                  ? `Enter the code sent to ${twoFactorChallenge.maskedPhone || "your phone"}.`
                  : "Enter the code from your authenticator app."}
              </p>
            </div>
            <div className="group space-y-1">
              <label className={formLabelClass}>Verification code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                placeholder="123456"
                className={formFieldClass}
                required
                autoFocus
              />
            </div>
            <button type="submit" disabled={twoFactorVerifying} className={`${primaryActionClass} h-12 w-full ${twoFactorVerifying ? "opacity-60 cursor-not-allowed" : ""}`}>
              {twoFactorVerifying ? "Verifying..." : "Verify and continue"}
            </button>
            {twoFactorChallenge.method === "sms" && onResendTwoFactorSms ? (
              <button type="button" onClick={onResendTwoFactorSms} className={`${secondaryActionClass} h-11 w-full`}>
                Resend SMS code
              </button>
            ) : null}
            <button type="button" onClick={onCancelTwoFactor} className="w-full text-xs font-black uppercase tracking-[0.16em] text-slate-500 hover:text-slate-950">
              Back to sign in
            </button>
          </form>
        ) : (
        <form onSubmit={onSubmit} className="space-y-2">
          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          ) : null}
          <div className="group space-y-1">
            <label className={formLabelClass}>Work email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className={formFieldClass}
              required
            />
          </div>

          <div className="group space-y-1">
            <div className="flex justify-between items-center px-1">
              <label className={formLabelClass}>Password</label>
              <Link to="/support" className={`text-xs font-black ${themeTextClass} transition-colors hover:text-slate-950`}>Trouble signing in?</Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className={formFieldClass}
              required
            />
          </div>

          <button
            type="submit"
            className={`${primaryActionClass} h-12 w-full`}
          >
            <span className="flex items-center justify-center gap-2">
              Sign in to workspace
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </span>
          </button>

          <button
            type="button"
            onClick={onGoogleLogin}
            disabled={!googleEnabled}
            className={`${secondaryActionClass} h-12 w-full gap-2.5 ${!googleEnabled ? "opacity-50 cursor-not-allowed grayscale" : ""}`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c1.61-1.48 2.54-3.67 2.54-6.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          <button
            type="button"
            onClick={onSamlLogin}
            className={`${secondaryActionClass} h-12 w-full gap-2.5`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            Continue with SAML SSO
          </button>
        </form>
        )}

        <div className="mt-8 border-t border-slate-300 py-4">
           <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Workspace available</span>
           </div>
           <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
             Access is controlled by your account, customer workspace, and admin permissions.
           </p>
        </div>
        </section>
      </div>
    </div>
  );
}
