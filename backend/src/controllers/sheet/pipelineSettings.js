export function uploadRequiresApproval() {
  return ["1", "true", "yes", "on"].includes(String(process.env.IMPORT_REQUIRE_APPROVAL || "").trim().toLowerCase());
}

export function uploadUsesDbQueue(req) {
  const requested = req.body?.async_import ?? req.body?.asyncImport ?? req.body?.queue_import ?? req.body?.queueImport;
  if (requested !== undefined) {
    return ["1", "true", "yes", "on"].includes(String(requested || "").trim().toLowerCase());
  }
  return false;
}

export async function importStreamingEnabledBySettings({ query, key }) {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key]);
    const enabled = rows?.[0]?.value?.importStreamingEnabled;
    if (enabled === true || String(enabled || "").trim().toLowerCase() === "true") return true;
  } catch {
    // fallback path below
  }
  return false;
}

export async function queuedImportStreamingV2EnabledBySettings({ query, key }) {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key]);
    const enabled = rows?.[0]?.value?.queuedImportStreamingV2Enabled;
    if (enabled === true || String(enabled || "").trim().toLowerCase() === "true") return true;
  } catch {
    // fallback disabled
  }
  return false;
}

export async function importStagingWriteEnabledBySettings({ query, key, envDefault }) {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key]);
    const enabled = rows?.[0]?.value?.importStagingWriteEnabled;
    if (enabled === true || String(enabled || "").trim().toLowerCase() === "true") return true;
  } catch {}
  return envDefault;
}

export async function importStagingFinalizeEnabledBySettings({ query, key, envDefault }) {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key]);
    const enabled = rows?.[0]?.value?.importStagingFinalizeEnabled;
    if (enabled === true || String(enabled || "").trim().toLowerCase() === "true") return true;
  } catch {}
  return envDefault;
}

export async function firstUploadRequiresReviewBySettings({ query, key }) {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key]);
    const enabled = rows?.[0]?.value?.firstUploadRequiresReview;
    if (enabled === undefined || enabled === null || String(enabled).trim() === "") return true;
    return enabled === true || String(enabled).trim().toLowerCase() === "true";
  } catch {}
  return true;
}

export async function shouldUseQueuedImport(req, deps) {
  if (await importStreamingEnabledBySettings(deps)) return true;
  return uploadUsesDbQueue(req);
}
