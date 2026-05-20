export function withAuditMeta(meta = {}, { badge = "", assumed = false } = {}) {
  return {
    ...(meta && typeof meta === "object" ? meta : {}),
    audit_badge: String(badge || "").trim() || "Calculated using best-matched fields",
    assumed_mapping: !!assumed,
  };
}
