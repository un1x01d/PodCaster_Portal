export async function updateAutosyncSourceState({ query, sourceId, values = {} }) {
  const assignments = [];
  const params = [sourceId];
  let idx = 2;
  const push = (column, value) => {
    assignments.push(`${column} = $${idx}`);
    params.push(value);
    idx += 1;
  };
  if (Object.prototype.hasOwnProperty.call(values, "sync_last_error")) push("sync_last_error", values.sync_last_error);
  if (Object.prototype.hasOwnProperty.call(values, "sync_remote_marker")) push("sync_remote_marker", values.sync_remote_marker);
  if (Object.prototype.hasOwnProperty.call(values, "sync_last_attempted_marker")) push("sync_last_attempted_marker", values.sync_last_attempted_marker);
  if (Object.prototype.hasOwnProperty.call(values, "sync_remote_modified_at")) push("sync_remote_modified_at", values.sync_remote_modified_at);
  if (Object.prototype.hasOwnProperty.call(values, "sync_last_checked_at")) push("sync_last_checked_at", values.sync_last_checked_at);
  if (Object.prototype.hasOwnProperty.call(values, "sync_display_name")) push("sync_display_name", values.sync_display_name);
  if (Object.prototype.hasOwnProperty.call(values, "sync_file_label")) push("sync_file_label", values.sync_file_label);
  if (Object.prototype.hasOwnProperty.call(values, "sync_provider")) push("sync_provider", values.sync_provider);
  if (Object.prototype.hasOwnProperty.call(values, "sync_source_ref")) push("sync_source_ref", values.sync_source_ref);
  if (Object.prototype.hasOwnProperty.call(values, "sync_group_id")) push("sync_group_id", values.sync_group_id);
  if (Object.prototype.hasOwnProperty.call(values, "sync_user_id")) push("sync_user_id", values.sync_user_id);
  if (!assignments.length) return;
  await query(
    `UPDATE report_sources
        SET ${assignments.join(", ")},
            sync_updated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    params
  );
}

export async function processAutosyncReportSource({
  source,
  parsePositiveIntLike,
  fetchProviderAutosyncMetadata,
  downloadProviderAutosyncFile,
  importDbQueueEnabled,
  enqueueDbImportJob,
  parseWorkbookBufferOrThrow,
  executeImportFromParsedWorkbook,
  randomUUID,
  updateState,
}) {
  const provider = String(source?.sync_provider || "").trim().toLowerCase();
  const sourceRef = String(source?.sync_source_ref || "").trim();
  const groupId = parsePositiveIntLike(source?.sync_group_id);
  const userId = parsePositiveIntLike(source?.sync_user_id);
  if (!provider || !sourceRef || !userId) return;

  const remoteMeta = await fetchProviderAutosyncMetadata({ provider, groupId, userId, sourceRef });
  if (!remoteMeta?.remoteMarker) {
    await updateState(source.id, {
      sync_last_error: "autosync_remote_marker_missing",
      sync_last_checked_at: new Date().toISOString(),
    });
    return;
  }

  const currentMarker = String(source.sync_remote_marker || "").trim();
  const lastAttemptedMarker = String(source.sync_last_attempted_marker || "").trim();

  if (!currentMarker && !lastAttemptedMarker) {
    await updateState(source.id, {
      sync_remote_marker: remoteMeta.remoteMarker,
      sync_last_attempted_marker: remoteMeta.remoteMarker,
      sync_remote_modified_at: remoteMeta.remoteModifiedAt || null,
      sync_last_error: null,
      sync_last_checked_at: new Date().toISOString(),
    });
    return;
  }

  if (remoteMeta.remoteMarker === currentMarker || remoteMeta.remoteMarker === lastAttemptedMarker) {
    return;
  }

  const displayName = String(source.sync_display_name || source.name || remoteMeta.originalName || "Report source").trim();
  const fileLabel = String(source.sync_file_label || source.name || displayName || "File").trim();
  const downloaded = await downloadProviderAutosyncFile({ provider, groupId, userId, sourceRef });

  if (importDbQueueEnabled) {
    const importJobId = randomUUID();
    await enqueueDbImportJob({
      user: { id: userId, role: "admin" },
      approvalRequired: false,
      importJobId,
      originalName: downloaded.originalName || remoteMeta.originalName || `${displayName}.xlsx`,
      displayName,
      fileLabel,
      rawReportSourceId: String(source.id),
      rawReportSourceName: source.name || displayName,
      fileBuffer: downloaded.buffer,
      contentType: downloaded.mimeType || "application/octet-stream",
      fileSize: downloaded.buffer.length || 0,
      parseMemoryLimitMb: null,
      autosyncConfig: {
        enabled: true,
        provider,
        sourceRef,
        groupId,
        userId,
        remoteMarker: remoteMeta.remoteMarker,
        remoteModifiedAt: remoteMeta.remoteModifiedAt,
        displayName,
        fileLabel,
      },
      mode: "autosync",
      enforceOwnership: false,
    });
    await updateState(source.id, {
      sync_last_attempted_marker: remoteMeta.remoteMarker,
      sync_remote_modified_at: remoteMeta.remoteModifiedAt || null,
      sync_last_error: null,
      sync_last_checked_at: new Date().toISOString(),
      sync_display_name: displayName,
      sync_file_label: fileLabel,
      sync_provider: provider,
      sync_source_ref: sourceRef,
      sync_group_id: groupId,
      sync_user_id: userId,
    });
    return;
  }

  const parsedResult = await parseWorkbookBufferOrThrow(downloaded.buffer, { memoryLimitMb: null });
  await executeImportFromParsedWorkbook({
    parsedResult,
    approvalRequired: false,
    importJobId: randomUUID(),
    reportSourceId: source.id,
    reportSourceName: source.name || displayName,
    displayName,
    fileLabel,
    originalName: downloaded.originalName || remoteMeta.originalName || `${displayName}.xlsx`,
    user: { id: userId, role: "admin" },
    enforceOwnership: false,
    fileSizeBytes: Number(downloaded?.size || downloaded?.buffer?.length || 0),
    autosyncConfig: {
      enabled: true,
      provider,
      sourceRef,
      groupId,
      userId,
      remoteMarker: remoteMeta.remoteMarker,
      remoteModifiedAt: remoteMeta.remoteModifiedAt,
      displayName,
      fileLabel,
    },
    classificationSourceKind: "autosync",
  });
}

export async function processAutosyncSourcesForCurrentDb({
  ownerId,
  ensureReportSourcesSchema,
  claimAutosyncReportSources,
  processSource,
  updateState,
}) {
  await ensureReportSourcesSchema();
  const sources = await claimAutosyncReportSources(ownerId);
  if (!sources.length) return false;
  let claimedAny = false;
  for (const source of sources) {
    claimedAny = true;
    try {
      await processSource(source);
    } catch (err) {
      console.error(`[autosync_worker] source=${source.id} failed:`, err?.message || err);
      await updateState(source.id, {
        sync_last_error: String(err?.message || "autosync_failed").slice(0, 500),
        sync_last_checked_at: new Date().toISOString(),
      });
    }
  }
  return claimedAny;
}
