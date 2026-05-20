import React from "react";
import SourceProviderIcon from "./SourceProviderIcon";
import { groupImportsByLabel, resolveFileLabel } from "../../utils/reportSelector";

function trunc(str, n) {
  if (!str) return "";
  return str.length > n ? str.substring(0, n - 1) + "..." : str;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / (1024 ** exponent);
  const precision = scaled >= 100 || exponent === 0 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(precision)} ${units[exponent]}`;
}

function importSizeBytes(item) {
  const candidates = [
    item?.file_size_bytes,
    item?.file_size,
    item?.size,
    item?.byte_size,
    item?.bytes,
    item?.file_bytes,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export default function ReportVersionPicker({
  pickerRef = null,
  isOpen = false,
  setIsOpen = () => {},
  query = "",
  setQuery = () => {},
  expandedSources = new Set(),
  setExpandedSources = () => {},
  fileVersionMenuKey = null,
  setFileVersionMenuKey = () => {},
  sources = [],
  getSourceImports = () => [],
  selectedSheetId = "",
  selectedPickerLabel = "",
  onSelectSheet = () => {},
  searchPlaceholder = "Search report sources or files...",
  buttonClassName = "",
  panelClassName = "",
  withAutosync = false,
  onToggleAutosync = null,
  autosyncToggleBusyId = "",
  titleCharLimit = 90,
  canManageImports = false,
  deleteImportBusyId = "",
  deleteSourceBusyId = "",
  onDeleteImportRevision = null,
  onDeleteSource = null,
  revisionMenuAlign = "below",
  embedRevisionMenu = false,
}) {
  const isItemSelectable = (item) => {
    if (typeof item?.selectable === "boolean") return item.selectable === true;
    const status = String(item?.status || "").trim().toLowerCase();
    return status === "published";
  };
  const reasonLabel = (item) => {
    const reason = String(item?.selectable_reason || "").trim().toLowerCase();
    if (!reason) return "This version cannot be opened right now.";
    return reason.replace(/_/g, " ");
  };
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const visibleSources = (Array.isArray(sources) ? sources : []).filter((source) => {
    if (!normalizedQuery) return true;
    const sourceName = String(source?.name || "").toLowerCase();
    const imports = getSourceImports(source?.id);
    return sourceName.includes(normalizedQuery)
      || imports.some((item) => String(resolveFileLabel(item)).toLowerCase().includes(normalizedQuery));
  });

  return (
    <div className="relative" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={buttonClassName}
        title={selectedPickerLabel}
      >
        <span className="truncate text-left">{trunc(selectedPickerLabel, titleCharLimit)}</span>
        <span className={`opacity-50 shrink-0 text-[10px] transition-transform ${isOpen ? "rotate-180" : ""}`}>▼</span>
      </button>
      {isOpen && (
        <div className={panelClassName}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full border border-slate-100 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring focus:ring-slate-100 placeholder:text-slate-400 text-[11px] font-bold"
          />
          <div className="max-h-[70vh] overflow-auto custom-scrollbar space-y-1">
            {visibleSources.length ? visibleSources.map((source) => {
              const key = String(source.id);
              const imports = getSourceImports(key);
              const sizes = imports.map((item) => importSizeBytes(item));
              const hasUnknownSizes = sizes.some((size) => size == null);
              const totalSizeBytes = sizes.reduce((sum, size) => sum + (size || 0), 0);
              const totalSizeLabel = hasUnknownSizes ? "Unknown" : formatBytes(totalSizeBytes);
              const isExpanded = expandedSources.has(key) || !!normalizedQuery;
              const sortedGroups = groupImportsByLabel(imports);

              return (
                <div key={key} className="rounded-lg border border-slate-100 bg-slate-50/60 overflow-visible">
                  <div className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 transition-colors">
                    <button
                      type="button"
                      onClick={() => setExpandedSources((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      })}
                      className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left"
                    >
                      <div className="min-w-0 text-left text-[11px] font-black text-slate-800 truncate">
                        <span className="inline-flex items-center gap-1.5 min-w-0">
                          <SourceProviderIcon provider={source.sync_provider} className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                          <span className="truncate">{source.name || `Report source ${source.id}`}</span>
                        </span>
                        <span> · </span>
                        <span className="text-slate-500">{imports.length} file{imports.length === 1 ? "" : "s"}</span>
                        <span className="text-slate-400"> • {totalSizeLabel}</span>
                      </div>
                      <span className={`text-[10px] text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                    </button>
                    {withAutosync && source.sync_provider && source.sync_source_ref && typeof onToggleAutosync === "function" ? (
                      <button
                        type="button"
                        onClick={() => onToggleAutosync(source.id, !source.sync_enabled)}
                        disabled={autosyncToggleBusyId === key}
                        className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${source.sync_enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"} ${autosyncToggleBusyId === key ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        {autosyncToggleBusyId === key ? "Saving..." : (source.sync_enabled ? "Autosync ON" : "Autosync OFF")}
                      </button>
                    ) : null}
                    {canManageImports && typeof onDeleteSource === "function" ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSource(source);
                        }}
                        disabled={deleteSourceBusyId === key}
                        className={`rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 ${deleteSourceBusyId === key ? "opacity-60 cursor-not-allowed" : ""}`}
                        title="Delete this label and all revisions"
                      >
                        {deleteSourceBusyId === key ? "Deleting..." : "Delete label"}
                      </button>
                    ) : null}
                  </div>
                  {isExpanded && (
                    <div className="bg-white border-t border-slate-100 py-1">
                      {sortedGroups.length ? sortedGroups.map((group) => {
                        const latest = group[0];
                        const label = resolveFileLabel(latest);
                        const fileKey = `${key}:${label}`;
                        const revisionMenuChars = Math.min(100, Math.max(38, String(label || "").length + 20));
                        const isSelectedGroup = group.some((i) => String(i.sheet_id) === String(selectedSheetId));
                        const isVersionMenuOpen = fileVersionMenuKey === fileKey;
                        return (
                          <div
                            key={fileKey}
                            className={`group relative flex items-center gap-2 px-3 py-2 transition-colors ${isSelectedGroup ? "bg-indigo-50" : "hover:bg-indigo-50/70"} ${isVersionMenuOpen ? "z-[150]" : "z-0"} ${isItemSelectable(latest) ? "cursor-pointer" : "cursor-not-allowed opacity-75"}`}
                            title={isItemSelectable(latest) ? label : reasonLabel(latest)}
                            onClick={() => {
                              if (!isItemSelectable(latest)) return;
                              const sid = String(latest?.sheet_id || "");
                              if (sid) onSelectSheet(sid, label);
                              setFileVersionMenuKey(null);
                              setIsOpen(false);
                            }}
                          >
                            <div className={`relative z-20 w-10 shrink-0 flex file-version-dropdown-container ${revisionMenuAlign === "panel_top" ? "justify-start items-start self-stretch" : "justify-center"}`}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFileVersionMenuKey(fileVersionMenuKey === fileKey ? null : fileKey);
                                }}
                                className={`px-1.5 py-0.5 rounded-[4px] bg-slate-100 text-[9px] font-black text-slate-500 hover:bg-slate-200 transition-colors flex items-center gap-1 ${fileVersionMenuKey === fileKey ? "ring-2 ring-indigo-100 bg-slate-200" : ""}`}
                              >
                                v{latest.import_version || "-"}<span className={`text-[8px] opacity-40 transition-transform ${fileVersionMenuKey === fileKey ? "rotate-180" : ""}`}>▼</span>
                              </button>
                              {fileVersionMenuKey === fileKey && !embedRevisionMenu && (
                                <div className={`absolute left-0 ${revisionMenuAlign === "panel_top" ? "-top-2" : revisionMenuAlign === "top" ? "top-0" : "top-full mt-0"} bg-white border border-slate-200 rounded-lg shadow-xl z-[100] py-1`} style={{ width: `${revisionMenuChars}ch`, maxWidth: "min(90vw, 980px)" }}>
                                  <div className="max-h-48 overflow-auto custom-scrollbar">
                                    {group.map((v) => {
                                      const importStatus = String(v?.status || "").trim().toLowerCase();
                                      const importId = Number.parseInt(String(v?.id || ""), 10);
                                      const canDeleteRevision = canManageImports
                                        && typeof onDeleteImportRevision === "function"
                                        && importStatus !== "published"
                                        && Number.isInteger(importId)
                                        && importId > 0;
                                      return (
                                        <div
                                          key={String(v.sheet_id)}
                                          className={`w-full text-left px-2 py-1.5 hover:bg-slate-50 flex items-center gap-2 ${String(v.sheet_id) === String(selectedSheetId) ? "bg-indigo-50/50" : ""} ${isItemSelectable(v) ? "" : "opacity-60"}`}
                                        >
                                          <button
                                            type="button"
                                            disabled={!isItemSelectable(v)}
                                            title={isItemSelectable(v) ? label : reasonLabel(v)}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (!isItemSelectable(v)) return;
                                              const sid = String(v.sheet_id || "");
                                              if (sid) onSelectSheet(sid, label);
                                              setFileVersionMenuKey(null);
                                              setIsOpen(false);
                                            }}
                                            className={`min-w-0 flex-1 text-left flex items-center gap-2 ${isItemSelectable(v) ? "" : "cursor-not-allowed"}`}
                                          >
                                            <span className="w-7 shrink-0 text-[8px] font-black text-slate-400 text-center">v{v.import_version}</span>
                                            <SourceProviderIcon provider={source.sync_provider} className="h-3 w-3 shrink-0 text-slate-500" />
                                            <div className="min-w-0 flex-1">
                                              <div className={`text-[10px] truncate ${String(v.sheet_id) === String(selectedSheetId) ? "font-bold text-indigo-700" : "font-bold text-slate-700"}`}>{label}</div>
                                              <div className="text-[8px] text-slate-400">
                                                {v.uploaded_at ? new Date(v.uploaded_at).toLocaleDateString() : ""}
                                                {!isItemSelectable(v) ? ` • ${reasonLabel(v)}` : ""}
                                              </div>
                                            </div>
                                          </button>
                                          {canDeleteRevision ? (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteImportRevision(v);
                                              }}
                                              disabled={deleteImportBusyId === String(importId)}
                                              title="Delete revision"
                                              aria-label="Delete revision"
                                              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 ${deleteImportBusyId === String(importId) ? "opacity-60 cursor-not-allowed" : ""}`}
                                            >
                                              🗑
                                            </button>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-bold text-slate-800 truncate">{label}</div>
                              <div className="text-[9px] text-slate-400 truncate">
                                {latest.uploaded_at ? `Uploaded: ${new Date(latest.uploaded_at).toLocaleDateString()}` : ""}
                              </div>
                            </div>
                            {isSelectedGroup && (
                              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700">Current</span>
                            )}
                            {fileVersionMenuKey === fileKey && embedRevisionMenu ? (
                              <div className="w-full mt-2 rounded-lg border border-slate-200 bg-white shadow-sm py-1">
                                <div className="max-h-56 overflow-auto custom-scrollbar">
                                  {group.map((v) => {
                                    const importStatus = String(v?.status || "").trim().toLowerCase();
                                    const importId = Number.parseInt(String(v?.id || ""), 10);
                                    const canDeleteRevision = canManageImports
                                      && typeof onDeleteImportRevision === "function"
                                      && importStatus !== "published"
                                      && Number.isInteger(importId)
                                      && importId > 0;
                                    return (
                                      <div
                                        key={`embedded-${String(v.sheet_id)}`}
                                        className={`w-full text-left px-2 py-1.5 hover:bg-slate-50 flex items-center gap-2 ${String(v.sheet_id) === String(selectedSheetId) ? "bg-indigo-50/50" : ""} ${isItemSelectable(v) ? "" : "opacity-60"}`}
                                      >
                                        <button
                                          type="button"
                                          disabled={!isItemSelectable(v)}
                                          title={isItemSelectable(v) ? label : reasonLabel(v)}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!isItemSelectable(v)) return;
                                            const sid = String(v.sheet_id || "");
                                            if (sid) onSelectSheet(sid, label);
                                            setFileVersionMenuKey(null);
                                            setIsOpen(false);
                                          }}
                                          className={`min-w-0 flex-1 text-left flex items-center gap-2 ${isItemSelectable(v) ? "" : "cursor-not-allowed"}`}
                                        >
                                          <span className="w-7 shrink-0 text-[8px] font-black text-slate-400 text-center">v{v.import_version}</span>
                                          <SourceProviderIcon provider={source.sync_provider} className="h-3 w-3 shrink-0 text-slate-500" />
                                          <div className="min-w-0 flex-1">
                                            <div className={`text-[10px] truncate ${String(v.sheet_id) === String(selectedSheetId) ? "font-bold text-indigo-700" : "font-bold text-slate-700"}`}>{label}</div>
                                            <div className="text-[8px] text-slate-400">
                                              {v.uploaded_at ? new Date(v.uploaded_at).toLocaleDateString() : ""}
                                              {!isItemSelectable(v) ? ` • ${reasonLabel(v)}` : ""}
                                            </div>
                                          </div>
                                        </button>
                                        {canDeleteRevision ? (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onDeleteImportRevision(v);
                                            }}
                                            disabled={deleteImportBusyId === String(importId)}
                                            title="Delete revision"
                                            aria-label="Delete revision"
                                            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 ${deleteImportBusyId === String(importId) ? "opacity-60 cursor-not-allowed" : ""}`}
                                          >
                                            🗑
                                          </button>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
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
  );
}
