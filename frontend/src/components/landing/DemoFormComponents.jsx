import React, { useState } from "react";
import Icon from "../common/Icon";
import { formLabelClass, formFieldClass, themeTextClass, themeHoverTextClass, formTextareaClass } from "../../utils/theme";

export function DemoInput({ label, value, onChange, placeholder, type = "text", required = false }) {
  return (
    <label className="group block">
      <span className={formLabelClass}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className={formFieldClass}
      />
    </label>
  );
}

export function DemoSelect({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const selected = value || options[0];

  return (
    <div className="group relative">
      <div className={formLabelClass}>{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className={`mt-1 flex h-12 w-full items-center justify-between gap-2 rounded-xl border bg-white px-4 text-left text-sm font-bold shadow-[0_8px_22px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.95)] transition-all ${
          open
            ? "border-[hsl(var(--primary)/0.70)] ring-4 ring-[hsl(var(--primary)/0.10)]"
            : "border-slate-300 hover:border-slate-400 hover:shadow-[0_10px_26px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-slate-900">{selected}</span>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-transform ${open ? `rotate-180 ${themeTextClass}` : ""}`}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 overflow-hidden rounded-xl border border-slate-300 bg-white p-1 shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
          role="listbox"
        >
          {options.map((option) => {
            const active = value === option;
            return (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-black transition-colors ${
                  active ? "bg-[hsl(var(--primary)/0.10)] text-[hsl(var(--primary))]" : `text-slate-700 hover:bg-slate-100 ${themeHoverTextClass}`
                }`}
                role="option"
                aria-selected={active}
              >
                <span>{option}</span>
                {active && <Icon name="check" className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DemoTextarea({ label, value, onChange, placeholder, rows = 3 }) {
  return (
    <label className="group block">
      <span className={formLabelClass}>{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={formTextareaClass}
      />
    </label>
  );
}

export function DemoCheckboxGroup({ label, options, selected, onToggle }) {
  return (
    <fieldset>
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = selected.includes(option);
          return (
            <label
              key={option}
              className={`relative inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black transition-all ${
                checked
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_10px_24px_hsl(var(--primary)/0.22)]"
                  : `border-slate-300 bg-white text-slate-700 shadow-[0_6px_16px_rgba(15,23,42,0.05)] hover:border-[hsl(var(--primary)/0.40)] hover:bg-[hsl(var(--primary)/0.10)] ${themeHoverTextClass}`
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option)}
                className="sr-only"
              />
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                checked ? "border-white/70 bg-white/15 text-white" : "border-slate-300 bg-white text-transparent"
              }`}>
                <Icon name="check" className="h-3 w-3" />
              </span>
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function DemoFormSection({ title, description, children }) {
  return (
    <section className="border-t border-slate-300 py-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
