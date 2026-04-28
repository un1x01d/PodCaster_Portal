import React, { useState } from "react";

export default function FoldersPanel({
    folders,
    newFolderName, setNewFolderName,
    folderGroupId, setFolderGroupId,
    createFolder,
    deleteFolder,
    groups,
    selectedGroupId,
    user
}) {
    if (user?.role !== "admin") return null;

    return (
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
                {folders.filter(f => !selectedGroupId || f.group_id === selectedGroupId).map((f) => (
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
            </div>
        </div>
    );
}
