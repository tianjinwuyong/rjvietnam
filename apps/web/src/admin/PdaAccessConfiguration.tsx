import { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { apiClient } from "../api";

type RoleDefinition = {
  roleKey: string;
  responsibilities: string[];
  domains?: Record<string, string[]>;
  pages: string[];
  actions: string[];
  closedLoop: string[];
};

export function PdaAccessConfiguration() {
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("Loading MES role contract…");

  const load = async () => {
    setStatus("Loading MES role contract…");
    try {
      const result = await apiClient.get<{ roles: RoleDefinition[] }>("/pda/role-catalog");
      const next = result.roles ?? [];
      setRoles(next);
      setSelected((current) => current || next[0]?.roleKey || "");
      setStatus(`MES authority · ${next.length} role contracts loaded`);
    } catch (error) {
      setStatus(`MES role contract unavailable: ${String(error)}`);
    }
  };

  useEffect(() => { void load(); }, []);
  const role = roles.find((item) => item.roleKey === selected);

  return <div className="screen-stack">
    <div className="surface-panel">
      <div className="section-header">
        <div>
          <h3><ShieldCheck size={18} style={{ verticalAlign: "-3px", marginRight: 7 }} />PDA Role & Page Access Configuration</h3>
          <p>MES is the authority. This page shows the pages, actions and closed-loop obligations delivered to each PDA after login.</p>
        </div>
        <button type="button" onClick={() => void load()}><RefreshCw size={14} /> Refresh from MES</button>
      </div>
      <div className="notice">{status}</div>
      <div className="toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        {roles.map((item) => <button type="button" key={item.roleKey} className={item.roleKey === selected ? "active" : ""} onClick={() => setSelected(item.roleKey)}>{item.roleKey}</button>)}
      </div>
    </div>
    {role && <div className="content-grid two">
      <div className="surface-panel"><h3>{role.roleKey} · Responsibilities</h3><ul>{role.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div className="surface-panel"><h3>Visible pages</h3><ul>{role.pages.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div className="surface-panel"><h3>Domain scope</h3>{Object.entries(role.domains ?? {}).length ? Object.entries(role.domains ?? {}).map(([name, values]) => <div key={name} style={{ marginBottom: 10 }}><strong>{name}</strong><ul>{values.map((value) => <li key={value}>{value}</li>)}</ul></div>) : <p>No additional domain restriction.</p>}</div>
      <div className="surface-panel"><h3>Permitted actions</h3><ul>{role.actions.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div className="surface-panel"><h3>Closed-loop checkpoints</h3><ul>{role.closedLoop.map((item) => <li key={item}>{item}</li>)}</ul></div>
    </div>}
  </div>;
}
