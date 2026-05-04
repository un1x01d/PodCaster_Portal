import React from "react";
import { Link } from "react-router-dom";
import { themeHoverTextClass } from "../../utils/theme";

export default function Footer() {
  const links = [
    ["Product", "#product"],
    ["Controls", "#controls"],
    ["Sources", "#sources"],
    ["Controlled AI", "#controlled-ai"],
    ["Security", "#security"],
    ["Docs", "#workflow"],
    ["Pricing", "/pricing"],
    ["Contact", "/support"],
  ];

  return (
    <footer className="relative z-20 border-t border-slate-200 bg-white px-5 py-3 text-slate-500 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <Link to="/" className="inline-flex items-center text-slate-900" aria-label="TFORN home">
          <img src="/assets/tform-logo.png" alt="TFORN - Turn Financial Outputs into Real Numbers" className="h-7 w-auto max-w-[150px] object-contain" />
        </Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold" aria-label="Footer navigation">
          {links.map(([label, href]) => (
            href.startsWith("/") ? (
              <Link key={label} to={href} className={themeHoverTextClass}>
                {label}
              </Link>
            ) : (
              <a key={label} href={href} className={themeHoverTextClass}>
                {label}
              </a>
            )
          ))}
        </nav>
      </div>
    </footer>
  );
}
