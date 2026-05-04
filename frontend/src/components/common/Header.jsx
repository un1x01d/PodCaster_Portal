import React from "react";
import { Link } from "react-router-dom";
import { themeHoverTextClass, primaryActionClass } from "../../utils/theme";

export default function Header({ user = null }) {
  const navItems = [
    ["Product", "/#product"],
    ["Workflow", "/#workflow"],
    ["Controls", "/#controls"],
    ["Controlled AI", "/#controlled-ai"],
    ["Sources", "/#sources"],
    ["Pricing", "/pricing"],
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5 py-2 md:px-8 lg:min-h-[7rem]">
        <Link to="/" className="flex min-w-0 items-center" aria-label="TFORN home">
          <img
            src="/assets/tform-logo.png"
            alt="TFORN - Turn Financial Outputs into Real Numbers"
            className="h-14 w-auto max-w-[230px] object-contain sm:h-16 sm:max-w-[300px] lg:h-[104px] lg:max-w-[520px]"
          />
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-bold text-slate-600 lg:flex" aria-label="Primary navigation">
          {navItems.map(([label, href]) => (
            <Link key={label} to={href} className={themeHoverTextClass}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link to={user ? "/workspace" : "/login"} className={`hidden rounded-lg px-3 py-2 text-sm font-bold text-slate-700 ${themeHoverTextClass} sm:inline-flex`}>
            {user ? "Workspace" : "Sign in"}
          </Link>
          <Link
            to="/demo"
            className={`${primaryActionClass} h-10 px-4`}
          >
            Book demo
          </Link>
        </div>
      </div>
    </header>
  );
}
