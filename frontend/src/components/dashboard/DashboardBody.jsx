import React, { useState, useRef, useMemo, forwardRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import axios from "axios";

import SearchableSelect from "../common/SearchableSelect";
import MultiSelect from "../common/MultiSelect";
import ColumnFilterMenu from "./ColumnFilterMenu";
import SheetTabBar from "./SheetTabBar";
import PivotOverlay from "./PivotOverlay";
import TrendsOverlay from "./TrendsOverlay";
import TwoConditionOverlay from "./TwoConditionOverlay";
import EbitdaMenu from "./EbitdaMenu";
import InsightFeed from "./InsightFeed";
import SourceProviderIcon from "../common/SourceProviderIcon";
import StorageImportPicker from "../common/StorageImportPicker";
import { DASHBOARD_COPY_EN } from "../../hooks/useDashboardI18n";

import { renderMaybeDate, formatSmart } from "../../utils/formatting";

export default function DashboardBody(props) {
    const navigate = useNavigate();
    const {
        user,
        token,
        API,
        sheetId,
        setSheetId,
        file,
        setFile,
        selectedFileName,
        setSelectedFileName,
        fileLabel,
        setFileLabel,
        reportSourceName = "",
        setReportSourceName = () => {},
        reportSources = [],
        reportSourceImports = {},
        uploadInProgress = false,
        uploadPercent = 0,

        handleUpload,
        handleGoogleDriveImport,
        handleGoogleConnect,
        handleDropboxImport,
        handleDropboxConnect,
        dropboxEnabled,
        handleOneDriveImport,
        handleOneDriveConnect,
        oneDriveEnabled,
        sftpStorageEnabled,
        gcsStorageEnabled,
        s3StorageEnabled,
        azureBlobStorageEnabled,
        loadData,
        refreshReportSources = () => {},
        selectedViewId,
        setSelectedViewId,
        views,
        setViews,
        setPendingViewName,
        setShowColumnSelector,
        setVisibleColumns,
        setSaveViewConfigOverride,

        // Data & State
        sortedData,
        displayHeaders,

        // Filters & Sort
        openFilterCol,
        setOpenFilterCol,
        columnFilters,
        setColumnFilters,
        sortConfig,
        requestSort,
        uniqueValuesByColumn,

        // Charts / Pivot State
        pivotOn, setPivotOn,
        pivotRowKey, setPivotRowKey,
        pivotColKey, setPivotColKey,
        pivotValKey, setPivotValKey,
        pivotAgg, setPivotAgg,
        pivotRows,
        pivotHeaders,
        pieData,
        resetPivot,

        // Two-Condition State
        twoOn, setTwoOn,
        condCol1, setCondCol1,
        condCol2, setCondCol2,
        valueCol, setValueCol,
        summaryData,

        // Trends State
        trendsOn, setTrendsOn,
        trendsDateKey, setTrendsDateKey,
        trendsValueKey, setTrendsValueKey,
        trendGranularity, setTrendGranularity,
        // yearsBack, setYearsBack, // unused?
        trendsData,
        trendYearOptions,
        compareYears, setCompareYears,

        // Actions
        exportCSV,
        exportXLSX,
        exportPDF,

        // Refs
        tableContainerRef,
        filterAnchorRefs,
        filterBtnRefs,

        // Tab support
        tabs,
        setTabs,
        activeTab,
        onTabChange = () => {},
        tabListCacheRef = { current: {} },

        // Calcs
        appendCalculatedColumn,

        // Actions
        onDeleteSheet
        ,
        onInsightApplyFilter,
        onInsightOpenChart,
        onInsightSaveView,
        fetchUniqueValues,
        onLoadMore,
        isBatchLoading,
        secondaryData,
        secondaryHeaders,
        secondarySortConfig,
        secondaryIsBatchLoading,
        onLoadMoreSecondary,
        secondarySheetId,
        setSecondarySheetId,
        secondaryTab,
        setSecondaryTab,
        workspaceChartStateRef,
        locale = "en",
        copy = DASHBOARD_COPY_EN,
    } = props;

    const headerRef = useRef(null);
    const secondaryHeaderRef = useRef(null);
    const workspaceChartTouchedRef = useRef(false);
    const chartStateRef = useRef({});

    useEffect(() => {
        chartStateRef.current = {
            pivotOn,
            pivotRowKey,
            pivotColKey,
            pivotValKey,
            pivotAgg,
            twoOn,
            condCol1,
            condCol2,
            valueCol,
            trendsOn,
            trendsDateKey,
            trendsValueKey,
            trendGranularity,
            compareYears,
        };
    }, [
        pivotOn,
        pivotRowKey,
        pivotColKey,
        pivotValKey,
        pivotAgg,
        twoOn,
        condCol1,
        condCol2,
        valueCol,
        trendsOn,
        trendsDateKey,
        trendsValueKey,
        trendGranularity,
        compareYears,
    ]);

    useEffect(() => {
        const saved = workspaceChartStateRef?.current;
        if (saved) {
            workspaceChartTouchedRef.current = !!(saved.pivotOn || saved.twoOn || saved.trendsOn);
            setPivotOn(!!saved.pivotOn);
            setPivotRowKey(saved.pivotRowKey || "");
            setPivotColKey(saved.pivotColKey || "");
            setPivotValKey(saved.pivotValKey || "");
            setPivotAgg(saved.pivotAgg || "sum");
            setTwoOn(!!saved.twoOn);
            setCondCol1(saved.condCol1 || "");
            setCondCol2(saved.condCol2 || "");
            setValueCol(saved.valueCol || "");
            setTrendsOn(!!saved.trendsOn);
            setTrendsDateKey(saved.trendsDateKey || "");
            setTrendsValueKey(saved.trendsValueKey || "");
            setTrendGranularity(saved.trendGranularity || "month");
            setCompareYears(Array.isArray(saved.compareYears) ? saved.compareYears : []);
        } else {
            setPivotOn(false);
            setTwoOn(false);
            setTrendsOn(false);
        }

        return () => {
            if (workspaceChartStateRef) {
                workspaceChartStateRef.current = chartStateRef.current;
            }
        };
    }, []);

    useEffect(() => {
        if (workspaceChartTouchedRef.current) return;
        if (!pivotOn && !twoOn && !trendsOn) return;
        setPivotOn(false);
        setTwoOn(false);
        setTrendsOn(false);
    }, [pivotOn, twoOn, trendsOn, setPivotOn, setTwoOn, setTrendsOn]);

    const markWorkspaceChartTouched = React.useCallback(() => {
        workspaceChartTouchedRef.current = true;
    }, []);

    const setWorkspacePivotOn = React.useCallback((next) => {
        markWorkspaceChartTouched();
        setPivotOn(next);
    }, [markWorkspaceChartTouched, setPivotOn]);

    const setWorkspaceTwoOn = React.useCallback((next) => {
        markWorkspaceChartTouched();
        setTwoOn(next);
    }, [markWorkspaceChartTouched, setTwoOn]);

    const setWorkspaceTrendsOn = React.useCallback((next) => {
        markWorkspaceChartTouched();
        setTrendsOn(next);
    }, [markWorkspaceChartTouched, setTrendsOn]);

    const openWorkspaceInsightChart = React.useCallback((config) => {
        markWorkspaceChartTouched();
        onInsightOpenChart?.(config);
    }, [markWorkspaceChartTouched, onInsightOpenChart]);

    // Sync header scroll with horizontal data scroll
    const handlePrimaryScroll = ({ scrollTop }) => {
        if (comparisonOn && secondaryListRef.current) {
            // Only sync if the position is significantly different to avoid loops
            const currentSecondary = secondaryListRef.current.state?.scrollOffset || 0;
            if (Math.abs(currentSecondary - scrollTop) > 1) {
                secondaryListRef.current.scrollTo(scrollTop);
            }
        }
    };

    const handleSecondaryScroll = ({ scrollTop }) => {
        if (comparisonOn && primaryListRef.current) {
            const currentPrimary = primaryListRef.current.state?.scrollOffset || 0;
            if (Math.abs(currentPrimary - scrollTop) > 1) {
                primaryListRef.current.scrollTo(scrollTop);
            }
        }
    };

    // Detect near-end of scroll for infinite loading
    const handleItemsRendered = ({ visibleStopIndex }) => {
        if (visibleStopIndex >= sortedData.length - 15 && onLoadMore && !isBatchLoading) {
            onLoadMore();
        }
    };

    const handleSecondaryItemsRendered = ({ visibleStopIndex }) => {
        if (visibleStopIndex >= filteredSecondaryData.length - 15 && onLoadMoreSecondary && !secondaryIsBatchLoading) {
            onLoadMoreSecondary(secondaryColumnFilters);
        }
    };

    const [selectedReportSourceId, setSelectedReportSourceId] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);
    const [expandedMenus, setExpandedMenus] = useState({
        view: true,
        data: false,
        insights: false,
        charts: false,
        export: false,
        admin: false
    });
    const [insightsOn, setInsightsOn] = useState(false);
    const [selectionModeOn, setSelectionModeOn] = useState(false);
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionAnchor, setSelectionAnchor] = useState(null);
    const [selectionFocus, setSelectionFocus] = useState(null);
    const [selectedRowIndexes, setSelectedRowIndexes] = useState(() => new Set());
    const [selectedColIndexes, setSelectedColIndexes] = useState(() => new Set());
    const [lastRowSelectionIndex, setLastRowSelectionIndex] = useState(null);
    const [lastColSelectionIndex, setLastColSelectionIndex] = useState(null);
    const [secondarySelectedRowIndexes, setSecondarySelectedRowIndexes] = useState(() => new Set());
    const [secondarySelectedColIndexes, setSecondarySelectedColIndexes] = useState(() => new Set());
    const [secondaryLastRowSelectionIndex, setSecondaryLastRowSelectionIndex] = useState(null);
    const [secondaryLastColSelectionIndex, setSecondaryLastColSelectionIndex] = useState(null);
    const isSelectingRef = useRef(false);
    const secondaryIsSelectingRef = useRef(false);
    const secondaryDragAnchorRef = useRef(null);
    const selectionFocusRef = useRef(null);
    const pendingSelectionFocusRef = useRef(null);
    const selectionFocusRafRef = useRef(null);
    const dragPointerRef = useRef(null);
    const dragAutoScrollRafRef = useRef(null);

    // Comparison View State
    const [comparisonOn, setComparisonOn] = useState(false);
    const [splitWidth, setSplitWidth] = useState(50); // percentage
    const [splitDragging, setSplitDragging] = useState(false);
    const [liveSplitWidth, setLiveSplitWidth] = useState(null);
    const isResizingRef = useRef(false);
    const [secondaryColumnFilters, setSecondaryColumnFilters] = useState({});

    const [primaryFields, setPrimaryFields] = useState([]);
    const [secondaryFields, setSecondaryFields] = useState([]);

    const activePrimaryFields = primaryFields.length > 0 ? primaryFields : (displayHeaders || []);
    const activeSecondaryFields = secondaryFields.length > 0 ? secondaryFields : (secondaryHeaders || []);
    const primaryFieldsMenuWidthCh = useMemo(() => {
        const maxLen = (Array.isArray(displayHeaders) ? displayHeaders : []).reduce((m, h) => Math.max(m, String(h || "").length), 0);
        return Math.min(24, Math.max(14, maxLen + 5));
    }, [displayHeaders]);
    const secondaryFieldsMenuWidthCh = useMemo(() => {
        const maxLen = (Array.isArray(secondaryHeaders) ? secondaryHeaders : []).reduce((m, h) => Math.max(m, String(h || "").length), 0);
        return Math.min(24, Math.max(14, maxLen + 5));
    }, [secondaryHeaders]);

    // Reset fields when headers change
    useEffect(() => {
        if (displayHeaders?.length) {
            setPrimaryFields(displayHeaders);
        }
    }, [displayHeaders]);

    useEffect(() => {
        if (secondaryHeaders?.length) {
            setSecondaryFields(secondaryHeaders);
        }
    }, [secondaryHeaders]);

    useEffect(() => {
        setSecondaryColumnFilters({});
        setOpenFilterCol((prev) => (String(prev || "").startsWith("sec_") ? null : prev));
    }, [secondarySheetId, secondaryTab, setOpenFilterCol]);

    const primaryGridRef = useRef(null);
    const secondaryGridRef = useRef(null);
    const primaryListRef = useRef(null);
    const primaryOuterRef = useRef(null);
    const secondaryListRef = useRef(null);
    const primaryFieldsRef = useRef([]);
    const secondaryFieldsRef = useRef([]);
    const colWidthsRef = useRef({});
    const splitSnap = useRef({
        getSnappedPct: (containerWidth, targetPx) => {
            const minPx = containerWidth * 0.15;
            const maxPx = containerWidth * 0.85;
            const clamped = Math.max(minPx, Math.min(maxPx, targetPx));
            const primaryPoints = [];
            let running = 0;
            (primaryFieldsRef.current || []).forEach((h) => {
                running += (colWidthsRef.current?.[h] || 180);
                if (running >= minPx && running <= maxPx) primaryPoints.push(running);
            });
            if (!primaryPoints.length) return (clamped / containerWidth) * 100;
            const snappedPx = primaryPoints.reduce((best, p) => (
                Math.abs(p - clamped) < Math.abs(best - clamped) ? p : best
            ), primaryPoints[0]);
            return (snappedPx / containerWidth) * 100;
        }
    });

    const handleMouseDown = (e) => {
        isResizingRef.current = true;
        setSplitDragging(true);
        setLiveSplitWidth(splitWidth);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        // Add a global class to disable pointer events on all IFrames/Grids
        document.body.classList.add('resizing-active');
    };

    useEffect(() => {
        let animationFrameId;
        
        const handleMouseMove = (e) => {
            if (!isResizingRef.current) return;
            
            // Throttle to screen refresh rate for maximum smoothness
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            
            animationFrameId = requestAnimationFrame(() => {
                const container = document.getElementById('split-container');
                if (!container || !primaryGridRef.current || !secondaryGridRef.current) return;
                
                const containerRect = container.getBoundingClientRect();
                const containerWidth = containerRect.width || 0;
                if (containerWidth <= 0) return;
                const splitterHalf = 0.75;
                const rawPx = (e.clientX - containerRect.left) - splitterHalf;
                const newPct = splitSnap.current.getSnappedPct(containerWidth, rawPx);
                setLiveSplitWidth(newPct);
                
                primaryGridRef.current.style.width = `${newPct}%`;
                secondaryGridRef.current.style.width = `${100 - newPct}%`;
            });
        };
        
        const handleMouseUp = () => {
            if (isResizingRef.current) {
                if (primaryGridRef.current) {
                    const finalPct = parseFloat(primaryGridRef.current.style.width);
                    setSplitWidth(finalPct);
                }
                isResizingRef.current = false;
                setSplitDragging(false);
                setLiveSplitWidth(null);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.body.classList.remove('resizing-active');
            }
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        };
    }, []);

    useEffect(() => {
        primaryFieldsRef.current = activePrimaryFields || [];
    }, [activePrimaryFields]);

    useEffect(() => {
        secondaryFieldsRef.current = activeSecondaryFields || [];
    }, [activeSecondaryFields]);

    const [drivePickerOpen, setDrivePickerOpen] = useState(false);
    const [driveEntries, setDriveEntries] = useState([]);
    const [driveLoading, setDriveLoading] = useState(false);
    const [driveBreadcrumbs, setDriveBreadcrumbs] = useState([{ id: "root", name: "My Drive" }]);
    const [selectedDriveFile, setSelectedDriveFile] = useState(null);
    const [dropboxPickerOpen, setDropboxPickerOpen] = useState(false);
    const [dropboxEntries, setDropboxEntries] = useState([]);
    const [dropboxLoading, setDropboxLoading] = useState(false);
    const [dropboxBreadcrumbs, setDropboxBreadcrumbs] = useState([{ path: "", name: "Dropbox" }]);
    const [selectedDropboxFile, setSelectedDropboxFile] = useState(null);
    const [oneDrivePickerOpen, setOneDrivePickerOpen] = useState(false);
    const [oneDriveEntries, setOneDriveEntries] = useState([]);
    const [oneDriveLoading, setOneDriveLoading] = useState(false);
    const [oneDriveBreadcrumbs, setOneDriveBreadcrumbs] = useState([{ id: "root", name: "OneDrive" }]);
    const [selectedOneDriveFile, setSelectedOneDriveFile] = useState(null);
    const [isNewLabel, setIsNewLabel] = useState(false);
    const [autosyncEnabled, setAutosyncEnabled] = useState(false);
    const [autosyncToggleBusyId, setAutosyncToggleBusyId] = useState("");
    const [storagePickers, setStoragePickers] = useState({
        sftp_storage: {
            open: false,
            entries: [],
            loading: false,
            breadcrumbs: [{ path: "", name: "SFTP" }],
            selected: null,
            selectedReportSourceId: "",
            fileLabel: "",
            isNewLabel: false,
            autosyncEnabled: false,
        },
        gcs_storage: {
            open: false,
            entries: [],
            loading: false,
            breadcrumbs: [{ path: "", name: "Google Cloud Storage" }],
            selected: null,
            selectedReportSourceId: "",
            fileLabel: "",
            isNewLabel: false,
            autosyncEnabled: false,
        },
        s3_storage: {
            open: false,
            entries: [],
            loading: false,
            breadcrumbs: [{ path: "", name: "Amazon S3" }],
            selected: null,
            selectedReportSourceId: "",
            fileLabel: "",
            isNewLabel: false,
            autosyncEnabled: false,
        },
        azure_blob_storage: {
            open: false,
            entries: [],
            loading: false,
            breadcrumbs: [{ path: "", name: "Azure Blob Storage" }],
            selected: null,
            selectedReportSourceId: "",
            fileLabel: "",
            isNewLabel: false,
            autosyncEnabled: false,
        },
    });

    const storageProviderMeta = React.useMemo(() => ({
        sftp_storage: { label: "SFTP", title: "Import from SFTP", rootName: "SFTP" },
        gcs_storage: { label: "Google Cloud Storage", title: "Import from Google Cloud Storage", rootName: "Google Cloud Storage" },
        s3_storage: { label: "Amazon S3", title: "Import from Amazon S3", rootName: "Amazon S3" },
        azure_blob_storage: { label: "Azure Blob Storage", title: "Import from Azure Blob Storage", rootName: "Azure Blob Storage" },
    }), []);

    const anyStoragePickerOpen = useMemo(() => Object.values(storagePickers).some((picker) => picker.open), [storagePickers]);

    useEffect(() => {
        if (!drivePickerOpen && !dropboxPickerOpen && !oneDrivePickerOpen && !anyStoragePickerOpen) {
            setAutosyncEnabled(false);
            return;
        }
        const selectedSource = (reportSources || []).find((source) => String(source.id || "") === String(selectedReportSourceId || ""));
        setAutosyncEnabled(!!selectedSource?.sync_enabled);
    }, [drivePickerOpen, dropboxPickerOpen, oneDrivePickerOpen, anyStoragePickerOpen, reportSources, selectedReportSourceId]);

    const toggleReportSourceAutosync = React.useCallback(async (sourceId, nextEnabled) => {
        const id = String(sourceId || "");
        if (!id || autosyncToggleBusyId) return;
        setAutosyncToggleBusyId(id);
        try {
            await axios.patch(`${API}/report-sources/${id}/autosync`, { enabled: !!nextEnabled }, {
                headers: { Authorization: `Bearer ${token}` },
            });
            await refreshReportSources();
        } catch (e) {
            alert(e?.response?.data?.error || "Failed to update autosync setting");
        } finally {
            setAutosyncToggleBusyId("");
        }
    }, [API, token, autosyncToggleBusyId, refreshReportSources]);

    const toggleMenu = (key) => {
        setExpandedMenus((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const setStoragePicker = React.useCallback((provider, patch) => {
        setStoragePickers((prev) => ({
            ...prev,
            [provider]: {
                ...prev[provider],
                ...patch,
            },
        }));
    }, []);

    const resetStoragePicker = React.useCallback((provider, rootName) => {
        setStoragePickers((prev) => ({
            ...prev,
            [provider]: {
                open: false,
                entries: [],
                loading: false,
                breadcrumbs: [{ path: "", name: rootName }],
                selected: null,
                selectedReportSourceId: "",
                fileLabel: "",
                isNewLabel: false,
                autosyncEnabled: false,
            },
        }));
    }, []);

    const fetchStorageEntries = React.useCallback(async (provider, nextPath = "", nextBreadcrumbs = null) => {
        const meta = storageProviderMeta[provider];
        if (!meta) return;
        setStoragePicker(provider, { loading: true });
        try {
            const res = await axios.get(`${API}/storage/${provider}/files`, {
                params: nextPath ? { path: nextPath } : undefined,
                headers: { Authorization: `Bearer ${token}` },
            });
            const normalized = Array.isArray(res?.data?.entries)
                ? res.data.entries.map((entry) => ({
                    ...entry,
                    id: String(entry?.id || entry?.path || ""),
                    name: String(entry?.name || ""),
                    path: String(entry?.path || entry?.id || ""),
                    isFolder: !!entry?.isFolder,
                    size: Number(entry?.size || 0),
                    updatedAt: entry?.updatedAt || null,
                })).filter((entry) => entry.id)
                : [];
            setStoragePicker(provider, {
                entries: normalized,
                breadcrumbs: Array.isArray(nextBreadcrumbs) && nextBreadcrumbs.length ? nextBreadcrumbs : [{ path: "", name: meta.rootName }],
                loading: false,
            });
        } catch (e) {
            console.error(`Fetch ${meta.label} entries failed:`, e);
            alert(e?.response?.data?.error || `Failed to fetch ${meta.label} files`);
            setStoragePicker(provider, { loading: false });
        }
    }, [API, token, setStoragePicker, storageProviderMeta]);

    const openStoragePicker = React.useCallback((provider) => {
        const meta = storageProviderMeta[provider];
        if (!meta) return;
        setStoragePicker(provider, {
            open: true,
            selected: null,
            selectedReportSourceId: "",
            fileLabel: "",
            isNewLabel: false,
            autosyncEnabled: false,
            breadcrumbs: [{ path: "", name: meta.rootName }],
        });
        fetchStorageEntries(provider, "", [{ path: "", name: meta.rootName }]);
    }, [fetchStorageEntries, setStoragePicker, storageProviderMeta]);

    const closeStoragePicker = React.useCallback((provider) => {
        const meta = storageProviderMeta[provider];
        if (!meta) return;
        resetStoragePicker(provider, meta.rootName);
    }, [resetStoragePicker, storageProviderMeta]);

    const navigateStoragePicker = React.useCallback((provider, index) => {
        const picker = storagePickers[provider];
        const meta = storageProviderMeta[provider];
        if (!picker || !meta) return;
        const nextBreadcrumbs = picker.breadcrumbs.slice(0, index + 1);
        const target = nextBreadcrumbs[nextBreadcrumbs.length - 1];
        setStoragePicker(provider, { selected: null });
        fetchStorageEntries(provider, target?.path || "", nextBreadcrumbs);
    }, [fetchStorageEntries, setStoragePicker, storagePickers, storageProviderMeta]);

    const handleStorageEntrySelect = React.useCallback((provider, entry) => {
        const picker = storagePickers[provider];
        const meta = storageProviderMeta[provider];
        if (!picker || !meta) return;
        if (entry?.isFolder) {
            const nextBreadcrumbs = (picker.breadcrumbs || []).concat([{ path: entry.path || "", name: entry.name || "Folder" }]);
            setStoragePicker(provider, { selected: null });
            fetchStorageEntries(provider, entry.path || "", nextBreadcrumbs);
            return;
        }
        setStoragePicker(provider, { selected: entry });
    }, [fetchStorageEntries, setStoragePicker, storagePickers, storageProviderMeta]);

    const handleStorageImport = React.useCallback(async (provider, selectedEntry) => {
        const picker = storagePickers[provider];
        const meta = storageProviderMeta[provider];
        if (!picker || !meta || !selectedEntry || !String(picker.fileLabel || "").trim()) return;
        try {
            const res = await axios.post(
                `${API}/storage/${provider}/import`,
                {
                    sourceRef: selectedEntry.path || selectedEntry.id,
                    name: selectedEntry.name,
                    display_name: String(picker.fileLabel).trim(),
                    file_label: String(picker.fileLabel).trim(),
                    autosync_enabled: picker.autosyncEnabled ? "1" : "0",
                    ...(picker.selectedReportSourceId ? { report_source_id: picker.selectedReportSourceId } : { report_source_name: String(picker.fileLabel).trim() }),
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (res.data?.status === "queued") {
                alert(`${meta.label} import queued for processing.`);
                refreshReportSources();
                closeStoragePicker(provider);
                return;
            }
            if (res.data?.status === "pending_approval") {
                alert(`Imported from ${meta.label} and waiting for approval.`);
                refreshReportSources();
                closeStoragePicker(provider);
                return;
            }
            alert(`Imported from ${meta.label}!`);
            if (res.data?.sheetId) {
                setSheetId(res.data.sheetId);
                const activeName = res.data.display_name || res.data.filename;
                setSelectedFileName(activeName);
                localStorage.setItem("activeFilename", activeName);
                if (res.data.tabs && res.data.tabs.length > 0) {
                    tabListCacheRef.current[String(res.data.sheetId)] = res.data.tabs;
                    setTabs(res.data.tabs);
                    onTabChange(res.data.tabs[0]);
                    localStorage.setItem("activeTab", res.data.tabs[0]);
                }
                loadData(res.data.sheetId);
                refreshReportSources();
            }
        } catch (e) {
            console.error(e);
            alert(e?.response?.data?.error || `${meta.label} import failed`);
        } finally {
            closeStoragePicker(provider);
        }
    }, [closeStoragePicker, loadData, onTabChange, refreshReportSources, setSelectedFileName, setSheetId, setTabs, storagePickers, storageProviderMeta, tabListCacheRef]);

    const activeView = views.find((v) => String(v.id) === String(selectedViewId));

    const clearSelection = React.useCallback(() => {
        setSelectionAnchor(null);
        setSelectionFocus(null);
        selectionFocusRef.current = null;
        pendingSelectionFocusRef.current = null;
        if (selectionFocusRafRef.current) {
            cancelAnimationFrame(selectionFocusRafRef.current);
            selectionFocusRafRef.current = null;
        }
        if (dragAutoScrollRafRef.current) {
            cancelAnimationFrame(dragAutoScrollRafRef.current);
            dragAutoScrollRafRef.current = null;
        }
        setIsSelecting(false);
        isSelectingRef.current = false;
        dragPointerRef.current = null;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        setSelectedRowIndexes(new Set());
        setSelectedColIndexes(new Set());
        setLastRowSelectionIndex(null);
        setLastColSelectionIndex(null);
        setSecondarySelectedRowIndexes(new Set());
        setSecondarySelectedColIndexes(new Set());
        setSecondaryLastRowSelectionIndex(null);
        setSecondaryLastColSelectionIndex(null);
    }, []);

    const clearExplicitSelections = React.useCallback(() => {
        setSelectedRowIndexes(new Set());
        setSelectedColIndexes(new Set());
        setLastRowSelectionIndex(null);
        setLastColSelectionIndex(null);
    }, []);

    useEffect(() => {
        const stopSelecting = () => {
            if (!isSelectingRef.current) return;
            isSelectingRef.current = false;
            setIsSelecting(false);
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
            const pending = pendingSelectionFocusRef.current;
            if (
                pending
                && (!selectionFocusRef.current || pending.row !== selectionFocusRef.current.row || pending.col !== selectionFocusRef.current.col)
            ) {
                selectionFocusRef.current = pending;
                setSelectionFocus(pending);
            }
            if (selectionFocusRafRef.current) {
                cancelAnimationFrame(selectionFocusRafRef.current);
                selectionFocusRafRef.current = null;
            }
            if (dragAutoScrollRafRef.current) {
                cancelAnimationFrame(dragAutoScrollRafRef.current);
                dragAutoScrollRafRef.current = null;
            }
            dragPointerRef.current = null;
        };
        window.addEventListener("mouseup", stopSelecting);
        return () => window.removeEventListener("mouseup", stopSelecting);
    }, []);

    useEffect(() => {
        const stopSecondarySelecting = () => {
            if (!secondaryIsSelectingRef.current) return;
            secondaryIsSelectingRef.current = false;
            if (!isSelectingRef.current) {
                document.body.style.userSelect = "";
                document.body.style.cursor = "";
            }
            secondaryDragAnchorRef.current = null;
        };
        window.addEventListener("mouseup", stopSecondarySelecting);
        return () => window.removeEventListener("mouseup", stopSecondarySelecting);
    }, []);

    useEffect(() => {
        selectionFocusRef.current = selectionFocus;
    }, [selectionFocus]);

    useEffect(() => () => {
        if (selectionFocusRafRef.current) {
            cancelAnimationFrame(selectionFocusRafRef.current);
            selectionFocusRafRef.current = null;
        }
        if (dragAutoScrollRafRef.current) {
            cancelAnimationFrame(dragAutoScrollRafRef.current);
            dragAutoScrollRafRef.current = null;
        }
        dragPointerRef.current = null;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
    }, []);

    const queueSelectionFocusUpdate = React.useCallback((nextFocus) => {
        pendingSelectionFocusRef.current = nextFocus;
        if (selectionFocusRafRef.current) return;
        selectionFocusRafRef.current = requestAnimationFrame(() => {
            selectionFocusRafRef.current = null;
            const pending = pendingSelectionFocusRef.current;
            if (!pending) return;
            const current = selectionFocusRef.current;
            if (current && current.row === pending.row && current.col === pending.col) return;
            selectionFocusRef.current = pending;
            setSelectionFocus(pending);
        });
    }, []);


    const selectionBounds = React.useMemo(() => {
        if (!selectionAnchor || !selectionFocus) return null;
        const rowStart = Math.max(0, Math.min(selectionAnchor.row, selectionFocus.row));
        const rowEnd = Math.min(sortedData.length - 1, Math.max(selectionAnchor.row, selectionFocus.row));
        const colStart = Math.max(0, Math.min(selectionAnchor.col, selectionFocus.col));
        const colEnd = Math.min(activePrimaryFields.length - 1, Math.max(selectionAnchor.col, selectionFocus.col));
        if (rowEnd < rowStart || colEnd < colStart) return null;
        return { rowStart, rowEnd, colStart, colEnd };
    }, [selectionAnchor, selectionFocus, sortedData.length, activePrimaryFields.length]);

    const selectedPrimaryColumns = React.useMemo(() => {
        if (selectedColIndexes.size > 0) {
            return Array.from(selectedColIndexes)
                .sort((a, b) => a - b)
                .map((idx) => activePrimaryFields[idx])
                .filter(Boolean);
        }
        if (!selectionBounds) return [];
        return activePrimaryFields.slice(selectionBounds.colStart, selectionBounds.colEnd + 1);
    }, [selectedColIndexes, selectionBounds, activePrimaryFields]);

    const selectedPrimaryRowIndexes = React.useMemo(() => {
        if (selectedRowIndexes.size > 0) return Array.from(selectedRowIndexes).sort((a, b) => a - b);
        if (!selectionBounds) return [];
        const rows = [];
        for (let i = selectionBounds.rowStart; i <= selectionBounds.rowEnd; i += 1) rows.push(i);
        return rows;
    }, [selectedRowIndexes, selectionBounds]);

    const selectedSecondaryColumns = React.useMemo(() => {
        if (secondarySelectedColIndexes.size > 0) {
            return Array.from(secondarySelectedColIndexes)
                .sort((a, b) => a - b)
                .map((idx) => activeSecondaryFields[idx])
                .filter(Boolean);
        }
        return [];
    }, [secondarySelectedColIndexes, activeSecondaryFields]);

    const selectedSecondaryRowIndexes = React.useMemo(() => {
        if (secondarySelectedRowIndexes.size > 0) return Array.from(secondarySelectedRowIndexes).sort((a, b) => a - b);
        return [];
    }, [secondarySelectedRowIndexes]);

    const buildSelectionFilters = React.useCallback(() => {
        if (selectedPrimaryColumns.length === 0 || selectedPrimaryRowIndexes.length === 0) return null;
        const next = {};
        selectedPrimaryColumns.forEach((col) => {
            next[col] = new Set();
        });
        for (const rowIndex of selectedPrimaryRowIndexes) {
            const row = sortedData[rowIndex] || {};
            selectedPrimaryColumns.forEach((col) => {
                next[col].add(String(row?.[col] ?? ""));
            });
        }
        return next;
    }, [sortedData, selectedPrimaryColumns, selectedPrimaryRowIndexes]);

    const buildSecondarySelectionFilters = React.useCallback(() => {
        if (selectedSecondaryColumns.length === 0 || selectedSecondaryRowIndexes.length === 0) return null;
        const rows = Array.isArray(secondaryData) ? secondaryData : [];
        const activeFilters = Object.entries(secondaryColumnFilters)
            .filter(([, allowed]) => allowed instanceof Set && allowed.size > 0);
        const filteredRows = !activeFilters.length
            ? rows
            : rows.filter((row) => activeFilters.every(([col, allowed]) => (
                allowed.has(String(row?.[col] ?? ""))
            )));
        const next = {};
        selectedSecondaryColumns.forEach((col) => {
            next[col] = new Set();
        });
        for (const rowIndex of selectedSecondaryRowIndexes) {
            const row = filteredRows[rowIndex] || {};
            selectedSecondaryColumns.forEach((col) => {
                next[col].add(String(row?.[col] ?? ""));
            });
        }
        return next;
    }, [secondaryData, secondaryColumnFilters, selectedSecondaryColumns, selectedSecondaryRowIndexes]);

    const isPrimaryCellSelected = React.useCallback((rowIndex, colIndex) => {
        if (selectedRowIndexes.size > 0 && selectedColIndexes.size > 0) {
            return selectedRowIndexes.has(rowIndex) && selectedColIndexes.has(colIndex);
        }
        if (selectedRowIndexes.size > 0) return selectedRowIndexes.has(rowIndex);
        if (selectedColIndexes.size > 0) return selectedColIndexes.has(colIndex);
        if (!selectionBounds) return false;
        return rowIndex >= selectionBounds.rowStart
            && rowIndex <= selectionBounds.rowEnd
            && colIndex >= selectionBounds.colStart
            && colIndex <= selectionBounds.colEnd;
    }, [selectionBounds, selectedRowIndexes, selectedColIndexes]);

    const isPrimaryColumnSelected = React.useCallback((colIndex) => (
        selectedColIndexes.has(colIndex)
        || (selectionBounds && colIndex >= selectionBounds.colStart && colIndex <= selectionBounds.colEnd)
    ), [selectedColIndexes, selectionBounds]);

    const applyColumnSelection = React.useCallback((colIndex, evt) => {
        const withShift = !!evt?.shiftKey;
        const withCtrl = !!(evt?.ctrlKey || evt?.metaKey);
        setSelectedColIndexes((prev) => {
            const next = new Set(prev);
            if (withShift && lastColSelectionIndex !== null) {
                const start = Math.min(lastColSelectionIndex, colIndex);
                const end = Math.max(lastColSelectionIndex, colIndex);
                for (let i = start; i <= end; i += 1) next.add(i);
            } else if (withCtrl) {
                if (next.has(colIndex)) next.delete(colIndex);
                else next.add(colIndex);
                setLastColSelectionIndex(colIndex);
                return next;
            } else {
                next.clear();
                next.add(colIndex);
            }
            return next;
        });
        setLastColSelectionIndex(colIndex);
    }, [lastColSelectionIndex]);

    const applyRowSelection = React.useCallback((rowIndex, evt) => {
        const withShift = !!evt?.shiftKey;
        const withCtrl = !!(evt?.ctrlKey || evt?.metaKey);
        setSelectedRowIndexes((prev) => {
            const next = new Set(prev);
            if (withShift && lastRowSelectionIndex !== null) {
                const start = Math.min(lastRowSelectionIndex, rowIndex);
                const end = Math.max(lastRowSelectionIndex, rowIndex);
                for (let i = start; i <= end; i += 1) next.add(i);
            } else if (withCtrl) {
                if (next.has(rowIndex)) next.delete(rowIndex);
                else next.add(rowIndex);
                setLastRowSelectionIndex(rowIndex);
                return next;
            } else {
                next.clear();
                next.add(rowIndex);
            }
            return next;
        });
        setLastRowSelectionIndex(rowIndex);
    }, [lastRowSelectionIndex]);

    const isSecondaryCellSelected = React.useCallback((rowIndex, colIndex) => {
        if (secondarySelectedRowIndexes.size > 0 && secondarySelectedColIndexes.size > 0) {
            return secondarySelectedRowIndexes.has(rowIndex) && secondarySelectedColIndexes.has(colIndex);
        }
        if (secondarySelectedRowIndexes.size > 0) return secondarySelectedRowIndexes.has(rowIndex);
        if (secondarySelectedColIndexes.size > 0) return secondarySelectedColIndexes.has(colIndex);
        return false;
    }, [secondarySelectedRowIndexes, secondarySelectedColIndexes]);

    const isSecondaryColumnSelected = React.useCallback((colIndex) => (
        secondarySelectedColIndexes.has(colIndex)
    ), [secondarySelectedColIndexes]);

    const applySecondaryColumnSelection = React.useCallback((colIndex, evt) => {
        const withShift = !!evt?.shiftKey;
        const withCtrl = !!(evt?.ctrlKey || evt?.metaKey);
        setSecondarySelectedColIndexes((prev) => {
            const next = new Set(prev);
            if (withShift && secondaryLastColSelectionIndex !== null) {
                const start = Math.min(secondaryLastColSelectionIndex, colIndex);
                const end = Math.max(secondaryLastColSelectionIndex, colIndex);
                for (let i = start; i <= end; i += 1) next.add(i);
            } else if (withCtrl) {
                if (next.has(colIndex)) next.delete(colIndex);
                else next.add(colIndex);
                setSecondaryLastColSelectionIndex(colIndex);
                return next;
            } else {
                next.clear();
                next.add(colIndex);
            }
            return next;
        });
        setSecondaryLastColSelectionIndex(colIndex);
    }, [secondaryLastColSelectionIndex]);

    const applySecondaryRowSelection = React.useCallback((rowIndex, evt) => {
        const withShift = !!evt?.shiftKey;
        const withCtrl = !!(evt?.ctrlKey || evt?.metaKey);
        setSecondarySelectedRowIndexes((prev) => {
            const next = new Set(prev);
            if (withShift && secondaryLastRowSelectionIndex !== null) {
                const start = Math.min(secondaryLastRowSelectionIndex, rowIndex);
                const end = Math.max(secondaryLastRowSelectionIndex, rowIndex);
                for (let i = start; i <= end; i += 1) next.add(i);
            } else if (withCtrl) {
                if (next.has(rowIndex)) next.delete(rowIndex);
                else next.add(rowIndex);
                setSecondaryLastRowSelectionIndex(rowIndex);
                return next;
            } else {
                next.clear();
                next.add(rowIndex);
            }
            return next;
        });
        setSecondaryLastRowSelectionIndex(rowIndex);
    }, [secondaryLastRowSelectionIndex]);

    const createLockedViewFromSelection = React.useCallback(() => {
        if (selectedPrimaryColumns.length === 0 || selectedPrimaryRowIndexes.length === 0) return;
        const filters = buildSelectionFilters();
        const secondarySelectionFilters = buildSecondarySelectionFilters();
        const secondarySerializableFilters = {};
        if (secondarySelectionFilters) {
            Object.entries(secondarySelectionFilters).forEach(([col, val]) => {
                secondarySerializableFilters[col] = Array.from(val || []);
            });
        } else {
            Object.entries(secondaryColumnFilters || {}).forEach(([col, val]) => {
                secondarySerializableFilters[col] = Array.isArray(val) ? val : (val instanceof Set ? Array.from(val) : [val]);
            });
        }
        const rowCount = selectedPrimaryRowIndexes.length;
        const colCount = selectedPrimaryColumns.length;
        const suggestedName = `Selection ${rowCount}x${colCount}`;
        setPendingViewName(suggestedName);
        setSaveViewConfigOverride({
            columnFilters: filters || {},
            visibleColumns: selectedPrimaryColumns,
            splitContext: {
                secondarySheetId: secondarySheetId || null,
                secondaryTab: secondaryTab || null,
                secondarySortConfig: secondarySortConfig || null,
                secondaryColumnFilters: secondarySerializableFilters,
                secondaryVisibleColumns: selectedSecondaryColumns,
            },
        });
        setShowColumnSelector(true);
    }, [
        selectedPrimaryColumns,
        selectedPrimaryRowIndexes,
        buildSelectionFilters,
        buildSecondarySelectionFilters,
        selectedSecondaryColumns,
        secondaryColumnFilters,
        secondarySheetId,
        secondaryTab,
        secondarySortConfig,
        setPendingViewName,
        setSaveViewConfigOverride,
        setShowColumnSelector,
    ]);
    const canImportFromDrive = React.useMemo(() => {
        if (!user) return false;
        if (String(user.role || "").toLowerCase() === "admin") return true;
        return !!(user.is_group_admin || user.group_admin || user.is_admin);
    }, [user]);
    const canManageViews = React.useMemo(() => {
        if (!user) return false;
        if (String(user.role || "").toLowerCase() === "admin") return true;
        return !!(user.is_group_admin || user.group_admin || user.is_admin);
    }, [user]);
    const canOpenAdminPage = React.useMemo(() => {
        if (!user) return false;
        if (String(user.role || "").toLowerCase() === "admin") return true;
        return !!(user.is_group_admin || user.group_admin || user.is_admin);
    }, [user]);

    const resolveFileLabel = React.useCallback((item) => (
        item?.file_label || item?.display_name || item?.import_name || item?.original_filename || item?.filename || `Version ${item?.import_version || ""}`.trim()
    ), []);
    const [primarySourcePickerOpen, setPrimarySourcePickerOpen] = useState(false);
    const [secondarySourcePickerOpen, setSecondarySourcePickerOpen] = useState(false);
    const [primaryCompareSheetId, setPrimaryCompareSheetId] = useState("");
    const [secondaryCompareSheetId, setSecondaryCompareSheetId] = useState("");
    const [primaryComparePickerOpen, setPrimaryComparePickerOpen] = useState(false);
    const [secondaryComparePickerOpen, setSecondaryComparePickerOpen] = useState(false);
    const [primaryCompareExpanded, setPrimaryCompareExpanded] = useState(true);
    const [secondaryCompareExpanded, setSecondaryCompareExpanded] = useState(true);
    const [primaryCompareRows, setPrimaryCompareRows] = useState([]);
    const [secondaryCompareRows, setSecondaryCompareRows] = useState([]);
    const [primarySourceQuery, setPrimarySourceQuery] = useState("");
    const [secondarySourceQuery, setSecondarySourceQuery] = useState("");
    const [primaryExpandedSources, setPrimaryExpandedSources] = useState(() => new Set());
    const [secondaryExpandedSources, setSecondaryExpandedSources] = useState(() => new Set());
    const [primaryFileVersionMenuKey, setPrimaryFileVersionMenuKey] = useState(null);
    const [secondaryFileVersionMenuKey, setSecondaryFileVersionMenuKey] = useState(null);
    const primarySourcePickerRef = React.useRef(null);
    const secondarySourcePickerRef = React.useRef(null);

    const explicitSources = React.useMemo(() => (
        (reportSources || [])
            .filter((source) => source && !source.is_inferred)
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    ), [reportSources]);

    const trunc = React.useCallback((str, n) => {
        if (!str) return "";
        return str.length > n ? str.substring(0, n - 1) + "..." : str;
    }, []);

    const getSelectedSourceMeta = React.useCallback((targetSheetId) => {
        let selectedSource = explicitSources.find((source) => String(source.current_sheet_id) === String(targetSheetId))
            || explicitSources.find((source) => (reportSourceImports[String(source.id)] || []).some((item) => String(item.sheet_id) === String(targetSheetId)));
        let selectedImport = selectedSource
            ? (reportSourceImports[String(selectedSource.id)] || []).find((item) => String(item.sheet_id) === String(targetSheetId))
            : null;

        // Fallback for sheets that are loaded but not present in explicitSources list.
        if (!selectedSource || !selectedImport) {
            const hit = Object.entries(reportSourceImports || {}).find(([, imports]) => (
                Array.isArray(imports) && imports.some((item) => String(item.sheet_id) === String(targetSheetId))
            ));
            if (hit) {
                const sourceId = String(hit[0]);
                selectedSource = (reportSources || []).find((s) => String(s.id) === sourceId) || selectedSource;
                selectedImport = (hit[1] || []).find((item) => String(item.sheet_id) === String(targetSheetId)) || selectedImport;
            }
        }
        return { selectedSource, selectedImport };
    }, [explicitSources, reportSourceImports, reportSources]);

    const getRevisionOptionsForSheet = React.useCallback((targetSheetId) => {
        if (!targetSheetId) return [];
        const { selectedSource, selectedImport } = getSelectedSourceMeta(targetSheetId);
        if (!selectedSource) return [];
        const activeFileLabel = String(selectedImport?.file_label || "").trim().toLowerCase();
        const imports = (reportSourceImports[String(selectedSource.id)] || [])
            .slice()
            .filter((item) => {
                if (!activeFileLabel) return true;
                return String(item?.file_label || "").trim().toLowerCase() === activeFileLabel;
            })
            .sort((a, b) => (Number(b.import_version || 0) - Number(a.import_version || 0)));
        return imports
            .map((item) => ({
                value: String(item.sheet_id),
                label: `v${item.import_version || "-"} · ${resolveFileLabel(item)}`,
                importVersion: item.import_version || null,
                uploadedAt: item.uploaded_at || null,
                isCurrent: String(item.sheet_id) === String(targetSheetId),
            }));
    }, [getSelectedSourceMeta, reportSourceImports, resolveFileLabel]);

    const normalizeRowsFromResponse = React.useCallback((raw) => {
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw?.rows)) return raw.rows;
        if (Array.isArray(raw?.data)) return raw.data;
        return [];
    }, []);

    const normalizeCellForDiff = React.useCallback((val) => {
        if (val === null || val === undefined) return "";
        if (typeof val === "string") return val.trim();
        if (typeof val === "number" || typeof val === "boolean") return String(val);
        if (val instanceof Date) return val.toISOString();
        try {
            return JSON.stringify(val);
        } catch (_) {
            return String(val);
        }
    }, []);

    const sortRowsForDiff = React.useCallback((rows, cfg) => {
        if (!cfg?.key || !cfg?.direction || !Array.isArray(rows)) return rows;
        const key = cfg.key;
        const direction = cfg.direction === "descending" ? -1 : 1;
        return rows.slice().sort((a, b) => {
            const av = a?.[key];
            const bv = b?.[key];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
            return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * direction;
        });
    }, []);

    const primaryRevisionOptions = React.useMemo(() => getRevisionOptionsForSheet(sheetId), [getRevisionOptionsForSheet, sheetId]);
    const secondaryRevisionOptions = React.useMemo(() => getRevisionOptionsForSheet(secondarySheetId), [getRevisionOptionsForSheet, secondarySheetId]);
    const primaryCompareLabel = React.useMemo(() => {
        if (!primaryCompareSheetId) return "Off";
        const hit = primaryRevisionOptions.find((o) => String(o.value) === String(primaryCompareSheetId));
        return hit?.label || "Off";
    }, [primaryCompareSheetId, primaryRevisionOptions]);
    const secondaryCompareLabel = React.useMemo(() => {
        if (!secondaryCompareSheetId) return "Off";
        const hit = secondaryRevisionOptions.find((o) => String(o.value) === String(secondaryCompareSheetId));
        return hit?.label || "Off";
    }, [secondaryCompareSheetId, secondaryRevisionOptions]);

    useEffect(() => {
        if (primaryCompareSheetId && !primaryRevisionOptions.some((o) => String(o.value) === String(primaryCompareSheetId))) {
            setPrimaryCompareSheetId("");
        }
    }, [primaryCompareSheetId, primaryRevisionOptions]);

    useEffect(() => {
        if (secondaryCompareSheetId && !secondaryRevisionOptions.some((o) => String(o.value) === String(secondaryCompareSheetId))) {
            setSecondaryCompareSheetId("");
        }
    }, [secondaryCompareSheetId, secondaryRevisionOptions]);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (!primaryCompareSheetId) {
                setPrimaryCompareRows([]);
                return;
            }
            try {
                const params = {};
                if (activeTab) params.tab = activeTab;
                const res = await axios.get(`${API}/sheets/${primaryCompareSheetId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    params,
                });
                if (!cancelled) {
                    setPrimaryCompareRows(normalizeRowsFromResponse(res.data));
                }
            } catch (e) {
                console.error("Failed loading primary compare revision:", e);
                if (!cancelled) setPrimaryCompareRows([]);
            }
        };
        run();
        return () => { cancelled = true; };
    }, [API, token, primaryCompareSheetId, activeTab, normalizeRowsFromResponse]);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (!secondaryCompareSheetId) {
                setSecondaryCompareRows([]);
                return;
            }
            try {
                const params = {};
                if (secondaryTab) params.tab = secondaryTab;
                const res = await axios.get(`${API}/sheets/${secondaryCompareSheetId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    params,
                });
                if (!cancelled) {
                    setSecondaryCompareRows(normalizeRowsFromResponse(res.data));
                }
            } catch (e) {
                console.error("Failed loading secondary compare revision:", e);
                if (!cancelled) setSecondaryCompareRows([]);
            }
        };
        run();
        return () => { cancelled = true; };
    }, [API, token, secondaryCompareSheetId, secondaryTab, normalizeRowsFromResponse]);

    const primarySortedCompareRows = React.useMemo(
        () => sortRowsForDiff(primaryCompareRows, sortConfig),
        [primaryCompareRows, sortConfig, sortRowsForDiff]
    );

    const secondarySortedCompareRows = React.useMemo(
        () => sortRowsForDiff(secondaryCompareRows, secondarySortConfig),
        [secondaryCompareRows, secondarySortConfig, sortRowsForDiff]
    );

    const primaryDiffCellSet = React.useMemo(() => {
        if (!primaryCompareSheetId || !Array.isArray(sortedData) || !sortedData.length) return new Set();
        const changed = new Set();
        sortedData.forEach((row, rowIndex) => {
            const baseRow = primarySortedCompareRows[rowIndex] || {};
            (displayHeaders || []).forEach((col) => {
                const curr = normalizeCellForDiff(row?.[col]);
                const prev = normalizeCellForDiff(baseRow?.[col]);
                if (curr !== prev) changed.add(`${rowIndex}::${col}`);
            });
        });
        return changed;
    }, [primaryCompareSheetId, sortedData, primarySortedCompareRows, displayHeaders, normalizeCellForDiff]);

    const primaryMissingColumns = React.useMemo(() => {
        if (!primaryCompareSheetId) return [];
        const compareCols = new Set();
        (primaryCompareRows || []).forEach((row) => {
            Object.keys(row || {}).forEach((k) => compareCols.add(String(k)));
        });
        return (activePrimaryFields || []).filter((col) => !compareCols.has(String(col)));
    }, [primaryCompareSheetId, primaryCompareRows, activePrimaryFields]);

    const secondaryDiffCellSet = React.useMemo(() => {
        const rows = Array.isArray(secondaryData) ? secondaryData : [];
        const activeFilters = Object.entries(secondaryColumnFilters)
            .filter(([, allowed]) => allowed instanceof Set && allowed.size > 0);
        const filteredRows = !activeFilters.length
            ? rows
            : rows.filter((row) => activeFilters.every(([col, allowed]) => (
                allowed.has(String(row?.[col] ?? ""))
            )));
        if (!secondaryCompareSheetId || !filteredRows.length) return new Set();
        const changed = new Set();
        filteredRows.forEach((row, rowIndex) => {
            const baseRow = secondarySortedCompareRows[rowIndex] || {};
            (activeSecondaryFields || []).forEach((col) => {
                const curr = normalizeCellForDiff(row?.[col]);
                const prev = normalizeCellForDiff(baseRow?.[col]);
                if (curr !== prev) changed.add(`${rowIndex}::${col}`);
            });
        });
        return changed;
    }, [secondaryCompareSheetId, secondaryData, secondaryColumnFilters, secondarySortedCompareRows, activeSecondaryFields, normalizeCellForDiff]);

    const secondaryMissingColumns = React.useMemo(() => {
        if (!secondaryCompareSheetId) return [];
        const compareCols = new Set();
        (secondaryCompareRows || []).forEach((row) => {
            Object.keys(row || {}).forEach((k) => compareCols.add(String(k)));
        });
        return (activeSecondaryFields || []).filter((col) => !compareCols.has(String(col)));
    }, [secondaryCompareSheetId, secondaryCompareRows, activeSecondaryFields]);

    const primaryPickerLabel = React.useMemo(() => {
        const { selectedSource, selectedImport } = getSelectedSourceMeta(sheetId);
        return selectedImport
            ? `${selectedSource?.name || "Report source"} / ${resolveFileLabel(selectedImport)}`
            : (selectedSource?.name || props.activeFilename || "Select sheet");
    }, [getSelectedSourceMeta, sheetId, resolveFileLabel, props.activeFilename]);

    const secondaryPickerLabel = React.useMemo(() => {
        const { selectedSource, selectedImport } = getSelectedSourceMeta(secondarySheetId);
        if (selectedImport) return `${selectedSource?.name || "Report source"} / ${resolveFileLabel(selectedImport)}`;
        const sheet = (props.myFiles || []).find((f) => String(f.id) === String(secondarySheetId));
        return sheet?.display_name || sheet?.filename || "Select sheet";
    }, [getSelectedSourceMeta, secondarySheetId, resolveFileLabel, props.myFiles]);

    React.useEffect(() => {
        const onDocClick = (event) => {
            if (!primarySourcePickerRef.current?.contains(event.target)) {
                setPrimarySourcePickerOpen(false);
                setPrimaryFileVersionMenuKey(null);
            }
            if (!secondarySourcePickerRef.current?.contains(event.target)) {
                setSecondarySourcePickerOpen(false);
                setSecondaryFileVersionMenuKey(null);
            }
            if (!event.target.closest?.(".primary-compare-picker")) {
                setPrimaryComparePickerOpen(false);
            }
            if (!event.target.closest?.(".secondary-compare-picker")) {
                setSecondaryComparePickerOpen(false);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, []);

    React.useEffect(() => {
        if (!menuOpen) return undefined;
        const onEsc = (e) => {
            if (e.key === "Escape") setMenuOpen(false);
        };
        document.addEventListener("keydown", onEsc);
        return () => document.removeEventListener("keydown", onEsc);
    }, [menuOpen]);

    React.useEffect(() => {
        setMenuOpen(false);
    }, [sheetId]);

    const reportSourceOptions = React.useMemo(() => {
        return [{ value: "", label: "Create new report source" }].concat(
            (reportSources || []).filter((source) => !source.is_inferred).map((source) => {
                const name = source.name || source.report_source_name || `Report source ${source.id}`;
                return { value: String(source.id), label: name };
            })
        );
    }, [reportSources]);

    const labelOptions = React.useMemo(() => {
        return [];
    }, []);

    useEffect(() => {
        if (selectedReportSourceId) {
            // If we have labels, default to the first one.
            if (labelOptions.length > 1) {
                if (!fileLabel || !labelOptions.some(o => o.value === fileLabel)) {
                    const firstVal = labelOptions[0].value;
                    if (firstVal !== "__NEW__") {
                        setFileLabel(firstVal);
                        setIsNewLabel(false);
                    } else {
                        setIsNewLabel(true);
                    }
                }
            } else {
                setIsNewLabel(true);
            }
        } else {
            setIsNewLabel(true);
        }
    }, [selectedReportSourceId, labelOptions]);

    const leftMenuSelectClasses = {
        buttonClassName: "!bg-white/10 !border-white/25 !rounded-[0.6rem] !min-h-[2.05rem] !h-auto !px-2 !py-1.5 !text-[0.76rem] !font-bold !text-white hover:!bg-white/20 hover:!border-white/35 !shadow-none focus:!outline-none focus:!ring-2 focus:!ring-white/20",
        labelClassName: "!text-white !font-bold",
        panelClassName: "!bg-[#001f3f] !text-white !border-white/20 !shadow-2xl !rounded-[0.65rem] !mt-1",
        optionClassName: "!rounded-[0.5rem] !text-white hover:!bg-white/20 !border !border-transparent",
        optionTextClassName: "!font-bold !text-[0.72rem] !text-white",
        selectedOptionClassName: "!bg-white/20 !border-white/25",
        searchInputClassName: "!bg-white/10 !border-white/20 !text-white !placeholder-blue-200 !rounded-[0.5rem] !text-[0.72rem] !font-bold focus:!ring-white/20 focus:!border-white/35",
    };

    const viewOptions = React.useMemo(() => {
        const sorted = (views || []).map((v) => {
            let prefix = "[Rev]";
            if (v.is_global) prefix = "[Global]";
            else if (v.report_source_id && !v.file_label) prefix = "[Source]";
            else if (v.report_source_id && v.file_label) prefix = "[File]";
            return { value: v.id, label: `${prefix} ${v.name}` };
        });
        return [{ value: "", label: "Select a view…" }].concat(sorted);
    }, [views]);

    const deleteView = async (id) => {
        if (!confirm("Delete this view?")) return;
        try {
            await axios.delete(`${API}/views/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const res = await axios.get(`${API}/views/${sheetId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setViews(res.data || []);
            if (String(selectedViewId) === String(id)) {
                setSelectedViewId("");
            }
        } catch (e) {
            console.error("Delete view failed:", e);
            alert("Failed to delete view");
        }
    };

    const isSupportedDriveFile = React.useCallback((entry) => {
        const mime = String(entry?.mimeType || "").toLowerCase();
        const name = String(entry?.name || "").toLowerCase();
        if (mime === "text/csv" || mime === "application/vnd.ms-excel" || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
            return true;
        }
        return name.endsWith(".csv") || name.endsWith(".xls") || name.endsWith(".xlsx");
    }, []);

    const fetchDriveEntries = React.useCallback(async (nextParentId = "root", nextBreadcrumbs = null) => {
        setDriveLoading(true);
        try {
            const res = await axios.get(`${API}/google/drive/files`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { parentId: nextParentId },
            });
            const raw = Array.isArray(res?.data?.files) ? res.data.files : [];
            const normalized = raw
                .filter((entry) => {
                    const mime = String(entry?.mimeType || "");
                    if (mime === "application/vnd.google-apps.folder") return true;
                    return isSupportedDriveFile(entry);
                })
                .map((entry) => ({ ...entry, id: String(entry.id || "") }))
                .filter((entry) => entry.id);
            setDriveEntries(normalized);
            setDriveBreadcrumbs(Array.isArray(nextBreadcrumbs) && nextBreadcrumbs.length ? nextBreadcrumbs : [{ id: "root", name: "My Drive" }]);
        } catch (e) {
            const errCode = String(e?.response?.data?.error || "");
            if (errCode === "google_not_connected") {
                if (confirm("Google Drive is not connected for this user yet. Connect now?")) {
                    handleGoogleConnect?.();
                }
                return;
            }
            console.error("Fetch Google Drive entries failed:", e);
            alert(e?.response?.data?.error || "Failed to fetch Google Drive files");
        } finally {
            setDriveLoading(false);
        }
    }, [API, token, isSupportedDriveFile, handleGoogleConnect]);

    const openDrivePicker = React.useCallback(() => {
        setSelectedDriveFile(null);
        setDrivePickerOpen(true);
        fetchDriveEntries("root", [{ id: "root", name: "My Drive" }]);
    }, [fetchDriveEntries]);

    const closeDrivePicker = React.useCallback(() => {
        setDrivePickerOpen(false);
        setSelectedDriveFile(null);
    }, []);

    const fetchDropboxEntries = React.useCallback(async (nextPath = "", nextBreadcrumbs = null) => {
        setDropboxLoading(true);
        try {
            const res = await axios.get(`${API}/dropbox/files`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { path: nextPath },
            });
            const raw = Array.isArray(res?.data?.entries) ? res.data.entries : [];
            const normalized = raw
                .map((entry) => ({ ...entry, id: String(entry.id || entry.pathLower || "") }))
                .filter((entry) => entry.id);
            setDropboxEntries(normalized);
            setDropboxBreadcrumbs(Array.isArray(nextBreadcrumbs) && nextBreadcrumbs.length ? nextBreadcrumbs : [{ path: "", name: "Dropbox" }]);
        } catch (e) {
            const errCode = String(e?.response?.data?.error || "");
            if (errCode === "dropbox_not_connected") {
                if (confirm("Dropbox is not connected for this user yet. Connect now?")) {
                    handleDropboxConnect?.();
                }
                return;
            }
            console.error("Fetch Dropbox entries failed:", e);
            alert(e?.response?.data?.error || "Failed to fetch Dropbox files");
        } finally {
            setDropboxLoading(false);
        }
    }, [API, token, handleDropboxConnect]);

    const openDropboxPicker = React.useCallback(() => {
        setSelectedDropboxFile(null);
        setDropboxPickerOpen(true);
        fetchDropboxEntries("", [{ path: "", name: "Dropbox" }]);
    }, [fetchDropboxEntries]);

    const closeDropboxPicker = React.useCallback(() => {
        setDropboxPickerOpen(false);
        setSelectedDropboxFile(null);
    }, []);

    const fetchOneDriveEntries = React.useCallback(async (nextItemId = "root", nextBreadcrumbs = null) => {
        setOneDriveLoading(true);
        try {
            const res = await axios.get(`${API}/onedrive/files`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { itemId: nextItemId },
            });
            const raw = Array.isArray(res?.data?.entries) ? res.data.entries : [];
            const normalized = raw
                .map((entry) => ({ ...entry, id: String(entry.id || "") }))
                .filter((entry) => entry.id);
            setOneDriveEntries(normalized);
            setOneDriveBreadcrumbs(Array.isArray(nextBreadcrumbs) && nextBreadcrumbs.length ? nextBreadcrumbs : [{ id: "root", name: "OneDrive" }]);
        } catch (e) {
            const errCode = String(e?.response?.data?.error || "");
            if (errCode === "onedrive_not_connected") {
                if (confirm("OneDrive is not connected for this user yet. Connect now?")) {
                    handleOneDriveConnect?.();
                }
                return;
            }
            console.error("Fetch OneDrive entries failed:", e);
            alert(e?.response?.data?.error || "Failed to fetch OneDrive files");
        } finally {
            setOneDriveLoading(false);
        }
    }, [API, token, handleOneDriveConnect]);

    const openOneDrivePicker = React.useCallback(() => {
        setSelectedOneDriveFile(null);
        setOneDrivePickerOpen(true);
        fetchOneDriveEntries("root", [{ id: "root", name: "OneDrive" }]);
    }, [fetchOneDriveEntries]);

    const closeOneDrivePicker = React.useCallback(() => {
        setOneDrivePickerOpen(false);
        setSelectedOneDriveFile(null);
    }, []);

    // Calculate dynamic col widths based on header length
    const colWidths = React.useMemo(() => {
        const widths = {};
        if (displayHeaders) {
            displayHeaders.forEach((h) => {
                // ~8px per character + some padding for sort/filter icons, min 180px
                widths[h] = Math.max(180, h.length * 8 + 60);
            });
        }
        return widths;
    }, [displayHeaders]);

    useEffect(() => {
        colWidthsRef.current = colWidths || {};
    }, [colWidths]);

    useEffect(() => {
        if (!comparisonOn || splitDragging) return;
        const container = document.getElementById("split-container");
        if (!container) return;
        const containerWidth = container.getBoundingClientRect().width || 0;
        if (containerWidth <= 0) return;

        const currentPx = (splitWidth / 100) * containerWidth;
        const snappedPct = splitSnap.current.getSnappedPct(containerWidth, currentPx);
        if (Math.abs(snappedPct - splitWidth) > 0.01) {
            setSplitWidth(snappedPct);
        }
    }, [comparisonOn, splitDragging, splitWidth, activePrimaryFields, activeSecondaryFields, colWidths]);

    // Memoize InnerElement to prevent remounts and issues with ref
    const totalRowWidth = React.useMemo(() => {
        return activePrimaryFields?.reduce((sum, h) => sum + (colWidths[h] || 180), 0) || 0;
    }, [activePrimaryFields, colWidths]);

    const getColumnIndexFromX = React.useCallback((xOffset) => {
        if (!activePrimaryFields.length) return 0;
        const clampedX = Math.max(0, Math.min(totalRowWidth - 1, xOffset));
        let running = 0;
        for (let i = 0; i < activePrimaryFields.length; i += 1) {
            running += colWidths[activePrimaryFields[i]] || 180;
            if (clampedX < running) return i;
        }
        return activePrimaryFields.length - 1;
    }, [activePrimaryFields, colWidths, totalRowWidth]);

    useEffect(() => {
        const onPointerMove = (event) => {
            if (!isSelectingRef.current) return;
            dragPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
        };
        window.addEventListener("mousemove", onPointerMove);
        return () => window.removeEventListener("mousemove", onPointerMove);
    }, []);

    useEffect(() => {
        if (!isSelecting) return undefined;

        const step = () => {
            if (!isSelectingRef.current) {
                dragAutoScrollRafRef.current = null;
                return;
            }
            const pointer = dragPointerRef.current;
            const outer = primaryOuterRef.current;
            if (pointer && outer) {
                const rect = outer.getBoundingClientRect();
                const threshold = 48;
                const maxStep = 24;
                let verticalDelta = 0;
                let horizontalDelta = 0;
                if (pointer.clientY < rect.top + threshold) {
                    const t = (rect.top + threshold - pointer.clientY) / threshold;
                    verticalDelta = -Math.ceil(maxStep * Math.min(1, Math.max(0, t)));
                } else if (pointer.clientY > rect.bottom - threshold) {
                    const t = (pointer.clientY - (rect.bottom - threshold)) / threshold;
                    verticalDelta = Math.ceil(maxStep * Math.min(1, Math.max(0, t)));
                }
                if (pointer.clientX < rect.left + threshold) {
                    const t = (rect.left + threshold - pointer.clientX) / threshold;
                    horizontalDelta = -Math.ceil(maxStep * Math.min(1, Math.max(0, t)));
                } else if (pointer.clientX > rect.right - threshold) {
                    const t = (pointer.clientX - (rect.right - threshold)) / threshold;
                    horizontalDelta = Math.ceil(maxStep * Math.min(1, Math.max(0, t)));
                }

                if (verticalDelta !== 0) {
                    const nextTop = Math.max(0, Math.min(outer.scrollHeight - outer.clientHeight, outer.scrollTop + verticalDelta));
                    if (nextTop !== outer.scrollTop) {
                        primaryListRef.current.scrollTo(nextTop);
                    }
                }
                if (horizontalDelta !== 0) {
                    const nextLeft = Math.max(0, Math.min(outer.scrollWidth - outer.clientWidth, outer.scrollLeft + horizontalDelta));
                    if (nextLeft !== outer.scrollLeft) {
                        outer.scrollLeft = nextLeft;
                    }
                }

                const rowOffset = outer.scrollTop + (pointer.clientY - rect.top);
                const colOffset = outer.scrollLeft + (pointer.clientX - rect.left);
                const rowIndex = Math.max(0, Math.min(sortedData.length - 1, Math.floor(rowOffset / 36)));
                const colIndex = getColumnIndexFromX(colOffset);
                queueSelectionFocusUpdate({ row: rowIndex, col: colIndex });
            }
            dragAutoScrollRafRef.current = requestAnimationFrame(step);
        };

        dragAutoScrollRafRef.current = requestAnimationFrame(step);
        return () => {
            if (dragAutoScrollRafRef.current) {
                cancelAnimationFrame(dragAutoScrollRafRef.current);
                dragAutoScrollRafRef.current = null;
            }
        };
    }, [isSelecting, sortedData.length, getColumnIndexFromX, queueSelectionFocusUpdate]);

    const secondaryTotalWidth = React.useMemo(() => {
        return activeSecondaryFields?.reduce((sum, h) => sum + 180, 0) || 0;
    }, [activeSecondaryFields]);

    const uniqueValuesCacheKey = React.useCallback((sid, tabName, col) => (
        `${String(sid || "")}::${tabName ? String(tabName) : "__all__"}::${String(col || "")}`
    ), []);

    const getCachedUniqueValues = React.useCallback((sid, tabName, col) => (
        uniqueValuesByColumn?.[uniqueValuesCacheKey(sid, tabName, col)] || []
    ), [uniqueValuesByColumn, uniqueValuesCacheKey]);

    const reloadSecondaryWithFilters = React.useCallback((filters) => {
        if (!secondarySheetId || !loadData) return;
        loadData(secondarySheetId, true, secondaryTab, {
            context: "secondary",
            preferCache: false,
            filters,
        });
    }, [loadData, secondarySheetId, secondaryTab]);

    const filteredSecondaryData = React.useMemo(() => {
        const rows = Array.isArray(secondaryData) ? secondaryData : [];
        const activeFilters = Object.entries(secondaryColumnFilters)
            .filter(([, allowed]) => allowed instanceof Set && allowed.size > 0);
        if (!activeFilters.length) return rows;

        return rows.filter((row) => activeFilters.every(([col, allowed]) => (
            allowed.has(String(row?.[col] ?? ""))
        )));
    }, [secondaryData, secondaryColumnFilters]);

    const PrimaryOuterElement = React.useMemo(() => forwardRef(({ onScroll, ...rest }, ref) => (
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

    const SecondaryOuterElement = React.useMemo(() => forwardRef(({ onScroll, ...rest }, ref) => (
        <div
            ref={ref}
            onScroll={(e) => {
                onScroll(e);
                if (secondaryHeaderRef.current) {
                    secondaryHeaderRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
            }}
            {...rest}
        />
    )), []);

    // Non-admin users: show welcome screen until sheet is selected
    if (user.role !== "admin" && !sheetId) {
        return (
            <div className="w-full min-h-screen flex items-center justify-center premium-gradient">
                <div className="glass rounded-[3rem] p-12 w-[32rem] text-center shadow-2xl animate-in zoom-in-95 duration-500">
                    <div className="bg-indigo-600 text-white w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-xl shadow-indigo-200 mx-auto mb-6">📊</div>
                    <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-4">Welcome to Analytics</h2>
                    <p className="text-slate-500 mb-8 font-medium leading-relaxed">Please select a spreadsheet from the navigation menu above to begin your data analysis journey.</p>
                    <div className="flex justify-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-200 animate-bounce delay-0"></span>
                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce delay-150"></span>
                        <span className="w-2 h-2 rounded-full bg-indigo-600 animate-bounce delay-300"></span>
                    </div>
                </div>
            </div>
        );
    }

    const hasChart = pivotOn || trendsOn || twoOn;

    // Admin or sheet selected: show normal dashboard
    return (
        <div className="workspace-shell w-full h-full min-h-0 flex bg-slate-50 relative pointer-events-auto overflow-hidden">
            <aside
                id="dashboard-left-menu"
                aria-label="Dashboard actions menu"
                className={`left-side-menu h-full shrink-0 sticky top-0 self-start overflow-y-auto shadow-xl border-r border-blue-800 transition-all duration-200 ${menuOpen ? "w-[17rem] p-3" : "w-14 p-2"}`}
            >
                <div className={`flex items-center ${menuOpen ? "justify-between mb-3" : "justify-center mb-2"}`}>
                    {menuOpen && <h2 className="left-menu-heading">Menu</h2>}
                    <button
                        type="button"
                        onClick={() => setMenuOpen((v) => !v)}
                        className="left-menu-close"
                        aria-label={menuOpen ? "Collapse menu" : "Expand menu"}
                        aria-expanded={menuOpen}
                        aria-controls="dashboard-left-menu-content"
                    >
                        {menuOpen ? "◀" : "☰"}
                    </button>
                </div>

                {menuOpen && (
                    <div id="dashboard-left-menu-content">
                        <div className="left-menu-group">
                            <button className="left-menu-section-toggle" onClick={() => toggleMenu("view")} aria-expanded={expandedMenus.view}>
                                <span>View</span>
                                <span>{expandedMenus.view ? "▾" : "▸"}</span>
                            </button>
                            {expandedMenus.view && (
                                <div className="left-menu-submenu">
                                    <button
                                        type="button"
                                        className="left-menu-action"
                                        onClick={() => {
                                            navigate("/");
                                        }}
                                    >
                                        Dashboard Home
                                    </button>
                                    <button
                                        type="button"
                                        className="left-menu-action"
                                        onClick={() => {
                                            loadData(sheetId, user.role !== "admin" && selectedViewId);
                                            setMenuOpen(false);
                                        }}
                                    >
                                        Refresh Data
                                    </button>
                                    <button className="left-menu-action left-menu-toggle-row" onClick={() => setInsightsOn((p) => !p)}>
                                        <span>Insights</span>
                                        <span className="left-menu-state">{insightsOn ? "ON" : "OFF"}</span>
                                    </button>

                                    <div className="mt-2 border-t border-blue-800/30 pt-2 px-2">
                                        <button 
                                            className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${comparisonOn ? 'bg-indigo-600 text-white' : 'text-blue-300 hover:bg-blue-800/40'}`}
                                            onClick={() => setComparisonOn(!comparisonOn)}
                                        >
                                            <span>Split-Screen Mode</span>
                                            <span>{comparisonOn ? 'ON' : 'OFF'}</span>
                                        </button>

                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="left-menu-group">
                            <button className="left-menu-section-toggle" onClick={() => toggleMenu("data")} aria-expanded={expandedMenus.data}>
                                <span>Upload & Import</span>
                                <span>{expandedMenus.data ? "▾" : "▸"}</span>
                            </button>
                            {expandedMenus.data && (
                                <div className="left-menu-submenu">
                                    {canImportFromDrive && (
                                        <div className="left-menu-nested">
                                                {String(user?.role || "").toLowerCase() === "admin" && (
                                                    <>
                                                        <label className="left-menu-file-picker">
                                                            <input
                                                                type="file"
                                                                onChange={(e) => {
                                                                    const f = e.target.files?.[0];
                                                                    setFile(f || null);
                                                                    setSelectedFileName(f?.name || "");
                                                                    e.target.value = null;
                                                                }}
                                                                className="hidden"
                                                            />
                                                            <span>📂</span>
                                                            <span className="truncate">{selectedFileName || "Choose spreadsheet"}</span>
                                                        </label>
                                                        <SearchableSelect
                                                            options={reportSourceOptions}
                                                            value={selectedReportSourceId}
                                                            onChange={(e) => {
                                                                setSelectedReportSourceId(e.target.value);
                                                            }}
                                                            placeholder="Report source (optional)"
                                                            className="w-full"
                                                            {...leftMenuSelectClasses}
                                                            panelWidth="100%"
                                                        />

                                                        {selectedReportSourceId && labelOptions.length > 1 && (
                                                            <SearchableSelect
                                                                options={labelOptions}
                                                                value={isNewLabel ? "__NEW__" : fileLabel}
                                                                onChange={(e) => {
                                                                    if (e.target.value === "__NEW__") {
                                                                        setIsNewLabel(true);
                                                                        setFileLabel("");
                                                                    } else {
                                                                        setIsNewLabel(false);
                                                                        setFileLabel(e.target.value);
                                                                    }
                                                                }}
                                                                placeholder="Select Label"
                                                                className="w-full"
                                                                {...leftMenuSelectClasses}
                                                                panelWidth="100%"
                                                            />
                                                        )}

                                                        {(!selectedReportSourceId || isNewLabel || labelOptions.length <= 1) && (
                                                            <input
                                                                type="text"
                                                                value={fileLabel}
                                                                onChange={(e) => setFileLabel(e.target.value.replace(/\s+/g, "_"))}
                                                                placeholder="Label (required)"
                                                                className="left-menu-action"
                                                                maxLength={120}
                                                                required
                                                            />
                                                        )}

                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                // Use fileLabel for both display_name and file_label.
                                                                // If no source ID, use fileLabel as the source name too.
                                                                handleUpload(file, fileLabel, selectedReportSourceId, selectedReportSourceId ? "" : fileLabel, fileLabel);
                                                                setFileLabel("");
                                                            }}
                                                            disabled={uploadInProgress || !file || !fileLabel.trim()}
                                                            className={`left-menu-action ${uploadInProgress || !file || !fileLabel.trim() ? "left-menu-action-disabled" : ""}`}
                                                            title={
                                                                uploadInProgress
                                                                    ? "Upload in progress"
                                                                    : !file
                                                                    ? "Choose a file"
                                                                    : (!fileLabel.trim())
                                                                        ? "Enter a label"
                                                                        : "Upload & Load"
                                                            }
                                                        >
                                                            {uploadInProgress ? `Uploading ${Math.max(0, Math.min(100, uploadPercent))}%` : "Upload & Load"}
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={openDrivePicker}
                                                    className="left-menu-action inline-flex items-center gap-2"
                                                >
                                                    <img
                                                        src="https://fonts.gstatic.com/s/i/productlogos/drive_2020q4/v8/web-64dp/logo_drive_2020q4_color_2x_web_64dp.png"
                                                        alt=""
                                                        aria-hidden="true"
                                                        className="h-3.5 w-3.5 shrink-0"
                                                    />
                                                    <span>Import from Google Drive</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={openDropboxPicker}
                                                    disabled={!dropboxEnabled}
                                                    className={`left-menu-action inline-flex items-center gap-2 ${dropboxEnabled ? "" : "left-menu-action-disabled"}`}
                                                >
                                                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="shrink-0">
                                                        <path fill="#0061FF" d="M6 2 0 6l6 4 6-4-6-4Zm12 0-6 4 6 4 6-4-6-4ZM6 10l-6 4 6 4 6-4-6-4Zm12 0-6 4 6 4 6-4-6-4ZM12 14l-6 4 6 4 6-4-6-4Z" />
                                                    </svg>
                                                    <span>Import from Dropbox</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={openOneDrivePicker}
                                                    disabled={!oneDriveEnabled}
                                                    className={`left-menu-action inline-flex items-center gap-2 ${oneDriveEnabled ? "" : "left-menu-action-disabled"}`}
                                                >
                                                    <img src="https://upload.wikimedia.org/wikipedia/commons/e/e7/Microsoft_OneDrive_Icon_%282025_-_present%29.svg" alt="OneDrive" className="h-3.5 w-3.5 shrink-0" />
                                                    <span>Import from OneDrive</span>
                                                </button>
                                                {sftpStorageEnabled && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openStoragePicker("sftp_storage")}
                                                        className="left-menu-action inline-flex items-center gap-2"
                                                    >
                                                        <SourceProviderIcon provider="sftp_storage" className="h-3.5 w-3.5 shrink-0" />
                                                        <span>Import from SFTP</span>
                                                    </button>
                                                )}
                                                {gcsStorageEnabled && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openStoragePicker("gcs_storage")}
                                                        className="left-menu-action inline-flex items-center gap-2"
                                                    >
                                                        <SourceProviderIcon provider="gcs_storage" className="h-3.5 w-3.5 shrink-0" />
                                                        <span>Import from Google Cloud Storage</span>
                                                    </button>
                                                )}
                                                {s3StorageEnabled && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openStoragePicker("s3_storage")}
                                                        className="left-menu-action inline-flex items-center gap-2"
                                                    >
                                                        <SourceProviderIcon provider="s3_storage" className="h-3.5 w-3.5 shrink-0" />
                                                        <span>Import from Amazon S3</span>
                                                    </button>
                                                )}
                                                {azureBlobStorageEnabled && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openStoragePicker("azure_blob_storage")}
                                                        className="left-menu-action inline-flex items-center gap-2"
                                                    >
                                                        <SourceProviderIcon provider="azure_blob_storage" className="h-3.5 w-3.5 shrink-0" />
                                                        <span>Import from Azure Blob Storage</span>
                                                    </button>
                                                )}
                                            </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="left-menu-group">
                            <button className="left-menu-section-toggle" onClick={() => toggleMenu("charts")} aria-expanded={expandedMenus.charts}>
                                <span>Charts and Tools</span>
                                <span>{expandedMenus.charts ? "▾" : "▸"}</span>
                            </button>
                            {expandedMenus.charts && (
                                <div className="left-menu-submenu">
                                    <button className="left-menu-action left-menu-toggle-row" onClick={() => setWorkspacePivotOn((p) => !p)}>
                                        <span>Pivot Table</span>
                                        <span className="left-menu-state">{pivotOn ? "ON" : "OFF"}</span>
                                    </button>
                                    <button className="left-menu-action left-menu-toggle-row" onClick={() => setWorkspaceTwoOn((p) => !p)}>
                                        <span>Two-Condition</span>
                                        <span className="left-menu-state">{twoOn ? "ON" : "OFF"}</span>
                                    </button>
                                    <button className="left-menu-action left-menu-toggle-row" onClick={() => setWorkspaceTrendsOn((p) => !p)}>
                                        <span>Trends</span>
                                        <span className="left-menu-state">{trendsOn ? "ON" : "OFF"}</span>
                                    </button>
                                    <details className="left-menu-disclosure">
                                        <summary className="left-menu-summary">EBITDA Calculator</summary>
                                        <div className="left-menu-nested">
                                            <EbitdaMenu
                                                embedded
                                                headers={displayHeaders}
                                                onCalculate={appendCalculatedColumn}
                                            />
                                        </div>
                                    </details>
                                </div>
                            )}
                        </div>

                        <div className="left-menu-group">
                            <button className="left-menu-section-toggle" onClick={() => toggleMenu("export")} aria-expanded={expandedMenus.export}>
                                <span>Export</span>
                                <span>{expandedMenus.export ? "▾" : "▸"}</span>
                            </button>
                            {expandedMenus.export && (
                                <div className="left-menu-submenu">
                                    <button className="left-menu-action" onClick={() => { exportCSV(); }}>Export CSV (.csv)</button>
                                    <button className="left-menu-action" onClick={() => { exportXLSX(); }}>Export Excel (.xlsx)</button>
                                    <button className="left-menu-action" onClick={() => { exportPDF(); }}>Export PDF (.pdf)</button>
                                </div>
                            )}
                        </div>


                    </div>
                )}
            </aside>

            {drivePickerOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
                    <div className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">Import from Google Drive</h3>
                                <p className="text-[11px] font-medium text-slate-500">Supported files: CSV, XLS, XLSX</p>
                            </div>
                            <button type="button" onClick={closeDrivePicker} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Close
                            </button>
                        </div>
                        <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {driveBreadcrumbs.map((crumb, idx) => (
                                    <button
                                        key={`${crumb.id}-${idx}`}
                                        type="button"
                                        className={`rounded px-1.5 py-0.5 font-semibold ${idx === driveBreadcrumbs.length - 1 ? "bg-slate-200 text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                                        onClick={() => {
                                            const nextCrumbs = driveBreadcrumbs.slice(0, idx + 1);
                                            const target = nextCrumbs[nextCrumbs.length - 1];
                                            fetchDriveEntries(target.id, nextCrumbs);
                                            setSelectedDriveFile(null);
                                        }}
                                    >
                                        {crumb.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="max-h-[380px] overflow-y-auto p-2">
                            {driveLoading ? (
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">Loading…</div>
                            ) : driveEntries.length ? (
                                <div className="space-y-1">
                                    {driveEntries.map((entry) => {
                                        const isFolder = String(entry.mimeType || "") === "application/vnd.google-apps.folder";
                                        const selected = selectedDriveFile?.id && selectedDriveFile.id === entry.id;
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => {
                                                    if (isFolder) {
                                                        const nextCrumbs = driveBreadcrumbs.concat([{ id: entry.id, name: entry.name || "Folder" }]);
                                                        setSelectedDriveFile(null);
                                                        fetchDriveEntries(entry.id, nextCrumbs);
                                                        return;
                                                    }
                                                    setSelectedDriveFile(entry);
                                                }}
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
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">No supported files in this folder.</div>
                            )}
                        </div>
                        <div className="p-4 space-y-3">
                            <SearchableSelect
                                options={reportSourceOptions}
                                value={selectedReportSourceId}
                                onChange={(e) => setSelectedReportSourceId(e.target.value)}
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
                                            setIsNewLabel(true);
                                            setFileLabel("");
                                        } else {
                                            setIsNewLabel(false);
                                            setFileLabel(e.target.value);
                                        }
                                    }}
                                    placeholder="Select Label"
                                    className="w-full border border-slate-300 rounded-md text-xs"
                                    panelWidth="100%"
                                />
                            )}
                            {(!selectedReportSourceId || isNewLabel || labelOptions.length <= 1) && (
                                <input
                                    type="text"
                                    value={fileLabel}
                                    onChange={(e) => setFileLabel(e.target.value.replace(/\s+/g, "_"))}
                                    placeholder="Label (required)"
                                    className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-slate-400 outline-none"
                                    maxLength={120}
                                />
                            )}
                            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={autosyncEnabled}
                                    onChange={(e) => setAutosyncEnabled(e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-slate-800 focus:ring-slate-500"
                                />
                                Auto-sync this source when the file changes
                            </label>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={closeDrivePicker} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selectedDriveFile || !fileLabel.trim()}
                                onClick={() => {
                                    if (!selectedDriveFile) return;
                                    handleGoogleDriveImport({
                                        fileId: selectedDriveFile.id,
                                        name: selectedDriveFile.name,
                                        mimeType: selectedDriveFile.mimeType,
                                        displayName: fileLabel,
                                        reportSourceId: selectedReportSourceId,
                                        reportSourceName: selectedReportSourceId ? "" : fileLabel,
                                        fileLabel: fileLabel,
                                        autosyncEnabled,
                                    });
                                    setFileLabel("");
                                    closeDrivePicker();
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedDriveFile || !fileLabel.trim() ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                                title={
                                    (!fileLabel.trim())
                                        ? "Enter a label"
                                        : !selectedDriveFile
                                            ? "Select a Google Drive file"
                                            : "Import selected file"
                                }
                            >
                                Import selected file
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {dropboxPickerOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
                    <div className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">Import from Dropbox</h3>
                                <p className="text-[11px] font-medium text-slate-500">Supported files: CSV, XLS, XLSX</p>
                            </div>
                            <button type="button" onClick={closeDropboxPicker} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Close
                            </button>
                        </div>
                        <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {dropboxBreadcrumbs.map((crumb, idx) => (
                                    <button
                                        key={`${crumb.path}-${idx}`}
                                        type="button"
                                        className={`rounded px-1.5 py-0.5 font-semibold ${idx === dropboxBreadcrumbs.length - 1 ? "bg-slate-200 text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                                        onClick={() => {
                                            const nextCrumbs = dropboxBreadcrumbs.slice(0, idx + 1);
                                            const target = nextCrumbs[nextCrumbs.length - 1];
                                            fetchDropboxEntries(target.path, nextCrumbs);
                                            setSelectedDropboxFile(null);
                                        }}
                                    >
                                        {crumb.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="max-h-[380px] overflow-y-auto p-2">
                            {dropboxLoading ? (
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">Loading…</div>
                            ) : dropboxEntries.length ? (
                                <div className="space-y-1">
                                    {dropboxEntries.map((entry) => {
                                        const isFolder = String(entry.tag || "") === "folder";
                                        const selected = selectedDropboxFile?.id && selectedDropboxFile.id === entry.id;
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => {
                                                    if (isFolder) {
                                                        const nextCrumbs = dropboxBreadcrumbs.concat([{ path: entry.pathLower || "", name: entry.name || "Folder" }]);
                                                        setSelectedDropboxFile(null);
                                                        fetchDropboxEntries(entry.pathLower || "", nextCrumbs);
                                                        return;
                                                    }
                                                    setSelectedDropboxFile(entry);
                                                }}
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
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">No supported files in this folder.</div>
                            )}
                        </div>
                        <div className="p-4 space-y-3">
                            <SearchableSelect
                                options={reportSourceOptions}
                                value={selectedReportSourceId}
                                onChange={(e) => setSelectedReportSourceId(e.target.value)}
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
                                            setIsNewLabel(true);
                                            setFileLabel("");
                                        } else {
                                            setIsNewLabel(false);
                                            setFileLabel(e.target.value);
                                        }
                                    }}
                                    placeholder="Select Label"
                                    className="w-full border border-slate-300 rounded-md text-xs"
                                    panelWidth="100%"
                                />
                            )}
                            {(!selectedReportSourceId || isNewLabel || labelOptions.length <= 1) && (
                                <input
                                    type="text"
                                    value={fileLabel}
                                    onChange={(e) => setFileLabel(e.target.value.replace(/\s+/g, "_"))}
                                    placeholder="Label (required)"
                                    className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-slate-400 outline-none"
                                    maxLength={120}
                                />
                            )}
                            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={autosyncEnabled}
                                    onChange={(e) => setAutosyncEnabled(e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-slate-800 focus:ring-slate-500"
                                />
                                Auto-sync this source when the file changes
                            </label>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={closeDropboxPicker} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selectedDropboxFile || !fileLabel.trim()}
                                onClick={() => {
                                    if (!selectedDropboxFile) return;
                                    handleDropboxImport({
                                        pathLower: selectedDropboxFile.pathLower,
                                        fileId: selectedDropboxFile.id,
                                        name: selectedDropboxFile.name,
                                        displayName: fileLabel,
                                        reportSourceId: selectedReportSourceId,
                                        reportSourceName: selectedReportSourceId ? "" : fileLabel,
                                        fileLabel: fileLabel,
                                        autosyncEnabled,
                                    });
                                    setFileLabel("");
                                    closeDropboxPicker();
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedDropboxFile || !fileLabel.trim() ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                                title={
                                    (!fileLabel.trim())
                                        ? "Enter a label"
                                        : !selectedDropboxFile
                                            ? "Select a Dropbox file"
                                            : "Import selected file"
                                }
                            >
                                Import selected file
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {oneDrivePickerOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
                    <div className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">Import from OneDrive</h3>
                                <p className="text-[11px] font-medium text-slate-500">Supported files: CSV, XLS, XLSX</p>
                            </div>
                            <button type="button" onClick={closeOneDrivePicker} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Close
                            </button>
                        </div>
                        <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {oneDriveBreadcrumbs.map((crumb, idx) => (
                                    <button
                                        key={`${crumb.id}-${idx}`}
                                        type="button"
                                        className={`rounded px-1.5 py-0.5 font-semibold ${idx === oneDriveBreadcrumbs.length - 1 ? "bg-slate-200 text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                                        onClick={() => {
                                            const nextCrumbs = oneDriveBreadcrumbs.slice(0, idx + 1);
                                            const target = nextCrumbs[nextCrumbs.length - 1];
                                            fetchOneDriveEntries(target.id, nextCrumbs);
                                            setSelectedOneDriveFile(null);
                                        }}
                                    >
                                        {crumb.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="max-h-[380px] overflow-y-auto p-2">
                            {oneDriveLoading ? (
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">Loading…</div>
                            ) : oneDriveEntries.length ? (
                                <div className="space-y-1">
                                    {oneDriveEntries.map((entry) => {
                                        const isFolder = !!entry.isFolder;
                                        const selected = selectedOneDriveFile?.id && selectedOneDriveFile.id === entry.id;
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => {
                                                    if (isFolder) {
                                                        const nextCrumbs = oneDriveBreadcrumbs.concat([{ id: entry.id, name: entry.name || "Folder" }]);
                                                        setSelectedOneDriveFile(null);
                                                        fetchOneDriveEntries(entry.id, nextCrumbs);
                                                        return;
                                                    }
                                                    setSelectedOneDriveFile(entry);
                                                }}
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
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">No supported files in this folder.</div>
                            )}
                        </div>
                        <div className="p-4 space-y-3">
                            <SearchableSelect
                                options={reportSourceOptions}
                                value={selectedReportSourceId}
                                onChange={(e) => setSelectedReportSourceId(e.target.value)}
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
                                            setIsNewLabel(true);
                                            setFileLabel("");
                                        } else {
                                            setIsNewLabel(false);
                                            setFileLabel(e.target.value);
                                        }
                                    }}
                                    placeholder="Select Label"
                                    className="w-full border border-slate-300 rounded-md text-xs"
                                    panelWidth="100%"
                                />
                            )}
                            {(!selectedReportSourceId || isNewLabel || labelOptions.length <= 1) && (
                                <input
                                    type="text"
                                    value={fileLabel}
                                    onChange={(e) => setFileLabel(e.target.value.replace(/\s+/g, "_"))}
                                    placeholder="Label (required)"
                                    className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-slate-400 outline-none"
                                    maxLength={120}
                                />
                            )}
                            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={autosyncEnabled}
                                    onChange={(e) => setAutosyncEnabled(e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-slate-300 text-slate-800 focus:ring-slate-500"
                                />
                                Auto-sync this source when the file changes
                            </label>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={closeOneDrivePicker} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selectedOneDriveFile || !fileLabel.trim()}
                                onClick={() => {
                                    if (!selectedOneDriveFile) return;
                                    handleOneDriveImport({
                                        itemId: selectedOneDriveFile.id,
                                        name: selectedOneDriveFile.name,
                                        displayName: fileLabel,
                                        reportSourceId: selectedReportSourceId,
                                        reportSourceName: selectedReportSourceId ? "" : fileLabel,
                                        fileLabel: fileLabel,
                                        autosyncEnabled,
                                    });
                                    setFileLabel("");
                                    closeOneDrivePicker();
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedOneDriveFile || !fileLabel.trim() ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                                title={
                                    (!fileLabel.trim())
                                        ? "Enter a label"
                                        : !selectedOneDriveFile
                                            ? "Select a OneDrive file"
                                            : "Import selected file"
                                }
                            >
                                Import selected file
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <StorageImportPicker
                open={storagePickers.sftp_storage.open}
                title={storageProviderMeta.sftp_storage.title}
                subtitle="Supported files: CSV, XLS, XLSX"
                provider="sftp_storage"
                breadcrumbs={storagePickers.sftp_storage.breadcrumbs}
                entries={storagePickers.sftp_storage.entries}
                loading={storagePickers.sftp_storage.loading}
                selectedEntry={storagePickers.sftp_storage.selected}
                onNavigate={(index) => navigateStoragePicker("sftp_storage", index)}
                onSelect={(entry) => handleStorageEntrySelect("sftp_storage", entry)}
                onClose={() => closeStoragePicker("sftp_storage")}
                reportSourceOptions={reportSourceOptions}
                selectedReportSourceId={storagePickers.sftp_storage.selectedReportSourceId}
                onChangeReportSourceId={(e) => setStoragePicker("sftp_storage", { selectedReportSourceId: e.target.value })}
                labelOptions={labelOptions}
                fileLabel={storagePickers.sftp_storage.fileLabel}
                onChangeFileLabel={(value) => setStoragePicker("sftp_storage", { fileLabel: value })}
                isNewLabel={storagePickers.sftp_storage.isNewLabel}
                onChangeIsNewLabel={(value) => setStoragePicker("sftp_storage", { isNewLabel: !!value })}
                autosyncEnabled={storagePickers.sftp_storage.autosyncEnabled}
                onChangeAutosyncEnabled={(value) => setStoragePicker("sftp_storage", { autosyncEnabled: !!value })}
                onImport={(entry) => handleStorageImport("sftp_storage", entry)}
            />
            <StorageImportPicker
                open={storagePickers.gcs_storage.open}
                title={storageProviderMeta.gcs_storage.title}
                subtitle="Supported files: CSV, XLS, XLSX"
                provider="gcs_storage"
                breadcrumbs={storagePickers.gcs_storage.breadcrumbs}
                entries={storagePickers.gcs_storage.entries}
                loading={storagePickers.gcs_storage.loading}
                selectedEntry={storagePickers.gcs_storage.selected}
                onNavigate={(index) => navigateStoragePicker("gcs_storage", index)}
                onSelect={(entry) => handleStorageEntrySelect("gcs_storage", entry)}
                onClose={() => closeStoragePicker("gcs_storage")}
                reportSourceOptions={reportSourceOptions}
                selectedReportSourceId={storagePickers.gcs_storage.selectedReportSourceId}
                onChangeReportSourceId={(e) => setStoragePicker("gcs_storage", { selectedReportSourceId: e.target.value })}
                labelOptions={labelOptions}
                fileLabel={storagePickers.gcs_storage.fileLabel}
                onChangeFileLabel={(value) => setStoragePicker("gcs_storage", { fileLabel: value })}
                isNewLabel={storagePickers.gcs_storage.isNewLabel}
                onChangeIsNewLabel={(value) => setStoragePicker("gcs_storage", { isNewLabel: !!value })}
                autosyncEnabled={storagePickers.gcs_storage.autosyncEnabled}
                onChangeAutosyncEnabled={(value) => setStoragePicker("gcs_storage", { autosyncEnabled: !!value })}
                onImport={(entry) => handleStorageImport("gcs_storage", entry)}
            />
            <StorageImportPicker
                open={storagePickers.s3_storage.open}
                title={storageProviderMeta.s3_storage.title}
                subtitle="Supported files: CSV, XLS, XLSX"
                provider="s3_storage"
                breadcrumbs={storagePickers.s3_storage.breadcrumbs}
                entries={storagePickers.s3_storage.entries}
                loading={storagePickers.s3_storage.loading}
                selectedEntry={storagePickers.s3_storage.selected}
                onNavigate={(index) => navigateStoragePicker("s3_storage", index)}
                onSelect={(entry) => handleStorageEntrySelect("s3_storage", entry)}
                onClose={() => closeStoragePicker("s3_storage")}
                reportSourceOptions={reportSourceOptions}
                selectedReportSourceId={storagePickers.s3_storage.selectedReportSourceId}
                onChangeReportSourceId={(e) => setStoragePicker("s3_storage", { selectedReportSourceId: e.target.value })}
                labelOptions={labelOptions}
                fileLabel={storagePickers.s3_storage.fileLabel}
                onChangeFileLabel={(value) => setStoragePicker("s3_storage", { fileLabel: value })}
                isNewLabel={storagePickers.s3_storage.isNewLabel}
                onChangeIsNewLabel={(value) => setStoragePicker("s3_storage", { isNewLabel: !!value })}
                autosyncEnabled={storagePickers.s3_storage.autosyncEnabled}
                onChangeAutosyncEnabled={(value) => setStoragePicker("s3_storage", { autosyncEnabled: !!value })}
                onImport={(entry) => handleStorageImport("s3_storage", entry)}
            />
            <StorageImportPicker
                open={storagePickers.azure_blob_storage.open}
                title={storageProviderMeta.azure_blob_storage.title}
                subtitle="Supported files: CSV, XLS, XLSX"
                provider="azure_blob_storage"
                breadcrumbs={storagePickers.azure_blob_storage.breadcrumbs}
                entries={storagePickers.azure_blob_storage.entries}
                loading={storagePickers.azure_blob_storage.loading}
                selectedEntry={storagePickers.azure_blob_storage.selected}
                onNavigate={(index) => navigateStoragePicker("azure_blob_storage", index)}
                onSelect={(entry) => handleStorageEntrySelect("azure_blob_storage", entry)}
                onClose={() => closeStoragePicker("azure_blob_storage")}
                reportSourceOptions={reportSourceOptions}
                selectedReportSourceId={storagePickers.azure_blob_storage.selectedReportSourceId}
                onChangeReportSourceId={(e) => setStoragePicker("azure_blob_storage", { selectedReportSourceId: e.target.value })}
                labelOptions={labelOptions}
                fileLabel={storagePickers.azure_blob_storage.fileLabel}
                onChangeFileLabel={(value) => setStoragePicker("azure_blob_storage", { fileLabel: value })}
                isNewLabel={storagePickers.azure_blob_storage.isNewLabel}
                onChangeIsNewLabel={(value) => setStoragePicker("azure_blob_storage", { isNewLabel: !!value })}
                autosyncEnabled={storagePickers.azure_blob_storage.autosyncEnabled}
                onChangeAutosyncEnabled={(value) => setStoragePicker("azure_blob_storage", { autosyncEnabled: !!value })}
                onImport={(entry) => handleStorageImport("azure_blob_storage", entry)}
            />

            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto scroll-smooth" ref={tableContainerRef}>
                <div className="flex flex-col min-h-full">

            {/* Pivot Controls */}
            {pivotOn && (
                <PivotOverlay
                    setPivotOn={setWorkspacePivotOn}
                    pivotRowKey={pivotRowKey} setPivotRowKey={setPivotRowKey}
                    pivotColKey={pivotColKey} setPivotColKey={setPivotColKey}
                    pivotValKey={pivotValKey} setPivotValKey={setPivotValKey}
                    pivotAgg={pivotAgg} setPivotAgg={setPivotAgg}
                    resetPivot={resetPivot}
                    displayHeaders={displayHeaders}
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={onTabChange}
                    pieData={pieData}
                    pivotRows={pivotRows}
                    pivotHeaders={pivotHeaders}
                />
            )}

            {/* Trends Overlay */}
            {trendsOn && (
                <TrendsOverlay
                    setTrendsOn={setWorkspaceTrendsOn}
                    trendsDateKey={trendsDateKey} setTrendsDateKey={setTrendsDateKey}
                    headers={displayHeaders}
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={onTabChange}
                    trendsValueKey={trendsValueKey} setTrendsValueKey={setTrendsValueKey}
                    trendGranularity={trendGranularity} setTrendGranularity={setTrendGranularity}
                    compareYears={compareYears} setCompareYears={setCompareYears}
                    trendYearOptions={trendYearOptions}
                    trendsData={trendsData}
                />
            )}

            {/* Two Condition Overlay */}
            {twoOn && (
                <TwoConditionOverlay
                    setTwoOn={setWorkspaceTwoOn}
                    condCol1={condCol1} setCondCol1={setCondCol1}
                    headers={displayHeaders}
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={onTabChange}
                    condCol2={condCol2} setCondCol2={setCondCol2}
                    valueCol={valueCol} setValueCol={setValueCol}
                    summaryData={summaryData}
                />
            )}

            <div className={`flex flex-col flex-1 min-h-0 bg-slate-50`}>
                <div id="split-container" className={`m-4 bg-white rounded-2xl shadow-2xl border border-gray-200 focus:ring-slate-100 relative z-0 flex-1 flex overflow-hidden ${comparisonOn ? 'flex-row gap-0' : 'flex-col'} ${hasChart ? 'min-h-[750px]' : 'min-h-[600px]'}`} style={comparisonOn ? { height: '650px' } : {}}>
                    {comparisonOn && splitDragging && (
                        <div
                            className="pointer-events-none absolute top-0 bottom-0 z-[60] w-0"
                            style={{ left: `${liveSplitWidth ?? splitWidth}%` }}
                        >
                            <div className="absolute -left-[1.5px] top-0 bottom-0 w-[3px] bg-indigo-500 shadow-[0_0_0_1px_rgba(255,255,255,0.85),0_0_16px_rgba(79,70,229,0.45)]" />
                        </div>
                    )}
                    
                    {/* PRIMARY GRID */}
                    <div 
                        ref={primaryGridRef}
                        className={`flex flex-col h-full min-h-0 min-w-0 ${comparisonOn ? '' : 'flex-1'}`}
                        style={comparisonOn ? { width: `${splitWidth}%`, flex: `0 0 ${splitWidth}%` } : {}}
                    >
                        <div className="sticky top-0 bg-slate-50/95 backdrop-blur border-b border-slate-200 z-30 px-3 py-2 shrink-0">
                            <div className="mb-1 text-[11px] font-bold text-slate-700">Primary Sheet</div>
                            <div className="flex flex-col gap-1">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                        <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
                                            <span className="text-[11px] font-bold text-slate-600">Sheet</span>
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <div className="relative w-full max-w-[420px] min-w-0" ref={primarySourcePickerRef}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setPrimarySourcePickerOpen((v) => !v)}
                                                        className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-[11px] font-bold shadow-sm hover:border-slate-400 transition-all flex items-center justify-between gap-2 overflow-hidden"
                                                        title={primaryPickerLabel}
                                                    >
                                                        <span className="truncate text-left">{trunc(primaryPickerLabel, 90)}</span>
                                                        <span className={`opacity-50 shrink-0 text-[10px] transition-transform ${primarySourcePickerOpen ? "rotate-180" : ""}`}>▼</span>
                                                    </button>
                                                    {primarySourcePickerOpen && (
                                                        <div className="absolute left-0 mt-1 w-[min(620px,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-2xl z-[80] p-2">
                                                            <input
                                                                autoFocus
                                                                value={primarySourceQuery}
                                                                onChange={(e) => setPrimarySourceQuery(e.target.value)}
                                                                placeholder="Search report sources or files..."
                                                                className="w-full border border-slate-100 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring focus:ring-slate-100 placeholder:text-slate-400 text-[11px] font-bold"
                                                            />
                                                            <div className="max-h-80 overflow-auto custom-scrollbar space-y-1">
                                                                {explicitSources.filter((source) => {
                                                                    const q = primarySourceQuery.trim().toLowerCase();
                                                                    if (!q) return true;
                                                                    const imports = reportSourceImports[String(source.id)] || [];
                                                                    return String(source.name || "").toLowerCase().includes(q)
                                                                        || imports.some((item) => String(resolveFileLabel(item)).toLowerCase().includes(q));
                                                                }).map((source) => {
                                                                    const key = String(source.id);
                                                                    const imports = reportSourceImports[key] || [];
                                                                    const isExpanded = primaryExpandedSources.has(key) || !!primarySourceQuery.trim();
                                                                    const groups = {};
                                                                    imports.forEach((item) => {
                                                                        const label = resolveFileLabel(item);
                                                                        if (!groups[label]) groups[label] = [];
                                                                        groups[label].push(item);
                                                                    });
                                                                    Object.values(groups).forEach((g) => g.sort((a, b) => (b.import_version || 0) - (a.import_version || 0)));
                                                                    const sortedGroups = Object.values(groups).sort((a, b) => new Date(b[0]?.uploaded_at || 0) - new Date(a[0]?.uploaded_at || 0));

                                                                    return (
                                                                        <div key={key} className="rounded-lg border border-slate-100 bg-slate-50/60 overflow-visible">
                                                                            <div className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 transition-colors">
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setPrimaryExpandedSources((prev) => {
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
                                                                                    </div>
                                                                                    <span className={`text-[10px] text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                                                                                </button>
                                                                                {source.sync_provider && source.sync_source_ref ? (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => toggleReportSourceAutosync(source.id, !source.sync_enabled)}
                                                                                        disabled={autosyncToggleBusyId === key}
                                                                                        className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${source.sync_enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"} ${autosyncToggleBusyId === key ? "opacity-60 cursor-not-allowed" : ""}`}
                                                                                        title={source.sync_enabled ? "Disable autosync" : "Enable autosync"}
                                                                                    >
                                                                                        {autosyncToggleBusyId === key ? "Saving..." : (source.sync_enabled ? "Autosync ON" : "Autosync OFF")}
                                                                                    </button>
                                                                                ) : (
                                                                                    <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-400" title="Enable autosync when importing the file">Autosync off</span>
                                                                                )}
                                                                            </div>
                                                                            {isExpanded && (
                                                                                <div className="bg-white border-t border-slate-100 py-1">
                                                                                    {sortedGroups.map((group) => {
                                                                                        const latest = group[0];
                                                                                        const label = resolveFileLabel(latest);
                                                                                        const fileKey = `${key}:${label}`;
                                                                                        const revisionMenuChars = Math.min(100, Math.max(38, String(label || "").length + 20));
                                                                                        const isSelectedGroup = group.some((i) => String(i.sheet_id) === String(sheetId));
                                                                                        const isVersionMenuOpen = primaryFileVersionMenuKey === fileKey;
                                                                                        return (
                                                                                    <div
                                                                                        key={fileKey}
                                                                                        className={`group relative flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${isSelectedGroup ? "bg-indigo-50" : "hover:bg-indigo-50/70"} ${isVersionMenuOpen ? "z-[150]" : "z-0"}`}
                                                                                        onClick={() => {
                                                                                            const nextSheetId = String(latest?.sheet_id || "");
                                                                                            if (nextSheetId && nextSheetId !== String(sheetId || "")) props.loadStored && props.loadStored(nextSheetId);
                                                                                            setPrimaryFileVersionMenuKey(null);
                                                                                            setPrimarySourcePickerOpen(false);
                                                                                        }}
                                                                                    >
                                                                                        <div className="relative z-20 w-10 shrink-0 flex justify-center file-version-dropdown-container">
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        onClick={(e) => {
                                                                                                            e.stopPropagation();
                                                                                                            setPrimaryFileVersionMenuKey(primaryFileVersionMenuKey === fileKey ? null : fileKey);
                                                                                                        }}
                                                                                                        className={`px-1.5 py-0.5 rounded-[4px] bg-slate-100 text-[9px] font-black text-slate-500 hover:bg-slate-200 transition-colors flex items-center gap-1 ${primaryFileVersionMenuKey === fileKey ? "ring-2 ring-indigo-100 bg-slate-200" : ""}`}
                                                                                                    >
                                                                                                        v{latest.import_version || "-"}<span className={`text-[8px] opacity-40 transition-transform ${primaryFileVersionMenuKey === fileKey ? "rotate-180" : ""}`}>▼</span>
                                                                                                    </button>
                                                                                                    {primaryFileVersionMenuKey === fileKey && (
                                                                                                        <div
                                                                                                            className="absolute left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-[100] py-1"
                                                                                                            style={{ width: `${revisionMenuChars}ch`, maxWidth: "min(90vw, 980px)" }}
                                                                                                       >
                                                                                                            <div className="max-h-48 overflow-auto custom-scrollbar">
                                                                                                                {group.map((v) => (
                                                                                                                    <button
                                                                                                                        key={String(v.sheet_id)}
                                                                                                                        onClick={(e) => {
                                                                                                                            e.stopPropagation();
                                                                                                                            const nextSheetId = String(v.sheet_id || "");
                                                                                                                            if (nextSheetId && nextSheetId !== String(sheetId || "")) props.loadStored && props.loadStored(nextSheetId);
                                                                                                                            setPrimaryFileVersionMenuKey(null);
                                                                                                                            setPrimarySourcePickerOpen(false);
                                                                                                                        }}
                                                                                                                        className={`w-full text-left px-2 py-1.5 hover:bg-slate-50 flex items-center gap-2 ${String(v.sheet_id) === String(sheetId) ? "bg-indigo-50/50" : ""}`}
                                                                                                                    >
                                                                                                                        <span className="w-7 shrink-0 text-[8px] font-black text-slate-400 text-center">v{v.import_version}</span>
                                                                                                                        <div className="min-w-0 flex-1">
                                                                                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                                                                                <SourceProviderIcon provider={source.sync_provider} className="h-3 w-3 shrink-0 text-slate-500" />
                                                                                                                                <div className="text-[10px] font-bold text-slate-700 whitespace-nowrap">
                                                                                                                                    {label}
                                                                                                                                    {v.uploaded_at ? ` · Updated: ${new Date(v.uploaded_at).toLocaleDateString()}` : ""}
                                                                                                                                </div>
                                                                                                                            </div>
                                                                                                                        </div>
                                                                                                                    </button>
                                                                                                                ))}
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>
                                                                                                <div className="min-w-0 flex-1">
                                                                                                    <div className="text-[11px] font-bold text-slate-800 truncate">
                                                                                                        {label}
                                                                                                        {latest.uploaded_at ? ` · Updated: ${new Date(latest.uploaded_at).toLocaleDateString()}` : ""}
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-1">
                                            <span className="text-[10px] font-bold text-slate-600">Compare</span>
                                            <div className="relative w-full max-w-[170px] min-w-0 primary-compare-picker">
                                                <button
                                                    type="button"
                                                    onClick={() => setPrimaryComparePickerOpen((v) => !v)}
                                                    className="w-full h-7 px-2 rounded-md border border-slate-300 bg-white text-slate-900 text-[10px] font-bold shadow-sm hover:border-slate-400 transition-all flex items-center justify-between gap-1 overflow-hidden"
                                                    title={primaryCompareLabel}
                                                >
                                                    <span className="truncate text-left">{trunc(primaryCompareLabel, 48)}</span>
                                                    <span className={`opacity-50 shrink-0 text-[9px] transition-transform ${primaryComparePickerOpen ? "rotate-180" : ""}`}>▼</span>
                                                </button>
                                                {primaryComparePickerOpen && (
                                                    <div className="absolute left-0 mt-1 w-[min(280px,calc(100vw-1rem))] rounded-xl border border-slate-200 bg-white shadow-2xl z-[80] p-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setPrimaryCompareSheetId("");
                                                                setPrimaryComparePickerOpen(false);
                                                            }}
                                                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[10px] font-bold ${!primaryCompareSheetId ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"}`}
                                                        >
                                                            Off
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setPrimaryCompareExpanded((v) => !v)}
                                                            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 mt-1 rounded-lg hover:bg-slate-50 transition-colors"
                                                        >
                                                            <span className="text-[10px] font-black text-slate-700">Revisions</span>
                                                            <span className={`text-[9px] text-slate-400 transition-transform ${primaryCompareExpanded ? "rotate-180" : ""}`}>▼</span>
                                                        </button>
                                                        {primaryCompareExpanded && (
                                                            <div className="max-h-56 overflow-auto custom-scrollbar space-y-1 mt-1">
                                                                {primaryRevisionOptions.map((opt) => (
                                                                    <button
                                                                        key={`p-compare-${opt.value}`}
                                                                        type="button"
                                                                        disabled={!!opt.isCurrent}
                                                                        onClick={() => {
                                                                            if (opt.isCurrent) return;
                                                                            setPrimaryCompareSheetId(String(opt.value));
                                                                            setPrimaryComparePickerOpen(false);
                                                                        }}
                                                                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[10px] font-bold ${opt.isCurrent ? "text-slate-400 bg-slate-50 cursor-not-allowed" : (String(primaryCompareSheetId) === String(opt.value) ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50")}`}
                                                                    >
                                                                        {opt.label}{opt.isCurrent ? " (Current)" : ""}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {canManageViews && (
                                        <div className="flex items-center justify-end gap-1.5 shrink-0">
                                            <button
                                                type="button"
                                                className={`btn-premium px-2.5 py-1 text-[10px] font-bold rounded-md border-none ${selectionModeOn ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                                                onClick={() => {
                                                    setSelectionModeOn((v) => {
                                                        const next = !v;
                                                        if (!next) clearSelection();
                                                        return next;
                                                    });
                                                }}
                                            >
                                                {selectionModeOn ? "Selection On" : "Selection Off"}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn-premium bg-slate-100 text-slate-700 hover:bg-slate-200 px-2.5 py-1 text-[10px] font-bold rounded-md border-none"
                                                onClick={clearSelection}
                                            >
                                                Clear
                                            </button>
                                            <button
                                                type="button"
                                                disabled={selectedPrimaryColumns.length === 0 || selectedPrimaryRowIndexes.length === 0}
                                                className={`btn-premium px-2.5 py-1 text-[10px] font-bold rounded-md border-none ${(selectedPrimaryColumns.length > 0 && selectedPrimaryRowIndexes.length > 0) ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-500 cursor-not-allowed"}`}
                                                onClick={createLockedViewFromSelection}
                                            >
                                                Create View From Selection
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {comparisonOn && (
                                    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-1">
                                        <span className="text-[10px] font-bold text-slate-600">Columns</span>
                                        <div style={{ width: `${primaryFieldsMenuWidthCh}ch`, maxWidth: "100%" }}>
                                            <MultiSelect
                                                options={displayHeaders}
                                                value={primaryFields}
                                                onChange={setPrimaryFields}
                                                placeholder="Select columns..."
                                                className="w-full"
                                                activeColor="blue"
                                                dense
                                            />
                                        </div>
                                    </div>
                                )}
                                {primaryCompareSheetId && primaryMissingColumns.length > 0 && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-800">
                                        Warning: Compared revision is missing {primaryMissingColumns.length} column(s): {primaryMissingColumns.join(", ")}
                                    </div>
                                )}
                            </div>
                        </div>

                        {sortedData?.length > 0 ? (
                            <>

                                <div className="flex-1 w-full flex flex-col min-h-0">
                                    <div
                                        className="flex bg-slate-100 border-b border-slate-200 shadow-sm z-10 overflow-hidden shrink-0 h-10 items-center no-scrollbar"
                                        style={{ width: "100%" }}
                                        ref={headerRef}
                                    >
                                        <div style={{ display: 'flex', width: totalRowWidth, height: '100%' }}>
                                            {activePrimaryFields.map((h, colIndex) => (
                                                <div
                                                    key={h}
                                                    ref={(el) => {
                                                        if (filterAnchorRefs?.current) filterAnchorRefs.current[h] = el;
                                                    }}
                                                    style={{ width: colWidths[h] || 180, minWidth: colWidths[h] || 180 }}
                                                    className={`table-pro-text relative border-r border-slate-200 px-3 py-1.5 text-[11px] text-left cursor-pointer group flex items-center justify-between hover:bg-slate-200 transition-colors text-slate-800 font-bold h-full ${isPrimaryColumnSelected(colIndex) ? "bg-indigo-100" : "bg-slate-100"} ${primaryMissingColumns.includes(h) ? "!bg-rose-50 !text-rose-800 ring-1 ring-inset ring-rose-200" : ""}`}
                                                    onClick={(e) => {
                                                        const isFilterBtn = e.target.closest && e.target.closest(".filter-btn");
                                                        if (selectionModeOn && !isFilterBtn) {
                                                            e.preventDefault();
                                                            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                                                                clearExplicitSelections();
                                                            }
                                                            applyColumnSelection(colIndex, e);
                                                            return;
                                                        }
                                                        if (!isFilterBtn) requestSort(h);
                                                    }}
                                                >
                                                    <span className="truncate">{h}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        {sortConfig?.key === h && <span className="text-[9px]">{sortConfig.direction === "asc" ? "▲" : "▼"}</span>}
                                                        <button
                                                            type="button"
                                                            ref={(el) => {
                                                                if (filterBtnRefs?.current) filterBtnRefs.current[h] = el;
                                                            }}
                                                            className={`filter-btn h-5 px-1 rounded transition-all flex items-center justify-center ${columnFilters[h] && columnFilters[h] instanceof Set && columnFilters[h].size > 0
                                                                ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300"
                                                                : "bg-slate-200 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-300 hover:text-slate-600"
                                                                }`}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setOpenFilterCol((prev) => (prev === h ? null : h));
                                                            }}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                                                        </button>
                                                    </div>

                                                    {/* Filter Menu Rendering */}
                                                    {openFilterCol === h && (
                                                        <ColumnFilterMenu
                                                            anchorMapRef={filterAnchorRefs}
                                                            tableContainerRef={tableContainerRef}
                                                            columnKey={h}
                                                            column={h}
                                                            allValues={getCachedUniqueValues(sheetId, activeTab, h)}
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
                                                            fetchUniqueValues={fetchUniqueValues}
                                                            sheetId={sheetId}
                                                            activeTab={activeTab}
                                                        />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex-1 min-h-0 relative">
                                        <div className="absolute inset-0">
                                            <AutoSizer key={comparisonOn ? 'split-primary' : 'single-primary'}>
                                                {({ height, width }) => (
                                                    <List
                                                        ref={primaryListRef}
                                                        outerRef={primaryOuterRef}
                                                        height={height}
                                                        itemCount={sortedData.length}
                                                        itemSize={36}
                                                        width={width}
                                                        onItemsRendered={handleItemsRendered}
                                                        onScroll={handlePrimaryScroll}
                                                        outerElementType={PrimaryOuterElement}
                                                        innerElementType={({ style, ...rest }) => (
                                                            <div style={{ ...style, width: totalRowWidth, position: 'relative' }} {...rest} />
                                                        )}
                                                    >
                                                        {({ index, style }) => {
                                                            const row = sortedData[index];
                                                            return (
                                                                <div
                                                                    style={{ ...style, width: totalRowWidth, minWidth: "100%" }}
                                                                    className={`flex ${index % 2 === 1 ? "bg-slate-50" : "bg-white"} hover:bg-indigo-50/50 transition-colors border-b border-slate-100 items-center h-8`}
                                                                >
                                                                    {activePrimaryFields.map((h, colIndex) => (
                                                                        <div
                                                                            key={h}
                                                                            style={{ width: colWidths[h] || 180, minWidth: colWidths[h] || 180 }}
                                                                            className={`border-r border-slate-100 px-3 text-[11px] text-slate-700 truncate h-full flex items-center ${selectionModeOn ? "cursor-crosshair select-none" : ""} ${isPrimaryCellSelected(index, colIndex) ? "bg-indigo-100 ring-1 ring-inset ring-indigo-300" : ""} ${primaryDiffCellSet.has(`${index}::${h}`) ? "bg-amber-50 ring-1 ring-inset ring-amber-300 font-bold text-slate-900" : ""}`}
                                                                            onMouseDown={(e) => {
                                                                                if (!selectionModeOn) return;
                                                                                e.preventDefault();
                                                                                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                                                                    applyRowSelection(index, e);
                                                                                    return;
                                                                                }
                                                                                clearExplicitSelections();
                                                                                isSelectingRef.current = true;
                                                                                dragPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
                                                                                setIsSelecting(true);
                                                                                document.body.style.userSelect = "none";
                                                                                document.body.style.cursor = "crosshair";
                                                                                setSelectionAnchor({ row: index, col: colIndex });
                                                                                queueSelectionFocusUpdate({ row: index, col: colIndex });
                                                                            }}
                                                                            onMouseEnter={() => {
                                                                                if (!selectionModeOn || !isSelectingRef.current) return;
                                                                                queueSelectionFocusUpdate({ row: index, col: colIndex });
                                                                            }}
                                                                        >
                                                                            {typeof row[h] === 'number' ? formatSmart(row[h], h) : renderMaybeDate(h, row[h])}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        }}
                                                    </List>
                                                )}
                                            </AutoSizer>
                                        </div>
                                        {isBatchLoading && (
                                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-3 py-1 rounded-full text-[9px] font-bold shadow-lg animate-bounce z-50">
                                                Loading rows...
                                            </div>
                                        )}
                                    </div>
                                    {tabs && tabs.length > 1 && (
                                        <div className="sticky bottom-0 z-30 bg-white border-t border-slate-200">
                                            <SheetTabBar
                                                tabs={tabs}
                                                activeTab={activeTab}
                                                onTabClick={onTabChange}
                                            />
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="text-gray-400 text-center py-20 text-xs">Select primary sheet.</div>
                        )}
                    </div>

                    {/* RESIZER */}
                    {comparisonOn && (
                        <div 
                            className={`w-1.5 h-full cursor-col-resize transition-colors z-20 flex items-center justify-center group ${splitDragging ? "bg-indigo-500" : "bg-slate-200 hover:bg-indigo-400"}`}
                            onMouseDown={handleMouseDown}
                        >
                            <div className={`w-px transition-all ${splitDragging ? "h-16 bg-white" : "h-8 bg-slate-400 group-hover:bg-white"}`} />
                        </div>
                    )}

                    {/* SECONDARY GRID */}
                    {comparisonOn && (
                        <div 
                            ref={secondaryGridRef}
                            className="flex flex-col h-full min-h-0 min-w-0 bg-slate-50/30"
                            style={{ width: `${100 - splitWidth}%`, flex: `1 1 ${100 - splitWidth}%` }}
                        >
                            <div className="sticky top-0 bg-slate-100/95 backdrop-blur border-b border-slate-200 z-30 px-3 py-2 shrink-0">
                                <div className="mb-1 text-[11px] font-bold text-slate-700">Secondary Sheet</div>
                                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_170px_170px] gap-1">
                                    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
                                        <span className="text-[11px] font-bold text-slate-600">Sheet</span>
                                        <div className="relative w-full max-w-[420px] min-w-0" ref={secondarySourcePickerRef}>
                                            <button
                                                type="button"
                                                onClick={() => setSecondarySourcePickerOpen((v) => !v)}
                                                className="w-full h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-[11px] font-bold shadow-sm hover:border-slate-400 transition-all flex items-center justify-between gap-2 overflow-hidden"
                                                title={secondaryPickerLabel}
                                            >
                                                <span className="truncate text-left">{trunc(secondaryPickerLabel, 90)}</span>
                                                <span className={`opacity-50 shrink-0 text-[10px] transition-transform ${secondarySourcePickerOpen ? "rotate-180" : ""}`}>▼</span>
                                            </button>
                                            {secondarySourcePickerOpen && (
                                                <div className="absolute left-0 mt-1 w-[min(620px,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-2xl z-[80] p-2">
                                                    <input
                                                        autoFocus
                                                        value={secondarySourceQuery}
                                                        onChange={(e) => setSecondarySourceQuery(e.target.value)}
                                                        placeholder="Search report sources or files..."
                                                        className="w-full border border-slate-100 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring focus:ring-slate-100 placeholder:text-slate-400 text-[11px] font-bold"
                                                    />
                                                    <div className="max-h-80 overflow-auto custom-scrollbar space-y-1">
                                                        {explicitSources.filter((source) => {
                                                            const q = secondarySourceQuery.trim().toLowerCase();
                                                            if (!q) return true;
                                                            const imports = reportSourceImports[String(source.id)] || [];
                                                            return String(source.name || "").toLowerCase().includes(q)
                                                                || imports.some((item) => String(resolveFileLabel(item)).toLowerCase().includes(q));
                                                        }).map((source) => {
                                                            const key = String(source.id);
                                                            const imports = reportSourceImports[key] || [];
                                                            const isExpanded = secondaryExpandedSources.has(key) || !!secondarySourceQuery.trim();
                                                            const groups = {};
                                                            imports.forEach((item) => {
                                                                const label = resolveFileLabel(item);
                                                                if (!groups[label]) groups[label] = [];
                                                                groups[label].push(item);
                                                            });
                                                            Object.values(groups).forEach((g) => g.sort((a, b) => (b.import_version || 0) - (a.import_version || 0)));
                                                            const sortedGroups = Object.values(groups).sort((a, b) => new Date(b[0]?.uploaded_at || 0) - new Date(a[0]?.uploaded_at || 0));

                                                                    return (
                                                                    <div key={key} className="rounded-lg border border-slate-100 bg-slate-50/60 overflow-visible">
                                                                    <div className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-100 transition-colors">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setSecondaryExpandedSources((prev) => {
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
                                                                                        </div>
                                                                            <span className={`text-[10px] text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                                                                        </button>
                                                                        {source.sync_provider && source.sync_source_ref ? (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => toggleReportSourceAutosync(source.id, !source.sync_enabled)}
                                                                                disabled={autosyncToggleBusyId === key}
                                                                                className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${source.sync_enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"} ${autosyncToggleBusyId === key ? "opacity-60 cursor-not-allowed" : ""}`}
                                                                                title={source.sync_enabled ? "Disable autosync" : "Enable autosync"}
                                                                            >
                                                                                {autosyncToggleBusyId === key ? "Saving..." : (source.sync_enabled ? "Autosync ON" : "Autosync OFF")}
                                                                            </button>
                                                                        ) : (
                                                                            <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-400" title="Enable autosync when importing the file">Autosync off</span>
                                                                        )}
                                                                    </div>
                                                                    {isExpanded && (
                                                                        <div className="bg-white border-t border-slate-100 py-1">
                                                                            {sortedGroups.map((group) => {
                                                                                const latest = group[0];
                                                                                const label = resolveFileLabel(latest);
                                                                                const fileKey = `${key}:${label}`;
                                                                                const isSelectedGroup = group.some((i) => String(i.sheet_id) === String(secondarySheetId));
                                                                                const isVersionMenuOpen = secondaryFileVersionMenuKey === fileKey;
                                                                                return (
                                                                                    <div
                                                                                        key={fileKey}
                                                                                        className={`group relative flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${isSelectedGroup ? "bg-emerald-50" : "hover:bg-emerald-50/70"} ${isVersionMenuOpen ? "z-[150]" : "z-0"}`}
                                                                                        onClick={() => {
                                                                                            const nextSheetId = String(latest?.sheet_id || "");
                                                                                            if (nextSheetId) setSecondarySheetId(nextSheetId);
                                                                                            setSecondaryFileVersionMenuKey(null);
                                                                                            setSecondarySourcePickerOpen(false);
                                                                                        }}
                                                                                    >
                                                                                        <div className="relative z-20 w-10 shrink-0 flex justify-center file-version-dropdown-container">
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={(e) => {
                                                                                                    e.stopPropagation();
                                                                                                    setSecondaryFileVersionMenuKey(secondaryFileVersionMenuKey === fileKey ? null : fileKey);
                                                                                                }}
                                                                                                className={`px-1.5 py-0.5 rounded-[4px] bg-slate-100 text-[9px] font-black text-slate-500 hover:bg-slate-200 transition-colors flex items-center gap-1 ${secondaryFileVersionMenuKey === fileKey ? "ring-2 ring-emerald-100 bg-slate-200" : ""}`}
                                                                                            >
                                                                                                v{latest.import_version || "-"}<span className={`text-[8px] opacity-40 transition-transform ${secondaryFileVersionMenuKey === fileKey ? "rotate-180" : ""}`}>▼</span>
                                                                                            </button>
                                                                                            {secondaryFileVersionMenuKey === fileKey && (
                                                                                                <div
                                                                                                    className="absolute left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-[100] py-1"
                                                                                                    style={{ width: `${Math.min(100, Math.max(38, String(label || "").length + 20))}ch`, maxWidth: "min(90vw, 980px)" }}
                                                                                                >
                                                                                                    <div className="max-h-48 overflow-auto custom-scrollbar">
                                                                                                        {group.map((v) => (
                                                                                                            <button
                                                                                                                key={String(v.sheet_id)}
                                                                                                                onClick={(e) => {
                                                                                                                    e.stopPropagation();
                                                                                                                    const nextSheetId = String(v.sheet_id || "");
                                                                                                                    if (nextSheetId) setSecondarySheetId(nextSheetId);
                                                                                                                    setSecondaryFileVersionMenuKey(null);
                                                                                                                    setSecondarySourcePickerOpen(false);
                                                                                                                }}
                                                                                                                className={`w-full text-left px-2 py-1.5 hover:bg-slate-50 flex items-center gap-2 ${String(v.sheet_id) === String(secondarySheetId) ? "bg-emerald-50/50" : ""}`}
                                                                                                            >
                                                                                                                <span className="w-7 shrink-0 text-[8px] font-black text-slate-400 text-center">v{v.import_version}</span>
                                                                                                                <div className="min-w-0 flex-1">
                                                                                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                                                                                        <SourceProviderIcon provider={source.sync_provider} className="h-3 w-3 shrink-0 text-slate-500" />
                                                                                                                        <div className="text-[10px] font-bold text-slate-700 whitespace-nowrap">
                                                                                                                            {label}
                                                                                                                            {v.uploaded_at ? ` · Updated: ${new Date(v.uploaded_at).toLocaleDateString()}` : ""}
                                                                                                                        </div>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                            </button>
                                                                                                        ))}
                                                                                                    </div>
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                        <div className="min-w-0 flex-1">
                                                                                            <div className="text-[11px] font-bold text-slate-800 truncate">
                                                                                                {label}
                                                                                                {latest.uploaded_at ? ` · Updated: ${new Date(latest.uploaded_at).toLocaleDateString()}` : ""}
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-1">
                                        <span className="text-[10px] font-bold text-slate-600">Compare</span>
                                        <div className="relative w-full max-w-[170px] min-w-0 secondary-compare-picker">
                                            <button
                                                type="button"
                                                onClick={() => setSecondaryComparePickerOpen((v) => !v)}
                                                className="w-full h-7 px-2 rounded-md border border-slate-300 bg-white text-slate-900 text-[10px] font-bold shadow-sm hover:border-slate-400 transition-all flex items-center justify-between gap-1 overflow-hidden"
                                                title={secondaryCompareLabel}
                                            >
                                                <span className="truncate text-left">{trunc(secondaryCompareLabel, 48)}</span>
                                                <span className={`opacity-50 shrink-0 text-[9px] transition-transform ${secondaryComparePickerOpen ? "rotate-180" : ""}`}>▼</span>
                                            </button>
                                            {secondaryComparePickerOpen && (
                                                <div className="absolute left-0 mt-1 w-[min(280px,calc(100vw-1rem))] rounded-xl border border-slate-200 bg-white shadow-2xl z-[80] p-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSecondaryCompareSheetId("");
                                                            setSecondaryComparePickerOpen(false);
                                                        }}
                                                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[10px] font-bold ${!secondaryCompareSheetId ? "bg-emerald-50 text-emerald-700" : "text-slate-700 hover:bg-slate-50"}`}
                                                    >
                                                        Off
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSecondaryCompareExpanded((v) => !v)}
                                                        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 mt-1 rounded-lg hover:bg-slate-50 transition-colors"
                                                    >
                                                        <span className="text-[10px] font-black text-slate-700">Revisions</span>
                                                        <span className={`text-[9px] text-slate-400 transition-transform ${secondaryCompareExpanded ? "rotate-180" : ""}`}>▼</span>
                                                    </button>
                                                    {secondaryCompareExpanded && (
                                                        <div className="max-h-56 overflow-auto custom-scrollbar space-y-1 mt-1">
                                                            {secondaryRevisionOptions.map((opt) => (
                                                                <button
                                                                    key={`s-compare-${opt.value}`}
                                                                    type="button"
                                                                    disabled={!!opt.isCurrent}
                                                                    onClick={() => {
                                                                        if (opt.isCurrent) return;
                                                                        setSecondaryCompareSheetId(String(opt.value));
                                                                        setSecondaryComparePickerOpen(false);
                                                                    }}
                                                                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[10px] font-bold ${opt.isCurrent ? "text-slate-400 bg-slate-50 cursor-not-allowed" : (String(secondaryCompareSheetId) === String(opt.value) ? "bg-emerald-50 text-emerald-700" : "text-slate-700 hover:bg-slate-50")}`}
                                                                >
                                                                    {opt.label}{opt.isCurrent ? " (Current)" : ""}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-1">
                                        <span className="text-[10px] font-bold text-slate-600">Columns</span>
                                        <div style={{ width: `${secondaryFieldsMenuWidthCh}ch`, maxWidth: "100%" }}>
                                            <MultiSelect
                                                options={secondaryHeaders}
                                                value={secondaryFields}
                                                onChange={setSecondaryFields}
                                                placeholder="Select columns..."
                                                className="w-full"
                                                activeColor="emerald"
                                                dense
                                            />
                                        </div>
                                    </div>
                                    {secondaryCompareSheetId && secondaryMissingColumns.length > 0 && (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-800">
                                            Warning: Compared revision is missing {secondaryMissingColumns.length} column(s): {secondaryMissingColumns.join(", ")}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {secondaryData?.length > 0 ? (
                                <>
                                    <div className="flex-1 w-full flex flex-col min-h-0">
                                        <div 
                                            className="flex bg-slate-200/50 border-b border-slate-200 shadow-sm z-10 overflow-hidden shrink-0 h-10 items-center"
                                            ref={secondaryHeaderRef}
                                        >
                                            <div style={{ display: 'flex', width: secondaryTotalWidth, height: '100%' }}>
                                                {activeSecondaryFields.map((h, colIndex) => (
                                                    <div
                                                        key={h}
                                                        ref={(el) => {
                                                            if (filterAnchorRefs?.current) filterAnchorRefs.current[`sec_${h}`] = el;
                                                        }}
                                                        style={{ width: 180, minWidth: 180 }}
                                                        className={`px-3 py-1.5 text-[11px] font-bold text-slate-700 border-r border-slate-200 truncate h-full flex items-center justify-between group hover:bg-slate-300 transition-colors relative cursor-pointer ${selectionModeOn ? "cursor-crosshair select-none" : ""} ${isSecondaryColumnSelected(colIndex) ? "bg-indigo-100 ring-1 ring-inset ring-indigo-300" : ""} ${secondaryMissingColumns.includes(h) ? "!bg-rose-50 !text-rose-800 ring-1 ring-inset ring-rose-200" : ""}`}
                                                        onClick={(e) => {
                                                            const isFilterBtn = e.target.closest && e.target.closest(".filter-btn");
                                                            if (selectionModeOn && !isFilterBtn) {
                                                                e.preventDefault();
                                                                applySecondaryColumnSelection(colIndex, e);
                                                                return;
                                                            }
                                                            if (!isFilterBtn) {
                                                                // No secondary sort logic currently implemented in the same way, but keeping UI consistent
                                                            }
                                                        }}
                                                    >
                                                        <span className="truncate">{h}</span>
                                                        <button
                                                            type="button"
                                                            ref={(el) => {
                                                                if (filterBtnRefs?.current) filterBtnRefs.current[`sec_${h}`] = el;
                                                            }}
                                                            className={`filter-btn h-5 px-1 rounded transition-all flex items-center justify-center ${secondaryColumnFilters[h] && secondaryColumnFilters[h] instanceof Set && secondaryColumnFilters[h].size > 0
                                                                ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300"
                                                                : "bg-slate-300 text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-slate-400 hover:text-slate-700"
                                                                }`}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setOpenFilterCol((prev) => (prev === `sec_${h}` ? null : `sec_${h}`));
                                                            }}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                                                        </button>

                                                        {openFilterCol === `sec_${h}` && (
                                                            <ColumnFilterMenu
                                                                anchorMapRef={filterAnchorRefs}
                                                                tableContainerRef={tableContainerRef}
                                                                columnKey={`sec_${h}`}
                                                                column={h}
                                                                allValues={getCachedUniqueValues(secondarySheetId, secondaryTab, h)}
                                                                appliedSelected={secondaryColumnFilters[h] && secondaryColumnFilters[h] instanceof Set ? secondaryColumnFilters[h] : null}
                                                                onApply={(col, set) => {
                                                                    const next = { ...secondaryColumnFilters };
                                                                    if (set === null) delete next[col];
                                                                    else next[col] = new Set(set);
                                                                    setSecondaryColumnFilters(next);
                                                                    reloadSecondaryWithFilters(next);
                                                                }}
                                                                onClear={(col) => {
                                                                    const next = { ...secondaryColumnFilters };
                                                                    delete next[col];
                                                                    setSecondaryColumnFilters(next);
                                                                    reloadSecondaryWithFilters(next);
                                                                }}
                                                                onClose={() => setOpenFilterCol(null)}
                                                                fetchUniqueValues={fetchUniqueValues}
                                                                sheetId={secondarySheetId}
                                                                activeTab={secondaryTab}
                                                            />
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="flex-1 min-h-0 relative">
                                            <div className="absolute inset-0">
                                                <AutoSizer key="split-secondary">
                                                    {({ height, width }) => (
                                                        <List
                                                            ref={secondaryListRef}
                                                            height={height}
                                                            itemCount={filteredSecondaryData.length}
                                                            itemSize={36}
                                                            width={width}
                                                            onItemsRendered={handleSecondaryItemsRendered}
                                                            onScroll={handleSecondaryScroll}
                                                            outerElementType={SecondaryOuterElement}
                                                            innerElementType={({ style, ...rest }) => (
                                                                <div style={{ ...style, width: secondaryTotalWidth, position: 'relative' }} {...rest} />
                                                            )}
                                                        >
                                                            {({ index, style }) => {
                                                                const row = filteredSecondaryData[index];
                                                                return (
                                                                    <div style={style} className={`flex ${index % 2 === 1 ? "bg-slate-100/30" : "bg-white"} border-b border-slate-100 items-center h-8`}>
                                                                        {activeSecondaryFields.map((h, colIndex) => (
                                                                            <div
                                                                                key={h}
                                                                                style={{ width: 180, minWidth: 180 }}
                                                                                className={`border-r border-slate-100 px-3 text-[11px] text-slate-600 truncate h-full flex items-center ${selectionModeOn ? "cursor-crosshair select-none" : ""} ${isSecondaryCellSelected(index, colIndex) ? "bg-indigo-100 ring-1 ring-inset ring-indigo-300" : ""} ${secondaryDiffCellSet.has(`${index}::${h}`) ? "bg-amber-50 ring-1 ring-inset ring-amber-300 font-bold text-slate-900" : ""}`}
                                                                                onMouseDown={(e) => {
                                                                                    if (!selectionModeOn) return;
                                                                                    e.preventDefault();
                                                                                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                                                                        applySecondaryRowSelection(index, e);
                                                                                        return;
                                                                                    }
                                                                                    // Drag area selection for secondary pane (independent from primary).
                                                                                    setSecondarySelectedRowIndexes(new Set([index]));
                                                                                    setSecondarySelectedColIndexes(new Set([colIndex]));
                                                                                    setSecondaryLastRowSelectionIndex(index);
                                                                                    setSecondaryLastColSelectionIndex(colIndex);
                                                                                    secondaryDragAnchorRef.current = { row: index, col: colIndex };
                                                                                    secondaryIsSelectingRef.current = true;
                                                                                    document.body.style.userSelect = "none";
                                                                                    document.body.style.cursor = "crosshair";
                                                                                }}
                                                                                onMouseEnter={() => {
                                                                                    if (!selectionModeOn || !secondaryIsSelectingRef.current || !secondaryDragAnchorRef.current) return;
                                                                                    const anchor = secondaryDragAnchorRef.current;
                                                                                    const rowStart = Math.min(anchor.row, index);
                                                                                    const rowEnd = Math.max(anchor.row, index);
                                                                                    const colStart = Math.min(anchor.col, colIndex);
                                                                                    const colEnd = Math.max(anchor.col, colIndex);
                                                                                    const nextRows = new Set();
                                                                                    const nextCols = new Set();
                                                                                    for (let r = rowStart; r <= rowEnd; r += 1) nextRows.add(r);
                                                                                    for (let c = colStart; c <= colEnd; c += 1) nextCols.add(c);
                                                                                    setSecondarySelectedRowIndexes(nextRows);
                                                                                    setSecondarySelectedColIndexes(nextCols);
                                                                                }}
                                                                            >
                                                                                {typeof row[h] === 'number' ? formatSmart(row[h], h) : renderMaybeDate(h, row[h])}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                );
                                                            }}
                                                        </List>
                                                    )}
                                                </AutoSizer>
                                            </div>
                                            {secondaryIsBatchLoading && (
                                                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-3 py-1 rounded-full text-[9px] font-bold shadow-lg animate-bounce z-50">
                                                    Loading rows...
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                                    <div className="text-4xl mb-3">◫</div>
                                    <div className="text-slate-400 font-bold text-[11px] uppercase tracking-widest">Select comparison sheet</div>
                                </div>
                            )}
                            {secondaryIsBatchLoading && (
                                <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-50">
                                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                </div>
            </div>
            </div>
            {insightsOn && (
                <aside className="w-[22rem] shrink-0 h-full border-l border-slate-200 bg-slate-50 p-3 overflow-y-auto">
                    <InsightFeed
                        sheetId={sheetId}
                        context="workspace"
                        user={user}
                        onApplyFilter={onInsightApplyFilter}
                        onOpenChart={openWorkspaceInsightChart}
                        onSaveView={onInsightSaveView}
                        locale={locale}
                        copy={copy}
                    />
                </aside>
            )}
        </div>
    );
}
