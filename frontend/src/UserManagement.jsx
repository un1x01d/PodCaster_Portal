import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function UserManagement({ token, sheetId: _ignoredActive }) {
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "producer" });

  // permissions target: pick a stored sheet first
  const [sheets, setSheets] = useState([]);
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [headers, setHeaders] = useState([]);

  // user-level permissions UI
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userAllowedCols, setUserAllowedCols] = useState(new Set());
  const [userFilterKey, setUserFilterKey] = useState("");
  const [userFilterVal, setUserFilterVal] = useState("");

  // groups
  const [groups, setGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupAddUserId, setGroupAddUserId] = useState("");
  const [groupAllowedCols, setGroupAllowedCols] = useState(new Set());
  const [groupFilterKey, setGroupFilterKey] = useState("");
  const [groupFilterVal, setGroupFilterVal] = useState("");

  // ===== fetchers =====
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

  const fetchMySheets = async () => {
    const res = await axios.get(`${API}/my-sheets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = res.data || [];
    setSheets(list);
    if (!selectedSheetId && list.length) {
      setSelectedSheetId(String(list[0].id));
    }
  };

  const fetchSheetHeaders = async (sid) => {
    if (!sid) {
      setHeaders([]);
      return;
    }
    const res = await axios.get(`${API}/sheets/${sid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const h = res.data?.headers || [];
    setHeaders(Array.isArray(h) ? h : []);
  };

  const fetchGroupMembers = async (gid) => {
    if (!gid) return setGroupMembers([]);
    const res = await axios.get(`${API}/groups/${gid}/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setGroupMembers(res.data || []);
  };

  const loadUserPermissions = async (uid, sid = selectedSheetId) => {
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

  const loadGroupPermissions = async (gid, sid = selectedSheetId) => {
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

  // ===== effects =====
  useEffect(() => {
    fetchUsers();
    fetchGroups();
    fetchMySheets();
  }, []);

  useEffect(() => {
    // when sheet changes -> get headers
    if (selectedSheetId) fetchSheetHeaders(selectedSheetId);
    // and reload current user/group permissions against this sheet
    if (selectedUserId) loadUserPermissions(selectedUserId, selectedSheetId);
    if (selectedGroupId) {
      fetchGroupMembers(selectedGroupId);
      loadGroupPermissions(selectedGroupId, selectedSheetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSheetId]);

  useEffect(() => {
    if (selectedUserId) loadUserPermissions(selectedUserId, selectedSheetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  useEffect(() => {
    if (selectedGroupId) {
      fetchGroupMembers(selectedGroupId);
      loadGroupPermissions(selectedGroupId, selectedSheetId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroupId]);

  // ===== local toggles =====
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

  // ===== actions: users =====
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
    if (!selectedUserId || !selectedSheetId) return;
    const allowed_columns = Array.from(userAllowedCols);
    const row_filters = userFilterKey ? { [userFilterKey]: userFilterVal } : {};
    await axios.post(`${API}/permissions`, {
      sheetId: selectedSheetId, userId: selectedUserId, allowed_columns, row_filters
    }, { headers: { Authorization: `Bearer ${token}` }});
    alert("User permissions saved");
  };

  // ===== actions: groups =====
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
    if (!selectedGroupId || !selectedSheetId) return;
    const allowed_columns = Array.from(groupAllowedCols);
    const row_filters = groupFilterKey ? { [groupFilterKey]: groupFilterVal } : {};
    await axios.post(`${API}/group-permissions`, {
      sheetId: selectedSheetId, groupId: selectedGroupId, allowed_columns, row_filters
    }, { headers: { Authorization: `Bearer ${token}` }});
    alert("Group permissions saved");
  };

  // ===== helpers =====
  const userById = useMemo(() => {
    const m = new Map();
    users.forEach(u => m.set(u.id, u));
    return m;
  }, [users]);

  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* SHEET PICKER (permissions target) */}
      <div className="lg:col-span-3 flex items-end justify-between mb-1">
        <h2 className="text-xl font-bold">User Management</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Permissions for sheet:</span>
          <select
            className="border rounded p-2 min-w-[16rem]"
            value={selectedSheetId}
            onChange={e => setSelectedSheetId(e.target.value)}
          >
            {sheets.length ? (
              sheets.map(s => (
                <option key={s.id} value={s.id}>
                  {new Date(s.uploaded_at).toLocaleString()} — {s.filename} {s.folder_id ? `(folder ${s.folder_id})` : ""}
                </option>
              ))
            ) : (
              <option value="">(no sheets found)</option>
            )}
          </select>
        </div>
      </div>

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

        {/* user permissions */}
        {selectedUserId && (
          <div className="mt-4">
            <h4 className="font-semibold mb-2">
              User Permissions — sheet: {selectedSheetId || "—"}
            </h4>
            <div className="text-xs text-gray-500 mb-2">
              Select columns allowed for this user. Leave all unchecked to allow all.
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-auto border rounded p-2">
              {headers.map(h => (
                <label key={h} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={userAllowedCols.has(h)}
                    onChange={() => toggleUserAllowed(h)}
                  />
                  <span className="text-sm">{h}</span>
                </label>
              ))}
              {!headers.length && <div className="text-sm text-gray-500 p-1 col-span-full">(select a sheet above)</div>}
            </div>

            <div className="flex items-center gap-2 mt-3">
              <span className="text-sm">Row filter:</span>
              <select
                className="border rounded p-1"
                value={userFilterKey}
                onChange={e=>setUserFilterKey(e.target.value)}
                disabled={!headers.length}
              >
                <option value="">(none)</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <input
                className="border rounded p-1"
                placeholder="value"
                value={userFilterVal}
                onChange={e=>setUserFilterVal(e.target.value)}
                disabled={!headers.length}
              />
              <button
                className="bg-green-600 hover:bg-green-700 text-white rounded px-3 py-1 disabled:opacity-50"
                onClick={saveUserPermissions}
                disabled={!selectedSheetId}
              >
                Save
              </button>
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
              <div className="font-medium">{g.name}</div>
              <div className="text-xs text-gray-500">id: {g.id}</div>
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

      {/* GROUP PERMISSIONS PANEL */}
      <div className="bg-white border rounded-xl shadow p-4">
        <h3 className="font-bold text-lg mb-3">Group Permissions</h3>
        {selectedGroupId ? (
          <>
            <div className="text-sm text-gray-600 mb-2">
              For selected group (id: {selectedGroupId}) & sheet: {selectedSheetId || "—"}
            </div>

            <div className="text-xs text-gray-500 mb-1">
              Columns allowed (leave empty for all):
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-auto border rounded p-2">
              {headers.map(h => (
                <label key={h} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={groupAllowedCols.has(h)}
                    onChange={() => toggleGroupAllowed(h)}
                  />
                  <span className="text-sm">{h}</span>
                </label>
              ))}
              {!headers.length && <div className="text-sm text-gray-500 p-1 col-span-full">(select a sheet above)</div>}
            </div>

            <div className="flex items-center gap-2 mt-3">
              <span className="text-sm">Row filter:</span>
              <select
                className="border rounded p-1"
                value={groupFilterKey}
                onChange={e=>setGroupFilterKey(e.target.value)}
                disabled={!headers.length}
              >
                <option value="">(none)</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <input
                className="border rounded p-1"
                placeholder="value"
                value={groupFilterVal}
                onChange={e=>setGroupFilterVal(e.target.value)}
                disabled={!headers.length}
              />
              <button
                className="bg-green-600 hover:bg-green-700 text-white rounded px-3 py-1 disabled:opacity-50"
                onClick={saveGroupPermissions}
                disabled={!selectedSheetId}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <div className="text-gray-500">Select a group to edit permissions.</div>
        )}
      </div>
    </div>
  );
}

