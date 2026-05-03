import React from "react";

export default function StorageOptionCard({
  title,
  logoUrl = "",
  logoAlt = "",
  summary,
  configured,
  tested,
  open,
  onToggleOpen,
  enabled,
  form,
  meta,
  fields,
  onChange,
  onSave,
  onTest,
  saving,
  saved,
  testing,
  saveLabel = "Save",
  testLabel = "Test Connection",
  helpLinks = [],
  enterpriseOnly = false,
}) {
  const borderClass = enabled && tested ? "border-emerald-400" : "border-slate-200";
  const statusText = enabled ? "Enabled" : "Disabled";
  const statusClass = enabled ? "text-emerald-600" : "text-slate-400";
  const testText = tested ? "Tested" : "Not tested";

  return (
    <div className={`rounded-md border bg-white p-3 space-y-2 ${borderClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={logoAlt || `${title} logo`}
              className="h-4 w-4 rounded-sm object-contain bg-white"
              loading="lazy"
            />
          ) : null}
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
          <span className={`text-[10px] font-semibold ${statusClass}`}>{statusText}</span>
          {tested && <span className="text-[10px] font-semibold text-emerald-600">{testText}</span>}
          {enterpriseOnly && <span className="text-[10px] font-semibold text-amber-700">Enterprise only</span>}
          {!tested && configured && <span className="text-[10px] font-semibold text-slate-500">Configured</span>}
        </div>
        <button type="button" className="text-[10px] font-semibold text-slate-600 hover:text-slate-900" onClick={onToggleOpen}>
          {open ? "Collapse" : "Expand"}
        </button>
      </div>

      {!open && summary && <div className="text-[10px] text-slate-500">{summary}</div>}

      {open && (
        <>
          <div className="grid grid-cols-1 gap-2">
            {fields.map((field) => {
              const visible = typeof field.showWhen === "function" ? field.showWhen(form, meta) : true;
              if (!visible) return null;
              if (field.type === "checkbox") {
                return (
                  <label key={field.name} className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
                    <input
                      type="checkbox"
                      checked={!!form[field.name]}
                      disabled={!!field.disabled}
                      onChange={(e) => onChange(field.name, e.target.checked, field)}
                    />
                    {field.label}
                  </label>
                );
              }

              const commonProps = {
                className: "input-premium py-1.5 text-[11px] font-semibold",
                placeholder: field.placeholder || "",
                value: form[field.name] ?? "",
                disabled: !!field.disabled,
                onChange: (e) => onChange(field.name, e.target.value, field),
              };
              const label = field.label ? <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{field.label}</div> : null;
              const secretPlaceholder = field.secret && meta?.[field.metaKey] ? "***" : (field.placeholder || "");
              const control = field.type === "textarea" ? (
                <textarea
                  {...commonProps}
                  placeholder={secretPlaceholder}
                  rows={field.rows || 4}
                />
              ) : field.type === "select" ? (
                <select {...commonProps}>
                  {(field.options || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  {...commonProps}
                  type={field.type || (field.secret ? "password" : "text")}
                  placeholder={secretPlaceholder}
                />
              );
              return (
                <div key={field.name} className="space-y-1">
                  {label}
                  {control}
                  {field.help && <div className="text-[10px] text-slate-500">{field.help}</div>}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className={`btn-premium text-white w-full py-2 ${saved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${saving ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              {saving ? "Saving..." : saved ? "Saved" : saveLabel}
            </button>
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              className={`btn-premium bg-indigo-600 text-white w-full py-2 ${testing ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              {testing ? "Testing..." : testLabel}
            </button>
          </div>

          {helpLinks.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600 space-y-1">
              <div className="font-semibold text-slate-700">Setup help</div>
              {helpLinks.map((item) => (
                <a key={item.href} className="block text-blue-700 hover:underline" href={item.href} target="_blank" rel="noreferrer">
                  {item.label}
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
