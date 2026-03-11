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
      {forceChange && (
        <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg text-sm mb-4 border border-yellow-200">
          Your admin has reset your password. You must set a new one to continue.
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <div className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</div>}
        {success && <div className="text-green-600 text-sm bg-green-50 p-2 rounded">{success}</div>}

        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase">Current Password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            className="w-full border p-2 rounded text-sm"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase">New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="w-full border p-2 rounded text-sm"
            required
          />
          <p className="text-[10px] text-gray-400 mt-1">
            Min 16 chars, 1 uppercase, 1 lowercase, 1 number, 1 special (!@#$%^&*()_+)
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase">Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="w-full border p-2 rounded text-sm"
            required
          />
        </div>

        <button
          type="submit"
          className="bg-blue-600 text-white py-2 rounded font-semibold text-sm hover:bg-blue-700 mt-2"
        >
          Update Password
        </button>
      </form>
    </Modal>
  );
}
