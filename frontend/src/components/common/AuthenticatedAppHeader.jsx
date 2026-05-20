import React from "react";
import { useLocation } from "react-router-dom";
import DashboardHeader from "../dashboard/DashboardHeader";

export default function AuthenticatedAppHeader({
  user,
  onLogout,
  apiBase,
  token,
  myFiles,
  reportSources,
  reportSourceImports,
  sheetId,
  activeFilename,
  onSwitchSheet,
  onDeleteSheet,
  refreshReportSources,
  onSaveView,
  locale,
  setLocale,
  copy,
  supportedLanguages,
}) {
  const location = useLocation();
  const showHeader = !!user && (location.pathname.startsWith("/workspace") || location.pathname === "/users");
  if (!showHeader) return null;

  return (
    <DashboardHeader
      user={user}
      onLogout={onLogout}
      apiBase={apiBase}
      token={token}
      myFiles={myFiles}
      reportSources={reportSources}
      reportSourceImports={reportSourceImports}
      sheetId={sheetId}
      activeFilename={activeFilename}
      onSwitchSheet={onSwitchSheet}
      onDeleteSheet={onDeleteSheet}
      refreshReportSources={refreshReportSources}
      onSaveView={onSaveView}
      locale={locale}
      setLocale={setLocale}
      copy={copy}
      supportedLanguages={supportedLanguages}
    />
  );
}
