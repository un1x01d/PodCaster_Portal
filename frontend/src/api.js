import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Pre-configured axios instance
const api = axios.create({
  baseURL: API,
  withCredentials: false,
});

// Attach Authorization header from localStorage, if present
api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {}
  return config;
});

export default api;

