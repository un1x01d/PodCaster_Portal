import React, { useState } from "react";
import api from "../../api";
import Modal from "./Modal";

export default function ChangePasswordModal({ open, onClose, forceChange }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    try {
      await api.post(
        `/auth/change-password`,
        { currentPassword, newPassword }
      );
      setSuccess("Password changed successfully!");
      if (forceChange) {
        // Navigate to root so the app re-checks auth state cleanly
        setTimeout(() => { window.location.href = "/"; }, 1000);
      } else {
        setTimeout(() => onClose(), 1500);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to change password");
    }
  };

  const title = forceChange ? "Change Password Required" : "Change Password";
  const canClose = !forceChange;

  return (
    <Modal open={open} onClose={canClose ? onClose : () => { }} title={title}>
      <div className="p-1">
        {forceChange && (
          <div className="bg-amber-50 text-amber-800 p-2.5 rounded-md text-[11px] font-medium mb-3 border border-amber-200 shadow-sm leading-relaxed">
            <span className="font-black uppercase text-[8px] block mb-0.5 tracking-widest opacity-60">Security Protocol</span>
            Your administrator has initiated a mandatory security reset. Please define a new access key to resume your session.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <div className="text-red-700 text-[11px] font-bold bg-red-50 p-2 rounded-md border border-red-100 animate-shake">{error}</div>}
          {success && <div className="text-emerald-700 text-[11px] font-bold bg-emerald-50 p-2 rounded-md border border-emerald-100">{success}</div>}

          <div className="space-y-1 group">
            <label className="block text-[8px] font-black text-slate-400 uppercase tracking-[0.15em] ml-1 group-focus-within:text-indigo-500 transition-colors">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500/40 transition-all"
              required
            />
          </div>

          <div className="space-y-1 group">
            <label className="block text-[8px] font-black text-slate-400 uppercase tracking-[0.15em] ml-1 group-focus-within:text-indigo-500 transition-colors">New Access Key</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500/40 transition-all"
              required
            />
            <div className="bg-slate-50 rounded p-1.5 border border-slate-100 mt-1">
              <p className="text-[7.5px] font-black text-slate-400 uppercase tracking-widest leading-normal">
                Requirement: Min 16 chars · Upper · Lower · Num · Symbol
              </p>
            </div>
          </div>

          <div className="space-y-1 group">
            <label className="block text-[8px] font-black text-slate-400 uppercase tracking-[0.15em] ml-1 group-focus-within:text-indigo-500 transition-colors">Verify New Key</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500/40 transition-all"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-slate-900 hover:bg-black text-white py-2 rounded-md font-black text-[11px] uppercase tracking-widest shadow-lg shadow-slate-100 hover:shadow-xl active:scale-[0.98] transition-all"
          >
            Update & Verify Access
          </button>
        </form>
      </div>
    </Modal>
  );
}
