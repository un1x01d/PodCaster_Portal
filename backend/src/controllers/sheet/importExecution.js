export function createImportExecution(deps) {
    const {
        MAX_UPLOAD_SHEETS,
        MAX_UPLOAD_COLUMNS,
        MAX_UPLOAD_ROWS_PER_SHEET,
        MAX_UPLOAD_TOTAL_ROWS,
        IMPORT_STAGING_FINALIZE_ENABLED,
        toImportError,
        getClient,
        resolveReportSourceForUpload,
        loadReportSourceForImport,
        resolveImportGroupId,
        loadDlpSettings,
        isPlatformAdminUser,
        groupHasFeature,
        scanRowsForDlpInWorker,
        writeAuditLog,
        applyDlpColumnMasking,
        loadSemanticProfileRules,
        buildSheetSemanticProfile,
        maybeEnrichSheetSemanticProfileWithAi,
        evaluateAiChatCompatibilityForImport,
        canApproveWithMaskedDlp,
        AI_CHAT_COMPATIBILITY_ENFORCE_IMPORT,
        getVersionedFilename,
        buildHeaderDiff,
        getSchemaStatus,
        resolveReviewPolicy,
        normalizeSheetRow,
        buildInsightSummaryRows,
        carryForwardSourceSecurity,
        applyReportSourceAutosyncConfig,
        finishImportJob,
        carryForwardBusinessClassificationIfPrompted,
        classifyAndPersistBusinessContext,
    } = deps;

    return async function executeImportFromParsedWorkbook({
        parsedResult,
        approvalRequired,
        importJobId,
        reportSourceId,
        reportSourceName,
        displayName,
        fileLabel,
        originalName,
        user,
        enforceOwnership = true,
        autosyncConfig = null,
        fileSizeBytes = 0,
        classificationSourceKind = "manual_upload",
        stagedSourceJobId = null,
    }) {
        const { sheetNames, sheets: parsedSheets, cleanup } = parsedResult || {};
        let sheets = parsedSheets;
        let dlpOutcome = null;
        if (cleanup && (cleanup.formulasStripped || cleanup.metadataEntriesStripped)) {
            console.info(
                `[upload_cleanup] formulas_stripped=${Number(cleanup.formulasStripped || 0)} metadata_entries_stripped=${Number(cleanup.metadataEntriesStripped || 0)}`
            );
        }
        if (!sheetNames || sheetNames.length === 0) {
            throw toImportError("no_sheets", 400);
        }
        if (sheetNames.length > MAX_UPLOAD_SHEETS) {
            const err = toImportError("too_many_sheets", 413);
            err.details = { maxSheets: MAX_UPLOAD_SHEETS };
            throw err;
        }

        const client = await getClient();
        try {
            await client.query("BEGIN");

            let reportSource = null;
            if (enforceOwnership) {
                reportSource = await resolveReportSourceForUpload(client, {
                    reportSourceId: reportSourceId || null,
                    reportSourceName: reportSourceName || null,
                    user,
                    autosyncConfig,
                });
            } else {
                reportSource = await loadReportSourceForImport(client, reportSourceId);
            }

            const groupId = resolveImportGroupId(user, reportSource);
            const dlp = await loadDlpSettings(client);
            const isSuperAdmin = isPlatformAdminUser(user);
            let customerDlpEnabled = true;
            if (!isSuperAdmin) {
                if (!groupId) {
                    customerDlpEnabled = false;
                } else {
                    const groupRes = await client.query("SELECT id, entitlements FROM groups WHERE id = $1 LIMIT 1", [groupId]);
                    const group = groupRes.rows?.[0] || null;
                    customerDlpEnabled = !!(group && groupHasFeature(group, "dlp"));
                }
            }
            if (dlp.enabled !== false && customerDlpEnabled) {
                const scan = await scanRowsForDlpInWorker(sheets, dlp);
                if (scan.findings.length > 0) {
                    await writeAuditLog({
                        req: { id: null, user, ip: null, headers: {} },
                        actorUserId: user?.id || null,
                        action: "dlp.findings_detected",
                        resourceType: "report_source",
                        resourceId: reportSource?.id || null,
                        metadata: {
                            groupId,
                            mode: dlp.mode,
                            findingsCount: scan.findings.length,
                            scannedCells: scan.scannedCells,
                            capped: scan.capped,
                            maskedColumns: scan.maskedColumns || {},
                            findings: scan.findings,
                        },
                    });
                }
                if (scan.findings.length > 0) {
                    const findingTypes = Array.from(new Set((scan.findings || []).map((f) => String(f?.type || "").trim()).filter(Boolean)));
                    const prettyType = (t) => {
                        if (t === "ssn") return "SSN";
                        if (t === "credit_card") return "Credit Card";
                        if (t === "email") return "Email";
                        if (t === "phone") return "Phone";
                        if (t === "iban") return "IBAN";
                        return t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
                    };
                    const typeList = findingTypes.map(prettyType).join(", ");
                    dlpOutcome = {
                        enabled: dlp.enabled !== false,
                        mode: dlp.mode,
                        findingsCount: scan.findings.length,
                        scannedCells: Number(scan.scannedCells || 0),
                        capped: !!scan.capped,
                        findingTypes,
                        maskedColumns: scan.maskedColumns || {},
                        maskedCells: scan.maskedCells || {},
                        warning: dlp.mode === "warn",
                        warningMessage: dlp.mode === "warn" ? `PII detected (${typeList}) in ${scan.findings.length} cell(s). Import proceeded because DLP mode is WARN.` : null,
                        message: dlp.mode === "mask"
                            ? `DLP masking applied for: ${typeList}. Matching values were redacted.`
                            : (dlp.mode === "warn"
                                ? `PII detected (${typeList}) in ${scan.findings.length} cell(s). Import proceeded because DLP mode is WARN.`
                                : null),
                    };
                }
                if ((dlp.mode === "mask" || dlp.maskDetectedColumns) && scan.findings.length > 0) {
                    sheets = applyDlpColumnMasking(sheets, scan.maskedColumns, "[REDACTED]", scan.maskedCells || {});
                }
                if (scan.findings.length > 0 && dlp.mode === "block") {
                    const err = toImportError("dlp_blocked", 403, "Import blocked by DLP policy.");
                    err.details = {
                        groupId,
                        findingsCount: scan.findings.length,
                        scannedCells: scan.scannedCells,
                        capped: scan.capped,
                        maskedColumns: scan.maskedColumns || {},
                        findings: scan.findings,
                    };
                    throw err;
                }
            }

            const sheetId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const firstTabName = sheetNames[0];
            const firstTabRowsRaw = sheets[firstTabName];
            if (!firstTabRowsRaw || firstTabRowsRaw.length === 0) {
                throw toImportError("empty_sheet", 400, "The first tab of the uploaded file appears to be empty.");
            }

            const headers = Object.keys(firstTabRowsRaw[0]).filter((h) => !!h && !h.startsWith("__rowNum__"));
            if (headers.length > MAX_UPLOAD_COLUMNS) {
                const err = toImportError("too_many_columns", 413);
                err.details = { maxColumns: MAX_UPLOAD_COLUMNS };
                throw err;
            }
            const semanticRules = await loadSemanticProfileRules();
            let semanticProfile = buildSheetSemanticProfile({ headers, sampleRows: firstTabRowsRaw, rules: semanticRules });
            semanticProfile = await maybeEnrichSheetSemanticProfileWithAi({
                sheetId,
                headers,
                sampleRows: firstTabRowsRaw,
                semanticProfile,
                groupId,
                client,
            });
            if (dlpOutcome) {
                semanticProfile = {
                    ...(semanticProfile || {}),
                    dlp: {
                        mode: dlpOutcome.mode,
                        findingsCount: Number(dlpOutcome.findingsCount || 0),
                        scannedCells: Number(dlpOutcome.scannedCells || 0),
                        maskedColumns: dlpOutcome.maskedColumns || {},
                        maskedCells: dlpOutcome.maskedCells || {},
                        updatedAt: new Date().toISOString(),
                    },
                };
            }
            const aiChatCompatibility = evaluateAiChatCompatibilityForImport({
                semanticProfile,
                sampleRows: firstTabRowsRaw,
            });
            semanticProfile = {
                ...(semanticProfile || {}),
                learned: {
                    ...((semanticProfile && typeof semanticProfile === "object" && semanticProfile.learned && typeof semanticProfile.learned === "object")
                        ? semanticProfile.learned
                        : {}),
                    ai_chat_compatibility: {
                        ...aiChatCompatibility,
                        approval_ready: aiChatCompatibility.ready || canApproveWithMaskedDlp({ semanticProfile, compatibility: aiChatCompatibility }),
                        evaluatedAt: new Date().toISOString(),
                    },
                },
            };
            const compatibilityReviewRequired = AI_CHAT_COMPATIBILITY_ENFORCE_IMPORT && !aiChatCompatibility.ready;

            const versionedFilename = await getVersionedFilename(client, reportSource.id, originalName);
            const headerDiff = buildHeaderDiff(reportSource.previousHeaders, headers);
            const schemaStatus = getSchemaStatus(headerDiff);
            const reviewPolicy = resolveReviewPolicy(reportSource, fileLabel, schemaStatus, approvalRequired);
            const baseReviewReasons = Array.isArray(reviewPolicy?.reasons) ? reviewPolicy.reasons : [];
            const reviewRequired = !!reviewPolicy.required || compatibilityReviewRequired;
            const versionRes = await client.query(
                "SELECT COALESCE(MAX(import_version), 0)::int + 1 AS next_version FROM report_source_imports WHERE report_source_id = $1 AND file_label = $2",
                [reportSource.id, fileLabel]
            );
            const sourceVersion = Number(versionRes.rows?.[0]?.next_version || 1);

            await client.query(
                `INSERT INTO sheets
                   (id, headers, active, filename, display_name, stored_path, tab_name, tabs,
                    report_source_id, source_version, semantic_profile, semantic_profile_updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, CURRENT_TIMESTAMP)`,
                [
                    sheetId,
                    JSON.stringify(headers),
                    !reviewRequired,
                    versionedFilename,
                    displayName,
                    null,
                    firstTabName,
                    JSON.stringify(sheetNames),
                    reportSource.id,
                    sourceVersion,
                    JSON.stringify(semanticProfile),
                ]
            );

            let totalRows = 0;
            const canUseStagingFinalize = IMPORT_STAGING_FINALIZE_ENABLED === true && !!stagedSourceJobId;
            if (canUseStagingFinalize) {
                const countRows = await client.query(
                    `SELECT sheet_name, COUNT(*)::int AS c
                       FROM import_row_staging
                      WHERE job_id = $1
                      GROUP BY sheet_name`,
                    [stagedSourceJobId]
                );
                const countMap = new Map(countRows.rows.map((r) => [String(r.sheet_name), Number(r.c || 0)]));
                for (const sn of sheetNames) {
                    const c = Number(countMap.get(sn) || 0);
                    if (c > MAX_UPLOAD_ROWS_PER_SHEET) {
                        const err = toImportError("too_many_rows_in_sheet", 413);
                        err.details = { tab: sn, maxRowsPerSheet: MAX_UPLOAD_ROWS_PER_SHEET };
                        throw err;
                    }
                    totalRows += c;
                }
                if (totalRows > MAX_UPLOAD_TOTAL_ROWS) {
                    const err = toImportError("too_many_total_rows", 413);
                    err.details = { maxTotalRows: MAX_UPLOAD_TOTAL_ROWS };
                    throw err;
                }
                if (totalRows <= 0) {
                    throw toImportError("staging_rows_missing", 500);
                }
                await client.query(
                    `INSERT INTO sheet_rows (sheet_id, row_index, row_data, tab_name)
                     SELECT $2 AS sheet_id, s.row_index, s.row_data, s.sheet_name AS tab_name
                       FROM import_row_staging s
                      WHERE s.job_id = $1
                      ORDER BY s.sheet_name ASC, s.row_index ASC`,
                    [stagedSourceJobId, sheetId]
                );
            } else {
                for (const sn of sheetNames) {
                    const rows = sheets[sn];
                    if (rows.length > MAX_UPLOAD_ROWS_PER_SHEET) {
                        const err = toImportError("too_many_rows_in_sheet", 413);
                        err.details = { tab: sn, maxRowsPerSheet: MAX_UPLOAD_ROWS_PER_SHEET };
                        throw err;
                    }
                    totalRows += rows.length;
                    if (totalRows > MAX_UPLOAD_TOTAL_ROWS) {
                        const err = toImportError("too_many_total_rows", 413);
                        err.details = { maxTotalRows: MAX_UPLOAD_TOTAL_ROWS };
                        throw err;
                    }

                    const CHUNK_SIZE = 500;
                    for (let j = 0; j < rows.length; j += CHUNK_SIZE) {
                        const chunk = rows.slice(j, j + CHUNK_SIZE);
                        const values = [];
                        const placeHolders = [];
                        let pIdx = 1;

                        chunk.forEach((r, idx) => {
                            const normalizedRow = normalizeSheetRow(r);
                            values.push(sheetId, j + idx, JSON.stringify(normalizedRow), sn);
                            placeHolders.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
                        });

                        const sql = `INSERT INTO sheet_rows (sheet_id, row_index, row_data, tab_name) VALUES ${placeHolders.join(",")}`;
                        await client.query(sql, values);
                    }
                }
            }

            const summaryRows = buildInsightSummaryRows({ sheetId, sheetNames, sheets });
            if (summaryRows.length) {
                await client.query(`DELETE FROM sheet_insight_summaries WHERE sheet_id = $1`, [sheetId]);
                const CHUNK = 500;
                for (let i = 0; i < summaryRows.length; i += CHUNK) {
                    const chunk = summaryRows.slice(i, i + CHUNK);
                    const values = [];
                    const placeholders = [];
                    let p = 1;
                    chunk.forEach((r) => {
                        values.push(r.sheet_id, r.tab_name, r.period_key, r.category_key, r.metric_key, r.agg_sum, r.agg_avg, r.agg_count);
                        placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
                    });
                    await client.query(
                        `INSERT INTO sheet_insight_summaries
                        (sheet_id, tab_name, period_key, category_key, metric_key, agg_sum, agg_avg, agg_count)
                        VALUES ${placeholders.join(",")}
                        ON CONFLICT (sheet_id, tab_name, period_key, category_key, metric_key)
                        DO UPDATE SET
                          agg_sum = EXCLUDED.agg_sum,
                          agg_avg = EXCLUDED.agg_avg,
                          agg_count = EXCLUDED.agg_count,
                          updated_at = CURRENT_TIMESTAMP`,
                        values
                    );
                }
            }

            await carryForwardSourceSecurity(client, {
                previousSheetId: reportSource.previousSheetId,
                nextSheetId: sheetId,
                previousHeaders: reportSource.previousHeaders,
                nextHeaders: headers,
            });

            const importStatus = reviewRequired ? "pending_approval" : "published";
            const importRes = await client.query(
                `INSERT INTO report_source_imports
                   (report_source_id, sheet_id, import_version, file_label, original_filename, imported_by,
                    schema_status, schema_diff, status, published_at, published_by, job_id, file_size_bytes)
                   VALUES ($1, $2, $3, $4, $5, $6::int, $7, $8, $9,
                            CASE WHEN $9 = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END,
                            CASE WHEN $9 = 'published' THEN $6::int ELSE NULL END,
                            $10, $11)
                 RETURNING id`,
                [
                    reportSource.id,
                    sheetId,
                    sourceVersion,
                    fileLabel,
                    originalName,
                    user?.id || null,
                    schemaStatus,
                    JSON.stringify(headerDiff),
                    importStatus,
                    importJobId,
                    Number(fileSizeBytes || 0),
                ]
            );
            const importId = importRes.rows[0].id;

            if (!reviewRequired) {
                await client.query(
                    `UPDATE report_sources
                        SET current_sheet_id = $1,
                            updated_at = CURRENT_TIMESTAMP
                      WHERE id = $2`,
                    [sheetId, reportSource.id]
                );
            } else {
                await client.query(
                    `UPDATE report_sources
                        SET updated_at = CURRENT_TIMESTAMP
                      WHERE id = $1`,
                    [reportSource.id]
                );
            }

            if (autosyncConfig?.enabled) {
                await applyReportSourceAutosyncConfig(client, reportSource.id, autosyncConfig);
            }

            const responsePayload = {
                sheetId,
                importId,
                import_id: importId,
                importJobId,
                import_job_id: importJobId,
                import_status: importStatus,
                status: importStatus,
                reportSourceId: reportSource.id,
                report_source_id: reportSource.id,
                report_source_name: reportSource.name,
                source_version: sourceVersion,
                schema_status: schemaStatus,
                schema_diff: headerDiff,
                review_required: reviewRequired,
                review_reasons: compatibilityReviewRequired
                    ? [...baseReviewReasons, ...aiChatCompatibility.missing.map((reason) => `AI chat compatibility: ${reason}`)]
                    : baseReviewReasons,
                semantic_profile: semanticProfile,
                headers,
                rows: totalRows,
                active: !reviewRequired,
                filename: versionedFilename,
                display_name: displayName,
                tabs: sheetNames,
            };
            if (dlpOutcome) {
                responsePayload.dlp = dlpOutcome;
            }

            await finishImportJob(client, {
                id: importJobId,
                status: importStatus,
                reportSourceId: reportSource.id,
                sheetId,
                importId,
                result: responsePayload,
            });

            await client.query("COMMIT");

            const businessClassification = await carryForwardBusinessClassificationIfPrompted({
                reportSourceId: reportSource.id,
                sheetId,
                fileLabel,
            }) || await classifyAndPersistBusinessContext({
                reportSource,
                sheetId,
                groupId,
                sourceKind: classificationSourceKind,
                sourceName: reportSource.name,
                fileName: originalName,
                sheetNames,
                headers,
                sampleRows: firstTabRowsRaw,
            });
            if (businessClassification) {
                responsePayload.business_classification = businessClassification;
                responsePayload.business_classification_status = businessClassification.status || null;
            }

            return { responsePayload, importStatus };
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    };
}
