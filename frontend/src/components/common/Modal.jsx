import React from "react";

export default function Modal({ open, onClose, title, children, widthClass = "max-w-3xl" }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div
                className={`relative bg-white rounded-2xl shadow-2xl w-[95vw] ${widthClass} max-h-[85vh] overflow-auto border border-gray-100`}
            >
                <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-blue-50">
                    <div className="font-bold text-gray-900">{title}</div>
                    <button
                        onClick={onClose}
                        className="text-gray-700 hover:text-black rounded-md px-2 py-1 hover:bg-gray-100"
                    >
                        ✕
                    </button>
                </div>
                <div className="p-4">{children}</div>
            </div>
        </div>
    );
}
