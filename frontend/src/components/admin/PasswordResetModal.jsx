import React from "react";

export default function PasswordResetModal({
  open,
  label,
  password,
  repeat,
  onPasswordChange,
  onRepeatChange,
  onClose,
  onGenerate,
  onCopy,
  onSubmit,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">Reset Password</h3>
          <p className="mt-1 text-xs text-slate-500">
            Set a new temporary password for {label || "this user"}. The user must change it after login.
          </p>
        </div>
        <form
          id="password-reset-form"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">New Password</span>
            <input className="input-premium w-full" type="password" autoComplete="new-password" value={password} onChange={(e) => onPasswordChange(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Repeat Password</span>
            <input className="input-premium w-full" type="password" autoComplete="new-password" value={repeat} onChange={(e) => onRepeatChange(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100" type="button" onClick={onGenerate}>Generate 16-character password</button>
            <button className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100" type="button" onClick={onCopy}>Copy password</button>
          </div>
        </form>
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50" type="button" onClick={onClose}>Cancel</button>
          <button className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800" type="submit" form="password-reset-form">Reset Password</button>
        </div>
      </div>
    </div>
  );
}
