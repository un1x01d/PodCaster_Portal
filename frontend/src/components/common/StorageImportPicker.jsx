import React from "react";
import SearchableSelect from "./SearchableSelect";
import SourceProviderIcon from "./SourceProviderIcon";

export default function StorageImportPicker({
  open = false,
  title = "",
  subtitle = "",
  provider = "",
  breadcrumbs = [],
  entries = [],
  loading = false,
  selectedEntry = null,
  onNavigate = () => {},
  onSelect = () => {},
  onClose = () => {},
  reportSourceOptions = [],
  selectedReportSourceId = "",
  onChangeReportSourceId = () => {},
  labelOptions = [],
  fileLabel = "",
  onChangeFileLabel = () => {},
  isNewLabel = false,
  onChangeIsNewLabel = () => {},
  autosyncEnabled = false,
  onChangeAutosyncEnabled = () => {},
  onImport = () => {},
  emptyMessage = "No supported files in this folder.",
  selectLabelPlaceholder = "Select Label",
  buttonLabel = "Import selected file",
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SourceProviderIcon provider={provider} className="h-4 w-4 shrink-0" />
              <h3 className="truncate text-sm font-semibold text-slate-900">{title}</h3>
            </div>
            <p className="text-[11px] font-medium text-slate-500">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Close
          </button>
        </div>

        <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-1.5">
            {breadcrumbs.map((crumb, idx) => (
              <button
                key={`${crumb.path || crumb.id || crumb.name || "crumb"}-${idx}`}
                type="button"
                className={`rounded px-1.5 py-0.5 font-semibold ${idx === breadcrumbs.length - 1 ? "bg-slate-200 text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                onClick={() => onNavigate(idx)}
              >
                {crumb.name}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[380px] overflow-y-auto p-2">
          {loading ? (
            <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">Loading…</div>
          ) : entries.length ? (
            <div className="space-y-1">
              {entries.map((entry) => {
                const isFolder = !!entry.isFolder;
                const selected = selectedEntry?.id && selectedEntry.id === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onSelect(entry)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left ${selected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                  >
                    <span className="truncate text-sm font-medium text-slate-800">
                      {isFolder ? "📁 " : "📄 "}
                      {entry.name || "Unnamed"}
                    </span>
                    <span className="ml-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {isFolder ? "Folder" : "File"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">{emptyMessage}</div>
          )}
        </div>

        <div className="p-4 space-y-3">
          <SearchableSelect
            options={reportSourceOptions}
            value={selectedReportSourceId}
            onChange={onChangeReportSourceId}
            placeholder="Report source (optional)"
            className="w-full border border-slate-300 rounded-md text-xs"
            panelWidth="100%"
          />
          {selectedReportSourceId && labelOptions.length > 1 && (
            <SearchableSelect
              options={labelOptions}
              value={isNewLabel ? "__NEW__" : fileLabel}
              onChange={(e) => {
                if (e.target.value === "__NEW__") {
                  onChangeIsNewLabel(true);
                  onChangeFileLabel("");
                } else {
                  onChangeIsNewLabel(false);
                  onChangeFileLabel(e.target.value);
                }
              }}
              placeholder={selectLabelPlaceholder}
              className="w-full border border-slate-300 rounded-md text-xs"
              panelWidth="100%"
            />
          )}
          {(!selectedReportSourceId || isNewLabel || labelOptions.length <= 1) && (
            <input
              type="text"
              value={fileLabel}
              onChange={(e) => onChangeFileLabel(e.target.value.replace(/\s+/g, "_"))}
              placeholder="Label (required)"
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-slate-400 outline-none"
              maxLength={120}
            />
          )}
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={autosyncEnabled}
              onChange={(e) => onChangeAutosyncEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-slate-800 focus:ring-slate-500"
            />
            Auto-sync this source when the file changes
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedEntry || !fileLabel.trim()}
            onClick={() => onImport(selectedEntry)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedEntry || !fileLabel.trim() ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
            title={
              (!fileLabel.trim())
                ? "Enter a label"
                : !selectedEntry
                  ? "Select a file"
                  : buttonLabel
            }
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
