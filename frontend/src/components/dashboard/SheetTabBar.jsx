import React from "react";

/**
 * SheetTabBar - Excel-style tab bar for switching between tabs within ONE workbook
 * 
 * Props:
 * - tabs: Array of tab names (strings) from the workbook
 * - activeTab: Currently active tab name
 * - onTabClick: Callback when a tab is clicked (receives tab name)
 */
export default function SheetTabBar({ tabs, activeTab, onTabClick }) {
    if (!tabs || tabs.length <= 1) {
        return null; // Don't show tabs if only one or none
    }

    return (
        <div className="flex items-end bg-gradient-to-t from-slate-100 to-slate-50 border-t border-slate-200 px-2 pt-1 pb-0 overflow-x-auto">
            <div className="flex items-end gap-0.5">
                {tabs.map((tabName) => {
                    const isActive = tabName === activeTab;

                    return (
                        <button
                            key={tabName}
                            onClick={() => onTabClick(tabName)}
                            className={`
                                px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-all
                                ${isActive
                                    ? "bg-white text-blue-900 border-slate-300 shadow-sm relative z-10 -mb-px"
                                    : "bg-slate-200/70 text-slate-600 border-transparent hover:bg-slate-200 hover:text-slate-800"
                                }
                            `}
                            title={tabName}
                        >
                            {tabName}
                        </button>
                    );
                })}
            </div>

            {/* Spacer to fill remaining width */}
            <div className="flex-1 border-b border-slate-300 h-[1px] self-end mb-[1px]" />
        </div>
    );
}
