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
    onSaveView,
    locale,
    setLocale,
    copy = DASHBOARD_COPY_EN,
    supportedLanguages = DASHBOARD_LANGUAGES,
}) {
    const location = useLocation();
    const isDashboardRoute = location.pathname === "/";
    const ui = copy || DASHBOARD_COPY_EN;
    const effectiveLocale = normalizeDashboardLocale(locale) || "en";
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

                    {/* Admin Link (Gear) */}
                    {user?.role === 'admin' && (
                        <a
                            href="/users"
                            className="w-10 h-10 rounded-2xl bg-indigo-600 border border-indigo-500 text-white hover:bg-indigo-700 hover:scale-105 transition-all flex items-center justify-center shadow-lg shadow-indigo-200 shrink-0"
                            title="Administration"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                        </a>
                    )}

                    {setLocale && (
                        <div className="relative" ref={languageMenuRef}>
                            <button
                                type="button"
                                onClick={() => setLanguageMenuOpen((v) => !v)}
                                className="flex items-center gap-2 h-8 px-2.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 transition-all shadow-sm"
                                title={ui.language}
                            >
                                {(() => {
                                    const currentLang = supportedLanguages.find(l => normalizeDashboardLocale(l.code) === effectiveLocale) || supportedLanguages[0];
                                    return (
                                        <>
                                            <img 
                                                src={currentLang.flag} 
                                                alt="" 
                                                className="w-3.5 h-3.5 rounded-sm object-cover" 
                                            />
                                            <span className="text-[10px] font-bold tracking-widest uppercase">{currentLang.code}</span>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`opacity-40 transition-transform duration-200 ${languageMenuOpen ? 'rotate-180' : ''}`}>
                                                <path d="m6 9 6 6 6-6"/>
                                            </svg>
                                        </>
                                    );
                                })()}
                            </button>
                            {languageMenuOpen && (
                                <div className="absolute right-0 mt-1.5 w-44 rounded-xl border border-slate-200 bg-white shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150 origin-top-right">
                                    <div className="p-1 space-y-0.5">
                                        {supportedLanguages.map((lang) => {
                                            const isActive = normalizeDashboardLocale(lang.code) === effectiveLocale;
                                            return (
                                                <button
                                                    key={lang.code}
                                                    type="button"
                                                    onClick={() => {
                                                        setLocale(lang.code);
                                                        setLanguageMenuOpen(false);
                                                    }}
                                                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors ${
                                                        isActive
                                                            ? "bg-slate-50 text-slate-900 font-semibold"
                                                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        <img 
                                                            src={lang.flag} 
                                                            alt={lang.label} 
                                                            className="w-4 h-4 rounded-sm object-cover border border-slate-100"
                                                        />
                                                        <span className="text-xs font-bold">{lang.label}</span>
                                                    </div>
                                                    {isActive && (
                                                        <div className="w-1 h-1 rounded-full bg-slate-400" />
                                                    )}
                                                </button>
                                            );
                                        })}
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
