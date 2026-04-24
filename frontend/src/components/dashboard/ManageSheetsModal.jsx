import React, { useState } from 'react';
import Modal from '../common/Modal';

export default function ManageSheetsModal({ open, onClose, myFiles, onDeleteSheet }) {
    const [confirmId, setConfirmId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    const handleDelete = async (id) => {
        if (confirmId !== id) {
            setConfirmId(id);
            return;
        }

        try {
            setDeletingId(id);
            await onDeleteSheet(id);
        } finally {
            setDeletingId(null);
            setConfirmId(null);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Select Sheet" widthClass="max-w-md">
            <div className="flex flex-col">
                {myFiles.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                        <div className="text-2xl mb-2 opacity-20">📁</div>
                        <div className="text-slate-400 font-bold uppercase tracking-widest text-[8px]">Empty Library</div>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 border border-slate-100 rounded-3xl overflow-hidden bg-white shadow-sm">
                        {myFiles.map((file) => (
                            <div 
                                key={file.id} 
                                className="group flex items-center justify-between px-4 py-2.5 hover:bg-indigo-50/30 transition-all duration-200"
                            >
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="w-7 h-7 bg-indigo-50 text-indigo-500 rounded-lg flex items-center justify-center text-xs font-bold shrink-0">
                                        📄
                                    </div>
                                    <div className="flex flex-col overflow-hidden">
                                        <span className="font-bold text-slate-700 truncate text-xs" title={file.filename}>
                                            {file.filename}
                                        </span>
                                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">
                                            {new Date(file.uploaded_at).toLocaleDateString()} at {new Date(file.uploaded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDelete(file.id)}
                                    disabled={deletingId === file.id}
                                    className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 ${
                                        confirmId === file.id
                                            ? "bg-red-500 text-white shadow-md scale-105" 
                                            : "text-slate-300 hover:text-red-500 hover:bg-red-50"
                                    }`}
                                >
                                    {deletingId === file.id ? (
                                        <span className="text-[8px] leading-tight text-center">...</span>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            {confirmId === file.id ? (
                                                <path d="M20 6L9 17l-5-5" />
                                            ) : (
                                                <path d="M18 6L6 18M6 6l12 12" />
                                            )}
                                        </svg>
                                    )}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            
            <div className="mt-6 flex justify-end">
                <button
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition-colors border border-slate-200"
                >
                    Close
                </button>
            </div>
        </Modal>
    );
}
