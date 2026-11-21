import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { getToken } from "./api";
import type { Locale } from "./i18n";
import { t } from "./i18n";
import LoginScreen from "./auth";
import CheckinPanel from "./CheckinPanel";
import LeavePanel from "./LeavePanel";
import AttendancePanel from "./AttendancePanel";
import SalaryPanel from "./SalaryPanel";
import NotificationPanel from "./NotificationPanel";
import ProfilePanel from "./ProfilePanel";

type TabKey = "checkin" | "leave" | "attendance" | "salary" | "notification" | "profile";

const TABS: { key: TabKey; icon: string; labelKey: string }[] = [
  { key: "checkin", icon: "📍", labelKey: "tab_checkin" },
  { key: "leave", icon: "📝", labelKey: "tab_leave" },
  { key: "attendance", icon: "📊", labelKey: "tab_attendance" },
  { key: "salary", icon: "💰", labelKey: "tab_salary" },
  { key: "notification", icon: "🔔", labelKey: "tab_notification" },
  { key: "profile", icon: "👤", labelKey: "tab_profile" },
];

function App() {
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const [activeTab, setActiveTab] = useState<TabKey>("checkin");

  if (!loggedIn) {
    return <LoginScreen locale={locale} onLogin={() => setLoggedIn(true)} />;
  }

  const renderPanel = () => {
    switch (activeTab) {
      case "checkin": return <CheckinPanel locale={locale} />;
      case "leave": return <LeavePanel locale={locale} />;
      case "attendance": return <AttendancePanel locale={locale} />;
      case "salary": return <SalaryPanel locale={locale} />;
      case "notification": return <NotificationPanel locale={locale} />;
      case "profile": return <ProfilePanel locale={locale} />;
    }
  };

  const locales: Locale[] = ["zh-CN", "vi-VN", "en-US"];
  const localeLabels: Record<Locale, string> = { "zh-CN": "中文", "vi-VN": "Tiếng Việt", "en-US": "English" };

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: "#1e293b", borderBottom: "1px solid #334155", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👤</div>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{t("app_title", locale)}</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {locales.map(l => (
            <button key={l} onClick={() => setLocale(l)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: locale === l ? 700 : 400, background: locale === l ? "#3b82f6" : "#334155", color: "#fff" }}>
              {localeLabels[l]}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "12px 12px 80px" }}>
        {renderPanel()}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100, background: "#1e293b", borderTop: "1px solid #334155", display: "flex", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ flex: 1, padding: "8px 2px", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: activeTab === tab.key ? "#3b82f6" : "#64748b", transition: "color 0.2s" }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: activeTab === tab.key ? 600 : 400 }}>{t(tab.labelKey, locale)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
