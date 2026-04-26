import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import SearchableSelect from '../common/SearchableSelect';
import { DASHBOARD_COPY_EN, DASHBOARD_LANGUAGES, normalizeDashboardLocale } from "../../hooks/useDashboardI18n";

export default function DashboardHeader({
    user,
    onLogout,
    myFiles,
    sheetId,
    activeFilename,
    onSwitchSheet,
    onDeleteSheet,
    locale,
    setLocale,
    copy = DASHBOARD_COPY_EN,
    supportedLanguages = DASHBOARD_LANGUAGES,
}) {
    const location = useLocation();
    const isDashboardRoute = location.pathname === "/";
    const ui = isDashboardRoute ? copy : DASHBOARD_COPY_EN;
    const effectiveLocale = isDashboardRoute ? normalizeDashboardLocale(locale) : "en";
    const [languageMenuOpen, setLanguageMenuOpen] = React.useState(false);
    const languageMenuRef = React.useRef(null);

    React.useEffect(() => {
        const onDocClick = (event) => {
            if (!languageMenuRef.current?.contains(event.target)) {
                setLanguageMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, []);

    React.useEffect(() => {
        setLanguageMenuOpen(false);
    }, [location.pathname]);

    // Transform myFiles to options for SearchableSelect
    const startOptions = [{ value: "", label: ui.selectSheet }];
    const trunc = (str, n) => {
        if (!str) return "";
        return str.length > n ? str.substring(0, n - 1) + "..." : str;
    };
    const shortVisualName = (name) => {
        const clean = String(name || "").trim().replace(/\.[^/.]+$/, "").replace(/\s+/g, "_");
        if (!clean) return "Sheet";
        const parts = clean.split(/[\s._-]+/).filter(Boolean);
        if (parts.length >= 2) {
            const candidate = `${parts[0].slice(0, 4)}_${parts[1].slice(0, 3)}`.trim();
            return candidate.slice(0, 8);
        }
        if (clean.length <= 8) return clean;
        return clean.slice(0, 8);
    };

    const fileOptions = (myFiles || []).map(f => {
        const baseName = String(f.display_name || "").trim() || String(f.filename || "").trim();
        const name = String(f.display_name || "").trim() ? baseName : shortVisualName(baseName);
        const truncatedName = trunc(name, 200);
        const dateObj = new Date(f.uploaded_at);
        const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
        const dd = String(dateObj.getDate()).padStart(2, "0");
        const yyyy = String(dateObj.getFullYear());
        const date = `${mm}-${dd}-${yyyy}`;
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
        <header className="glass border-b border-slate-200/50 px-8 py-2 grid grid-cols-[1fr_auto_1fr] items-center sticky top-0 z-50 shadow-sm backdrop-blur-xl">
            {/* Left: Logo Link */}
            <div className="flex justify-start">
                <Link to="/" className="inline-flex items-center">
                    <img
                        src="/assets/tform-logo.png"
                        alt="Logo"
                        className="h-[104px] w-auto max-w-[780px] object-contain"
                    />
                </Link>
            </div>

            {/* Center: spacer */}
            <div />

            {/* Right: User Profile & Actions */}
            <div className="flex items-center justify-end gap-6">
                <div className="h-8 w-px bg-slate-200/60 mx-1"></div>

                <div className="flex items-center gap-3">
                    <div className="w-[48ch] max-w-[48ch] min-w-[48ch]">
                        <SearchableSelect
                            options={startOptions.concat(fileOptions)}
                            value={currentValue}
                            onChange={(e) => onSwitchSheet(e.target.value)}
                            onDelete={user?.role === 'admin' ? onDeleteSheet : null}
                            placeholder={ui.searchSpreadsheets}
                            className="w-full"
                            buttonClassName="w-full h-8 px-3 rounded-md border border-slate-300 bg-slate-100 text-slate-700 text-[0.72rem] font-normal shadow-sm hover:bg-slate-200"
                            labelClassName="!text-[0.72rem] !font-normal"
                            panelClassName="!rounded-md !border-slate-300 !bg-slate-100 !shadow-md"
                            optionClassName="!rounded-none !px-2 !py-1.5 hover:!bg-slate-200"
                            optionTextClassName="!text-[0.7rem] !font-normal !text-slate-700"
                            searchInputClassName="!text-[0.7rem] !font-normal !border-slate-300 !bg-slate-50 !text-slate-700"
                            panelWidth={"48ch"}
                        />
                    </div>
                    {isDashboardRoute && setLocale && (
                        <div className="relative" ref={languageMenuRef}>
                            <button
                                type="button"
                                onClick={() => setLanguageMenuOpen((v) => !v)}
                                className="w-10 h-10 rounded-2xl bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition-all flex items-center justify-center shadow-sm"
                                title={ui.language}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M2 12h20" />
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
                                </svg>
                            </button>
                            {languageMenuOpen && (
                                <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden z-50">
                                    <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                                        {ui.language}
                                    </div>
                                    <div className="p-1">
                                        {supportedLanguages.map((lang) => (
                                            <button
                                                key={lang.code}
                                                type="button"
                                                onClick={() => {
                                                    setLocale(lang.code);
                                                    setLanguageMenuOpen(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                                                    normalizeDashboardLocale(lang.code) === normalizeDashboardLocale(locale)
                                                        ? "bg-indigo-50 text-indigo-700"
                                                        : "text-slate-700 hover:bg-slate-50"
                                                }`}
                                            >
                                                {lang.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
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
                            title={ui.signOut}
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
