export function jsonForbidden(res, statusCode = 403) {
  return res.status(statusCode).json({ error: "forbidden" });
}

export function jsonInternalError(res, code = "internal_server_error", statusCode = 500) {
  return res.status(statusCode).json({ error: String(code || "internal_server_error") });
}
