import React from "react";

export default function UsersPanel({
    newUser, setNewUser,
    groups,
    addUser,
    user,
    uniqueUsers,
    selectedUserId, setSelectedUserId,
    deleteUser,
    setPendingResetUserId,
    setConfirmResetOpen,
    userById,
    // Permissions props
    userSheets,
    selectedUserSheetId, setSelectedUserSheetId,
    newTplNameUser, setNewTplNameUser,
    handleSaveTemplateFromUser,
    currentUserSheetGroupId,
    selectedTplUser,
    handleApplyTemplateToUser,
    visibleUserTemplates,
    handleDeleteTemplate,
    userSheetHeaders,
    userAllowedCols,
    toggleUserAllowed,
    saveUserPermissions,
    setUserAllowedCols,
    userRowFilters, setUserRowFilters,
    views,
    userViews,
    selectedUserSheetIdString, // Helper to match IDs
    handleToggleViewUserPermission,
    userDefaultViewId, setUserDefaultViewId,
    handleSaveDefaultView
}) {
    const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + "..." : s);

    return (
        <div className="bg-white border text-slate-700 rounded-2xl shadow-sm p-6 border-slate-200 h-full flex flex-col">
            <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2 border-b pb-2">
                <span className="text-xl">👥</span> Users
            </h3>

            {/* add user */}
            <div className="flex flex-col gap-3 mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Add New User</label>
                <input
                    className="border border-slate-200 rounded-lg px-3 h-8 text-xs"
                    placeholder="Email address"
                    value={newUser.email}
                    onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                />
                <input
                    className="border border-slate-200 rounded-lg px-3 h-8 text-xs"
                    placeholder="Password"
                    type="password"
                    value={newUser.password}
                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                />
                {user?.role !== "admin" && (
                    <select
                        className="border border-slate-200 rounded-lg px-3 h-8 text-xs bg-white"
                        value={newUser.groupId || ""}
                        onChange={e => setNewUser({ ...newUser, groupId: e.target.value })}
                    >
                        <option value="">Select Customer...</option>
                        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                )}
                <div className="flex items-center gap-2">
                    <select
                        className="border border-slate-200 rounded-lg px-3 h-8 text-xs bg-white flex-1"
                        value={newUser.role}
                        onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                        disabled={user?.role !== "admin"}
                    >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                    </select>
                    <button
                        className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-8 text-xs font-semibold shadow-sm"
                        onClick={addUser}
                    >
                        Add User
                    </button>
                </div>
            </div>

            {/* list users */}
            <div className="max-h-96 overflow-auto border border-slate-200 rounded-xl bg-white shadow-inner">
                {uniqueUsers.map((u) => (
                    <div
                        key={u.id}
                        className={`flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${selectedUserId === u.id ? "bg-blue-50 border-l-4 border-l-blue-500 pl-3" : "hover:bg-slate-50"}`}
                        onClick={() => setSelectedUserId(u.id)}
                    >
                        <div>
                            <div className="font-semibold text-slate-800 text-sm">{u.email}</div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mt-0.5">{u.role} • ID: {u.id}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-md transition-all"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingResetUserId(u.id);
                                    setConfirmResetOpen(true);
                                }}
                            >
                                Reset
                            </button>
                            <button
                                className="text-[10px] font-bold uppercase tracking-wider text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-all"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    deleteUser(u.id);
                                }}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* user permissions */}
            {selectedUserId && (
                <div className="mt-4">
                    <h4 className="font-semibold mb-2">
                        User Permissions — <span className="text-blue-600 font-bold">{userById.get(selectedUserId)?.email}</span>
                    </h4>

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

                    <div className="flex flex-wrap items-center gap-2 mb-3">
                        <input
                            className="border border-slate-200 rounded-lg px-3 h-8 text-xs"
                            placeholder="Template name"
                            value={newTplNameUser}
                            onChange={(e) => setNewTplNameUser(e.target.value)}
                        />
                        <button
                            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 h-8 text-xs font-semibold shadow-sm"
                            onClick={handleSaveTemplateFromUser}
                            disabled={!selectedUserSheetId || !currentUserSheetGroupId}
                        >
                            Save as Template
                        </button>
                        <select
                            className="border border-slate-200 rounded-lg px-3 h-8 text-xs bg-white"
                            value={selectedTplUser}
                            onChange={(e) => handleApplyTemplateToUser(e.target.value)}
                            disabled={!selectedUserSheetId || !currentUserSheetGroupId}
                        >
                            <option value="">Load template…</option>
                            {visibleUserTemplates.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                        <button
                            className={`border rounded-lg px-3 h-8 text-xs font-semibold transition-colors ${selectedTplUser ? "text-red-500 border-red-200 hover:bg-red-50" : "text-gray-300 border-gray-200"}`}
                            onClick={() => selectedTplUser && handleDeleteTemplate(selectedTplUser)}
                            disabled={!selectedTplUser}
                        >
                            Delete template
                        </button>
                    </div>

                    {selectedUserSheetId ? (
                        <>
                            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2">Select columns allowed for this user. Leave all unchecked to allow all.</div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-auto border rounded p-2">
                                {userSheetHeaders.map((h, i) => (
                                    <label key={`${h}-${i}`} className="flex items-center gap-2 min-w-0" title={h}>
                                        <input
                                            type="checkbox"
                                            checked={userAllowedCols.has(h)}
                                            onChange={() => toggleUserAllowed(h)}
                                            className="shrink-0"
                                        />
                                        <span className="text-xs font-medium text-slate-600 truncate">{h}</span>
                                    </label>
                                ))}
                            </div>
                            <div className="mt-2 flex gap-2">
                                <button
                                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-8 font-semibold text-xs flex-1 shadow-sm"
                                    onClick={saveUserPermissions}
                                >
                                    Save Column Permissions
                                </button>
                                <button
                                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg px-4 h-8 font-semibold text-xs flex-1 shadow-sm transition-colors"
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
                                            value={Array.isArray(filter.value) ? filter.value.join(", ") : filter.value}
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
                                        onChange={() => handleToggleViewUserPermission(v.id)}
                                    />
                                    <span className="text-xs font-medium text-slate-600">{v.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4">
                        <h5 className="font-semibold mb-2 text-sm text-slate-700">Default View</h5>
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
                                onClick={handleSaveDefaultView}
                            >
                                Save Default View
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
