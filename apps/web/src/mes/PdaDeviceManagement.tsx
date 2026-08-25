import { useState, useEffect, useCallback } from "react";
import {
  pdaApi,
  type PdaDevice,
  type PdaAssignment,
  type PdaRepair,
  type PdaSoftwareVersion,
  type PdaAuditEntry,
  type PdaManagedApp,
} from "../api/pda";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

type Tab = "device" | "assign" | "repair" | "software" | "audit" | "app";

const STATUS_COLOR: Record<string, string> = {
  IN_STOCK: "var(--accent-cyan)", ASSIGNED: "var(--ok)",
  IN_REPAIR: "var(--warn)", LOST: "var(--danger)",
  DAMAGED: "var(--danger)", RETIRED: "var(--muted)", QUARANTINED: "var(--danger)",
  // app status colors
  ACTIVE: "var(--ok)", DEPRECATED: "var(--warn)", IN_DEVELOPMENT: "var(--accent-cyan)",
};
const ACTION_COLOR: Record<string, string> = {
  RECEIVE: "var(--ok)", ASSIGN: "var(--accent)",
  RETURN: "var(--muted)", TRANSFER: "var(--warn)",
  LOSS_REPORT: "var(--danger)", DAMAGE_REPORT: "var(--danger)",
};
const APP_TYPE_COLOR: Record<string, string> = {
  ANDROID_APK: "#4CAF50", ELECTRON: "#2196F3",
  PYTHON_SCRIPT: "#FF9800", WEB_APP: "#9C27B0", CAPACITOR_APP: "#00BCD4",
};

const S = {
  tabRow: { display: "flex", gap: "4px", marginBottom: "16px", borderBottom: "1px solid var(--border)", pb: "4px" },
  tab: (a: boolean) => ({
    padding: "8px 16px", borderRadius: "6px 6px 0 0", border: "none", cursor: "pointer",
    fontSize: "14px", fontWeight: a ? "600" : "400" as const,
    background: a ? "var(--accent)" : "transparent", color: a ? "#fff" : "var(--text-primary)",
  }),
  tb: { display: "flex", gap: "8px", mb: "12px", alignItems: "center" as const, flexWrap: "wrap" as const },
  inp: {
    p: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)",
    background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "13px",
  },
  sel: {
    p: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)",
    background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "13px",
  },
  btn: (bg = "var(--accent)") => ({
    padding: "6px 14px", borderRadius: "6px", border: "none", cursor: "pointer",
    fontSize: "13px", background: bg, color: "#fff", whiteSpace: "nowrap" as const,
  }),
  tbl: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: { textAlign: "left" as const, padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: "500" as const, whiteSpace: "nowrap" as const },
  td: { padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-primary)", whiteSpace: "nowrap" as const },
  badge: (bg: string) => ({ display: "inline-block", padding: "1px 8px", borderRadius: "10px", fontSize: "11px", background: bg, color: "#fff" }),
  ov: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center" as const, justifyContent: "center" as const, zIndex: 1000 },
  md: { background: "var(--bg-primary)", borderRadius: "10px", padding: "24px", minWidth: "420px", maxWidth: "90vw", maxHeight: "85vh", overflow: "auto" as const, border: "1px solid var(--border)" },
  mt: { fontSize: "16px", fontWeight: "600" as const, marginBottom: "16px", color: "var(--text-primary)" },
  fd: { display: "flex", flexDirection: "column" as const, gap: "4px", mb: "12px" },
  lb: { fontSize: "12px", color: "var(--muted)" },
  mbtns: { display: "flex", gap: "8px", justifyContent: "flex-end" as const, mt: "16px" },
  empty: { textAlign: "center" as const, padding: "40px", color: "var(--muted)", fontSize: "14px" },
  ld: { textAlign: "center" as const, padding: "40px", color: "var(--muted)" },
  err: { textAlign: "center" as const, padding: "24px", color: "var(--danger)" },
  lk: { background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "13px", padding: "0 4px" },
  wr: { overflowX: "auto" as const, marginTop: "8px" },
};

function StatusBadge({ status }: { status: string }) {
  return <span style={S.badge(STATUS_COLOR[status] ?? "var(--muted)")}>{status}</span>;
}
function ActionBadge({ action }: { action: string }) {
  return <span style={S.badge(ACTION_COLOR[action] ?? "var(--muted)")}>{action}</span>;
}

// ── Modal helpers ──────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={S.ov} onClick={onClose}>
      <div style={S.md as React.CSSProperties} onClick={(e) => e.stopPropagation()}>
        <div style={S.mt}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={S.fd as React.CSSProperties}>
      <label style={S.lb}>{label}</label>
      {children}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────

export function PdaDeviceManagement({ locale: _locale }: { locale: Locale }) {
  const [tab, setTab] = useState<Tab>("device");
  const [devices, setDevices] = useState<PdaDevice[]>([]);
  const [devLoading, setDevLoading] = useState(true);
  const [devError, setDevError] = useState<string | null>(null);
  const [showDevForm, setShowDevForm] = useState(false);
  const [editDev, setEditDev] = useState<PdaDevice | null>(null);
  const [devForm, setDevForm] = useState<Partial<PdaDevice>>({ deviceStatus: "IN_STOCK" });

  const [assignments, setAssignments] = useState<PdaAssignment[]>([]);
  const [aLoading, setALoading] = useState(false);
  const [showAForm, setShowAForm] = useState(false);
  const [aForm, setAForm] = useState<Partial<PdaAssignment>>({ action: "ASSIGN", operatorBadge: "" });

  const [repairs, setRepairs] = useState<PdaRepair[]>([]);
  const [rLoading, setRLoading] = useState(false);
  const [showRForm, setShowRForm] = useState(false);
  const [editR, setEditR] = useState<PdaRepair | null>(null);
  const [rForm, setRForm] = useState<Partial<PdaRepair>>({ issueCategory: "HARDWARE", severity: "MINOR", repairStatus: "REPORTED" });

  const [sw, setSw] = useState<PdaSoftwareVersion[]>([]);
  const [swL, setSwL] = useState(false);
  const [audit, setAudit] = useState<PdaAuditEntry[]>([]);
  const [aL, setAL] = useState(false);
  const [aF, setAF] = useState("");

  const [apps, setApps] = useState<PdaManagedApp[]>([]);
  const [appLoading, setAppLoading] = useState(false);
  const [showAppForm, setShowAppForm] = useState(false);
  const [editApp, setEditApp] = useState<PdaManagedApp | null>(null);
  const [appForm, setAppForm] = useState<Partial<PdaManagedApp>>({ appType: "ANDROID_APK", appStatus: "ACTIVE" });
  const [appFilter, setAppFilter] = useState("");

  const loadDev = useCallback(async () => {
    setDevLoading(true); setDevError(null);
    try { const r = await pdaApi.getDevices({ limit: 500 }); setDevices(r.items ?? []); }
    catch { setDevError("加载设备列表失败"); } finally { setDevLoading(false); }
  }, []);

  const loadAss = useCallback(async () => {
    setALoading(true);
    try { const r = await pdaApi.getAssignments({ limit: 200 }); setAssignments(r.items ?? []); }
    catch { /* silent */ } finally { setALoading(false); }
  }, []);

  const loadRep = useCallback(async () => {
    setRLoading(true);
    try { const r = await pdaApi.getRepairs({ limit: 200 }); setRepairs(r.items ?? []); }
    catch { /* silent */ } finally { setRLoading(false); }
  }, []);

  const loadSw = useCallback(async () => {
    setSwL(true);
    try { const r = await pdaApi.getSoftwareVersions({ limit: 200 }); setSw(r.items ?? []); }
    catch { /* silent */ } finally { setSwL(false); }
  }, []);

  const loadAud = useCallback(async () => {
    setAL(true);
    try {
      const p: Record<string, string> = { limit: "200" };
      if (aF) p.eventType = aF;
      const r = await pdaApi.getAuditLog(p as any);
      setAudit(r.items ?? []);
    } catch { /* silent */ } finally { setAL(false); }
  }, [aF]);

  const loadApps = useCallback(async () => {
    setAppLoading(true);
    try {
      const p: Record<string, string> = { limit: "200" };
      if (appFilter) p.q = appFilter;
      const r = await pdaApi.getManagedApps(p as any);
      setApps(r.items ?? []);
    } catch { /* silent */ } finally { setAppLoading(false); }
  }, [appFilter]);

  useEffect(() => { loadDev(); }, [loadDev]);
  useEffect(() => { if (tab === "assign") loadAss(); }, [tab, loadAss]);
  useEffect(() => { if (tab === "repair") loadRep(); }, [tab, loadRep]);
  useEffect(() => { if (tab === "software") loadSw(); }, [tab, loadSw]);
  useEffect(() => { if (tab === "audit") loadAud(); }, [tab, loadAud, aF]);
  useEffect(() => { if (tab === "app") loadApps(); }, [tab, loadApps]);

  const hDev = async () => {
    if (editDev) await pdaApi.updateDevice(editDev.id, devForm);
    else await pdaApi.createDevice(devForm);
    setShowDevForm(false); setEditDev(null); setDevForm({ deviceStatus: "IN_STOCK" }); await loadDev();
  };
  const delDev = async (id: number) => { await pdaApi.deleteDevice(id); await loadDev(); };
  const hAss = async () => { await pdaApi.createAssignment(aForm); setShowAForm(false); setAForm({ action: "ASSIGN", operatorBadge: "" }); await loadAss(); };
  const hRep = async () => {
    if (editR) await pdaApi.updateRepair(editR.id, rForm);
    else await pdaApi.createRepair(rForm);
    setShowRForm(false); setEditR(null); setRForm({ issueCategory: "HARDWARE", severity: "MINOR", repairStatus: "REPORTED" }); await loadRep();
  };
  const vrfy = async (id: number) => { await pdaApi.verifyRepair(id, "admin"); await loadRep(); };
  const stChg = async (id: number, s: string) => { await pdaApi.updateDeviceStatus(id, s); await loadDev(); };
  const hApp = async () => {
    if (editApp) await pdaApi.updateManagedApp(editApp.id, appForm);
    else await pdaApi.createManagedApp(appForm);
    setShowAppForm(false); setEditApp(null); setAppForm({ appType: "ANDROID_APK", appStatus: "ACTIVE" }); await loadApps();
  };
  const delApp = async (id: number) => { await pdaApi.deleteManagedApp(id); await loadApps(); };

  const TABS: { key: Tab; label: string }[] = [
    { key: "device", label: "设备台账" }, { key: "assign", label: "领用发放" },
    { key: "repair", label: "维修管理" }, { key: "software", label: "软件版本" },
    { key: "app", label: "应用管理" }, { key: "audit", label: "操作审计" },
  ];

  const ib = (k: string, v: any, set: (v: any) => void) => ({
    value: (v ?? "") as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      set((prev: any) => ({ ...prev, [k]: e.target.value })),
    style: S.inp as React.CSSProperties,
  });

  return (
    <div style={{ padding: "16px" }}>
      <div style={S.tabRow as React.CSSProperties}>
        {TABS.map((t) => (
          <button key={t.key} style={S.tab(tab === t.key) as React.CSSProperties} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* ── Device ── */}
      {tab === "device" && (
        <div>
          <div style={S.tb as React.CSSProperties}>
            <button style={S.btn() as React.CSSProperties} onClick={() => { setEditDev(null); setDevForm({ deviceStatus: "IN_STOCK" }); setShowDevForm(true); }}>+ 注册新设备</button>
          </div>
          {devLoading ? <div style={S.ld}>加载中...</div> : devError ? <div style={S.err}>{devError}</div> : devices.length === 0 ? (
            <div style={S.empty}>暂无设备数据</div>
          ) : (
            <div style={S.wr}>
              <table style={S.tbl}>
                <thead><tr>{["设备编号", "序列号", "型号", "状态", "领用人", "产线", "Android", "App", "操作"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {devices.map(d => (
                    <tr key={d.id}>
                      <td style={S.td}><b>{d.deviceCode}</b></td>
                      <td style={S.td}>{d.serialNo}</td>
                      <td style={S.td}>{d.deviceModel}</td>
                      <td style={S.td}><StatusBadge status={d.deviceStatus} /></td>
                      <td style={S.td}>{d.assignedTo || "-"}</td>
                      <td style={S.td}>{d.lineCode || "-"}</td>
                      <td style={S.td}>{d.androidVersion || "-"}</td>
                      <td style={S.td}>{d.appVersion || "-"}</td>
                      <td style={S.td}>
                        <button style={S.lk} onClick={() => { setEditDev(d); setDevForm(d); setShowDevForm(true); }}>编辑</button>
                        <button style={S.lk} onClick={() => delDev(d.id)}>删</button>
                        <select style={{ ...S.sel, fontSize: "11px", marginLeft: "4px" } as React.CSSProperties} value="" onChange={e => { if (e.target.value) stChg(d.id, e.target.value); }}>
                          <option value="">改状态</option>
                          {["IN_STOCK", "ASSIGNED", "LOST", "DAMAGED", "IN_REPAIR", "RETIRED", "QUARANTINED"].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showDevForm && (
            <Modal title={editDev ? "编辑设备" : "注册新设备"} onClose={() => { setShowDevForm(false); setEditDev(null); }}>
              {[
                ["deviceCode", "设备编号"], ["serialNo", "序列号"], ["deviceModel", "型号"],
                ["manufacturer", "厂商"], ["imei", "IMEI"], ["androidVersion", "Android版本"],
                ["location", "位置"], ["lineCode", "产线"], ["notes", "备注"],
              ].map(([k, lbl]) => (
                <Field key={k} label={lbl}>
                  <input {...ib(k, (devForm as any)[k], setDevForm)} />
                </Field>
              ))}
              <Field label="状态">
                <select {...ib("deviceStatus", devForm.deviceStatus, setDevForm)}>
                  {["IN_STOCK", "ASSIGNED", "LOST", "DAMAGED", "IN_REPAIR", "RETIRED", "QUARANTINED"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <div style={S.mbtns as React.CSSProperties}>
                <button style={S.btn("var(--muted)") as React.CSSProperties} onClick={() => { setShowDevForm(false); setEditDev(null); }}>取消</button>
                <button style={S.btn() as React.CSSProperties} onClick={hDev}>保存</button>
              </div>
            </Modal>
          )}
        </div>
      )}

      {/* ── Assignment ── */}
      {tab === "assign" && (
        <div>
          <div style={S.tb as React.CSSProperties}>
            <button style={S.btn() as React.CSSProperties} onClick={() => { setAForm({ action: "ASSIGN", operatorBadge: "" }); setShowAForm(true); }}>+ 新建领用记录</button>
          </div>
          {aLoading ? <div style={S.ld}>加载中...</div> : assignments.length === 0 ? <div style={S.empty}>暂无领用记录</div> : (
            <div style={S.wr}>
              <table style={S.tbl}>
                <thead><tr>{["操作", "设备ID", "从", "到", "原因", "工号", "时间"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.id}>
                      <td style={S.td}><ActionBadge action={a.action} /></td>
                      <td style={S.td}>{a.deviceId}</td>
                      <td style={S.td}>{a.fromPerson || "-"}</td>
                      <td style={S.td}>{a.toPerson || "-"}</td>
                      <td style={S.td}>{a.reason || "-"}</td>
                      <td style={S.td}>{a.operatorBadge}</td>
                      <td style={S.td}>{new Date(a.occurredAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showAForm && (
            <Modal title="新建领用记录" onClose={() => setShowAForm(false)}>
              <Field label="设备ID"><input type="number" {...ib("deviceId", aForm.deviceId, setAForm)} /></Field>
              <Field label="操作类型">
                <select {...ib("action", aForm.action, setAForm)}>
                  {["RECEIVE", "ASSIGN", "RETURN", "TRANSFER", "LOSS_REPORT", "DAMAGE_REPORT"].map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="领出人"><input {...ib("fromPerson", aForm.fromPerson, setAForm)} /></Field>
              <Field label="领用人"><input {...ib("toPerson", aForm.toPerson, setAForm)} /></Field>
              <Field label="原因"><input {...ib("reason", aForm.reason, setAForm)} /></Field>
              <Field label="工号"><input {...ib("operatorBadge", aForm.operatorBadge, setAForm)} /></Field>
              <div style={S.mbtns as React.CSSProperties}>
                <button style={S.btn("var(--muted)") as React.CSSProperties} onClick={() => setShowAForm(false)}>取消</button>
                <button style={S.btn() as React.CSSProperties} onClick={hAss}>保存</button>
              </div>
            </Modal>
          )}
        </div>
      )}

      {/* ── Repair ── */}
      {tab === "repair" && (
        <div>
          <div style={S.tb as React.CSSProperties}>
            <button style={S.btn() as React.CSSProperties} onClick={() => { setEditR(null); setRForm({ issueCategory: "HARDWARE", severity: "MINOR", repairStatus: "REPORTED" }); setShowRForm(true); }}>+ 新建维修单</button>
          </div>
          {rLoading ? <div style={S.ld}>加载中...</div> : repairs.length === 0 ? <div style={S.empty}>暂无维修记录</div> : (
            <div style={S.wr}>
              <table style={S.tbl}>
                <thead><tr>{["编号", "设备ID", "问题", "分类", "严重度", "状态", "报修人", "操作"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {repairs.map(r => (
                    <tr key={r.id}>
                      <td style={S.td}>{r.repairCode}</td>
                      <td style={S.td}>{r.deviceId}</td>
                      <td style={{ ...S.td, maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.issueDesc}</td>
                      <td style={S.td}>{r.issueCategory}</td>
                      <td style={S.td}><StatusBadge status={r.severity} /></td>
                      <td style={S.td}><StatusBadge status={r.repairStatus} /></td>
                      <td style={S.td}>{r.reportedBy}</td>
                      <td style={S.td}>
                        <button style={S.lk} onClick={() => { setEditR(r); setRForm(r); setShowRForm(true); }}>编辑</button>
                        {r.repairStatus === "REPAIRED" && <button style={S.lk} onClick={() => vrfy(r.id)}>验收</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showRForm && (
            <Modal title={editR ? "编辑维修单" : "新建维修单"} onClose={() => { setShowRForm(false); setEditR(null); }}>
              <Field label="设备ID"><input type="number" {...ib("deviceId", rForm.deviceId, setRForm)} /></Field>
              <Field label="问题描述"><textarea rows={3} {...ib("issueDesc", rForm.issueDesc, setRForm)} /></Field>
              <Field label="分类">
                <select {...ib("issueCategory", rForm.issueCategory, setRForm)}>
                  {["HARDWARE", "SOFTWARE", "SCREEN", "BATTERY", "SCANNER", "NETWORK", "CHARGING", "OTHER"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="严重程度">
                <select {...ib("severity", rForm.severity, setRForm)}>
                  <option value="CRITICAL">CRITICAL</option><option value="MAJOR">MAJOR</option><option value="MINOR">MINOR</option>
                </select>
              </Field>
              <Field label="报修人工号"><input {...ib("reportedBy", rForm.reportedBy, setRForm)} /></Field>
              <Field label="备注"><input {...ib("notes", rForm.notes, setRForm)} /></Field>
              <div style={S.mbtns as React.CSSProperties}>
                <button style={S.btn("var(--muted)") as React.CSSProperties} onClick={() => { setShowRForm(false); setEditR(null); }}>取消</button>
                <button style={S.btn() as React.CSSProperties} onClick={hRep}>保存</button>
              </div>
            </Modal>
          )}
        </div>
      )}

      {/* ── Software ── */}
      {tab === "software" && (
        <div>
          {swL ? <div style={S.ld}>加载中...</div> : sw.length === 0 ? <div style={S.empty}>暂无版本记录</div> : (
            <div style={S.wr}>
              <table style={S.tbl}>
                <thead><tr>{["设备ID", "旧版本", "新版本", "方式", "安装人", "结果", "时间"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {sw.map(s => (
                    <tr key={s.id}>
                      <td style={S.td}>{s.deviceId}</td>
                      <td style={S.td}>{s.previousVersion || "-"}</td>
                      <td style={S.td}>{s.newVersion}</td>
                      <td style={S.td}>{s.updateMethod}</td>
                      <td style={S.td}>{s.installedBy}</td>
                      <td style={S.td}><StatusBadge status={s.success ? "SUCCESS" : "FAILED"} /></td>
                      <td style={S.td}>{new Date(s.installedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === "audit" && (
        <div>
          <div style={S.tb as React.CSSProperties}>
            <select style={S.sel as React.CSSProperties} value={aF} onChange={e => setAF(e.target.value)}>
              <option value="">全部类型</option>
              {["SCAN", "BIND", "RELEASE", "LOGIN", "LOGOUT", "HEARTBEAT", "ERROR", "SYNC", "CONFIG_CHANGE", "APP_START", "APP_CRASH"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {aL ? <div style={S.ld}>加载中...</div> : audit.length === 0 ? <div style={S.empty}>暂无审计记录</div> : (
            <div style={S.wr}>
              <table style={S.tbl}>
                <thead><tr>{["事件", "设备", "操作人", "工站", "产线", "工单", "结果", "时间"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {audit.map(a => (
                    <tr key={a.id}>
                      <td style={S.td}><ActionBadge action={a.eventType} /></td>
                      <td style={S.td}>{a.deviceCode || "-"}</td>
                      <td style={S.td}>{a.operatorName || a.operatorBadge || "-"}</td>
                      <td style={S.td}>{a.stationCode || "-"}</td>
                      <td style={S.td}>{a.lineCode || "-"}</td>
                      <td style={S.td}>{a.workOrderCode || "-"}</td>
                      <td style={S.td}>{a.result || "-"}</td>
                      <td style={S.td}>{new Date(a.serverTs).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── App Management ── */}
      {tab === "app" && (
        <div>
          <div style={S.tb as React.CSSProperties}>
            <button style={S.btn() as React.CSSProperties} onClick={() => { setEditApp(null); setAppForm({ appType: "ANDROID_APK", appStatus: "ACTIVE" }); setShowAppForm(true); }}>+ 注册新应用</button>
            <input placeholder="搜索应用名称/编码..." style={S.inp as React.CSSProperties} value={appFilter} onChange={e => setAppFilter(e.target.value)} />
          </div>
          {appLoading ? <div style={S.ld}>加载中...</div> : apps.length === 0 ? <div style={S.empty}>暂无应用数据</div> : (
            <div style={S.wr}>
              <table style={S.tbl}>
                <thead><tr>{["编码", "名称(中)", "名称(EN)", "类型", "平台", "版本", "产线", "状态", "操作"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {apps.map(a => (
                    <tr key={a.id}>
                      <td style={S.td}><b>{a.appCode}</b></td>
                      <td style={S.td}>{a.nameZh}</td>
                      <td style={S.td}>{a.nameEn || "-"}</td>
                      <td style={S.td}><span style={S.badge(APP_TYPE_COLOR[a.appType] ?? "var(--muted)")}>{a.appType}</span></td>
                      <td style={S.td}>{a.targetPlatform || "-"}</td>
                      <td style={S.td}>{a.currentVersion || "-"}</td>
                      <td style={S.td}>{(a.associatedLines ?? []).join(", ") || "-"}</td>
                      <td style={S.td}><StatusBadge status={a.appStatus} /></td>
                      <td style={S.td}>
                        <button style={S.lk} onClick={() => { setEditApp(a); setAppForm(a); setShowAppForm(true); }}>编辑</button>
                        <button style={S.lk} onClick={() => delApp(a.id)}>删</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showAppForm && (
            <Modal title={editApp ? "编辑应用" : "注册新应用"} onClose={() => { setShowAppForm(false); setEditApp(null); }}>
              {[
                ["appCode", "应用编码"], ["nameZh", "名称(中文)"], ["nameEn", "名称(英文)"], ["nameVi", "名称(越南语)"],
                ["targetPlatform", "目标平台"], ["currentVersion", "当前版本"], ["sourcePath", "源码路径"],
              ].map(([k, lbl]) => (
                <Field key={k} label={lbl}>
                  <input {...ib(k, (appForm as any)[k], setAppForm)} disabled={!!(editApp && k === "appCode")} />
                </Field>
              ))}
              <Field label="应用类型">
                <select {...ib("appType", appForm.appType, setAppForm)}>
                  <option value="ANDROID_APK">Android APK</option>
                  <option value="ELECTRON">Electron</option>
                  <option value="PYTHON_SCRIPT">Python Script</option>
                  <option value="WEB_APP">Web App</option>
                  <option value="CAPACITOR_APP">Capacitor App</option>
                </select>
              </Field>
              <Field label="应用状态">
                <select {...ib("appStatus", appForm.appStatus, setAppForm)}>
                  <option value="ACTIVE">ACTIVE - 在用</option>
                  <option value="DEPRECATED">DEPRECATED - 即将停用</option>
                  <option value="RETIRED">RETIRED - 已停用</option>
                  <option value="IN_DEVELOPMENT">IN_DEVELOPMENT - 开发中</option>
                </select>
              </Field>
              <Field label="备注 / 说明">
                <textarea rows={3} {...ib("notes", appForm.notes, setAppForm)} />
              </Field>
              <div style={S.mbtns as React.CSSProperties}>
                <button style={S.btn("var(--muted)") as React.CSSProperties} onClick={() => { setShowAppForm(false); setEditApp(null); }}>取消</button>
                <button style={S.btn() as React.CSSProperties} onClick={hApp}>保存</button>
              </div>
            </Modal>
          )}
        </div>
      )}
    </div>
  );
}
