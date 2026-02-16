import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import SearchableSelect from '../common/SearchableSelect';

export default function DashboardHeader({
    user,
    onLogout,
    myFiles,
    sheetId,
    activeFilename,
    onSwitchSheet
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
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm">
            {/* Left: Logo & Title */}
            <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-blue-500/30 shadow-lg">
                    P
                </div>
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-slate-600 tracking-tight">
                    PodCaster Portal
                </h1>
            </Link>

            {/* Center: Sheet Switcher */}
            <div className="flex-1 max-w-xl mx-8">
                <div className="relative">
                    <SearchableSelect
                        options={startOptions.concat(fileOptions)}
                        value={currentValue}
                        onChange={(e) => onSwitchSheet(e.target.value)}
                        placeholder="Search for a spreadsheet..."
                        className="w-full"
                        buttonClassName="w-full border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-blue-300 transition-all rounded-full h-10 px-4 text-sm text-slate-700 shadow-sm focus:ring-2 focus:ring-blue-100"
                    />
                </div>
            </div>

            {/* Right: User Profile & Actions */}
            <div className="flex items-center gap-4">
                {user.role === 'admin' && (
                    <Link to="/users" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-50">
                        Manage Users
                    </Link>
                )}

                <div className="h-6 w-px bg-slate-200"></div>

                <div className="flex items-center gap-3 pl-2">
                    <div className="text-right hidden md:block">
                        <div className="text-sm font-semibold text-slate-700">{user.name || user.email.split('@')[0]}</div>
                        <div className="text-xs text-slate-500">{user.role || 'Viewer'}</div>
                    </div>

                    <button
                        onClick={onLogout}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                        title="Logout"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                    </button>
                </div>
            </div>
        </header>
    );
}
