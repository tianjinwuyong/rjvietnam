import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../api";
import { UserCheck, Plus, X, RefreshCw, Trash2 } from "lucide-react";

type AppOption = {
  id: number;
  app_key: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

type Assignment = {
  id: number;
  user_id: number;
  app_id: number;
  status: string;
  granted_at: string;
  expires_at: string | null;
  notes: string | null;
  user_code: string;
  user_name: string;
  app_key: string;
  app_name_zh: string;
  app_name_en: string;
};

type Employee = {
  id: number;
  code: string;
  display_name: string;
  name_zh: string;
  name_vi: string;
  status: string;
};

export function UserPdaAppAssignment() {
  const [apps, setApps] = useState<AppOption[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | "">("");
  const [selectedAppId, setSelectedAppId] = useState<number | "">("");
  const [grantNotes, setGrantNotes] = useState("");
  const [revokeId, setRevokeId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appsR, assignsR, usersR] = await Promise.all([
        apiClient.get<{ items: AppOption[] }>("/pda/app-catalog?isActive=true&limit=500"),
        apiClient.get<{ items: Assignment[] }>("/pda/user-apps?limit=500"),
        apiClient.get<{ items: Employee[] }>("/pda/employees?limit=500"),
      ]);
      setApps((appsR.items ?? []).filter(a => a.is_active));
      setAssignments(assignsR.items ?? []);
      setEmployees(usersR.items ?? []);
    } catch (e) { setMessage(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grant = async () => {
    if (!selectedUserId || !selectedAppId) { setMessage("请选择用户和应用"); return; }
    setMessage("");
    try {
      await apiClient.post("/pda/user-apps", {
        userId: selectedUserId,
        appId: selectedAppId,
        notes: grantNotes || null,
      });
      setGrantNotes("");
      setSelectedUserId("");
      setSelectedAppId("");
      setMessage("已分配应用权限");
      await load();
    } catch (e) { setMessage(String(e)); }
  };

  const revoke = async (id: number) => {
    try {
      await apiClient.delete(`/pda/user-apps/${id}`);
      setRevokeId(null);
      setMessage("已撤销权限");
      await load();
    } catch (e) { setMessage(String(e)); }
  };

  const activeAssignments = assignments.filter(a => a.status === "ACTIVE");
  const filteredAssignments = search
    ? activeAssignments.filter(a =>
        a.user_name?.toLowerCase().includes(search.toLowerCase()) ||
        a.user_code?.toLowerCase().includes(search.toLowerCase()) ||
        a.app_name_zh?.includes(search) ||
        a.app_key?.toLowerCase().includes(search.toLowerCase())
      )
    : activeAssignments;

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h3><UserCheck size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />用户PDA权限分配</h3>
            <p>为用户分配PDA应用菜单。蒙营和莫立斌可操作。每次变更写入审计日志。</p>
          </div>
          <button type="button" onClick={() => void load()}><RefreshCw size={14} /> 刷新</button>
        </div>
        {message && <div className="notice" style={{ marginTop: 8 }}>{message}</div>}
      </div>

      {/* Grant form */}
      <div className="surface-panel">
        <h4>分配PDA应用权限</h4>
        <div className="toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "#666" }}>员工</label>
            <select value={selectedUserId} onChange={e => setSelectedUserId(Number(e.target.value) || "")} style={{ minWidth: 160 }}>
              <option value="">— 选择员工 —</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.display_name || emp.name_zh || emp.code} ({emp.code})</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "#666" }}>PDA应用</label>
            <select value={selectedAppId} onChange={e => setSelectedAppId(Number(e.target.value) || "")} style={{ minWidth: 180 }}>
              <option value="">— 选择应用 —</option>
              {apps.map(app => (
                <option key={app.id} value={app.id}>{app.name_zh} ({app.app_key})</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "#666" }}>备注</label>
            <input value={grantNotes} onChange={e => setGrantNotes(e.target.value)} placeholder="可选备注" style={{ minWidth: 120 }} />
          </div>
          <button type="button" onClick={() => void grant()} disabled={!selectedUserId || !selectedAppId}>
            <Plus size={14} /> 确认分配
          </button>
        </div>
      </div>

      {/* Active assignments */}
      <div className="surface-panel">
        <div className="section-header" style={{ marginBottom: 10 }}>
          <h4>当前有效权限（{filteredAssignments.length}）</h4>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索用户姓名或应用…"
            style={{ maxWidth: 240 }}
          />
        </div>
        {loading ? <p>加载中…</p> : filteredAssignments.length === 0 ? (
          <p style={{ color: "#888", fontSize: 13 }}>暂无有效权限分配</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>员工编号</th><th>姓名</th><th>应用</th><th>英文名</th><th>分配时间</th><th>备注</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssignments.map(a => (
                  <tr key={a.id}>
                    <td><code>{a.user_code}</code></td>
                    <td>{a.user_name || a.user_code}</td>
                    <td><strong>{a.app_name_zh}</strong><br /><code style={{ fontSize: 11, color: "#666" }}>{a.app_key}</code></td>
                    <td style={{ fontSize: 12, color: "#555" }}>{a.app_name_en}</td>
                    <td style={{ fontSize: 12 }}>{new Date(a.granted_at).toLocaleDateString("zh-CN")}</td>
                    <td style={{ fontSize: 12, color: "#888", maxWidth: 120 }}>{a.notes || "—"}</td>
                    <td>
                      {revokeId === a.id ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button type="button" style={{ color: "#dc2626" }} onClick={() => void revoke(a.id)}>确认撤销</button>
                          <button type="button" onClick={() => setRevokeId(null)}><X size={12} /></button>
                        </div>
                      ) : (
                        <button type="button" style={{ color: "#dc2626" }} onClick={() => setRevokeId(a.id)}><Trash2 size={12} /> 撤销</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
