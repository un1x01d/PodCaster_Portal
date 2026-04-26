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

export default function UserManagement({ token, user, sheetId }) {
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + "..." : s);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "user" });
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

  // user-level permissions UI (select a sheet from user's groups)
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userSheets, setUserSheets] = useState([]);                // latest 10 for selected user
  const [selectedUserSheetId, setSelectedUserSheetId] = useState(null);
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

  // group permissions (per-sheet)
  const [groupAllowedCols, setGroupAllowedCols] = useState(new Set());
  const [groupRowFilters, setGroupRowFilters] = useState([{ key: "", value: "" }]);

  // group sheet selection (shared with selectedUserSheetId in Overrides panel)
  const [allSheets, setAllSheets] = useState([]); // all sheets (active or inactive) for selection
  const [groupSheetHeaders, setGroupSheetHeaders] = useState([]);

  // Templates (now scoped by group)
  const [templates, setTemplates] = useState(loadTemplates());
  // ...

  // Folders
  const [folders, setFolders] = useState([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderGroupIds, setFolderGroupIds] = useState([]);

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
      await axios.post(`${API}/folders`, {
        name: newFolderName,
        groupIds: folderGroupIds.map((id) => Number(id))
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNewFolderName("");
      setFolderGroupIds([]);
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

  const fetchAllSheets = async () => {
    try {
      const res = await axios.get(`${API}/sheets/all`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAllSheets(res.data || []);
    } catch (e) {
      console.error("fetchAllSheets failed", e);
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

  const loadUserPermissions = async (uid, sid) => {
    if (!uid || !sid) {
      setUserAllowedCols(new Set());
      setUserRowFilters([{ key: "", value: "" }]);
      return;
    }
    const res = await axios.get(`${API}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { userId: uid, sheetId: sid }
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
  const loadGroupPermissions = async (gid, sid) => {
    if (!gid || !sid) {
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      return;
    }
    const res = await axios.get(`${API}/group-permissions`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { groupId: gid, sheetId: sid }
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
      fetchAllSheets(); // load on mount
      fetchGoogleIntegrationSetting();
      fetchGoogleOauthSetting();
      fetchDropboxIntegrationSetting();
      fetchDropboxOauthSetting();
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

  const fetchGroupViews = async (groupId) => {
    if (!groupId) return;
    const res = await axios.get(`${API}/views/group-permissions/${groupId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setGroupViews(new Set((res.data || []).map((v) => v.id)));
  };

  // when user changes, reload their 10 sheets and reset user-perms state
  useEffect(() => {
    if (selectedUserId) {
      fetchUserSheets(selectedUserId);
      fetchUserViews(selectedUserId);
      setSelectedUserSheetId(null);
      setUserSheetHeaders([]);
      setUserAllowedCols(new Set());
      setUserRowFilters([{ key: "", value: "" }]);
      setSelectedTplUser("");
    }
  }, [selectedUserId]);

  // when user sheet changes, load headers and that user's perms for that sheet
  useEffect(() => {
    if (selectedUserSheetId && selectedUserId) {
      fetchUserSheetHeaders(selectedUserSheetId);
      loadUserPermissions(selectedUserId, selectedUserSheetId);
    } else {
      setUserSheetHeaders([]);
      setUserAllowedCols(new Set());
      setUserRowFilters([{ key: "", value: "" }]);
    }
  }, [selectedUserSheetId, selectedUserId]);

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

  // group overrides use the SAME selected sheet as user overrides
  useEffect(() => {
    if (!selectedUserSheetId || !selectedGroupId) {
      setGroupSheetHeaders([]);
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      return;
    }
    fetchGroupSheetHeaders(selectedUserSheetId);
    loadGroupPermissions(selectedGroupId, selectedUserSheetId);
  }, [selectedUserSheetId, selectedGroupId]);

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
    if (!newUser.email || !newUser.password) return;
    try {
      await axios.post(`${API}/users`, newUser, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNewUser({ email: "", password: "", role: "user" });
      fetchUsers();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to create user");
    }
  };

  const resetPassword = async (id) => {
    try {
      const res = await axios.patch(`${API}/users/${id}`, { reset: true }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert(`Temp password: ${res.data?.newPassword || "(see server log)"}`);
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

  const saveUserPermissions = async () => {
    if (!selectedUserId || !selectedUserSheetId) {
      alert("Pick a user and a sheet first.");
      return;
    }
    const allowed_columns = Array.from(userAllowedCols);
    const row_filters = {};
    userRowFilters.forEach(f => {
      if (f.key && f.value) row_filters[f.key] = f.value;
    });
    try {
      await axios.post(`${API}/permissions`, {
        sheetId: selectedUserSheetId,
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
      alert(e.response?.data?.error || "Failed to create group");
    }
  };

  const updateGroup = async (gid, data) => {
    try {
      await axios.patch(`${API}/groups/${gid}`, data, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchGroups();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update group");
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
      alert(e.response?.data?.error || "Failed to add user to group");
    }
  };

  const removeUserFromGroup = async (uid) => {
    if (!selectedGroupId) return;
    try {
      await axios.delete(`${API}/groups/${selectedGroupId}/users/${uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchGroupMembers(selectedGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to remove user from group");
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
      alert(e.response?.data?.error || "Failed to toggle group admin");
    }
  };

  const saveGroupPermissions = async () => {
    if (!selectedGroupId || !selectedUserSheetId) {
      alert("Pick a group and a sheet first.");
      return;
    }
    const allowed_columns = Array.from(groupAllowedCols);
    // Convert filter array to object, filtering out empty entries
    const row_filters = {};
    groupRowFilters.forEach(f => {
      if (f.key && f.value) row_filters[f.key] = f.value;
    });
    await axios.post(`${API}/group-permissions`, {
      sheetId: selectedUserSheetId,
      groupId: selectedGroupId,
      allowed: allowed_columns,
      rowFilters: row_filters,
      allowed_columns,
      row_filters
    }, { headers: { Authorization: `Bearer ${token}` } });
    alert("Group permissions saved");
  };

  // NEW: delete group (with confirm) from Groups panel
  const deleteGroup = async (gid) => {
    if (!gid) return;
    if (!confirm("Delete this group and its memberships/permissions?")) return;
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
      console.error("delete group failed", e);
      alert(e.response?.data?.message || e.response?.data?.error || "❌ Could not delete group");
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
    if (!currentUserSheetGroupId) { alert("Select a sheet (with group) first"); return; }
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
    if (!selectedGroupId) { alert("Select a group first"); return; }
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

  const userById = useMemo(() => {
    const m = new Map();
    users.forEach(u => m.set(u.id, u));
    return m;
  }, [users]);

  const overrideSheetOptions = useMemo(() => {
    const source = (allSheets && allSheets.length > 0) ? allSheets : userSheets;
    const seen = new Set();
    return source.filter((s) => {
      const sid = String(s.id);
      if (seen.has(sid)) return false;
      seen.add(sid);
      return true;
    });
  }, [allSheets, userSheets]);



  // Deduplicate group members to prevent key warnings if backend returns duplicates (handling string vs number)
  const uniqueGroupMembers = useMemo(() => {
    const seen = new Set();
    return groupMembers.filter(m => {
      const sid = String(m.id);
      if (seen.has(sid)) return false;
      seen.add(sid);
      return true;
    });
  }, [groupMembers]);

  // Deduplicate users (handling string vs number)
  const uniqueUsers = useMemo(() => {
    const seen = new Set();
    return users.filter(u => {
      const sid = String(u.id);
      if (seen.has(sid)) return false;
      seen.add(sid);
      return true;
    });
  }, [users]);

  const authBadgeClass = (provider) => (
    provider === "google"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-slate-50 text-slate-600 border-slate-200"
  );

  const canManageGroupAdmins = useMemo(() => {
    if (user?.role === "admin") return true;
    return uniqueGroupMembers.some((m) => Number(m.id) === Number(user?.id) && !!m.is_admin);
  }, [user, uniqueGroupMembers]);

  return (
    <div className="p-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8 justify-center bg-gradient-to-b from-slate-100 to-blue-50/60 min-h-full overflow-auto">
      {/* 1. USERS PANEL */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 md:p-7 h-full flex flex-col shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between mb-8 border-b border-slate-200/50 pb-6">
          <h3 className="font-extrabold text-2xl text-slate-900 flex items-center gap-3">
            <span className="bg-indigo-600 text-white w-10 h-10 rounded-md flex items-center justify-center text-xl shadow-sm">👥</span>
            Users
          </h3>
          <span className="bg-white/60 text-indigo-600 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-indigo-100">{users.length} Total</span>
        </div>

        {/* Quick Add User */}
        <div className="flex flex-col gap-4 mb-8 bg-slate-50 p-4 rounded-md border border-slate-200">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">Quick Add User</label>
          {user?.role === "admin" && (
            <>
              <button
                type="button"
                onClick={toggleGoogleIntegration}
                disabled={googleIntegrationSaving}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-xs font-bold uppercase tracking-wider transition-colors ${
                  googleIntegrationEnabled
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-slate-100 border-slate-200 text-slate-600"
                } ${googleIntegrationSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                title="Enable or disable Google SSO integration"
              >
                <span>Google Sign-In</span>
                <span>{googleIntegrationEnabled ? "Enabled" : "Disabled"}</span>
              </button>
              <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Google OAuth Config</div>
                <input
                  type="password"
                  className="input-premium"
                  placeholder={googleOauthMeta.hasClientId ? "***" : "Google Client ID"}
                  value={googleOauthForm.clientId}
                  onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, clientId: e.target.value }))}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  className="input-premium"
                  placeholder={googleOauthMeta.hasClientSecret ? "***" : "Google Client Secret"}
                  value={googleOauthForm.clientSecret}
                  onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, clientSecret: e.target.value }))}
                  autoComplete="new-password"
                />
                <input
                  className="input-premium"
                  placeholder="Redirect URI"
                  value={googleOauthForm.redirectUri}
                  onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, redirectUri: e.target.value }))}
                />
                <input
                  className="input-premium"
                  placeholder="Frontend URL"
                  value={googleOauthForm.frontendUrl}
                  onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, frontendUrl: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={saveGoogleOauthSetting}
                  disabled={googleOauthSaving}
                  className={`btn-premium bg-slate-800 text-white w-full py-2 ${googleOauthSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {googleOauthSaving ? "Saving..." : "Save Google OAuth"}
                </button>
                <div className="text-[10px] text-slate-400">Client ID/Secret are masked and never returned in plain text.</div>
              </div>
              <button
                type="button"
                onClick={toggleDropboxIntegration}
                disabled={dropboxIntegrationSaving}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-xs font-bold uppercase tracking-wider transition-colors ${
                  dropboxIntegrationEnabled
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-slate-100 border-slate-200 text-slate-600"
                } ${dropboxIntegrationSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                title="Enable or disable Dropbox integration"
              >
                <span>Dropbox Integration</span>
                <span>{dropboxIntegrationEnabled ? "Enabled" : "Disabled"}</span>
              </button>
              <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dropbox OAuth Config</div>
                <input
                  type="password"
                  className="input-premium"
                  placeholder={dropboxOauthMeta.hasClientId ? "***" : "Dropbox App Key (Client ID)"}
                  value={dropboxOauthForm.clientId}
                  onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, clientId: e.target.value }))}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  className="input-premium"
                  placeholder={dropboxOauthMeta.hasClientSecret ? "***" : "Dropbox App Secret (Client Secret)"}
                  value={dropboxOauthForm.clientSecret}
                  onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, clientSecret: e.target.value }))}
                  autoComplete="new-password"
                />
                <input
                  className="input-premium"
                  placeholder="Redirect URI"
                  value={dropboxOauthForm.redirectUri}
                  onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, redirectUri: e.target.value }))}
                />
                <input
                  className="input-premium"
                  placeholder="Frontend URL"
                  value={dropboxOauthForm.frontendUrl}
                  onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, frontendUrl: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={saveDropboxOauthSetting}
                  disabled={dropboxOauthSaving}
                  className={`btn-premium bg-slate-800 text-white w-full py-2 ${dropboxOauthSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {dropboxOauthSaving ? "Saving..." : "Save Dropbox OAuth"}
                </button>
                <div className="text-[10px] text-slate-400">App key/secret are masked and never returned in plain text.</div>
              </div>
            </>
          )}
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
            <select
              className="input-premium py-2 max-w-[120px]"
              value={newUser.role}
              onChange={e => setNewUser({ ...newUser, role: e.target.value })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button
              className="btn-premium bg-indigo-600 hover:bg-indigo-700 text-white flex-1 py-2.5 shadow-sm"
              onClick={addUser}
            >
              Add User
            </button>
          </div>
        </div>

        {/* Users List */}
        <div className="space-y-3 overflow-auto pr-2 custom-scrollbar flex-1">
          {uniqueUsers.map((u) => (
            <div
              key={u.id}
              className={`group flex items-center justify-between p-4 rounded-md border transition-all cursor-pointer ${
                selectedUserId === u.id
                  ? "bg-indigo-600 border-indigo-600 text-white shadow-sm translate-x-1"
                  : "bg-white border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
              }`}
              onClick={() => setSelectedUserId((prev) => (prev === u.id ? null : u.id))}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                  selectedUserId === u.id ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-600"
                }`}>
                  {u.email[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className={`font-bold text-sm truncate max-w-[100px] ${selectedUserId === u.id ? "text-white" : "text-slate-900"}`}>{u.email}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className={`text-[10px] font-bold uppercase tracking-widest ${selectedUserId === u.id ? "text-indigo-100" : "text-slate-400"}`}>
                      {u.role}
                    </div>
                    <div className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${selectedUserId === u.id ? "bg-white/20 text-white border-white/20" : authBadgeClass(u.auth_provider)}`}>
                      {u.auth_provider === "google" ? "Google" : "Manual"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {u.auth_provider !== "google" && (
                  <button
                    className={`p-2 rounded-lg transition-colors ${
                      selectedUserId === u.id ? "hover:bg-white/20 text-white" : "hover:bg-slate-100 text-slate-400 hover:text-indigo-600"
                    }`}
                    title="Reset Password"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("Are you sure you want to reset this user's password?")) {
                        resetPassword(u.id);
                      }
                    }}
                  >🔄</button>
                )}
                <button
                  className={`p-2 rounded-lg transition-colors ${
                    selectedUserId === u.id ? "hover:bg-white/20 text-white" : "hover:bg-red-50 text-slate-400 hover:text-red-500"
                  }`}
                  title="Delete User"
                  onClick={(e) => { e.stopPropagation(); deleteUser(u.id); }}
                >🗑️</button>
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* 2. GROUPS PANEL */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 md:p-7 h-full flex flex-col shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500 delay-75">
        <div className="flex items-center justify-between mb-8 border-b border-slate-200/50 pb-6">
          <h3 className="font-extrabold text-2xl text-slate-900 flex items-center gap-3">
            <span className="bg-emerald-600 text-white w-10 h-10 rounded-md flex items-center justify-center text-xl shadow-sm">🏢</span>
            Groups
          </h3>
          <span className="bg-white/60 text-emerald-600 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-emerald-100">{groups.length} Total</span>
        </div>
        <div className="text-[10px] uppercase tracking-widest font-bold text-emerald-500 mb-4">
          Group User Management
        </div>

        {selectedGroupId && (
          <div className="mb-6 bg-slate-50 p-4 rounded-md border border-slate-200 animate-in fade-in zoom-in duration-300">
            <h4 className="font-bold text-xs text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Group Settings
            </h4>

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
                        {u.email} ({u.auth_provider === "google" ? "Google" : "Manual"})
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
                          title={m.is_admin ? "Remove Group Admin" : "Make Group Admin"}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill={m.is_admin ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        </button>
                      )}
                      <button
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        onClick={() => removeUserFromGroup(m.id)}
                        title="Remove from group"
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
            placeholder="New group name"
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
                  title="Delete group"
                  onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}
                >🗑️</button>
              )}
            </div>
          ))}
        </div>

      </div>

      {/* 3. FOLDERS PANEL */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 md:p-7 h-full flex flex-col shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
        <div className="flex items-center justify-between mb-8 border-b border-slate-200/50 pb-6">
          <h3 className="font-extrabold text-2xl text-slate-900 flex items-center gap-3">
            <span className="bg-amber-600 text-white w-10 h-10 rounded-md flex items-center justify-center text-xl shadow-sm">📁</span>
            Folders
          </h3>
          <span className="bg-white/60 text-amber-600 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-amber-100">{folders.length} Total</span>
        </div>

        <div className="flex flex-col gap-3 mb-8 bg-slate-50 p-4 rounded-md border border-slate-200">
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 ml-1">New Folder</label>
          <input
            className="input-premium"
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
          />
          <button
            className="btn-premium bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 shadow-sm"
            onClick={createFolder}
          >
            Create
          </button>
          <div className="border border-slate-200 rounded-md p-2 bg-white max-h-28 overflow-auto">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Assign Groups (multiple)</div>
            <div className="grid grid-cols-2 gap-2">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={folderGroupIds.includes(String(g.id))}
                    onChange={(e) => {
                      const sid = String(g.id);
                      setFolderGroupIds((prev) => e.target.checked ? [...prev, sid] : prev.filter((x) => x !== sid));
                    }}
                  />
                  <span className="truncate">{g.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3 overflow-auto pr-2 custom-scrollbar flex-1">
          {folders.filter(f => !selectedGroupId || (f.group_ids || []).includes(Number(selectedGroupId))).map((f) => (
            <div key={f.id} className="group flex items-center justify-between p-4 rounded-md bg-white border border-slate-200 hover:border-amber-300 hover:bg-slate-50 transition-all">
              <div>
                <div className="font-bold text-sm text-slate-900">{f.path || f.name}</div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mt-0.5">
                  {(f.group_ids || []).length
                    ? `Groups: ${(f.group_ids || []).map((gid) => groups.find(g => g.id === gid)?.name || gid).join(", ")}`
                    : "Global"}
                </div>
              </div>
              <button
                className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all font-bold"
                onClick={() => deleteFolder(f.id)}
              >🗑️</button>
            </div>
          ))}
          {!folders.filter(f => !selectedGroupId || (f.group_ids || []).includes(Number(selectedGroupId))).length && (
            <div className="p-8 text-center bg-white/30 rounded-md border border-dashed border-slate-300">
              <div className="text-3xl mb-2 opacity-30">📂</div>
              <div className="text-xs text-slate-400 font-medium">No folders found</div>
            </div>
          )}
        </div>
      </div>

      {/* 4. OVERRIDES & PERMISSIONS PANEL */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 md:p-7 h-full flex flex-col shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
        <div className="flex items-center justify-between mb-8 border-b border-slate-200/50 pb-6">
          <h3 className="font-extrabold text-2xl text-slate-900 flex items-center gap-3">
            <span className="bg-indigo-600 text-white w-10 h-10 rounded-md flex items-center justify-center text-xl shadow-sm">🔒</span>
            Overrides & Permissions
          </h3>
          <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 text-right min-w-0 flex flex-col gap-1 items-end">
            {selectedUserId && (
              <span className="bg-white/60 px-3 py-1 rounded-full border border-indigo-100 truncate block max-w-[180px]">
                User: {userById.get(selectedUserId)?.email}
              </span>
            )}
            {selectedGroupId && (
              <span className="bg-white/60 px-3 py-1 rounded-full border border-emerald-100 text-emerald-600 truncate block max-w-[180px]">
                Group: {groups.find(g => g.id === selectedGroupId)?.name || selectedGroupId}
              </span>
            )}
            {!selectedUserId && !selectedGroupId && (
              <span className="text-slate-300 italic">Select user and/or group</span>
            )}
          </div>
        </div>

        {(selectedUserId || selectedGroupId) ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Sheet Selector */}
            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Spreadsheet</label>
              <select
                className="input-premium py-2 w-full mt-2"
                value={selectedUserSheetId || ""}
                onChange={(e) => setSelectedUserSheetId(e.target.value || null)}
              >
                <option value="">Select a spreadsheet…</option>
                {overrideSheetOptions.map((s) => (
                  <option key={s.id} value={s.id}>{trunc(s.filename, 80)}</option>
                ))}
              </select>
              <div className="text-[10px] text-slate-400 mt-1">This sheet is shared by user/group overrides below.</div>
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
                  <div className="grid grid-cols-2 gap-2">
                    {userSheetHeaders.map((h, i) => (
                      <label key={i} className={`flex items-center gap-3 p-3 rounded-md border transition-all cursor-pointer ${
                        userAllowedCols.has(h) ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-bold" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}>
                        <input
                          type="checkbox"
                          checked={userAllowedCols.has(h)}
                          onChange={() => toggleUserAllowed(h)}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                        />
                        <span className="text-xs truncate">{h}</span>
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

                <div className="pt-8 border-t border-slate-200/30">
                  <h4 className="font-bold text-sm text-slate-700 mb-4">View Permissions</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {views.filter(v => String(v.sheet_id) === String(selectedUserSheetId)).map((v) => (
                      <label key={v.id} className={`flex items-center gap-3 p-3 rounded-md border transition-all cursor-pointer ${
                        userViews.has(v.id) ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-bold" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}>
                        <input
                          type="checkbox"
                          checked={userViews.has(v.id)}
                          onChange={async () => {
                            const newViews = new Set(userViews);
                            try {
                              if (newViews.has(v.id)) {
                                await axios.delete(
                                  `${API}/views/user-permissions/${v.id}/${selectedUserId}`,
                                  { headers: { Authorization: `Bearer ${token}` } }
                                );
                                newViews.delete(v.id);
                              } else {
                                await axios.post(
                                  `${API}/views/user-permissions`,
                                  { viewId: v.id, userId: selectedUserId },
                                  { headers: { Authorization: `Bearer ${token}` } }
                                );
                                newViews.add(v.id);
                              }
                              setUserViews(newViews);
                            } catch (e) {
                              alert(e.response?.data?.error || "Failed to update view permission");
                            }
                          }}
                        />
                        <span className="text-xs truncate">{v.name}</span>
                      </label>
                    ))}
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
                      {views.filter(v => userViews.has(v.id)).map((v) => (
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
                  <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Group Override (Same Spreadsheet)</div>

                    <>
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-sm text-slate-700">Group Column Permissions</h4>
                        <button
                          className="text-[10px] font-bold text-emerald-600 hover:underline"
                          onClick={() => setGroupAllowedCols(new Set())}
                        >
                          Allow All
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {groupSheetHeaders.map((h) => (
                          <label key={h} className={`flex items-center gap-3 p-3 rounded-md border transition-all cursor-pointer ${
                            groupAllowedCols.has(h) ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-bold" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                          }`}>
                            <input
                              type="checkbox"
                              checked={groupAllowedCols.has(h)}
                              onChange={() => toggleGroupAllowed(h)}
                              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                            />
                            <span className="text-xs truncate">{h}</span>
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
                          <h4 className="font-bold text-sm text-slate-700">Group Row Filters</h4>
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

                      <div className="pt-4 border-t border-slate-200/30">
                        <h4 className="font-bold text-sm text-slate-700 mb-3">Group View Permissions</h4>
                        <div className="grid grid-cols-1 gap-2">
                          {views.filter(v => String(v.sheet_id) === String(selectedUserSheetId)).map((v) => (
                            <label key={v.id} className={`flex items-center gap-3 p-3 rounded-md border transition-all cursor-pointer ${
                              groupViews.has(v.id) ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-bold" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            }`}>
                              <input
                                type="checkbox"
                                checked={groupViews.has(v.id)}
                                onChange={async () => {
                                  const next = new Set(groupViews);
                                  try {
                                    if (next.has(v.id)) {
                                      await axios.delete(
                                        `${API}/views/group-permissions/${v.id}/${selectedGroupId}`,
                                        { headers: { Authorization: `Bearer ${token}` } }
                                      );
                                      next.delete(v.id);
                                    } else {
                                      await axios.post(
                                        `${API}/views/group-permissions`,
                                        { viewId: v.id, groupId: selectedGroupId },
                                        { headers: { Authorization: `Bearer ${token}` } }
                                      );
                                      next.add(v.id);
                                    }
                                    setGroupViews(next);
                                  } catch (e) {
                                    alert(e.response?.data?.error || "Failed to update group view permission");
                                  }
                                }}
                              />
                              <span className="text-xs truncate">{v.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <button
                        className="btn-premium bg-emerald-600 hover:bg-emerald-700 text-white w-full py-3"
                        onClick={saveGroupPermissions}
                      >
                        Save Group Permissions
                      </button>
                    </>
                </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-white/30 rounded-lg border border-dashed border-slate-300">
                <div className="text-center p-8">
                  <div className="text-4xl mb-4 opacity-20">🎯</div>
                  <div className="text-slate-400 font-medium max-w-[260px] mx-auto">Select a spreadsheet to configure user/group override permissions.</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center p-12">
              <div className="text-6xl mb-6 opacity-10 animate-pulse">🔒</div>
              <h4 className="text-slate-400 font-bold uppercase tracking-widest text-xs mb-2">No Override Target Selected</h4>
              <p className="text-slate-300 text-[10px] max-w-[220px] mx-auto">Select a user and/or a group from the left panels to open override permissions.</p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
