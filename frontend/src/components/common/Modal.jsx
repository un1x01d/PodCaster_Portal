import React from "react";
import { createPortal } from "react-dom";

export default function Modal({ open, onClose, title, children, widthClass = "max-w-3xl" }) {
    if (!open) return null;

    const modalContent = (
        <div className="fixed inset-0 z-[9999] overflow-y-auto pointer-events-auto">
            {/* Backdrop: Fixed and covering full viewport behind the content */}
            <div 
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-md cursor-pointer" 
                onClick={onClose} 
            />
            
            {/* Centering Wrapper */}
            <div className="flex min-h-screen items-center justify-center p-4 sm:p-8">
                <div
                    className={`relative bg-white rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] w-full ${widthClass} overflow-hidden border border-white/20 flex flex-col z-10 animate-in zoom-in-95 duration-200`}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                        <div className="font-black text-slate-900 tracking-tight text-2xl">{title}</div>
                        <button
                            onClick={onClose}
                            className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-2xl transition-all"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                    <div className="p-8 overflow-y-auto custom-scrollbar bg-white">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
