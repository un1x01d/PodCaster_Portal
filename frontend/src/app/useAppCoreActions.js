import React from "react";
import axios from "axios";
import { createSessionMarker, clearStoredAuthTokens } from "../utils/auth";

export function useAppCoreActions(args) {
  const {
    API, headers, email, password, inviteToken, invitePassword, inviteRepeat, googleEnabled, dropboxEnabled, oneDriveEnabled, user, token,
    sheetId, activeTab, parseNum, data, sortConfig, tabListCacheRef, LAST_VIEWED_SHEET_CONTEXT_KEY,
    setToken, setUser, setInviteError, setInviteLoading, setInvitePassword, setInviteRepeat, setInviteInfo, setInviteToken,
    setSheetId, setActiveFilename, setData, setHeaders, setTabs, setActiveTab, setMyFiles, setUploadDisplayName, setReportSourceName,
    maybePromptBusinessClassification, refreshReportSources, setColumnFilters, setSortConfig, setHasMoreData, setIsBatchLoading,
    setUniqueValuesByColumn, setOpenFilterCol, setPrimaryDlpMaskedColumns, setViews, setSelectedViewId, setPendingViewName,
  } = args;

  const hasRequiredColumns = React.useCallback((requiredCols) => {
      return requiredCols.every(col => headers.includes(col));
    }, [headers]);
  
    const handleLogin = async (e) => {
      e.preventDefault();
      try {
        const res = await axios.post(`${API}/auth/login`, { email, password });
        clearStoredAuthTokens();
        setToken(createSessionMarker());
        setUser(res.data.user);
      } catch (err) {
        alert("Login failed");
      }
    };
  
    const clearInviteQueryParam = React.useCallback(() => {
      const params = new URLSearchParams(window.location.search);
      params.delete("invite");
      const next = params.toString();
      const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
    }, []);
  
    const handleAcceptInvitation = async () => {
      if (!inviteToken) return;
      if (!invitePassword || !inviteRepeat) {
        setInviteError("Password and confirmation are required.");
        return;
      }
      if (invitePassword !== inviteRepeat) {
        setInviteError("Passwords do not match.");
        return;
      }
      setInviteLoading(true);
      setInviteError("");
      try {
        const res = await axios.post(`${API}/auth/invitations/accept`, {
          token: inviteToken,
          password: invitePassword,
        });
        clearStoredAuthTokens();
        setToken(createSessionMarker());
        setUser(res?.data?.user || null);
        setInvitePassword("");
        setInviteRepeat("");
        setInviteInfo(null);
        setInviteToken("");
        clearInviteQueryParam();
      } catch (err) {
        setInviteError(err?.response?.data?.error || "Failed to accept invitation.");
      } finally {
        setInviteLoading(false);
      }
    };
  
    const handleGoogleLogin = async () => {
      if (!googleEnabled) {
        alert("Google sign-in is disabled.");
        return;
      }
      try {
        const qp = new URLSearchParams(window.location.search);
        const groupIdRaw = qp.get("groupId") || qp.get("customerGroupId") || "";
        const groupId = Number.parseInt(groupIdRaw, 10);
        const res = await axios.get(`${API}/auth/google/url`, {
          params: Number.isInteger(groupId) && groupId > 0 ? { groupId } : undefined,
        });
        const url = String(res?.data?.url || "").trim();
        if (!url) {
          alert("Google login is not configured.");
          return;
        }
        window.location.href = url;
      } catch (err) {
        console.error("google login url failed:", err);
        alert("Google login is not configured.");
      }
    };
  
    const handleSamlLogin = async () => {
      try {
        const qp = new URLSearchParams(window.location.search);
        const groupIdRaw = qp.get("groupId") || qp.get("customerGroupId") || "";
        const groupId = Number.parseInt(groupIdRaw, 10);
        if (!Number.isInteger(groupId) || groupId <= 0) {
          alert("SAML requires a customer groupId in the URL.");
          return;
        }
        const res = await axios.get(`${API}/auth/saml/url`, { params: { groupId } });
        const url = String(res?.data?.url || "").trim();
        if (!url) {
          alert("SAML login is not configured.");
          return;
        }
        window.location.href = url;
      } catch (err) {
        console.error("saml login url failed:", err);
        alert(err?.response?.data?.error || "SAML login is not configured.");
      }
    };
  
    const handleDropboxConnect = async () => {
      if (!user) {
        alert("Sign in first.");
        return;
      }
      if (!dropboxEnabled) {
        alert("Dropbox integration is disabled.");
        return;
      }
      try {
        const res = await axios.get(`${API}/auth/dropbox/url`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const url = String(res?.data?.url || "").trim();
        if (!url) {
          alert("Dropbox is not configured.");
          return;
        }
        window.location.href = url;
      } catch (err) {
        console.error("dropbox auth url failed:", err);
        alert(err?.response?.data?.error || "Dropbox is not configured.");
      }
    };
  
    const handleGoogleConnect = async () => {
      if (!user) {
        alert("Sign in first.");
        return;
      }
      if (!googleEnabled) {
        alert("Google sign-in is disabled.");
        return;
      }
      try {
        const res = await axios.get(`${API}/auth/google/connect-url`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const url = String(res?.data?.url || "").trim();
        if (!url) {
          alert("Google login is not configured.");
          return;
        }
        window.location.href = url;
      } catch (err) {
        console.error("google connect url failed:", err);
        alert(err?.response?.data?.error || "Google login is not configured.");
      }
    };
  
    const handleOneDriveConnect = async () => {
      if (!user) {
        alert("Sign in first.");
        return;
      }
      if (!oneDriveEnabled) {
        alert("OneDrive integration is disabled.");
        return;
      }
      try {
        const res = await axios.get(`${API}/auth/onedrive/url`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const url = String(res?.data?.url || "").trim();
        if (!url) {
          alert("OneDrive is not configured.");
          return;
        }
        window.location.href = url;
      } catch (err) {
        console.error("onedrive auth url failed:", err);
        alert(err?.response?.data?.error || "OneDrive is not configured.");
      }
    };
  
    const applyLoadedRows = (sid, raw, preserveFilters = false, append = false, activeTabHint = null) => {
      const rows = Array.isArray(raw) ? raw : [];
      if (!raw || !Array.isArray(raw)) {
        console.warn("loadData: response is not an array", raw);
        if (!append) {
          setData([]);
          setHeaders([]);
        }
        if (append) {
          setHasMoreData(false);
          return;
        }
        return;
      }
      
      if (append) {
          setData(prev => [...prev, ...rows]);
          if (rows.length === 0) setHasMoreData(false);
      } else {
          setData(rows);
          const isSameSheet = String(sid) === String(sheetId);
          const heads = rows.length
            ? Object.keys(rows[0])
            : ((preserveFilters || isSameSheet) ? headers : []);
          setHeaders(heads);
          setHasMoreData(rows.length > 0);
          primaryLoadedContextRef.current = {
            sheet: String(sid || ""),
            tab: String(activeTabHint || activeTab || ""),
            view: String(selectedViewId || ""),
          };
      }
  
      setSheetId(sid);
      localStorage.setItem("sheetId", sid);
      const persisted = {
        sheetId: String(sid),
        activeTab: activeTabHint || activeTab || null,
        savedAt: Date.now(),
      };
      try {
        localStorage.setItem(LAST_VIEWED_SHEET_CONTEXT_KEY, JSON.stringify(persisted));
      } catch {
        // localStorage unavailable
      }
      if (!preserveFilters && !append) {
        setColumnFilters({});
        setOpenFilterCol(null);
      }
    };
  
    const getDataCacheKey = (sid, tabName = null) => `${String(sid)}::${tabName ? String(tabName) : "__all__"}`;
  
    const loadData = async (sid = sheetId, preserveFilters = false, tabName = null, options = {}) => {
      if (!sid) return;
      const { preferCache = true, limit = BATCH_SIZE, offset = 0, append = false, context = "primary", filters = null } = options;
      
      const isPrimary = context === "primary";
      if (!append) {
        const abortRef = isPrimary ? primaryAbortControllerRef : secondaryAbortControllerRef;
        try {
          if (abortRef.current) abortRef.current.abort();
        } catch {}
        abortRef.current = new AbortController();
      }
      const requestSignal = isPrimary ? primaryAbortControllerRef.current?.signal : secondaryAbortControllerRef.current?.signal;
      const requestSeq = (isPrimary ? primaryLoadSeqRef : secondaryLoadSeqRef).current + 1;
      if (isPrimary) primaryLoadSeqRef.current = requestSeq;
      else secondaryLoadSeqRef.current = requestSeq;
      if (isPrimary) primaryLatestLoadSeqRef.current = requestSeq;
      else secondaryLatestLoadSeqRef.current = requestSeq;
  
      if (!append) {
        if (isPrimary) {
          setHasMoreData(true);
        } else {
          setSecondaryHasMoreData(true);
        }
      }
      if (append) {
          if (isPrimary) setIsBatchLoading(true);
          else setSecondaryIsBatchLoading(true);
      }
  
      try {
        const params = new URLSearchParams();
        if (tabName) params.append("tab", tabName);
        
        if (selectedViewId && isPrimary) {
          params.append("viewId", selectedViewId);
        }
  
        const activeSort = isPrimary ? sortConfig : secondarySortConfig;
        if (activeSort) {
          params.append("sort_by", activeSort.key);
          params.append("sort_order", activeSort.direction);
        }
        
        const effectiveFilters = isPrimary ? columnFilters : filters;
        if (effectiveFilters && Object.keys(effectiveFilters).length > 0) {
          const serializableFilters = {};
          Object.entries(effectiveFilters).forEach(([col, val]) => {
            serializableFilters[col] = (val instanceof Set) ? Array.from(val) : val;
          });
          params.append("filters", JSON.stringify(serializableFilters));
        }
  
        params.append("limit", limit);
        params.append("offset", offset);
        if (DEBUG_SPREADSHEET) {
          console.log("[spreadsheet] requesting batch", {
            context,
            sid,
            append,
            limit,
            offset,
            tabName: tabName || null,
            hasMoreData: isPrimary ? hasMoreData : secondaryHasMoreData,
            isLoading: isPrimary ? isBatchLoading : secondaryIsBatchLoading,
          });
        }
  
        const cacheKey = getDataCacheKey(sid, tabName) + "?" + params.toString();
        if (preferCache && !append && isPrimary && tabDataCacheRef.current[cacheKey]) {
          applyLoadedRows(sid, tabDataCacheRef.current[cacheKey], preserveFilters, false, tabName);
          return;
        }
  
        const sheetDataParams = new URLSearchParams(params.toString());
        sheetDataParams.append("_ts", Date.now().toString());
        const url = `${API}/sheets/${sid}/data?${sheetDataParams.toString()}`;
        const res = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: requestSignal,
        });
        const raw = res.data;
        const rawDlpMaskedColumns = res?.headers?.["x-dlp-masked-columns"];
        let parsedDlpMaskedColumns = [];
        if (typeof rawDlpMaskedColumns === "string" && rawDlpMaskedColumns.trim()) {
          try {
            const parsed = JSON.parse(rawDlpMaskedColumns);
            parsedDlpMaskedColumns = Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
          } catch {
            parsedDlpMaskedColumns = [];
          }
        }
        if (isPrimary) setPrimaryDlpMaskedColumns(parsedDlpMaskedColumns);
        else setSecondaryDlpMaskedColumns(parsedDlpMaskedColumns);
        if (requestSeq !== (isPrimary ? primaryLatestLoadSeqRef.current : secondaryLatestLoadSeqRef.current)) {
          return;
        }
        if (DEBUG_SPREADSHEET) {
          const count = Array.isArray(raw) ? raw.length : 0;
          console.log("[spreadsheet] received batch", {
            context,
            sid,
            count,
            append,
            offset,
            nextHasMore: count > 0,
            status: res?.status,
            code: res?.statusText,
          });
        }
        const activeViewConfig = (() => {
          const v = views.find((vv) => String(vv.id) === String(selectedViewId));
          if (!v) return null;
          return typeof v.config === "string" ? (() => { try { return JSON.parse(v.config); } catch { return null; } })() : v.config;
        })();
  
        if (isPrimary) {
            if (!append) tabDataCacheRef.current[cacheKey] = Array.isArray(raw) ? raw : [];
            applyLoadedRows(sid, raw, preserveFilters, append, tabName);
        } else {
            let effectiveSecondaryRows = Array.isArray(raw) ? raw : [];
            const secondaryVisibleColumns = activeViewConfig?.splitContext?.secondaryVisibleColumns;
            if (Array.isArray(secondaryVisibleColumns) && secondaryVisibleColumns.length > 0) {
              effectiveSecondaryRows = effectiveSecondaryRows.map((row) => {
                const next = {};
                secondaryVisibleColumns.forEach((col) => {
                  if (Object.prototype.hasOwnProperty.call(row || {}, col)) next[col] = row[col];
                });
                return next;
              });
            }
            const secondaryForcedFilters = activeViewConfig?.splitContext?.secondaryColumnFilters;
            if (secondaryForcedFilters && typeof secondaryForcedFilters === "object" && Object.keys(secondaryForcedFilters).length > 0) {
              effectiveSecondaryRows = effectiveSecondaryRows.filter((row) => (
                Object.entries(secondaryForcedFilters).every(([col, allowed]) => {
                  if (!Array.isArray(allowed) || allowed.length === 0) return true;
                  return allowed.map((x) => String(x)).includes(String(row?.[col] ?? ""));
                })
              ));
            }
            if (append) {
                setSecondaryData(prev => [...prev, ...effectiveSecondaryRows]);
                if (effectiveSecondaryRows.length === 0) setSecondaryHasMoreData(false);
            } else {
                setSecondaryData(effectiveSecondaryRows);
                setSecondaryHeaders(effectiveSecondaryRows.length ? Object.keys(effectiveSecondaryRows[0]) : []);
                setSecondaryHasMoreData(effectiveSecondaryRows.length > 0);
            }
            if (DEBUG_SPREADSHEET) {
              const count = Array.isArray(raw) ? raw.length : 0;
              console.log("[spreadsheet] received secondary batch", {
                context,
                sid,
                count,
                append,
                offset,
                nextHasMore: count > 0,
              });
            }
        }
      } catch (e) {
        if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;
        console.error(e);
        if (context === "primary") {
          if (!append) {
            setHasMoreData(false);
            setData([]);
            setHeaders([]);
          } else {
            setHasMoreData(false);
          }
        } else {
          if (!append) {
            setSecondaryData([]);
            setSecondaryHeaders([]);
            setSecondaryHasMoreData(false);
          } else {
            setSecondaryHasMoreData(false);
          }
        }
      } finally {
        if (isPrimary) setIsBatchLoading(false);
        else setSecondaryIsBatchLoading(false);
      }
    };
  
    const onLoadMore = () => {
      if (isBatchLoading || !hasMoreData || !sheetId) return Promise.resolve();
      const nextOffset = data.length;
      if (primaryLoadOffsetRef.current === nextOffset) return Promise.resolve();
      if (DEBUG_SPREADSHEET) {
        console.log("[spreadsheet] onLoadMore", {
          appendOffset: nextOffset,
          loaded: data.length,
        });
      }
      primaryLoadOffsetRef.current = nextOffset;
      const request = loadData(sheetId, true, activeTab, { 
          offset: data.length, 
          append: true,
          preferCache: false 
      });
      request.finally(() => {
        primaryLoadOffsetRef.current = null;
      });
      return request;
    };
  
    const onLoadMoreSecondary = (filters = null) => {
      if (secondaryIsBatchLoading || !secondaryHasMoreData || !secondarySheetId) return Promise.resolve();
      const nextOffset = secondaryData.length;
      if (secondaryLoadOffsetRef.current === nextOffset) return Promise.resolve();
      if (DEBUG_SPREADSHEET) {
        console.log("[spreadsheet] onLoadMoreSecondary", {
          appendOffset: nextOffset,
          loaded: secondaryData.length,
        });
      }
      secondaryLoadOffsetRef.current = nextOffset;
      const request = loadData(secondarySheetId, true, secondaryTab, {
          offset: secondaryData.length,
          append: true,
          context: "secondary",
          preferCache: false,
          filters
      });
      request.finally(() => {
        secondaryLoadOffsetRef.current = null;
      });
      return request;
    };
  
    const requestPrimaryReload = React.useCallback(() => {
      if (!sheetId) return;
      primaryLoadedContextRef.current = { sheet: "", tab: "", view: "" };
      loadData(sheetId, true, activeTab, { preferCache: false });
    }, [activeTab, loadData, sheetId]);
  
    // Re-fetch data when spreadsheet context changes.
    useEffect(() => {
      if (!sheetId || !user) return;
      if (skipNextPrimaryAutoLoadRef.current) {
        skipNextPrimaryAutoLoadRef.current = false;
        return;
      }
  
      const loaded = primaryLoadedContextRef.current || {};
      const sameContext = (
        String(loaded.sheet || "") === String(sheetId || "")
        && String(loaded.tab || "") === String(activeTab || "")
        && String(loaded.view || "") === String(selectedViewId || "")
      );
  
      if (sameContext) return;
  
      loadData(sheetId, true, activeTab, { preferCache: false });
    }, [sheetId, user, activeTab, selectedViewId]);
  
    // Secondary Data Sync
    useEffect(() => {
      if (secondarySheetId && user) {
        loadData(secondarySheetId, true, secondaryTab, { context: "secondary", preferCache: false });
      }
    }, [secondarySheetId, secondaryTab, secondarySortConfig, selectedViewId]);
  
    const fetchTabs = async (sid, options = {}) => {
      const { preferredTab = null, preserveActive = false } = options;
      if (!sid) {
        setTabs([]);
        setActiveTab("");
        return [];
      }
      const cached = tabListCacheRef.current[String(sid)];
      if (Array.isArray(cached)) {
        setTabs(cached);
        if (cached.length > 0) {
          const nextTab = (preferredTab && cached.includes(preferredTab))
            ? preferredTab
            : (preserveActive && activeTab && cached.includes(activeTab) ? activeTab : cached[0]);
          setActiveTab(nextTab);
          localStorage.setItem("activeTab", nextTab);
        } else {
          setActiveTab("");
          localStorage.removeItem("activeTab");
        }
        return cached;
      }
      try {
        const res = await axios.get(`${API}/sheets/${sid}/tabs`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const tabList = res.data?.tabs || [];
        tabListCacheRef.current[String(sid)] = tabList;
        setTabs(tabList);
        if (tabList.length > 0) {
          const nextTab = (preferredTab && tabList.includes(preferredTab))
            ? preferredTab
            : (preserveActive && activeTab && tabList.includes(activeTab) ? activeTab : tabList[0]);
          setActiveTab(nextTab);
          localStorage.setItem("activeTab", nextTab);
        } else {
          setActiveTab("");
          localStorage.removeItem("activeTab");
        }
        return tabList;
      } catch (e) {
        console.error("fetchTabs failed:", e);
        setTabs([]);
        setActiveTab("");
        localStorage.removeItem("activeTab");
        return [];
      }
    };
  
    const handleTabChange = (tabName) => {
      setActiveTab(tabName);
      localStorage.setItem("activeTab", tabName);
    };
  
    const hydrateSheetContext = async (sid, options = {}) => {
      if (!sid) return;
      skipNextPrimaryAutoLoadRef.current = true;
      if (String(sid) !== String(sheetId)) {
        setSelectedViewId("");
      }
      const safeSid = String(sid).trim();
      if (!safeSid) return;
      if (String(sheetId) !== safeSid) {
        setSheetId(safeSid);
        localStorage.setItem("sheetId", safeSid);
      }
      const {
        preferredTab = null,
        preserveFilters = false,
        preferCache = true,
      } = options;
      const cachedTabs = tabListCacheRef.current[safeSid];
      const hasCachedTabs = Array.isArray(cachedTabs) && cachedTabs.length > 0;
      const immediateTab = hasCachedTabs
        ? ((preferredTab && cachedTabs.includes(preferredTab)) ? preferredTab : cachedTabs[0])
        : null;
      const tabListPromise = fetchTabs(safeSid, { preferredTab, preserveActive: false });
      if (hasCachedTabs) {
        await loadData(safeSid, preserveFilters, immediateTab, { preferCache });
        return;
      }
      const tabList = await tabListPromise;
      const resolvedTab = Array.isArray(tabList) && tabList.length
        ? ((preferredTab && tabList.includes(preferredTab)) ? preferredTab : tabList[0])
        : null;
      await loadData(safeSid, preserveFilters, resolvedTab, { preferCache: false });
    };
  
    const refreshReportSources = React.useCallback(() => {
      if (!token) return Promise.resolve([]);
      return axios.get(`${API}/report-sources`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => {
          const sources = r.data || [];
          setReportSources(sources);
          const explicitSources = sources.filter((source) => source && !source.is_inferred && source.id);
          return Promise.all(
            explicitSources.map((source) => (
              axios.get(`${API}/report-sources/${source.id}/imports`, { headers: { Authorization: `Bearer ${token}` } })
                .then((importsRes) => [String(source.id), importsRes.data || []])
                .catch((e) => {
                  if (user) console.error("Fetch report source imports failed", source.id, e);
                  return [String(source.id), []];
                })
            ))
          ).then((entries) => {
            setReportSourceImports(Object.fromEntries(entries));
            return sources;
          });
        })
        .catch(e => {
          if (user) console.error("Fetch report sources failed", e);
          setReportSourceImports({});
          return [];
        });
    }, [API, token, user]);
  
    const maybePromptBusinessClassification = React.useCallback((payload) => {
      const classification = payload?.business_classification;
      const sheetIdentifier = payload?.sheetId || payload?.sheet_id;
      const businessType = String(classification?.businessType || classification?.business_type || "").trim();
      const status = String(classification?.status || payload?.business_classification_status || "").trim().toLowerCase();
      if (!sheetIdentifier || !businessType || classification?.isBusinessData !== true || status !== "pending") return;
      setBusinessClassificationPrompt({
        sheetId: sheetIdentifier,
        businessType,
        confidence: Number(classification?.confidence || 0),
        signals: Array.isArray(classification?.signals) ? classification.signals.slice(0, 4) : [],
      });
    }, []);
  
    const answerBusinessClassificationPrompt = React.useCallback(async (confirmed) => {
      const prompt = businessClassificationPrompt;
      if (!prompt?.sheetId) return;
      try {
        await axios.patch(`${API}/sheets/${prompt.sheetId}/business-classification`, { confirmed }, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setMyFiles((prev) => (prev || []).map((file) => (
          String(file.id) === String(prompt.sheetId)
            ? { ...file, business_classification_status: confirmed ? "confirmed" : "rejected" }
            : file
        )));
      } catch (e) {
        console.error("business classification confirmation failed", e);
        alert(e?.response?.data?.error || "Failed to save business type confirmation");
      } finally {
        setBusinessClassificationPrompt(null);
      }
    }, [API, businessClassificationPrompt, token]);
  
    const handleUpload = async (uploadFile, displayName, reportSourceId = "", newReportSourceName = "", fileLabel = "") => {
      if (!uploadFile || !String(displayName || "").trim()) return;
      if (!reportSourceId && !String(newReportSourceName || "").trim()) return;
      if (uploadProgressOpen) return;
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("display_name", String(displayName).trim());
      formData.append("file_label", String(fileLabel || displayName).trim());
      if (reportSourceId) {
        formData.append("report_source_id", reportSourceId);
      } else {
        formData.append("report_source_name", String(newReportSourceName).trim());
      }
      const inferredTotal = Number(uploadFile?.size || 0);
      setUploadProgressOpen(true);
      setUploadProgressLoaded(0);
      setUploadProgressTotal(inferredTotal > 0 ? inferredTotal : 0);
      setUploadProgressPercent(0);
      setUploadProgressPhase("uploading");
      setUploadProgressError("");
  
      let uploadFailed = false;
  
      try {
        const res = await axios.post(`${API}/upload`, formData, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data"
          },
          onUploadProgress: (progressEvent) => {
            const loaded = Math.max(0, Number(progressEvent?.loaded || 0));
            const eventTotal = Math.max(0, Number(progressEvent?.total || 0));
            const total = eventTotal > 0 ? eventTotal : (inferredTotal > 0 ? inferredTotal : loaded);
            const boundedLoaded = total > 0 ? Math.min(loaded, total) : loaded;
            const percent = total > 0 ? Math.round((boundedLoaded / total) * 100) : 0;
            setUploadProgressLoaded(boundedLoaded);
            setUploadProgressTotal(total);
            if (percent >= 100) {
              setUploadProgressPhase("processing");
              setUploadProgressPercent(95);
            } else {
              setUploadProgressPhase("uploading");
              setUploadProgressPercent(Math.max(0, Math.min(95, percent)));
            }
          },
        });
        setUploadProgressPhase("complete");
        setUploadProgressPercent(100);
        if (res.data?.status === "queued") {
          const dlpWarning = String(res.data?.dlp?.warningMessage || "").trim();
          setUploadProgressError(dlpWarning || "Upload queued for import processing.");
          refreshReportSources();
          return;
        }
        if (res.data?.status === "pending_approval") {
          maybePromptBusinessClassification(res.data);
          setUploadProgressError("Uploaded and held for review before publishing.");
          setUploadDisplayName("");
          setReportSourceName("");
          refreshReportSources();
          return;
        }
        if (res.data.sheetId) {
          if (res.data?.dlp?.message) {
            setUploadProgressError(String(res.data.dlp.message));
          } else if (res.data?.dlp?.warning && res.data?.dlp?.warningMessage) {
            setUploadProgressError(String(res.data.dlp.warningMessage));
          }
          const sid = String(res.data.sheetId);
          const activeName = res.data.display_name || res.data.filename;
          setActiveFilename(activeName);
          localStorage.setItem("activeFilename", activeName);
          setUploadDisplayName("");
          setReportSourceName("");
          
          if (res.data.tabs && res.data.tabs.length > 0) {
            tabListCacheRef.current[sid] = res.data.tabs;
          }
  
          // Use unified context hydration to avoid race conditions
          await hydrateSheetContext(sid, {
            preferredTab: (res.data.tabs && res.data.tabs.length > 0) ? res.data.tabs[0] : null,
            preserveFilters: false,
            preferCache: false
          });
  
          maybePromptBusinessClassification(res.data);
          
          // Refresh file lists
          refreshReportSources();
          if (token) {
            axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => setMyFiles(r.data || []));
          }
        }
      } catch (e) {
        console.error(e);
        uploadFailed = true;
        const backendMessage = e?.response?.data?.publicMessage || e?.response?.data?.message || e?.response?.data?.error || e?.message || "Upload failed";
        setUploadProgressPhase("failed");
        setUploadProgressPercent(100);
        setUploadProgressError(String(backendMessage));
      } finally {
        if (!uploadFailed) {
          refreshReportSources();
        }
      }
    };
  
    const handleGoogleDriveImport = async ({ fileId, name, mimeType, displayName, reportSourceId = "", reportSourceName: newReportSourceName = "", fileLabel = "", autosyncEnabled = false }) => {
      if (!fileId || !String(displayName || "").trim()) return;
      if (!reportSourceId && !String(newReportSourceName || "").trim()) return;
      try {
        const res = await axios.post(
          `${API}/google/drive/import`,
          {
            fileId,
            name,
            mimeType,
            display_name: String(displayName).trim(),
            file_label: String(fileLabel || displayName).trim(),
            autosync_enabled: autosyncEnabled ? "1" : "0",
            ...(reportSourceId ? { report_source_id: reportSourceId } : { report_source_name: String(newReportSourceName).trim() }),
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
  
        if (res.data?.status === "queued") {
          alert("Google Drive import queued for processing.");
          refreshReportSources();
          return;
        }
        if (res.data?.status === "pending_approval") {
          maybePromptBusinessClassification(res.data);
          alert("Imported from Google Drive and held for review before publishing.");
          setUploadDisplayName("");
          setReportSourceName("");
          refreshReportSources();
          return;
        }
        alert("Imported from Google Drive!");
        if (res.data?.sheetId) {
          setSheetId(res.data.sheetId);
          const activeName = res.data.display_name || res.data.filename;
          setActiveFilename(activeName);
          localStorage.setItem("activeFilename", activeName);
          setUploadDisplayName("");
          setReportSourceName("");
          if (res.data.tabs && res.data.tabs.length > 0) {
            tabListCacheRef.current[String(res.data.sheetId)] = res.data.tabs;
            setTabs(res.data.tabs);
            setActiveTab(res.data.tabs[0]);
            localStorage.setItem("activeTab", res.data.tabs[0]);
          }
          maybePromptBusinessClassification(res.data);
          if (token) {
            axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => setMyFiles(r.data || []));
            refreshReportSources();
          }
        }
      } catch (e) {
        console.error(e);
        alert(e.response?.data?.error || "Google Drive import failed");
      }
    };
  
    const handleDropboxImport = async ({ pathLower, fileId = "", name, displayName, reportSourceId = "", reportSourceName: newReportSourceName = "", fileLabel = "", autosyncEnabled = false }) => {
      if (!pathLower || !String(displayName || "").trim()) return;
      if (!reportSourceId && !String(newReportSourceName || "").trim()) return;
      try {
        const res = await axios.post(
          `${API}/dropbox/import`,
          {
            pathLower,
            fileId,
            name,
            display_name: String(displayName).trim(),
            file_label: String(fileLabel || displayName).trim(),
            autosync_enabled: autosyncEnabled ? "1" : "0",
            ...(reportSourceId ? { report_source_id: reportSourceId } : { report_source_name: String(newReportSourceName).trim() }),
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
  
        if (res.data?.status === "queued") {
          alert("Dropbox import queued for processing.");
          refreshReportSources();
          return;
        }
        if (res.data?.status === "pending_approval") {
          alert("Imported from Dropbox and held for review before publishing.");
          setUploadDisplayName("");
          setReportSourceName("");
          refreshReportSources();
          return;
        }
        alert("Imported from Dropbox!");
        if (res.data?.sheetId) {
          setSheetId(res.data.sheetId);
          const activeName = res.data.display_name || res.data.filename;
          setActiveFilename(activeName);
          localStorage.setItem("activeFilename", activeName);
          setUploadDisplayName("");
          setReportSourceName("");
          if (res.data.tabs && res.data.tabs.length > 0) {
            tabListCacheRef.current[String(res.data.sheetId)] = res.data.tabs;
            setTabs(res.data.tabs);
            setActiveTab(res.data.tabs[0]);
            localStorage.setItem("activeTab", res.data.tabs[0]);
          }
          maybePromptBusinessClassification(res.data);
          if (token) {
            axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => setMyFiles(r.data || []));
            refreshReportSources();
          }
        }
      } catch (e) {
        console.error(e);
        alert(e.response?.data?.error || "Dropbox import failed");
      }
    };
  
    const handleOneDriveImport = async ({ itemId, name, displayName, reportSourceId = "", reportSourceName: newReportSourceName = "", fileLabel = "", autosyncEnabled = false }) => {
      if (!itemId || !String(displayName || "").trim()) return;
      if (!reportSourceId && !String(newReportSourceName || "").trim()) return;
      try {
        const res = await axios.post(
          `${API}/onedrive/import`,
          {
            itemId,
            name,
            display_name: String(displayName).trim(),
            file_label: String(fileLabel || displayName).trim(),
            autosync_enabled: autosyncEnabled ? "1" : "0",
            ...(reportSourceId ? { report_source_id: reportSourceId } : { report_source_name: String(newReportSourceName).trim() }),
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
  
        if (res.data?.status === "queued") {
          alert("OneDrive import queued for processing.");
          refreshReportSources();
          return;
        }
        if (res.data?.status === "pending_approval") {
          alert("Imported from OneDrive and held for review before publishing.");
          setUploadDisplayName("");
          setReportSourceName("");
          refreshReportSources();
          return;
        }
        alert("Imported from OneDrive!");
        if (res.data?.sheetId) {
          setSheetId(res.data.sheetId);
          const activeName = res.data.display_name || res.data.filename;
          setActiveFilename(activeName);
          localStorage.setItem("activeFilename", activeName);
          setUploadDisplayName("");
          setReportSourceName("");
          if (res.data.tabs && res.data.tabs.length > 0) {
            tabListCacheRef.current[String(res.data.sheetId)] = res.data.tabs;
            setTabs(res.data.tabs);
            setActiveTab(res.data.tabs[0]);
            localStorage.setItem("activeTab", res.data.tabs[0]);
          }
          maybePromptBusinessClassification(res.data);
          if (token) {
            axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
              .then(r => setMyFiles(r.data || []));
            refreshReportSources();
          }
        }
      } catch (e) {
        console.error(e);
        alert(e.response?.data?.error || "OneDrive import failed");
      }
    };
  
    const appendCalculatedColumn = (colName, columnMap, calculateFunc) => {
      // 1. Add to headers
      const newHeaders = [...headers];
      if (!newHeaders.includes(colName)) {
        newHeaders.push(colName);
      }
  
      // 2. Loop through every row and execute the callback
      const newData = data.map(row => {
        // Create an object of just the required values
        const requiredVals = {};
        Object.entries(columnMap).forEach(([reqName, sourceColName]) => {
          const raw = row[sourceColName];
          requiredVals[reqName] = parseNum(raw); // Ensures it's a number
        });
  
        // Calculate the result
        const result = calculateFunc(requiredVals);
  
        // Mutate the row definition
        return { ...row, [colName]: result };
      });
  
      // 3. Update State
      setHeaders(newHeaders);
      setData(newData);
    };
  
    const deleteSheet = async (id) => {
      try {
        await axios.delete(`${API}/sheets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        setMyFiles((prev) => prev.filter((f) => f.id !== id));
        await refreshReportSources();
  
        if (id === sheetId) {
          setSheetId(null);
          setActiveFilename("");
          setData([]);
          setHeaders([]);
          localStorage.removeItem("sheetId");
          localStorage.removeItem("activeFilename");
          localStorage.removeItem(LAST_VIEWED_SHEET_CONTEXT_KEY);
          localStorage.removeItem("activeTab");
        }
      } catch (e) {
        console.error(e);
        const msg = e?.response?.data?.error || e?.message || "Failed to delete";
        alert(`Failed to delete: ${msg}`);
        // Reconcile UI in case backend partially changed pointers/import status before error surfacing.
        await refreshReportSources();
      }
    };
  
  

  return {
    hasRequiredColumns,
    handleLogin,
    clearInviteQueryParam,
    handleAcceptInvitation,
    handleGoogleLogin,
    handleSamlLogin,
    handleDropboxConnect,
    handleGoogleConnect,
    handleOneDriveConnect,
    loadData,
    fetchTabs,
    handleTabChange,
    handleUpload,
    handleGoogleDriveImport,
    handleDropboxImport,
    handleOneDriveImport,
    appendCalculatedColumn,
    deleteSheet,
  };
}
