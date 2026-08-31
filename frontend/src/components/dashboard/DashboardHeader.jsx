import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import axios from "axios";
import { DASHBOARD_COPY_EN, DASHBOARD_LANGUAGES, normalizeDashboardLocale } from "../../hooks/useDashboardI18n";
import SourceProviderIcon from "../common/SourceProviderIcon";
import ReportVersionPicker from "../common/ReportVersionPicker";
import { buildSourceImports, resolveFileLabel } from "../../utils/reportSelector";

export default function DashboardHeader({
    user,
    onLogout,
    onOpenWorkspaceDashboard,
    apiBase,
    token,
    myFiles,
    reportSources = [],
    reportSourceImports = {},
    sheetId,
    activeFilename,
    onSwitchSheet,
    onDeleteSheet,
    refreshReportSources = () => Promise.resolve(),
    onSaveView,
    locale,
    setLocale,
    copy = DASHBOARD_COPY_EN,
    supportedLanguages = DASHBOARD_LANGUAGES,
}) {
    const location = useLocation();
    const navigate = useNavigate();
    const isWorkspaceDashboardRoute = location.pathname === "/workspace";
    const ui = copy || DASHBOARD_COPY_EN;
    const effectiveLocale = normalizeDashboardLocale(locale) || "en";
    const [languageMenuOpen, setLanguageMenuOpen] = React.useState(false);
    const [sourcePickerOpen, setSourcePickerOpen] = React.useState(false);
    const [fileVersionMenuKey, setFileVersionMenuKey] = React.useState(null);
    const [sourceQuery, setSourceQuery] = React.useState("");
    const [expandedSources, setExpandedSources] = React.useState(() => new Set());
    const [deleteImportBusyId, setDeleteImportBusyId] = React.useState("");
    const [deleteSourceBusyId, setDeleteSourceBusyId] = React.useState("");
    const languageMenuRef = React.useRef(null);
    const sourcePickerRef = React.useRef(null);

    React.useEffect(() => {
        const onDocClick = (event) => {
            if (!languageMenuRef.current?.contains(event.target)) {
                setLanguageMenuOpen(false);
            }
            if (!sourcePickerRef.current?.contains(event.target)) {
                setSourcePickerOpen(false);
                setFileVersionMenuKey(null);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, []);

    React.useEffect(() => {
        setLanguageMenuOpen(false);
        setSourcePickerOpen(false);
        setFileVersionMenuKey(null);
    }, [location.pathname]);

    const fileLabel = (item) => resolveFileLabel(item);
    const publishedSheetIds = React.useMemo(() => {
        const ids = new Set();
        Object.values(reportSourceImports || {}).forEach((imports) => {
            if (!Array.isArray(imports)) return;
            imports.forEach((item) => {
                const id = String(item?.sheet_id || "").trim();
                const status = String(item?.status || "").trim().toLowerCase();
                if (id && status === "published") ids.add(id);
            });
        });
        return ids;
    }, [reportSourceImports]);
    const accessibleSheetIds = React.useMemo(() => {
        const ids = new Set();
        (Array.isArray(myFiles) ? myFiles : []).forEach((f) => {
            const id = String(f?.id || "").trim();
            if (id) ids.add(id);
        });
        return ids;
    }, [myFiles]);
    const getSourceImports = React.useCallback((sourceId) => {
        return buildSourceImports({
            sourceId,
            reportSourceImports,
            myFiles,
            selectableContext: { publishedSheetIds, accessibleSheetIds },
            includeAll: false,
        });
    }, [reportSourceImports, myFiles, publishedSheetIds, accessibleSheetIds]);
    const explicitSources = React.useMemo(() => (
        (reportSources || [])
            .filter((source) => source && !source.is_inferred)
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    ), [reportSources]);
    const selectedSource = explicitSources.find((source) => String(source.current_sheet_id) === String(sheetId))
        || explicitSources.find((source) => getSourceImports(source.id).some((item) => String(item.sheet_id) === String(sheetId)));
    const selectedImport = selectedSource
        ? getSourceImports(selectedSource.id).find((item) => String(item.sheet_id) === String(sheetId))
        : null;
    const trustMeta = React.useMemo(() => {
        const status = String(selectedImport?.status || "").trim().toLowerCase() || "unknown";
        const supersededAsPublished = status === "superseded" && Number(selectedImport?.import_version || 0) <= 1;
        const statusLabel = status === "published"
            ? "Published"
            : status === "pending_approval"
                ? "Pending"
                : status === "rejected"
                    ? "Rejected"
                    : status === "superseded"
                        ? ((Number(selectedImport?.import_version || 0) > 1) ? "Updated" : "Published")
                        : "Unknown";
        const statusClass = (status === "published" || supersededAsPublished)
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : status === "pending_approval"
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : status === "rejected"
                    ? "bg-rose-50 text-rose-700 border-rose-200"
                    : "bg-slate-100 text-slate-600 border-slate-200";
        return {
            statusLabel,
            statusClass,
            revision: selectedImport?.import_version ? `v${selectedImport.import_version}` : "n/a",
            publishedAt: selectedImport?.published_at ? new Date(selectedImport.published_at).toLocaleDateString() : "Not published",
        };
    }, [selectedImport]);
    const selectedPickerLabel = selectedImport
        ? `${selectedSource?.name || "Report source"} / v${selectedImport?.import_version || "-"} · ${fileLabel(selectedImport)}`
        : (selectedSource?.name || activeFilename || ui.selectSheet);
    const canManageImports = React.useMemo(() => {
        if (!user) return false;
        const role = String(user.role || "").toLowerCase().trim();
        return role === "admin" || role === "super_admin" || role === "superadmin" || !!user.is_admin || !!user.super_admin || !!user.is_group_admin || !!user.group_admin;
    }, [user]);
    const normalizedQuery = sourceQuery.trim().toLowerCase();
    const visibleSources = explicitSources.filter((source) => {
        if (!normalizedQuery) return true;
        const sourceName = String(source.name || "").toLowerCase();
        const imports = getSourceImports(source.id);
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

    React.useEffect(() => {
        if (sourcePickerOpen && selectedSource?.id) {
            setExpandedSources((prev) => {
                const next = new Set(prev);
                next.add(String(selectedSource.id));
                return next;
            });
        }
    }, [sourcePickerOpen, selectedSource?.id]);

    const selectSheet = (id, label) => {
        if (!id) return;
        onSwitchSheet(id, label);
        if (typeof onOpenWorkspaceDashboard === "function") onOpenWorkspaceDashboard();
        if (location.pathname !== "/workspace") navigate("/workspace");
        setSourcePickerOpen(false);
    };
    const deleteImportRevision = React.useCallback(async (item) => {
        const importId = Number.parseInt(String(item?.id || ""), 10);
        if (!Number.isInteger(importId) || importId <= 0 || deleteImportBusyId || !apiBase || !token) return;
        const label = fileLabel(item);
        const revision = Number(item?.import_version || 0);
        const confirmed = window.confirm(`Delete revision "${label}" (v${revision || "-"})?`);
        if (!confirmed) return;
        setDeleteImportBusyId(String(importId));
        try {
            await axios.delete(`${apiBase}/report-source-imports/${importId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            await refreshReportSources?.();
        } catch (e) {
            alert(e?.response?.data?.error || "Failed to delete import revision");
        } finally {
            setDeleteImportBusyId("");
        }
    }, [apiBase, token, deleteImportBusyId, refreshReportSources]);
    const deleteSourceLabel = React.useCallback(async (source) => {
        const sourceId = Number.parseInt(String(source?.id || ""), 10);
        if (!Number.isInteger(sourceId) || sourceId <= 0 || deleteSourceBusyId || !apiBase || !token) return;
        const sourceName = String(source?.name || `Report source ${sourceId}`);
        const confirmed = window.confirm(`Delete label "${sourceName}" and all of its revisions?`);
        if (!confirmed) return;
        setDeleteSourceBusyId(String(sourceId));
        try {
            await axios.delete(`${apiBase}/report-sources/${sourceId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            await refreshReportSources?.();
        } catch (e) {
            alert(e?.response?.data?.error || "Failed to delete report source label");
        } finally {
            setDeleteSourceBusyId("");
        }
    }, [apiBase, token, deleteSourceBusyId, refreshReportSources]);

    return (
        <header className="border-b border-slate-200/80 bg-white/95 px-5 py-2 grid grid-cols-[auto_1fr_auto] items-center sticky top-0 z-50 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl md:px-8">
            {/* Left: Logo Link */}
            <div className="flex justify-start">
                <Link to="/" className="inline-flex items-center">
                    <img
                        src="/assets/tform-logo.png"
                        alt="TFORN - Turn Financial Outputs into Real Numbers"
                        className="h-16 w-auto max-w-[280px] object-contain lg:h-20 lg:max-w-[420px]"
                    />
                </Link>
            </div>

            {/* Center: spacer */}
            <div />

            {/* Right: User Profile & Actions */}
            <div className="flex items-center justify-end gap-3 lg:gap-4">
                <div className="hidden h-8 w-px bg-slate-200/80 lg:block"></div>

                    <div className="hidden md:block w-full max-w-[560px]">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (typeof onOpenWorkspaceDashboard === "function") onOpenWorkspaceDashboard();
                                    if (!isWorkspaceDashboardRoute) navigate("/workspace");
                                }}
                                className={`inline-flex h-8 shrink-0 items-center rounded-lg border px-3 text-[11px] font-black tracking-wide transition-all ${
                                    isWorkspaceDashboardRoute
                                        ? "border-slate-800 bg-slate-950 text-white shadow-sm"
                                        : "border-slate-800 bg-blue-900 text-white hover:border-blue-800 hover:bg-blue-800"
                                }`}
                                title="Dashboard"
                            >
                                Dashboard
                            </button>
                            <div className="min-w-0 flex-1">
                                <ReportVersionPicker
                                    pickerRef={sourcePickerRef}
                                    isOpen={sourcePickerOpen}
                                    setIsOpen={setSourcePickerOpen}
                                    query={sourceQuery}
                                    setQuery={setSourceQuery}
                                    expandedSources={expandedSources}
                                    setExpandedSources={setExpandedSources}
                                    fileVersionMenuKey={fileVersionMenuKey}
                                    setFileVersionMenuKey={setFileVersionMenuKey}
                                    sources={visibleSources}
                                    getSourceImports={getSourceImports}
                                    selectedSheetId={sheetId}
                                    selectedPickerLabel={selectedPickerLabel}
                                    onSelectSheet={selectSheet}
                                    canManageImports={canManageImports}
                                    deleteImportBusyId={deleteImportBusyId}
                                    deleteSourceBusyId={deleteSourceBusyId}
                                    onDeleteImportRevision={deleteImportRevision}
                                    onDeleteSource={deleteSourceLabel}
                                    revisionMenuAlign="top"
                                    embedRevisionMenu={true}
                                    buttonClassName="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-[11px] font-bold shadow-sm hover:border-slate-400 transition-all flex items-center justify-between gap-2 overflow-hidden"
                                    panelClassName="absolute left-0 mt-1 w-[min(620px,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-2xl z-50 p-2"
                                />
                            </div>
                        </div>
                    </div>
                    <div className="hidden lg:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/90 px-2.5 py-1.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${trustMeta.statusClass}`}>
                            {trustMeta.statusLabel}
                        </span>
                        <span className="text-[10px] font-bold text-slate-600">{trustMeta.revision}</span>
                        <span className="text-[10px] font-semibold text-slate-500">{trustMeta.publishedAt}</span>
                    </div>

                    {/* Admin Link (Gear) */}
                    {user?.role === 'admin' && (
                        <a
                            href="/users"
                            className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 text-white hover:bg-blue-700 hover:scale-105 transition-all flex items-center justify-center shadow-lg shadow-slate-200 shrink-0"
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
                                className="flex items-center gap-2 h-10 px-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-blue-200 hover:bg-white transition-all shadow-sm"
                                title={ui.language}
                            >
                                {(() => {
                                    const currentLang = supportedLanguages.find(l => normalizeDashboardLocale(l.code) === effectiveLocale) || supportedLanguages[0];
                                    return (
                                        <>
                                            <img src={currentLang.flag} alt="" width="14" height="14" className="block w-3.5 h-3.5 shrink-0 rounded-sm object-cover" />
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
                                                        <img src={lang.flag} alt={lang.label} width="16" height="16" className="block w-4 h-4 shrink-0 rounded-sm object-cover border border-slate-100" />
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
                        <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest leading-none mt-1">
                            {user.role}
                        </div>
                    </div>

                    <div className="group relative">
                        <button
                            onClick={onLogout}
                            className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-100 transition-all flex items-center justify-center shadow-sm"
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
