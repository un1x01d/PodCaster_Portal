import { useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export function useUpload({ token }) {
  const [uploadProgressOpen, setUploadProgressOpen] = useState(false);
  const [uploadProgressLoaded, setUploadProgressLoaded] = useState(0);
  const [uploadProgressTotal, setUploadProgressTotal] = useState(0);
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0);
  const [uploadProgressPhase, setUploadProgressPhase] = useState("uploading");
  const [uploadProgressError, setUploadProgressError] = useState("");

  const handleUpload = async (uploadFile, displayName, options = {}) => {
    const { reportSourceId = "", newReportSourceName = "", fileLabel = "" } = options;
    if (!uploadFile || !displayName) return;
    
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("display_name", String(displayName).trim());
    formData.append("file_label", String(fileLabel || displayName).trim());
    if (reportSourceId) {
      formData.append("report_source_id", reportSourceId);
    } else {
      formData.append("report_source_name", String(newReportSourceName).trim());
    }

    const inferredTotal = Number(uploadFile?.size || 0);
    setUploadProgressOpen(true);
    setUploadProgressLoaded(0);
    setUploadProgressTotal(inferredTotal > 0 ? inferredTotal : 0);
    setUploadProgressPercent(0);
    setUploadProgressPhase("uploading");
    setUploadProgressError("");

    try {
      const res = await axios.post(`${API}/upload`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data"
        },
        onUploadProgress: (progressEvent) => {
          const loaded = Math.max(0, Number(progressEvent?.loaded || 0));
          const eventTotal = Math.max(0, Number(progressEvent?.total || 0));
          const total = eventTotal > 0 ? eventTotal : (inferredTotal > 0 ? inferredTotal : loaded);
          const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
          setUploadProgressLoaded(loaded);
          setUploadProgressTotal(total);
          if (percent >= 100) {
            setUploadProgressPhase("processing");
            setUploadProgressPercent(95);
          } else {
            setUploadProgressPhase("uploading");
            setUploadProgressPercent(Math.max(0, Math.min(95, percent)));
          }
        },
      });
      setUploadProgressPhase("complete");
      setUploadProgressPercent(100);
      return res.data;
    } catch (e) {
      console.error("upload failed:", e);
      const backendMessage = e?.response?.data?.publicMessage || e?.response?.data?.message || e?.response?.data?.error || e?.message || "Upload failed";
      setUploadProgressPhase("failed");
      setUploadProgressPercent(100);
      setUploadProgressError(String(backendMessage));
      throw e;
    }
  };

  const closeUploadProgress = () => {
    setUploadProgressOpen(false);
    setUploadProgressLoaded(0);
    setUploadProgressTotal(0);
    setUploadProgressPercent(0);
    setUploadProgressPhase("uploading");
    setUploadProgressError("");
  };

  return {
    handleUpload,
    uploadProgress: {
      open: uploadProgressOpen,
      loaded: uploadProgressLoaded,
      total: uploadProgressTotal,
      percent: uploadProgressPercent,
      phase: uploadProgressPhase,
      error: uploadProgressError
    },
    closeUploadProgress
  };
}
