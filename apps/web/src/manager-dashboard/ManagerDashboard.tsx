import { useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { mesApi, type FactorySimStatus } from "../api/mes";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { AmbassadorDashboard } from "./AmbassadorDashboard";
import { SafetyManager } from "./SafetyManager";
import { EffectivenessAmbassador } from "./EffectivenessAmbassador";
import { EfficiencyAmbassador } from "./EfficiencyAmbassador";
import { SwiftnessAmbassador } from "./SwiftnessAmbassador";
import { CollaborationAmbassador } from "./CollaborationAmbassador";
import { LineManagerTrainingEvaluation } from "../hr/LineManagerTrainingEvaluation";
import { LineManagerDailyPerformance } from "./LineManagerDailyPerformance";

interface Manager {
  id: string; name: string; nameZh: string;
  dept: string; deptZh: string;
  skills: number; files: string;
  currentTask: string; statusCls: string; statusText: string;
  lastActivity: string; priority: string;
}
interface ChatEntry {
  dir: "out" | "in";
  from: string; to: string; text: string; time: string;
}
interface HealthItem { status: string; detail: string }
type HealthData = Record<string, HealthItem>;

type AmbassadorTab = "overview" | "training" | "dailyPerformance" | "safety" | "effectiveness" | "efficiency" | "swiftness" | "collaboration";

const STATUS_CONFIG: Record<string, { cls: string; icon: string }> = {
  online:  { cls: "badge good",  icon: "●" },
  busy:    { cls: "badge warn",  icon: "◐" },
  offline: { cls: "badge error", icon: "○" },
};

const AMBASSADOR_TABS: Array<{ key: AmbassadorTab; labelKey: string; emoji: string }> = [
  { key: "dailyPerformance", labelKey: "nav.managerDashboard",             emoji: "Daily" },
  { key: "training",       labelKey: "hr.subnav.training",               emoji: "Training" },
  { key: "overview",       labelKey: "ambassador.dashboard.title",       emoji: "📊" },
  { key: "safety",         labelKey: "ambassador.safety.title",           emoji: "🛡️" },
  { key: "effectiveness",  labelKey: "ambassador.effectiveness.title",    emoji: "📈" },
  { key: "efficiency",     labelKey: "ambassador.efficiency.title",        emoji: "⚡" },
  { key: "swiftness",      labelKey: "ambassador.swiftness.title",        emoji: "🚀" },
  { key: "collaboration",   labelKey: "ambassador.collaboration.title",   emoji: "🤝" },
];

export function ManagerDashboard({ locale }: { locale: Locale }) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [msgResult, setMsgResult] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedManager, setSelectedManager] = useState<string>("");
  const [messageLog, setMessageLog] = useState<ChatEntry[]>([]);
  const [simStatus, setSimStatus] = useState<FactorySimStatus | null>(null);
  const [ambassadorTab, setAmbassadorTab] = useState<AmbassadorTab>("overview");

  useEffect(() => {
    const fetch = () => {
      apiClient.get<{ data: Manager[] }>("/managers/status").then(r => setManagers(r.data ?? r as any)).catch(() => {});
      apiClient.get<{ data: HealthData }>("/managers/health").then(r => setHealth(r.data ?? r as any)).catch(() => {});
    };
    fetch();
    const iv = setInterval(fetch, 15000);
    return () => clearInterval(iv);
  }, []);

  // ── Factory Simulation live polling ──────────────────────────────
  useEffect(() => {
    const poll = () => {
      mesApi.getFactorySimStatus()
        .then(s => setSimStatus(s))
        .catch(() => setSimStatus(null));
    };
    poll();
    const iv = setInterval(poll, 10000);
    return () => clearInterval(iv);
  }, []);

  const mgrName = (id: string) => {
    const m = managers.find(x => x.id === id);
    return m ? (locale === "zh-CN" ? m.nameZh : m.name) : id;
  };

  const sendMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const from = (fd.get("from") as string) || "human";
    const to = fd.get("to") as string;
    const text = fd.get("message") as string;
    if (!to || !text) return;
    setSending(true);
    const ts = new Date().toLocaleTimeString();
    try {
      type MsgRes = { data: { msg: string; reply?: { from: string; text: string; status: string } } };
      const r = await apiClient.post<MsgRes>("/managers/message", { from, to, message: text });
      setMsgResult(r.data?.msg ?? "✅ " + t("sent.ok", locale));
      const log: ChatEntry[] = [{ dir: "out", from: mgrName(from), to: mgrName(to), text, time: ts }];
      if (r.data?.reply?.text) {
        log.push({ dir: "in", from: mgrName(r.data.reply.from), to: mgrName(from), text: r.data.reply.text, time: new Date().toLocaleTimeString() });
      }
      setMessageLog(prev => [...log, ...prev]);
      (e.target as HTMLFormElement).reset();
      setSelectedManager("");
    } catch { setMsgResult("❌ " + t("send.fail", locale)); }
    setSending(false);
    setTimeout(() => setMsgResult(""), 3000);
  };

  const statusIcon = (s: string) => STATUS_CONFIG[s]?.icon ?? "○";
  const statusBadge = (s: string) => STATUS_CONFIG[s]?.cls ?? "badge error";
  const priorityColor = (p: string) => p === "high" ? "#e53935" : p === "medium" ? "#fb8c00" : "#43a047";
  const hpBadge = (s: string) => s === "ok" ? "✅" : s === "warn" ? "⚠️" : "❌";

  const onlineCount = managers.filter(m => m.statusCls === "online").length;
  const busyCount = managers.filter(m => m.statusCls === "busy").length;
  const offlineCount = managers.filter(m => m.statusCls === "offline").length;

  // ── Ambassador tab content ─────────────────────────────────────────
  if (ambassadorTab !== "overview") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* ── Ambassador tab bar ── */}
        <div style={{ display: "flex", gap: 4, padding: "8px 12px", borderBottom: "1px solid #e0e0e0", background: "#fafafa", flexWrap: "wrap" }}>
          {AMBASSADOR_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setAmbassadorTab(tab.key)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                background: ambassadorTab === tab.key ? "#1565c0" : "#e0e0e0",
                color: ambassadorTab === tab.key ? "#fff" : "#333",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>{tab.emoji}</span>
              <span>{t(tab.labelKey, locale)}</span>
            </button>
          ))}
        </div>
        {/* ── Ambassador content ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 0 0" }}>
          {ambassadorTab === "safety" && <SafetyManager locale={locale} />}
          {ambassadorTab === "training" && <LineManagerTrainingEvaluation locale={locale} />}
          {ambassadorTab === "dailyPerformance" && <LineManagerDailyPerformance locale={locale} />}
          {ambassadorTab === "effectiveness" && <EffectivenessAmbassador locale={locale} />}
          {ambassadorTab === "efficiency" && <EfficiencyAmbassador locale={locale} />}
          {ambassadorTab === "swiftness" && <SwiftnessAmbassador locale={locale} />}
          {ambassadorTab === "collaboration" && <CollaborationAmbassador locale={locale} />}
        </div>
      </div>
    );
  }

  // ── Default ManagerDashboard content ──
  return (
    <div className="screen-stack" style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* ── Summary Bar ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div className="surface-panel" style={{ flex: 1, minWidth: 180, padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#1976d2" }}>{managers.length}</div>
          <div style={{ fontSize: 12, color: "#666" }}>{t("mgr.total", locale)}</div>
        </div>
        <div className="surface-panel" style={{ flex: 1, minWidth: 180, padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#388e3c" }}>{onlineCount}</div>
          <div style={{ fontSize: 12, color: "#666" }}>{t("mgr.online", locale)}</div>
        </div>
        <div className="surface-panel" style={{ flex: 1, minWidth: 180, padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#f57c00" }}>{busyCount}</div>
          <div style={{ fontSize: 12, color: "#666" }}>{t("mgr.busy", locale)}</div>
        </div>
        <div className="surface-panel" style={{ flex: 1, minWidth: 180, padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#d32f2f" }}>{offlineCount}</div>
          <div style={{ fontSize: 12, color: "#666" }}>{t("mgr.offline", locale)}</div>
        </div>
      </div>

      {/* ── Ambassador quick-nav strip ── */}
      <div className="surface-panel" style={{ padding: "10px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 8 }}>📊 {locale === "zh-CN" ? "AI 监督智能体" : "AI Ambassador Agents"}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {AMBASSADOR_TABS.slice(1).map(tab => (
            <button
              key={tab.key}
              onClick={() => setAmbassadorTab(tab.key)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #c0c0c0",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                background: "#f5f5f5",
                color: "#333",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>{tab.emoji}</span>
              <span>{t(tab.labelKey, locale)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Factory Simulation Live Status ── */}
      <div className="surface-panel" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>🏭 {locale === "zh-CN" ? "工厂模拟运行状态" : "Factory Simulation"}</h3>
          <span style={{ fontSize: 11, color: "#999" }}>
            {locale === "zh-CN" ? "每10秒刷新" : "refreshes every 10s"}
          </span>
        </div>
        {simStatus ? (
          <>
            {/* ── Line Runs ── */}
            {simStatus.runs.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>
                  {locale === "zh-CN" ? "产线运行" : "Line Runs"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                  {simStatus.runs.map(r => (
                    <div key={r.line_id} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e0e0e0", background: "#fafafa" }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.line_code}</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 12 }}>
                        <span style={{ color: "#388e3c" }}>▶ {r.running}</span>
                        <span style={{ color: "#f57c00" }}>⏸ {r.paused}</span>
                        <span style={{ color: "#9e9e9e" }}>○ {r.idle}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>
                        {locale === "zh-CN" ? "产出" : "Output"}: <strong>{r.total_output}</strong>
                        {r.last_started && ` · ${new Date(r.last_started).toLocaleTimeString()}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ padding: 12, color: "#999", fontSize: 13, textAlign: "center" }}>
                {locale === "zh-CN" ? "暂无模拟数据 — 请先运行 factory-sim.js seed && rolling" : "No sim data — run factory-sim.js seed && rolling first"}
              </div>
            )}

            {/* ── KPI Row ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
              <div style={{ padding: "10px 12px", borderRadius: 6, background: "#fff3e0", border: "1px solid #ffcc80", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#e65100" }}>{simStatus.stagnation.total}</div>
                <div style={{ fontSize: 11, color: "#555" }}>{locale === "zh-CN" ? "停滞 (24h)" : "Stagnation (24h)"}</div>
                <div style={{ fontSize: 11, color: simStatus.stagnation.open > 0 ? "#d32f2f" : "#388e3c" }}>
                  {locale === "zh-CN" ? "开放" : "Open"}: {simStatus.stagnation.open}
                  {simStatus.stagnation.critical > 0 && ` · ${locale === "zh-CN" ? "严重" : "Critical"}: ${simStatus.stagnation.critical}`}
                </div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 6, background: "#ffebee", border: "1px solid #ef9a9a", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#c62828" }}>{simStatus.scrap.total}</div>
                <div style={{ fontSize: 11, color: "#555" }}>{locale === "zh-CN" ? "报废 (24h)" : "Scrap (24h)"}</div>
                <div style={{ fontSize: 11, color: "#777" }}>
                  {locale === "zh-CN" ? "待批" : "Pending"}: {simStatus.scrap.pending}
                </div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 6, background: "#e3f2fd", border: "1px solid #90caf9", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#1565c0" }}>{simStatus.downtime.total}</div>
                <div style={{ fontSize: 11, color: "#555" }}>{locale === "zh-CN" ? "停机 (24h)" : "Downtime (24h)"}</div>
                <div style={{ fontSize: 11, color: simStatus.downtime.open_dt > 0 ? "#d32f2f" : "#388e3c" }}>
                  {locale === "zh-CN" ? "开放" : "Open"}: {simStatus.downtime.open_dt} · {simStatus.downtime.downtime_min_24h}m {locale === "zh-CN" ? "总计" : "total"}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: 12, color: "#999", fontSize: 13, textAlign: "center" }}>
            {locale === "zh-CN" ? "加载中..." : "Loading..."}
          </div>
        )}
      </div>

      {/* ── Manager Cards ── */}
      <div className="surface-panel" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 12px 0" }}>🤖 {t("mgr.team", locale)}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {managers.map(m => (
            <div key={m.id} className="surface-panel" style={{
              padding: 14, border: "1px solid #e0e0e0", borderRadius: 8, display: "flex", flexDirection: "column", gap: 6,
              borderLeft: `4px solid ${priorityColor(m.priority)}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{locale === "zh-CN" ? m.nameZh : m.name}</strong>
                  <span style={{ fontSize: 11, color: "#999", marginLeft: 6 }}>
                    ({locale === "zh-CN" ? m.deptZh : m.dept})
                  </span>
                </div>
                <span className={statusBadge(m.statusCls)}>
                  {statusIcon(m.statusCls)} {locale === "zh-CN"
                    ? ({ online: "空闲", busy: "运行中", offline: "离线" }[m.statusCls] ?? m.statusCls)
                    : ({ online: "Idle", busy: "Running", offline: "Offline" }[m.statusCls] ?? m.statusCls)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#555" }}>
                <span style={{ fontWeight: 600 }}>{t("task.title", locale)}:</span> {m.currentTask}
              </div>
              <div style={{ fontSize: 12, color: "#555", display: "flex", gap: 16 }}>
                <span>🧩 {m.skills} skills</span>
                <span>📋 {t("mgr.lastActivity", locale)}: {m.lastActivity}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button onClick={() => setSelectedManager(m.id)}
                  style={{ flex: 1, padding: "6px 12px", fontSize: 12, background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 4, cursor: "pointer" }}>
                  📨 {t("send.message", locale)}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Two-column: Health + Communication ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 16 }}>
        {/* System Health */}
        <div className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 10px 0" }}>❤️ {t("health.title", locale)}</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: "2px solid #eee" }}>
              <th style={{ textAlign: "left", padding: "6px 4px" }}>{t("module.name", locale)}</th>
              <th style={{ textAlign: "left", padding: "6px 4px" }}>{t("status.title", locale)}</th>
              <th style={{ textAlign: "left", padding: "6px 4px" }}>{t("detail.title", locale)}</th>
            </tr></thead>
            <tbody>
              {health && Object.entries(health).map(([key, val]) => (
                <tr key={key} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ fontWeight: 600, padding: "6px 4px" }}>{key.toUpperCase()}</td>
                  <td style={{ padding: "6px 4px" }}>{hpBadge(val.status)}</td>
                  <td style={{ fontSize: 11, color: "#777", padding: "6px 4px" }}>{val.detail}</td>
                </tr>
              ))}
              {!health && <tr><td colSpan={3} style={{ padding: 12, color: "#999", textAlign: "center" }}>{t("loading", locale)}</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Communication Hub */}
        <div className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ margin: "0 0 10px 0" }}>📨 {t("mgr.comm", locale)}</h3>
          <form onSubmit={sendMsg} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <select name="from" style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
                <option value="human">🧑 {t("mgr.human", locale)}</option>
                {managers.map(m => (
                  <option key={m.id} value={m.id}>🤖 {locale === "zh-CN" ? m.nameZh : m.name}</option>
                ))}
              </select>
              <span style={{ alignSelf: "center", color: "#999" }}>→</span>
              <select name="to" required value={selectedManager} onChange={e => setSelectedManager(e.target.value)}
                style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }}>
                <option value="">-- {t("select.manager", locale)} --</option>
                {managers.map(m => (
                  <option key={m.id} value={m.id}>🤖 {locale === "zh-CN" ? m.nameZh : m.name}</option>
                ))}
              </select>
            </div>
            <textarea name="message" rows={2} required placeholder={t("message.placeholder", locale)}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #ddd", resize: "vertical", fontSize: 13 }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="submit" disabled={sending}
                style={{ padding: "8px 20px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                {sending ? t("sending.title", locale) : "📤 " + t("send.button", locale)}
              </button>
              {msgResult && <span style={{ fontSize: 12, color: "#388e3c" }}>{msgResult}</span>}
            </div>
          </form>

          {/* Message Log */}
          {messageLog.length > 0 && (
            <div style={{ marginTop: 12, maxHeight: 240, overflowY: "auto", borderTop: "1px solid #eee", paddingTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>{t("mgr.chatlog", locale)}</div>
              {messageLog.map((msg, i) => (
                <div key={i} style={{
                  fontSize: 12, padding: "6px 8px", marginBottom: 4, borderRadius: 6,
                  borderBottom: "1px solid #f0f0f0",
                  background: msg.dir === "in" ? "#f1f8e9" : "#e3f2fd",
                  borderLeft: msg.dir === "in" ? "3px solid #66bb6a" : "3px solid #42a5f5",
                }}>
                  <div>
                    {msg.dir === "in" ? "🤖 " : "🧑 "}
                    <span style={{ fontWeight: 600, color: msg.dir === "in" ? "#2e7d32" : "#1565c0" }}>{msg.dir === "in" ? msg.from : msg.from}</span>
                    <span style={{ color: "#999" }}> → </span>
                    <span style={{ fontWeight: 600, color: msg.dir === "in" ? "#1565c0" : "#2e7d32" }}>{msg.to}</span>
                    <span style={{ color: "#bbb", marginLeft: 8, fontSize: 10 }}>{msg.time}</span>
                  </div>
                  <div style={{ color: "#333", marginTop: 2, paddingLeft: 4 }}>{msg.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
