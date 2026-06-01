import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { createSessionMarker, clearStoredAuthTokens, setupAxiosInterceptors } from "../utils/auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => createSessionMarker());
  const [authChecking, setAuthChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorVerifying, setTwoFactorVerifying] = useState(false);

  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [dropboxEnabled, setDropboxEnabled] = useState(true);
  const [oneDriveEnabled, setOneDriveEnabled] = useState(true);
  const [sftpStorageEnabled, setSftpStorageEnabled] = useState(true);
  const [gcsStorageEnabled, setGcsStorageEnabled] = useState(true);
  const [s3StorageEnabled, setS3StorageEnabled] = useState(true);
  const [azureBlobStorageEnabled, setAzureBlobStorageEnabled] = useState(true);
  const integrationStatusCheckedRef = useRef("");

  useEffect(() => {
    setupAxiosInterceptors();
    clearStoredAuthTokens();
  }, []);

  useEffect(() => {
    if (!token) {
      setAuthChecking(false);
      setUser(null);
      return;
    }
    setAuthChecking(true);
    axios.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        setUser(r.data);
        setToken((prev) => prev || createSessionMarker());
      })
      .catch(() => {
        setToken("");
        setUser(null);
      })
      .finally(() => setAuthChecking(false));
  }, [token]);

  useEffect(() => {
    if (authChecking) return;
    if (!user) {
      integrationStatusCheckedRef.current = "";
      return;
    }
    const statusKey = String(user.id || user.email || "session");
    if (integrationStatusCheckedRef.current === statusKey) return;
    integrationStatusCheckedRef.current = statusKey;

    const fetchStatus = (path, setter) => {
      axios.get(`${API}${path}`)
        .then((r) => setter(r?.data?.enabled !== false))
        .catch(() => setter(true));
    };

    fetchStatus("/auth/google/status", setGoogleEnabled);
    fetchStatus("/auth/dropbox/status", setDropboxEnabled);
    fetchStatus("/auth/onedrive/status", setOneDriveEnabled);
    fetchStatus("/storage/sftp_storage/status", setSftpStorageEnabled);
    fetchStatus("/storage/gcs_storage/status", setGcsStorageEnabled);
    fetchStatus("/storage/s3_storage/status", setS3StorageEnabled);
    fetchStatus("/storage/azure_blob_storage/status", setAzureBlobStorageEnabled);
  }, [authChecking, user]);

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    setLoginError("");
    try {
      const res = await axios.post(`${API}/auth/login`, { email, password });
      if (res?.data?.requiresTwoFactor) {
        clearStoredAuthTokens();
        setToken("");
        setUser(null);
        setTwoFactorCode("");
        setTwoFactorChallenge({
          challengeId: String(res.data.challengeId || ""),
          method: String(res.data.method || ""),
          maskedPhone: String(res.data.maskedPhone || ""),
          expiresAt: String(res.data.expiresAt || ""),
        });
        return { requiresTwoFactor: true };
      }
      clearStoredAuthTokens();
      setTwoFactorChallenge(null);
      setTwoFactorCode("");
      setToken(createSessionMarker());
      setUser(res.data.user);
      return res.data.user;
    } catch (err) {
      const message = String(
        err?.response?.data?.error
        || err?.response?.data?.message
        || "Login failed. Check your credentials and try again."
      );
      setLoginError(message);
      throw err;
    }
  };

  const handleVerifyTwoFactor = async (e) => {
    if (e) e.preventDefault();
    if (!twoFactorChallenge?.challengeId) return null;
    setLoginError("");
    setTwoFactorVerifying(true);
    try {
      const res = await axios.post(`${API}/auth/2fa/verify`, {
        challengeId: twoFactorChallenge.challengeId,
        code: twoFactorCode,
      });
      clearStoredAuthTokens();
      setTwoFactorChallenge(null);
      setTwoFactorCode("");
      setToken(createSessionMarker());
      setUser(res.data.user);
      return res.data.user;
    } catch (err) {
      const message = String(
        err?.response?.data?.error
        || err?.response?.data?.message
        || "Verification failed. Check your code and try again."
      );
      setLoginError(message);
      throw err;
    } finally {
      setTwoFactorVerifying(false);
    }
  };

  const handleResendTwoFactorSms = async () => {
    if (!twoFactorChallenge?.challengeId || twoFactorChallenge?.method !== "sms") return null;
    setLoginError("");
    const res = await axios.post(`${API}/auth/2fa/sms/resend`, { challengeId: twoFactorChallenge.challengeId });
    setTwoFactorChallenge((prev) => ({
      ...(prev || {}),
      challengeId: String(res?.data?.challengeId || prev?.challengeId || ""),
      maskedPhone: String(res?.data?.maskedPhone || prev?.maskedPhone || ""),
      expiresAt: String(res?.data?.expiresAt || prev?.expiresAt || ""),
    }));
    setTwoFactorCode("");
    return res.data;
  };

  const clearTwoFactorChallenge = () => {
    setTwoFactorChallenge(null);
    setTwoFactorCode("");
    setLoginError("");
  };

  const handleLogout = () => {
    axios.post(`${API}/auth/logout`).catch(() => {});
    clearStoredAuthTokens();
    localStorage.removeItem("sheetId");
    localStorage.removeItem("activeFilename");
    localStorage.removeItem("activeTab");
    localStorage.removeItem("workspaceChartState:v1");
    setToken("");
    setUser(null);
    setLoginError("");
    setTwoFactorChallenge(null);
    setTwoFactorCode("");
  };

  return {
    user,
    setUser,
    token,
    setToken,
    authChecking,
    email,
    setEmail,
    password,
    setPassword,
    loginError,
    setLoginError,
    twoFactorChallenge,
    twoFactorCode,
    setTwoFactorCode,
    twoFactorVerifying,
    handleLogin,
    handleVerifyTwoFactor,
    handleResendTwoFactorSms,
    clearTwoFactorChallenge,
    handleLogout,
    integrations: {
      googleEnabled,
      dropboxEnabled,
      oneDriveEnabled,
      sftpStorageEnabled,
      gcsStorageEnabled,
      s3StorageEnabled,
      azureBlobStorageEnabled
    }
  };
}
