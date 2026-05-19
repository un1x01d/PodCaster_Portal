export async function processNextImportJob({
  ownerId,
  claimNextImportJob,
  getClient,
  leaseMs,
  query,
  executeQueuedImportJob,
  markImportJobRetryable,
  maxDefaultAttempts,
  isRetryableImportError,
  jobBackoffMs,
  parseJsonMaybe,
  writeAuditLog,
}) {
  const job = await claimNextImportJob({ getClient, ownerId, leaseMs });
  if (!job) return false;

  const payloadRows = await query(
    `SELECT file_bytes, payload_meta, byte_size
       FROM import_job_payloads
      WHERE job_id = $1
      LIMIT 1`,
    [job.id]
  );

  try {
    await executeQueuedImportJob(job, payloadRows);
  } catch (err) {
    const outcome = await markImportJobRetryable({
      query,
      id: job.id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      error: err,
      maxDefaultAttempts,
      isRetryableImportError,
      jobBackoffMs,
    });

    if (outcome === "failed") {
      console.error(`[import_worker] job=${job.id} failed:`, err?.message || err);
      const payloadMeta = parseJsonMaybe(payloadRows?.[0]?.payload_meta, {}) || {};
      if (String(job.mode || "").toLowerCase() === "autosync" && job.report_source_id && payloadMeta.autosyncEnabled) {
        await query(
          `UPDATE report_sources
              SET sync_last_error = $2,
                  sync_last_checked_at = CURRENT_TIMESTAMP,
                  sync_updated_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [job.report_source_id, String(err?.message || "autosync_failed").slice(0, 500)]
        );
      }
      await writeAuditLog({
        actorUserId: job.requested_by || null,
        action: "import.failed",
        resourceType: "import_job",
        resourceId: job.id,
        metadata: {
          attempts: job.attempts,
          max_attempts: job.max_attempts,
          error: String(err?.message || "import_failed").slice(0, 500),
        },
      });
    } else {
      console.warn(`[import_worker] job=${job.id} retry scheduled`);
    }
  }
  return true;
}

export async function processImportJobsForCurrentDb({
  ownerId,
  query,
  processNextImportJob,
  maxClaimsPerTick,
  setImportWorkerQueueDepth,
  setImportWorkerActiveJobs,
}) {
  try {
    const qRows = await query(
      `SELECT
          COUNT(*) FILTER (WHERE status IN ('queued','retryable'))::int AS queued_depth,
          COUNT(*) FILTER (WHERE status = 'running')::int AS active_jobs
       FROM import_jobs`,
      []
    );
    const queuedDepth = Number(qRows?.[0]?.queued_depth || 0);
    const activeJobs = Number(qRows?.[0]?.active_jobs || 0);
    setImportWorkerQueueDepth(queuedDepth);
    setImportWorkerActiveJobs(activeJobs);
  } catch {
    // no-op metrics fallback
  }

  let claimedAny = false;
  for (let i = 0; i < maxClaimsPerTick; i += 1) {
    const didWork = await processNextImportJob(ownerId);
    if (!didWork) break;
    claimedAny = true;
  }

  if (claimedAny) {
    await query(
      `DELETE FROM import_job_payloads p
        USING import_jobs j
       WHERE p.job_id = j.id
         AND p.expires_at IS NOT NULL
         AND p.expires_at <= CURRENT_TIMESTAMP
         AND j.status IN ('published', 'pending_approval', 'rejected', 'failed')`
    );
  }
  return claimedAny;
}

export async function loadAutosyncPollIntervalMs({ query, key, defaultMs }) {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key]);
    const rawMinutes = Number.parseInt(rows?.[0]?.value?.intervalMinutes ?? rows?.[0]?.value?.pollMinutes ?? rows?.[0]?.value?.minutes, 10);
    const minutes = Number.isFinite(rawMinutes) ? Math.min(1440, Math.max(1, rawMinutes)) : null;
    return minutes ? minutes * 60 * 1000 : defaultMs;
  } catch (err) {
    console.error("[autosync_worker] failed to load interval setting:", err?.message || err);
    return defaultMs;
  }
}

export async function claimAutosyncReportSources({ getClient, maxClaimsPerTick, recheckMs }) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `WITH candidate AS (
          SELECT id
            FROM report_sources
           WHERE sync_enabled = TRUE
             AND sync_provider IN ('google_drive', 'dropbox', 'onedrive')
             AND sync_source_ref IS NOT NULL
             AND sync_user_id IS NOT NULL
             AND (sync_last_checked_at IS NULL OR sync_last_checked_at <= CURRENT_TIMESTAMP - (($2 || ' milliseconds')::interval))
           ORDER BY COALESCE(sync_last_checked_at, created_at) ASC, id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $1
      )
      UPDATE report_sources rs
         SET sync_last_checked_at = CURRENT_TIMESTAMP,
             sync_updated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
        FROM candidate c
       WHERE rs.id = c.id
   RETURNING rs.id, rs.name, rs.sync_provider, rs.sync_source_ref, rs.sync_group_id,
             rs.sync_user_id, rs.sync_display_name, rs.sync_file_label, rs.sync_remote_marker,
             rs.sync_last_attempted_marker, rs.sync_remote_modified_at, rs.sync_last_error`,
      [maxClaimsPerTick, String(recheckMs)]
    );
    await client.query("COMMIT");
    return claimed.rows || [];
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
