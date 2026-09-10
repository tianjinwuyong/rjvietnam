import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../api";
import { Shield, Plus, Edit2, Trash2, X, Check } from "lucide-react";

type AppRow = {
  id: number;
  app_key: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

type FormState = {
  app_key: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  description: string;
  sort_order: number;
};

export function PdaAppCatalogManager() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<AppRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({
    app_key: "",
    name_zh: "",
    name_en: "",
    name_vi: "",
    description: "",
    sort_order: 99,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiClient.get<{ items: AppRow[] }>("/pda/app-catalog?limit=500");
      setApps(r.items ?? []);
    } catch (e) { setMessage(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveEdit = async () => {
    setMessage("");
    try {
      await apiClient.patch(`/pda/app-catalog/${editing!.id}`, {
        name_zh: editing!.name_zh,
        name_en: editing!.name_en,
        name_vi: editing!.name_vi,
        description: editing!.description,
        sort_order: editing!.sort_order,
        is_active: editing!.is_active,
      });
      setEditing(null);
      void load();
    } catch (e) { setMessage(String(e)); }
  };

  const saveNew = async () => {
    setMessage("");
    try {
      await apiClient.post("/pda/app-catalog", {
        app_key: form.app_key,
        name_zh: form.name_zh,
        name_en: form.name_en,
        name_vi: form.name_vi,
        description: form.description,
        sort_order: form.sort_order,
      });
      setShowForm(false);
      setForm({ app_key: "", name_zh: "", name_en: "", name_vi: "", description: "", sort_order: 99 });
      void load();
    } catch (e) { setMessage(String(e)); }
  };

  const deleteApp = async (id: number) => {
    if (!confirm("确认删除？")) return;
    try {
      await apiClient.delete(`/pda/app-catalog/${id}`);
      void load();
    } catch (e) { setMessage(String(e)); }
  };

  const toggleActive = (app: AppRow) => {
    setEditing({ ...app, is_active: !app.is_active });
  };

  const startEdit = (app: AppRow) => {
    setEditing(app);
  };

  const cancelEdit = () => {
    setEditing(null);
  };

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Shield size={20} />
          <span style={{ fontWeight: 600 }}>PDA应用目录</span>
          <span style={{ color: "#888", fontSize: 13 }}>（{apps.length} 个角色）</span>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditing(null); }}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          <Plus size={16} /> 新增应用
        </button>
      </div>

      {message && (
        <div style={{ padding: "8px 12px", background: "#fee", color: "#c00", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{message}</div>
      )}

      {loading && <div style={{ color: "#888", padding: 16 }}>加载中…</div>}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
            <th style={{ padding: "8px 12px", borderBottom: "1px solid #ddd", width: 60 }}>ID</th>
            <th style={{ padding: "8px 12px", borderBottom: "1px solid #ddd" }}>应用Key</th>
            <th style={{ padding: "8px 12px", borderBottom: "1px solid #ddd" }}>中文名</th>
            <th style={{ padding: "8px 12px", borderBottom: "1px solid #ddd" }}>English</th>
            <th style={{ padding: "8px 12px", borderBottom: "1px solid #ddd" }}>Tiếng Việt</th>
            <th style={{ padding: "8px 12px", borderBottom: "1px solid #ddd" }}>描述</th>
            <th style={{ padding: "8px 12px", borderBottom: "1px solid #ddd", width: 60 }}>排序</th>
            <th style={{ padding: "8px 12px", borderBottom: "1px solid #ddd", width: 70 }}>状态</th>
            <th style={{ padding: "8px 12px", borderBottom: "1px solid #ddd", width: 120 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((app) => (
            <tr key={app.id} style={{ borderBottom: "1px solid #eee" }}>
              {editing?.id === app.id ? (
                <>
                  <td style={{ padding: "6px 12px" }}>{app.id}</td>
                  <td style={{ padding: "6px 12px", color: "#888" }}>{app.app_key}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <input value={editing.name_zh} onChange={(e) => setEditing({ ...editing, name_zh: e.target.value })} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 }} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input value={editing.name_en} onChange={(e) => setEditing({ ...editing, name_en: e.target.value })} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 }} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input value={editing.name_vi} onChange={(e) => setEditing({ ...editing, name_vi: e.target.value })} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 }} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 }} />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <input type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} style={{ width: 50, padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, fontSize: 13 }} />
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input type="checkbox" checked={editing.is_active} onChange={() => setEditing({ ...editing, is_active: !editing.is_active })} />
                      <span style={{ fontSize: 12 }}>{editing.is_active ? "启用" : "停用"}</span>
                    </label>
                  </td>
                  <td style={{ padding: "6px 12px", display: "flex", gap: 4 }}>
                    <button onClick={saveEdit} style={{ padding: "4px 8px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                      <Check size={13} /> 保存
                    </button>
                    <button onClick={cancelEdit} style={{ padding: "4px 8px", background: "#888", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                      <X size={13} /> 取消
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td style={{ padding: "8px 12px", color: "#888" }}>{app.id}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{app.app_key}</td>
                  <td style={{ padding: "8px 12px" }}>{app.name_zh}</td>
                  <td style={{ padding: "8px 12px", color: "#555" }}>{app.name_en}</td>
                  <td style={{ padding: "8px 12px", color: "#555" }}>{app.name_vi}</td>
                  <td style={{ padding: "8px 12px", color: "#666", fontSize: 12, maxWidth: 200 }}>{app.description ?? "—"}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>{app.sort_order}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, background: app.is_active ? "#dcfce7" : "#fee2e2", color: app.is_active ? "#16a34a" : "#dc2626" }}>
                      {app.is_active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", display: "flex", gap: 4 }}>
                    <button onClick={() => startEdit(app)} title="编辑" style={{ padding: "4px 6px", background: "#e5e7eb", border: "none", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center" }}>
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => deleteApp(app.id)} title="删除" style={{ padding: "4px 6px", background: "#fee2e2", border: "none", borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", color: "#dc2626" }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 24, width: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>新增PDA应用</span>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: "#666", marginBottom: 4, display: "block" }}>应用Key *（唯一，如 SMT_LOADER）</label>
                <input value={form.app_key} onChange={(e) => setForm({ ...form, app_key: e.target.value.toUpperCase() })} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, fontFamily: "monospace" }} placeholder="e.g. SMT_LOADER" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#666", marginBottom: 4, display: "block" }}>中文名称 *</label>
                <input value={form.name_zh} onChange={(e) => setForm({ ...form, name_zh: e.target.value })} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 }} placeholder="SMT上料员" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#666", marginBottom: 4, display: "block" }}>English Name</label>
                <input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 }} placeholder="SMT Loader" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#666", marginBottom: 4, display: "block" }}>Tiếng Việt</label>
                <input value={form.name_vi} onChange={(e) => setForm({ ...form, name_vi: e.target.value })} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 }} placeholder="Nhân viên nạp SMT" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#666", marginBottom: 4, display: "block" }}>描述</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 }} placeholder="负责SMT产线物料上料操作" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#666", marginBottom: 4, display: "block" }}>排序（数字越小越靠前）</label>
                <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} style={{ width: 100, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 }} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowForm(false)} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>取消</button>
              <button onClick={saveNew} disabled={!form.app_key || !form.name_zh} style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", opacity: (!form.app_key || !form.name_zh) ? 0.5 : 1 }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
