import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, Bell, Boxes, CheckCircle2, ClipboardCheck, Factory, Package, RefreshCw, ShieldCheck, Users, XCircle } from "lucide-react";
import { API_BASE } from "./api";
import { wmsApi } from "./api/wms";
import { pdaRoleLabels, resolvePdaRole } from "./pdaRole";

type Locale = "zh-CN" | "en-US" | "vi-VN";
type Tab = "overview" | "team" | "materials" | "quality" | "pickup" | "ngRoute" | "loaderAssignment" | "woRelease" | "approvals" | "reports";
type PickupStatus = "RECEIVED" | "CLAIMED" | "COLLECTED" | "REJECTED" | "BLOCKED";

interface TeamMember { id: number; code: string; displayName?: string; name_zh?: string; position?: string; }
interface Checkin { employee_id: number; checkin_type?: string; }
interface LeaveRequest { id: number; emp_name: string; leave_type_name: string; start_date: string; end_date: string; days_count: number; reason?: string; }
interface PickupAnnouncement { commandId: string; eventId: string; workOrderId: string; bucketQr: string; quantity: number; sourceStation: string; repairStation: string; destinationStation: string; severity?: string; status: string; }
interface NgRouteConfiguration { configuration?: { revision?: string; status?: string; ngClosedLoopDefaults?: { quantityThreshold?: number; timeThresholdMinutes?: number; triggerMode?: string; humanButtonEnabled?: boolean; maxRetests?: number; pickupChannels?: string[] } }; ngPolicies?: Array<{ code: string; appliesTo?: string[]; action?: { route?: string; retestLimit?: number } }> }
interface LoaderAssignment { id: number; assignmentDate: string; shiftCode: string; employeeCode: string; employeeName: string; lineCode: string; roleCode: string; loadingPermission?: string; validFrom: string; validUntil: string; status: string; }
interface PdaLoginRow { id: number; deviceCode?: string; serialNo?: string; lineCode?: string; deviceStatus?: string; currentHolderName?: string; lastOperator?: string; lastEventAt?: string; }
interface LockedWo { code: string; status: string; lineCode?: string; lockedBy?: string | null; lockedAt?: string | null; productCode?: string; productNameZh?: string; }

async function teamFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem("auth_token");
  const response = await fetch(`${API_BASE}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  const body = await response.json();
  return (body.data ?? body) as T;
}

export function GroupLeaderPda({ locale }: { locale: Locale }) {
  const rawUser = sessionStorage.getItem("demo_user");
  const user = rawUser ? JSON.parse(rawUser) : {};
  const pdaRole = resolvePdaRole(user);
  const roleCode = pdaRole === "GROUP_LEADER" ? "TEAM_LEADER" : "LINE_MANAGER";
  const [tab, setTab] = useState<Tab>(() => new URLSearchParams(window.location.search).get("pdaTab") === "woRelease" ? "woRelease" : "overview");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [active, setActive] = useState<Array<{ wo_code: string; product_code: string; cells?: unknown[] }>>([]);
  const [stats, setStats] = useState<any>(null);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [pickupAnnouncements, setPickupAnnouncements] = useState<PickupAnnouncement[]>([]);
  const [pickupBusy, setPickupBusy] = useState<string | null>(null);
  const [ngRouteConfig, setNgRouteConfig] = useState<NgRouteConfiguration | null>(null);
  const [ngTrace, setNgTrace] = useState<Array<Record<string, any>>>([]);
  const tomorrow = useMemo(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }, []);
  const [loaderDate, setLoaderDate] = useState(tomorrow);
  const [loaderShift, setLoaderShift] = useState("DAY");
  const [loaderMember, setLoaderMember] = useState("");
  const [loaderLine, setLoaderLine] = useState(user.lineCode || "MANUAL-01");
  const [loaderDomain, setLoaderDomain] = useState("manual-line");
  const [loaderAssignments, setLoaderAssignments] = useState<LoaderAssignment[]>([]);
  const [pdaLoginRows, setPdaLoginRows] = useState<PdaLoginRow[]>([]);
  const [lockedWos, setLockedWos] = useState<LockedWo[]>([]);
  const [loaderBusy, setLoaderBusy] = useState(false);
  const loaderDomainOptions = [{ value: "auto-line", label: "自动线上料", line: "AUTO-01" }, { value: "manual-line", label: "手动线上料", line: "MANUAL-01" }, { value: "smt", label: "SMT上料", line: "SMT-01" }];
  const lineOptions = useMemo(() => Array.from(new Set([user.lineCode, "AUTO-01", "MANUAL-01", "MANUAL-02", "MANUAL-03", "SMT-01"].filter(Boolean))), [user.lineCode]);
  const pdaContext = { employeeId: user.employeeId || user.id || user.code || "PDA_USER", roleCode, lineCode: user.lineCode || "", shiftCode: user.shiftCode || "", assignmentDate: new Date().toISOString().slice(0, 10) };

  const load = useCallback(async () => {
    setLoading(true); setMessage("");
    try {
      const [team, attendance, pending, loadingStats, loadingActive] = await Promise.all([
        teamFetch<{ members?: TeamMember[] }>("/hr/team/members"),
        teamFetch<{ checkins?: Checkin[] }>("/hr/team/checkins/today"),
        teamFetch<{ leaves?: LeaveRequest[] }>("/hr/leave/pending-approval"),
        wmsApi.getLoadingStats(), wmsApi.getLoadingActive(),
      ]);
      setMembers(team.members ?? []); setCheckins(attendance.checkins ?? []); setLeaves(pending.leaves ?? []); setStats(loadingStats); setActive((loadingActive.items ?? []) as typeof active);
      try {
        const traceResponse = await teamFetch<{ items?: Array<Record<string, any>> }>("/api/station/ng-guard?limit=5000");
        setNgTrace(traceResponse.items ?? []);
      } catch { setNgTrace([]); }
      try { const pickup = await teamFetch<{ items?: PickupAnnouncement[] }>(`/mes/repair/pickup-announcements?domainCode=MANUAL_LINE&roleCode=${roleCode}`); setPickupAnnouncements(pickup.items ?? []); } catch { setPickupAnnouncements([]); }
      if (roleCode === "LINE_MANAGER") { try { setNgRouteConfig(await teamFetch<NgRouteConfiguration>("/mes/route-configurations/bootstrap")); } catch { setNgRouteConfig(null); } }
      if (roleCode === "LINE_MANAGER") { try { const domains = await teamFetch<LoaderAssignment[]>("/api/hr/pda-domains"); setLoaderAssignments((domains ?? []).filter((item) => item.roleCode === "MATERIAL_LOADER")); } catch { setLoaderAssignments([]); } }
      if (roleCode === "LINE_MANAGER") { try { const devices = await teamFetch<{ items?: PdaLoginRow[] }>("/pda/devices?limit=200"); setPdaLoginRows(devices.items ?? []); } catch { setPdaLoginRows([]); } }
      if (roleCode === "LINE_MANAGER") { try { const workOrders = await teamFetch<{ items?: LockedWo[] }>("/pmc/work-orders?status=released&limit=100"); setLockedWos(workOrders.items ?? []); } catch { setLockedWos([]); } }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, [roleCode]);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 5000); return () => window.clearInterval(id); }, [load]);

  const present = useMemo(() => checkins.filter((item) => Boolean(item.checkin_type)).length, [checkins]);
  const respondToPickup = async (item: PickupAnnouncement, feedbackStatus: PickupStatus) => {
    setPickupBusy(item.commandId);
    try {
      await teamFetch("/api/pda/events", { method: "POST", body: JSON.stringify({ eventType: "NG_PICKUP_FEEDBACK", commandId: item.commandId, announcementEventId: item.eventId, domainCode: "MANUAL_LINE", workOrderId: item.workOrderId, bucketQr: item.bucketQr, feedbackStatus, actor: pdaContext.employeeId, roleCode, lineCode: pdaContext.lineCode, occurredAt: new Date().toISOString(), appendOnly: true }) });
      setPickupAnnouncements((rows) => ["COLLECTED", "REJECTED", "BLOCKED"].includes(feedbackStatus) ? rows.filter((row) => row.commandId !== item.commandId) : rows.map((row) => row.commandId === item.commandId ? { ...row, status: feedbackStatus } : row));
      setMessage(`Pickup ${feedbackStatus.toLowerCase()} feedback sent to MES.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setPickupBusy(null); }
  };
  const decideLeave = async (id: number, result: "approved" | "rejected") => { try { await teamFetch("/hr/leave/approve", { method: "POST", body: JSON.stringify({ leaveId: id, result }) }); setMessage(`Leave ${result}`); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  const assignMaterialLoader = async () => {
    const member = members.find((item) => String(item.id) === loaderMember || item.code === loaderMember);
    if (!member) { setMessage("Select a team member before publishing the assignment."); return; }
    setLoaderBusy(true); setMessage("");
    try {
      await teamFetch("/api/hr/pda-domains", { method: "POST", body: JSON.stringify({ assignmentDate: loaderDate, shiftCode: loaderShift, positionNo: 1, employeeCode: member.code, employeeName: member.displayName || member.name_zh || member.code, lineCode: loaderLine, roleCode: "MATERIAL_LOADER", roleNameEn: `${loaderLine} Material Loader`, roleNameZh: `${loaderLine}物料员`, validFrom: `${loaderDate}T06:00:00+07:00`, validUntil: `${loaderDate}T22:00:00+07:00`, loadingPermission: "APPROVE", permissionCodes: [`${loaderDomain}.${loaderLine}.material-loading.execute`, `${loaderDomain}.${loaderLine}.material-loading.scan`], processDomain: loaderDomain }) });
      setMessage(`${loaderLine} loader assigned for ${loaderDate}. MES published the line-specific assignment to the PDA.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setLoaderBusy(false); }
  };
  const releaseWo = async (wo: LockedWo) => {
    if (!window.confirm(`Release WO ${wo.code} from its PDA day lock?`)) return;
    try { await teamFetch(`/pmc/work-orders/${encodeURIComponent(wo.code)}/unlock`, { method: "POST", body: JSON.stringify({ operator: pdaContext.employeeId, force: true }) }); setMessage(`WO ${wo.code} released by Plant Manager.`); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  return <div className="pda-shell" style={{ minHeight: "100vh", background: "#0f172a", color: "#e5e7eb", fontFamily: "system-ui, sans-serif" }}>
    <header style={{ padding: "14px 16px", background: "linear-gradient(135deg,#0f766e,#0e7490)", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ fontSize: 18, fontWeight: 800 }}>{pdaRoleLabels[pdaRole]} PDA</div><div style={{ fontSize: 12, opacity: .8 }}>Unified PDA · MES shared system · {pdaRole}</div></div><button onClick={() => void load()} disabled={loading} style={buttonStyle("rgba(255,255,255,.16)")}>{loading ? "Loading" : <RefreshCw size={18} />}</button></header>
    <main style={{ padding: 12, paddingBottom: 78 }}>{message && <div role="status" style={{ background: "#7f1d1d", padding: 10, borderRadius: 9, marginBottom: 10 }}>{message}</div>}<div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}><Metric icon={<Users size={17} />} value={members.length} text="Team" color="#38bdf8" /><Metric icon={<CheckCircle2 size={17} />} value={present} text="Present" color="#4ade80" /><Metric icon={<AlertTriangle size={17} />} value={Math.max(0, members.length - present)} text="Missing" color="#fbbf24" /><Metric icon={<Package size={17} />} value={stats?.activeWos ?? active.length} text="Active WO" color="#c084fc" /></div>
      {tab === "overview" && <><Card title="Material loading status" icon={<Package size={18} />}><div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}><Metric value={stats?.totalWos ?? "—"} text="Today WOs" color="#93c5fd" /><Metric value={stats?.completedWos ?? "—"} text="Completed" color="#4ade80" /><Metric value={stats ? `${Math.round(stats.shelfOccupancyPct)}%` : "—"} text="Rack use" color="#fbbf24" /></div></Card><Card title="MES ownership" icon={<ShieldCheck size={18} />}><div style={muted}>This PDA reads MES policy and executes acknowledged handovers. Route decisions, retest limits, final release, scrap and history remain owned by MES.</div></Card></>}
      {tab === "team" && <Card title="Team attendance" icon={<Users size={18} />}>{members.length ? members.map((member) => <div key={member.id} style={rowStyle}><span><b>{member.displayName || member.name_zh || member.code}</b><small style={muted}>{member.code} · {member.position || "Operator"}</small></span><span style={{ color: checkins.some((item) => item.employee_id === member.id) ? "#4ade80" : "#fbbf24" }}>{checkins.some((item) => item.employee_id === member.id) ? "Present" : "Missing"}</span></div>) : <div style={muted}>No team members returned.</div>}</Card>}
      {tab === "materials" && <Card title="Material control" icon={<Boxes size={18} />}><div style={muted}>PDA loading, shortage and WMS replenishment status are read from the shared MES/WMS domain.</div>{active.map((item) => <div key={item.wo_code} style={rowStyle}><b>{item.wo_code}</b><span>{item.cells?.length ?? 0} pending materials</span></div>)}</Card>}
      {tab === "quality" && <Card title="Quality and abnormalities" icon={<CheckCircle2 size={18} />}><div style={muted}>Escalate defects, repair, scrap and first-piece issues through MES/QMS; this PDA does not self-release products.</div></Card>}
      {tab === "pickup" && <Card title={`NG pickup & Andon (${pickupAnnouncements.length} pending)`} icon={<Bell size={18} />}><div style={muted}>Repair station → MES → Team Leader / Plant Manager PDA. Every response uses the same commandId and is append-only.</div>{pickupAnnouncements.map((item) => <div key={item.commandId} style={{ marginTop: 12, padding: 12, borderRadius: 10, border: `1px solid ${item.severity === "L2_SUPERVISOR" ? "#ef4444" : "#f59e0b"}`, background: "#172033" }}><div style={{ display: "flex", justifyContent: "space-between" }}><b>{item.workOrderId}</b><strong>{item.status}</strong></div><div style={muted}>Bucket {item.bucketQr} · {item.quantity} SN · {item.sourceStation} → {item.repairStation} → {item.destinationStation}</div><div style={{ display: "flex", gap: 6, marginTop: 10 }}><button disabled={pickupBusy === item.commandId} onClick={() => void respondToPickup(item, "CLAIMED")} style={buttonStyle("#0e7490")}>Claim</button><button disabled={pickupBusy === item.commandId} onClick={() => void respondToPickup(item, "COLLECTED")} style={buttonStyle("#166534")}>Collected</button><button disabled={pickupBusy === item.commandId} onClick={() => void respondToPickup(item, "REJECTED")} style={buttonStyle("#991b1b")}><XCircle size={14} /> Reject</button></div></div>)}</Card>}
      {tab === "ngRoute" && roleCode === "LINE_MANAGER" && <Card title="NG route settings (MES)" icon={<ShieldCheck size={18} />}><div style={muted}>Read-only Plant Manager view. Changes and publication remain in MES NG Management.</div>{ngRouteConfig?.configuration?.ngClosedLoopDefaults ? <><div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 12 }}><Metric value={ngRouteConfig.configuration.ngClosedLoopDefaults.quantityThreshold ?? "—"} text="Quantity trigger" color="#38bdf8" /><Metric value={`${ngRouteConfig.configuration.ngClosedLoopDefaults.timeThresholdMinutes ?? "—"} min`} text="Time trigger" color="#fbbf24" /><Metric value={ngRouteConfig.configuration.ngClosedLoopDefaults.maxRetests ?? "—"} text="Max retests" color="#c084fc" /></div><div style={rowStyle}><span>Trigger / human button</span><span>{ngRouteConfig.configuration.ngClosedLoopDefaults.triggerMode ?? "ANY"} / {ngRouteConfig.configuration.ngClosedLoopDefaults.humanButtonEnabled ? "enabled" : "disabled"}</span></div><div style={rowStyle}><span>Pickup channels</span><span>{(ngRouteConfig.configuration.ngClosedLoopDefaults.pickupChannels ?? []).join(" · ")}</span></div><div style={rowStyle}><span>Revision / status</span><span>{ngRouteConfig.configuration.revision ?? "—"} / {ngRouteConfig.configuration.status ?? "—"}</span></div><h4>Manual-line station policies</h4>{(ngRouteConfig.ngPolicies ?? []).filter((policy) => (policy.appliesTo ?? []).some((code) => code.startsWith("manu_"))).map((policy) => <div key={policy.code} style={rowStyle}><span><b>{policy.code}</b><small style={muted}>{(policy.appliesTo ?? []).join(", ")}</small></span><span>{policy.action?.route ?? "—"} · {policy.action?.retestLimit ?? "—"} retests</span></div>)}</> : <div style={{ ...muted, marginTop: 12 }}>MES route configuration is unavailable or permission is missing.</div>}</Card>}
      {tab === "loaderAssignment" && roleCode === "LINE_MANAGER" && <Card title="Assign loader by process domain" icon={<Package size={18} />}><div style={muted}>Test list is split by process domain. MES publishes the selected loader only to that domain and line.</div><div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginTop: 12 }}><label>Date<input type="date" value={loaderDate} min={tomorrow} onChange={(e) => setLoaderDate(e.target.value)} /></label><label>Shift<select value={loaderShift} onChange={(e) => setLoaderShift(e.target.value)}><option value="DAY">DAY</option><option value="NIGHT">NIGHT</option></select></label><label>Loader type<select value={loaderDomain} onChange={(e) => { const domain = e.target.value; setLoaderDomain(domain); const option = loaderDomainOptions.find((item) => item.value === domain); if (option) setLoaderLine(option.line); }}>{loaderDomainOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Team member<select value={loaderMember} onChange={(e) => setLoaderMember(e.target.value)}><option value="">Select member</option>{members.map((member) => <option key={member.id} value={String(member.id)}>{member.displayName || member.name_zh || member.code} ({member.code})</option>)}</select></label><label>Line<select value={loaderLine} onChange={(e) => setLoaderLine(e.target.value)}>{lineOptions.map((line) => <option key={line} value={line}>{line}</option>)}</select></label></div><button type="button" onClick={() => void assignMaterialLoader()} disabled={loaderBusy} style={{ ...buttonStyle("#0e7490"), marginTop: 12 }}>{loaderBusy ? "Publishing…" : "Publish MES assignment"}</button><h4 style={{ marginTop: 18 }}>Loader test list by process domain</h4><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{["Process / role", "Line", "Date", "Shift", "Loader", "Status"].map((label) => <th key={label} style={{ textAlign: "left", padding: 7, borderBottom: "1px solid #475569" }}>{label}</th>)}</tr></thead><tbody>{loaderDomainOptions.map((option) => <tr key={option.value}><td style={{ padding: 7 }}>{option.label}</td><td style={{ padding: 7 }}>{option.line}</td><td style={{ padding: 7 }}>{loaderDate}</td><td style={{ padding: 7 }}>{loaderShift}</td><td style={{ padding: 7 }}>{loaderAssignments.find((item) => item.lineCode === option.line)?.employeeName || "Not assigned"}</td><td style={{ padding: 7 }}>{loaderAssignments.some((item) => item.lineCode === option.line) ? "PUBLISHED" : "PENDING"}</td></tr>)}</tbody></table></div></Card>}
      {tab === "woRelease" && roleCode === "LINE_MANAGER" && <Card title="Release locked WO" icon={<ShieldCheck size={18} />}><div style={muted}>Plant Manager control: release a WO selected by a PDA so another WO can be selected. Every release is recorded by MES.</div>{lockedWos.length ? lockedWos.map((wo) => <div key={wo.code} style={rowStyle}><span><b>{wo.code}</b><small style={muted}>{wo.productNameZh || wo.productCode || "Work order"} · {wo.lineCode || "Line not assigned"} · locked by {wo.lockedBy || "—"}</small></span><button type="button" onClick={() => void releaseWo(wo)} style={buttonStyle("#b91c1c")}>Release WO</button></div>) : <div style={muted}>No released WOs returned.</div>}</Card>}
      {tab === "loaderAssignment" && roleCode === "LINE_MANAGER" && <Card title="Unified PDA login list by line" icon={<ShieldCheck size={18} />}><div style={muted}>This is the MES-controlled test list: each PDA is shown with its process, line, device identity, current login, and last activity.</div><div style={{ overflowX: "auto", marginTop: 10 }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{["PDA", "Process / line", "Device identity", "Status", "Current user", "Last activity"].map((label) => <th key={label} style={{ textAlign: "left", padding: 7, borderBottom: "1px solid #475569" }}>{label}</th>)}</tr></thead><tbody>{pdaLoginRows.filter((device) => !device.lineCode || lineOptions.includes(device.lineCode)).map((device) => <tr key={device.id}><td style={{ padding: 7 }}>{device.deviceCode || device.serialNo || `PDA-${device.id}`}</td><td style={{ padding: 7 }}>{device.lineCode || "Unassigned"}</td><td style={{ padding: 7 }}>{device.serialNo || "UUID reported by PDA"}</td><td style={{ padding: 7 }}>{device.deviceStatus || "UNKNOWN"}</td><td style={{ padding: 7 }}>{device.currentHolderName || device.lastOperator || "Not logged in"}</td><td style={{ padding: 7 }}>{device.lastEventAt ? new Date(device.lastEventAt).toLocaleString(locale) : "-"}</td></tr>)}{!pdaLoginRows.length && <tr><td colSpan={6} style={{ padding: 12, color: "#94a3b8" }}>No PDA login records returned by MES.</td></tr>}</tbody></table></div></Card>}
      {tab === "approvals" && <Card title="Leave approvals" icon={<ClipboardCheck size={18} />}>{leaves.length ? leaves.map((leave) => <div key={leave.id} style={rowStyle}><span><b>{leave.emp_name}</b><small style={muted}>{leave.leave_type_name} · {leave.start_date} → {leave.end_date}</small></span><span><button onClick={() => void decideLeave(leave.id, "approved")} style={buttonStyle("#166534")}>Approve</button> <button onClick={() => void decideLeave(leave.id, "rejected")} style={buttonStyle("#991b1b")}>Reject</button></span></div>) : <div style={muted}>No pending leave requests.</div>}</Card>}
      {tab === "reports" && <Card title={`MES NG tracking (${ngTrace.length})`} icon={<Factory size={18} />}><div style={muted}>Read-only synchronized view of the MES NG ledger. Source, state, repair owner and next action remain MES-controlled.</div><div style={{ overflowX: "auto", marginTop: 10 }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{["SN", "Source station", "Defect", "State", "Repair / next action", "Detected"].map((label) => <th key={label} style={{ textAlign: "left", padding: 7, borderBottom: "1px solid #475569" }}>{label}</th>)}</tr></thead><tbody>{ngTrace.slice(0, 200).map((row, index) => <tr key={`${String(row.sn ?? "")}-${index}`}><td style={{ padding: 7 }}><code>{String(row.sn ?? "-")}</code></td><td style={{ padding: 7 }}>{String(row.sourceStationCode ?? row.stationCode ?? "-")}</td><td style={{ padding: 7 }}>{String(row.defectCode ?? row.defectDescription ?? "-")}</td><td style={{ padding: 7, color: String(row.repairStatus ?? "pending").toLowerCase().includes("repair") ? "#fbbf24" : "#fca5a5" }}>{String(row.repairStatus ?? row.ngState ?? "NG")}</td><td style={{ padding: 7 }}>{String(row.nextAction ?? row.route ?? "MES decision")}</td><td style={{ padding: 7 }}>{row.detectedAt ? new Date(String(row.detectedAt)).toLocaleString(locale) : "-"}</td></tr>)}{ngTrace.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: "#94a3b8" }}>No active NG records returned by MES.</td></tr>}</tbody></table></div></Card>}
    </main>
    <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#1e293b", borderTop: "1px solid #334155", display: "flex", overflowX: "auto" }}>{([ ["overview", "Home"], ["team", "Team"], ["materials", "Materials"], ["quality", "Quality"], ["pickup", `NG pickup${pickupAnnouncements.length ? ` (${pickupAnnouncements.length})` : ""}`], ...(roleCode === "LINE_MANAGER" ? [["ngRoute", "NG route"] as const, ["loaderAssignment", "Loader"] as const, ["woRelease", "Release WO"] as const] : []), ["approvals", "Approvals"], ["reports", "Reports"] ] as const).map(([key, text]) => <button key={key} onClick={() => setTab(key)} style={{ minWidth: 100, padding: 13, background: tab === key ? "#164e63" : "transparent", color: "white", border: 0, fontWeight: 700 }}>{text}</button>)}</nav>
  </div>;
}

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) { return <section style={cardStyle}><h3 style={headingStyle}>{icon} {title}</h3>{children}</section>; }
function Metric({ icon, value, text, color }: { icon?: ReactNode; value: ReactNode; text: string; color: string }) { return <div style={{ background: "#1e293b", borderRadius: 10, padding: 10, textAlign: "center" }}><div style={{ color, display: "flex", justifyContent: "center", gap: 4, alignItems: "center", fontSize: 20, fontWeight: 800 }}>{icon}{value}</div><div style={{ color: "#94a3b8", fontSize: 10, marginTop: 3 }}>{text}</div></div>; }
const cardStyle: CSSProperties = { background: "#1e293b", borderRadius: 12, padding: 14, marginBottom: 12 };
const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #334155" };
const muted: CSSProperties = { color: "#94a3b8", fontSize: 12, display: "block", marginTop: 4 };
const headingStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px", fontSize: 15 };
function buttonStyle(background: string): CSSProperties { return { border: 0, borderRadius: 8, padding: "9px 11px", background, color: "white", fontWeight: 700, cursor: "pointer" }; }
