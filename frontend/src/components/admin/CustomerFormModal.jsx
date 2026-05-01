import React from "react";

export default function CustomerFormModal({
  open,
  mode,
  firstName,
  lastName,
  companyName,
  email,
  phone,
  onClose,
  onSave,
  onFirstNameChange,
  onLastNameChange,
  onCompanyNameChange,
  onEmailChange,
  onPhoneChange,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/60 px-4">
      <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-4 shadow-2xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-semibold text-slate-900">{mode === "edit" ? "Edit Customer" : "New Customer"}</div>
          <button type="button" className="text-[11px] font-semibold text-slate-500 hover:text-slate-900" onClick={onClose}>Close</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Customer First Name" value={firstName} onChange={(e) => onFirstNameChange(e.target.value)} />
          <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Customer Last Name" value={lastName} onChange={(e) => onLastNameChange(e.target.value)} />
          <input className="input-premium py-1.5 text-[11px] font-semibold md:col-span-2" placeholder="Company Name" value={companyName} onChange={(e) => onCompanyNameChange(e.target.value)} />
          <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Email" value={email} onChange={(e) => onEmailChange(e.target.value)} />
          <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Phone (optional)" value={phone} onChange={(e) => onPhoneChange(e.target.value)} />
        </div>
        <div className="flex justify-end">
          <button type="button" className="btn-premium bg-slate-800 text-white px-4 py-1.5 text-[11px]" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
