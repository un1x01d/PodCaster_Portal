import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const OPS = [
  { v: "eq", label: "equals" },
  { v: "neq", label: "≠ equals" },
  { v: "contains", label: "contains" },
  { v: "in", label: "in (csv)" },
  { v: "notIn", label: "not in (csv)" },
  { v: "gte", label: "≥ gte (num/date)" },
  { v: "lte", label: "≤ lte (num/date)" },
];

export default function UserManagement({ token, sheetId }) {
  const [users, setUsers] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);

  // create user
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "producer" });

  // permissions state
  const [allowedMode, setAllowedMode] = useState("none"); // none | all | custom
  const [allowedColumns, setAllowedColumns] = useState([]); // used when custom
  const [rowRules, setRowRules] = useState([
    { col: "", op: "eq", val: "" }
  ]);

  // edit/reset password
  const [editingUserId, setEditingUserId] = useState(null);
  const [editRole, setEditRole] = useState("producer");
  const [editPassword, setEditPassword] = useState("");

  const auth = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);

  const refreshUsers = async () => {
    const resUsers = await axios.get(`${API}/users`, auth);
    setUsers(resUsers.data || []);
  };

  useEffect(() => {
    const load = async () => {
      await refreshUsers();
      let hdrs = [];
      if (sheetId) {
        const resSheet = await axios.get(`${API}/sheets/${sheetId}`, auth);
        hdrs = resSheet.data?.headers || [];
      } else {
        const resActive = await axios.get(`${API}/sheets/active`, auth);
        hdrs = resActive.data?.headers || [];
      }
      setHeaders(hdrs);
    };
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sheetId]);

  // load existing permissions for selected user
  useEffect(() => {
    const loadPerms = async () => {
      if (!selectedUserId || !sheetId) return;
      const res = await axios.get(
        `${API}/permissions?userId=${selectedUserId}&sheetId=${sheetId}`,
        auth
      );
      const perms = res.data || { allowed_columns: [], row_filters: {} };

      // columns
      if (Array.isArray(perms.allowed_columns) && perms.allowed_columns.includes("*")) {
        setAllowedMode("all");
        setAllowedColumns([]);
      } else if (Array.isArray(perms.allowed_columns) && perms.allowed_columns.length > 0) {
        setAllowedMode("custom");
        setAllowedColumns(perms.allowed_columns);
      } else {
        setAllowedMode("none");
        setAllowedColumns([]);
      }

      // rows: normalize to [{col, op, val}]
      const rf = perms.row_filters || {};
      const rules = Object.entries(rf).flatMap(([col, cond]) => {
        if (cond && typeof cond === "object" && !Array.isArray(cond)) {
          return Object.entries(cond).map(([op, val]) => ({
            col,
            op,
            val: Array.isArray(val) ? val.join(",") : String(val ?? "")
          }));
        }
        return [{ col, op: "eq", val: String(cond ?? "") }];
      });
      setRowRules(rules.length ? rules : [{ col: "", op: "eq", val: "" }]);

      // preload edit role
      const u = users.find((x) => x.id === selectedUserId);
      if (u) setEditRole(u.role || "producer");
    };
    loadPerms().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, sheetId]);

  // --- create user
  const createUser = async (e) => {
    e.preventDefault();
    await axios.post(`${API}/users`, newUser, auth);
    setNewUser({ email: "", password: "", role: "producer" });
    await refreshUsers();
  };

  // --- build payload + save permissions
  const savePermissions = async () => {
    if (!selectedUserId || !sheetId) {
      alert("Pick a user first.");
      return;
    }

    // columns
    let allowed_columns = [];
    if (allowedMode === "all") allowed_columns = ["*"];
    else if (allowedMode === "custom") allowed_columns = allowedColumns; // empty custom = deny all

    // rows
    const row_filters = {};
    for (const { col, op, val } of rowRules) {
      if (!col || val === "") continue;
      if (!row_filters[col]) row_filters[col] = {};
      if (op === "in" || op === "notIn") {
        row_filters[col][op] = val.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        row_filters[col][op] = val;
      }
    }
    // collapse single-op objects to scalar eq when appropriate for nicer display later
    for (const k of Object.keys(row_filters)) {
      const ops = Object.keys(row_filters[k]);
      if (ops.length === 1 && ops[0] === "eq") {
        row_filters[k] = row_filters[k].eq;
      }
    }

    try {
      await axios.post(
        `${API}/permissions`,
        { sheetId, userId: selectedUserId, allowed_columns, row_filters },
        auth
      );
      alert("✅ Permissions saved");
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      alert(`❌ Save failed: ${msg}`);
    }
  };

  // --- user edits
  const saveUserEdits = async (userId) => {
    if (!editPassword && !editRole) {
      alert("Nothing to update");
      return;
    }
    await axios.patch(
      `${API}/users/${userId}`,
      { password: editPassword || undefined, role: editRole || undefined },
      auth
    );
    setEditingUserId(null);
    setEditPassword("");
    await refreshUsers();
    alert("✅ User updated");
  };

  const resetPassword = async (userId) => {
    const res = await axios.patch(`${API}/users/${userId}`, { reset: true }, auth);
    const temp = res.data?.newPassword;
    await refreshUsers();
    alert(`✅ Temporary password: ${temp}`);
  };

  const deleteUser = async (userId) => {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    await axios.delete(`${API}/users/${userId}`, auth);
    if (selectedUserId === userId) {
      setSelectedUserId(null);
      setAllowedMode("none");
      setAllowedColumns([]);
      setRowRules([{ col: "", op: "eq", val: "" }]);
    }
    await refreshUsers();
    alert("🗑️ User deleted");
  };

  // UI helpers
  const addRule = () => setRowRules((p) => [...p, { col: "", op: "eq", val: "" }]);
  const removeRule = (idx) => setRowRules((p) => p.filter((_, i) => i !== idx));
  const setRule = (idx, patch) => setRowRules((p) => p.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">👤 User Management</h1>

      {/* Create user */}
      <form onSubmit={createUser} className="bg-white border rounded-lg p-4 flex flex-wrap gap-3 items-end">
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
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
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
                      <select className="border p-1 rounded" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
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
                        <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={() => saveUserEdits(u.id)}>
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
                        <button className="px-3 py-1 bg-red-600 text-white rounded" onClick={() => deleteUser(u.id)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="p-2 border">
                    <button
                      className={`px-3 py-1 rounded ${selectedUserId === u.id ? "bg-green-600 text-white" : "bg-gray-200"}`}
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
            {/* Column access mode */}
            <div className="mb-4">
              <div className="font-semibold mb-1">Column Access</div>
              <div className="flex gap-4 items-center">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="allowedMode"
                    value="none"
                    checked={allowedMode === "none"}
                    onChange={() => setAllowedMode("none")}
                  />
                  <span>None (default-deny)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="allowedMode"
                    value="all"
                    checked={allowedMode === "all"}
                    onChange={() => setAllowedMode("all")}
                  />
                  <span>All columns</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="allowedMode"
                    value="custom"
                    checked={allowedMode === "custom"}
                    onChange={() => setAllowedMode("custom")}
                  />
                  <span>Custom</span>
                </label>
              </div>
              {allowedMode === "custom" && (
                <div className="mt-3">
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
              )}
            </div>

            {/* Row filters with ops */}
            <div className="mb-4">
              <div className="font-semibold mb-2">Row Filters (AND)</div>
              {rowRules.map((r, idx) => (
                <div key={idx} className="flex flex-wrap gap-2 mb-2">
                  <select
                    className="border p-2 rounded w-56"
                    value={r.col}
                    onChange={(e) => setRule(idx, { col: e.target.value })}
                  >
                    <option value="">-- Column --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>

                  <select
                    className="border p-2 rounded w-44"
                    value={r.op}
                    onChange={(e) => setRule(idx, { op: e.target.value })}
                  >
                    {OPS.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  <input
                    className="border p-2 rounded w-72"
                    placeholder={r.op === "in" || r.op === "notIn" ? "a, b, c" : "value"}
                    value={r.val}
                    onChange={(e) => setRule(idx, { val: e.target.value })}
                  />

                  <button className="px-3 py-2 bg-gray-200 rounded" onClick={() => removeRule(idx)}>
                    Remove
                  </button>
                </div>
              ))}
              <button className="px-3 py-2 bg-gray-200 rounded" onClick={addRule}>
                + Add Filter
              </button>
              <p className="text-xs text-gray-500 mt-1">
                Notes: <code>in/notIn</code> take comma-separated values. <code>gte/lte</code> work for numbers or ISO dates.
              </p>
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

