import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function UserManagement({ token, sheetId }) {
  const [users, setUsers] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);

  // create user form
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    role: "producer",
  });

  // permission form state for selected user
  const [allowedColumns, setAllowedColumns] = useState([]);
  const [rowFiltersKV, setRowFiltersKV] = useState([{ col: "", val: "" }]);

  // edit/reset password UI state
  const [editingUserId, setEditingUserId] = useState(null);
  const [editRole, setEditRole] = useState("producer");
  const [editPassword, setEditPassword] = useState("");

  const auth = useMemo(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  const refreshUsers = async () => {
    const resUsers = await axios.get(`${API}/users`, auth);
    setUsers(resUsers.data || []);
  };

  // load users and sheet headers
  useEffect(() => {
    const load = async () => {
      await refreshUsers();
      if (sheetId) {
        const resSheet = await axios.get(`${API}/sheets/${sheetId}`, auth);
        setHeaders(resSheet.data?.headers || []);
      } else {
        const resActive = await axios.get(`${API}/sheets/active`, auth);
        setHeaders(resActive.data?.headers || []);
      }
    };
    load().catch(console.error);
  }, [API, token, sheetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // load existing permissions when selecting a user
  useEffect(() => {
    const loadPerms = async () => {
      if (!selectedUserId || !sheetId) return;
      const res = await axios.get(
        `${API}/permissions?userId=${selectedUserId}&sheetId=${sheetId}`,
        auth
      );
      const perms = res.data || { allowed_columns: [], row_filters: {} };
      setAllowedColumns(perms.allowed_columns || []);
      const kv = Object.entries(perms.row_filters || {}).map(([col, val]) => ({
        col,
        val: String(val),
      }));
      setRowFiltersKV(kv.length ? kv : [{ col: "", val: "" }]);

      // preload edit role from current user row
      const u = users.find((x) => x.id === selectedUserId);
      if (u) setEditRole(u.role || "producer");
    };
    loadPerms().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, sheetId]);

  const createUser = async (e) => {
    e.preventDefault();
    await axios.post(`${API}/users`, newUser, auth);
    setNewUser({ email: "", password: "", role: "producer" });
    await refreshUsers();
  };

  const savePermissions = async () => {
    if (!selectedUserId || !sheetId) {
      alert("Pick a user first.");
      return;
    }
    const row_filters = {};
    rowFiltersKV.forEach(({ col, val }) => {
      if (col && val !== "") row_filters[col] = val;
    });

    await axios.post(
      `${API}/permissions`,
      {
        sheetId,
        userId: selectedUserId,
        allowed_columns: allowedColumns,
        row_filters,
      },
      auth
    );
    alert("✅ Permissions saved");
  };

  // edit password and/or role
  const saveUserEdits = async (userId) => {
    if (!editPassword && !editRole) {
      alert("Nothing to update");
      return;
    }
    await axios.patch(
      `${API}/users/${userId}`,
      {
        password: editPassword || undefined,
        role: editRole || undefined,
      },
      auth
    );
    setEditingUserId(null);
    setEditPassword("");
    await refreshUsers();
    alert("✅ User updated");
  };

  // reset to a generated temp password (returned by backend)
  const resetPassword = async (userId) => {
    const res = await axios.patch(
      `${API}/users/${userId}`,
      { reset: true },
      auth
    );
    const temp = res.data?.newPassword;
    await refreshUsers();
    alert(`✅ Temporary password: ${temp}`);
  };

  const deleteUser = async (userId) => {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    await axios.delete(`${API}/users/${userId}`, auth);
    if (selectedUserId === userId) {
      setSelectedUserId(null);
      setAllowedColumns([]);
      setRowFiltersKV([{ col: "", val: "" }]);
    }
    await refreshUsers();
    alert("🗑️ User deleted");
  };

  const addFilterRow = () => setRowFiltersKV((prev) => [...prev, { col: "", val: "" }]);
  const removeFilterRow = (idx) => setRowFiltersKV((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">👤 User Management</h1>

      {/* Create user */}
      <form
        onSubmit={createUser}
        className="bg-white border rounded-lg p-4 flex flex-wrap gap-3 items-end"
      >
        <div>
          <label className="block text-sm font-semibold">Email</label>
          <input
            className="border p-2 rounded w-64"
            value={newUser.email}
            onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
            required
            type="email"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold">Password</label>
          <input
            className="border p-2 rounded w-48"
            value={newUser.password}
            onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
            required
            type="password"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold">Role</label>
          <select
            className="border p-2 rounded w-40"
            value={newUser.role}
            onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))}
          >
            <option value="producer">producer</option>
            <option value="admin">admin</option>
            <option value="client">client</option>
            <option value="lawyer">lawyer</option>
          </select>
        </div>
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
        >
          Add User
        </button>
      </form>

      {/* Users table */}
      <div className="bg-white border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Users</h2>
        <table className="table-auto w-full text-sm border">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 border">ID</th>
              <th className="p-2 border">Email</th>
              <th className="p-2 border">Role</th>
              <th className="p-2 border">Actions</th>
              <th className="p-2 border">Select for Permissions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isEditing = editingUserId === u.id;
              return (
                <tr key={u.id} className="odd:bg-gray-50 align-top">
                  <td className="p-2 border">{u.id}</td>
                  <td className="p-2 border">{u.email}</td>
                  <td className="p-2 border">
                    {isEditing ? (
                      <select
                        className="border p-1 rounded"
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value)}
                      >
                        <option value="producer">producer</option>
                        <option value="admin">admin</option>
                        <option value="client">client</option>
                        <option value="lawyer">lawyer</option>
                      </select>
                    ) : (
                      u.role
                    )}
                  </td>
                  <td className="p-2 border">
                    {isEditing ? (
                      <div className="flex gap-2 items-center">
                        <input
                          type="password"
                          placeholder="New password (optional)"
                          className="border p-1 rounded"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                        />
                        <button
                          className="px-3 py-1 bg-green-600 text-white rounded"
                          onClick={() => saveUserEdits(u.id)}
                        >
                          Save
                        </button>
                        <button
                          className="px-3 py-1 bg-gray-300 rounded"
                          onClick={() => {
                            setEditingUserId(null);
                            setEditPassword("");
                            setEditRole(u.role || "producer");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="px-3 py-1 bg-blue-600 text-white rounded"
                          onClick={() => {
                            setEditingUserId(u.id);
                            setEditPassword("");
                            setEditRole(u.role || "producer");
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="px-3 py-1 bg-amber-500 text-white rounded"
                          onClick={() => resetPassword(u.id)}
                          title="Reset to temporary password"
                        >
                          Reset Pass
                        </button>
                        <button
                          className="px-3 py-1 bg-red-600 text-white rounded"
                          onClick={() => deleteUser(u.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="p-2 border">
                    <button
                      className={`px-3 py-1 rounded ${
                        selectedUserId === u.id ? "bg-green-600 text-white" : "bg-gray-200"
                      }`}
                      onClick={() => setSelectedUserId(u.id)}
                    >
                      {selectedUserId === u.id ? "Selected" : "Select"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!users.length && (
              <tr>
                <td className="p-2 text-gray-500" colSpan={5}>
                  No users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Permissions editor */}
      <div className="bg-white border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Permissions</h2>
        {!selectedUserId ? (
          <p className="text-gray-500">Select a user above.</p>
        ) : (
          <>
            {/* Allowed columns */}
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">
                Allowed Columns (multi-select)
              </label>
              <select
                multiple
                className="border p-2 rounded w-full h-40"
                value={allowedColumns}
                onChange={(e) =>
                  setAllowedColumns([...e.target.selectedOptions].map((o) => o.value))
                }
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple.</p>
            </div>

            {/* Row filters */}
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-2">
                Row Filters (Column = Value)
              </label>
              {rowFiltersKV.map((kv, idx) => (
                <div key={idx} className="flex gap-2 mb-2">
                  <select
                    className="border p-2 rounded w-64"
                    value={kv.col}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRowFiltersKV((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, col: v } : x))
                      );
                    }}
                  >
                    <option value="">-- Column --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <input
                    className="border p-2 rounded w-64"
                    placeholder="Value"
                    value={kv.val}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRowFiltersKV((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, val: v } : x))
                      );
                    }}
                  />
                  <button className="px-3 py-2 bg-gray-200 rounded" onClick={() => removeFilterRow(idx)}>
                    Remove
                  </button>
                </div>
              ))}
              <button className="px-3 py-2 bg-gray-200 rounded" onClick={addFilterRow}>
                + Add Filter
              </button>
            </div>

            <button
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg"
              onClick={savePermissions}
            >
              Save Permissions
            </button>
          </>
        )}
      </div>
    </div>
  );
}

