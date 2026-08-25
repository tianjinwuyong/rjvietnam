import { useState, useEffect } from "react";
import {
  Shield, CheckCircle, XCircle, Key, LogOut, Edit3,
  UserCheck, Clock
} from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { AgentProfile } from "./agentData";
import {
  getCounterpart,
  authenticateCounterpart,
  logoutCounterpart,
  updateCounterpartPermissions,
  hasPermission,
  type Counterpart,
  type AgentPermission,
} from "../api/agentChat";

interface Props {
  agent: AgentProfile;
  locale: Locale;
}

const ALL_PERMISSIONS: AgentPermission[] = [
  "chat", "task.assign", "task.view", "task.update", "report.view", "report.export", "admin",
];

const PERM_COLOR: Record<AgentPermission, string> = {
  "chat": "#3b82f6",
  "task.assign": "#f59e0b",
  "task.view": "#22c55e",
  "task.update": "#a78bfa",
  "report.view": "#06b6d4",
  "report.export": "#f97316",
  "admin": "#ef4444",
};

function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function PermissionBadge({ perm, granted, onToggle, canEdit }: {
  perm: AgentPermission;
  granted: boolean;
  onToggle?: (perm: AgentPermission, granted: boolean) => void;
  canEdit: boolean;
}) {
  const color = PERM_COLOR[perm];
  const label = perm;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: granted ? `${color}11` : "var(--surface-2)", border: `1px solid ${granted ? color + "33" : "var(--border)"}`, borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {granted
          ? <CheckCircle size={12} style={{ color }} />
          : <XCircle size={12} style={{ color: "var(--muted)" }} />}
        <span style={{ fontSize: 12, color: granted ? color : "var(--muted)", fontWeight: granted ? 600 : 400 }}>
          {label}
        </span>
      </div>
      {canEdit && onToggle && (
        <button
          onClick={() => onToggle(perm, !granted)}
          style={{
            fontSize: 10, padding: "2px 6px", borderRadius: 3,
            border: `1px solid ${granted ? color : "var(--border)"}`,
            background: "transparent", color: granted ? color : "var(--muted)",
            cursor: "pointer",
          }}
        >
          {granted ? "撤销" : "授权"}
        </button>
      )}
    </div>
  );
}

export function CounterpartAccess({ agent, locale }: Props) {
  const locale_key = locale as "zh-CN" | "en-US" | "vi-VN";
  const [cp, setCp] = useState<Counterpart | null>(null);
  const [loginId, setLoginId] = useState("");
  const [loginError, setLoginError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftPerms, setDraftPerms] = useState<AgentPermission[]>([]);

  useEffect(() => {
    setCp(getCounterpart(agent.id));
    setLoginId("");
    setLoginError("");
  }, [agent.id]);

  if (!cp) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
        <Shield size={24} style={{ display: "block", margin: "0 auto 8px", opacity: 0.4 }} />
        {locale_key === "zh-CN" ? "未找到对接人信息" : "Không tìm thấy thông tin đối tác"}
      </div>
    );
  }

  const handleLogin = () => {
    setLoginError("");
    const result = authenticateCounterpart(agent.id, loginId.trim().toUpperCase());
    if (!result) {
      setLoginError(locale_key === "zh-CN" ? "员工编号不正确" : locale_key === "vi-VN" ? "Mã nhân viên không đúng" : "Invalid employee ID");
      return;
    }
    setCp({ ...result });
  };

  const handleLogout = () => {
    logoutCounterpart(agent.id);
    setCp(prev => prev ? { ...prev, authenticated: false, lastLoginAt: undefined } : null);
  };

  const handlePermToggle = (perm: AgentPermission, granted: boolean) => {
    const next = granted
      ? [...(editing ? draftPerms : cp.permissions), perm]
      : (editing ? draftPerms : cp.permissions).filter((p) => p !== perm);
    if (editing) {
      setDraftPerms(next);
    } else {
      const updated = updateCounterpartPermissions(agent.id, next);
      if (updated) setCp({ ...updated });
    }
  };

  const handleSavePerms = () => {
    const updated = updateCounterpartPermissions(agent.id, draftPerms);
    if (updated) setCp({ ...updated });
    setEditing(false);
  };

  const effectivePerms = editing ? draftPerms : cp.permissions;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Auth card */}
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <UserCheck size={13} style={{ color: "var(--info)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-2)" }}>
            {locale_key === "zh-CN" ? "对接人认证" : locale_key === "vi-VN" ? "Xác thực đối tác" : "Counterpart Auth"}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: cp.authenticated ? "#22c55e" : "#ef4444",
              boxShadow: cp.authenticated ? "0 0 6px #22c55e" : "0 0 6px #ef4444",
            }} />
            <span style={{ fontSize: 10, color: cp.authenticated ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
              {cp.authenticated
                ? (locale_key === "zh-CN" ? "已认证" : locale_key === "vi-VN" ? "Đã xác thực" : "Authenticated")
                : (locale_key === "zh-CN" ? "未认证" : locale_key === "vi-VN" ? "Chưa xác thực" : "Unauthenticated")}
            </span>
          </div>
        </div>

        {cp.authenticated ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>
                  {locale_key === "zh-CN" ? "姓名" : "Name"}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{cp.name_zh}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{cp.name_en}</div>
              </div>
              <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>
                  {locale_key === "zh-CN" ? "员工编号" : "Employee ID"}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>{cp.employeeId}</div>
              </div>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>
                {locale_key === "zh-CN" ? "部门 / 联系方式" : "Dept / Contact"}
              </div>
              <div style={{ fontSize: 12 }}>{cp.department} · {cp.phone}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{cp.email}</div>
            </div>
            {cp.lastLoginAt && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--muted)" }}>
                <Clock size={10} />
                {locale_key === "zh-CN" ? "最近登录" : locale_key === "vi-VN" ? "Đăng nhập gần nhất" : "Last login"}: {formatTime(cp.lastLoginAt)}
              </div>
            )}
            <button
              onClick={handleLogout}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                padding: "6px 0", borderRadius: 6, border: "1px solid #ef444444",
                background: "#ef444411", color: "#ef4444", fontSize: 11, cursor: "pointer",
              }}
            >
              <LogOut size={11} />
              {locale_key === "zh-CN" ? "退出登录" : locale_key === "vi-VN" ? "Đăng xuất" : "Logout"}
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 8 }}>
              {locale_key === "zh-CN"
                ? `请输入对接人员工编号（${cp.employeeId}）进行认证`
                : locale_key === "vi-VN"
                ? `Nhập mã nhân viên (${cp.employeeId}) để xác thực`
                : `Enter employee ID (${cp.employeeId}) to authenticate`}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={loginId}
                onChange={(e) => { setLoginId(e.target.value); setLoginError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder={locale_key === "zh-CN" ? "员工编号…" : "Employee ID…"}
                style={{
                  flex: 1, padding: "7px 10px", fontSize: 12,
                  border: `1px solid ${loginError ? "#ef4444" : "var(--border)"}`,
                  borderRadius: 6, background: "var(--surface)", color: "var(--text)",
                  outline: "none",
                }}
              />
              <button
                onClick={handleLogin}
                style={{
                  padding: "7px 14px", fontSize: 12, borderRadius: 6,
                  background: "var(--info)", color: "#fff", border: "none", cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {locale_key === "zh-CN" ? "认证" : locale_key === "vi-VN" ? "Xác thực" : "Auth"}
              </button>
            </div>
            {loginError && (
              <div style={{ fontSize: 11, color: "#ef4444", marginTop: 5 }}>{loginError}</div>
            )}
          </div>
        )}
      </div>

      {/* Permissions card */}
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <Key size={13} style={{ color: "var(--info)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-2)" }}>
            {locale_key === "zh-CN" ? "权限列表" : locale_key === "vi-VN" ? "Danh sách quyền" : "Permissions"}
          </span>
          {cp.authenticated && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
              {!editing ? (
                <button
                  onClick={() => { setEditing(true); setDraftPerms([...cp.permissions]); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 3,
                    padding: "3px 8px", fontSize: 10, borderRadius: 4,
                    border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-2)", cursor: "pointer",
                  }}
                >
                  <Edit3 size={10} />
                  {locale_key === "zh-CN" ? "编辑" : "Edit"}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleSavePerms}
                    style={{
                      padding: "3px 8px", fontSize: 10, borderRadius: 4,
                      background: "#22c55e", color: "#fff", border: "none", cursor: "pointer",
                    }}
                  >
                    {locale_key === "zh-CN" ? "保存" : "Save"}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    style={{
                      padding: "3px 8px", fontSize: 10, borderRadius: 4,
                      border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-2)", cursor: "pointer",
                    }}
                  >
                    {locale_key === "zh-CN" ? "取消" : "Cancel"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {cp.authenticated ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {ALL_PERMISSIONS.map((perm) => (
              <PermissionBadge
                key={perm}
                perm={perm}
                granted={effectivePerms.includes(perm)}
                onToggle={editing ? handlePermToggle : undefined}
                canEdit={editing}
              />
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, opacity: 0.5, pointerEvents: "none" }}>
            {ALL_PERMISSIONS.map((perm) => (
              <PermissionBadge
                key={perm}
                perm={perm}
                granted={cp.permissions.includes(perm)}
                canEdit={false}
              />
            ))}
          </div>
        )}
      </div>

      {/* Agent info summary */}
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <Shield size={13} style={{ color: "var(--info)" }} />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-2)" }}>
            {locale_key === "zh-CN" ? "关联虚拟员工" : locale_key === "vi-VN" ? "Nhân viên ảo liên kết" : "Linked Virtual Agent"}
          </span>
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{agent.name_zh}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{agent.name_en} · {agent.name_vi}</div>
          <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>ID: {agent.id}</div>
        </div>
      </div>
    </div>
  );
}
