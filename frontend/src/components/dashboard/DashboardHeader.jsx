import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { DASHBOARD_COPY_EN, DASHBOARD_LANGUAGES, normalizeDashboardLocale } from "../../hooks/useDashboardI18n";

export default function DashboardHeader({
    user,
    onLogout,
    myFiles,
    reportSources = [],
    reportSourceImports = {},
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
    const [sourcePickerOpen, setSourcePickerOpen] = React.useState(false);
    const [sourceQuery, setSourceQuery] = React.useState("");
    const [expandedSources, setExpandedSources] = React.useState(() => new Set());
    const languageMenuRef = React.useRef(null);
    const sourcePickerRef = React.useRef(null);

    React.useEffect(() => {
        const onDocClick = (event) => {
            if (!languageMenuRef.current?.contains(event.target)) {
                setLanguageMenuOpen(false);
            }
            if (!sourcePickerRef.current?.contains(event.target)) {
                setSourcePickerOpen(false);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, []);

    React.useEffect(() => {
        setLanguageMenuOpen(false);
        setSourcePickerOpen(false);
    }, [location.pathname]);

    const trunc = (str, n) => {
        if (!str) return "";
        return str.length > n ? str.substring(0, n - 1) + "..." : str;
    };
    const fileLabel = (item) => item?.import_name || item?.original_filename || item?.filename || item?.display_name || `Version ${item?.import_version || ""}`.trim();
    const explicitSources = React.useMemo(() => (
        (reportSources || [])
            .filter((source) => source && !source.is_inferred && source.current_sheet_id)
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    ), [reportSources]);
    const selectedSource = explicitSources.find((source) => String(source.current_sheet_id) === String(sheetId))
        || explicitSources.find((source) => (reportSourceImports[String(source.id)] || []).some((item) => String(item.sheet_id) === String(sheetId)));
    const selectedImport = selectedSource
        ? (reportSourceImports[String(selectedSource.id)] || []).find((item) => String(item.sheet_id) === String(sheetId))
        : null;
    const selectedPickerLabel = selectedImport
        ? `${selectedSource?.name || "Report source"} / ${fileLabel(selectedImport)}`
        : (selectedSource?.name || activeFilename || ui.selectSheet);
    const normalizedQuery = sourceQuery.trim().toLowerCase();
    const visibleSources = explicitSources.filter((source) => {
        if (!normalizedQuery) return true;
        const sourceName = String(source.name || "").toLowerCase();
        const imports = reportSourceImports[String(source.id)] || [];
        return sourceName.includes(normalizedQuery)
            || imports.some((item) => String(fileLabel(item)).toLowerCase().includes(normalizedQuery));
    });
    const toggleSource = (sourceId) => {
        setExpandedSources((prev) => {
            const next = new Set(prev);
            const key = String(sourceId);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };
    const selectSheet = (id, label) => {
        if (!id) return;
        onSwitchSheet(id, label);
        setSourcePickerOpen(false);
    };

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

                    <div className="relative flex-1 max-w-[320px] md:max-w-lg lg:w-[480px]" ref={sourcePickerRef}>
                        <button
                            type="button"
                            onClick={() => setSourcePickerOpen((v) => !v)}
                            className="w-full h-8 px-3 rounded-[0.6rem] border border-slate-300 bg-white text-slate-900 text-[11px] font-bold shadow-sm hover:border-slate-400 transition-all flex items-center justify-between gap-2 overflow-hidden"
                            title={selectedPickerLabel}
                        >
                            <span className="truncate text-left">{trunc(selectedPickerLabel, 90)}</span>
                            <span className={`opacity-50 shrink-0 text-[10px] transition-transform ${sourcePickerOpen ? "rotate-180" : ""}`}>▼</span>
                        </button>

                        {sourcePickerOpen && (
                            <div className="absolute right-0 mt-1 w-[min(620px,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-2xl z-50 p-2">
                                <input
                                    autoFocus
                                    value={sourceQuery}
                                    onChange={(e) => setSourceQuery(e.target.value)}
                                    placeholder="Search report sources or files..."
                                    className="w-full border border-slate-100 rounded-lg px-3 py-2.5 mb-2 focus:outline-none focus:ring focus:ring-slate-100 placeholder:text-slate-400 text-[11px] font-bold"
                                />
                                <div className="max-h-80 overflow-auto custom-scrollbar space-y-1">
                                    {visibleSources.length ? visibleSources.map((source) => {
                                        const key = String(source.id);
                                        const imports = reportSourceImports[key] || [];
                                        const isExpanded = expandedSources.has(key) || !!normalizedQuery || String(selectedSource?.id) === key;
                                        const sourceName = source.name || `Report source ${source.id}`;
                                        return (
                                            <div key={key} className="rounded-lg border border-slate-100 bg-slate-50/60 overflow-hidden">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSource(key)}
                                                    className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-slate-100 transition-colors"
                                                >
                                                    <div className="min-w-0 text-left">
                                                        <div className="text-[11px] font-black text-slate-800 truncate">{sourceName}</div>
                                                        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                                                            {imports.length} file{imports.length === 1 ? "" : "s"} · current {source.current_sheet_id}
                                                        </div>
                                                    </div>
                                                    <span className={`text-[10px] text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                                                </button>
                                                {isExpanded && (
                                                    <div className="bg-white border-t border-slate-100 py-1">
                                                        {imports.length ? imports.map((item) => {
                                                            const label = fileLabel(item);
                                                            const itemSheetId = String(item.sheet_id || "");
                                                            const isCurrent = itemSheetId === String(source.current_sheet_id);
                                                            const isSelected = itemSheetId === String(sheetId);
                                                            return (
                                                                <div
                                                                    key={`${key}:${itemSheetId || item.import_version}`}
                                                                    className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${isSelected ? "bg-indigo-50" : "hover:bg-indigo-50/70"}`}
                                                                    onClick={() => selectSheet(itemSheetId, label)}
                                                                    title={label}
                                                                >
                                                                    <div className="w-9 shrink-0 text-[9px] font-black text-slate-400">v{item.import_version || "-"}</div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="text-[11px] font-bold text-slate-800 truncate">{label}</div>
                                                                        <div className="text-[9px] text-slate-400 truncate">
                                                                            {item.schema_status || "import"}{isCurrent ? " · current" : ""}{item.created_at ? ` · ${new Date(item.created_at).toLocaleDateString()}` : ""}
                                                                        </div>
                                                                    </div>
                                                                    {isCurrent && (
                                                                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700">Current</span>
                                                                    )}
                                                                    {user?.role === "admin" && onDeleteSheet && itemSheetId && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                onDeleteSheet(itemSheetId);
                                                                            }}
                                                                            className="opacity-0 group-hover:opacity-100 shrink-0 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                                                            title="Delete file"
                                                                        >
                                                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            );
                                                        }) : (
                                                            <div className="px-3 py-3 text-[11px] font-semibold text-slate-400">No imported files found for this report source.</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    }) : (
                                        <div className="px-3 py-6 text-center text-[11px] font-semibold text-slate-400">No report sources or files match.</div>
                                    )}
                                </div>
                            </div>
                        )}
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
        </header>
    );
}
