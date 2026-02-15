import React, { useMemo, forwardRef } from "react";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import SheetTabBar from "./SheetTabBar";
import ColumnFilterMenu from "./ColumnFilterMenu";
import { formatSmart, renderMaybeDate } from "../../utils/formatting";

export default function DataGrid({
    sortedData,
    displayHeaders,
    headerRef,
    tableContainerRef,
    filterAnchorRefs,
    filterBtnRefs,
    openFilterCol,
    setOpenFilterCol,
    columnFilters,
    setColumnFilters,
    sortConfig,
    requestSort,
    uniqueValuesByColumn,
    activeFilename,
    tabs,
    activeTab,
    onTabChange,
    openSelect
}) {
    // Calculate min col width
    const minColWidth = 180;
    const totalRowWidth = (displayHeaders?.length || 0) * minColWidth;

    // Memoize InnerElement
    const InnerElement = useMemo(() => forwardRef(({ style, ...rest }, ref) => (
        <div
            ref={ref}
            style={{
                ...style,
                width: totalRowWidth,
                position: 'relative'
            }}
            {...rest}
        />
    )), [totalRowWidth]);

    // OuterElement
    const OuterElement = useMemo(() => forwardRef(({ onScroll, ...rest }, ref) => (
        <div
            ref={ref}
            onScroll={(e) => {
                onScroll(e);
                if (headerRef.current) {
                    headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
            }}
            {...rest}
        />
    )), []);

    return (
        <div className="m-4 bg-white rounded-2xl shadow-2xl border border-gray-200 focus:ring-slate-100 relative z-0 flex-1 flex flex-col min-h-[500px] overflow-hidden">
            {sortedData?.length > 0 ? (
                <>
                    <div className="sticky top-0 bg-slate-50/90 backdrop-blur text-slate-500 font-semibold border-b border-slate-200 z-10 px-4 py-2 text-xs uppercase tracking-wider flex justify-between items-center">
                        {activeFilename ? <span>Loaded: <b className="text-slate-800">{activeFilename}</b></span> : <span>Loaded: <b>Sheet</b></span>}
                    </div>

                    {/* Virtualized Table Container */}
                    <div className="flex-1 w-full flex flex-col min-h-0">

                        {/* Headers Row (Flexible Height) */}
                        <div
                            className="flex bg-slate-100 border-y border-slate-200 shadow-sm z-10 overflow-hidden shrink-0 h-10 items-center"
                            style={{ width: "100%" }}
                            ref={(el) => {
                                if (headerRef) headerRef.current = el;
                                if (el && tableContainerRef?.current) {
                                    tableContainerRef.current.header = el;
                                }
                            }}
                        >
                            {displayHeaders.map((h) => (
                                <div
                                    key={h}
                                    style={{ width: minColWidth, minWidth: minColWidth }}
                                    ref={(el) => {
                                        if (filterAnchorRefs?.current) filterAnchorRefs.current[h] = el;
                                    }}
                                    className="relative border-r border-slate-200 px-3 py-1 text-[11px] text-left cursor-pointer group flex items-center justify-between hover:bg-slate-200 transition-colors bg-slate-100 text-slate-700 font-bold uppercase tracking-wide h-full"
                                    onClick={(e) => {
                                        if (openFilterCol === h) return;
                                        const isFilterBtn = e.target.closest && e.target.closest(".filter-btn");
                                        if (!isFilterBtn) requestSort(h);
                                    }}
                                >
                                    <span className="flex-1 font-semibold whitespace-nowrap leading-tight flex items-center gap-1">
                                        <span>{h}</span>
                                        {sortConfig?.key === h && (
                                            <span className="text-yellow-300 font-bold whitespace-nowrap">
                                                {sortConfig.direction === "asc" ? "▲" : "▼"}
                                            </span>
                                        )}
                                    </span>

                                    <button
                                        type="button"
                                        ref={(el) => {
                                            if (filterBtnRefs?.current) filterBtnRefs.current[h] = el;
                                        }}
                                        className={`filter-btn ml-2 text-[10px] h-6 px-1.5 rounded transition-all ${columnFilters[h] && columnFilters[h] instanceof Set && columnFilters[h].size > 0
                                            ? "bg-blue-100 text-blue-700 ring-2 ring-blue-200 font-bold"
                                            : "bg-slate-200 text-slate-500 hover:bg-slate-300 hover:text-slate-700 group-hover:bg-slate-200"
                                            }`}
                                        title="Filter"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenFilterCol((prev) => (prev === h ? null : h));
                                        }}
                                    >
                                        ▼
                                    </button>

                                    {/* Filter Menu Rendering */}
                                    {openFilterCol === h && (
                                        <ColumnFilterMenu
                                            anchorMapRef={filterBtnRefs}
                                            columnKey={h}
                                            column={h}
                                            allValues={uniqueValuesByColumn[h] || []}
                                            appliedSelected={columnFilters[h] && columnFilters[h] instanceof Set ? columnFilters[h] : null}
                                            onApply={(col, set) => {
                                                setColumnFilters((prev) => {
                                                    const next = { ...prev };
                                                    if (set === null) delete next[col];
                                                    else next[col] = new Set(set);
                                                    return next;
                                                });
                                            }}
                                            onClear={(col) => {
                                                setColumnFilters((prev) => {
                                                    const next = { ...prev };
                                                    delete next[col];
                                                    return next;
                                                });
                                            }}
                                            onClose={() => setOpenFilterCol(null)}
                                            tableContainerRef={{ current: document.body }}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Data List */}
                        <div className="flex-1 min-h-0">
                            <AutoSizer>
                                {({ height, width }) => (
                                    <List
                                        height={height}
                                        itemCount={sortedData.length}
                                        itemSize={36}
                                        width={width}
                                        outerRef={(el) => {
                                            if (tableContainerRef) tableContainerRef.current = el;
                                        }}
                                        innerElementType={InnerElement}
                                        outerElementType={OuterElement}
                                    >
                                        {({ index, style }) => {
                                            const row = sortedData[index];
                                            return (
                                                <div
                                                    style={{ ...style, width: "100%" }}
                                                    className={`flex ${index % 2 === 1 ? "bg-slate-50" : "bg-white"} hover:bg-blue-50/80 transition-colors border-b border-slate-200 items-center h-8`}
                                                >
                                                    {displayHeaders.map((h) => {
                                                        const val = row[h];
                                                        return (
                                                            <div
                                                                key={h}
                                                                style={{ width: minColWidth, minWidth: minColWidth }}
                                                                className="border-r border-slate-200 px-3 text-xs text-slate-700 truncate h-full flex items-center whitespace-nowrap"
                                                                title={String(val)}
                                                            >
                                                                {typeof val === 'number'
                                                                    ? <span className="font-mono text-slate-600">{formatSmart(val, h)}</span>
                                                                    : renderMaybeDate(h, val)
                                                                }
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        }}
                                    </List>
                                )}
                            </AutoSizer>
                        </div>
                    </div>

                    {/* Excel-style Tab Bar */}
                    {tabs && tabs.length > 1 && (
                        <SheetTabBar
                            tabs={tabs}
                            activeTab={activeTab}
                            onTabClick={onTabChange}
                        />
                    )}
                </>
            ) : (
                <div className="text-gray-600 text-center py-10 flex flex-col items-center gap-4">
                    <p>No data loaded.</p>
                    <button
                        onClick={openSelect}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow text-sm font-semibold"
                    >
                        Select Sheet
                    </button>
                </div>
            )}
        </div>
    );
}
