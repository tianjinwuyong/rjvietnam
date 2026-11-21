import React from "react";
import type { Locale } from "./i18n";
import { t } from "./i18n";

interface Props { locale: Locale }

export default function NotificationPanel({ locale }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", color: "#64748b", fontSize: 16 }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🔔</div>
      <div>{t("tab_notification", locale)}</div>
    </div>
  );
}
