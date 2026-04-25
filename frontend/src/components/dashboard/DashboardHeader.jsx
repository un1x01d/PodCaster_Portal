import React from 'react';
import { Link } from 'react-router-dom';
import SearchableSelect from '../common/SearchableSelect';

export default function DashboardHeader({
    user,
    onLogout,
    myFiles,
    sheetId,
    activeFilename,
    onSwitchSheet,
    onDeleteSheet
}) {

    // Transform myFiles to options for SearchableSelect
    const startOptions = [{ value: "", label: "Select a sheet..." }];
    const trunc = (str, n) => {
        if (!str) return "";
        return str.length > n ? str.substring(0, n - 1) + "..." : str;
    };

    const fileOptions = (myFiles || []).map(f => {
        // Simple name clean up
        const name = f.filename.replace(/\.[^/.]+$/, ""); // Remove extension
        const truncatedName = trunc(name, 200);
        const date = new Date(f.uploaded_at).toLocaleString();
        return {
            value: String(f.id),
            label: `${truncatedName} (${date})`
        };
    });

    // Find current value using sheetId if available, fallback to activeFilename check
    let currentValue = "";
    if (sheetId) {
        currentValue = String(sheetId);
    } else if (activeFilename) {
        const found = myFiles?.find(f => f.filename === activeFilename);
        if (found) currentValue = String(found.id);
    }

    return (
        <header className="glass border-b border-slate-200/50 px-8 py-4 grid grid-cols-[1fr_auto_1fr] items-center sticky top-0 z-50 shadow-sm backdrop-blur-xl">
            {/* Left: Logo & Title */}
            <div className="flex justify-start">
                <Link to="/" className="flex items-center gap-4 hover:opacity-80 transition-all hover:scale-[1.02] active:scale-95">
                    <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-xl shadow-indigo-100">
                        P
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tighter">
                        Data <span className="text-indigo-600">Insights</span> Portal
                    </h1>
                </Link>
            </div>

            {/* Center: Sheet Switcher */}
            <div className="w-[32rem] max-w-full">
                <div className="relative group">
                    <SearchableSelect
                        options={startOptions.concat(fileOptions)}
                        value={currentValue}
                        onChange={(e) => onSwitchSheet(e.target.value)}
                        onDelete={user?.role === 'admin' ? onDeleteSheet : null}
                        placeholder="Search spreadsheets..."
                        className="w-full"
                        buttonClassName="w-full input-premium bg-white/60 hover:bg-white rounded-full h-11 px-6 shadow-sm group-hover:shadow-md"
                        panelWidth={700}
                    />
                </div>
            </div>

            {/* Right: User Profile & Actions */}
            <div className="flex items-center justify-end gap-6">
                <div className="h-8 w-px bg-slate-200/60 mx-1"></div>

                <div className="flex items-center gap-4">
                    <div className="text-right hidden xl:block">
                        <div className="text-sm font-bold text-slate-900 truncate max-w-[120px]">
                            {user.name || user.email.split('@')[0]}
                        </div>
                        <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest leading-none mt-1">
                            {user.role}
                        </div>
                    </div>

                    <div className="group relative">
                        <button
                            onClick={onLogout}
                            className="w-10 h-10 rounded-2xl bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-100 transition-all flex items-center justify-center shadow-sm"
                            title="Sign out"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                <polyline points="16 17 21 12 16 7" />
                                <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}
