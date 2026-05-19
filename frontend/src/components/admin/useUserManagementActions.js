import { useCallback } from "react";
import axios from "axios";

export function useUserManagementActions(args) {
  const { API, token } = args;
    if (!selectedGroupId) return;
    if (!window.confirm("Remove this user from the selected customer?")) return;
    try {
      await axios.delete(`${API}/groups/${selectedGroupId}/users/${uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchGroupMembers(selectedGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to remove user from customer");
    }
  };

  const toggleGroupAdmin = async (uid, isAdmin) => {
    if (!selectedGroupId) return;
    try {
      await axios.post(`${API}/groups/${selectedGroupId}/users/${uid}/admin`, { isAdmin: !isAdmin }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchGroupMembers(selectedGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to toggle customer admin");
    }
  };

  const saveGroupPermissions = async () => {
    if (!selectedGroupId || !selectedUserSheetId) {
      alert("Pick a customer and a report source first.");
      return;
    }
    const allowed_columns = Array.from(groupAllowedCols);
    // Convert filter array to object, filtering out empty entries
    const row_filters = {};
    groupRowFilters.forEach(f => {
      if (f.key && f.value) row_filters[f.key] = f.value;
    });
    const endpoint = selectedReportSourceId ? `${API}/report-source-group-permissions` : `${API}/group-permissions`;
    await axios.post(endpoint, {
      ...(selectedReportSourceId ? { reportSourceId: selectedReportSourceId } : { sheetId: selectedUserSheetId }),
      groupId: selectedGroupId,
      allowed: allowed_columns,
      rowFilters: row_filters,
      allowed_columns,
      row_filters
    }, { headers: { Authorization: `Bearer ${token}` } });
    return true;
  };

  // NEW: delete group (with confirm) from Groups panel
  const deleteGroup = async (gid) => {
    if (!gid) return;
    if (!confirm("Delete this customer and its memberships/permissions?")) return;
    try {
      await axios.delete(`${API}/groups/${gid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (Number(selectedGroupId) === Number(gid)) {
        setSelectedGroupId(null);
        setGroupMembers([]);
        setGroupAllowedCols(new Set());
        setGroupRowFilters([{ key: "", value: "" }]);
        setGroupSheetHeaders([]);
        setSelectedTplGroup("");
      }
      fetchGroups();
    } catch (e) {
      console.error("delete customer failed", e);
      alert(e.response?.data?.message || e.response?.data?.error || "❌ Could not delete customer");
    }
  };

  /** ---------------------------
   * Template: create / apply / delete
   * (scoped per group)
   * --------------------------- */
  const makeTemplate = (name, columns, row_filters, groupId) => ({
    id: Date.now().toString(36),
    name: String(name || "").trim(),
    columns: Array.from(new Set(columns || [])),
    row_filters: row_filters && typeof row_filters === "object" ? row_filters : {},
    groupId: Number.isInteger(groupId) ? groupId : null,
    created_at: new Date().toISOString()
  });

  // Determine current groupId for selected user sheet
  const currentUserSheetGroupId = useMemo(() => {
    if (!selectedUserSheetId) return null;
    const s = userSheets.find(ss => String(ss.id) === String(selectedUserSheetId));
    return s?._group_id ?? null;
  }, [selectedUserSheetId, userSheets]);

  // Visible templates (filtered by group) for user panel
  const visibleUserTemplates = useMemo(() => {
    if (!currentUserSheetGroupId) return [];
    return (templates || []).filter(t => t.groupId === currentUserSheetGroupId);
  }, [templates, currentUserSheetGroupId]);

  // Visible templates (filtered by group) for group panel
  const visibleGroupTemplates = useMemo(() => {
    if (!selectedGroupId) return [];
    return (templates || []).filter(t => t.groupId === selectedGroupId);
  }, [templates, selectedGroupId]);

  // User panel: save template
  const handleSaveTemplateFromUser = () => {
    if (!newTplNameUser.trim()) { alert("Enter template name"); return; }
    if (!currentUserSheetGroupId) { alert("Select a sheet (with customer) first"); return; }
    const tpl = makeTemplate(
      newTplNameUser,
      Array.from(userAllowedCols),
      // Convert filter array to object
      Object.fromEntries(userRowFilters.filter(f => f.key && f.value).map(f => [f.key, f.value])),
      currentUserSheetGroupId
    );
    const next = [tpl, ...templates];
    setTemplates(next);
    saveTemplates(next);
    setNewTplNameUser("");
    return true;
  };

  const handleApplyTemplateToUser = (tplId) => {
    setSelectedTplUser(tplId);
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    // Intersect template columns with CURRENT sheet headers
    const cols = (tpl.columns || []).filter(c => userSheetHeaders.includes(c));
    setUserAllowedCols(new Set(cols));
    // Convert template filters object to array
    const filterArray = Object.entries(tpl.row_filters || {}).map(([key, value]) => ({ key, value }));
    setUserRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  };

  const handleDeleteTemplate = (tplId) => {
    const next = templates.filter(t => t.id !== tplId);
    setTemplates(next);
    saveTemplates(next);
    if (selectedTplUser === tplId) setSelectedTplUser("");
    if (selectedTplGroup === tplId) setSelectedTplGroup("");
  };

  // Group panel: save template
  const handleSaveTemplateFromGroup = () => {
    if (!newTplNameGroup.trim()) { alert("Enter template name"); return; }
    if (!selectedGroupId) { alert("Select a customer first"); return; }
    const tpl = makeTemplate(
      newTplNameGroup,
      Array.from(groupAllowedCols),
      // Convert filter array to object
      Object.fromEntries(groupRowFilters.filter(f => f.key && f.value).map(f => [f.key, f.value])),
      selectedGroupId
    );
    const next = [tpl, ...templates];
    setTemplates(next);
    saveTemplates(next);
    setNewTplNameGroup("");
    return true;
  };

  const handleApplyTemplateToGroup = (tplId) => {
    setSelectedTplGroup(tplId);
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    // Intersect template columns with CURRENT sheet headers
    const cols = (tpl.columns || []).filter(c => groupSheetHeaders.includes(c));
    setGroupAllowedCols(new Set(cols));
    // Convert template filters object to array
    const filterArray = Object.entries(tpl.row_filters || {}).map(([key, value]) => ({ key, value }));
    setGroupRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  };

  // Auto re-apply selected template after switching sheets (user scope)
  useEffect(() => {
    if (!selectedUserSheetId || !selectedTplUser) return;
    const tpl = templates.find(t => t.id === selectedTplUser);
    if (!tpl) return;
    const cols = (tpl.columns || []).filter(c => userSheetHeaders.includes(c));
    setUserAllowedCols(new Set(cols));
    // Convert template filters object to array
    const filterArray = Object.entries(tpl.row_filters || {}).map(([key, value]) => ({ key, value }));
    setUserRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  }, [selectedUserSheetId, selectedTplUser, userSheetHeaders, templates]);

  // Auto re-apply selected template after switching sheets (group scope)
  useEffect(() => {
    if (!selectedUserSheetId || !selectedTplGroup) return;
    const tpl = templates.find(t => t.id === selectedTplGroup);
    if (!tpl) return;
    const cols = (tpl.columns || []).filter(c => groupSheetHeaders.includes(c));
    setGroupAllowedCols(new Set(cols));
    // Convert template filters object to array
    const filterArray = Object.entries(tpl.row_filters || {}).map(([key, value]) => ({ key, value }));
    setGroupRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  }, [selectedUserSheetId, selectedTplGroup, groupSheetHeaders, templates]);

  const reportSourceOptions = useMemo(() => {
    return (reportSources || [])
      .filter((source) => source && !source.is_inferred && source.current_sheet_id)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [reportSources]);
  const reviewSourceOptions = useMemo(() => {
    return (reportSources || [])
      .filter((source) => source && !source.is_inferred && source.id)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [reportSources]);
  const selectedReportSource = useMemo(() => {
    return reportSourceOptions.find((source) => String(source.id) === String(selectedReportSourceId)) || null;
  }, [reportSourceOptions, selectedReportSourceId]);
  const isSplitScreenView = (view) => {
    const cfg = (view && typeof view.config === "string")
      ? (() => { try { return JSON.parse(view.config); } catch { return {}; } })()
      : (view?.config || {});
    return !!cfg?.splitContext?.secondarySheetId;
  };
  const selectReportSourceForPermissions = (value) => {
    const source = reportSourceOptions.find((item) => String(item.id) === String(value));
    setSelectedReportSourceId(source ? String(source.id) : null);
    setSelectedUserSheetId(source?.current_sheet_id || null);
  };

  const authBadgeClass = (provider) => (
    provider === "google"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-slate-50 text-slate-600 border-slate-200"
  );

  const canManageGroupAdmins = useMemo(() => {
    if (user?.role === "admin") return true;
    return uniqueGroupMembers.some((m) => Number(m.id) === Number(user?.id) && !!m.is_admin);
  }, [user, uniqueGroupMembers]);
  const selectedGroup = useMemo(
    () => (Array.isArray(groups) ? groups.find((g) => Number(g.id) === Number(selectedGroupId)) : null),
    [groups, selectedGroupId]
  );
  const reportSourcesForDeletion = useMemo(() => {
    return Array.isArray(reviewSourceOptions) ? reviewSourceOptions : [];
  }, [reviewSourceOptions]);
  const inviteGroupId = useMemo(() => {
    if (Number.isInteger(Number(selectedGroupId)) && Number(selectedGroupId) > 0) return Number(selectedGroupId);
    if (!isSuperAdmin && Array.isArray(groups) && groups.length === 1) return Number(groups[0].id);
    return null;
  }, [selectedGroupId, groups, isSuperAdmin]);
  const selectedGroupEntitlements = useMemo(
    () => normalizeGroupEntitlements(selectedGroup?.entitlements || {}),
    [selectedGroup]
  );
  useEffect(() => {
    if (!selectedGroup) {
      setGroupSettingsDraft(null);
      setGroupSettingsDirty(false);
      lastLoadedGroupIdRef.current = null;
      return;
    }
    const selectedId = Number(selectedGroup.id);
    const sameGroup = Number(lastLoadedGroupIdRef.current) === selectedId;
    if (sameGroup && groupSettingsDirty) return;
    const ent = normalizeGroupEntitlements(selectedGroup.entitlements || {});
    const bundleTier = BUNDLE_KEYS.includes(String(ent.bundleTier || "").toLowerCase())
      ? String(ent.bundleTier || "").toLowerCase()
      : "";
    const bundleFeatureSets = ensureBundleFeatureSets(ent.bundleFeatureSets, ent.features || {});
    const activeFeatures = bundleTier ? (bundleFeatureSets[bundleTier] || ent.features || {}) : (ent.features || {});
    const bundleCapacityLimits = ensureBundleCapacityLimits(ent.bundleCapacityLimits, {
      maxUsers: ent.maxUsers ?? "",
      maxReportSources: ent.maxReportSources ?? "",
    });
    const activeCapacityLimits = bundleTier ? (bundleCapacityLimits[bundleTier] || {}) : {
      maxUsers: ent.maxUsers ?? "",
      maxReportSources: ent.maxReportSources ?? "",
    };
    setGroupSettingsDraft({
      maxFileSizeMb: String(selectedGroup.max_file_size_mb || 100),
      maxTotalStorageMb: String(selectedGroup.max_total_storage_mb || 10240),
      maxUsers: activeCapacityLimits.maxUsers ?? "",
      maxReportSources: activeCapacityLimits.maxReportSources ?? "",
      maxAiQueriesPerMonth: ent.maxAiQueriesPerMonth ?? "",
      aiMonthlyBudgetUsd: ent.aiMonthlyBudgetUsd ?? "",
      maxImportParseMemoryMb: ent.maxImportParseMemoryMb ?? "",
      bundleTier,
      bundleFeatureSets,
      bundleCapacityLimits,
      features: { ...activeFeatures },
    });
    setSelectedProductBundle(bundleTier);
    setGroupSettingsDirty(false);
    lastLoadedGroupIdRef.current = selectedId;
  }, [selectedGroup, groupSettingsDirty]);

  const updateGroupSettingsDraft = (patch) => {
    setGroupSettingsDirty(true);
    setGroupSettingsDraft((prev) => {
      const current = prev || {
        maxFileSizeMb: "",
        maxTotalStorageMb: "",
        maxUsers: "",
        maxReportSources: "",
        maxAiQueriesPerMonth: "",
        aiMonthlyBudgetUsd: "",
        maxImportParseMemoryMb: "",
        bundleTier: "",
        bundleFeatureSets: {},
        bundleCapacityLimits: {},
        features: {},
      };
      return {
        ...current,
        ...patch,
        bundleFeatureSets: {
          ...(current.bundleFeatureSets || {}),
          ...(patch.bundleFeatureSets || {}),
        },
        bundleCapacityLimits: {
          ...(current.bundleCapacityLimits || {}),
          ...(patch.bundleCapacityLimits || {}),
        },
        features: {
          ...(current.features || {}),
          ...(patch.features || {}),
        },
      };
    });
  };

  const saveGroupSettings = async () => {
    if (!selectedGroupId || (!isSuperAdmin && user?.role !== "admin") || !groupSettingsDraft || groupSettingsSaving) return;
    setGroupSettingsSaved(false);
    setGroupSettingsSaving(true);
    try {
      const maxFileSizeMb = Number.parseInt(String(groupSettingsDraft.maxFileSizeMb || "").trim(), 10);
      const maxTotalStorageMb = Number.parseInt(String(groupSettingsDraft.maxTotalStorageMb || "").trim(), 10);
      const draftBundleTier = BUNDLE_KEYS.includes(String(groupSettingsDraft.bundleTier || "").toLowerCase())
        ? String(groupSettingsDraft.bundleTier || "").toLowerCase()
        : "";
      const bundleCapacityLimits = ensureBundleCapacityLimits(groupSettingsDraft.bundleCapacityLimits, {
        maxUsers: groupSettingsDraft.maxUsers ?? "",
        maxReportSources: groupSettingsDraft.maxReportSources ?? "",
      });
      const activeCapacityLimits = draftBundleTier ? (bundleCapacityLimits[draftBundleTier] || {}) : {
        maxUsers: groupSettingsDraft.maxUsers ?? "",
        maxReportSources: groupSettingsDraft.maxReportSources ?? "",
      };
      const entitlements = normalizeGroupEntitlements({
        ...selectedGroupEntitlements,
        maxUsers: activeCapacityLimits.maxUsers === "" ? null : Number(activeCapacityLimits.maxUsers),
        maxReportSources: activeCapacityLimits.maxReportSources === "" ? null : Number(activeCapacityLimits.maxReportSources),
        maxAiQueriesPerMonth: groupSettingsDraft.maxAiQueriesPerMonth === "" ? null : Number(groupSettingsDraft.maxAiQueriesPerMonth),
        aiMonthlyBudgetUsd: groupSettingsDraft.aiMonthlyBudgetUsd === "" ? null : Number(groupSettingsDraft.aiMonthlyBudgetUsd),
        maxImportParseMemoryMb: groupSettingsDraft.maxImportParseMemoryMb === "" ? null : Number(groupSettingsDraft.maxImportParseMemoryMb),
        bundleTier: draftBundleTier || null,
        bundleFeatureSets: ensureBundleFeatureSets(
          groupSettingsDraft.bundleFeatureSets,
          groupSettingsDraft.features || {}
        ),
        bundleCapacityLimits,
        features: { ...(groupSettingsDraft.features || {}) },
      });
      const saveRes = await axios.patch(`${API}/groups/${selectedGroupId}`, {
        maxFileSizeMb: Number.isInteger(maxFileSizeMb) && maxFileSizeMb > 0 ? maxFileSizeMb : 100,
        maxTotalStorageMb: Number.isInteger(maxTotalStorageMb) && maxTotalStorageMb > 0 ? maxTotalStorageMb : 10240,
        entitlements,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const savedGroup = saveRes?.data || {};
      const savedEntitlements = normalizeGroupEntitlements(savedGroup?.entitlements || entitlements);
      const savedBundleTier = BUNDLE_KEYS.includes(String(savedEntitlements.bundleTier || "").toLowerCase())
        ? String(savedEntitlements.bundleTier || "").toLowerCase()
        : "";
      const savedBundleFeatureSets = ensureBundleFeatureSets(
        savedEntitlements.bundleFeatureSets,
        savedEntitlements.features || {}
      );
      const savedBundleCapacityLimits = ensureBundleCapacityLimits(savedEntitlements.bundleCapacityLimits, {
        maxUsers: savedEntitlements.maxUsers ?? "",
        maxReportSources: savedEntitlements.maxReportSources ?? "",
      });
      const savedActiveCapacityLimits = savedBundleTier ? (savedBundleCapacityLimits[savedBundleTier] || {}) : {
        maxUsers: savedEntitlements.maxUsers ?? "",
        maxReportSources: savedEntitlements.maxReportSources ?? "",
      };
      const savedActiveFeatures = savedBundleTier
        ? (savedBundleFeatureSets[savedBundleTier] || savedEntitlements.features || {})
        : (savedEntitlements.features || {});
      setGroups((prev) => (Array.isArray(prev) ? prev.map((g) => (
        Number(g?.id) === Number(selectedGroupId)
          ? {
              ...g,
              ...savedGroup,
              entitlements: savedEntitlements,
            }
          : g
      )) : prev));
      setGroupSettingsDraft((prev) => prev ? {
        ...prev,
        maxFileSizeMb: String(savedGroup?.max_file_size_mb || (Number.isInteger(maxFileSizeMb) && maxFileSizeMb > 0 ? maxFileSizeMb : 100)),
        maxTotalStorageMb: String(savedGroup?.max_total_storage_mb || (Number.isInteger(maxTotalStorageMb) && maxTotalStorageMb > 0 ? maxTotalStorageMb : 10240)),
        maxUsers: savedActiveCapacityLimits.maxUsers ?? "",
        maxReportSources: savedActiveCapacityLimits.maxReportSources ?? "",
        maxAiQueriesPerMonth: savedEntitlements.maxAiQueriesPerMonth ?? "",
        aiMonthlyBudgetUsd: savedEntitlements.aiMonthlyBudgetUsd ?? "",
        maxImportParseMemoryMb: savedEntitlements.maxImportParseMemoryMb ?? "",
        bundleTier: savedBundleTier,
        bundleFeatureSets: savedBundleFeatureSets,
        bundleCapacityLimits: savedBundleCapacityLimits,
        features: { ...savedActiveFeatures },
      } : prev);
      setSelectedProductBundle(savedBundleTier);
      setGroupSettingsDirty(false);
      lastLoadedGroupIdRef.current = Number(selectedGroupId);
      await fetchGroups();
      setGroupSettingsSaved(true);
      setTimeout(() => setGroupSettingsSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save customer settings");
    } finally {
      setGroupSettingsSaving(false);
    }
  };
  const [collapsedSections, setCollapsedSections] = useState({
    users: false,
    groups: false,
    integrations: false,
    permissions: true,
  });
  const toggleSection = (key) => {
  return {
    createUser,
    saveEditUser,
    deleteUser,
    inviteCustomerUser,
    resendInvitation,
    revokeInvitation,
    createGroup,
    saveGroupSettings,
    deleteGroup,
    addMember,
    removeMember,
    toggleGroupAdmin,
    saveUserPerms,
    saveGroupPerms,
    saveAssignedViews,
    savePasswordReset,
    loadAiUsageSummary,
    saveGroupCapacityLimits,
    saveStorageSettings,
  };
}
