import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { t } from "./i18n";

/**
 * 流程设计 —— 移植原版 FlowDesign（低代码电子流设计器）：
 * 选择流程类型 → 页签（节点设置 / 字段设置 / 高级设置）→ 保存配置。
 * 保存走 PUT /api/flows/:id/config（服务端保存即产出版本快照）；
 * 新建流程走 POST /api/flows。仅管理员（flow:config）可用。
 */

interface FlowRow {
  id: number | string; code: string; name?: string | null; name_vi?: string | null;
  category?: string | null; icon?: string | null; description?: string | null;
  active?: boolean | null;
}
interface RoleRow { code: string; name?: string | null }
interface OptionRow { value?: string; label?: string; label_vi?: string | null }
interface ColumnRow { key?: string; label?: string; label_vi?: string | null; type?: string | null }
interface FieldEdit {
  key: string; label?: string | null; label_vi?: string | null; type?: string | null;
  required?: boolean | null; options?: OptionRow[] | null; columns?: ColumnRow[] | null;
  sum_from?: string | null; sum_key?: string | null;
}
interface NodeEdit {
  raw: Record<string, unknown>;
  name: string; nameVi: string; type: string; assign: string;
  minApprovals: string;
  condField: string; condOp: string; condValue: string; condRef: string;
  condSource: "fixed" | "ref";
  snap: { f: string; o: string; v: string; r: string; s: string; hasCond: boolean; cond: unknown; min: unknown };
}

const NODE_TYPES = [
  { value: "approval", key: "designExtra.nodeTypeApproval" },
  { value: "cc", key: "designExtra.nodeTypeCc" },
  { value: "execute", key: "designExtra.nodeTypeExecute" },
  { value: "verify", key: "designExtra.nodeTypeVerify" },
];
const ASSIGN_PRESETS = [
  { value: "position_self:dept_mgr", key: "designExtra.assignSelfDeptMgr" },
  { value: "position_self:dept_sup", key: "designExtra.assignSelfDeptSup" },
  { value: "gm", key: "designExtra.assignGm" },
  { value: "vp", key: "designExtra.assignVp" },
  { value: "user_selected", key: "designExtra.assignUserSelected" },
];
const LEGACY_ROLES = ["品质主管", "人事主管", "体系工程师", "SQE"];
const OPS = ["eq", "ne", "in", "nin", "gt", "gte", "lt", "lte"] as const;
const FIELD_TYPES = [
  "text", "textarea", "number", "date", "datetime", "select",
  "richText", "file", "user", "userMulti", "table",
] as const;
const FIELD_TYPE_KEYS: Record<string, string> = {
  text: "typeText", textarea: "typeTextarea", number: "typeNumber", date: "typeDate",
  datetime: "typeDatetime", select: "typeSelect", richText: "typeRichText",
  file: "typeFile", user: "typeUser", userMulti: "typeUserMulti", table: "typeTable",
};

const label = { display: "block", marginBottom: 5, fontSize: 13 };
const btn = { padding: "6px 14px", cursor: "pointer" } as const;
const smBtn = { ...btn, padding: "3px 10px", fontSize: 12 } as const;

function str(v: unknown): string { return v == null ? "" : String(v); }

function loadNode(raw: Record<string, unknown>): NodeEdit {
  const cond = raw.condition && typeof raw.condition === "object" ? (raw.condition as Record<string, unknown>) : null;
  const f = cond && cond.field != null ? String(cond.field) : "";
  const o = cond && cond.op != null ? String(cond.op) : "";
  const v = cond && cond.value != null ? String(cond.value) : "";
  const r = cond && cond.value_ref != null ? String(cond.value_ref) : "";
  const s = cond && cond.value_ref != null ? "ref" : "fixed";
  return {
    raw, name: str(raw.name), nameVi: str(raw.name_vi), type: str(raw.type) || "approval",
    assign: str(raw.assign), minApprovals: raw.min_approvals != null ? String(raw.min_approvals) : "",
    condField: f, condOp: o, condValue: v, condRef: r, condSource: s as "fixed" | "ref",
    snap: { f, o, v, r, s, hasCond: !!cond, cond: cond ?? null, min: raw.min_approvals ?? null },
  };
}

function nodeToPayload(n: NodeEdit): Record<string, unknown> {
  const out: Record<string, unknown> = { ...n.raw };
  out.name = n.name;
  out.name_vi = n.nameVi || null;
  out.type = n.type;
  if (n.assign) out.assign = n.assign; else delete out.assign;
  // min_approvals：清空且原本无值 → 删除键；清空但原本有值 → 保留原值
  if (n.minApprovals === "") {
    if (n.snap.min != null) out.min_approvals = n.snap.min;
    else delete out.min_approvals;
  } else out.min_approvals = Number(n.minApprovals);
  // condition：按原版语义装配
  const changed = n.condField !== n.snap.f || n.condOp !== n.snap.o || n.condValue !== n.snap.v
    || n.condRef !== n.snap.r || n.condSource !== n.snap.s;
  if (n.condField && n.condOp) {
    if (n.condSource === "ref" && n.condRef) out.condition = { field: n.condField, op: n.condOp, value_ref: n.condRef };
    else if (n.condValue !== "") out.condition = { field: n.condField, op: n.condOp, value: n.condValue };
    else delete out.condition;
  } else if (!changed && n.snap.hasCond) out.condition = n.snap.cond;
  else delete out.condition;
  return out;
}

export function FlowDesignView({ locale }: { locale: Locale }) {
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [flowId, setFlowId] = useState("");
  const [flow, setFlow] = useState<FlowRow | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tab, setTab] = useState<"nodes" | "fields" | "advanced">("nodes");
  const [nodes, setNodes] = useState<NodeEdit[] | null>(null);
  const [fields, setFields] = useState<FieldEdit[] | null>(null);
  const [ledgerCols, setLedgerCols] = useState<ColumnRow[] | null>(null);
  const [ledgerEmptyOrig, setLedgerEmptyOrig] = useState(false);
  const [closureRequired, setClosureRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ code: "", name: "", nameVi: "", category: "", icon: "", description: "" });

  const knownAssign = useCallback((a: string) =>
    ASSIGN_PRESETS.some(p => p.value === a)
    || roles.some(r => `role:${r.code}` === a)
    || LEGACY_ROLES.some(n => `role:${n}` === a), [roles]);

  const loadFlows = useCallback(async () => {
    try {
      const l = await apiClient.get<FlowRow[]>("/api/flows?includeInactive=1");
      setFlows(l || []);
      setCategories([...new Set((l || []).map(f => f.category).filter(Boolean) as string[])]);
    } catch { setFlows([]); }
  }, []);

  const loadFlow = useCallback(async (id: string) => {
    if (!id) { setFlow(null); return; }
    setNodes(null); setFields(null);
    try {
      const d = await apiClient.get<FlowRow & { form_schema?: FieldEdit[] | null; flow_nodes?: Array<Record<string, unknown>>; ledger_columns?: ColumnRow[] | null; closure_required?: boolean | null }>(`/api/flows/${id}?includeInactive=1`);
      setFlow(d);
      setNodes((d.flow_nodes || []).map(loadNode));
      setFields((d.form_schema || []).map(f => ({ ...f })));
      const lc = d.ledger_columns ?? null;
      setLedgerCols((lc || []).map(c => ({ ...c })));
      setLedgerEmptyOrig(lc == null || (Array.isArray(lc) && lc.length === 0));
      setClosureRequired(!!d.closure_required);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadFlows();
    apiClient.get<{ roles?: RoleRow[] }>("/api/roles").then(r => setRoles(r?.roles || [])).catch(() => setRoles([]));
  }, [loadFlows]);

  const saveConfig = async () => {
    setError("");
    if (!flow || !nodes || !fields) return;
    if (!window.confirm(t("designExtra.saveConfirmBody", locale, { name: flow.name ?? "", n: nodes.length }))) return;
    setBusy(true);
    try {
      const lc = ledgerCols || [];
      await apiClient.put(`/api/flows/${flow.id}/config`, {
        flowNodes: nodes.map(nodeToPayload),
        formSchema: fields,
        closureRequired,
        ledgerColumns: lc.length ? lc : (ledgerEmptyOrig ? null : []),
      });
      setMsg(t("admin.configSaved", locale));
      await loadFlow(String(flow.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!flow) return;
    const active = flow.active !== false;
    if (!window.confirm(t(active ? "designExtra.disableConfirm" : "designExtra.enableConfirm", locale))) return;
    setBusy(true);
    try {
      await apiClient.put(`/api/flows/${flow.id}/config`, { active: !active });
      await loadFlows();
      await loadFlow(String(flow.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createFlow = async () => {
    setError("");
    if (!newForm.code.trim() || !newForm.name.trim()) return;
    setBusy(true);
    try {
      const created = await apiClient.post<FlowRow>("/api/flows", {
        code: newForm.code.trim(), name: newForm.name.trim(), nameVi: newForm.nameVi.trim() || null,
        category: newForm.category.trim() || null, icon: newForm.icon.trim() || null,
        description: newForm.description.trim() || null,
        flowNodes: [], formSchema: [], closureRequired: false, ledgerColumns: [],
      });
      setShowNew(false);
      setMsg(t("designExtra.createOk", locale));
      await loadFlows();
      if (created?.id) { setFlowId(String(created.id)); await loadFlow(String(created.id)); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 节点/字段/选项/列 的增删与排序
  const addNode = () => setNodes(ns => [...(ns || []), {
    raw: {}, name: t("designExtra.newNode", locale), nameVi: "", type: "approval",
    assign: "position_self:dept_mgr", minApprovals: "", condField: "", condOp: "",
    condValue: "", condRef: "", condSource: "fixed",
    snap: { f: "", o: "", v: "", r: "", s: "fixed", hasCond: false, cond: null, min: null },
  }]);
  const move = <T,>(arr: T[], i: number, d: number): T[] => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return arr;
    const c = [...arr];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  };

  if (!flows) return <div className="empty-state">{t("common.loading", locale)}</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{t("admin.flowDesignTitle", locale)}</h3>
        <button style={btn} onClick={() => setShowNew(true)}>{t("designExtra.newFlowBtn", locale)}</button>
      </div>

      <div className="surface-panel" style={{ padding: "14px 16px", marginBottom: 14 }}>
        <label style={label}>{t("admin.flowType", locale)}</label>
        <select value={flowId} onChange={e => { setFlowId(e.target.value); void loadFlow(e.target.value); }}
          style={{ width: "100%", maxWidth: 480, padding: "6px 8px", boxSizing: "border-box" }}>
          <option value="">{t("designExtra.selectFlowHint", locale)}</option>
          {flows.map(f => (
            <option key={String(f.id)} value={String(f.id)}>
              [{f.code}] {f.name}{f.active === false ? `（${t("designExtra.disabled", locale)}）` : ""}
            </option>
          ))}
        </select>
      </div>

      {!flow ? null : !nodes || !fields ? (
        <div className="empty-state">{t("common.loading", locale)}</div>
      ) : (
        <div className="surface-panel" style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", gap: 8, borderBottom: "1px solid #e2e8f0", marginBottom: 14 }}>
            {([["nodes", "admin.nodeTab"], ["fields", "admin.fieldTab"], ["advanced", "designExtra.advanced"]] as const).map(([v, k]) => (
              <button key={v} onClick={() => setTab(v)}
                style={{ ...btn, border: 0, borderBottom: tab === v ? "2px solid #0f766e" : "2px solid transparent", background: "none", fontWeight: tab === v ? 600 : 400 }}>
                {t(k, locale)}
              </button>
            ))}
          </div>

          {tab === "nodes" && <NodesTab locale={locale} nodes={nodes} setNodes={setNodes} roles={roles} knownAssign={knownAssign} addNode={addNode} move={move} />}
          {tab === "fields" && <FieldsTab locale={locale} fields={fields} setFields={setFields} move={move} />}
          {tab === "advanced" && <AdvancedTab locale={locale} cols={ledgerCols} setCols={setLedgerCols} closureRequired={closureRequired} setClosureRequired={setClosureRequired} />}

          <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
            <button disabled={busy} onClick={() => void saveConfig()}
              style={{ ...btn, background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}>
              {t("admin.saveConfig", locale)}
            </button>
            <button style={btn} disabled={busy} onClick={() => flow.id && void loadFlow(String(flow.id))}>{t("designExtra.reload", locale)}</button>
            <button style={btn} disabled={busy} onClick={() => void toggleActive()}>
              {flow.active === false ? t("designExtra.activeOn", locale) : t("designExtra.activeOff", locale)}
            </button>
          </div>
        </div>
      )}

      {(msg || error) && (
        <p style={{ fontSize: 13, marginTop: 10, color: error ? "var(--danger, #b91c1c)" : "#15803d" }}>{error || msg}</p>
      )}

      {showNew && (
        <NewFlowDialog locale={locale} form={newForm} setForm={setNewForm} categories={categories}
          busy={busy} onCancel={() => setShowNew(false)} onCreate={() => void createFlow()} />
      )}
    </div>
  );
}

function NodesTab({ locale, nodes, setNodes, roles, knownAssign, addNode, move }: {
  locale: Locale; nodes: NodeEdit[]; setNodes: React.Dispatch<React.SetStateAction<NodeEdit[] | null>>;
  roles: RoleRow[]; knownAssign: (a: string) => boolean;
  addNode: () => void; move: <T,>(arr: T[], i: number, d: number) => T[];
}) {
  const upd = (i: number, patch: Partial<NodeEdit>) =>
    setNodes(ns => { const c = [...(ns || [])]; c[i] = { ...c[i], ...patch }; return c; });
  const remove = (i: number) => setNodes(ns => (ns || []).filter((_, x) => x !== i));

  return (
    <div>
      {(nodes || []).map((n, i) => (
        <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b style={{ fontSize: 13 }}>{t("designExtra.stepLabel", locale, { n: i + 1 })}</b>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={smBtn} disabled={i === 0} onClick={() => setNodes(ns => move(ns || [], i, -1))}>{t("designExtra.moveUp", locale)}</button>
              <button style={smBtn} disabled={i === nodes.length - 1} onClick={() => setNodes(ns => move(ns || [], i, 1))}>{t("designExtra.moveDown", locale)}</button>
              <button style={{ ...smBtn, color: "var(--danger, #b91c1c)" }} onClick={() => remove(i)}>{t("common.delete", locale)}</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 180px" }}>
              <label style={label}>{t("designExtra.fieldName", locale)}</label>
              <input value={n.name} onChange={e => upd(i, { name: e.target.value })} style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label style={label}>{t("designExtra.fieldLabelVi", locale)}</label>
              <input value={n.nameVi} onChange={e => upd(i, { nameVi: e.target.value })} style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={label}>{t("admin.flowType", locale)}</label>
              <select value={n.type} onChange={e => upd(i, { type: e.target.value })} style={{ padding: "5px 6px" }}>
                {NODE_TYPES.map(x => <option key={x.value} value={x.value}>{t(x.key, locale)}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
            <div style={{ flex: "1 1 220px" }}>
              <label style={label}>{t("admin.approver", locale)}</label>
              <select value={knownAssign(n.assign) ? n.assign : "__custom__"} onChange={e => upd(i, { assign: e.target.value === "__custom__" ? "" : e.target.value })} style={{ width: "100%", padding: "5px 6px", boxSizing: "border-box" }}>
                {!n.assign && <option value="">{t("admin.approver", locale)}</option>}
                {ASSIGN_PRESETS.map(p => <option key={p.value} value={p.value}>{t(p.key, locale)}</option>)}
                <optgroup label={t("designExtra.byRole", locale)}>
                  {roles.map(r => <option key={r.code} value={`role:${r.code}`}>{`${r.name ?? r.code}（role:${r.code}）`}</option>)}
                  {LEGACY_ROLES.map(nm => <option key={`legacy-${nm}`} value={`role:${nm}`}>{`${nm}（role:${nm}）`}</option>)}
                </optgroup>
                {n.assign && !knownAssign(n.assign) && <option value="__custom__">{`${t("designExtra.assignCustom", locale)}：${n.assign}`}</option>}
              </select>
            </div>
            {n.assign === "user_selected" && (
              <div style={{ flex: "1 1 160px" }}>
                <label style={label}>sel_key</label>
                <input value={str(n.raw.sel_key)} onChange={e => setNodes(ns => { const c = [...(ns || [])]; c[i] = { ...c[i], raw: { ...c[i].raw, sel_key: e.target.value || null } }; return c; })} style={{ width: "100%", boxSizing: "border-box" }} />
              </div>
            )}
            <div>
              <label style={label}>{t("admin.minApprovals", locale)}</label>
              <input type="number" min={1} value={n.minApprovals} onChange={e => upd(i, { minApprovals: e.target.value })} style={{ width: 90, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ ...label, visibility: "hidden" }}>·</label>
              <button style={smBtn} onClick={() => upd(i, { assign: "position_self:dept_mgr" })}>{t("designExtra.resetAssign", locale)}</button>
            </div>
          </div>
          {n.assign && !knownAssign(n.assign) && (
            <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", margin: "6px 0 0" }}>{t("designExtra.assignExprHint", locale)}</p>
          )}

          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <input type="checkbox" checked={n.raw.temp_addable !== false} onChange={e => setNodes(ns => { const c = [...(ns || [])]; c[i] = { ...c[i], raw: { ...c[i].raw, temp_addable: e.target.checked } }; return c; })} />
            {t("admin.tempAddable", locale)}
          </label>

          <div style={{ marginTop: 10, paddingLeft: 8, borderLeft: "2px solid var(--oa-primary-light, #99f6e4)" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>{t("designExtra.conditionOptional", locale)}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input value={n.condField} onChange={e => upd(i, { condField: e.target.value })} placeholder={t("designExtra.fieldPlaceholder", locale)} style={{ width: 130, boxSizing: "border-box" }} />
              <select value={n.condOp} onChange={e => upd(i, { condOp: e.target.value })} style={{ width: 110, padding: "5px 6px" }}>
                <option value="">{t("designExtra.opPlaceholder", locale)}</option>
                {OPS.map(op => <option key={op} value={op}>{t(`designExtra.op_${op}`, locale)}</option>)}
              </select>
              <select value={n.condSource} onChange={e => upd(i, { condSource: e.target.value as "fixed" | "ref" })} style={{ width: 100, padding: "5px 6px" }}>
                <option value="fixed">{t("designExtra.condSourceFixed", locale)}</option>
                <option value="ref">{t("designExtra.condSourceRef", locale)}</option>
              </select>
              {n.condSource !== "ref" ? (
                <input value={n.condValue} onChange={e => upd(i, { condValue: e.target.value })} placeholder={t("designExtra.valuePlaceholder", locale)} style={{ width: 130, boxSizing: "border-box" }} />
              ) : (
                <input value={n.condRef} onChange={e => upd(i, { condRef: e.target.value })} placeholder={t("designExtra.condRefKey", locale)} style={{ width: 200, boxSizing: "border-box" }} />
              )}
              {n.condSource === "ref" && <span style={{ fontSize: 12, color: "#b45309" }}>{t("designExtra.condSourceRefHint", locale)}</span>}
              {(n.condField || n.condOp || n.condValue || n.condRef) && (
                <button style={smBtn} onClick={() => upd(i, { condField: "", condOp: "", condValue: "", condRef: "", condSource: "fixed" })}>{t("designExtra.clearCondition", locale)}</button>
              )}
            </div>
          </div>
        </div>
      ))}
      <button style={{ ...btn, border: "1px solid #0f766e", color: "#0f766e", background: "none", borderRadius: 6 }} onClick={addNode}>{t("designExtra.addNodeBtn", locale)}</button>
    </div>
  );
}

function FieldsTab({ locale, fields, setFields, move }: {
  locale: Locale; fields: FieldEdit[]; setFields: React.Dispatch<React.SetStateAction<FieldEdit[] | null>>;
  move: <T,>(arr: T[], i: number, d: number) => T[];
}) {
  const upd = (i: number, patch: Partial<FieldEdit>) =>
    setFields(fs => { const c = [...(fs || [])]; c[i] = { ...c[i], ...patch }; return c; });
  const remove = (i: number) => setFields(fs => (fs || []).filter((_, x) => x !== i));
  const addField = () => setFields(fs => [...(fs || []), {
    key: `field_${Date.now()}`, label: t("designExtra.newField", locale), type: "text", required: false,
  }]);
  const addOption = (i: number) => upd(i, { options: [...(fields[i].options || []), { value: "", label: "" }] });
  const removeOption = (i: number, j: number) => upd(i, { options: (fields[i].options || []).filter((_, x) => x !== j) });
  const moveOption = (i: number, j: number, d: number) => upd(i, { options: move(fields[i].options || [], j, d) });
  const addColumn = (i: number) => upd(i, { columns: [...(fields[i].columns || []), { key: "", type: "text", label: "" }] });
  const removeColumn = (i: number, j: number) => upd(i, { columns: (fields[i].columns || []).filter((_, x) => x !== j) });

  const tableFields = (fields || []).filter(f => f.type === "table");

  return (
    <div>
      {(fields || []).map((f, i) => (
        <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <b style={{ fontSize: 13 }}>{f.label || f.key}</b>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={smBtn} disabled={i === 0} onClick={() => setFields(fs => move(fs || [], i, -1))}>{t("designExtra.moveUp", locale)}</button>
              <button style={smBtn} disabled={i === fields.length - 1} onClick={() => setFields(fs => move(fs || [], i, 1))}>{t("designExtra.moveDown", locale)}</button>
              <button style={{ ...smBtn, color: "var(--danger, #b91c1c)" }} onClick={() => remove(i)}>{t("common.delete", locale)}</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px" }}>
              <label style={label}>{t("designExtra.fieldName", locale)}</label>
              <input value={f.label ?? ""} onChange={e => upd(i, { label: e.target.value })} style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label style={label}>{t("designExtra.fieldLabelVi", locale)}</label>
              <input value={f.label_vi ?? ""} onChange={e => upd(i, { label_vi: e.target.value })} style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={label}>{t("designExtra.fieldKey", locale)}</label>
              <input value={f.key} onChange={e => upd(i, { key: e.target.value })} style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={label}>type</label>
              <select value={f.type || ""} onChange={e => upd(i, { type: e.target.value })} style={{ padding: "5px 6px", minWidth: 110 }}>
                {!f.type && <option value="">{t("designExtra.typeUnset", locale)}</option>}
                {FIELD_TYPES.map(ty => <option key={ty} value={ty}>{t(`designExtra.${FIELD_TYPE_KEYS[ty]}`, locale)}</option>)}
                {f.type && !FIELD_TYPES.includes(f.type as never) && <option value={f.type}>{`${t("designExtra.typeCustom", locale)}：${f.type}`}</option>}
              </select>
            </div>
            <div>
              <label style={label}>{" "}</label>
              <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={!!f.required} onChange={e => upd(i, { required: e.target.checked })} />
                {t("designExtra.required", locale)}
              </label>
            </div>
          </div>

          {f.type === "select" && (
            <div style={{ marginTop: 10, paddingLeft: 8, borderLeft: "2px solid var(--oa-primary-light, #99f6e4)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>{t("designExtra.options", locale)}</div>
              {(f.options || []).map((op, j) => (
                <div key={j} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <input value={op.value ?? ""} onChange={e => { const c = [...(f.options || [])]; c[j] = { ...c[j], value: e.target.value }; upd(i, { options: c }); }} placeholder={t("designExtra.optionValue", locale)} style={{ width: 130, boxSizing: "border-box" }} />
                  <input value={op.label ?? ""} onChange={e => { const c = [...(f.options || [])]; c[j] = { ...c[j], label: e.target.value }; upd(i, { options: c }); }} placeholder={t("designExtra.optionLabel", locale)} style={{ width: 130, boxSizing: "border-box" }} />
                  <input value={op.label_vi ?? ""} onChange={e => { const c = [...(f.options || [])]; c[j] = { ...c[j], label_vi: e.target.value }; upd(i, { options: c }); }} placeholder={t("designExtra.optionLabelVi", locale)} style={{ width: 130, boxSizing: "border-box" }} />
                  <button style={smBtn} disabled={j === 0} onClick={() => moveOption(i, j, -1)}>↑</button>
                  <button style={smBtn} disabled={j === (f.options || []).length - 1} onClick={() => moveOption(i, j, 1)}>↓</button>
                  <button style={{ ...smBtn, color: "var(--danger, #b91c1c)" }} onClick={() => removeOption(i, j)}>{t("common.delete", locale)}</button>
                </div>
              ))}
              <button style={smBtn} onClick={() => addOption(i)}>{t("designExtra.addOption", locale)}</button>
            </div>
          )}

          {f.type === "table" && (
            <div style={{ marginTop: 10, paddingLeft: 8, borderLeft: "2px solid var(--oa-primary-light, #99f6e4)" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>{t("designExtra.columns", locale)}</div>
              {(f.columns || []).map((col, j) => (
                <div key={j} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <input value={col.key ?? ""} onChange={e => { const c = [...(f.columns || [])]; c[j] = { ...c[j], key: e.target.value }; upd(i, { columns: c }); }} placeholder={t("designExtra.colKey", locale)} style={{ width: 130, boxSizing: "border-box" }} />
                  <input value={col.label ?? ""} onChange={e => { const c = [...(f.columns || [])]; c[j] = { ...c[j], label: e.target.value }; upd(i, { columns: c }); }} placeholder={t("designExtra.colLabel", locale)} style={{ width: 130, boxSizing: "border-box" }} />
                  <input value={col.label_vi ?? ""} onChange={e => { const c = [...(f.columns || [])]; c[j] = { ...c[j], label_vi: e.target.value }; upd(i, { columns: c }); }} placeholder={t("designExtra.colLabelVi", locale)} style={{ width: 130, boxSizing: "border-box" }} />
                  <button style={{ ...smBtn, color: "var(--danger, #b91c1c)" }} onClick={() => removeColumn(i, j)}>{t("common.delete", locale)}</button>
                </div>
              ))}
              <button style={smBtn} onClick={() => addColumn(i)}>{t("designExtra.addColumn", locale)}</button>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{t("designExtra.sumFrom", locale)}</span>
                <select value={f.sum_from ?? ""} onChange={e => upd(i, { sum_from: e.target.value || null })} style={{ width: 180, padding: "5px 6px" }}>
                  <option value="">{t("designExtra.sumNone", locale)}</option>
                  {tableFields.map(tf => <option key={tf.key} value={tf.key}>{tf.label || tf.key}</option>)}
                </select>
                <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{t("designExtra.sumKey", locale)}</span>
                <input value={f.sum_key ?? ""} onChange={e => upd(i, { sum_key: e.target.value || null })} style={{ width: 130, boxSizing: "border-box" }} />
              </div>
            </div>
          )}
        </div>
      ))}
      <button style={{ ...btn, border: "1px solid #0f766e", color: "#0f766e", background: "none", borderRadius: 6 }} onClick={addField}>{t("designExtra.addFieldBtn", locale)}</button>
    </div>
  );
}

function AdvancedTab({ locale, cols, setCols, closureRequired, setClosureRequired }: {
  locale: Locale; cols: ColumnRow[] | null; setCols: React.Dispatch<React.SetStateAction<ColumnRow[] | null>>;
  closureRequired: boolean; setClosureRequired: (v: boolean) => void;
}) {
  const list = cols || [];
  const upd = (i: number, patch: Partial<ColumnRow>) =>
    setCols(cs => { const c = [...(cs || [])]; c[i] = { ...c[i], ...patch }; return c; });

  return (
    <div>
      <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
        <input type="checkbox" checked={closureRequired} onChange={e => setClosureRequired(e.target.checked)} />
        {t("designExtra.closureRequired", locale)}
      </label>

      <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>{t("designExtra.ledgerCols", locale)}</div>
      {!list.length ? <div className="empty-state">{t("designExtra.noLedger", locale)}</div> : list.map((c, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <input value={c.key ?? ""} onChange={e => upd(i, { key: e.target.value })} placeholder={t("designExtra.colKey", locale)} style={{ width: 160, boxSizing: "border-box" }} />
          <input value={c.label ?? ""} onChange={e => upd(i, { label: e.target.value })} placeholder={t("designExtra.colLabel", locale)} style={{ width: 160, boxSizing: "border-box" }} />
          <input value={c.label_vi ?? ""} onChange={e => upd(i, { label_vi: e.target.value })} placeholder={t("designExtra.colLabelVi", locale)} style={{ width: 160, boxSizing: "border-box" }} />
          <button style={{ ...smBtn, color: "var(--danger, #b91c1c)" }} onClick={() => setCols(cs => (cs || []).filter((_, x) => x !== i))}>{t("common.delete", locale)}</button>
        </div>
      ))}
      <button style={smBtn} onClick={() => setCols(cs => [...(cs || []), { key: "", label: "", label_vi: "" }])}>{t("designExtra.addLedgerCol", locale)}</button>
    </div>
  );
}

function NewFlowDialog({ locale, form, setForm, categories, busy, onCancel, onCreate }: {
  locale: Locale;
  form: { code: string; name: string; nameVi: string; category: string; icon: string; description: string };
  setForm: React.Dispatch<React.SetStateAction<{ code: string; name: string; nameVi: string; category: string; icon: string; description: string }>>;
  categories: string[]; busy: boolean; onCancel: () => void; onCreate: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onCancel}>
      <div className="surface-panel" style={{ padding: "18px 20px", width: 520, maxWidth: "92vw" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 14px" }}>{t("designExtra.newFlowTitle", locale)}</h3>

        <label style={label}>{t("designExtra.fCode", locale)} *</label>
        <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder={t("designExtra.fCodePlaceholder", locale)} style={{ width: "100%", boxSizing: "border-box", marginBottom: 4 }} />
        <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", margin: "0 0 10px" }}>{t("designExtra.fCodeHint", locale)}</p>

        <label style={label}>{t("designExtra.fName", locale)} *</label>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />

        <label style={label}>{t("designExtra.fNameVi", locale)}</label>
        <input value={form.nameVi} onChange={e => setForm(f => ({ ...f, nameVi: e.target.value }))} style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />

        <label style={label}>{t("designExtra.fCategory", locale)}</label>
        <select value={categories.includes(form.category) || !form.category ? form.category : "__custom__"} onChange={e => setForm(f => ({ ...f, category: e.target.value === "__custom__" ? "" : e.target.value }))} style={{ width: "100%", padding: "6px 8px", boxSizing: "border-box", marginBottom: 10 }}>
          <option value="">{t("designExtra.fCategoryHint", locale)}</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
          {form.category && !categories.includes(form.category) && <option value="__custom__">{form.category}</option>}
        </select>

        <label style={label}>{t("designExtra.fIcon", locale)}</label>
        <input value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} placeholder={t("designExtra.fIconHint", locale)} style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }} />

        <label style={label}>{t("designExtra.fDesc", locale)}</label>
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} style={{ width: "100%", boxSizing: "border-box", marginBottom: 14, resize: "vertical" }} />

        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={busy} onClick={onCreate} style={{ ...btn, background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}>{t("common.create", locale)}</button>
          <button style={btn} onClick={onCancel}>{t("common.cancel", locale)}</button>
        </div>
      </div>
    </div>
  );
}



