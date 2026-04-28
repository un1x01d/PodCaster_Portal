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

function readStoredAuthToken() {
  if (typeof window === "undefined") return "";
  return String(
    window.localStorage.getItem("token")
    || window.localStorage.getItem("authToken")
    || window.localStorage.getItem("jwt")
    || window.localStorage.getItem("jwtToken")
    || ""
  ).trim();
}

// Pre-configured axios instance
const api = axios.create({
  baseURL: API,
  withCredentials: true,
  xsrfCookieName: "csrf_token",
  xsrfHeaderName: "x-csrf-token",
});

api.interceptors.request.use((config) => {
  const method = String(config.method || "get").toUpperCase();
  const authToken = readStoredAuthToken();
  if (authToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${authToken}`;
  }
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
