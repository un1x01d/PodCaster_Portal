import React from "react";

export default function GroupsPanel({
    groups,
    newGroupName, setNewGroupName,
    createGroup,
    selectedGroupId, setSelectedGroupId,
    groupMembers,
    groupAddUserId, setGroupAddUserId,
    uniqueUsers,
    uniqueGroupMembers,
    addUserToGroup,
    removeUserFromGroup,
    deleteGroup,
    user,
    setPendingAdminChange,
    setConfirmAdminOpen,
    setPendingResetUserId,
    setConfirmResetOpen
}) {
    return (
        <div className="bg-white border text-slate-700 rounded-2xl shadow-sm p-6 border-slate-200 h-full flex flex-col">
            <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2 border-b pb-2">
                <span className="text-xl">🏢</span> Groups
            </h3>

            {user?.role === "admin" && (
                <div className="flex gap-2 mb-4">
                    <input
                        className="border border-slate-200 rounded-lg px-3 h-9 text-sm flex-1 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none"
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
            )}

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
                                <div className="flex gap-2 items-center mt-0.5">
                                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">ID: {g.id}</div>
                                    <div className="text-[10px] uppercase tracking-wider text-blue-400 font-bold border-l pl-2 border-slate-100">Limit: {g.max_file_size_mb || 100}MB</div>
                                </div>
                            </div>
                            {user?.role === "admin" && (
                                <button
                                    className="text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-all border border-transparent hover:border-red-100"
                                    onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}
                                >
                                    Delete
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {selectedGroupId && (
                <div className="mt-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="font-bold text-sm text-slate-700 uppercase tracking-wider">Settings</h4>
                    </div>
                    {user?.role === "admin" && (
                        <div className="flex flex-col gap-2 mb-4">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Max File Size (MB):</label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    className="border border-slate-200 rounded-lg px-3 h-9 text-sm w-32 focus:ring-2 focus:ring-blue-100 outline-none bg-white"
                                    defaultValue={groups.find(g => g.id === selectedGroupId)?.max_file_size_mb || 100}
                                    onBlur={(e) => {
                                        const val = parseInt(e.target.value, 10);
                                        if (!isNaN(val)) {
                                            // Trigger updating the group (handleUpdateGroup needs to be passed down)
                                            if (window.confirm(`Update ${groups.find(g => g.id === selectedGroupId)?.name} limit to ${val}MB?`)) {
                                                if (typeof updateGroup === 'function') {
                                                    updateGroup(selectedGroupId, { maxFileSizeMb: val });
                                                }
                                            }
                                        }
                                    }}
                                />
                                <span className="text-xs text-slate-400 self-center">MB</span>
                            </div>
                        </div>
                    )}
                    <h4 className="font-bold text-sm text-slate-700 mb-2 uppercase tracking-wider border-t pt-3 mt-1">Members</h4>
                    <div className="flex gap-2 mb-3">
                        <select
                            className="border border-slate-200 rounded-lg px-2 h-9 flex-1 text-sm bg-white"
                            value={groupAddUserId}
                            onChange={e => setGroupAddUserId(e.target.value)}
                        >
                            <option value="">Select user…</option>
                            {uniqueUsers
                                .filter(u => !uniqueGroupMembers.some(m => String(m.id) === String(u.id)))
                                .map(u => <option key={String(u.id)} value={u.id}>{u.email}</option>)
                            }
                        </select>
                        <button
                            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 h-9 text-sm font-medium shadow-sm"
                            onClick={addUserToGroup}
                        >
                            Add
                        </button>
                    </div>

                    <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                        {uniqueGroupMembers.length > 0 ? (
                            uniqueGroupMembers.map(m => (
                                <div key={String(m.id)} className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                                    <div className="text-xs font-medium text-slate-700 flex items-center gap-2 flex-grow min-w-0">
                                        <span className="truncate" title={m.email}>{m.email}</span>
                                        {m.is_admin && (
                                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">
                                                ADMIN
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-2 items-center flex-shrink-0">
                                        {user?.role === "admin" && (
                                            <label className="flex items-center text-[10px] gap-1 cursor-pointer select-none text-slate-500 hover:text-blue-600 mr-1">
                                                <input
                                                    type="checkbox"
                                                    checked={!!m.is_admin}
                                                    onChange={() => {
                                                        setPendingAdminChange({ gid: selectedGroupId, uid: m.id, currentStatus: !!m.is_admin });
                                                        setConfirmAdminOpen(true);
                                                    }}
                                                    className="accent-blue-600"
                                                />
                                                Admin
                                            </label>
                                        )}
                                        <button
                                            className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2.5 py-1 rounded-md transition-all border border-transparent hover:border-blue-100"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setPendingResetUserId(m.id);
                                                setConfirmResetOpen(true);
                                            }}
                                        >
                                            Reset
                                        </button>
                                        <button
                                            className="text-[10px] font-bold uppercase tracking-wider text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-md transition-all border border-transparent hover:border-red-100"
                                            onClick={() => removeUserFromGroup(m.id)}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-xs text-slate-400 p-3 italic text-center">No members yet.</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
