// UserManagement.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

/** ---------------------------
 * Local templates (frontend-only)
 * --------------------------- */
const LS_KEY = "permTemplates:v1";
function loadTemplates() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveTemplates(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr || []));
}

const DEFAULT_GROUP_ENTITLEMENTS = {
  maxUsers: "",
  maxReportSources: "",
  maxAiQueriesPerMonth: "",
  aiMonthlyBudgetUsd: "",
  features: {
    manageUsers: true,
    managePermissions: true,
    manageFolders: true,
    manageGroupAdmins: false,
    ai: true,
    exports: true,
    imports: true,
    approvalFlow: false,
    auditLogs: false,
    googleDrive: true,
    dropbox: true,
    oneDrive: true,
  },
};

const RESET_PASSWORD_LENGTH = 16;
const RESET_PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.?";
const RESET_PASSWORD_REQUIRED_SETS = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "!@#$%^&*()-_=+[]{};:,.?",
];

function secureRandomInt(max) {
  if (window.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    return value[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function generateAdminPassword(length = RESET_PASSWORD_LENGTH) {
  const chars = RESET_PASSWORD_REQUIRED_SETS.map((set) => set[secureRandomInt(set.length)]);
  while (chars.length < length) {
    chars.push(RESET_PASSWORD_ALPHABET[secureRandomInt(RESET_PASSWORD_ALPHABET.length)]);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function normalizeGroupEntitlements(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...DEFAULT_GROUP_ENTITLEMENTS,
    ...raw,
    maxUsers: raw.maxUsers ?? "",
    maxReportSources: raw.maxReportSources ?? "",
    maxAiQueriesPerMonth: raw.maxAiQueriesPerMonth ?? "",
    aiMonthlyBudgetUsd: raw.aiMonthlyBudgetUsd ?? "",
    features: {
      ...DEFAULT_GROUP_ENTITLEMENTS.features,
      ...(raw.features || {}),
    },
  };
}

export default function UserManagement({ token, user, sheetId }) {
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + "..." : s);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ firstName: "", lastName: "", company: "", email: "", password: "", role: "user" });
  const [passwordResetModal, setPasswordResetModal] = useState({
    open: false,
    userId: null,
    label: "",
    password: "",
    repeat: "",
  });
  const [googleIntegrationEnabled, setGoogleIntegrationEnabled] = useState(true);
  const [googleIntegrationSaving, setGoogleIntegrationSaving] = useState(false);
  const [googleOauthMeta, setGoogleOauthMeta] = useState({
    hasClientId: false,
    hasClientSecret: false,
    clientIdMasked: "",
    clientSecretMasked: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [googleOauthForm, setGoogleOauthForm] = useState({
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [googleOauthSaving, setGoogleOauthSaving] = useState(false);
  const [dropboxIntegrationEnabled, setDropboxIntegrationEnabled] = useState(true);
  const [dropboxIntegrationSaving, setDropboxIntegrationSaving] = useState(false);
  const [dropboxOauthMeta, setDropboxOauthMeta] = useState({
    hasClientId: false,
    hasClientSecret: false,
    clientIdMasked: "",
    clientSecretMasked: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [dropboxOauthForm, setDropboxOauthForm] = useState({
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [dropboxOauthSaving, setDropboxOauthSaving] = useState(false);
  const [oneDriveIntegrationEnabled, setOneDriveIntegrationEnabled] = useState(true);
  const [oneDriveIntegrationSaving, setOneDriveIntegrationSaving] = useState(false);
  const [oneDriveOauthMeta, setOneDriveOauthMeta] = useState({
    hasClientId: false,
    hasClientSecret: false,
    clientIdMasked: "",
    clientSecretMasked: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [oneDriveOauthForm, setOneDriveOauthForm] = useState({
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [oneDriveOauthSaving, setOneDriveOauthSaving] = useState(false);

  // user-level permissions UI (select a sheet from user's groups)
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userSheets, setUserSheets] = useState([]);                // latest 10 for selected user
  const [selectedUserSheetId, setSelectedUserSheetId] = useState(null);
  const [selectedReportSourceId, setSelectedReportSourceId] = useState(null);
  const [userSheetHeaders, setUserSheetHeaders] = useState([]);
  const [userAllowedCols, setUserAllowedCols] = useState(new Set());
  const [userRowFilters, setUserRowFilters] = useState([{ key: "", value: "" }]);
  const [userDefaultViewId, setUserDefaultViewId] = useState("");

  // groups
  const [groups, setGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupAddUserId, setGroupAddUserId] = useState("");

  // customer permissions (per-sheet)
  const [groupAllowedCols, setGroupAllowedCols] = useState(new Set());
  const [groupRowFilters, setGroupRowFilters] = useState([{ key: "", value: "" }]);

  // report source selection drives the current sheet used by existing permission enforcement
  const [reportSources, setReportSources] = useState([]);
  const [groupSheetHeaders, setGroupSheetHeaders] = useState([]);

  // Templates (now scoped by group)
  const [templates, setTemplates] = useState(loadTemplates());
  // ...

  // Folders
  const [folders, setFolders] = useState([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderOwnershipType, setFolderOwnershipType] = useState("group");
  const [folderOwnerUserId, setFolderOwnerUserId] = useState("");
  const [folderOwnerGroupId, setFolderOwnerGroupId] = useState("");
  const [folderMaxFileSizeMb, setFolderMaxFileSizeMb] = useState("100");
  const [folderMaxTotalSizeMb, setFolderMaxTotalSizeMb] = useState("1024");
  const [selectedFolderId, setSelectedFolderId] = useState("");

  const fetchFolders = async () => {
    try {
      const res = await axios.get(`${API}/folders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFolders(res.data || []);
    } catch (e) { console.error(e); }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      let effectiveGroupIds = [];
      if (folderOwnershipType === "group") {
        if (!folderOwnerGroupId) {
          alert("Select an owner customer");
          return;
        }
        effectiveGroupIds = [Number(folderOwnerGroupId)];
      } else if (folderOwnershipType === "user") {
        if (!folderOwnerUserId) {
          alert("Select an owner user");
          return;
        }
        effectiveGroupIds = await getGroupsForUser(folderOwnerUserId);
        if (!effectiveGroupIds.length) {
          alert("Selected user does not belong to any customers");
          return;
        }
      } else {
        alert("Select a valid folder ownership mode");
        return;
      }
      await axios.post(`${API}/folders`, {
        name: newFolderName,
        groupIds: effectiveGroupIds,
        ownerUserId: folderOwnershipType === "user" ? Number(folderOwnerUserId) : null,
        maxFileSizeMb: Number(folderMaxFileSizeMb || 100),
        maxTotalSizeMb: Number(folderMaxTotalSizeMb || 1024),
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNewFolderName("");
      setFolderOwnershipType("group");
      setFolderOwnerUserId("");
      setFolderOwnerGroupId("");
      setFolderMaxFileSizeMb("100");
      setFolderMaxTotalSizeMb("1024");
      fetchFolders();
    } catch (e) {
      if (e.response && e.response.status === 409) {
        alert("A folder with this name already exists.");
      } else {
        alert("Create folder failed");
        console.error(e);
      }
    }
  };

  const deleteFolder = async (fid) => {
    if (!confirm("Delete folder?")) return;
    try {
      await axios.delete(`${API}/folders/${fid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchFolders();
    } catch (e) { alert("Delete folder failed"); }
  };

  useEffect(() => {
    fetchFolders();
  }, []);

  // ... rest of state
  const [newTplNameUser, setNewTplNameUser] = useState("");
  const [newTplNameGroup, setNewTplNameGroup] = useState("");
  const [selectedTplUser, setSelectedTplUser] = useState("");
  const [selectedTplGroup, setSelectedTplGroup] = useState("");

  // Views
  const [views, setViews] = useState([]);
  const [userViews, setUserViews] = useState(new Set());
  const [groupViews, setGroupViews] = useState(new Set());
  const [selectedUserGroupIds, setSelectedUserGroupIds] = useState(new Set());
  const [userGroupMap, setUserGroupMap] = useState({});
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingFolderOwnerGroupId, setEditingFolderOwnerGroupId] = useState("");
  const [editingFolderMaxFileSizeMb, setEditingFolderMaxFileSizeMb] = useState("100");
  const [editingFolderMaxTotalSizeMb, setEditingFolderMaxTotalSizeMb] = useState("1024");
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUserForm, setEditingUserForm] = useState({ firstName: "", lastName: "", company: "", email: "" });
  const [deleteUserId, setDeleteUserId] = useState("");

  const userById = useMemo(() => {
    const m = new Map();
    (users || []).forEach((u) => {
        if (u && u.id) m.set(u.id, u);
    });
    return m;
  }, [users]);

  const folderById = useMemo(() => {
    const m = new Map();
    (folders || []).forEach((f) => {
        if (f && f.id) m.set(f.id, f);
    });
    return m;
  }, [folders]);

  const uniqueGroupMembers = useMemo(() => {
    const m = new Map();
    (groupMembers || []).forEach((mem) => {
        if (mem && mem.id) m.set(mem.id, mem);
    });
    return Array.from(m.values());
  }, [groupMembers]);

  const uniqueUsers = useMemo(() => {
    const m = new Map();
    (users || []).forEach((u) => {
        if (u && u.id) m.set(u.id, u);
    });
    return Array.from(m.values());
  }, [users]);

  const fetchReportSources = async () => {
    try {
      const res = await axios.get(`${API}/report-sources`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setReportSources(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("fetchReportSources failed", e);
    }
  };

  // fetch users
  const fetchUsers = async () => {
    try {
      const res = await axios.get(`${API}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers(res.data || []);
    } catch (e) {
      console.error("fetchUsers failed", e);
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await axios.get(`${API}/groups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroups(res.data || []);
    } catch (e) {
      console.error("fetchGroups failed", e);
    }
  };

  const fetchGoogleIntegrationSetting = async () => {
    if (user?.role !== "admin") return;
    try {
      const res = await axios.get(`${API}/admin/settings/google-integration`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGoogleIntegrationEnabled(!!res?.data?.enabled);
    } catch (e) {
      console.error("fetchGoogleIntegrationSetting failed", e);
    }
  };

  const toggleGoogleIntegration = async () => {
    if (user?.role !== "admin" || googleIntegrationSaving) return;
    const nextEnabled = !googleIntegrationEnabled;
    setGoogleIntegrationSaving(true);
    try {
      await axios.patch(`${API}/admin/settings/google-integration`, { enabled: nextEnabled }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGoogleIntegrationEnabled(nextEnabled);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update Google integration");
    } finally {
      setGoogleIntegrationSaving(false);
    }
  };

  const fetchGoogleOauthSetting = async () => {
    if (user?.role !== "admin") return;
    try {
      const res = await axios.get(`${API}/admin/settings/google-oauth`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setGoogleOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setGoogleOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      }));
    } catch (e) {
      console.error("fetchGoogleOauthSetting failed", e);
    }
  };

  const saveGoogleOauthSetting = async () => {
    if (user?.role !== "admin" || googleOauthSaving) return;
    setGoogleOauthSaving(true);
    try {
      const payload = {
        clientId: googleOauthForm.clientId || "***",
        clientSecret: googleOauthForm.clientSecret || "***",
        redirectUri: googleOauthForm.redirectUri || "",
        frontendUrl: googleOauthForm.frontendUrl || "",
      };
      const res = await axios.patch(`${API}/admin/settings/google-oauth`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setGoogleOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setGoogleOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
      }));
      alert("Google OAuth settings updated");
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update Google OAuth settings");
    } finally {
      setGoogleOauthSaving(false);
    }
  };

  const fetchDropboxIntegrationSetting = async () => {
    if (user?.role !== "admin") return;
    try {
      const res = await axios.get(`${API}/admin/settings/dropbox-integration`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDropboxIntegrationEnabled(!!res?.data?.enabled);
    } catch (e) {
      console.error("fetchDropboxIntegrationSetting failed", e);
    }
  };

  const toggleDropboxIntegration = async () => {
    if (user?.role !== "admin" || dropboxIntegrationSaving) return;
    const nextEnabled = !dropboxIntegrationEnabled;
    setDropboxIntegrationSaving(true);
    try {
      await axios.patch(`${API}/admin/settings/dropbox-integration`, { enabled: nextEnabled }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDropboxIntegrationEnabled(nextEnabled);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update Dropbox integration");
    } finally {
      setDropboxIntegrationSaving(false);
    }
  };

  const fetchDropboxOauthSetting = async () => {
    if (user?.role !== "admin") return;
    try {
      const res = await axios.get(`${API}/admin/settings/dropbox-oauth`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setDropboxOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setDropboxOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      }));
    } catch (e) {
      console.error("fetchDropboxOauthSetting failed", e);
    }
  };

  const saveDropboxOauthSetting = async () => {
    if (user?.role !== "admin" || dropboxOauthSaving) return;
    setDropboxOauthSaving(true);
    try {
      const payload = {
        clientId: dropboxOauthForm.clientId || "***",
        clientSecret: dropboxOauthForm.clientSecret || "***",
        redirectUri: dropboxOauthForm.redirectUri || "",
        frontendUrl: dropboxOauthForm.frontendUrl || "",
      };
      const res = await axios.patch(`${API}/admin/settings/dropbox-oauth`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setDropboxOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setDropboxOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
      }));
      alert("Dropbox OAuth settings updated");
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update Dropbox OAuth settings");
    } finally {
      setDropboxOauthSaving(false);
    }
  };

  const fetchOneDriveIntegrationSetting = async () => {
    if (user?.role !== "admin") return;
    try {
      const res = await axios.get(`${API}/admin/settings/onedrive-integration`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOneDriveIntegrationEnabled(!!res?.data?.enabled);
    } catch (e) {
      console.error("fetchOneDriveIntegrationSetting failed", e);
    }
  };

  const toggleOneDriveIntegration = async () => {
    if (user?.role !== "admin" || oneDriveIntegrationSaving) return;
    const nextEnabled = !oneDriveIntegrationEnabled;
    setOneDriveIntegrationSaving(true);
    try {
      await axios.patch(`${API}/admin/settings/onedrive-integration`, { enabled: nextEnabled }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOneDriveIntegrationEnabled(nextEnabled);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update OneDrive integration");
    } finally {
      setOneDriveIntegrationSaving(false);
    }
  };

  const fetchOneDriveOauthSetting = async () => {
    if (user?.role !== "admin") return;
    try {
      const res = await axios.get(`${API}/admin/settings/onedrive-oauth`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setOneDriveOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setOneDriveOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      }));
    } catch (e) {
      console.error("fetchOneDriveOauthSetting failed", e);
    }
  };

  const saveOneDriveOauthSetting = async () => {
    if (user?.role !== "admin" || oneDriveOauthSaving) return;
    setOneDriveOauthSaving(true);
    try {
      const payload = {
        clientId: oneDriveOauthForm.clientId || "***",
        clientSecret: oneDriveOauthForm.clientSecret || "***",
        redirectUri: oneDriveOauthForm.redirectUri || "",
        frontendUrl: oneDriveOauthForm.frontendUrl || "",
      };
      const res = await axios.patch(`${API}/admin/settings/onedrive-oauth`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setOneDriveOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setOneDriveOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
      }));
      alert("OneDrive OAuth settings updated");
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update OneDrive OAuth settings");
    } finally {
      setOneDriveOauthSaving(false);
    }
  };

  const fetchGroupMembers = async (gid) => {
    if (!gid) return setGroupMembers([]);
    try {
      const res = await axios.get(`${API}/groups/${gid}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroupMembers(res.data || []);
    } catch (e) {
      console.error("fetchGroupMembers failed", e);
    }
  };

  // Fetch all groups a given user belongs to — single DB-side JOIN, O(1) request
  const getGroupsForUser = async (uid) => {
    try {
      const res = await axios.get(`${API}/users/${uid}/groups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return (res.data || []).map((g) => g.id);
    } catch (e) {
      console.error("getGroupsForUser failed:", e);
      return [];
    }
  };

  // latest 10 sheets for the SELECTED USER (based on their groups)
  const fetchUserGroupMap = async () => {
    if (!uniqueUsers.length) {
      setUserGroupMap({});
      return;
    }
    const pairs = await Promise.all(uniqueUsers.map(async (u) => {
      const gids = await getGroupsForUser(u.id);
      const names = gids
        .map((gid) => Array.isArray(groups) && groups.find((g) => Number(g.id) === Number(gid))?.name || String(gid))
        .filter(Boolean);
      return [u.id, names];
    }));
    setUserGroupMap(Object.fromEntries(pairs));
  };

  const fetchUserSheets = async (uid) => {
    if (!uid) { setUserSheets([]); return; }
    try {
      const gids = await getGroupsForUser(uid);
      const agg = [];
      for (const gid of gids) {
        try {
          const res = await axios.get(`${API}/groups/${gid}/sheets`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          // Keep group context on each sheet record
          (res.data || []).forEach((r) => agg.push({ ...r, _group_id: gid }));
        } catch (e) {
          console.error("fetchGroupSheets(for user) failed", e);
        }
      }
      // dedupe by sheet id, sort desc, take latest 10
      const map = new Map();
      agg.forEach((s) => { map.set(String(s.id), s); });
      const uniq = Array.from(map.values()).sort(
        (a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)
      );
      setUserSheets(uniq.slice(0, 10));
    } catch (e) {
      console.error("fetchUserSheets failed", e);
      setUserSheets([]);
    }
  };

  const loadUserPermissions = async (uid, sid, reportSourceId = selectedReportSourceId) => {
    if (!uid || !sid) {
      setUserAllowedCols(new Set());
      setUserRowFilters([{ key: "", value: "" }]);
      return;
    }
    const endpoint = reportSourceId ? `${API}/report-source-permissions` : `${API}/permissions`;
    const params = reportSourceId
      ? { userId: uid, reportSourceId }
      : { userId: uid, sheetId: sid };
    const res = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      params
    });
    const allowed = res.data?.allowed_columns || [];
    const filters = res.data?.row_filters || {};
    setUserAllowedCols(new Set(allowed));
    // Convert object to array of {key, value} pairs
    const filterArray = Object.entries(filters).map(([key, value]) => ({ key, value }));
    setUserRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  };

  // load user sheet headers
  const fetchUserSheetHeaders = async (sid) => {
    if (!sid) { setUserSheetHeaders([]); return; }
    const res = await axios.get(`${API}/sheets/${sid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const h = res.data?.headers || [];
    setUserSheetHeaders(Array.isArray(h) ? h : []);
  };

  // group perms helpers
  const loadGroupPermissions = async (gid, sid, reportSourceId = selectedReportSourceId) => {
    if (!gid || !sid) {
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      return;
    }
    const endpoint = reportSourceId ? `${API}/report-source-group-permissions` : `${API}/group-permissions`;
    const params = reportSourceId
      ? { groupId: gid, reportSourceId }
      : { groupId: gid, sheetId: sid };
    const res = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      params
    });
    const allowed = res.data?.allowed_columns || [];
    const filters = res.data?.row_filters || {};
    setGroupAllowedCols(new Set(allowed));
    // Convert object to array of {key, value} pairs
    const filterArray = Object.entries(filters).map(([key, value]) => ({ key, value }));
    setGroupRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  };

  const fetchGroupSheetHeaders = async (sid) => {
    if (!sid) { setGroupSheetHeaders([]); return; }
    const res = await axios.get(`${API}/sheets/${sid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const h = res.data?.headers || [];
    setGroupSheetHeaders(Array.isArray(h) ? h : []);
  };

  useEffect(() => {
    if (token) {
      fetchUsers();
      fetchGroups();
      fetchAllViews();
      fetchReportSources();
      fetchGoogleIntegrationSetting();
      fetchGoogleOauthSetting();
      fetchDropboxIntegrationSetting();
      fetchDropboxOauthSetting();
      fetchOneDriveIntegrationSetting();
      fetchOneDriveOauthSetting();
    }
  }, [token]);



  const fetchAllViews = async () => {
    try {
      const res = await axios.get(`${API}/views`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setViews(res.data || []);
    } catch (e) {
      console.error("fetchAllViews failed", e);
    }
  };

  const fetchUserViews = async (userId) => {
    if (!userId) return;
    const res = await axios.get(`${API}/views/user-permissions/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setUserViews(new Set((res.data || []).map((v) => v.id)));
  };

  const toggleUserViewPerm = async (viewId) => {
    if (!selectedUserId) return;
    const hasPerm = userViews.has(viewId);
    try {
      if (hasPerm) {
        await axios.delete(`${API}/views/user-permissions/${viewId}/${selectedUserId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await axios.post(`${API}/views/user-permissions`, { viewId, userId: selectedUserId }, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      fetchUserViews(selectedUserId);
    } catch (e) {
      console.error("toggleUserViewPerm failed", e);
    }
  };

  const fetchGroupViews = async (groupId) => {
    if (!groupId) return;
    const res = await axios.get(`${API}/views/group-permissions/${groupId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setGroupViews(new Set((res.data || []).map((v) => v.id)));
  };

  const toggleGroupViewPerm = async (viewId) => {
    if (!selectedGroupId) return;
    const hasPerm = groupViews.has(viewId);
    try {
      if (hasPerm) {
        await axios.delete(`${API}/views/group-permissions/${viewId}/${selectedGroupId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await axios.post(`${API}/views/group-permissions`, { viewId, groupId: selectedGroupId }, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      fetchGroupViews(selectedGroupId);
    } catch (e) {
      console.error("toggleGroupViewPerm failed", e);
    }
  };

  const fetchSelectedUserGroups = async (uid) => {
    if (!uid) {
      setSelectedUserGroupIds(new Set());
      return;
    }
    const gids = await getGroupsForUser(uid);
    setSelectedUserGroupIds(new Set(gids.map((g) => Number(g))));
  };

  // when user changes, reload their 10 sheets and reset user-perms state
  useEffect(() => {
    if (selectedUserId) {
      fetchUserSheets(selectedUserId);
      fetchUserViews(selectedUserId);
      fetchSelectedUserGroups(selectedUserId);
      setSelectedUserSheetId(null);
      setSelectedReportSourceId(null);
      setUserSheetHeaders([]);
      setUserAllowedCols(new Set());
      setUserRowFilters([{ key: "", value: "" }]);
      setSelectedTplUser("");
    } else {
      setSelectedUserGroupIds(new Set());
    }
  }, [selectedUserId]);
  useEffect(() => {
    fetchUserGroupMap();
  }, [users, groups]);

  // when user sheet changes, load headers and that user's perms for that sheet
  useEffect(() => {
    if (selectedUserSheetId && selectedUserId) {
      fetchUserSheetHeaders(selectedUserSheetId);
      loadUserPermissions(selectedUserId, selectedUserSheetId, selectedReportSourceId);
    } else {
      setUserSheetHeaders([]);
      setUserAllowedCols(new Set());
      setUserRowFilters([{ key: "", value: "" }]);
    }
  }, [selectedUserSheetId, selectedUserId, selectedReportSourceId]);

  // when group changes, reload members & sheets, reset group-perms state
  useEffect(() => {
    if (selectedGroupId) {
      fetchGroupMembers(selectedGroupId);
      fetchGroupViews(selectedGroupId);
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      setGroupSheetHeaders([]);
      setSelectedTplGroup("");
    }
  }, [selectedGroupId]);

  // customer overrides use the SAME selected sheet as user overrides
  useEffect(() => {
    if (!selectedUserSheetId || !selectedGroupId) {
      setGroupSheetHeaders([]);
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      return;
    }
    fetchGroupSheetHeaders(selectedUserSheetId);
    loadGroupPermissions(selectedGroupId, selectedUserSheetId, selectedReportSourceId);
  }, [selectedUserSheetId, selectedGroupId, selectedReportSourceId]);

  const toggleUserAllowed = (h) => {
    setUserAllowedCols(prev => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h); else next.add(h);
      return next;
    });
  };

  const toggleGroupAllowed = (h) => {
    setGroupAllowedCols(prev => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h); else next.add(h);
      return next;
    });
  };

  // --- Actions: users ---
  const addUser = async () => {
    if (!String(newUser.firstName || "").trim() || !String(newUser.lastName || "").trim() || !String(newUser.company || "").trim() || !String(newUser.email || "").trim() || !String(newUser.password || "").trim()) {
      alert("First name, last name, company, email, and password are required.");
      return;
    }
    if (user?.role !== "admin" && !selectedGroupId) {
      alert("Select a customer before creating a customer user.");
      return;
    }
    try {
      await axios.post(`${API}/users`, {
        ...newUser,
        role: user?.role === "admin" ? newUser.role : "user",
        ...(selectedGroupId ? { groupId: Number(selectedGroupId) } : {}),
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNewUser({ firstName: "", lastName: "", company: "", email: "", password: "", role: "user" });
      fetchUsers();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to create user");
    }
  };

  const openPasswordResetModal = (id, label = "this user") => {
    if (!id) return;
    setPasswordResetModal({
      open: true,
      userId: id,
      label,
      password: "",
      repeat: "",
    });
  };

  const closePasswordResetModal = () => {
    setPasswordResetModal({
      open: false,
      userId: null,
      label: "",
      password: "",
      repeat: "",
    });
  };

  const fillGeneratedResetPassword = () => {
    const password = generateAdminPassword();
    setPasswordResetModal((prev) => ({ ...prev, password, repeat: password }));
  };

  const copyResetPassword = async () => {
    const password = String(passwordResetModal.password || "");
    if (!password) {
      alert("Generate or enter a password first.");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(password);
      } else {
        const input = document.createElement("textarea");
        input.value = password;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      alert("Password copied.");
    } catch {
      alert("Could not copy password.");
    }
  };

  const submitPasswordReset = async () => {
    const id = passwordResetModal.userId;
    const password = String(passwordResetModal.password || "");
    const repeat = String(passwordResetModal.repeat || "");
    if (!id) return;
    if (password.length < RESET_PASSWORD_LENGTH) {
      alert(`Password must be at least ${RESET_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== repeat) {
      alert("Passwords do not match.");
      return;
    }
    try {
      await axios.patch(`${API}/users/${id}`, { reset: true, password }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert("Password reset. The user will be required to change it after login.");
      closePasswordResetModal();
      fetchUsers();
      if (selectedGroupId) fetchGroupMembers(selectedGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to reset password");
    }
  };

  const changeRole = async (id, role) => {
    await axios.patch(`${API}/users/${id}`, { role }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchUsers();
  };

  const deleteUser = async (id) => {
    if (!confirm("Delete user?")) return;
    try {
      await axios.delete(`${API}/users/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (selectedUserId === id) setSelectedUserId(null);
      fetchUsers();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to delete user");
    }
  };
  const beginEditUser = (u) => {
    setEditingUserId(u.id);
    setEditingUserForm({
      firstName: u.first_name || "",
      lastName: u.last_name || "",
      company: u.company || "",
      email: u.email || "",
    });
  };
  const cancelEditUser = () => {
    setEditingUserId(null);
    setEditingUserForm({ firstName: "", lastName: "", company: "", email: "" });
  };
  const saveEditUser = async (id) => {
    if (!String(editingUserForm.firstName || "").trim() || !String(editingUserForm.lastName || "").trim() || !String(editingUserForm.company || "").trim() || !String(editingUserForm.email || "").trim()) {
      alert("First name, last name, company, and email are required.");
      return;
    }
    try {
      await axios.patch(`${API}/users/${id}`, {
        firstName: editingUserForm.firstName,
        lastName: editingUserForm.lastName,
        company: editingUserForm.company,
        email: editingUserForm.email,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      cancelEditUser();
      fetchUsers();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update user");
    }
  };
  const toggleUserGroupMembership = async (uid, gid, shouldAdd) => {
    try {
      if (shouldAdd) {
        await axios.post(`${API}/groups/${gid}/users`, { userId: Number(uid) }, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await axios.delete(`${API}/groups/${gid}/users/${uid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      await fetchSelectedUserGroups(uid);
      await fetchUserGroupMap();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update customer membership");
    }
  };
  const startEditFolder = (folder) => {
    setEditingFolderId(folder.id);
    setEditingFolderOwnerGroupId(String((folder.group_ids || [])[0] || ""));
    setEditingFolderMaxFileSizeMb(String(folder.max_file_size_mb || 100));
    setEditingFolderMaxTotalSizeMb(String(folder.max_total_size_mb || 1024));
  };
  const cancelEditFolder = () => {
    setEditingFolderId(null);
    setEditingFolderOwnerGroupId("");
  };
  const saveEditFolder = async (folderId) => {
    try {
      await axios.patch(`${API}/folders/${folderId}`, {
        groupIds: editingFolderOwnerGroupId ? [Number(editingFolderOwnerGroupId)] : [],
        maxFileSizeMb: Number(editingFolderMaxFileSizeMb || 100),
        maxTotalSizeMb: Number(editingFolderMaxTotalSizeMb || 1024),
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      cancelEditFolder();
      fetchFolders();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update folder settings");
    }
  };

  const saveUserPermissions = async () => {
    if (!selectedUserId || !selectedUserSheetId) {
      alert("Pick a user and a report source first.");
      return;
    }
    const allowed_columns = Array.from(userAllowedCols);
    const row_filters = {};
    userRowFilters.forEach(f => {
      if (f.key && f.value) row_filters[f.key] = f.value;
    });
    try {
      const endpoint = selectedReportSourceId ? `${API}/report-source-permissions` : `${API}/permissions`;
      await axios.post(endpoint, {
        ...(selectedReportSourceId ? { reportSourceId: selectedReportSourceId } : { sheetId: selectedUserSheetId }),
        userId: selectedUserId,
        allowed: allowed_columns,
        rowFilters: row_filters,
        allowed_columns,
        row_filters
      }, { headers: { Authorization: `Bearer ${token}` } });
      alert("User permissions saved");
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save user permissions");
    }
  };

  // --- Actions: groups ---
  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await axios.post(`${API}/groups`, { name: newGroupName.trim() }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNewGroupName("");
      fetchGroups();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to create customer");
    }
  };

  const updateGroup = async (gid, data) => {
    try {
      await axios.patch(`${API}/groups/${gid}`, data, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchGroups();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update customer");
    }
  };

  const addUserToGroup = async () => {
    if (!selectedGroupId || !groupAddUserId) return;
    try {
      await axios.post(`${API}/groups/${selectedGroupId}/users`, { userId: Number(groupAddUserId) }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroupAddUserId("");
      fetchGroupMembers(selectedGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to add user to customer");
    }
  };

  const removeUserFromGroup = async (uid) => {
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
    alert("Customer permissions saved");
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
    alert("Template saved");
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
    alert("Template saved");
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
  const selectedReportSource = useMemo(() => {
    return reportSourceOptions.find((source) => String(source.id) === String(selectedReportSourceId)) || null;
  }, [reportSourceOptions, selectedReportSourceId]);
  const selectReportSourceForPermissions = (value) => {
    const source = reportSourceOptions.find((item) => String(item.id) === String(value));
    setSelectedReportSourceId(source ? String(source.id) : null);
    setSelectedUserSheetId(source?.current_sheet_id || null);
  };
  const visibleFolders = useMemo(
    () => folders.filter((f) => !selectedGroupId || (f.group_ids || []).includes(Number(selectedGroupId))),
    [folders, selectedGroupId]
  );
  const selectedFolder = useMemo(
    () => visibleFolders.find((f) => Number(f.id) === Number(selectedFolderId)) || null,
    [visibleFolders, selectedFolderId]
  );
  useEffect(() => {
    if (!visibleFolders.length) {
      setSelectedFolderId("");
      return;
    }
    if (!visibleFolders.some((f) => Number(f.id) === Number(selectedFolderId))) {
      setSelectedFolderId("");
    }
  }, [visibleFolders, selectedFolderId]);



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
  const selectedGroupEntitlements = useMemo(
    () => normalizeGroupEntitlements(selectedGroup?.entitlements || {}),
    [selectedGroup]
  );
  const updateSelectedGroupEntitlements = (nextPatch) => {
    if (!selectedGroupId || user?.role !== "admin") return;
    updateGroup(selectedGroupId, {
      entitlements: normalizeGroupEntitlements({
        ...selectedGroupEntitlements,
        ...nextPatch,
        features: {
          ...selectedGroupEntitlements.features,
          ...(nextPatch.features || {}),
        },
      }),
    });
  };
  const [collapsedSections, setCollapsedSections] = useState({
    users: false,
    groups: false,
    folders: false,
    permissions: true,
  });
  const toggleSection = (key) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const formatBytes = (bytes) => {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };
  const formatMb = (mb) => formatBytes(Number(mb || 0) * 1024 * 1024);
  const displayNameFromEmail = (email) => {
    const local = String(email || "").split("@")[0] || "";
    return local
      .replace(/[._-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "User";
  };
  const displayNameForUser = (u) => {
    const full = [String(u?.first_name || "").trim(), String(u?.last_name || "").trim()].filter(Boolean).join(" ");
    return full || displayNameFromEmail(u?.email);
  };
  useEffect(() => {
    if (selectedUserId || selectedGroupId) {
      setCollapsedSections((prev) => ({ ...prev, permissions: false }));
    } else {
      setCollapsedSections((prev) => ({ ...prev, permissions: true }));
      setSelectedUserSheetId(null);
    }
  }, [selectedUserId, selectedGroupId]);

  return (
    <div className="admin-modern admin-compact p-4 lg:p-5 bg-slate-100 min-h-full overflow-auto">
      <div className="max-w-5xl mx-auto space-y-4">
      <div className="px-1 py-1 text-slate-100">
        <div className="rounded-sm bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Administration Console</h2>
            <p className="text-sm text-slate-300 mt-1">Manage identity, customers, storage boundaries, and data permissions.</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 font-medium">Users {users.length}</span>
            <span className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 font-medium">Customers {groups.length}</span>
            <span className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 font-medium">Folders {folders.length}</span>
          </div>
        </div>
      </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* 1. USERS PANEL */}
      <section className="lg:col-span-5 flex flex-col">
        <div className="flex items-center justify-between mb-4 border-b border-slate-300 pb-2">
          <h3 className="font-semibold text-base text-slate-900">User Management</h3>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{users.length} total</span>
            <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" onClick={() => toggleSection("users")}>
              {collapsedSections.users ? "Expand" : "Collapse"}
            </button>
          </div>
        </div>
        {!collapsedSections.users && (
        <>

        {/* Quick Add User */}
        <div className="flex flex-col gap-4 mb-6 bg-slate-50 p-4 rounded-md border border-slate-200">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 ml-1">Create User</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input-premium"
              placeholder="First name"
              value={newUser.firstName}
              onChange={e => setNewUser({ ...newUser, firstName: e.target.value })}
            />
            <input
              className="input-premium"
              placeholder="Last name"
              value={newUser.lastName}
              onChange={e => setNewUser({ ...newUser, lastName: e.target.value })}
            />
          </div>
          <input
            className="input-premium"
            placeholder="Company"
            value={newUser.company}
            onChange={e => setNewUser({ ...newUser, company: e.target.value })}
          />
          <input
            className="input-premium"
            placeholder="Email address"
            value={newUser.email}
            onChange={e => setNewUser({ ...newUser, email: e.target.value })}
          />
          <input
            className="input-premium"
            placeholder="Password"
            type="password"
            value={newUser.password}
            onChange={e => setNewUser({ ...newUser, password: e.target.value })}
          />
          <div className="flex items-center gap-3">
            {user?.role === "admin" ? (
              <select
                className="input-premium py-2 max-w-[120px]"
                value={newUser.role}
                onChange={e => setNewUser({ ...newUser, role: e.target.value })}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            ) : (
              <select
                className="input-premium py-2 max-w-[180px]"
                value={selectedGroupId || ""}
                onChange={e => setSelectedGroupId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select customer…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            <button
              className="btn-premium bg-slate-900 hover:bg-slate-800 text-white flex-1 py-2.5 shadow-sm"
              onClick={addUser}
            >
              {user?.role === "admin" ? "Add User" : "Add Customer User"}
            </button>
          </div>
        </div>

        {/* Delete User */}
        <div className="flex flex-col gap-2 mb-4 bg-rose-50 p-3 rounded-md border border-rose-200">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-rose-600 ml-1">Delete User</label>
          <div className="flex items-center gap-2">
            <select
              className="input-premium py-1.5 text-[11px] font-semibold flex-1"
              value={deleteUserId}
              onChange={(e) => setDeleteUserId(e.target.value)}
            >
              <option value="">Select user…</option>
              {uniqueUsers.map((u) => (
                <option key={String(u.id)} value={u.id}>
                  {displayNameForUser(u)} ({u.email})
                </option>
              ))}
            </select>
            <button
              className="btn-premium bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5"
              onClick={() => {
                if (!deleteUserId) return;
                deleteUser(deleteUserId);
                setDeleteUserId("");
              }}
              disabled={!deleteUserId}
            >
              Delete
            </button>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 mb-3">
          User listing and membership are managed under Customer Management below.
        </div>
        <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Customer Management</div>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{groups.length} total</span>
          </div>
          <div className="flex gap-2 mb-3">
            <input className="input-premium flex-1" placeholder="New customer name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
            <button className="btn-premium bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2" onClick={createGroup}>Create</button>
          </div>
          <div className="space-y-2 max-h-48 overflow-auto pr-1 custom-scrollbar">
            {groups.map(g => (
              <div key={g.id} className={`group flex items-center justify-between p-3 rounded-md border cursor-pointer ${selectedGroupId === g.id ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-200 hover:bg-slate-50"}`} onClick={() => setSelectedGroupId((prev) => (prev === g.id ? null : g.id))}>
                <div className="min-w-0 flex items-center gap-3">
                  <div className="text-xs font-semibold truncate">{g.name}</div>
                  <div className={`text-[10px] whitespace-nowrap ${selectedGroupId === g.id ? "text-emerald-100" : "text-slate-500"}`}>
                    {formatBytes(g.used_storage_bytes)} / {formatMb(g.max_total_storage_mb || 10240)} total
                  </div>
                </div>
                {user?.role === "admin" && <button className={`text-xs px-2 py-1 rounded ${selectedGroupId === g.id ? "hover:bg-white/20" : "hover:bg-red-50 text-slate-500 hover:text-red-500"}`} onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}>Delete</button>}
              </div>
            ))}
          </div>
          {selectedGroupId && (
            <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
                Customer Users: {(Array.isArray(groups) && groups.find((g) => Number(g.id) === Number(selectedGroupId))?.name) || selectedGroupId}
              </div>
              <div className="flex gap-2 mb-2">
                <select
                  className="input-premium py-1.5 text-[11px] font-semibold flex-1"
                  value={groupAddUserId}
                  onChange={(e) => setGroupAddUserId(e.target.value)}
                >
                  <option value="">Select user…</option>
                  {uniqueUsers
                    .filter((u) => !uniqueGroupMembers.some((m) => String(m.id) === String(u.id)))
                    .map((u) => (
                      <option key={String(u.id)} value={u.id}>
                        {u.email} ({u.auth_provider === "google" ? "Google" : "Local"})
                      </option>
                    ))}
                </select>
                <button className="btn-premium bg-slate-800 text-white px-2.5 py-1.5 text-[11px] font-semibold" onClick={addUserToGroup}>Add</button>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-auto pr-1 custom-scrollbar">
                {uniqueGroupMembers.map((m) => {
                  const full = uniqueUsers.find((u) => Number(u.id) === Number(m.id)) || m;
                  return (
                    <div
                      key={String(m.id)}
                      className={`flex items-center justify-between p-1.5 rounded-md border cursor-pointer ${Number(selectedUserId) === Number(m.id) ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}
                      onClick={() => setSelectedUserId((prev) => (Number(prev) === Number(m.id) ? null : Number(m.id)))}
                    >
                    <div className="flex items-center gap-2 min-w-0 flex-1 pr-3">
                        <span className="text-[11px] font-semibold text-slate-700 truncate">{displayNameForUser(full)}</span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${authBadgeClass(m.auth_provider)}`}>
                          {m.auth_provider === "google" ? "Google" : "Local"}
                        </span>
                        {m.is_admin && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-700 bg-emerald-50">Admin</span>}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          className="gm-action-btn h-[14px] min-w-[28px] px-1 leading-none text-[5px] font-semibold rounded-sm border border-slate-300 text-slate-600 hover:bg-slate-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            beginEditUser(full);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="gm-action-btn h-[14px] min-w-[30px] px-1 leading-none text-[5px] font-semibold rounded-sm border border-amber-200 text-amber-700 hover:bg-amber-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPasswordResetModal(m.id, displayNameForUser(full));
                          }}
                        >
                          Reset
                        </button>
                        {canManageGroupAdmins && (
                          <button
                            className="gm-action-btn h-[14px] min-w-[34px] px-1 leading-none text-[5px] font-semibold rounded-sm border border-slate-300 text-slate-600 hover:bg-slate-100"
                            onClick={(e) => { e.stopPropagation(); toggleGroupAdmin(m.id, m.is_admin); }}
                          >
                            {m.is_admin ? "Unadmin" : "Admin"}
                          </button>
                        )}
                        <button
                          className="gm-action-btn h-[14px] min-w-[30px] px-1 leading-none text-[5px] font-semibold rounded-sm border border-red-200 text-red-600 hover:bg-red-50"
                          onClick={(e) => { e.stopPropagation(); removeUserFromGroup(m.id); }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!uniqueGroupMembers.length && <div className="text-[10px] text-slate-400 italic">No users in this customer.</div>}
              </div>
              {editingUserId && (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Edit Selected User</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="First name" value={editingUserForm.firstName} onChange={(e) => setEditingUserForm((p) => ({ ...p, firstName: e.target.value }))} />
                    <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Last name" value={editingUserForm.lastName} onChange={(e) => setEditingUserForm((p) => ({ ...p, lastName: e.target.value }))} />
                  </div>
                  <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Company" value={editingUserForm.company} onChange={(e) => setEditingUserForm((p) => ({ ...p, company: e.target.value }))} />
                  <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Email" value={editingUserForm.email} onChange={(e) => setEditingUserForm((p) => ({ ...p, email: e.target.value }))} />
                  <div className="flex justify-end gap-2">
                    <button className="px-2.5 py-1 text-[10px] font-semibold rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100" onClick={cancelEditUser}>Cancel</button>
                    <button className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800" onClick={() => saveEditUser(editingUserId)}>Save</button>
                  </div>
                </div>
              )}
              {user?.role === "admin" && (
                <div className="mt-3 grid grid-cols-2 gap-2 items-center">
                  <label className="text-[10px] font-semibold text-slate-500">Per File Limit (MB)</label>
                  <input
                    type="number"
                    className="input-premium py-1.5"
                    defaultValue={(Array.isArray(groups) && groups.find((g) => Number(g.id) === Number(selectedGroupId))?.max_file_size_mb) || 100}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!Number.isNaN(val)) {
                        const g = Array.isArray(groups) && groups.find((x) => Number(x.id) === Number(selectedGroupId));
                        updateGroup(selectedGroupId, { maxFileSizeMb: val, maxTotalStorageMb: g?.max_total_storage_mb || 10240 });
                      }
                    }}
                  />
                  <label className="text-[10px] font-semibold text-slate-500">Total Storage (MB)</label>
                  <input
                    type="number"
                    className="input-premium py-1.5"
                    defaultValue={(Array.isArray(groups) && groups.find((g) => Number(g.id) === Number(selectedGroupId))?.max_total_storage_mb) || 10240}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!Number.isNaN(val)) {
                        const g = Array.isArray(groups) && groups.find((x) => Number(x.id) === Number(selectedGroupId));
                        updateGroup(selectedGroupId, { maxFileSizeMb: g?.max_file_size_mb || 100, maxTotalStorageMb: val });
                      }
                    }}
                  />
                  <label className="text-[10px] font-semibold text-slate-500">Max Users</label>
                  <input
                    key={`max-users-${selectedGroupId}-${selectedGroupEntitlements.maxUsers || ""}`}
                    type="number"
                    className="input-premium py-1.5"
                    defaultValue={selectedGroupEntitlements.maxUsers || ""}
                    placeholder="Unlimited"
                    onBlur={(e) => updateSelectedGroupEntitlements({ maxUsers: e.target.value ? Number(e.target.value) : null })}
                  />
                  <label className="text-[10px] font-semibold text-slate-500">Max Sources</label>
                  <input
                    key={`max-sources-${selectedGroupId}-${selectedGroupEntitlements.maxReportSources || ""}`}
                    type="number"
                    className="input-premium py-1.5"
                    defaultValue={selectedGroupEntitlements.maxReportSources || ""}
                    placeholder="Unlimited"
                    onBlur={(e) => updateSelectedGroupEntitlements({ maxReportSources: e.target.value ? Number(e.target.value) : null })}
                  />
                  <label className="text-[10px] font-semibold text-slate-500">AI Queries / Month</label>
                  <input
                    key={`max-ai-queries-${selectedGroupId}-${selectedGroupEntitlements.maxAiQueriesPerMonth || ""}`}
                    type="number"
                    className="input-premium py-1.5"
                    defaultValue={selectedGroupEntitlements.maxAiQueriesPerMonth || ""}
                    placeholder="Unlimited"
                    onBlur={(e) => updateSelectedGroupEntitlements({ maxAiQueriesPerMonth: e.target.value ? Number(e.target.value) : null })}
                  />
                  <label className="text-[10px] font-semibold text-slate-500">AI Budget / Month ($)</label>
                  <input
                    key={`ai-budget-${selectedGroupId}-${selectedGroupEntitlements.aiMonthlyBudgetUsd || ""}`}
                    type="number"
                    step="0.01"
                    className="input-premium py-1.5"
                    defaultValue={selectedGroupEntitlements.aiMonthlyBudgetUsd || ""}
                    placeholder="Unlimited"
                    onBlur={(e) => updateSelectedGroupEntitlements({ aiMonthlyBudgetUsd: e.target.value ? Number(e.target.value) : null })}
                  />
                  <div className="col-span-2 rounded-md border border-sky-100 bg-sky-50 px-2 py-1.5 text-[10px] leading-snug text-sky-800">
                    OpenAI estimate with gpt-4.1-mini: about $0.40 / 1M input tokens and $1.60 / 1M output tokens. A typical compact spreadsheet question is usually well below one cent.
                  </div>
                  <div className="col-span-2 mt-2 rounded-md border border-slate-200 bg-white p-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Customer Features</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        ["manageUsers", "Manage users"],
                        ["managePermissions", "Permissions"],
                        ["manageFolders", "Folders"],
                        ["manageGroupAdmins", "Promote admins"],
                        ["ai", "AI"],
                        ["exports", "Exports"],
                        ["imports", "Imports"],
                        ["approvalFlow", "Approvals"],
                        ["auditLogs", "Audit logs"],
                        ["googleDrive", "Google Drive"],
                        ["dropbox", "Dropbox"],
                        ["oneDrive", "OneDrive"],
                      ].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600">
                          <input
                            type="checkbox"
                            checked={selectedGroupEntitlements.features?.[key] !== false}
                            onChange={(e) => updateSelectedGroupEntitlements({ features: { [key]: e.target.checked } })}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        </>
        )}

      </section>

      {/* 2. CUSTOMERS PANEL */}
      <div className="hidden xl:col-span-3 rounded-md border border-slate-300 bg-white p-5 md:p-6 h-full flex flex-col shadow-sm">
        <div className="flex items-center justify-between mb-6 border-b border-slate-200 pb-4">
          <h3 className="font-semibold text-lg text-slate-900 flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-[10px] font-bold text-white">02</span>
            Customers
          </h3>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{groups.length} total</span>
        </div>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-4">Customer User Management</div>

        {selectedGroupId && (
          <div className="mb-6 bg-slate-50 p-4 rounded-md border border-slate-200 animate-in fade-in zoom-in duration-300">
            <h4 className="font-bold text-xs text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>Customer Settings</h4>

            {user?.role === "admin" && (
              <div className="mb-6 space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Max File Size (MB)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="input-premium py-2 w-24"
                    key={selectedGroupId}
                    defaultValue={groups.find(g => g.id === selectedGroupId)?.max_file_size_mb || 100}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        if (window.confirm(`Update limit to ${val}MB?`)) {
                          updateGroup(selectedGroupId, { maxFileSizeMb: val });
                        }
                      }
                    }}
                  />
                  <span className="text-xs text-slate-400 self-center font-bold">MB</span>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Manage Members</label>
              <div className="flex gap-2">
                <select
                  className="input-premium py-2 flex-1"
                  value={groupAddUserId}
                  onChange={e => setGroupAddUserId(e.target.value)}
                >
                  <option value="">Select user…</option>
                  {uniqueUsers
                    .filter(u => !uniqueGroupMembers.some(m => String(m.id) === String(u.id)))
                    .map(u => (
                      <option key={String(u.id)} value={u.id}>
                        {u.email} ({u.auth_provider === "google" ? "Google" : "Local"})
                      </option>
                    ))
                  }
                </select>
                <button
                  className="btn-premium bg-slate-800 text-white px-4 py-2"
                  onClick={addUserToGroup}
                >
                  Add
                </button>
              </div>

              <div className="space-y-2 max-h-32 overflow-auto pr-1 custom-scrollbar">
                {uniqueGroupMembers.map(m => (
                  <div key={String(m.id)} className="group flex items-center justify-between p-3 rounded-md bg-white border border-slate-200 hover:bg-white transition-all">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div className="text-xs font-bold text-slate-700 truncate max-w-[120px]">{m.email}</div>
                      <div className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${authBadgeClass(m.auth_provider)}`}>
                        {m.auth_provider === "google" ? "Google" : "Manual"}
                      </div>
                      {m.is_admin && (
                        <div className="text-[8px] font-black text-amber-500 uppercase tracking-widest bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100">Admin</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {canManageGroupAdmins && (
                        <button
                          onClick={() => toggleGroupAdmin(m.id, m.is_admin)}
                          className={`p-1.5 rounded-lg transition-all ${
                            m.is_admin
                              ? "text-amber-500 hover:bg-amber-50"
                              : "text-slate-300 hover:text-amber-500 hover:bg-indigo-50"
                          }`}
                          title={m.is_admin ? "Remove Customer Admin" : "Make Customer Admin"}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill={m.is_admin ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        </button>
                      )}
                      <button
                        className="p-1.5 text-slate-300 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                        onClick={() => openPasswordResetModal(m.id, m.email || "this user")}
                        title="Reset password"
                      >
                        Reset
                      </button>
                      <button
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        onClick={() => removeUserFromGroup(m.id)}
                        title="Remove from customer"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                    </div>
                  </div>
                ))}
                {!uniqueGroupMembers.length && <div className="text-[10px] text-slate-400 italic text-center p-2">No members yet</div>}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 mb-8 bg-slate-50 p-4 rounded-md border border-slate-200">
          <input
            className="input-premium flex-1"
            placeholder="New customer name"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
          />
          <button
            className="btn-premium bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 shadow-sm"
            onClick={createGroup}
          >
            Create
          </button>
        </div>

        <div className="space-y-3 overflow-auto pr-2 custom-scrollbar flex-1 mb-6">
          {groups.map(g => (
            <div
              key={g.id}
              className={`group flex items-center justify-between p-4 rounded-md border transition-all cursor-pointer ${
                selectedGroupId === g.id
                  ? "bg-emerald-600 border-emerald-600 text-white shadow-sm translate-x-1"
                  : "bg-white border-slate-200 hover:border-emerald-300 hover:bg-slate-50"
              }`}
              onClick={() => setSelectedGroupId((prev) => (prev === g.id ? null : g.id))}
            >
              <div className="min-w-0">
                <div className={`font-bold text-sm truncate max-w-[140px] ${selectedGroupId === g.id ? "text-white" : "text-slate-900"}`}>{g.name}</div>
                <div className="flex gap-2 items-center mt-0.5">
                  <div className={`text-[10px] uppercase tracking-widest font-bold ${selectedGroupId === g.id ? "text-emerald-100" : "text-slate-400"}`}>ID: {g.id}</div>
                  <div className={`text-[10px] uppercase tracking-widest font-bold border-l pl-2 ${selectedGroupId === g.id ? "border-white/20 text-emerald-100" : "border-slate-100 text-emerald-400"}`}>Limit: {g.max_file_size_mb || 100}MB</div>
                </div>
              </div>
              {user?.role === "admin" && (
                <button
                  className={`p-2 rounded-lg transition-colors opacity-0 group-hover:opacity-100 ${
                    selectedGroupId === g.id ? "hover:bg-white/20 text-white" : "hover:bg-red-50 text-slate-400 hover:text-red-500"
                  }`}
                  title="Delete customer"
                  onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}
                >🗑️</button>
              )}
            </div>
          ))}
        </div>

      </div>

      {/* 3. FOLDERS PANEL */}
      <section className="lg:col-span-7 flex flex-col">
        <div className="flex items-center justify-between mb-4 border-b border-slate-300 pb-2">
          <h3 className="font-semibold text-base text-slate-900">Folders</h3>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{folders.length} total</span>
            <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" onClick={() => toggleSection("folders")}>
              {collapsedSections.folders ? "Expand" : "Collapse"}
            </button>
          </div>
        </div>
        {!collapsedSections.folders && (
        <>
        {user?.role === "admin" && (
          <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cloud Storage</div>
            <button type="button" onClick={toggleGoogleIntegration} disabled={googleIntegrationSaving} className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-xs font-bold uppercase tracking-wider transition-colors ${googleIntegrationEnabled ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-slate-100 border-slate-200 text-slate-600"} ${googleIntegrationSaving ? "opacity-60 cursor-not-allowed" : ""}`} title="Enable or disable Google SSO integration"><span className="inline-flex items-center gap-2"><img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Google Drive" className="h-3.5 w-3.5" /><span>Google Sign-In</span></span><span>{googleIntegrationEnabled ? "Enabled" : "Disabled"}</span></button>
            {googleIntegrationEnabled && (
              <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Google OAuth Configuration</div>
                <input type="password" className="input-premium" placeholder={googleOauthMeta.hasClientId ? "***" : "Google Client ID"} value={googleOauthForm.clientId} onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, clientId: e.target.value }))} autoComplete="new-password" />
                <input type="password" className="input-premium" placeholder={googleOauthMeta.hasClientSecret ? "***" : "Google Client Secret"} value={googleOauthForm.clientSecret} onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, clientSecret: e.target.value }))} autoComplete="new-password" />
                <input className="input-premium" placeholder="Redirect URI" value={googleOauthForm.redirectUri} onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, redirectUri: e.target.value }))} />
                <input className="input-premium" placeholder="Frontend URL" value={googleOauthForm.frontendUrl} onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, frontendUrl: e.target.value }))} />
                <button type="button" onClick={saveGoogleOauthSetting} disabled={googleOauthSaving} className={`btn-premium bg-slate-800 text-white w-full py-2 ${googleOauthSaving ? "opacity-60 cursor-not-allowed" : ""}`}>{googleOauthSaving ? "Saving..." : "Save Google OAuth"}</button>
              </div>
            )}
            <button type="button" onClick={toggleDropboxIntegration} disabled={dropboxIntegrationSaving} className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-xs font-bold uppercase tracking-wider transition-colors ${dropboxIntegrationEnabled ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-slate-100 border-slate-200 text-slate-600"} ${dropboxIntegrationSaving ? "opacity-60 cursor-not-allowed" : ""}`} title="Enable or disable Dropbox integration"><span className="inline-flex items-center gap-2"><img src="https://upload.wikimedia.org/wikipedia/commons/7/78/Dropbox_Icon.svg" alt="Dropbox" className="h-3.5 w-3.5" /><span>Dropbox Integration</span></span><span>{dropboxIntegrationEnabled ? "Enabled" : "Disabled"}</span></button>
            {dropboxIntegrationEnabled && (
              <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Dropbox OAuth Configuration</div>
                <input type="password" className="input-premium" placeholder={dropboxOauthMeta.hasClientId ? "***" : "Dropbox App Key (Client ID)"} value={dropboxOauthForm.clientId} onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, clientId: e.target.value }))} autoComplete="new-password" />
                <input type="password" className="input-premium" placeholder={dropboxOauthMeta.hasClientSecret ? "***" : "Dropbox App Secret (Client Secret)"} value={dropboxOauthForm.clientSecret} onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, clientSecret: e.target.value }))} autoComplete="new-password" />
                <input className="input-premium" placeholder="Redirect URI" value={dropboxOauthForm.redirectUri} onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, redirectUri: e.target.value }))} />
                <input className="input-premium" placeholder="Frontend URL" value={dropboxOauthForm.frontendUrl} onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, frontendUrl: e.target.value }))} />
                <button type="button" onClick={saveDropboxOauthSetting} disabled={dropboxOauthSaving} className={`btn-premium bg-slate-800 text-white w-full py-2 ${dropboxOauthSaving ? "opacity-60 cursor-not-allowed" : ""}`}>{dropboxOauthSaving ? "Saving..." : "Save Dropbox OAuth"}</button>
              </div>
            )}
            <button type="button" onClick={toggleOneDriveIntegration} disabled={oneDriveIntegrationSaving} className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-xs font-bold uppercase tracking-wider transition-colors ${oneDriveIntegrationEnabled ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-slate-100 border-slate-200 text-slate-600"} ${oneDriveIntegrationSaving ? "opacity-60 cursor-not-allowed" : ""}`} title="Enable or disable OneDrive integration"><span className="inline-flex items-center gap-2"><img src="https://upload.wikimedia.org/wikipedia/commons/e/e7/Microsoft_OneDrive_Icon_%282025_-_present%29.svg" alt="OneDrive" className="h-3.5 w-3.5" /><span>OneDrive Integration</span></span><span>{oneDriveIntegrationEnabled ? "Enabled" : "Disabled"}</span></button>
            {oneDriveIntegrationEnabled && (
              <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">OneDrive OAuth Configuration</div>
                <input type="password" className="input-premium" placeholder={oneDriveOauthMeta.hasClientId ? "***" : "Microsoft Application (Client) ID"} value={oneDriveOauthForm.clientId} onChange={(e) => setOneDriveOauthForm((prev) => ({ ...prev, clientId: e.target.value }))} autoComplete="new-password" />
                <input type="password" className="input-premium" placeholder={oneDriveOauthMeta.hasClientSecret ? "***" : "Microsoft Client Secret"} value={oneDriveOauthForm.clientSecret} onChange={(e) => setOneDriveOauthForm((prev) => ({ ...prev, clientSecret: e.target.value }))} autoComplete="new-password" />
                <input className="input-premium" placeholder="Redirect URI" value={oneDriveOauthForm.redirectUri} onChange={(e) => setOneDriveOauthForm((prev) => ({ ...prev, redirectUri: e.target.value }))} />
                <input className="input-premium" placeholder="Frontend URL" value={oneDriveOauthForm.frontendUrl} onChange={(e) => setOneDriveOauthForm((prev) => ({ ...prev, frontendUrl: e.target.value }))} />
                <button type="button" onClick={saveOneDriveOauthSetting} disabled={oneDriveOauthSaving} className={`btn-premium bg-slate-800 text-white w-full py-2 ${oneDriveOauthSaving ? "opacity-60 cursor-not-allowed" : ""}`}>{oneDriveOauthSaving ? "Saving..." : "Save OneDrive OAuth"}</button>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600 space-y-1">
                  <div className="font-semibold text-slate-700">Setup help</div>
                  <a className="block text-blue-700 hover:underline" href="https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app" target="_blank" rel="noreferrer">Register app in Microsoft Entra ID</a>
                  <a className="block text-blue-700 hover:underline" href="https://learn.microsoft.com/en-us/graph/permissions-reference#filesread" target="_blank" rel="noreferrer">Required Microsoft Graph scopes: `Files.Read`, `User.Read`, `offline_access`</a>
                  <a className="block text-blue-700 hover:underline" href="https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow" target="_blank" rel="noreferrer">Authorization code flow guide</a>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 mb-5 bg-white p-3 rounded-md border border-slate-200">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Folders</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              className="input-premium"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
            <select
              className="input-premium"
              value={folderOwnershipType}
              onChange={(e) => setFolderOwnershipType(e.target.value)}
            >
              <option value="group">Customer-owned</option>
              <option value="user">User-owned (via user customer access)</option>
            </select>
            {folderOwnershipType === "group" && (
              <select
                className="input-premium"
                value={folderOwnerGroupId}
                onChange={(e) => setFolderOwnerGroupId(e.target.value)}
              >
                <option value="">Select owner customer…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            {folderOwnershipType === "user" && (
              <select
                className="input-premium"
                value={folderOwnerUserId}
                onChange={(e) => setFolderOwnerUserId(e.target.value)}
              >
                <option value="">Select owner user…</option>
                {uniqueUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.email} ({u.auth_provider === "google" ? "Google" : "Local"})</option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-center">
            <label className="text-[10px] font-semibold text-slate-500">File Limit (MB)</label>
            <input className="input-premium" type="number" min="1" value={folderMaxFileSizeMb} onChange={(e) => setFolderMaxFileSizeMb(e.target.value)} />
            <label className="text-[10px] font-semibold text-slate-500">Total Limit (MB)</label>
            <input className="input-premium" type="number" min="1" value={folderMaxTotalSizeMb} onChange={(e) => setFolderMaxTotalSizeMb(e.target.value)} />
          </div>
          <button
            className="btn-premium bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 shadow-sm self-start"
            onClick={createFolder}
          >
            Create
          </button>
          {visibleFolders.length > 0 && (
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Select Folder</label>
              <select
                className="input-premium"
                value={selectedFolderId}
                onChange={(e) => {
                  setSelectedFolderId(e.target.value);
                  setEditingFolderId(null);
                }}
              >
                <option value="">None</option>
                {visibleFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.path || f.name}
                  </option>
                ))}
              </select>
              {selectedFolder && (
                <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 p-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-800 truncate">{selectedFolder.path || selectedFolder.name}</div>
                    <div className="text-[10px] text-slate-500 whitespace-nowrap">
                      Current Size {formatBytes(selectedFolder.total_size_bytes)} / {Number(selectedFolder.max_total_size_mb || 1024)} MB total · File {Number(selectedFolder.max_file_size_mb || 100)} MB
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      className="px-2 py-1 text-xs rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
                      onClick={() => startEditFolder(selectedFolder)}
                    >
                      Edit
                    </button>
                    <button
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all font-bold"
                      onClick={() => deleteFolder(selectedFolder.id)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {selectedFolder && editingFolderId === selectedFolder.id && (
            <div className="mt-1 rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2 items-center">
                <label className="text-[10px] font-semibold text-slate-500">File Limit (MB)</label>
                <input className="input-premium" type="number" min="1" value={editingFolderMaxFileSizeMb} onChange={(e) => setEditingFolderMaxFileSizeMb(e.target.value)} />
                <label className="text-[10px] font-semibold text-slate-500">Total Limit (MB)</label>
                <input className="input-premium" type="number" min="1" value={editingFolderMaxTotalSizeMb} onChange={(e) => setEditingFolderMaxTotalSizeMb(e.target.value)} />
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Owner Customer</div>
              <select
                className="input-premium"
                value={editingFolderOwnerGroupId}
                onChange={(e) => setEditingFolderOwnerGroupId(e.target.value)}
              >
                <option value="">None</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button className="px-3 py-1.5 text-xs rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100" onClick={cancelEditFolder}>Cancel</button>
                <button className="px-3 py-1.5 text-xs rounded-md bg-slate-900 text-white hover:bg-slate-800" onClick={() => saveEditFolder(selectedFolder.id)}>Save</button>
              </div>
            </div>
          )}
          {!visibleFolders.length && (
            <div className="p-8 text-center bg-white/30 rounded-md border border-dashed border-slate-300">
              <div className="text-3xl mb-2 opacity-30">📂</div>
              <div className="text-xs text-slate-400 font-medium">No folders found</div>
            </div>
          )}
        </div>
        </>
        )}
      {/* 4. OVERRIDES & PERMISSIONS PANEL */}
      {(selectedUserId || selectedGroupId) && (
      <div className="mt-3">
        <details className="rounded-md border border-slate-300 bg-white" open={!collapsedSections.permissions}>
          <summary className="flex items-center justify-between cursor-pointer px-3 py-2 text-sm font-semibold text-slate-800">
            <span>Permissions</span>
            <span className="text-[10px] font-semibold text-slate-500">
              {selectedUserId ? `User: ${userById instanceof Map ? (userById.get(selectedUserId)?.email || selectedUserId) : selectedUserId}` : `Customer: ${(Array.isArray(groups) && groups.find(g => g.id === selectedGroupId)?.name) || selectedGroupId}`}
            </span>
          </summary>
          <div className="px-3 pb-3">

          <div className="flex-1 flex flex-col min-h-0">
            {/* Report Source Selector */}
            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Report Source</label>
              <select
                className="input-premium py-2 w-full mt-2"
                value={selectedReportSourceId || ""}
                onChange={(e) => selectReportSourceForPermissions(e.target.value)}
              >
                <option value="">Select a report source…</option>
                {reportSourceOptions.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name || `Report source ${source.id}`}
                  </option>
                ))}
              </select>
              <div className="text-[10px] text-slate-400 mt-1">
                Access applies to the current import for this report source and is carried forward on refresh.
                {selectedReportSource?.current_sheet_id ? ` Current sheet: ${selectedReportSource.current_sheet_id}` : ""}
              </div>
            </div>

            {selectedUserSheetId ? (
              <div className="flex-1 flex flex-col gap-6 min-h-0 overflow-auto pr-2 custom-scrollbar">
                {selectedUserId && (
                  <>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">User Override</div>
                {/* Column Permissions */}
                <div>
                  <div className="flex items-center justify-between mb-3 border-b border-slate-200/30 pb-2">
                    <h4 className="font-bold text-sm text-slate-700">Restricted Columns</h4>
                    <button
                      className="text-[10px] font-bold text-indigo-500 hover:underline"
                      onClick={() => setUserAllowedCols(new Set())}
                    >Allow All</button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {userSheetHeaders.map((h, i) => (
                      <label key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded-md border transition-all cursor-pointer ${
                        userAllowedCols.has(h) ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-bold" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}>
                        <input
                          type="checkbox"
                          checked={userAllowedCols.has(h)}
                          onChange={() => toggleUserAllowed(h)}
                          className="w-3 h-3 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                        />
                        <span className="text-[10px] truncate">{h}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Templates toolbar */}
                <div className="bg-slate-50 p-4 rounded-md border border-slate-200 space-y-3">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">Template Management</label>
                  <div className="flex gap-2">
                    <input
                      className="input-premium py-1.5 flex-1 bg-white"
                      placeholder="Template name"
                      value={newTplNameUser}
                      onChange={(e) => setNewTplNameUser(e.target.value)}
                    />
                    <button
                      className="btn-premium bg-slate-800 text-white px-3 py-1.5 shadow-sm"
                      onClick={handleSaveTemplateFromUser}
                    >Save</button>
                  </div>
                  <div className="flex gap-2">
                    <select
                      className="input-premium py-1.5 flex-1 bg-white"
                      value={selectedTplUser}
                      onChange={(e) => handleApplyTemplateToUser(e.target.value)}
                    >
                      <option value="">Apply template…</option>
                      {visibleUserTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    {selectedTplUser && (
                      <button
                        className="p-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                        onClick={() => handleDeleteTemplate(selectedTplUser)}
                      >🗑️</button>
                    )}
                  </div>
                </div>

                {/* Row Filters */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-slate-700">Dynamic Row Filters</h4>
                    <button
                      className="bg-indigo-600 text-white rounded-lg px-3 py-1 text-[10px] font-bold shadow-sm"
                      onClick={() => setUserRowFilters([...userRowFilters, { key: "", value: "" }])}
                    >+ Add Rule</button>
                  </div>
                  <div className="space-y-2">
                    {userRowFilters.map((filter, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          className="input-premium py-1.5 flex-1"
                          value={filter.key}
                          onChange={e => {
                            const next = [...userRowFilters];
                            next[idx].key = e.target.value;
                            setUserRowFilters(next);
                          }}
                        >
                          <option value="">Column…</option>
                          {userSheetHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                        <input
                          className="input-premium py-1.5 flex-1"
                          placeholder="Value…"
                          value={filter.value}
                          onChange={e => {
                            const next = [...userRowFilters];
                            next[idx].value = e.target.value;
                            setUserRowFilters(next);
                          }}
                        />
                        <button
                          className="p-2 text-red-400 hover:text-red-600 font-bold"
                          onClick={() => setUserRowFilters(userRowFilters.filter((_, i) => i !== idx))}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Locked Views for User */}
                <div className="space-y-3 pt-4 border-t border-slate-200">
                  <h4 className="font-bold text-sm text-slate-700">Locked Views (Data Restrictions)</h4>
                  <p className="text-[10px] text-slate-500 italic mb-2">Assigning a Locked View will strictly limit this user to the specific columns and row filters defined in that view.</p>
                  <div className="space-y-1.5">
                    {Array.isArray(views) && views.filter(v => String(v.sheet_id) === String(selectedUserSheetId)).map(v => (
                      <label key={v.id} className={`flex items-center justify-between p-2 rounded-md border cursor-pointer ${(userViews instanceof Set && userViews.has(v.id)) ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={userViews instanceof Set && userViews.has(v.id)} onChange={() => toggleUserViewPerm(v.id)} className="w-3.5 h-3.5 rounded text-emerald-600" />
                          <span className="text-[11px] font-semibold text-slate-700">{v.name}</span>
                        </div>
                        <span className="text-[9px] text-slate-400 italic">by {v.created_by}</span>
                      </label>
                    ))}
                    {Array.isArray(views) && !views.filter(v => String(v.sheet_id) === String(selectedUserSheetId)).length && (
                      <div className="text-[10px] text-slate-400 italic">No views created for this sheet yet.</div>
                    )}
                  </div>
                </div>

                <div className="pt-8 border-t border-slate-200/30">
                  <h4 className="font-bold text-sm text-slate-700 mb-4">Default View Selection</h4>

                  <div className="flex gap-2">
                    <select
                      className="input-premium py-2 flex-1"
                      value={userDefaultViewId}
                      onChange={(e) => setUserDefaultViewId(e.target.value)}
                    >
                      <option value="">(None)</option>
                      {Array.isArray(views) && views.filter(v => userViews instanceof Set && userViews.has(v.id)).map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                    <button
                      className="btn-premium bg-slate-800 text-white px-4 py-2 text-xs"
                      onClick={async () => {
                        await axios.put(
                          `${API}/users/${selectedUserId}/default-view`,
                          { viewId: userDefaultViewId || null },
                          { headers: { Authorization: `Bearer ${token}` } }
                        );
                        alert("Default view saved");
                      }}
                    >
                      Set Default
                    </button>
                  </div>
                </div>

                <button
                  className="btn-premium bg-indigo-600 hover:bg-indigo-700 text-white w-full py-4 shadow-sm mt-4 mb-4 shrink-0"
                  onClick={saveUserPermissions}
                >
                  Confirm & Apply Permissions
                </button>
                  </>
                )}

                {selectedGroupId && (
                <div className="pt-6 border-t border-slate-200/40 space-y-4">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Customer Override (Same Report Source)</div>

                    <>
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-sm text-slate-700">Customer Column Permissions</h4>
                        <button
                          className="text-[10px] font-bold text-emerald-600 hover:underline"
                          onClick={() => setGroupAllowedCols(new Set())}
                        >
                          Allow All
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {groupSheetHeaders.map((h) => (
                          <label key={h} className={`flex items-center gap-2 px-2 py-1.5 rounded-md border transition-all cursor-pointer ${
                            groupAllowedCols.has(h) ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-bold" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                          }`}>
                            <input
                              type="checkbox"
                              checked={groupAllowedCols.has(h)}
                              onChange={() => toggleGroupAllowed(h)}
                              className="w-3 h-3 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                            />
                            <span className="text-[10px] truncate">{h}</span>
                          </label>
                        ))}
                      </div>

                      <div className="bg-slate-50 p-4 rounded-md border border-slate-200 space-y-3">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block">Template Management</label>
                        <div className="flex gap-2">
                          <input
                            className="input-premium py-1.5 flex-1 bg-white"
                            placeholder="Template name"
                            value={newTplNameGroup}
                            onChange={(e) => setNewTplNameGroup(e.target.value)}
                          />
                          <button
                            className="btn-premium bg-slate-800 text-white px-3 py-1.5 shadow-sm"
                            onClick={handleSaveTemplateFromGroup}
                          >
                            Save
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <select
                            className="input-premium py-1.5 flex-1 bg-white"
                            value={selectedTplGroup}
                            onChange={(e) => handleApplyTemplateToGroup(e.target.value)}
                          >
                            <option value="">Apply template…</option>
                            {visibleGroupTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                          {selectedTplGroup && (
                            <button
                              className="p-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                              onClick={() => handleDeleteTemplate(selectedTplGroup)}
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm text-slate-700">Customer Row Filters</h4>
                          <button
                            className="bg-emerald-600 text-white rounded-lg px-3 py-1 text-[10px] font-bold"
                            onClick={() => setGroupRowFilters([...groupRowFilters, { key: "", value: "" }])}
                          >
                            + Add Rule
                          </button>
                        </div>
                        <div className="space-y-2">
                          {groupRowFilters.map((filter, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <select
                                className="input-premium py-1.5 flex-1"
                                value={filter.key}
                                onChange={(e) => {
                                  const next = [...groupRowFilters];
                                  next[idx].key = e.target.value;
                                  setGroupRowFilters(next);
                                }}
                              >
                                <option value="">Column…</option>
                                {groupSheetHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                              </select>
                              <input
                                className="input-premium py-1.5 flex-1"
                                placeholder="Value…"
                                value={filter.value}
                                onChange={(e) => {
                                  const next = [...groupRowFilters];
                                  next[idx].value = e.target.value;
                                  setGroupRowFilters(next);
                                }}
                              />
                              <button
                                className="p-2 text-red-400 hover:text-red-600 font-bold"
                                onClick={() => setGroupRowFilters(groupRowFilters.filter((_, i) => i !== idx))}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Locked Views for Customer */}
                      <div className="space-y-3 pt-4 border-t border-slate-200">
                        <h4 className="font-bold text-sm text-slate-700">Locked Views (Data Restrictions)</h4>
                        <p className="text-[10px] text-slate-500 italic mb-2">Assigning a Locked View will strictly limit all users of this customer to the specific columns and row filters defined in that view.</p>
                        <div className="space-y-1.5">
                          {Array.isArray(views) && views.filter(v => String(v.sheet_id) === String(selectedUserSheetId)).map(v => (
                            <label key={v.id} className={`flex items-center justify-between p-2 rounded-md border cursor-pointer ${(groupViews instanceof Set && groupViews.has(v.id)) ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
                              <div className="flex items-center gap-2">
                                <input type="checkbox" checked={groupViews instanceof Set && groupViews.has(v.id)} onChange={() => toggleGroupViewPerm(v.id)} className="w-3.5 h-3.5 rounded text-emerald-600" />
                                <span className="text-[11px] font-semibold text-slate-700">{v.name}</span>
                              </div>
                              <span className="text-[9px] text-slate-400 italic">by {v.created_by}</span>
                            </label>
                          ))}
                          {Array.isArray(views) && !views.filter(v => String(v.sheet_id) === String(selectedUserSheetId)).length && (
                            <div className="text-[10px] text-slate-400 italic">No views created for this sheet yet.</div>
                          )}
                        </div>
                      </div>

                      <button
                        className="btn-premium bg-emerald-600 hover:bg-emerald-700 text-white w-full py-3 mt-4"
                        onClick={saveGroupPermissions}
                      >Save Customer Permissions</button>

                    </>
                </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-white/30 rounded-lg border border-dashed border-slate-300">
                <div className="text-center p-8">
                  <div className="text-4xl mb-4 opacity-20">🎯</div>
                  <div className="text-slate-400 font-medium max-w-[260px] mx-auto">Select a report source to configure user/customer override permissions.</div>
                </div>
              </div>
            )}
          </div>
          </div>
        </details>
      </div>
      )}
      </section>

      </div>
      {passwordResetModal.open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-900">Reset Password</h3>
              <p className="mt-1 text-xs text-slate-500">
                Set a new temporary password for {passwordResetModal.label || "this user"}. The user must change it after login.
              </p>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">New Password</span>
                <input
                  className="input-premium w-full"
                  type="password"
                  autoComplete="new-password"
                  value={passwordResetModal.password}
                  onChange={(e) => setPasswordResetModal((prev) => ({ ...prev, password: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Repeat Password</span>
                <input
                  className="input-premium w-full"
                  type="password"
                  autoComplete="new-password"
                  value={passwordResetModal.repeat}
                  onChange={(e) => setPasswordResetModal((prev) => ({ ...prev, repeat: e.target.value }))}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  type="button"
                  onClick={fillGeneratedResetPassword}
                >
                  Generate 16-character password
                </button>
                <button
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  type="button"
                  onClick={copyResetPassword}
                >
                  Copy password
                </button>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                type="button"
                onClick={closePasswordResetModal}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                type="button"
                onClick={submitPasswordReset}
              >
                Reset Password
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
