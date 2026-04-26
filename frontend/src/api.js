import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Pre-configured axios instance
const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export default api;
