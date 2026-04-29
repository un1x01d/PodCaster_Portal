import { query } from "../config/db.js";

const MAX_METADATA_BYTES = Number.parseInt(process.env.AUDIT_LOG_MAX_METADATA_BYTES || "8192", 10);

function safeMetadata(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
    try {
        const json = JSON.stringify(metadata);
        if (Buffer.byteLength(json, "utf8") <= MAX_METADATA_BYTES) return metadata;
        return { truncated: true, reason: "metadata_too_large" };
    } catch {
        return { truncated: true, reason: "metadata_not_serializable" };
    }
}

export async function writeAuditLog({ req, actorUserId, action, resourceType, resourceId, metadata }) {
    if (!action) return;
    try {
        await query(
            `INSERT INTO audit_logs
               (actor_user_id, action, resource_type, resource_id, request_id, ip, user_agent, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
            [
                actorUserId || req?.user?.id || null,
                String(action).slice(0, 120),
                resourceType ? String(resourceType).slice(0, 80) : null,
                resourceId == null ? null : String(resourceId).slice(0, 200),
                req?.id || req?.requestId || req?.headers?.["x-request-id"] || null,
                req?.ip || null,
                req?.headers?.["user-agent"] ? String(req.headers["user-agent"]).slice(0, 300) : null,
                JSON.stringify(safeMetadata(metadata)),
            ]
        );
    } catch (err) {
        console.error("[audit] write failed:", err?.message || err);
    }
}
