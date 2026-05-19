export async function createImportJob(client, { id, mode, status = "running", stage = "processing", requestedBy, originalFilename, reportSourceId = null, maxAttempts = 3 }) {
  await client.query(
    `INSERT INTO import_jobs
        (id, status, mode, stage, requested_by, report_source_id, original_filename, started_at, updated_at, max_attempts, attempts, next_attempt_at, lease_owner, lease_expires_at, error)
     VALUES
        ($1, $2, $3, $4, $5, $6, $7,
         CASE WHEN $2 = 'running' THEN CURRENT_TIMESTAMP ELSE NULL END,
         CURRENT_TIMESTAMP, GREATEST($8, 1), CASE WHEN $2 = 'running' THEN 1 ELSE 0 END,
         NULL, NULL, NULL, NULL)
     ON CONFLICT (id)
     DO UPDATE SET status = EXCLUDED.status,
                   mode = EXCLUDED.mode,
                   stage = EXCLUDED.stage,
                   requested_by = COALESCE(EXCLUDED.requested_by, import_jobs.requested_by),
                   report_source_id = COALESCE(EXCLUDED.report_source_id, import_jobs.report_source_id),
                   original_filename = COALESCE(EXCLUDED.original_filename, import_jobs.original_filename),
                   started_at = CASE
                       WHEN EXCLUDED.status = 'running' THEN COALESCE(import_jobs.started_at, CURRENT_TIMESTAMP)
                       ELSE import_jobs.started_at
                   END,
                   attempts = CASE
                       WHEN EXCLUDED.status = 'running' THEN GREATEST(import_jobs.attempts, 1)
                       ELSE import_jobs.attempts
                   END,
                   max_attempts = GREATEST(COALESCE(EXCLUDED.max_attempts, import_jobs.max_attempts, 1), 1),
                   next_attempt_at = NULL,
                   lease_owner = NULL,
                   lease_expires_at = NULL,
                   error = NULL,
                   updated_at = CURRENT_TIMESTAMP`,
    [id, status, mode, stage, requestedBy || null, reportSourceId, originalFilename || null, maxAttempts]
  );
}

export async function finishImportJob(client, { id, status, reportSourceId, sheetId, importId, result, error }) {
  await client.query(
    `UPDATE import_jobs
        SET status = $2,
            stage = $3,
            report_source_id = $4,
            sheet_id = $5,
            import_id = $6,
            result = $7::jsonb,
            error = $8,
            finished_at = CURRENT_TIMESTAMP,
            lease_owner = NULL,
            lease_expires_at = NULL,
            next_attempt_at = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [
      id,
      status,
      status,
      reportSourceId || null,
      sheetId || null,
      importId || null,
      JSON.stringify(result || {}),
      error || null,
    ]
  );
}

export async function claimNextImportJob({ getClient, ownerId, leaseMs }) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `WITH candidate AS (
            SELECT id
            FROM import_jobs
            WHERE status IN ('queued', 'retryable')
              AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
              AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE import_jobs ij
           SET status = 'running',
               stage = 'processing',
               started_at = COALESCE(ij.started_at, CURRENT_TIMESTAMP),
               attempts = COALESCE(ij.attempts, 0) + 1,
               lease_owner = $1,
               lease_expires_at = CURRENT_TIMESTAMP + (($2 || ' milliseconds')::interval),
               error = NULL,
               updated_at = CURRENT_TIMESTAMP
          FROM candidate c
         WHERE ij.id = c.id
     RETURNING ij.id, ij.mode, ij.status, ij.stage, ij.requested_by, ij.report_source_id, ij.original_filename,
               ij.attempts, ij.max_attempts`,
      [ownerId, String(leaseMs)]
    );
    await client.query("COMMIT");
    return claimed.rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function markImportJobRetryable({ query, id, attempts, maxAttempts, error, maxDefaultAttempts, isRetryableImportError, jobBackoffMs }) {
  const exhausted = Number(attempts || 0) >= Number(maxAttempts || maxDefaultAttempts);
  if (exhausted || !isRetryableImportError(error)) {
    await query(
      `UPDATE import_jobs
            SET status = 'failed',
                stage = 'failed',
                error = $2,
                finished_at = CURRENT_TIMESTAMP,
                lease_owner = NULL,
                lease_expires_at = NULL,
                next_attempt_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
      [id, String(error?.message || "import_failed").slice(0, 500)]
    );
    await query("DELETE FROM import_job_payloads WHERE job_id = $1", [id]);
    return "failed";
  }

  const delayMs = jobBackoffMs(attempts);
  await query(
    `UPDATE import_jobs
        SET status = 'retryable',
            stage = 'queued',
            error = $2,
            next_attempt_at = CURRENT_TIMESTAMP + (($3 || ' milliseconds')::interval),
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [id, String(error?.message || "import_retryable_failure").slice(0, 500), String(delayMs)]
  );
  return "retryable";
}
