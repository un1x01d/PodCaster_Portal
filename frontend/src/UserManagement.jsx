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

export default function UserManagement({ token /* sheetId not required */ }) {
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + "..." : s);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "producer" });

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

  // group sheet selection
  const [groupSheets, setGroupSheets] = useState([]);
  const [allSheets, setAllSheets] = useState([]); // all sheets (active or inactive) for selection
  const [selectedGroupSheetId, setSelectedGroupSheetId] = useState(null);
  const [groupSheetHeaders, setGroupSheetHeaders] = useState([]);

  // Templates (now scoped by group)
  const [templates, setTemplates] = useState(loadTemplates());
  // ...

  // Folders
  const [folders, setFolders] = useState([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderGroupId, setFolderGroupId] = useState("");

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
      await axios.post(`${API}/folders`, { name: newFolderName, groupId: folderGroupId || null }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNewFolderName("");
      setFolderGroupId("");
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
    const res = await axios.get(`${API}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setUsers(res.data || []);
  };

  const fetchGroups = async () => {
    const res = await axios.get(`${API}/groups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setGroups(res.data || []);
  };

  const fetchGroupMembers = async (gid) => {
    if (!gid) return setGroupMembers([]);
    const res = await axios.get(`${API}/groups/${gid}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setGroupMembers(res.data || []);
  };

  // Helper: for a given user id, determine all groups they belong to using existing endpoints
  const getGroupsForUser = async (uid) => {
    // Use /groups then check /groups/:id/users for membership
    const memberGroupIds = [];
    try {
      const gRes = await axios.get(`${API}/groups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const allGroups = gRes.data || [];
      // Fetch members for each group (sequential to avoid hammering; still fine for admin UI)
      for (const g of allGroups) {
        const mRes = await axios.get(`${API}/groups/${g.id}/users`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const ms = mRes.data || [];
        if (ms.some((m) => Number(m.id) === Number(uid))) {
          memberGroupIds.push(g.id);
        }
      }
    } catch (e) {
      console.error("getGroupsForUser failed:", e);
    }
    return memberGroupIds;
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

  // list sheets for selected group
  const fetchGroupSheets = async (gid) => {
    if (!gid) { setGroupSheets([]); return; }
    try {
      const res = await axios.get(`${API}/groups/${gid}/sheets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // keep them as-is (server already sorts DESC by uploaded_at)
      setGroupSheets((res.data || []).slice(0, 10)); // limit latest 10
    } catch (e) {
      console.error("fetchGroupSheets failed", e);
      setGroupSheets([]);
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
    fetchUsers();
    fetchGroups();
    fetchAllViews();
    fetchAllSheets(); // load on mount
  }, []);



  const fetchAllViews = async () => {
    const res = await axios.get(`${API}/views`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setViews(res.data || []);
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
      fetchGroupSheets(selectedGroupId);
      fetchGroupViews(selectedGroupId);
      setSelectedGroupSheetId(null);
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      setGroupSheetHeaders([]);
      setSelectedTplGroup("");
    }
  }, [selectedGroupId]);

  // when selected sheet for the group changes, load headers + that group's perms
  useEffect(() => {
    if (!selectedGroupSheetId || !selectedGroupId) {
      setGroupSheetHeaders([]);
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      return;
    }
    fetchGroupSheetHeaders(selectedGroupSheetId);
    loadGroupPermissions(selectedGroupId, selectedGroupSheetId);
  }, [selectedGroupSheetId, selectedGroupId]);

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
    await axios.post(`${API}/users`, newUser, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setNewUser({ email: "", password: "", role: "producer" });
    fetchUsers();
  };

  const resetPassword = async (id) => {
    const res = await axios.patch(`${API}/users/${id}`, { reset: true }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    alert(`Temp password: ${res.data?.newPassword || "(see server log)"}`);
  };

  const changeRole = async (id, role) => {
    await axios.patch(`${API}/users/${id}`, { role }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchUsers();
  };

  const deleteUser = async (id) => {
    if (!confirm("Delete user?")) return;
    await axios.delete(`${API}/users/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (selectedUserId === id) setSelectedUserId(null);
    fetchUsers();
  };

  const saveUserPermissions = async () => {
    if (!selectedUserId || !selectedUserSheetId) {
      alert("Pick a user and a sheet first.");
      return;
    }
    const allowed_columns = Array.from(userAllowedCols);
    // Convert filter array to object, filtering out empty entries
    const row_filters = {};
    userRowFilters.forEach(f => {
      if (f.key && f.value) row_filters[f.key] = f.value;
    });
    await axios.post(`${API}/permissions`, {
      sheetId: selectedUserSheetId, userId: selectedUserId, allowed_columns, row_filters
    }, { headers: { Authorization: `Bearer ${token}` } });
    alert("User permissions saved");
  };

  // --- Actions: groups ---
  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    await axios.post(`${API}/groups`, { name: newGroupName.trim() }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setNewGroupName("");
    fetchGroups();
  };

  const addUserToGroup = async () => {
    if (!selectedGroupId || !groupAddUserId) return;
    await axios.post(`${API}/groups/${selectedGroupId}/users`, { userId: Number(groupAddUserId) }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setGroupAddUserId("");
    fetchGroupMembers(selectedGroupId);
  };

  const removeUserFromGroup = async (uid) => {
    if (!selectedGroupId) return;
    await axios.delete(`${API}/groups/${selectedGroupId}/users/${uid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchGroupMembers(selectedGroupId);
  };

  const saveGroupPermissions = async () => {
    if (!selectedGroupId || !selectedGroupSheetId) {
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
      sheetId: selectedGroupSheetId,
      groupId: selectedGroupId,
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
        setGroupSheets([]);
        setSelectedGroupSheetId(null);
        setGroupAllowedCols(new Set());
        setGroupAllowedCols(new Set());
        setGroupSheetHeaders([]);
        setSelectedTplGroup("");
      }
      fetchGroups();
    } catch (e) {
      console.error("delete group failed", e);
      alert("❌ Could not delete group");
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
    if (!selectedGroupSheetId || !selectedTplGroup) return;
    const tpl = templates.find(t => t.id === selectedTplGroup);
    if (!tpl) return;
    const cols = (tpl.columns || []).filter(c => groupSheetHeaders.includes(c));
    setGroupAllowedCols(new Set(cols));
    // Convert template filters object to array
    const filterArray = Object.entries(tpl.row_filters || {}).map(([key, value]) => ({ key, value }));
    setGroupRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  }, [selectedGroupSheetId, selectedTplGroup, groupSheetHeaders, templates]);

  const userById = useMemo(() => {
    const m = new Map();
    users.forEach(u => m.set(u.id, u));
    return m;
  }, [users]);

  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
      {/* USERS PANEL */}
      <div className="bg-white border text-slate-700 rounded-2xl shadow-sm p-6 border-slate-200 h-full flex flex-col">
        <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2 border-b pb-2">
          <span className="text-xl">👥</span> Users
        </h3>

        {/* add user */}
        <div className="flex flex-col gap-3 mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Add New User</label>
          <input
            className="border border-slate-200 rounded-lg px-3 h-8 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all"
            placeholder="Email address"
            value={newUser.email}
            onChange={e => setNewUser({ ...newUser, email: e.target.value })}
          />
          <input
            className="border border-slate-200 rounded-lg px-3 h-8 text-xs focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all"
            placeholder="Password"
            type="password"
            value={newUser.password}
            onChange={e => setNewUser({ ...newUser, password: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <select
              className="border border-slate-200 rounded-lg px-3 h-8 text-xs bg-white flex-1 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
              value={newUser.role}
              onChange={e => setNewUser({ ...newUser, role: e.target.value })}
            >
              <option value="producer">Producer</option>
              <option value="admin">Admin</option>
            </select>
            <button
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-8 text-xs font-semibold shadow-sm hover:shadow transition-all whitespace-nowrap"
              onClick={addUser}
            >
              Add User
            </button>
          </div>
        </div>

        {/* list users */}
        <div className="max-h-96 overflow-auto border border-slate-200 rounded-xl bg-white shadow-inner">
          {users.map((u) => (
            <div
              key={u.id}
              className={`flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${selectedUserId === u.id ? "bg-blue-50 border-l-4 border-l-blue-500 pl-3" : "hover:bg-slate-50"
                }`}
              onClick={() => setSelectedUserId(u.id)}
            >
              <div>
                <div className="font-semibold text-slate-800 text-sm">{u.email}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-0.5">{u.role} • ID: {u.id}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-md transition-all border border-transparent hover:border-blue-100 whitespace-nowrap"
                  onClick={(e) => { e.stopPropagation(); resetPassword(u.id); }}
                >Reset</button>
                <button
                  className="text-[10px] font-bold uppercase tracking-wider text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-all border border-transparent hover:border-red-100 whitespace-nowrap"
                  onClick={(e) => { e.stopPropagation(); deleteUser(u.id); }}
                >Delete</button>
              </div>
            </div>
          ))}
        </div>

        {/* user permissions (select SHEET from user's groups, latest 10) */}
        {selectedUserId && (
          <div className="mt-4">
            <h4 className="font-semibold mb-2">
              User Permissions — <span className="text-blue-600 font-bold">{userById.get(selectedUserId)?.email}</span>
            </h4>

            {/* Sheet selector (latest 10) */}
            <div className="flex items-center mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-2 shrink-0">Sheet:</label>
              <select
                className="border rounded px-2 h-8 flex-1 min-w-0 truncate text-xs"
                value={selectedUserSheetId || ""}
                onChange={(e) => setSelectedUserSheetId(e.target.value || null)}
              >
                <option value="">Select a sheet…</option>
                {userSheets.map(s => (
                  <option key={s.id} value={s.id}>
                    {trunc(s.filename, 50)}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-500 ml-2">(latest 10)</span>
            </div>

            {/* Template toolbar (shows only templates for this sheet's group) */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                className="border border-slate-200 rounded-lg px-3 h-8 text-xs focus:ring-2 focus:ring-blue-100 outline-none"
                placeholder="Template name"
                value={newTplNameUser}
                onChange={(e) => setNewTplNameUser(e.target.value)}
              />
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 h-8 text-xs font-semibold shadow-sm whitespace-nowrap"
                onClick={handleSaveTemplateFromUser}
                disabled={!selectedUserSheetId || !currentUserSheetGroupId}
                title={selectedUserSheetId ? "Save current selection as a template (group-scoped)" : "Pick a sheet first"}
              >
                Save as Template
              </button>
              <select
                className="border border-slate-200 rounded-lg px-3 h-8 text-xs bg-white focus:ring-2 focus:ring-blue-100 outline-none"
                value={selectedTplUser}
                onChange={(e) => handleApplyTemplateToUser(e.target.value)}
                disabled={!selectedUserSheetId || !currentUserSheetGroupId}
                title={selectedUserSheetId ? "Apply a saved template to this sheet" : "Pick a sheet first"}
              >
                <option value="">Load template…</option>
                {visibleUserTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                className={`border rounded-lg px-3 h-8 text-xs font-semibold transition-colors whitespace-nowrap ${selectedTplUser ? "text-red-500 border-red-200 hover:bg-red-50" : "text-gray-300 border-gray-200"}`}
                onClick={() => selectedTplUser && handleDeleteTemplate(selectedTplUser)}
                disabled={!selectedTplUser}
              >
                Delete template
              </button>
            </div>

            {/* Only show column checkboxes & filter once a sheet is chosen */}
            {selectedUserSheetId ? (
              <>
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2">
                  Select columns allowed for this user. Leave all unchecked to allow all.
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-auto border rounded p-2">
                  {userSheetHeaders.map(h => (
                    <label key={h} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={userAllowedCols.has(h)}
                        onChange={() => toggleUserAllowed(h)}
                      />
                      <span className="text-xs font-medium text-slate-600">{h}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-2 flex gap-2">
                  <button
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-8 font-semibold text-xs flex-1 shadow-sm whitespace-nowrap"
                    onClick={saveUserPermissions}
                  >
                    Save Column Permissions
                  </button>
                  <button
                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg px-4 h-8 font-semibold text-xs flex-1 shadow-sm transition-colors whitespace-nowrap"
                    onClick={() => {
                      setUserAllowedCols(new Set());
                      setUserRowFilters([{ key: "", value: "" }]);
                    }}
                  >
                    Reset Permissions
                  </button>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Row Filters:</span>
                    <button
                      className="bg-blue-600 hover:bg-blue-700 text-white rounded px-2 h-7 text-xs font-medium"
                      onClick={() => setUserRowFilters([...userRowFilters, { key: "", value: "" }])}
                    >
                      + Add Filter
                    </button>
                  </div>
                  {userRowFilters.map((filter, idx) => (
                    <div key={idx} className="flex items-center gap-2 mb-2">
                      <select
                        className="border rounded px-2 h-7 text-xs flex-1"
                        value={filter.key}
                        onChange={e => {
                          const newFilters = [...userRowFilters];
                          newFilters[idx].key = e.target.value;
                          setUserRowFilters(newFilters);
                        }}
                      >
                        <option value="">(select column)</option>
                        {userSheetHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <input
                        className="border rounded px-2 h-7 text-xs flex-1"
                        placeholder="value"
                        value={filter.value}
                        onChange={e => {
                          const newFilters = [...userRowFilters];
                          newFilters[idx].value = e.target.value;
                          setUserRowFilters(newFilters);
                        }}
                      />
                      {userRowFilters.length > 1 && (
                        <button
                          className="bg-red-600 hover:bg-red-700 text-white rounded px-2 py-1 text-xs"
                          onClick={() => setUserRowFilters(userRowFilters.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 h-8 text-sm font-medium mt-2 shadow-sm"
                    onClick={saveUserPermissions}
                  >
                    Save
                  </button>
                </div>
              </>
            ) : (
              <div className="text-gray-500 mt-2">Select a sheet to configure user permissions.</div>
            )}

            <div className="mt-4">
              <h5 className="font-semibold mb-2">View Permissions</h5>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-auto border rounded p-2">
                {views.filter(v => String(v.sheet_id) === String(selectedUserSheetId)).map((v) => (
                  <label key={v.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={userViews.has(v.id)}
                      onChange={async () => {
                        const newViews = new Set(userViews);
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
                      }}
                    />
                    <span className="text-xs font-medium text-slate-600">{v.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Default View Selection */}
            <div className="mt-4">
              <h5 className="font-semibold mb-2 text-sm text-slate-700">Default View (Auto-load on Login)</h5>
              <div className="flex gap-2">
                <select
                  className="border rounded px-2 h-9 flex-1 text-xs"
                  value={userDefaultViewId}
                  onChange={(e) => setUserDefaultViewId(e.target.value)}
                >
                  <option value="">(None)</option>
                  {views.filter(v => userViews.has(v.id)).map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                <button
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-9 font-medium text-sm shadow-sm"
                  onClick={async () => {
                    await axios.put(
                      `${API}/users/${selectedUserId}/default-view`,
                      { viewId: userDefaultViewId || null },
                      { headers: { Authorization: `Bearer ${token}` } }
                    );
                    alert("Default view saved");
                  }}
                >
                  Save Default View
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* GROUPS PANEL */}
      <div className="bg-white border text-slate-700 rounded-2xl shadow-sm p-6 border-slate-200 h-full flex flex-col">
        <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2 border-b pb-2">
          <span className="text-xl">🏢</span> Groups
        </h3>

        <div className="flex gap-2 mb-4">
          <input
            className="border border-slate-200 rounded-lg px-3 h-9 text-sm flex-1 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all"
            placeholder="New group name"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
          />
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-9 text-sm font-medium shadow-sm hover:shadow transition-all"
            onClick={createGroup}
          >
            Create
          </button>
        </div>

        <div className="max-h-64 overflow-auto border border-slate-200 rounded-xl bg-white shadow-inner mb-4">
          {groups.map(g => (
            <div
              key={g.id}
              className={`px-4 py-3 border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${selectedGroupId === g.id ? "bg-blue-50 border-l-4 border-l-blue-500 pl-3" : "hover:bg-slate-50"}`}
              onClick={() => setSelectedGroupId(g.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800 text-sm">{g.name}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-0.5">ID: {g.id}</div>
                </div>
                <button
                  className="text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-all border border-transparent hover:border-red-100"
                  title="Delete group"
                  onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* group members */}
        {selectedGroupId && (
          <div className="mt-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
            <h4 className="font-bold text-sm text-slate-700 mb-2 uppercase tracking-wider">Members</h4>

            <div className="flex gap-2 mb-3">
              <select
                className="border border-slate-200 rounded-lg px-2 h-9 flex-1 text-sm bg-white"
                value={groupAddUserId}
                onChange={e => setGroupAddUserId(e.target.value)}
              >
                <option value="">Select user…</option>
                {users
                  .filter(u => !groupMembers.some(m => m.id === u.id))
                  .map(u => <option key={u.id} value={u.id}>{u.email}</option>)
                }
              </select>
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 h-9 text-sm font-medium shadow-sm"
                onClick={addUserToGroup}
              >
                Add
              </button>
            </div>

            <div className="max-h-40 overflow-auto border border-slate-200 rounded-lg bg-white">
              {groupMembers.map(m => (
                <div key={m.id} className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  <div className="text-sm font-medium text-slate-700">{m.email}</div>
                  <button
                    className="text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-md transition-all"
                    onClick={() => removeUserFromGroup(m.id)}
                  >Remove</button>
                </div>
              ))}
              {!groupMembers.length && <div className="text-xs text-slate-400 p-3 italic">No members yet.</div>}
            </div>
          </div>
        )}
      </div>

      {/* FOLDERS PANEL */}
      <div className="bg-white border text-slate-700 rounded-2xl shadow-sm p-6 border-slate-200 h-full flex flex-col">
        <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2 border-b pb-2">
          <span className="text-xl">📁</span> Folders
        </h3>
        <div className="flex flex-col gap-3 mb-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
          <input
            className="border border-slate-200 rounded-lg px-3 h-9 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
            placeholder="New folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className="border border-slate-200 rounded-lg px-3 h-9 text-sm flex-1 bg-white focus:ring-2 focus:ring-blue-100 outline-none"
              value={folderGroupId}
              onChange={(e) => setFolderGroupId(e.target.value)}
            >
              <option value="">(No Group)</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-9 font-medium text-sm shadow-sm"
              onClick={createFolder}
            >
              Create
            </button>
          </div>
        </div>

        <div className="max-h-64 overflow-auto border border-slate-200 rounded-xl bg-white shadow-inner">
          {selectedGroupId ? (
            <>
              {folders.filter(f => f.group_id === selectedGroupId).map((f) => (
                <div key={f.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">{f.name}</div>
                    {f.group_id && (
                      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-0.5">
                        Group: {groups.find(g => g.id === f.group_id)?.name || f.group_id}
                      </div>
                    )}
                  </div>
                  <button
                    className="text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-all border border-transparent hover:border-red-100"
                    onClick={() => deleteFolder(f.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
              {!folders.filter(f => f.group_id === selectedGroupId).length && (
                <div className="p-4 text-sm text-slate-400 italic text-center">No folders assigned to this group.</div>
              )}
            </>
          ) : (
            <>
              {folders.map((f) => (
                <div key={f.id} className="flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">{f.name}</div>
                    {f.group_id && (
                      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-0.5">
                        Group: {groups.find(g => g.id === f.group_id)?.name || f.group_id}
                      </div>
                    )}
                  </div>
                  <button
                    className="text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-all border border-transparent hover:border-red-100"
                    onClick={() => deleteFolder(f.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
              {!folders.length && <div className="p-4 text-sm text-slate-400 italic text-center">No folders.</div>}
            </>
          )}
        </div>
      </div>

      {/* GROUP PERMISSIONS PANEL (PER-SHEET) */}
      <div className="bg-white border text-slate-700 rounded-2xl shadow-sm p-6 border-slate-200 h-full flex flex-col">
        <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2 border-b pb-2">
          <span className="text-xl">🔒</span> Group Permissions (per sheet)
        </h3>
        {selectedGroupId ? (
          <>
            {/* select a sheet that belongs to this group's folder */}
            <div className="mb-4 flex flex-wrap items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Sheet:</label>
              <select
                className="border border-slate-200 rounded-lg px-3 h-9 max-w-[200px] truncate text-xs bg-white focus:ring-2 focus:ring-blue-100 outline-none"
                value={selectedGroupSheetId || ""}
                onChange={(e) => setSelectedGroupSheetId(e.target.value || null)}
              >
                <option value="">Select a sheet…</option>
                {allSheets.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.active ? "(Active) " : ""}{trunc(s.filename, 30)}
                  </option>
                ))}
              </select>

              {/* Template toolbar (shows only this group's templates) */}
              <input
                className="border border-slate-200 rounded-lg px-3 h-9 text-sm focus:ring-2 focus:ring-blue-100 outline-none"
                placeholder="Template name"
                value={newTplNameGroup}
                onChange={(e) => setNewTplNameGroup(e.target.value)}
              />
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 h-9 text-sm font-medium shadow-sm"
                onClick={handleSaveTemplateFromGroup}
                disabled={!selectedGroupId}
                title={selectedGroupId ? "Save current selection as a template (group-scoped)" : "Pick a group first"}
              >
                Save
              </button>
              <select
                className="border border-slate-200 rounded-lg px-3 h-9 text-sm bg-white focus:ring-2 focus:ring-blue-100 outline-none"
                value={selectedTplGroup}
                onChange={(e) => handleApplyTemplateToGroup(e.target.value)}
                disabled={!selectedGroupId || !selectedGroupSheetId}
                title={selectedGroupId ? "Apply a saved template to this group's sheet" : "Pick a group first"}
              >
                <option value="">Load template…</option>
                {visibleGroupTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {selectedTplGroup && (
                <button
                  className="text-red-500 hover:text-red-600 border border-red-200 hover:bg-red-50 rounded-lg px-3 h-9 text-xs font-medium"
                  onClick={() => handleDeleteTemplate(selectedTplGroup)}
                >
                  Delete
                </button>
              )}
            </div>

            {selectedGroupSheetId ? (
              <>
                <div className="text-xs text-gray-500 mb-1">
                  Columns for this sheet (leave empty for all):
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-auto border rounded p-2">
                  {groupSheetHeaders.map(h => (
                    <label key={h} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={groupAllowedCols.has(h)}
                        onChange={() => toggleGroupAllowed(h)}
                      />
                      <span className="text-xs font-medium text-slate-600">{h}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-2 flex gap-2">
                  <button
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-8 font-semibold text-xs flex-1 shadow-sm whitespace-nowrap"
                    onClick={saveGroupPermissions}
                  >
                    Save Column Permissions
                  </button>
                  <button
                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg px-4 h-8 font-semibold text-xs flex-1 shadow-sm transition-colors whitespace-nowrap"
                    onClick={() => {
                      setGroupAllowedCols(new Set());
                      setGroupRowFilters([{ key: "", value: "" }]);
                    }}
                  >
                    Reset Permissions
                  </button>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Row Filters:</span>
                    <button
                      className="bg-blue-600 hover:bg-blue-700 text-white rounded px-2 h-7 text-xs font-medium"
                      onClick={() => setGroupRowFilters([...groupRowFilters, { key: "", value: "" }])}
                    >
                      + Add Filter
                    </button>
                  </div>
                  {groupRowFilters.map((filter, idx) => (
                    <div key={idx} className="flex items-center gap-2 mb-2">
                      <select
                        className="border rounded px-2 h-7 text-xs flex-1"
                        value={filter.key}
                        onChange={e => {
                          const newFilters = [...groupRowFilters];
                          newFilters[idx].key = e.target.value;
                          setGroupRowFilters(newFilters);
                        }}
                      >
                        <option value="">(select column)</option>
                        {groupSheetHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <input
                        className="border rounded px-2 h-7 text-xs flex-1"
                        placeholder="value"
                        value={filter.value}
                        onChange={e => {
                          const newFilters = [...groupRowFilters];
                          newFilters[idx].value = e.target.value;
                          setGroupRowFilters(newFilters);
                        }}
                      />
                      {groupRowFilters.length > 1 && (
                        <button
                          className="bg-red-600 hover:bg-red-700 text-white rounded px-2 h-7 text-xs font-medium"
                          onClick={() => setGroupRowFilters(groupRowFilters.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 h-8 text-xs font-semibold mt-2 shadow-sm whitespace-nowrap"
                    onClick={saveGroupPermissions}
                  >
                    Save
                  </button>
                </div>

                <div className="mt-4">
                  <h5 className="font-semibold mb-2 text-sm text-slate-700">View Permissions</h5>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-auto border rounded p-2">
                    {views.filter(v => String(v.sheet_id) === String(selectedGroupSheetId)).map((v) => (
                      <label key={v.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={groupViews.has(v.id)}
                          onChange={async () => {
                            const newViews = new Set(groupViews);
                            if (newViews.has(v.id)) {
                              await axios.delete(
                                `${API}/views/group-permissions/${v.id}/${selectedGroupId}`,
                                { headers: { Authorization: `Bearer ${token}` } }
                              );
                              newViews.delete(v.id);
                            } else {
                              await axios.post(
                                `${API}/views/group-permissions`,
                                { viewId: v.id, groupId: selectedGroupId },
                                { headers: { Authorization: `Bearer ${token}` } }
                              );
                              newViews.add(v.id);
                            }
                            setGroupViews(newViews);
                          }}
                        />
                        <span className="text-xs font-medium text-slate-600">{v.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-gray-500">Select a sheet to configure permissions.</div>
            )}
          </>
        ) : (
          <div className="text-gray-500">Select a group to edit permissions.</div>
        )}
      </div>
    </div>
  );
}

