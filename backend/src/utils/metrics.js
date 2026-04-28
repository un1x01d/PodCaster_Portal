const appStartMs = Date.now();
const httpRequestTotals = new Map();
const httpRequestDurationMs = new Map();

function sanitizeLabel(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ");
}

function bucketizeMs(ms) {
  if (ms <= 10) return "le_10";
  if (ms <= 25) return "le_25";
  if (ms <= 50) return "le_50";
  if (ms <= 100) return "le_100";
  if (ms <= 250) return "le_250";
  if (ms <= 500) return "le_500";
  if (ms <= 1000) return "le_1000";
  return "gt_1000";
}

export function recordHttpRequest({ method, route, statusCode, durationMs }) {
  const m = String(method || "GET").toUpperCase();
  const r = String(route || "unknown");
  const s = String(statusCode || 0);
  const totalKey = `${m}|${r}|${s}`;
  httpRequestTotals.set(totalKey, (httpRequestTotals.get(totalKey) || 0) + 1);

  const durationKey = `${m}|${r}|${bucketizeMs(Number(durationMs) || 0)}`;
  httpRequestDurationMs.set(durationKey, (httpRequestDurationMs.get(durationKey) || 0) + 1);
}

export function renderPrometheusMetrics() {
  const lines = [];
  const uptimeSeconds = Math.max(0, Math.floor((Date.now() - appStartMs) / 1000));
  const mem = process.memoryUsage();

  lines.push("# HELP app_uptime_seconds Application uptime in seconds");
  lines.push("# TYPE app_uptime_seconds gauge");
  lines.push(`app_uptime_seconds ${uptimeSeconds}`);

  lines.push("# HELP process_resident_memory_bytes Resident memory size in bytes");
  lines.push("# TYPE process_resident_memory_bytes gauge");
  lines.push(`process_resident_memory_bytes ${Number(mem.rss || 0)}`);

  lines.push("# HELP process_heap_used_bytes Heap used in bytes");
  lines.push("# TYPE process_heap_used_bytes gauge");
  lines.push(`process_heap_used_bytes ${Number(mem.heapUsed || 0)}`);

  lines.push("# HELP app_http_requests_total Total HTTP requests by method, route, and status");
  lines.push("# TYPE app_http_requests_total counter");
  for (const [key, value] of httpRequestTotals.entries()) {
    const [method, route, status] = key.split("|");
    lines.push(
      `app_http_requests_total{method="${sanitizeLabel(method)}",route="${sanitizeLabel(route)}",status="${sanitizeLabel(status)}"} ${value}`
    );
  }

  lines.push("# HELP app_http_request_duration_bucket_count HTTP request duration bucket counts");
  lines.push("# TYPE app_http_request_duration_bucket_count counter");
  for (const [key, value] of httpRequestDurationMs.entries()) {
    const [method, route, bucket] = key.split("|");
    lines.push(
      `app_http_request_duration_bucket_count{method="${sanitizeLabel(method)}",route="${sanitizeLabel(route)}",bucket="${sanitizeLabel(bucket)}"} ${value}`
    );
  }

  return `${lines.join("\n")}\n`;
}
