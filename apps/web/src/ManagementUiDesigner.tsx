import { useMemo, useState } from "react";
import { Activity, BarChart3, Boxes, BriefcaseBusiness, Check, ChevronDown, Factory, FileText, LayoutDashboard, Menu, Palette, Plus, Save, Settings, ShieldCheck, Trash2, Users, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Persona = "Factory Admin" | "HR Manager" | "MES Manager" | "WMS Manager" | "Line Manager";
type ModuleId = "dashboard" | "hr" | "mes" | "wms" | "pmc" | "quality" | "maintenance" | "reports" | "admin" | "team";
interface Module { id: ModuleId; label: string; subtitle: string; icon: LucideIcon; color: string; enabled: boolean; }

const modules: Record<ModuleId, Omit<Module, "enabled">> = {
  dashboard: { id: "dashboard", label: "Executive dashboard", subtitle: "KPIs, alerts and daily overview", icon: LayoutDashboard, color: "#0f766e" },
  hr: { id: "hr", label: "Human resources", subtitle: "Employees, attendance and trial periods", icon: Users, color: "#2563eb" },
  mes: { id: "mes", label: "MES operations", subtitle: "Production, WOs, stations and traceability", icon: Factory, color: "#0891b2" },
  wms: { id: "wms", label: "WMS materials", subtitle: "Inventory, reels, loading and replenishment", icon: Boxes, color: "#d97706" },
  pmc: { id: "pmc", label: "PMC planning", subtitle: "Demand, schedule and line capacity", icon: BarChart3, color: "#7c3aed" },
  quality: { id: "quality", label: "Quality control", subtitle: "IQC, OQC, defects and approvals", icon: ShieldCheck, color: "#9333ea" },
  maintenance: { id: "maintenance", label: "Maintenance", subtitle: "Assets, downtime and work orders", icon: Wrench, color: "#475569" },
  reports: { id: "reports", label: "Reports & audit", subtitle: "Production, material and audit history", icon: FileText, color: "#64748b" },
  admin: { id: "admin", label: "System administration", subtitle: "Permissions, domains and configuration", icon: Settings, color: "#be123c" },
  team: { id: "team", label: "Team command", subtitle: "Assignments, coverage and escalation", icon: BriefcaseBusiness, color: "#059669" },
};

const defaults: Record<Persona, ModuleId[]> = {
  "Factory Admin": ["dashboard", "hr", "mes", "wms", "quality", "reports", "admin"],
  "HR Manager": ["dashboard", "hr", "team", "reports"],
  "MES Manager": ["dashboard", "mes", "pmc", "wms", "quality", "maintenance", "reports"],
  "WMS Manager": ["dashboard", "wms", "mes", "quality", "reports"],
  "Line Manager": ["dashboard", "pmc", "mes", "wms", "quality", "team", "maintenance"],
};
const key = "ruijing.management-ui-designer.v1";

function read(): Partial<Record<Persona, ModuleId[]>> { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } }
function createModules(persona: Persona, presets: Partial<Record<Persona, ModuleId[]>>): Module[] { return (presets[persona]?.length ? presets[persona] : defaults[persona]).map(id => ({ ...modules[id], enabled: true })); }

export function ManagementUiDesigner() {
  const [persona, setPersona] = useState<Persona>("Factory Admin");
  const [presets, setPresets] = useState(read);
  const [layout, setLayout] = useState(() => createModules("Factory Admin", presets));
  const [selected, setSelected] = useState<ModuleId>("dashboard");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const available = useMemo(() => Object.values(modules).filter(item => !layout.some(current => current.id === item.id)), [layout]);
  const selectedModule = layout.find(item => item.id === selected) || layout[0];
  const changePersona = (next: Persona) => { const nextLayout = createModules(next, presets); setPersona(next); setLayout(nextLayout); setSelected(nextLayout[0]?.id || "dashboard"); };
  const save = () => { const next = { ...presets, [persona]: layout.map(item => item.id) }; localStorage.setItem(key, JSON.stringify(next)); setPresets(next); };
  const remove = () => { if (!selectedModule) return; const next = layout.filter(item => item.id !== selectedModule.id); setLayout(next); setSelected(next[0]?.id || "dashboard"); };
  return <div className="ms-designer-shell">
    <header className="ms-designer-header"><div><div className="ms-designer-eyebrow"><Palette size={15} /> MANAGEMENT SYSTEM WEBSITE DESIGNER</div><h1>Design the factory management system</h1><p>Build a consistent desktop workspace for every department while preserving MES, WMS, HR, QMS and authorization ownership.</p></div><div className="ms-designer-actions"><button className="ms-designer-btn ghost" onClick={() => { const next = createModules(persona, {}); setLayout(next); setSelected(next[0].id); }}>Reset</button><button className="ms-designer-btn primary" onClick={save}><Save size={16} /> Save layout</button></div></header>
    <div className="ms-designer-personas">{(["Factory Admin", "HR Manager", "MES Manager", "WMS Manager", "Line Manager"] as Persona[]).map(item => <button key={item} className={persona === item ? "active" : ""} onClick={() => changePersona(item)}><Users size={15} />{item}</button>)}</div>
    <main className="ms-designer-grid">
      <aside className="ms-designer-side"><div className="ms-designer-title"><div><b>Available modules</b><small>Add to navigation</small></div><span>{available.length}</span></div>{available.map(item => { const Icon = item.icon; return <button className="ms-designer-module" key={item.id} onClick={() => { setLayout([...layout, { ...item, enabled: true }]); setSelected(item.id); }}><span style={{ color: item.color, background: `${item.color}16` }}><Icon size={16} /></span><div><b>{item.label}</b><small>{item.subtitle}</small></div><Plus size={15} /></button>; })}{available.length === 0 && <p className="ms-designer-empty">All modules are in this layout.</p>}</aside>
      <section className="ms-designer-preview"><div className="ms-designer-title"><div><b>Live website preview</b><small>{persona} · desktop management workspace</small></div><div className="ms-designer-density"><button className={density === "comfortable" ? "active" : ""} onClick={() => setDensity("comfortable")}>Comfortable</button><button className={density === "compact" ? "active" : ""} onClick={() => setDensity("compact")}>Compact</button></div></div><div className={`ms-browser ${density}`}><div className="ms-browser-top"><span className="ms-browser-dot red" /><span className="ms-browser-dot yellow" /><span className="ms-browser-dot green" /><span className="ms-browser-url">app.ruijing-factory.local / {persona.toLowerCase().replaceAll(" ", "-")}</span></div><div className="ms-app"><aside className="ms-app-sidebar"><div className="ms-brand"><div className="ms-brand-mark">R</div><div><b>RUIJING</b><small>Factory OS</small></div></div><div className="ms-nav-label">WORKSPACE</div>{layout.map(item => { const Icon = item.icon; return <button key={item.id} className={selected === item.id ? "selected" : ""} onClick={() => setSelected(item.id)}><Icon size={15} />{item.label}</button>; })}<div className="ms-sidebar-footer"><Settings size={14} /> Settings</div></aside><div className="ms-app-content"><div className="ms-content-top"><button className="ms-menu"><Menu size={18} /></button><div><small>FACTORY MANAGEMENT SYSTEM</small><h2>{selectedModule?.label || "Workspace"}</h2></div><div className="ms-user"><span>TL</span><div><b>Thanh Le</b><small>{persona}</small></div><ChevronDown size={14} /></div></div><div className="ms-kpi-row"><div><small>Production output</small><strong>92.4%</strong><em>+4.8% today</em></div><div><small>Open alerts</small><strong>07</strong><em className="warn">Needs attention</em></div><div><small>Material readiness</small><strong>98%</strong><em>On schedule</em></div><div><small>Active lines</small><strong>06 / 08</strong><em>2 in setup</em></div></div><div className="ms-content-body"><div className="ms-card wide"><div className="ms-card-head"><div><b>Operational overview</b><small>Real-time cross-system status</small></div><Activity size={17} /></div><div className="ms-chart"><span style={{ height: "42%" }} /><span style={{ height: "60%" }} /><span style={{ height: "49%" }} /><span style={{ height: "74%" }} /><span style={{ height: "66%" }} /><span style={{ height: "88%" }} /><span style={{ height: "79%" }} /><span style={{ height: "94%" }} /></div></div><div className="ms-card"><div className="ms-card-head"><div><b>Priority queue</b><small>Items requiring ownership</small></div><span className="ms-badge">5</span></div>{["Feeder change · Line 2", "Trial review · HR", "QMS hold · WO-2408"].map(item => <div className="ms-queue" key={item}><i />{item}<span>›</span></div>)}</div></div></div></div></div></section>
      <aside className="ms-designer-side inspector"><div className="ms-designer-title"><div><b>Page inspector</b><small>Selected navigation item</small></div></div>{selectedModule ? <><div className="ms-selected-module"><span style={{ color: selectedModule.color, background: `${selectedModule.color}16` }}>{(() => { const Icon = selectedModule.icon; return <Icon size={20} />; })()}</span><div><b>{selectedModule.label}</b><small>{selectedModule.id}</small></div></div><label>Display label<input value={selectedModule.label} onChange={event => setLayout(layout.map(item => item.id === selectedModule.id ? { ...item, label: event.target.value } : item))} /></label><button className="ms-remove-btn" onClick={remove}><Trash2 size={15} /> Remove from navigation</button></> : <p className="ms-designer-empty">Select a module in the preview.</p>}<div className="ms-design-note"><Check size={15} /> Changes are saved as a layout preset. No production records are modified.</div></aside>
    </main>
  </div>;
}
