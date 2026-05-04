import axios from "axios";

export const SESSION_ACTIVE_TOKEN = "cookie-session";
export const createSessionMarker = () => `${SESSION_ACTIVE_TOKEN}:${Date.now()}`;

export function readCookie(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const hit = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : "";
}

export function clearStoredAuthTokens() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("token");
  window.localStorage.removeItem("authToken");
  window.localStorage.removeItem("jwt");
  window.localStorage.removeItem("jwtToken");
}

export function stripSessionMarkerBearer(headers) {
  if (!headers) return;
  const raw = headers.Authorization ?? headers.authorization ?? "";
  const value = String(raw || "").trim();
  if (
    !value.startsWith(`Bearer ${SESSION_ACTIVE_TOKEN}:`)
    && !["Bearer", "Bearer null", "Bearer undefined"].includes(value)
  ) return;
  if (typeof headers.delete === "function") {
    headers.delete("Authorization");
    headers.delete("authorization");
  }
  delete headers.Authorization;
  delete headers.authorization;
}

export function setupAxiosInterceptors() {
  axios.defaults.withCredentials = true;
  axios.defaults.xsrfCookieName = "csrf_token";
  axios.defaults.xsrfHeaderName = "x-csrf-token";

  axios.interceptors.request.use((config) => {
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
}
