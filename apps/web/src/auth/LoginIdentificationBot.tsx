import { useMemo } from "react";
import { Bot } from "lucide-react";
import { demoDirectory } from "../data";
import type { Locale, MultilingualText } from "../../../../packages/shared-types/src/factory";

interface Props {
  username: string;
  locale: Locale;
}

const ROLE_KEY_COLORS: Record<string, string> = {
  management: "#ef4444", admin: "#6366f1", pmc: "#a78bfa",
  warehouse: "#f59e0b", iqc: "#22c55e", quality: "#22c55e",
  production: "#3b82f6", engineering: "#06b6d4",
};

/** Map locale code to MultilingualText key */
function localeKey(locale: Locale): "name_zh" | "name_en" | "name_vi" {
  if (locale === "zh-CN") return "name_zh";
  if (locale === "en-US") return "name_en";
  return "name_vi";
}

export function LoginIdentificationBot({ username, locale }: Props) {
  const user = useMemo(() => {
    if (!username.trim()) return null;
    return demoDirectory.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase(),
    ) ?? null;
  }, [username]);

  if (!username.trim()) {
    return (
      <div className="surface-panel" style={{ padding: 20, textAlign: "center" }}>
        <Bot size={48} style={{ color: "var(--text-3)", margin: "0 auto 12px" }} />
        <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0 }}>
          {locale === "zh-CN" ? "输入用户名开始识别" :
           locale === "vi-VN" ? "Nhập tên người dùng để bắt đầu nhận diện" :
           "Enter username to identify"}
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="surface-panel" style={{ padding: 20, textAlign: "center" }}>
        <Bot size={48} style={{ color: "var(--danger)", margin: "0 auto 12px" }} />
        <p style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>
          {locale === "zh-CN" ? "未知用户" : locale === "vi-VN" ? "Người dùng không xác định" : "Unknown User"}
        </p>
        <p style={{ color: "var(--text-3)", fontSize: 11, margin: 0 }}>{username}</p>
      </div>
    );
  }

  const color = ROLE_KEY_COLORS[user.roleKey] ?? "#6366f1";
  const lk = localeKey(locale);
  const roleName: string = user.roleName?.[lk] ?? user.roleName?.name_en ?? user.roleKey;

  return (
    <div className="surface-panel" style={{ padding: 20 }}>
      {/* Robot Avatar */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%",
          background: `linear-gradient(135deg, ${color}44, ${color}22)`,
          border: `2px solid ${color}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 10px",
          boxShadow: `0 0 20px ${color}44`,
        }}>
          <Bot size={40} style={{ color }} />
        </div>
        <div style={{
          display: "inline-block",
          background: color + "22", color: color,
          border: `1px solid ${color}44`,
          borderRadius: 20, padding: "2px 12px",
          fontSize: 10, fontWeight: 700, letterSpacing: 1,
          textTransform: "uppercase",
        }}>
          {locale === "zh-CN" ? "● 已识别" : locale === "vi-VN" ? "● Đã nhận diện" : "● IDENTIFIED"}
        </div>
      </div>

      {/* Identity */}
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>
          {user.displayName}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 2 }}>
          {roleName}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          @{user.username}
        </div>
      </div>

      {/* Three-language role name */}
      {user.roleName && (
        <div style={{
          background: "var(--surface-1)", borderRadius: 8,
          border: "1px solid var(--border)", padding: "8px 10px",
          marginBottom: 10, fontSize: 11,
        }}>
          {(["name_zh", "name_en", "name_vi"] as const).map((mk, i) => {
            const labels: Record<typeof mk, string> = { name_zh: "中文", name_en: "EN", name_vi: "VN" };
            const localeCodes: Record<typeof mk, Locale> = { name_zh: "zh-CN", name_en: "en-US", name_vi: "vi-VN" };
            const isActive = locale === localeCodes[mk];
            const text = user.roleName?.[mk] ?? "-";
            return (
              <div key={mk} style={{ display: "flex", gap: 6, marginBottom: i < 2 ? 4 : 0 }}>
                <span style={{
                  width: 24, flexShrink: 0,
                  color: isActive ? color : "var(--text-3)",
                  fontWeight: isActive ? 700 : 400,
                  fontSize: 10,
                }}>
                  {labels[mk]}
                </span>
                <span style={{
                  color: isActive ? "var(--text-1)" : "var(--text-2)",
                  fontWeight: isActive ? 600 : 400,
                }}>
                  {text}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Status row */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 6, fontSize: 11, color: "var(--text-3)",
      }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
        {locale === "zh-CN" ? "在职" : locale === "vi-VN" ? "Đang làm việc" : "Active"} · {user.locale}
      </div>
    </div>
  );
}
