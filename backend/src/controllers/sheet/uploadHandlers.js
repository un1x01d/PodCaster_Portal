import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export function createSheetUploadHandlers(deps) {
    const {
        query,
        getClient,
        isGroupAdminUser,
        canUploadSheetsByRole,
        sanitizeDisplayName,
        hasValidEmailIngestSharedSecret,
        normalizeEmailAddress,
        extractEmailAddresses,
        senderDomainIsAllowed,
        uploadRequiresApproval,
        parseAutosyncConfig,
        resolveTenantParseMemoryLimitMb,
        assertBufferedImportSizeAllowed,
        shouldUseQueuedImport,
        assertUploadSignatureMatchesExtension,
        enqueueDbImportJob,
        writeAuditLog,
        createImportJob,
        parseWorkbookBufferOrThrow,
        parseWorkbookFileOrThrow,
        executeImportFromParsedWorkbook,
        loadEmailIngestSettingsForGroup,
        resolveEmailIngestCustomer,
        resolveOrCreateEmailReportSource,
        persistImportJobPayload,
        importPipelineSettingsKey,
        BUFFERED_IMPORT_LIMIT_MB,
    } = deps;

    async function uploadSheet(req, res) {
        let filePath = req.file?.path;
        let importJobId = req.importJobId || randomUUID();
        let importJobCreated = false;
        try {
            const isAdminRole = canUploadSheetsByRole(req.user?.role);
            const isGroupAdmin = req.user?.id ? await isGroupAdminUser(req.user.id) : false;
            if (!isAdminRole && !isGroupAdmin) {
                if (filePath) fs.unlink(filePath, () => {});
                return res.status(403).json({ error: "Forbidden" });
            }
            if (!req.file) return res.status(400).json({ error: "No file" });

            const originalName = req.file.originalname || "uploaded.xlsx";
            const displayName = sanitizeDisplayName(req.body?.display_name);
            const fileLabel = String(req.body?.file_label || req.body?.fileLabel || displayName || "File").trim();
            const approvalRequired = uploadRequiresApproval(req);
            const rawReportSourceId = req.body?.reportSourceId ?? req.body?.report_source_id;
            const rawReportSourceName = req.body?.reportSourceName ?? req.body?.report_source_name;
            const autosyncConfig = parseAutosyncConfig(req.body);
            if (!displayName) {
                if (filePath) fs.unlink(filePath, () => {});
                return res.status(400).json({ error: "display_name_required" });
            }

            console.log(`[upload] size=${req.file.size} reportSourceId=${rawReportSourceId || "new"}`);
            const parseMemoryLimitMb = await resolveTenantParseMemoryLimitMb(req.user);
            assertBufferedImportSizeAllowed(req.file?.size, parseMemoryLimitMb);
            const shouldQueueImport = await shouldUseQueuedImport(req, {
                query,
                key: importPipelineSettingsKey,
            });

            let fileBuffer = req.fileBuffer;
            if (!fileBuffer && shouldQueueImport) {
                fileBuffer = await fs.promises.readFile(filePath);
                fs.unlink(filePath, () => {});
                filePath = null;
            }
            if (!fileBuffer && filePath) {
                fileBuffer = await fs.promises.readFile(filePath);
            }
            assertUploadSignatureMatchesExtension({ originalName, fileBuffer });

            if (shouldQueueImport) {
                const resolvedSource = await enqueueDbImportJob({
                    user: req.user,
                    approvalRequired,
                    importJobId,
                    originalName,
                    displayName,
                    fileLabel,
                    rawReportSourceId,
                    rawReportSourceName,
                    fileBuffer,
                    contentType: req.file?.mimetype || null,
                    fileSize: req.file?.size || fileBuffer.length || 0,
                    parseMemoryLimitMb,
                    autosyncConfig,
                });
                await writeAuditLog({
                    req,
                    action: "import.queued",
                    resourceType: "import_job",
                    resourceId: importJobId,
                    metadata: {
                        report_source_id: resolvedSource.id,
                        report_source_name: resolvedSource.name,
                        autosync_enabled: !!autosyncConfig?.enabled,
                        approval_required: !!approvalRequired,
                        mode: "async_db_queue",
                        file_size: Number(req.file?.size || fileBuffer.length || 0),
                    },
                });
                return res.status(202).json({
                    status: "queued",
                    import_status: "queued",
                    importJobId,
                    import_job_id: importJobId,
                    reportSourceId: resolvedSource.id,
                    report_source_id: resolvedSource.id,
                    report_source_name: resolvedSource.name,
                    autosync_enabled: !!autosyncConfig?.enabled,
                    filename: originalName,
                    display_name: displayName,
                });
            }

            const jobClient = await getClient();
            try {
                await jobClient.query("BEGIN");
                await createImportJob(jobClient, {
                    id: importJobId,
                    mode: approvalRequired ? "sync_pending_approval" : "sync",
                    status: "running",
                    stage: "processing",
                    requestedBy: req.user?.id || null,
                    originalFilename: originalName,
                    maxAttempts: 1,
                });
                await jobClient.query("COMMIT");
                importJobCreated = true;
            } catch (err) {
                await jobClient.query("ROLLBACK").catch(() => {});
                throw err;
            } finally {
                jobClient.release();
            }

            const parsedResult = fileBuffer
                ? await parseWorkbookBufferOrThrow(fileBuffer, { memoryLimitMb: parseMemoryLimitMb })
                : await parseWorkbookFileOrThrow(filePath, { memoryLimitMb: parseMemoryLimitMb });
            const { responsePayload, importStatus } = await executeImportFromParsedWorkbook({
                parsedResult,
                approvalRequired,
                importJobId,
                reportSourceId: rawReportSourceId || null,
                reportSourceName: rawReportSourceName || null,
                displayName,
                fileLabel,
                originalName,
                user: req.user,
                enforceOwnership: true,
                fileSizeBytes: Number(req.file?.size || fileBuffer?.length || 0),
                autosyncConfig,
                classificationSourceKind: autosyncConfig?.enabled ? "autosync" : "manual_upload",
            });

            await writeAuditLog({
                req,
                action: importStatus === "pending_approval" ? "import.pending_approval" : "import.published",
                resourceType: "report_source_import",
                resourceId: responsePayload.importId,
                metadata: {
                    report_source_id: responsePayload.report_source_id,
                    sheet_id: responsePayload.sheetId,
                    job_id: importJobId,
                    rows: responsePayload.rows,
                    tabs: Array.isArray(responsePayload.tabs) ? responsePayload.tabs.length : 0,
                    schema_status: responsePayload.schema_status,
                    mode: "sync_fallback",
                },
            });
            return res.json(responsePayload);
        } catch (e) {
            console.error("upload failed:", e);
            if (e?.message === "unreadable_spreadsheet" && req?.file) {
                const filename = req.file.originalname || "uploaded";
                const sniff = req.file.buffer
                    ? req.file.buffer.slice(0, 8).toString("hex")
                    : (req.file.path ? `path=${req.file.path}` : "no_buffer");
                console.error("[upload] unreadable_spreadsheet", {
                    filename,
                    mimetype: req.file.mimetype,
                    size: req.file.size,
                    sniff,
                    workerMessage: e.workerMessage,
                    directMessage: e.directMessage,
                    rootError: e.rootError || null,
                });
            }
            if (importJobCreated) {
                try {
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
                        [importJobId, String(e?.message || "upload_failed").slice(0, 500)]
                    );
                } catch {
                    // Keep original upload error response.
                }
            }
            if (e?.code === "LIMIT_FILE_SIZE") {
                return res.status(413).json({ error: "file_too_large", maxMB: BUFFERED_IMPORT_LIMIT_MB });
            }
            if (e?.statusCode) {
                const body = { error: e.message || "upload_failed" };
                if (e.publicMessage) body.message = e.publicMessage;
                if (e.details && typeof e.details === "object") Object.assign(body, e.details);
                return res.status(e.statusCode).json(body);
            }
            return res.status(500).json({ error: "upload_failed", details: { message: e.message || "upload_failed" } });
        } finally {
            if (filePath) {
                fs.unlink(filePath, () => {});
            }
        }
    }

    async function ingestEmailAttachment(req, res) {
        let importJobId = req.importJobId || randomUUID();
        let importJobCreated = false;
        try {
            if (!hasValidEmailIngestSharedSecret(req)) {
                return res.status(403).json({ error: "email_ingest_unauthorized" });
            }
            const file = req.file
                || req.files?.file?.[0]
                || req.files?.attachment?.[0]
                || (Array.isArray(req.files) ? req.files[0] : null);
            if (!file) return res.status(400).json({ error: "No file" });

            const senderEmail = normalizeEmailAddress(
                req.body?.from
                || req.body?.sender
                || req.body?.mail_from
                || req.body?.mailFrom
                || req.body?.envelopeFrom
                || req.body?.sourceEmail
            );
            if (!senderEmail) return res.status(400).json({ error: "sender_email_required" });

            const recipientValues = [
                req.body?.to,
                req.body?.recipient,
                req.body?.envelopeTo,
                req.body?.deliveredTo,
                req.body?.originalRecipient,
            ].filter(Boolean);
            const recipientAddresses = extractEmailAddresses(recipientValues.join("\n"));
            if (!recipientAddresses.length) return res.status(400).json({ error: "recipient_email_required" });

            const baseSettings = await loadEmailIngestSettingsForGroup(null);
            if (baseSettings.enabled === false) return res.status(403).json({ error: "email_ingest_disabled" });

            const targetCustomer = await resolveEmailIngestCustomer({ query }, recipientAddresses, baseSettings);
            if (!targetCustomer) return res.status(404).json({ error: "customer_email_not_resolved" });

            const customerSettings = await loadEmailIngestSettingsForGroup(targetCustomer.group_id);
            if (customerSettings.requireApprovedSenders && !senderDomainIsAllowed(senderEmail, customerSettings.allowedSenderDomains)) {
                return res.status(403).json({ error: "sender_domain_not_allowed" });
            }

            const originalName = String(file.originalname || "email-attachment.xlsx").trim() || "email-attachment.xlsx";
            const subject = String(req.body?.subject || req.body?.emailSubject || "").trim();
            const fileLabel = String(req.body?.file_label || req.body?.fileLabel || subject || path.basename(originalName, path.extname(originalName)) || originalName).trim() || originalName;
            const displayName = sanitizeDisplayName(
                req.body?.display_name
                || req.body?.displayName
                || targetCustomer.customer_name
                || targetCustomer.group_name
                || fileLabel
            );

            const client = await getClient();
            let reportSource = null;
            try {
                await client.query("BEGIN");
                reportSource = await resolveOrCreateEmailReportSource(client, {
                    groupId: targetCustomer.group_id,
                    recipientAddress: targetCustomer.recipientAddress || recipientAddresses[0],
                    customerName: targetCustomer.customer_name || targetCustomer.group_name,
                    fileLabel,
                    messageId: String(req.body?.messageId || req.body?.message_id || "").trim() || null,
                });

                await createImportJob(client, {
                    id: importJobId,
                    mode: "email",
                    status: "running",
                    stage: "processing",
                    requestedBy: null,
                    reportSourceId: reportSource.id,
                    originalFilename: originalName,
                    maxAttempts: 1,
                });
                await client.query("COMMIT");
                importJobCreated = true;
            } catch (err) {
                await client.query("ROLLBACK").catch(() => {});
                throw err;
            } finally {
                client.release();
            }

            const parseMemoryLimitMb = await resolveTenantParseMemoryLimitMb({ customer_group_id: targetCustomer.group_id });
            assertBufferedImportSizeAllowed(file?.size, parseMemoryLimitMb);
            let fileBuffer = file.buffer || null;
            if (!fileBuffer && file.path) {
                fileBuffer = await fs.promises.readFile(file.path);
            }
            if (!fileBuffer) return res.status(400).json({ error: "file_buffer_missing" });
            assertUploadSignatureMatchesExtension({ originalName, fileBuffer });
            await persistImportJobPayload(importJobId, fileBuffer, {
                contentType: file.mimetype || "application/octet-stream",
                original_filename: originalName,
                display_name: displayName,
                file_label: fileLabel,
                mode: "email",
                parseMemoryLimitMb,
                reportSourceId: reportSource.id,
                reportSourceName: reportSource.name,
                approvalRequired: false,
                requestedBy: null,
                classificationSourceKind: "email_ingest",
                source_group_id: targetCustomer.group_id,
                sender_email: senderEmail,
                recipient_email: targetCustomer.recipientAddress || recipientAddresses[0] || null,
            });

            await writeAuditLog({
                req,
                action: "email_ingest.queued",
                resourceType: "import_job",
                resourceId: importJobId,
                metadata: {
                    report_source_id: reportSource.id,
                    report_source_name: reportSource.name,
                    sender_email: senderEmail,
                    recipient_email: targetCustomer.recipientAddress || "",
                    source_group_id: targetCustomer.group_id,
                    mode: "email",
                    import_status: "queued",
                },
            });
            return res.status(202).json({
                status: "queued",
                import_status: "queued",
                importJobId,
                import_job_id: importJobId,
                reportSourceId: reportSource.id,
                report_source_id: reportSource.id,
                report_source_name: reportSource.name,
                filename: originalName,
                display_name: displayName,
                email_sender: senderEmail,
                email_recipient: targetCustomer.recipientAddress,
                customer_group_id: targetCustomer.group_id,
                customer_id: targetCustomer.customer_id,
            });
        } catch (e) {
            console.error("email ingest failed:", e);
            if (importJobCreated) {
                try {
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
                        [importJobId, String(e?.message || "email_ingest_failed").slice(0, 500)]
                    );
                } catch {
                    // Preserve the original ingest error response.
                }
            }
            if (e?.code === "LIMIT_FILE_SIZE") {
                return res.status(413).json({ error: "file_too_large", maxMB: BUFFERED_IMPORT_LIMIT_MB });
            }
            if (e?.statusCode) {
                const body = { error: e.message || "email_ingest_failed" };
                if (e.publicMessage) body.message = e.publicMessage;
                if (e.details && typeof e.details === "object") Object.assign(body, e.details);
                return res.status(e.statusCode).json(body);
            }
            return res.status(500).json({ error: "email_ingest_failed", details: { message: e.message || "email_ingest_failed" } });
        } finally {
            const file = req.file
                || req.files?.file?.[0]
                || req.files?.attachment?.[0]
                || (Array.isArray(req.files) ? req.files[0] : null);
            if (file?.path) fs.unlink(file.path, () => {});
        }
    }

    return {
        uploadSheet,
        ingestEmailAttachment,
    };
}
