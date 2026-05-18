function parseJsonMaybe(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function parseBooleanLike(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function normalizeReviewLabelRules(value) {
  const parsed = parseJsonMaybe(value, value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([label, enabled]) => [String(label || "").trim(), !!enabled])
      .filter(([label]) => !!label)
      .slice(0, 100)
  );
}

export function resolveReviewPolicy(reportSource, fileLabel, schemaStatus, explicitRequest = false) {
  const labelRules = normalizeReviewLabelRules(reportSource?.reviewLabelRules ?? reportSource?.review_label_rules);
  const label = String(fileLabel || "").trim();
  const labelRequiresReview = label && Object.prototype.hasOwnProperty.call(labelRules, label)
    ? !!labelRules[label]
    : false;
  const sourceRequiresReview = !!(reportSource?.reviewRequired ?? reportSource?.review_required);
  const schemaReviewEnabled = (reportSource?.reviewSchemaChanges ?? reportSource?.review_schema_changes) !== false;
  const schemaRequiresReview = schemaReviewEnabled && String(schemaStatus || "").toLowerCase() === "changed";
  const envRequiresReview = !!explicitRequest;
  return {
    required: sourceRequiresReview || labelRequiresReview || schemaRequiresReview || envRequiresReview,
    reasons: {
      source: sourceRequiresReview,
      label: labelRequiresReview,
      schema: schemaRequiresReview,
      environment: envRequiresReview,
    },
    labelRules,
  };
}

export function parsePositiveIntLike(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseAutosyncConfig(body = {}) {
  const enabled = parseBooleanLike(body?.autosync_enabled ?? body?.autosyncEnabled);
  if (!enabled) return null;

  const provider = String(body?.autosync_provider ?? body?.autosyncProvider ?? "").trim().toLowerCase();
  const sourceRef = String(body?.autosync_source_ref ?? body?.autosyncSourceRef ?? "").trim();
  const groupId = parsePositiveIntLike(body?.autosync_group_id ?? body?.autosyncGroupId);
  const userId = parsePositiveIntLike(body?.autosync_user_id ?? body?.autosyncUserId);
  const remoteMarker = String(body?.autosync_remote_marker ?? body?.autosyncRemoteMarker ?? "").trim() || null;
  const remoteModifiedAt = String(body?.autosync_remote_modified_at ?? body?.autosyncRemoteModifiedAt ?? "").trim() || null;
  const displayName = String(body?.autosync_display_name ?? body?.autosyncDisplayName ?? "").trim() || null;
  const fileLabel = String(body?.autosync_file_label ?? body?.autosyncFileLabel ?? "").trim() || null;

  if (!provider || !sourceRef || !userId) return null;

  return {
    enabled: true,
    provider,
    sourceRef,
    groupId,
    userId,
    remoteMarker,
    remoteModifiedAt,
    displayName,
    fileLabel,
  };
}
