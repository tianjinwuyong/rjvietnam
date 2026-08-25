import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Boxes, CalendarClock, Check, ClipboardCheck,
  Eye, EyeOff, Factory, GripVertical, History, Home, LayoutDashboard, ListChecks,
  Plus, RotateCcw, Save, ShieldCheck, Smartphone, Trash2, Users, Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Role = "Team Leader" | "Line Manager" | "SMT Loader";
type BlockId = "home" | "planning" | "tasks" | "mes" | "materials" | "feeder" | "team" | "quality" | "equipment" | "alerts" | "handover" | "reports" | "history";

interface DesignerBlock {
  id: BlockId;
  label: string;
  subtitle: string;
  accent: string;
  icon: LucideIcon;
  enabled: boolean;
}

const catalog: Record<BlockId, Omit<DesignerBlock, "icon" | "enabled"> & { icon: LucideIcon }> = {
  home: { id: "home", label: "Home", subtitle: "Shift status and urgent actions", accent: "#0f766e", icon: Home },
  planning: { id: "planning", label: "Planning", subtitle: "Shift plan, line targets and priorities", accent: "#2563eb", icon: CalendarClock },
  tasks: { id: "tasks", label: "Task inbox", subtitle: "Assigned work waiting for action", accent: "#7c3aed", icon: ListChecks },
  mes: { id: "mes", label: "MES line board", subtitle: "WO, output, downtime and line state", accent: "#0891b2", icon: Factory },
  materials: { id: "materials", label: "Materials & reels", subtitle: "Batches, quantity and loading status", accent: "#d97706", icon: Boxes },
  feeder: { id: "feeder", label: "Feeder warnings", subtitle: "Prepare or change feeder before stop", accent: "#dc2626", icon: AlertTriangle },
  team: { id: "team", label: "My team", subtitle: "Attendance, assignments and coverage", accent: "#059669", icon: Users },
  quality: { id: "quality", label: "Quality release", subtitle: "Hold, defects, rework and approval", accent: "#9333ea", icon: ShieldCheck },
  equipment: { id: "equipment", label: "Equipment", subtitle: "Machine readiness and open faults", accent: "#475569", icon: Wrench },
  alerts: { id: "alerts", label: "Alerts", subtitle: "Supervisor, MES, WMS and QMS alerts", accent: "#e11d48", icon: AlertTriangle },
  handover: { id: "handover", label: "Handover", subtitle: "Open issues and next-shift notes", accent: "#4f46e5", icon: ClipboardCheck },
  reports: { id: "reports", label: "Reports", subtitle: "Shift, production and audit history", accent: "#64748b", icon: History },
  history: { id: "history", label: "Loading history", subtitle: "Reel, feeder and partial-return trace", accent: "#0f766e", icon: History },
};

const defaults: Record<Role, BlockId[]> = {
  "Team Leader": ["home", "planning", "team", "materials", "alerts", "handover"],
  "Line Manager": ["home", "planning", "mes", "materials", "feeder", "team", "quality", "alerts", "reports"],
  "SMT Loader": ["home", "tasks", "materials", "feeder", "history", "handover"],
};

const storageKey = "ruijing.pda-ui-designer.v1";

export type PdaDesignerRole = Role;
export function getSavedPdaBlockIds(role: PdaDesignerRole): BlockId[] {
  const saved = typeof window === "undefined" ? {} : readSaved();
  return buildBlocks(role, saved).filter((block) => block.enabled).map((block) => block.id);
}

function buildBlocks(role: Role, saved?: Partial<Record<Role, Array<Partial<DesignerBlock>>>>): DesignerBlock[] {
  const source = saved?.[role];
  const ids = source?.length ? source.map((item) => item.id).filter((id): id is BlockId => Boolean(id && catalog[id])) : defaults[role];
  return ids.map((id, index) => ({ ...catalog[id], label: source?.[index]?.label || catalog[id].label, enabled: source?.[index]?.enabled ?? true }));
}

function readSaved(): Partial<Record<Role, Array<Partial<DesignerBlock>>>> {
  try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; }
}

export function PdaUiDesigner({ locale }: { locale?: string }) {
  const [role, setRole] = useState<Role>("Team Leader");
  const [saved, setSaved] = useState(readSaved);
  const [blocks, setBlocks] = useState(() => buildBlocks("Team Leader", saved));
  const [selectedId, setSelectedId] = useState<BlockId>("home");
  const [message, setMessage] = useState("Draft only — production permissions and MES data are unchanged.");

  const selected = blocks.find((block) => block.id === selectedId) || blocks[0];
  const available = useMemo(() => Object.values(catalog).filter((item) => !blocks.some((block) => block.id === item.id)), [blocks]);
  const visibleBlocks = blocks.filter((block) => block.enabled);

  const changeRole = (nextRole: Role) => {
    setRole(nextRole);
    const nextBlocks = buildBlocks(nextRole, saved);
    setBlocks(nextBlocks);
    setSelectedId(nextBlocks[0]?.id || "home");
  };

  const save = () => {
    const next = { ...saved, [role]: blocks.map(({ id, label, enabled }) => ({ id, label, enabled })) };
    localStorage.setItem(storageKey, JSON.stringify(next));
    setSaved(next);
    setMessage(`${role} layout saved locally at ${new Date().toLocaleTimeString(locale || undefined)}.`);
  };

  const reset = () => {
    const nextBlocks = buildBlocks(role);
    setBlocks(nextBlocks);
    setSelectedId(nextBlocks[0]?.id || "home");
    setMessage(`${role} restored to the recommended factory layout.`);
  };

  const move = (direction: -1 | 1) => {
    if (!selected) return;
    const index = blocks.findIndex((block) => block.id === selected.id);
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  };

  return <div className="pda-designer-shell">
    <header className="pda-designer-header">
      <div><div className="pda-designer-eyebrow"><LayoutDashboard size={15} /> PDA UI DESIGNER</div><h1>Design the factory PDA</h1><p>Compose one clear control center for every role, with MES, PMC, QMS, HR and WMS ownership kept intact.</p></div>
      <div className="pda-designer-header-actions"><button className="pda-designer-button secondary" onClick={reset}><RotateCcw size={16} /> Reset</button><button className="pda-designer-button primary" onClick={save}><Save size={16} /> Save preset</button></div>
    </header>

    <div className="pda-designer-rolebar">{(["Team Leader", "Line Manager", "SMT Loader"] as Role[]).map((item) => <button key={item} className={role === item ? "active" : ""} onClick={() => changeRole(item)}><Smartphone size={16} />{item}</button>)}</div>

    <main className="pda-designer-workspace">
      <aside className="pda-designer-panel palette-panel"><div className="pda-designer-panel-title"><div><span>Module palette</span><small>Add operational blocks</small></div><span className="pda-designer-count">{available.length}</span></div><div className="pda-designer-palette-list">{available.map((item) => { const Icon = item.icon; return <button key={item.id} className="pda-designer-palette-item" onClick={() => { setBlocks([...blocks, { ...item, enabled: true }]); setSelectedId(item.id); }}><span className="pda-designer-icon" style={{ background: `${item.accent}18`, color: item.accent }}><Icon size={17} /></span><span><b>{item.label}</b><small>{item.subtitle}</small></span><Plus size={16} /></button>; })}</div>{available.length === 0 && <div className="pda-designer-empty">All available modules are on this preset.</div>}</aside>

      <section className="pda-designer-canvas"><div className="pda-designer-canvas-head"><div><span>Live preview</span><small>{role} · {visibleBlocks.length} visible blocks</small></div><span className="pda-designer-live"><i /> Draft preview</span></div><div className="pda-designer-phone"><div className="pda-designer-phone-top"><span>09:41</span><span className="phone-signal">● ● ●</span></div><div className="pda-designer-appbar"><div><small>{role} PDA</small><strong>Line control center</strong></div><div className="pda-designer-avatar">GL</div></div><div className="pda-designer-preview-scroll"><div className="pda-designer-status-card"><div><small>SHIFT STATUS</small><strong>Running safely</strong></div><span className="status-dot">✓</span></div>{visibleBlocks.map((block) => { const Icon = block.icon; return <button key={block.id} className={`pda-designer-preview-card ${selected?.id === block.id ? "selected" : ""}`} onClick={() => setSelectedId(block.id)}><span className="pda-designer-preview-icon" style={{ background: `${block.accent}22`, color: block.accent }}><Icon size={19} /></span><span><strong>{block.label}</strong><small>{block.subtitle}</small></span><span className="preview-chevron">›</span></button>; })}</div><nav className="pda-designer-phone-nav"><span className="active"><Home size={15} />Home</span><span><CalendarClock size={15} />Shift</span><span><Users size={15} />Team</span><span><Boxes size={15} />Materials</span><span><AlertTriangle size={15} />Alerts</span></nav></div></section>

      <aside className="pda-designer-panel inspector-panel"><div className="pda-designer-panel-title"><div><span>Inspector</span><small>Selected module properties</small></div><GripVertical size={18} /></div>{selected ? <><div className="pda-designer-selected"><span className="pda-designer-icon" style={{ background: `${selected.accent}18`, color: selected.accent }}>{(() => { const Icon = selected.icon; return <Icon size={20} />; })()}</span><div><b>{selected.label}</b><small>{selected.id}</small></div></div><label className="pda-designer-field">Display label<input value={selected.label} onChange={(event) => setBlocks(blocks.map((block) => block.id === selected.id ? { ...block, label: event.target.value } : block))} /></label><div className="pda-designer-control-row"><button onClick={() => move(-1)} disabled={blocks[0]?.id === selected.id}><ArrowUp size={16} /> Move up</button><button onClick={() => move(1)} disabled={blocks[blocks.length - 1]?.id === selected.id}><ArrowDown size={16} /> Move down</button></div><button className="pda-designer-visibility" onClick={() => setBlocks(blocks.map((block) => block.id === selected.id ? { ...block, enabled: !block.enabled } : block))}>{selected.enabled ? <EyeOff size={16} /> : <Eye size={16} />}{selected.enabled ? "Hide from preview" : "Show in preview"}</button><button className="pda-designer-remove" onClick={() => { setBlocks(blocks.filter((block) => block.id !== selected.id)); setSelectedId(blocks.find((block) => block.id !== selected.id)?.id || "home"); }}><Trash2 size={16} /> Remove module</button></> : <div className="pda-designer-empty">Select a preview block to edit it.</div>}<div className="pda-designer-note"><Check size={15} /> {message}</div></aside>
    </main>
  </div>;
}
