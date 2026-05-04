import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const hit = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : "";
}

// Pre-configured axios instance
const api = axios.create({
  baseURL: API,
  withCredentials: true,
  xsrfCookieName: "csrf_token",
  xsrfHeaderName: "x-csrf-token",
});

function stripSessionMarkerBearer(headers) {
  if (!headers) return;
  const raw = headers.Authorization ?? headers.authorization ?? "";
  const value = String(raw || "").trim();
  if (
    !value.startsWith("Bearer cookie-session:")
    && !["Bearer", "Bearer null", "Bearer undefined"].includes(value)
  ) return;
  if (typeof headers.delete === "function") {
    headers.delete("Authorization");
    headers.delete("authorization");
  }
  delete headers.Authorization;
  delete headers.authorization;
}

api.interceptors.request.use((config) => {
  stripSessionMarkerBearer(config.headers);
  const method = String(config.method || "get").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = readCookie("csrf_token");
    if (token) {
      config.headers = config.headers || {};
      config.headers["x-csrf-token"] = token;
    }
  }
  return config;
});

export default api;
