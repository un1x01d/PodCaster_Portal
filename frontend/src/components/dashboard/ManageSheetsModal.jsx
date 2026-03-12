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
        <Modal open={open} onClose={onClose} title="Manage Sheets" widthClass="max-w-2xl">
            <div className="flex flex-col gap-4 max-h-[60vh] overflow-hidden pr-2">
                {myFiles.length === 0 ? (
                    <div className="text-center text-slate-500 py-8">No sheets uploaded yet.</div>
                ) : (
                    <div className="flex flex-col border border-slate-200 rounded-lg overflow-y-auto">
                        {myFiles.map((file, idx) => (
                            <div 
                                key={file.id} 
                                className={`flex items-center justify-between p-3 ${idx < myFiles.length - 1 ? 'border-b border-slate-100' : ''} hover:bg-slate-50 transition-colors`}
                            >
                                <div className="flex flex-col overflow-hidden mr-4">
                                    <span className="font-semibold text-slate-800 truncate" title={file.filename}>
                                        {file.filename}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                        Uploaded: {new Date(file.uploaded_at).toLocaleString()}
                                    </span>
                                </div>
                                <button
                                    onClick={() => handleDelete(file.id)}
                                    disabled={deletingId === file.id}
                                    className={`shrink-0 p-2 rounded-lg transition-colors border disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
                                        confirmId === file.id
                                            ? "bg-red-600 text-white border-red-700 hover:bg-red-700" 
                                            : "text-red-500 hover:text-white hover:bg-red-500 border-red-100"
                                    }`}
                                    title={confirmId === file.id ? "Click again to confirm" : "Delete Sheet"}
                                >
                                    {deletingId === file.id ? (
                                        <span className="text-xs">Deleting...</span>
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                                            <span className="text-xs font-semibold">
                                                {confirmId === file.id ? "Are you sure?" : "Delete"}
                                            </span>
                                        </>
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
