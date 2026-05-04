import { useState, useEffect, useMemo } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export function useViews({ sheetId, token, user }) {
  const [views, setViews] = useState([]);
  const [selectedViewId, setSelectedViewId] = useState("");
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [pendingViewName, setPendingViewName] = useState("");

  useEffect(() => {
    if (!sheetId || !token || !user) {
      setViews([]);
      return;
    }
    axios.get(`${API}/views/${sheetId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setViews(r.data || []))
      .catch(e => {
        console.error("Fetch views failed", e);
        setViews([]);
      });
  }, [sheetId, token, user]);

  const activeViewConfig = useMemo(() => {
    const view = (views || []).find((v) => String(v.id) === String(selectedViewId));
    return view?.config && typeof view.config === "object" ? view.config : null;
  }, [views, selectedViewId]);

  return {
    views,
    setViews,
    selectedViewId,
    setSelectedViewId,
    activeViewConfig,
    showColumnSelector,
    setShowColumnSelector,
    pendingViewName,
    setPendingViewName
  };
}
