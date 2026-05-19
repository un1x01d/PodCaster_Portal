import React, { useMemo, useState, useEffect, useCallback } from "react";
import axios from "axios";

export function useDashboardStoragePickers({
  API,
  token,
  reportSources,
  refreshReportSources,
  selectedReportSourceId,
  setSheetId,
  setSelectedFileName,
  setTabs,
  onTabChange,
  tabListCacheRef,
  setFileLabel,
  loadData,
}) {
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
  const [newReportSourceName, setNewReportSourceName] = useState("");
  const [autosyncEnabled, setAutosyncEnabled] = useState(false);
  const [autosyncToggleBusyId, setAutosyncToggleBusyId] = useState("");
  const [expandedMenus, setExpandedMenus] = useState({ charts: false, export: false, admin: false });

  const [storagePickers, setStoragePickers] = useState({
    sftp_storage: { open: false, entries: [], loading: false, breadcrumbs: [{ path: "", name: "SFTP" }], selected: null, selectedReportSourceId: "", newReportSourceName: "", fileLabel: "", isNewLabel: false, autosyncEnabled: false },
    gcs_storage: { open: false, entries: [], loading: false, breadcrumbs: [{ path: "", name: "Google Cloud Storage" }], selected: null, selectedReportSourceId: "", newReportSourceName: "", fileLabel: "", isNewLabel: false, autosyncEnabled: false },
    s3_storage: { open: false, entries: [], loading: false, breadcrumbs: [{ path: "", name: "Amazon S3" }], selected: null, selectedReportSourceId: "", newReportSourceName: "", fileLabel: "", isNewLabel: false, autosyncEnabled: false },
    azure_blob_storage: { open: false, entries: [], loading: false, breadcrumbs: [{ path: "", name: "Azure Blob Storage" }], selected: null, selectedReportSourceId: "", newReportSourceName: "", fileLabel: "", isNewLabel: false, autosyncEnabled: false },
  });

  const storageProviderMeta = useMemo(() => ({
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

  const toggleReportSourceAutosync = useCallback(async (sourceId, nextEnabled) => {
    const id = String(sourceId || "");
    if (!id || autosyncToggleBusyId) return;
    setAutosyncToggleBusyId(id);
    try {
      await axios.patch(`${API}/report-sources/${id}/autosync`, { enabled: !!nextEnabled }, { headers: { Authorization: `Bearer ${token}` } });
      await refreshReportSources();
    } catch (e) {
      alert(e?.response?.data?.error || "Failed to update autosync setting");
    } finally {
      setAutosyncToggleBusyId("");
    }
  }, [API, token, autosyncToggleBusyId, refreshReportSources]);

  const toggleMenu = useCallback((key) => {
    setExpandedMenus((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setStoragePicker = useCallback((provider, patch) => {
    setStoragePickers((prev) => ({ ...prev, [provider]: { ...prev[provider], ...patch } }));
  }, []);

  const resetStoragePicker = useCallback((provider, rootName) => {
    setStoragePickers((prev) => ({
      ...prev,
      [provider]: {
        open: false,
        entries: [],
        loading: false,
        breadcrumbs: [{ path: "", name: rootName }],
        selected: null,
        selectedReportSourceId: "",
        newReportSourceName: "",
        fileLabel: "",
        isNewLabel: false,
        autosyncEnabled: false,
      },
    }));
  }, []);

  const fetchStorageEntries = useCallback(async (provider, nextPath = "", nextBreadcrumbs = null) => {
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

  const openStoragePicker = useCallback((provider) => {
    const meta = storageProviderMeta[provider];
    if (!meta) return;
    setStoragePicker(provider, {
      open: true,
      selected: null,
      selectedReportSourceId: "",
      newReportSourceName: "",
      fileLabel: "",
      isNewLabel: false,
      autosyncEnabled: false,
      breadcrumbs: [{ path: "", name: meta.rootName }],
    });
    fetchStorageEntries(provider, "", [{ path: "", name: meta.rootName }]);
  }, [fetchStorageEntries, setStoragePicker, storageProviderMeta]);

  const closeStoragePicker = useCallback((provider) => {
    const meta = storageProviderMeta[provider];
    if (!meta) return;
    resetStoragePicker(provider, meta.rootName);
  }, [resetStoragePicker, storageProviderMeta]);

  const navigateStoragePicker = useCallback((provider, index) => {
    const picker = storagePickers[provider];
    const meta = storageProviderMeta[provider];
    if (!picker || !meta) return;
    const nextBreadcrumbs = picker.breadcrumbs.slice(0, index + 1);
    const target = nextBreadcrumbs[nextBreadcrumbs.length - 1];
    setStoragePicker(provider, { selected: null });
    fetchStorageEntries(provider, target?.path || "", nextBreadcrumbs);
  }, [fetchStorageEntries, setStoragePicker, storagePickers, storageProviderMeta]);

  const handleStorageEntrySelect = useCallback((provider, entry) => {
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

  const handleStorageImport = useCallback(async (provider, selectedEntry) => {
    const picker = storagePickers[provider];
    const meta = storageProviderMeta[provider];
    if (!picker || !meta || !selectedEntry || !String(picker.fileLabel || "").trim()) return;
    const sourceName = String(picker.newReportSourceName || "").trim();
    if (!picker.selectedReportSourceId && !sourceName) return;
    try {
      const res = await axios.post(
        `${API}/storage/${provider}/import`,
        {
          sourceRef: selectedEntry.path || selectedEntry.id,
          name: selectedEntry.name,
          display_name: String(picker.fileLabel).trim(),
          file_label: String(picker.fileLabel).trim(),
          autosync_enabled: picker.autosyncEnabled ? "1" : "0",
          ...(picker.selectedReportSourceId ? { report_source_id: picker.selectedReportSourceId } : { report_source_name: sourceName }),
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
        alert(`Imported from ${meta.label} and held for review before publishing.`);
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
        refreshReportSources();
        if (typeof loadData === "function") {
          await loadData(res.data.sheetId, false, (res.data.tabs && res.data.tabs[0]) || null);
        }
      }
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.error || `${meta.label} import failed`);
    } finally {
      closeStoragePicker(provider);
    }
  }, [API, closeStoragePicker, loadData, onTabChange, refreshReportSources, setSelectedFileName, setSheetId, setTabs, storagePickers, storageProviderMeta, tabListCacheRef, token]);

  return {
    drivePickerOpen,
    setDrivePickerOpen,
    driveEntries,
    setDriveEntries,
    driveLoading,
    setDriveLoading,
    driveBreadcrumbs,
    setDriveBreadcrumbs,
    selectedDriveFile,
    setSelectedDriveFile,
    dropboxPickerOpen,
    setDropboxPickerOpen,
    dropboxEntries,
    setDropboxEntries,
    dropboxLoading,
    setDropboxLoading,
    dropboxBreadcrumbs,
    setDropboxBreadcrumbs,
    selectedDropboxFile,
    setSelectedDropboxFile,
    oneDrivePickerOpen,
    setOneDrivePickerOpen,
    oneDriveEntries,
    setOneDriveEntries,
    oneDriveLoading,
    setOneDriveLoading,
    oneDriveBreadcrumbs,
    setOneDriveBreadcrumbs,
    selectedOneDriveFile,
    setSelectedOneDriveFile,
    isNewLabel,
    setIsNewLabel,
    newReportSourceName,
    setNewReportSourceName,
    autosyncEnabled,
    setAutosyncEnabled,
    autosyncToggleBusyId,
    setAutosyncToggleBusyId,
    storagePickers,
    setStoragePickers,
    storageProviderMeta,
    anyStoragePickerOpen,
    toggleReportSourceAutosync,
    toggleMenu,
    setStoragePicker,
    resetStoragePicker,
    fetchStorageEntries,
    openStoragePicker,
    closeStoragePicker,
    navigateStoragePicker,
    handleStorageEntrySelect,
    handleStorageImport,
  };
}
