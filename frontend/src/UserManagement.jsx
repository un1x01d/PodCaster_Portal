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
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "producer" });

  // user-level permissions UI (select a sheet from user's groups)
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userSheets, setUserSheets] = useState([]);                // latest 10 for selected user
  const [selectedUserSheetId, setSelectedUserSheetId] = useState(null);
  const [userSheetHeaders, setUserSheetHeaders] = useState([]);
  const [userAllowedCols, setUserAllowedCols] = useState(new Set());
  const [userFilterKey, setUserFilterKey] = useState("");
  const [userFilterVal, setUserFilterVal] = useState("");

  // groups
  const [groups, setGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupAddUserId, setGroupAddUserId] = useState("");

  // group permissions (per-sheet)
  const [groupAllowedCols, setGroupAllowedCols] = useState(new Set());
  const [groupFilterKey, setGroupFilterKey] = useState("");
  const [groupFilterVal, setGroupFilterVal] = useState("");

  // group sheet selection
  const [groupSheets, setGroupSheets] = useState([]);
  const [selectedGroupSheetId, setSelectedGroupSheetId] = useState(null);
  const [groupSheetHeaders, setGroupSheetHeaders] = useState([]);

  // Templates (now scoped by group)
  const [templates, setTemplates] = useState(loadTemplates());
  const [newTplNameUser, setNewTplNameUser] = useState("");
  const [newTplNameGroup, setNewTplNameGroup] = useState("");
  const [selectedTplUser, setSelectedTplUser] = useState("");
  const [selectedTplGroup, setSelectedTplGroup] = useState("");

  // Views
  const [userViews, setUserViews] = useState(new Set());
  const [groupViews, setGroupViews] = useState(new Set());

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

  // load user permissions FOR SELECTED SHEET
  const loadUserPermissions = async (uid, sid) => {
    if (!uid || !sid) {
      setUserAllowedCols(new Set());
      setUserFilterKey(""); setUserFilterVal("");
      return;
    }
    const res = await axios.get(`${API}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { userId: uid, sheetId: sid }
    });
    const allowed = res.data?.allowed_columns || [];
    const filters = res.data?.row_filters || {};
    setUserAllowedCols(new Set(allowed));
    const [k, v] = Object.entries(filters)[0] || ["", ""];
    setUserFilterKey(k); setUserFilterVal(v);
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
      setGroupFilterKey(""); setGroupFilterVal("");
      return;
    }
    const res = await axios.get(`${API}/group-permissions`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { groupId: gid, sheetId: sid }
    });
    const allowed = res.data?.allowed_columns || [];
    const filters = res.data?.row_filters || {};
    setGroupAllowedCols(new Set(allowed));
    const [k, v] = Object.entries(filters)[0] || ["", ""];
    setGroupFilterKey(k); setGroupFilterVal(v);
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
  }, []);

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
      setUserFilterKey(""); setUserFilterVal("");
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
      setUserFilterKey(""); setUserFilterVal("");
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
      setGroupFilterKey(""); setGroupFilterVal("");
      setGroupSheetHeaders([]);
      setSelectedTplGroup("");
    }
  }, [selectedGroupId]);

  // when selected sheet for the group changes, load headers + that group's perms
  useEffect(() => {
    if (!selectedGroupSheetId || !selectedGroupId) {
      setGroupSheetHeaders([]);
      setGroupAllowedCols(new Set());
      setGroupFilterKey(""); setGroupFilterVal("");
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
    const row_filters = userFilterKey ? { [userFilterKey]: userFilterVal } : {};
    await axios.post(`${API}/permissions`, {
      sheetId: selectedUserSheetId, userId: selectedUserId, allowed_columns, row_filters
    }, { headers: { Authorization: `Bearer ${token}` }});
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
    const row_filters = groupFilterKey ? { [groupFilterKey]: groupFilterVal } : {};
    await axios.post(`${API}/group-permissions`, {
      sheetId: selectedGroupSheetId,
      groupId: selectedGroupId,
      allowed_columns,
      row_filters
    }, { headers: { Authorization: `Bearer ${token}` }});
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
        setGroupFilterKey(""); setGroupFilterVal("");
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
      userFilterKey ? { [userFilterKey]: userFilterVal } : {},
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
    const [k, v] = Object.entries(tpl.row_filters || {})[0] || ["", ""];
    const validKey = k && userSheetHeaders.includes(k) ? k : "";
    setUserFilterKey(validKey);
    setUserFilterVal(validKey ? v : "");
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
      groupFilterKey ? { [groupFilterKey]: groupFilterVal } : {},
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
    const [k, v] = Object.entries(tpl.row_filters || {})[0] || ["", ""];
    const validKey = k && groupSheetHeaders.includes(k) ? k : "";
    setGroupFilterKey(validKey);
    setGroupFilterVal(validKey ? v : "");
  };

  // Auto re-apply selected template after switching sheets (user scope)
  useEffect(() => {
    if (!selectedUserSheetId || !selectedTplUser) return;
    const tpl = templates.find(t => t.id === selectedTplUser);
    if (!tpl) return;
    const cols = (tpl.columns || []).filter(c => userSheetHeaders.includes(c));
    setUserAllowedCols(new Set(cols));
    const [k, v] = Object.entries(tpl.row_filters || {})[0] || ["", ""];
    const validKey = k && userSheetHeaders.includes(k) ? k : "";
    setUserFilterKey(validKey);
    setUserFilterVal(validKey ? v : "");
  }, [selectedUserSheetId, selectedTplUser, userSheetHeaders, templates]);

  // Auto re-apply selected template after switching sheets (group scope)
  useEffect(() => {
    if (!selectedGroupSheetId || !selectedTplGroup) return;
    const tpl = templates.find(t => t.id === selectedTplGroup);
    if (!tpl) return;
    const cols = (tpl.columns || []).filter(c => groupSheetHeaders.includes(c));
    setGroupAllowedCols(new Set(cols));
    const [k, v] = Object.entries(tpl.row_filters || {})[0] || ["", ""];
    const validKey = k && groupSheetHeaders.includes(k) ? k : "";
    setGroupFilterKey(validKey);
    setGroupFilterVal(validKey ? v : "");
  }, [selectedGroupSheetId, selectedTplGroup, groupSheetHeaders, templates]);

  const userById = useMemo(() => {
    const m = new Map();
    users.forEach(u => m.set(u.id, u));
    return m;
  }, [users]);

  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* USERS PANEL */}
      <div className="bg-white border rounded-xl shadow p-4">
        <h3 className="font-bold text-lg mb-3">Users</h3>

        {/* add user */}
        <div className="flex flex-col gap-2 mb-4">
          <input
            className="border rounded p-2"
            placeholder="email"
            value={newUser.email}
            onChange={e => setNewUser({ ...newUser, email: e.target.value })}
          />
          <input
            className="border rounded p-2"
            placeholder="password"
            value={newUser.password}
            onChange={e => setNewUser({ ...newUser, password: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-2 mb-4">
          <select
            className="border rounded p-2"
            value={newUser.role}
            onChange={e => setNewUser({ ...newUser, role: e.target.value })}
          >
            <option value="producer">producer</option>
            <option value="admin">admin</option>
          </select>
          <button className="bg-blue-600 hover:bg-blue-700 text-white rounded p-2" onClick={addUser}>
            Add User
          </button>
        </div>

        {/* list users */}
        <div className="max-h-64 overflow-auto border rounded">
          {users.map((u) => (
            <div
              key={u.id}
              className={`flex items-center justify-between px-3 py-2 border-b cursor-pointer ${
                selectedUserId === u.id ? "bg-blue-50" : "bg-white"
              }`}
              onClick={() => setSelectedUserId(u.id)}
            >
              <div>
                <div className="font-medium">{u.email}</div>
                <div className="text-xs text-gray-500">id: {u.id}</div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="border rounded p-1 text-sm"
                  value={u.role}
                  onChange={(e) => changeRole(u.id, e.target.value)}
                  onClick={(e)=>e.stopPropagation()}
                >
                  <option value="producer">producer</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded"
                  onClick={(e)=>{e.stopPropagation(); resetPassword(u.id);}}
                >Reset</button>
                <button
                  className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded"
                  onClick={(e)=>{e.stopPropagation(); deleteUser(u.id);}}
                >Delete</button>
              </div>
            </div>
          ))}
        </div>

        {/* user permissions (select SHEET from user's groups, latest 10) */}
        {selectedUserId && (
          <div className="mt-4">
            <h4 className="font-semibold mb-2">
              User Permissions — <span className="text-gray-600">{userById.get(selectedUserId)?.email}</span>
            </h4>

            {/* Sheet selector (latest 10) */}
            <div className="mb-2">
              <label className="text-sm font-semibold mr-2">Sheet:</label>
              <select
                className="border rounded p-2"
                value={selectedUserSheetId || ""}
                onChange={(e)=>setSelectedUserSheetId(e.target.value || null)}
              >
                <option value="">Select a sheet…</option>
                {userSheets.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.filename} — {s.folder_name || "—"} — {new Date(s.uploaded_at).toLocaleString()}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-500 ml-2">(latest 10)</span>
            </div>

            {/* Template toolbar (shows only templates for this sheet's group) */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                className="border rounded px-2 py-1"
                placeholder="Template name"
                value={newTplNameUser}
                onChange={(e)=>setNewTplNameUser(e.target.value)}
              />
              <button
                className="bg-gray-700 hover:bg-gray-800 text-white rounded px-3 py-1"
                onClick={handleSaveTemplateFromUser}
                disabled={!selectedUserSheetId || !currentUserSheetGroupId}
                title={selectedUserSheetId ? "Save current selection as a template (group-scoped)" : "Pick a sheet first"}
              >
                Save as Template
              </button>
              <select
                className="border rounded p-2"
                value={selectedTplUser}
                onChange={(e)=>handleApplyTemplateToUser(e.target.value)}
                disabled={!selectedUserSheetId || !currentUserSheetGroupId}
                title={selectedUserSheetId ? "Apply a saved template to this sheet" : "Pick a sheet first"}
              >
                <option value="">Load template…</option>
                {visibleUserTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {selectedTplUser && (
                <button
                  className="text-red-600 border border-red-600 rounded px-2 py-1"
                  onClick={()=>handleDeleteTemplate(selectedTplUser)}
                >
                  Delete template
                </button>
              )}
            </div>

            {/* Only show column checkboxes & filter once a sheet is chosen */}
            {selectedUserSheetId ? (
              <>
                <div className="text-xs text-gray-500 mb-2">
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
                      <span className="text-sm">{h}</span>
                    </label>
                  ))}
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <span className="text-sm">Row filter:</span>
                  <select
                    className="border rounded p-1"
                    value={userFilterKey}
                    onChange={e=>setUserFilterKey(e.target.value)}
                  >
                    <option value="">(none)</option>
                    {userSheetHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <input
                    className="border rounded p-1"
                    placeholder="value"
                    value={userFilterVal}
                    onChange={e=>setUserFilterVal(e.target.value)}
                  />
                  <button
                    className="bg-green-600 hover:bg-green-700 text-white rounded px-3 py-1"
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
                {views.map((v) => (
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
                    <span className="text-sm">{v.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* GROUPS PANEL */}
      <div className="bg-white border rounded-xl shadow p-4">
        <h3 className="font-bold text-lg mb-3">Groups</h3>

        <div className="flex gap-2 mb-3">
          <input
            className="border rounded p-2 flex-1"
            placeholder="New group name"
            value={newGroupName}
            onChange={e=>setNewGroupName(e.target.value)}
          />
          <button className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3" onClick={createGroup}>
            Create
          </button>
        </div>

        <div className="max-h-64 overflow-auto border rounded">
          {groups.map(g => (
            <div
              key={g.id}
              className={`px-3 py-2 border-b cursor-pointer ${selectedGroupId === g.id ? "bg-blue-50" : "bg-white"}`}
              onClick={()=>setSelectedGroupId(g.id)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-gray-500">id: {g.id}</div>
                </div>
                <button
                  className="text-red-600 hover:text-red-700 text-sm border border-red-600 px-2 py-1 rounded"
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
          <div className="mt-4">
            <h4 className="font-semibold mb-2">Members</h4>

            <div className="flex gap-2 mb-2">
              <select
                className="border rounded p-2 flex-1"
                value={groupAddUserId}
                onChange={e=>setGroupAddUserId(e.target.value)}
              >
                <option value="">Select user…</option>
                {users
                  .filter(u => !groupMembers.some(m => m.id === u.id))
                  .map(u => <option key={u.id} value={u.id}>{u.email}</option>)
                }
              </select>
              <button className="bg-green-600 hover:bg-green-700 text-white rounded px-3" onClick={addUserToGroup}>
                Add
              </button>
            </div>

            <div className="max-h-40 overflow-auto border rounded">
              {groupMembers.map(m => (
                <div key={m.id} className="flex items-center justify-between px-3 py-2 border-b">
                  <div>{m.email}</div>
                  <button
                    className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded"
                    onClick={()=>removeUserFromGroup(m.id)}
                  >Remove</button>
                </div>
              ))}
              {!groupMembers.length && <div className="text-sm text-gray-500 p-3">No members yet.</div>}
            </div>
          </div>
        )}
      </div>

      {/* GROUP PERMISSIONS PANEL (PER-SHEET) */}
      <div className="bg-white border rounded-xl shadow p-4">
        <h3 className="font-bold text-lg mb-3">Group Permissions (per sheet)</h3>
        {selectedGroupId ? (
          <>
            {/* select a sheet that belongs to this group's folder */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="text-sm font-semibold">Sheet:</label>
              <select
                className="border rounded p-2"
                value={selectedGroupSheetId || ""}
                onChange={(e)=>setSelectedGroupSheetId(e.target.value || null)}
              >
                <option value="">Select a sheet…</option>
                {groupSheets.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.filename} — {s.folder_name || "—"} — {new Date(s.uploaded_at).toLocaleString()}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-500">(latest 10)</span>

              {/* Template toolbar (shows only this group's templates) */}
              <input
                className="border rounded px-2 py-1"
                placeholder="Template name"
                value={newTplNameGroup}
                onChange={(e)=>setNewTplNameGroup(e.target.value)}
              />
              <button
                className="bg-gray-700 hover:bg-gray-800 text-white rounded px-3 py-1"
                onClick={handleSaveTemplateFromGroup}
                disabled={!selectedGroupId}
                title={selectedGroupId ? "Save current selection as a template (group-scoped)" : "Pick a group first"}
              >
                Save as Template
              </button>
              <select
                className="border rounded p-2"
                value={selectedTplGroup}
                onChange={(e)=>handleApplyTemplateToGroup(e.target.value)}
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
                  className="text-red-600 border border-red-600 rounded px-2 py-1"
                  onClick={()=>handleDeleteTemplate(selectedTplGroup)}
                >
                  Delete template
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
                      <span className="text-sm">{h}</span>
                    </label>
                  ))}
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <span className="text-sm">Row filter:</span>
                  <select
                    className="border rounded p-1"
                    value={groupFilterKey}
                    onChange={e=>setGroupFilterKey(e.target.value)}
                  >
                    <option value="">(none)</option>
                    {groupSheetHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <input
                    className="border rounded p-1"
                    placeholder="value"
                    value={groupFilterVal}
                    onChange={e=>setGroupFilterVal(e.target.value)}
                  />
                  <button
                    className="bg-green-600 hover:bg-green-700 text-white rounded px-3 py-1"
                    onClick={saveGroupPermissions}
                  >
                    Save
                  </button>
                </div>

                <div className="mt-4">
                  <h5 className="font-semibold mb-2">View Permissions</h5>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-auto border rounded p-2">
                    {views.map((v) => (
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
                        <span className="text-sm">{v.name}</span>
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

