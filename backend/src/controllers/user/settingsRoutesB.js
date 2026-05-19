export function createUserSettingsRoutesB(deps) {
const {
  query,
  isPlatformAdminUser,
  APP_SETTING_KEYS,
  normalizeAppSettingValue,
  readDecryptedSetting,
  writeEncryptedSetting,
  parseBooleanLike,
  normalizeDlpSettings,
  DLP_SETTINGS_KEY,
} = deps;
function normalizeRevisionCompareSettings(raw = {}) {
    const maxRowsRaw = Number.parseInt(
        raw?.maxRows ?? raw?.maxCompareRows ?? raw?.revisionCompareMaxRows ?? DEFAULT_REVISION_COMPARE_MAX_ROWS,
        10
    );
    const maxRows = Number.isFinite(maxRowsRaw)
        ? Math.min(REVISION_COMPARE_MAX_ROWS_CAP, Math.max(1000, maxRowsRaw))
        : DEFAULT_REVISION_COMPARE_MAX_ROWS;
    return { maxRows };
}

function normalizeEmailIngestSettings(raw = {}) {
    const routingMode = String(raw?.routingMode || raw?.routeMode || "catch_all").trim().toLowerCase() === "default_routing"
        ? "default_routing"
        : "catch_all";
    const addressMode = String(raw?.addressMode || raw?.customerAddressMode || "slug").trim().toLowerCase() === "id"
        ? "id"
        : "slug";
    return {
        enabled: raw?.enabled !== false,
        provider: "google_workspace",
        inboundDomain: String(raw?.inboundDomain || raw?.emailDomain || "").trim().toLowerCase(),
        routeMailbox: String(raw?.routeMailbox || raw?.mailbox || "").trim().toLowerCase(),
        addressPrefix: String(raw?.addressPrefix || raw?.customerAddressPrefix || "customer").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "customer",
        addressMode,
        routingMode,
        requireApprovedSenders: raw?.requireApprovedSenders !== false,
        notes: String(raw?.notes || "").trim(),
    };
}

function normalizeImportPipelineSettings(raw = {}) {
    const enabled = raw?.importStreamingEnabled;
    const v2 = raw?.queuedImportStreamingV2Enabled;
    const stagingWrite = raw?.importStagingWriteEnabled;
    const stagingFinalize = raw?.importStagingFinalizeEnabled;
    return {
        importStreamingEnabled: enabled === true || String(enabled).trim().toLowerCase() === "true",
        queuedImportStreamingV2Enabled: v2 === true || String(v2).trim().toLowerCase() === "true",
        importStagingWriteEnabled: stagingWrite === true || String(stagingWrite).trim().toLowerCase() === "true",
        importStagingFinalizeEnabled: stagingFinalize === true || String(stagingFinalize).trim().toLowerCase() === "true",
    };
}

function normalizeReviewDefaultsSettings(raw = {}) {
    const firstUploadRequiresReview = raw?.firstUploadRequiresReview;
    return {
        firstUploadRequiresReview: firstUploadRequiresReview === true || String(firstUploadRequiresReview || "").trim().toLowerCase() === "true",
    };
}

async function getReviewDefaultsSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [REVIEW_DEFAULTS_SETTINGS_KEY]);
    const current = normalizeReviewDefaultsSettings(rows?.[0]?.value || { firstUploadRequiresReview: true });
    return res.json(current);
}

async function setReviewDefaultsSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["firstUploadRequiresReview"]);
    const next = normalizeReviewDefaultsSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [REVIEW_DEFAULTS_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "review_defaults.settings_updated",
        resourceType: "app_settings",
        resourceId: REVIEW_DEFAULTS_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

async function getImportPipelineSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [IMPORT_PIPELINE_SETTINGS_KEY]);
    const current = normalizeImportPipelineSettings(rows?.[0]?.value || {});
    return res.json(current);
}

async function setImportPipelineSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["importStreamingEnabled", "queuedImportStreamingV2Enabled", "importStagingWriteEnabled", "importStagingFinalizeEnabled"]);
    const next = normalizeImportPipelineSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [IMPORT_PIPELINE_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "import_pipeline.settings_updated",
        resourceType: "app_settings",
        resourceId: IMPORT_PIPELINE_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

function normalizeEmailIngestSenderAllowlist(raw = {}) {
    const allowedSenderDomains = Array.isArray(raw?.allowedSenderDomains)
        ? raw.allowedSenderDomains
        : String(raw?.allowedSenderDomains || raw?.allowedSenderDomainsCsv || "")
            .split(/[\n,]+/)
            .map((value) => String(value || "").trim())
            .filter(Boolean);
    return Array.from(new Set(allowedSenderDomains.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)));
}

async function getInsightTranslationCacheSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY]);
    const current = normalizeInsightTranslationCacheSettings(rows?.[0]?.value || {});
    return res.json(current);
}

async function setInsightTranslationCacheSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["ttlMinutes"]);
    const next = normalizeInsightTranslationCacheSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "insight_translation_cache.settings_updated",
        resourceType: "app_settings",
        resourceId: INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

async function getAiFeatureTogglesSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AI_FEATURE_TOGGLES_SETTINGS_KEY]);
    const current = normalizeAiFeatureToggles(rows?.[0]?.value || {});
    return res.json(current);
}

async function setAiFeatureTogglesSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, [
        "chatEnabled",
        "dashboardTranslationEnabled",
        "chatAudioEnabled",
        "insightAiEnabled",
        "businessClassificationEnabled",
    ]);
    const next = normalizeAiFeatureToggles(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [AI_FEATURE_TOGGLES_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "ai_feature_toggles.settings_updated",
        resourceType: "app_settings",
        resourceId: AI_FEATURE_TOGGLES_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

async function getMyAiFeatureTogglesSetting(req, res) {
    const effective = await resolveEffectiveAiFeaturesForUser(req.user);
    return res.json(effective);
}

async function getAiRuntimeSetting(req, res) {
    try {
        if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
        const current = await loadAiRuntimeSettings(null);
        return res.json({ ...current, groupId: null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

function normalizeAiSelfLearningSettings(raw = {}) {
    return {
        enabled: raw?.enabled === true || String(raw?.enabled || "").toLowerCase() === "true",
        autoApplyApprovedRules: raw?.autoApplyApprovedRules === true || String(raw?.autoApplyApprovedRules || "").toLowerCase() === "true",
        autoApproveAllCandidates: raw?.autoApproveAllCandidates === true || String(raw?.autoApproveAllCandidates || "").toLowerCase() === "true",
        minConfidence: Math.max(0, Math.min(1, Number(raw?.minConfidence ?? 0.75) || 0.75)),
    };
}

async function getAiSelfLearningSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AI_SELF_LEARNING_SETTINGS_KEY]);
    const current = normalizeAiSelfLearningSettings(rows?.[0]?.value || {});
    return res.json(current);
}

async function setAiSelfLearningSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["enabled", "autoApplyApprovedRules", "autoApproveAllCandidates", "minConfidence"]);
    const next = normalizeAiSelfLearningSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [AI_SELF_LEARNING_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "ai_self_learning.settings_updated",
        resourceType: "app_settings",
        resourceId: AI_SELF_LEARNING_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

async function listAiLearningFeedback(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const status = String(req.query?.status || "pending").trim().toLowerCase();
    const allowed = new Set(["pending", "approved", "rejected", "all"]);
    const resolved = allowed.has(status) ? status : "pending";
    const rows = resolved === "all"
        ? await query(
            `SELECT id, sheet_id, user_id, locale, question, bad_answer, expected_answer, context, status, approved_rule_id, reviewed_by, reviewed_at, created_at
             FROM ai_learning_feedback
             ORDER BY created_at DESC
             LIMIT 500`
        )
        : await query(
            `SELECT id, sheet_id, user_id, locale, question, bad_answer, expected_answer, context, status, approved_rule_id, reviewed_by, reviewed_at, created_at
             FROM ai_learning_feedback
             WHERE status = $1
             ORDER BY created_at DESC
             LIMIT 500`,
            [resolved]
        );
    return res.json({ items: rows || [] });
}

async function reviewAiLearningFeedback(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const id = Number.parseInt(req.params?.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_feedback_id" });
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (action !== "approve" && action !== "reject") return res.status(400).json({ error: "invalid_action" });
    const notes = String(req.body?.notes || "").trim().slice(0, 1000);
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const foundRows = await client.query(
            `SELECT id, question, expected_answer, locale, status
             FROM ai_learning_feedback
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );
        const found = foundRows.rows?.[0];
        if (!found) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "feedback_not_found" });
        }
        if (String(found.status) !== "pending") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "feedback_already_reviewed" });
        }
        let approvedRuleId = null;
        if (action === "approve") {
            const context = found.context || {};
            const successfulPlan = context.successfulPlan || null;
            
            let mappedIntent = "answer_shape";
            let mappedPayload = { expectedAnswer: String(found.expected_answer || ""), notes };

            if (successfulPlan && typeof successfulPlan === "object" && successfulPlan.operation) {
                mappedIntent = successfulPlan.operation;
                mappedPayload = {
                    ...successfulPlan,
                    notes: `Learned from feedback ${id}: ${notes}`
                };
            }

            const ruleRows = await client.query(
                `INSERT INTO ai_learning_rules
                   (source_feedback_id, scope, locale, phrase, mapped_intent, mapped_payload, confidence, status, approved_by)
                 VALUES ($1, 'global', $2, $3, $4, $5::jsonb, 1.0, 'approved', $6)
                 RETURNING id`,
                [
                    id,
                    String(found.locale || "en"),
                    normalizeText(String(found.question || "")),
                    mappedIntent,
                    JSON.stringify(mappedPayload),
                    Number(req.user?.id || 0) || null,
                ]
            );
            approvedRuleId = ruleRows.rows?.[0]?.id || null;
            invalidateLearningRulesCache();
        }

        await client.query(
            `UPDATE ai_learning_feedback
             SET status = $2, approved_rule_id = $3, reviewed_by = $4, reviewed_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [id, action === "approve" ? "approved" : "rejected", approvedRuleId, Number(req.user?.id || 0) || null]
        );
        await client.query("COMMIT");
        await writeAuditLog({
            req,
            action: `ai_learning.feedback_${action}`,
            resourceType: "ai_learning_feedback",
            resourceId: String(id),
            metadata: { approvedRuleId, notes },
        });
        return res.json({ success: true, id, status: action === "approve" ? "approved" : "rejected", approvedRuleId });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "ai_learning_review_failed", detail: String(err?.message || "internal_server_error") });
    } finally {
        client.release();
    }
}

async function listAiLearningCandidates(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const status = String(req.query?.status || "pending").trim().toLowerCase();
    const allowed = new Set(["pending", "approved", "rejected", "all"]);
    const resolved = allowed.has(status) ? status : "pending";
    const rows = resolved === "all"
        ? await query(
            `SELECT id, locale, phrase, suggested_intent, suggested_payload, evidence_count, confidence, status, approved_rule_id, reviewed_by, reviewed_at, created_at, updated_at
             FROM ai_learning_candidates
             ORDER BY evidence_count DESC, updated_at DESC
             LIMIT 1000`
        )
        : await query(
            `SELECT id, locale, phrase, suggested_intent, suggested_payload, evidence_count, confidence, status, approved_rule_id, reviewed_by, reviewed_at, created_at, updated_at
             FROM ai_learning_candidates
             WHERE status = $1
             ORDER BY evidence_count DESC, updated_at DESC
             LIMIT 1000`,
            [resolved]
        );
    return res.json({ items: rows || [] });
}

async function reviewAiLearningCandidate(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const id = Number.parseInt(req.params?.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_candidate_id" });
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (action !== "approve" && action !== "reject") return res.status(400).json({ error: "invalid_action" });
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const foundRows = await client.query(
            `SELECT id, locale, phrase, suggested_intent, suggested_payload, status
             FROM ai_learning_candidates
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );
        const found = foundRows.rows?.[0];
        if (!found) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "candidate_not_found" });
        }
        if (String(found.status) !== "pending") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "candidate_already_reviewed" });
        }
        let approvedRuleId = null;
        if (action === "approve") {
            const ruleRows = await client.query(
                `INSERT INTO ai_learning_rules
                   (scope, locale, phrase, mapped_intent, mapped_payload, confidence, status, approved_by)
                 VALUES ('global', $1, $2, $3, $4::jsonb, 0.9, 'approved', $5)
                 RETURNING id`,
                [found.locale, normalizeText(found.phrase), found.suggested_intent, JSON.stringify(found.suggested_payload || {}), Number(req.user?.id || 0) || null]
            );
            approvedRuleId = ruleRows.rows?.[0]?.id || null;
            invalidateLearningRulesCache();
        }
        await client.query(
            `UPDATE ai_learning_candidates
             SET status = $2, approved_rule_id = $3, reviewed_by = $4, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [id, action === "approve" ? "approved" : "rejected", approvedRuleId, Number(req.user?.id || 0) || null]
        );
        await client.query("COMMIT");
        return res.json({ success: true, id, status: action === "approve" ? "approved" : "rejected", approvedRuleId });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "ai_learning_candidate_review_failed", detail: String(err?.message || "internal_server_error") });
    } finally {
        client.release();
    }
}

async function getAiLearningImpact(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const days = Math.max(1, Math.min(180, Number.parseInt(String(req.query?.days || "30"), 10) || 30));
    const rows = await query(
        `SELECT detected_intent,
                COUNT(*)::int AS total,
                SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END)::int AS ok_count,
                SUM(CASE WHEN status = 'no_data' THEN 1 ELSE 0 END)::int AS no_data_count,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS error_count
         FROM ai_learning_events
         WHERE created_at >= (CURRENT_TIMESTAMP - ($1::int || ' days')::interval)
         GROUP BY detected_intent
         ORDER BY total DESC`,
        [days]
    );
    return res.json({ days, intents: rows || [] });
}

async function setAiRuntimeSetting(req, res) {
    try {
        if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
        const incoming = req.body && typeof req.body === "object" ? { ...req.body } : {};
        assertAllowedKeys(incoming, [
            "aiRuntimePreset", "aiProvider", "providerConfigs",
            "globalAiDisabled", "chatEnabled", "chatAudioEnabled", "dashboardTranslationEnabled", "businessClassificationEnabled", "insightAiEnabled",
            "chatMaxInputChars", "chatHistoryWindowMessages", "dashboardTranslateMaxItems", "dashboardTranslateMaxCharsPerItem",
            "chatPromptBudgetEnabled",
            "businessClassificationModel", "businessClassificationApplyUploads", "businessClassificationApplyEmailIngest", "businessClassificationApplyAutosync",
            "businessClassificationMaxSampleRows", "businessClassificationMaxPromptChars", "businessClassificationMaxOutputTokens",
            "llmMaxOutputTokens", "openaiModel", "openaiBaseUrl", "openaiTimeoutMs", "openaiTemperature", "openaiMaxOutputTokens",
            "openaiInputCostPer1M", "openaiOutputCostPer1M", "translationOpenaiModel", "translationTemperature", "translationMaxOutputTokens",
            "insightAiModel", "insightAiMaxSeriesPoints", "insightAiMaxPromptChars",
            "chatAudioMaxChars", "chatAudioTtsModelEn", "chatAudioTtsModelDefault", "chatAudioTtsVoice", "chatAudioTtsSpeed",
            "aiBaseUrlAllowlistEnabled", "aiBaseUrlAllowlistBypass", "aiBaseUrlAllowlist",
            "importStreamingEnabled",
        ]);
        const aiProvider = String(incoming.aiProvider || "openai").trim().toLowerCase();
        const providerConfigs = incoming.providerConfigs && typeof incoming.providerConfigs === "object" ? incoming.providerConfigs : {};
        const providerModel = String(providerConfigs?.[aiProvider]?.model || "").trim();
        if (providerModel) {
            incoming.openaiModel = providerModel;
        }
        const next = await saveAiRuntimeSettings(null, incoming);
        const featureToggles = normalizeAiFeatureToggles({
            chatEnabled: next.globalAiDisabled !== true && next.chatEnabled === true,
            dashboardTranslationEnabled: next.globalAiDisabled !== true && next.dashboardTranslationEnabled === true,
            chatAudioEnabled: next.globalAiDisabled !== true && next.chatAudioEnabled === true,
            insightAiEnabled: next.globalAiDisabled !== true && next.insightAiEnabled === true,
            businessClassificationEnabled: next.globalAiDisabled !== true && next.businessClassificationEnabled === true,
        });
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [AI_FEATURE_TOGGLES_SETTINGS_KEY, JSON.stringify(featureToggles)]
        );
        await writeAuditLog({
            req,
            action: "ai_runtime.settings_updated",
            resourceType: "app_settings",
            resourceId: "ai_runtime_settings:global",
            metadata: {
                ...next,
                groupId: null,
                aiBaseUrlPolicy: {
                    allowlistEnabled: next.aiBaseUrlAllowlistEnabled === true,
                    allowlistBypass: next.aiBaseUrlAllowlistBypass === true,
                    allowlistSize: Array.isArray(next.aiBaseUrlAllowlist) ? next.aiBaseUrlAllowlist.length : 0,
                },
            },
        });
        return res.json({ success: true, ...next, groupId: null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function getMetricsExposureSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [METRICS_EXPOSURE_SETTINGS_KEY]);
    const current = normalizeMetricsExposureSettings(rows?.[0]?.value || {});
    return res.json(current);
}

async function getTwoFactorTotpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [TWO_FACTOR_TOTP_SETTINGS_KEY]);
    const current = normalizeTwoFactorTotpSettings(rows?.[0]?.value || {});
    return res.json(current);
}

async function setTwoFactorTotpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["issuer", "digits", "period"]);
    const next = normalizeTwoFactorTotpSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [TWO_FACTOR_TOTP_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "two_factor_totp.settings_updated",
        resourceType: "app_settings",
        resourceId: TWO_FACTOR_TOTP_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

async function getSmsOtpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [SMS_OTP_CONFIG_KEY]);
    const current = serializeSmsOtpSettingsForRead(rows?.[0]?.value || {});
    return res.json(current);
}

async function setSmsOtpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["provider", "enabled", "accountSid", "authToken", "fromNumber", "messagingServiceSid"]);
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [SMS_OTP_CONFIG_KEY]);
    const currentRaw = rows?.[0]?.value && typeof rows[0].value === "object" ? rows[0].value : {};
    const merged = {
        ...currentRaw,
        provider: "twilio",
        enabled: req.body?.enabled === undefined ? currentRaw?.enabled !== false : req.body.enabled !== false,
        accountSid: typeof req.body?.accountSid === "string" ? req.body.accountSid : currentRaw?.accountSid,
        authToken: typeof req.body?.authToken === "string" ? req.body.authToken : currentRaw?.authToken,
        fromNumber: typeof req.body?.fromNumber === "string" ? req.body.fromNumber : currentRaw?.fromNumber,
        messagingServiceSid: typeof req.body?.messagingServiceSid === "string" ? req.body.messagingServiceSid : currentRaw?.messagingServiceSid,
    };
    const next = normalizeSmsOtpSettings(merged);
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [SMS_OTP_CONFIG_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "sms_otp.settings_updated",
        resourceType: "app_settings",
        resourceId: SMS_OTP_CONFIG_KEY,
        metadata: {
            provider: "twilio",
            enabled: next.enabled !== false,
            accountSid: String(next.accountSid || ""),
            hasAuthToken: !!decryptSettingValue(String(next.authToken || "")).trim(),
            fromNumber: String(next.fromNumber || ""),
            messagingServiceSid: String(next.messagingServiceSid || ""),
        },
    });
    return res.json({ success: true, ...serializeSmsOtpSettingsForRead(next) });
}

async function getDlpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [DLP_SETTINGS_KEY]);
    const current = normalizeDlpSettings(rows?.[0]?.value || {});
    return res.json({ ...current, configured: rows.length > 0 });
}

async function setDlpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["enabled", "mode", "checkSsn", "checkCreditCard", "checkEmail", "checkPhone", "checkIban", "maskDetectedColumns", "maxCellsScanned", "maxFindings"]);
    const next = normalizeDlpSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [DLP_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "dlp.settings_updated",
        resourceType: "app_settings",
        resourceId: DLP_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, configured: true, ...next });
}

async function setMetricsExposureSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["enabled"]);
    const next = normalizeMetricsExposureSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [METRICS_EXPOSURE_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "metrics_exposure.settings_updated",
        resourceType: "app_settings",
        resourceId: METRICS_EXPOSURE_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

async function getAutosyncPollIntervalSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AUTOSYNC_POLL_INTERVAL_SETTINGS_KEY]);
    const current = normalizeAutosyncPollIntervalSettings(rows?.[0]?.value || {});
    return res.json(current);
}

async function setAutosyncPollIntervalSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["intervalMinutes", "pollMinutes", "minutes"]);
    const next = normalizeAutosyncPollIntervalSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [AUTOSYNC_POLL_INTERVAL_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "autosync_poll_interval.settings_updated",
        resourceType: "app_settings",
        resourceId: AUTOSYNC_POLL_INTERVAL_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

async function getRevisionCompareSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [REVISION_COMPARE_SETTINGS_KEY]);
    const current = normalizeRevisionCompareSettings(rows?.[0]?.value || {});
    return res.json({ ...current, configured: rows.length > 0, maxAllowedRows: REVISION_COMPARE_MAX_ROWS_CAP });
}

async function setRevisionCompareSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["maxRows", "maxCompareRows", "revisionCompareMaxRows"]);
    const next = normalizeRevisionCompareSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [REVISION_COMPARE_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "revision_compare.settings_updated",
        resourceType: "app_settings",
        resourceId: REVISION_COMPARE_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, configured: true, maxAllowedRows: REVISION_COMPARE_MAX_ROWS_CAP, ...next });
}

async function getEmailIngestSetting(req, res) {
    const scope = await resolveScopedGroupForIntegrationSettings(req);
    const currentRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [EMAIL_INGEST_SETTINGS_KEY]);
    const scopedAllowlistRaw = scope.groupId
        ? await getAppSettingValueWithScopedFallback(EMAIL_INGEST_ALLOWLIST_KEY, scope.groupId)
        : null;
    const allowlistRaw = scopedAllowlistRaw ?? await getAppSettingValueWithScopedFallback(EMAIL_INGEST_ALLOWLIST_KEY, null);
    const current = normalizeEmailIngestSettings(currentRows?.[0]?.value || {});
    return res.json({
        ...current,
        allowedSenderDomains: normalizeEmailIngestSenderAllowlist(allowlistRaw || currentRows?.[0]?.value || {}),
        groupId: scope.groupId || null,
    });
}

async function setEmailIngestSetting(req, res) {
    const scope = await resolveScopedGroupForIntegrationSettings(req);
    assertAllowedKeys(req.body || {}, ["enabled", "provider", "inboundDomain", "emailDomain", "routeMailbox", "mailbox", "addressPrefix", "customerAddressPrefix", "addressMode", "customerAddressMode", "routingMode", "routeMode", "requireApprovedSenders", "notes", "allowedSenderDomains", "allowedSenderDomainsCsv"]);
    const next = normalizeEmailIngestSettings(req.body || {});
    const allowedSenderDomains = normalizeEmailIngestSenderAllowlist(req.body || {});
    if (isPlatformAdminUser(req.user)) {
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [EMAIL_INGEST_SETTINGS_KEY, JSON.stringify(next)]
        );
    }
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [appSettingKeyForGroup(EMAIL_INGEST_ALLOWLIST_KEY, scope.groupId), JSON.stringify({ allowedSenderDomains })]
    );
    await writeAuditLog({
        req,
        action: "email_ingest.settings_updated",
        resourceType: "app_settings",
        resourceId: appSettingKeyForGroup(EMAIL_INGEST_ALLOWLIST_KEY, scope.groupId),
        metadata: { ...next, allowedSenderDomains, groupId: scope.groupId || null },
    });
    return res.json({ success: true, ...next, allowedSenderDomains, groupId: scope.groupId || null });
}

async function getMyMetricsExposureSetting(req, res) {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [METRICS_EXPOSURE_SETTINGS_KEY]);
    const current = normalizeMetricsExposureSettings(rows?.[0]?.value || {});
    return res.json(current);
}

function resolveSsoFeatureValue(entitlements) {
    const normalized = normalizeGroupEntitlements(entitlements || {});
    return normalized.features?.sso !== false;
}

async function getSsoSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        if (!Number.isInteger(scope.groupId) || scope.groupId <= 0) {
            return res.status(400).json({ error: "group_id_required" });
        }
        const rows = await query("SELECT id, entitlements FROM groups WHERE id = $1 LIMIT 1", [scope.groupId]);
        if (!rows.length) return res.status(404).json({ error: "group_not_found" });
        return res.json({
            groupId: scope.groupId,
            enabled: resolveSsoFeatureValue(rows[0]?.entitlements || {}),
        });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function setSsoSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        if (!Number.isInteger(scope.groupId) || scope.groupId <= 0) {
            return res.status(400).json({ error: "group_id_required" });
        }
        const rows = await query("SELECT id, entitlements FROM groups WHERE id = $1 LIMIT 1", [scope.groupId]);
        if (!rows.length) return res.status(404).json({ error: "group_not_found" });
        const enabled = !!req.body?.enabled;
        const normalized = normalizeGroupEntitlements(rows[0]?.entitlements || {});
        const next = {
            ...normalized,
            features: {
                ...normalized.features,
                sso: enabled,
            },
        };
        await query("UPDATE groups SET entitlements = $2::jsonb WHERE id = $1", [scope.groupId, JSON.stringify(next)]);
        await writeAuditLog({
            req,
            action: "group.sso_setting_updated",
            resourceType: "group",
            resourceId: scope.groupId,
            metadata: { enabled, groupId: scope.groupId },
        });
        return res.json({ success: true, groupId: scope.groupId, enabled });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

return {
  normalizeRevisionCompareSettings,
  normalizeEmailIngestSettings,
  normalizeImportPipelineSettings,
  normalizeReviewDefaultsSettings,
  getReviewDefaultsSetting,
  setReviewDefaultsSetting,
  getImportPipelineSetting,
  setImportPipelineSetting,
  normalizeEmailIngestSenderAllowlist,
  getInsightTranslationCacheSetting,
  setInsightTranslationCacheSetting,
  getAiFeatureTogglesSetting,
  setAiFeatureTogglesSetting,
  getMyAiFeatureTogglesSetting,
  getAiRuntimeSetting,
  normalizeAiSelfLearningSettings,
  getAiSelfLearningSetting,
  setAiSelfLearningSetting,
  listAiLearningFeedback,
  reviewAiLearningFeedback,
  listAiLearningCandidates,
  reviewAiLearningCandidate,
  getAiLearningImpact,
  setAiRuntimeSetting,
  getMetricsExposureSetting,
  getTwoFactorTotpSetting,
  setTwoFactorTotpSetting,
  getSmsOtpSetting,
  setSmsOtpSetting,
  getDlpSetting,
  setDlpSetting,
  setMetricsExposureSetting,
  getAutosyncPollIntervalSetting,
  setAutosyncPollIntervalSetting,
  getRevisionCompareSetting,
  setRevisionCompareSetting,
  getEmailIngestSetting,
  setEmailIngestSetting,
  getMyMetricsExposureSetting,
  getSsoSetting,
  setSsoSetting,
};
}
