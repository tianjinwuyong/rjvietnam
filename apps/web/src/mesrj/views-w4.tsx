// MES-ruijing W4 自定义页面 —— BOM 树/导入、开单、领料、排产看板、产线负载
// 通用列表仍走 resources.tsx 的 CRUD 配置；这里只放有业务流的页面。
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, MesrjApiError, type MesrjPaged, type MesrjRow } from "./api";
import { t } from "./i18n";
import { MesrjCrudPage, type FieldDef } from "./GenericList";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13 }}>{msg}</div>;
}

async function call<T>(fn: () => Promise<T>): Promise<[T | null, string]> {
  try {
    return [await fn(), ""];
  } catch (ex) {
    return [null, ex instanceof MesrjApiError ? ex.message : String(ex)];
  }
}

// ── BOM 结构树（menu.bom.tree）──────────────────────────────────────────────
interface BomNode {
  code: string; name: string; model: string; type: string; version: string;
  level: number; qty_per?: number; via_segment?: string; via_wo?: string;
  row_id?: number; is_cycle?: boolean;
  count: number; children: BomNode[]; material_groups: Array<{
    segment: string; wo_type: string; count: number;
    items: Array<{ material_code: string; material_name: string; qty_per: number; unit: string; pos_ref: string }>;
  }>;
}

export function BomTreeView({ locale }: { locale: Locale }) {
  const [code, setCode] = useState("");
  const [root, setRoot] = useState<BomNode | null>(null);
  const [summary, setSummary] = useState<{ sfg: number; rm: number; levels: number } | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!code.trim()) return;
    setLoading(true);
    const [data, e] = await call(() => mesrjApi.get<{ root: BomNode; summary: typeof summary }>(
      "/bom/tree", { product_code: code.trim() }));
    setLoading(false);
    setErr(e);
    if (data) { setRoot(data.root); setSummary(data.summary ?? null); }
    else { setRoot(null); setSummary(null); }
  }, [code]);

  const renderNode = (n: BomNode): React.ReactNode => (
    <div style={{ paddingLeft: n.level ? 18 : 0, borderLeft: n.level ? "1px dashed #cbd5e1" : "none", marginLeft: n.level ? 4 : 0 }}>
      <div style={{ padding: "3px 0", fontSize: 13 }}>
        <b>{n.code}</b> · {n.name} {n.model && <span style={{ color: "#64748b" }}>[{n.model}]</span>}
        {" "}<span style={{ color: n.type === "FG" ? "#1d4ed8" : n.type === "SFG" ? "#b45309" : "#64748b" }}>{n.type}</span>
        {n.qty_per !== undefined && <span> ×{n.qty_per}</span>}
        {n.via_segment && <span style={{ color: "#64748b" }}> （{n.via_segment}）</span>}
        {n.is_cycle && <span style={{ color: "#b91c1c" }}> ⟲ 循环引用</span>}
        {!n.is_cycle && n.count > 0 && <span style={{ color: "#94a3b8" }}> {n.count} 行</span>}
      </div>
      {(n.material_groups ?? []).map(g => (
        <div key={g.segment} style={{ paddingLeft: 18, fontSize: 12, color: "#475569" }}>
          ▸ {g.segment || "未分段"}（{g.count}）：{g.items.map(i => `${i.material_code}×${i.qty_per}${i.pos_ref ? `@${i.pos_ref}` : ""}`).join("， ")}
        </div>
      ))}
      {(n.children ?? []).map(c => <div key={`${c.code}-${c.row_id ?? c.level}`}>{renderNode(c)}</div>)}
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="产品料号"
          style={{ minWidth: 220, ...inp }}
          onKeyDown={e => { if (e.key === "Enter") void load(); }} />
        <button onClick={() => void load()}>{t("search", locale)}</button>
      </div>
      <Err msg={err} />
      {loading && <div style={{ color: "#94a3b8" }}>{t("loading", locale)}</div>}
      {root && (
        <div style={box}>
          {renderNode(root)}
          {summary && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
              半成品 {summary.sfg} · 原料行 {summary.rm} · 层级 {summary.levels}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── BOM 导入（menu.bom.import）──────────────────────────────────────────────
const BOM_COLS = ["product_code", "version", "cust_code", "segment", "material_code",
  "material_name", "spec", "unit", "qty_per", "mpq", "pos_ref", "is_alt", "alt_group"] as const;

export function BomImportView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<MesrjRow[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const parseText = (text: string) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return;
    const sep = lines[0].includes("\t") ? "\t" : ",";
    const head = lines[0].split(sep).map(h => h.trim());
    const out: MesrjRow[] = [];
    for (const line of lines.slice(1)) {
      const cells = line.split(sep);
      const row: MesrjRow = {};
      BOM_COLS.forEach((k, i) => { row[k] = cells[i]?.trim() ?? ""; });
      out.push(row);
    }
    setRows(out);
    setMsg(`已解析 ${out.length} 行，确认后点「确认导入」`);
    setErr("");
  };

  const onFile = async (f: File | null) => {
    if (!f) return;
    if (f.name.toLowerCase().endsWith(".xlsx") || f.name.toLowerCase().endsWith(".xlsm")) {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
        const hdrI = aoa.findIndex(r => r.some(c => String(c).trim() === "产品料号"));
        if (hdrI < 0) { setErr("找不到表头行（必须含「产品料号」列）"); return; }
        const hdr = (aoa[hdrI] as unknown[]).map(c => String(c).trim());
        const col = (n: string) => hdr.indexOf(n);
        const map: Record<string, string> = {
          "产品料号": "product_code", "BOM版本": "version", "客户": "cust_code", "分段": "segment",
          "物料料号": "material_code", "物料名称": "material_name", "物料型号": "spec",
          "单位": "unit", "单位用量": "qty_per", "最小包装单位": "mpq", "位号": "pos_ref",
          "是否替代料": "is_alt", "替代组": "alt_group",
        };
        const out: MesrjRow[] = [];
        for (const r of aoa.slice(hdrI + 1) as unknown[][]) {
          const row: MesrjRow = {};
          for (const [cn, key] of Object.entries(map)) {
            const i = col(cn);
            row[key] = i >= 0 && i < r.length ? String(r[i] ?? "").trim() : "";
          }
          if (row.product_code && row.material_code) out.push(row);
        }
        setRows(out);
        setMsg(`已解析 ${out.length} 行，确认后点「确认导入」`);
        setErr("");
      } catch (ex) {
        setErr(`解析 Excel 失败：${ex}`);
      }
    } else {
      parseText(await f.text());
    }
  };

  const doImport = async () => {
    const [data, e] = await call(() => mesrjApi.post<{ ok: number; fail: Array<{ row: number; msg: string }> }>(
      "/bom/import", { rows }));
    if (e) { setErr(e); return; }
    setMsg(`导入完成：成功 ${data?.ok ?? 0} 行，失败 ${data?.fail?.length ?? 0} 行`);
    if (data?.fail?.length) setErr(data.fail.slice(0, 5).map(f => `第${f.row}行：${f.msg}`).join("；"));
    setRows([]);
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept=".xlsx,.xlsm,.csv,.txt" onChange={e => void onFile(e.target.files?.[0] ?? null)} />
        <span style={{ fontSize: 12, color: "#64748b" }}>
          支持 .xlsx（表头含「产品料号」）或粘贴 CSV/TSV
        </span>
      </div>
      <div style={{ marginBottom: 10 }}>
        <button onClick={() => {
          const text = window.prompt("粘贴 BOM 行（CSV/TSV，首行列名：产品料号,BOM版本,客户,分段,物料料号,物料名称,物料型号,单位,单位用量,最小包装单位,位号,是否替代料,替代组）");
          if (text) parseText(text);
        }}>粘贴导入</button>
        {" "}
        <button onClick={() => void doImport()} disabled={!rows.length}>{t("save", locale)}</button>
      </div>
      <Err msg={err} />
      {msg && <div style={{ color: "#15803d", padding: "4px 0", fontSize: 13 }}>{msg}</div>}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", ...box }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>{BOM_COLS.map(c => <th key={c} style={{ padding: "5px 8px", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>{c}</th>)}</tr></thead>
            <tbody>
              {rows.slice(0, 50).map((r, i) => (
                <tr key={i}>{BOM_COLS.map(c => <td key={c} style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{String(r[c] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
          {rows.length > 50 && <div style={{ fontSize: 12, color: "#94a3b8", padding: 6 }}>… 共 {rows.length} 行</div>}
        </div>
      )}
    </div>
  );
}

// ── 开单（menu.mo 上方的开单表单）───────────────────────────────────────────
interface PoRow { id: number; po_no: string; product_code: string; order_qty: number; status: string; cust_code: string }

export function MoCreateForm({ locale, onCreated }: { locale: Locale; onCreated?: () => void }) {
  const [pos, setPos] = useState<PoRow[]>([]);
  const [poId, setPoId] = useState("");
  const [productCode, setProductCode] = useState("");
  const [planQty, setPlanQty] = useState("");
  const [typeCode, setTypeCode] = useState("1");
  const [syncPlan, setSyncPlan] = useState(true);
  const [lineCode, setLineCode] = useState("");
  const [preview, setPreview] = useState<{ mo_nos: string[]; will_allocate: boolean; seq_no: string } | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call(() => mesrjApi.get<MesrjPaged<PoRow>>("/order/po", { size: 100 }))
      .then(([d, e]) => { if (d) setPos(d.rows); else setErr(e); });
  }, []);

  const doPreview = async () => {
    const [d, e] = await call(() => mesrjApi.get<typeof preview>("/order/mo/create/preview",
      poId ? { po_id: poId } : { product_code: productCode, type_code: typeCode }));
    if (e) { setErr(e); return; }
    setErr("");
    setPreview(d);
  };

  const doCreate = async () => {
    setBusy(true);
    const [d, e] = await call(() => mesrjApi.post<{ mo_nos: string[]; msg: string }>("/order/mo/create", {
      po_id: poId || undefined,
      product_code: poId ? undefined : productCode,
      plan_qty: poId ? undefined : Number(planQty || 0),
      type_code: typeCode, sync_plan: syncPlan,
      line_map: lineCode ? { "01": lineCode } : {},
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setErr("");
    setMsg(d?.msg ?? "");
    setPreview(null);
    onCreated?.();
  };

  const sel = poId ? pos.find(p => String(p.id) === poId) : undefined;

  return (
    <div style={box}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={poId} onChange={e => { setPoId(e.target.value); setPreview(null); }} style={{ ...inp, minWidth: 200 }}>
          <option value="">（不挂 PO，手工单）</option>
          {pos.map(p => <option key={p.id} value={p.id}>{p.po_no} · {p.product_code} · {p.order_qty}</option>)}
        </select>
        {!poId && (
          <>
            <input value={productCode} onChange={e => setProductCode(e.target.value)} placeholder="产品料号" style={inp} />
            <input value={planQty} onChange={e => setPlanQty(e.target.value)} placeholder="计划数量" type="number" style={{ ...inp, width: 100 }} />
          </>
        )}
        <select value={typeCode} onChange={e => setTypeCode(e.target.value)} style={inp}>
          <option value="1">正单</option>
          <option value="2">备品</option>
          <option value="3">返单</option>
        </select>
        <input value={lineCode} onChange={e => setLineCode(e.target.value)} placeholder="SMT 产线（可空）" style={{ ...inp, width: 150 }} />
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={syncPlan} onChange={e => setSyncPlan(e.target.checked)} /> 同步排产
        </label>
        <button onClick={() => void doPreview()}>{t("search", locale)}</button>
        <button onClick={() => void doCreate()} disabled={busy || (!poId && !productCode)}>{t("confirm", locale)}</button>
      </div>
      <Err msg={err} />
      {msg && <div style={{ color: "#15803d", padding: "4px 0", fontSize: 13 }}>{msg}</div>}
      {preview && (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          预览单号：<b>{preview.mo_nos.join("、")}</b>
          {" "}（流水 {preview.seq_no}{preview.will_allocate ? "，开单时新占" : "，已占用"}）
          {sel && <span> · PO {sel.po_no} / {sel.product_code} / {sel.order_qty}</span>}
        </div>
      )}
    </div>
  );
}

// ── 生产计划页（menu.mo：开单表单 + 工单 CRUD 列表）─────────────────────────
export function MoView({ locale, fields, filters }: {
  locale: Locale; fields: FieldDef[]; filters?: FieldDef[];
}) {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div>
      <MoCreateForm locale={locale} onCreated={() => setReloadKey(k => k + 1)} />
      <MesrjCrudPage key={`mo-${reloadKey}`} locale={locale} basePath="order" res="mo"
        fields={fields} filters={filters} />
    </div>
  );
}

// ── 领料单（menu.issue：生成 + 列表 + 详情确认 + 打印）──────────────────────
interface IssueHead {
  id: number; issue_no: string; mo_no: string; segment: string; line_code: string;
  issue_type: string; apply_qty: number; status: string; issue_by: string; issue_time: string;
}
interface IssueItem {
  id: number; material_code: string; vn_code?: string; material_name: string; spec: string;
  unit: string; segment: string; qty_per: number; need_qty: number; issue_qty: number;
  mpq: number; pos_ref: string; alt_list: string; main_code: string; is_substitute: number;
}

export function IssueView({ locale }: { locale: Locale }) {
  const [data, setData] = useState<MesrjPaged<IssueHead> | null>(null);
  const [err, setErr] = useState("");
  const [moNo, setMoNo] = useState("");
  const [force, setForce] = useState(false);
  const [msg, setMsg] = useState("");
  const [detail, setDetail] = useState<{ head: IssueHead; items: IssueItem[] } | null>(null);

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<MesrjPaged<IssueHead>>("/order/issue/list", { size: 50 }));
    if (d) setData(d); else setErr(e);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>("/order/issue/generate",
      { mo_no: moNo.trim(), force }));
    if (e) { setErr(e); return; }
    setErr(""); setMsg(d?.msg ?? "已生成");
    await load();
  };

  const openDetail = async (h: IssueHead) => {
    const [d, e] = await call(() => mesrjApi.get<{ head?: IssueHead } & IssueHead & { items: IssueItem[] }>(
      `/order/issue/${h.issue_no}/detail`));
    if (e) { setErr(e); return; }
    if (!d) { setErr("无数据"); return; }
    setErr("");
    setDetail({ head: d as IssueHead, items: d.items ?? [] });
  };

  const confirm = async () => {
    if (!detail) return;
    const [d, e] = await call(() => mesrjApi.post<unknown>(`/order/issue/${detail.head.issue_no}/confirm`,
      { items: detail.items.map(i => ({ id: i.id, issue_qty: i.issue_qty })) }));
    if (e) { setErr(e); return; }
    setErr("");
    setDetail(null);
    setMsg("已确认发料");
    await load();
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={moNo} onChange={e => setMoNo(e.target.value)} placeholder="工单号（生成领料单）" style={{ ...inp, minWidth: 200 }} />
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} /> 强制重开</label>
        <button onClick={() => void generate()} disabled={!moNo.trim()}>生成领料单</button>
        <button onClick={() => void load()} style={{ marginLeft: "auto" }}>{t("refresh", locale)}</button>
      </div>
      <Err msg={err} />
      {msg && <div style={{ color: "#15803d", padding: "4px 0", fontSize: 13 }}>{msg}</div>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>
            {["领料单号", "工单", "分段", "产线", "类型", "数量", "状态", "发料人", ""].map(h => (
              <th key={h} style={{ padding: "7px 10px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {(data?.rows ?? []).map(h => (
              <tr key={h.id}>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{h.issue_no}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{h.mo_no}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{h.segment || "-"}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{h.line_code || "-"}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{h.issue_type}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{h.apply_qty}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{h.status}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{h.issue_by || "-"}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>
                  <button onClick={() => void openDetail(h)} style={{ marginRight: 6 }}>明细</button>
                  <a href={`${location.protocol}//${location.hostname}:8080/api/mesrj/order/issue/${h.issue_no}/doc`}
                    target="_blank" rel="noreferrer">打印</a>
                </td>
              </tr>
            ))}
            {data && !data.rows.length && (
              <tr><td colSpan={9} style={{ padding: 16, color: "#94a3b8" }}>{t("no_data", locale)}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div style={{ background: "var(--surface, #fff)", borderRadius: 10, padding: 18, minWidth: 640, maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>{detail.head.issue_no}
              <span style={{ fontSize: 13, color: "#64748b", marginLeft: 8 }}>
                {detail.head.mo_no} · {detail.head.status} · {detail.head.segment || "整单"}
              </span>
            </h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
              <thead><tr>
                {["料号", "越南码", "品名", "段", "单位用量", "应领", "实领", "位号"].map(h => (
                  <th key={h} style={{ padding: "5px 8px", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {detail.items.map(it => (
                  <tr key={it.id}>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {it.material_code}{it.is_substitute ? "（代）" : ""}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{it.vn_code || "—"}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{it.material_name}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{it.segment || "-"}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{it.qty_per}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{it.need_qty}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {detail.head.status === "待确认"
                        ? <input type="number" value={it.issue_qty} style={{ width: 80 }}
                          onChange={e => setDetail(d => d ? {
                            ...d,
                            items: d.items.map(x => x.id === it.id ? { ...x, issue_qty: Number(e.target.value) } : x),
                          } : d)} />
                        : it.issue_qty}
                    </td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{it.pos_ref || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => setDetail(null)}>{t("cancel", locale)}</button>
              {detail.head.status === "待确认" &&
                <button onClick={() => void confirm()}>{t("confirm", locale)}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 排产看板（menu.plan.board）──────────────────────────────────────────────
interface PendingMo {
  mo_no: string; wo_type: string; product_code: string; plan_qty: number;
  line_code: string; plan_end: string; status: string; product_model: string;
}
interface BoardRow extends MesrjRow {
  id: number; plan_date: string; shift_code: string; line_code: string; mo_no: string;
  plan_qty: number; seq_no: number; status: string;
  wo_type?: string; product_code?: string; mo_qty?: number; out_qty?: number; mo_status?: string; po_no?: string;
}

export function PlanBoardView({ locale }: { locale: Locale }) {
  const today = new Date().toISOString().slice(0, 10);
  const [d1, setD1] = useState(today);
  const [d2, setD2] = useState(today);
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [stat, setStat] = useState<Record<string, { plan_qty: number; cnt: number }>>({});
  const [pending, setPending] = useState<PendingMo[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  // 排产表单
  const [moNo, setMoNo] = useState("");
  const [line, setLine] = useState("");
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState("");

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: BoardRow[]; stat: Record<string, { plan_qty: number; cnt: number }> }>(
      "/plan/board", { d1, d2 }));
    if (d) { setRows(d.rows); setStat(d.stat); setErr(""); } else setErr(e);
  }, [d1, d2]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void call(() => mesrjApi.get<PendingMo[]>("/plan/pending"))
      .then(([d, e]) => { if (d) setPending(d); else setErr(e); });
  }, []);

  const addPlan = async () => {
    const [d, e] = await call(() => mesrjApi.post<unknown>("/plan/add", {
      mo_no: moNo.trim(), line_code: line.trim(), plan_date: date,
      plan_qty: qty ? Number(qty) : undefined,
    }));
    if (e) { setErr(e); return; }
    setErr(""); setMsg("已排产");
    setMoNo(""); setQty("");
    await load();
  };

  const setStatus = async (sid: number, st: string) => {
    const [, e] = await call(() => mesrjApi.post<unknown>(`/plan/${sid}/status`, { status: st }));
    if (e) { setErr(e); return; }
    await load();
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="date" value={d1} onChange={e => setD1(e.target.value)} style={inp} />
        <span>~</span>
        <input type="date" value={d2} onChange={e => setD2(e.target.value)} style={inp} />
        <button onClick={() => void load()}>{t("search", locale)}</button>
        <span style={{ fontSize: 12, color: "#64748b" }}>
          {Object.entries(stat).map(([k, v]) => `${k}: ${v.plan_qty}/${v.cnt}条`).join("  ·  ")}
        </span>
      </div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={moNo} onChange={e => {
          setMoNo(e.target.value);
          const m = pending.find(x => x.mo_no === e.target.value);
          if (m) { setLine(m.line_code || ""); setQty(String(m.plan_qty ?? "")); }
        }} style={{ ...inp, minWidth: 260 }}>
          <option value="">选择工单（未排产）</option>
          {pending.map(m => <option key={m.mo_no} value={m.mo_no}>
            {m.mo_no} · {m.product_model || m.product_code} · {m.plan_qty}
          </option>)}
        </select>
        <input value={line} onChange={e => setLine(e.target.value)} placeholder="产线" style={{ ...inp, width: 120 }} />
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
        <input value={qty} onChange={e => setQty(e.target.value)} placeholder="数量" type="number" style={{ ...inp, width: 90 }} />
        <button onClick={() => void addPlan()} disabled={!moNo || !line || !date}>排产</button>
        {msg && <span style={{ color: "#15803d", fontSize: 13 }}>{msg}</span>}
      </div>
      <Err msg={err} />
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>
            {["日期", "班", "产线", "工单", "产品", "数量", "产出", "工单状态", "PO", "计划状态", ""].map(h => (
              <th key={h} style={{ padding: "7px 10px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.plan_date}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.shift_code}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.line_code}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.mo_no}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.product_code || "-"}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.plan_qty}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.out_qty ?? "-"}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.mo_status || "-"}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.po_no || "-"}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.status}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>
                  {["执行中", "已完成", "已取消"].map(st => (
                    <button key={st} onClick={() => void setStatus(r.id, st)} style={{ marginRight: 4, fontSize: 12 }}>{st}</button>
                  ))}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={11} style={{ padding: 16, color: "#94a3b8" }}>{t("no_data", locale)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 产线负载（menu.plan.load）───────────────────────────────────────────────
interface LoadRow {
  plan_date: string; shift_code: string; shift_name: string; product_code: string;
  process: string; qty: number; uph: number; hours: number; cap: number;
  load: number | null; cnt: number;
}
interface CapRow { id: number; line_code: string; product_code: string; process: string; uph: number; std_headcount: number; remark: string }

export function PlanLoadView({ locale }: { locale: Locale }) {
  const today = new Date().toISOString().slice(0, 10);
  const [d1, setD1] = useState(today);
  const [d2, setD2] = useState(today);
  const [rows, setRows] = useState<LoadRow[]>([]);
  const [days, setDays] = useState<Array<{ plan_date: string; qty: number; cap: number; load: number | null; bottleneck: string }>>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [caps, setCaps] = useState<CapRow[]>([]);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ line_code: "", product_code: "", process: "", uph: "", std_headcount: "" });

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: LoadRow[]; days: typeof days; summary: Record<string, number> }>(
      "/plan/load", { d1, d2 }));
    if (d) { setRows(d.rows); setDays(d.days); setSummary(d.summary); setErr(""); } else setErr(e);
    const [c, e2] = await call(() => mesrjApi.get<{ rows: CapRow[] }>("/plan/capmaster/list", { size: 200 }));
    if (c) setCaps(c.rows); else if (e2) setErr(e2);
  }, [d1, d2]);
  useEffect(() => { void load(); }, [load]);

  const saveCap = async () => {
    const [, e] = await call(() => mesrjApi.post<unknown>("/plan/capmaster/save", {
      line_code: form.line_code.trim(), product_code: form.product_code.trim(),
      process: form.process.trim(), uph: Number(form.uph || 0),
      std_headcount: Number(form.std_headcount || 0),
    }));
    if (e) { setErr(e); return; }
    setErr("");
    setForm({ line_code: "", product_code: "", process: "", uph: "", std_headcount: "" });
    await load();
  };

  const delCap = async (id: number) => {
    if (!window.confirm("删除该产能标准？")) return;
    await call(() => mesrjApi.post<unknown>("/plan/capmaster/delete", { id }));
    await load();
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="date" value={d1} onChange={e => setD1(e.target.value)} style={inp} />
        <span>~</span>
        <input type="date" value={d2} onChange={e => setD2(e.target.value)} style={inp} />
        <button onClick={() => void load()}>{t("search", locale)}</button>
        {summary && (
          <span style={{ fontSize: 12, color: "#64748b" }}>
            计划 {summary.qty} · 产能 {summary.cap} · 均载 {summary.load ?? "-"}% · 峰值 {summary.peak}% · 超载 {summary.over} · 无产能 {summary.no_capacity}
          </span>
        )}
      </div>
      <Err msg={err} />
      <div style={{ overflowX: "auto", ...box }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>
            {["日期", "班次", "产品", "工序", "计划量", "UPH", "小时", "产能", "负载%"].map(h => (
              <th key={h} style={{ padding: "7px 10px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.plan_date}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.shift_name}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.product_code}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.process}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.qty}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.uph || "—"}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.hours}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9" }}>{r.cap || "—"}</td>
                <td style={{ padding: "6px 10px", borderBottom: "1px solid #f1f5f9", color: (r.load ?? 0) > 100 ? "#b91c1c" : undefined }}>
                  {r.load === null ? "—" : `${r.load}%`}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} style={{ padding: 16, color: "#94a3b8" }}>{t("no_data", locale)}</td></tr>}
          </tbody>
        </table>
      </div>
      {days.length > 0 && (
        <div style={{ ...box, fontSize: 12, color: "#475569" }}>
          日汇总：{days.map(d => `${d.plan_date} ${d.qty}/${d.cap}${d.load !== null ? `(${d.load}%${d.bottleneck ? `，瓶颈 ${d.bottleneck}` : ""})` : ""}`).join("  ·  ")}
        </div>
      )}
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>产能标准（UPH）维护</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {([["line_code", "产线"], ["product_code", "产品/机型"], ["process", "工序"], ["uph", "UPH"], ["std_headcount", "标准人数"]] as const).map(([k, ph]) => (
            <input key={k} value={form[k]} onChange={e => setForm(s => ({ ...s, [k]: e.target.value }))}
              placeholder={ph} style={{ ...inp, width: 130 }} />
          ))}
          <button onClick={() => void saveCap()}>保存</button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {caps.map(c => (
              <tr key={c.id}>
                <td style={{ padding: "4px 8px" }}>{c.line_code}</td>
                <td style={{ padding: "4px 8px" }}>{c.product_code}</td>
                <td style={{ padding: "4px 8px" }}>{c.process}</td>
                <td style={{ padding: "4px 8px" }}>UPH {c.uph}</td>
                <td style={{ padding: "4px 8px" }}>{c.std_headcount} 人</td>
                <td style={{ padding: "4px 8px" }}>
                  <button onClick={() => void delCap(c.id)} style={{ fontSize: 12 }}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
