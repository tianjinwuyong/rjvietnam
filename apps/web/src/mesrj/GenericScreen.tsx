// ============================================================================
// MES-ruijing W18 —— 通用「登记式」屏（generic registry-driven screens）
//
// 为什么要有这个文件：ruijing-mes 往 SMT 结构里嵌的剩余菜单叶子，绝大多数不是「新
// 业务」，而是「同一后端数据换个入口」。逐个手写 React 组件 = 40+ 份雷同的
// fetch+table+filter，改一处要改四十处。这里把「列表屏」的共同形状抽成一个驱动：
//   一条 endpoint + 列定义 + 过滤定义  →  渲染 + 查询 + 分页 + 导出
// 真正有交互流的屏（上料/老化进出/拆壳…）仍走各自的专用组件，不硬塞进这里。
//
// 后端一律复用 mesrj 既有接口（信封 {success,msg,data}，data 为数组或 {rows,total}），
// 不新建影子表、不新增路由 —— 见 docs/integration/grafting-protocol.md §1。
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;

export interface Col {
  key: string;
  /** i18n key；缺省回落到 key 本身 */
  label?: string;
  /** true = 只列出不参与导出/过滤 */
  hide?: boolean;
  /** 单元格渲染器名（由调用方在 renderers 里提供） */
  render?: string;
  width?: number;
}

export interface Filter {
  key: string;
  label?: string;
  /** select 选项来源：static 直接给值，或从首屏 data 的某列去重 */
  options?: Array<{ v: string; t: string }>;
  fromColumn?: string;
  type?: "text" | "select" | "date";
}

export interface ScreenDef {
  /** 菜单叶子 code（与 mesrj/menu.js 一致） */
  code: string;
  /** GET 端点（相对 /api/mesrj） */
  endpoint: string;
  /** data 里再取一层数组的路径（如 "items" / "stations"），用于 {kpi,rows:[…]} 这类响应 */
  pick?: string;
  /** 列定义；留空 = 用首行键自动出列（新后端/未知形状时不至于空白） */
  columns?: Col[];
  filters?: Filter[];
  /** 额外的固定查询参数 */
  params?: Record<string, string>;
  /** 顶部说明（i18n key） */
  note?: string;
  /**
   * 行内动作：
   *   kind="post"（默认）→ POST endpoint，body 由 row 派生
   *   kind="goto"        → 跳到本模块另一个叶子（源「去维修」= A.go('qlt.repairdesk')），
   *                        由调用方注入 onGoto，组件本身不持有路由状态
   */
  actions?: Array<{
    name: string; label: string;
    kind?: "post" | "goto";
    endpoint?: string;
    target?: string;
    /** 执行前确认：i18n key 或由行生成的文案（源 confirmBox） */
    confirm?: string | ((row: Record<string, unknown>) => string);
    /** 该动作是否对这一行可见（源 rowActions 按状态分支） */
    show?: (row: Record<string, unknown>) => boolean;
    body?: (row: Record<string, unknown>) => Record<string, unknown>;
  }>;
  /** 允许导出 CSV */
  exportable?: boolean;
}

/** 列留空时按首行键自动出列，最多 14 列，跳过内部字段 */
function autoCols(rows: Row[]): Col[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first)
    .filter(k => !/^(id|_)/.test(k) && typeof first[k] !== "object")
    .slice(0, 14)
    .map(k => ({ key: k, label: k }));
}

type Row = Record<string, unknown>;

/**
 * mesrj 信封的 data 有两种形状（数组 / {rows,total}），外部数据必须运行时判别，
 * 不能断言。这里收窄一次，后面读的都是已验证的类型。
 */
function pickArray(o: Record<string, unknown>, key: string): Row[] | null {
  const v = o[key];
  return Array.isArray(v) ? v.filter((x): x is Row => !!x && typeof x === "object") : null;
}

function toRows(d: unknown, pick?: string): { rows: Row[]; total: number | null } {
  if (Array.isArray(d)) return { rows: d.filter((x): x is Row => !!x && typeof x === "object"), total: d.length };
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    // 指定 pick 优先（如 {kpi, items:[…]} 取 items）
    if (pick) { const a = pickArray(o, pick); if (a) return { rows: a, total: a.length }; }
    for (const key of ["rows", "list", "items", "data"]) {
      const a = pickArray(o, key);
      if (a) {
        const total = typeof o.total === "number" ? o.total : a.length;
        return { rows: a, total };
      }
    }
  }
  return { rows: [], total: 0 };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length >= 19 && /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 19).replace("T", " ") : s;
}

export function GenericScreen({ locale, def, renderers, onGoto }: {
  locale: Locale;
  def: ScreenDef;
  renderers?: Record<string, (v: unknown, row: Row, locale: Locale) => ReactNode>;
  onGoto?: (code: string, row: Row) => void;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [fv, setFv] = useState<Record<string, string>>({});
  const [kw, setKw] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    setBusy(true);
    try {
      const q: Record<string, unknown> = { ...(def.params || {}) };
      if (kw.trim()) q.keyword = kw.trim();
      for (const [k, v] of Object.entries(fv)) if (v !== "") q[k] = v;
      const d = await mesrjApi.get<unknown>(def.endpoint, q);
      const parsed = toRows(d, def.pick);
      setRows(parsed.rows); setTotal(parsed.total);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); setRows([]); }
    finally { setBusy(false); }
  }, [def, kw, fv]);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (a: NonNullable<ScreenDef["actions"]>[number], row: Record<string, unknown>) => {
    setErr(""); setMsg("");
    if (a.kind === "goto") {
      if (a.target && onGoto) onGoto(a.target, row);
      return;
    }
    if (!a.endpoint) return;
    if (a.confirm) {
      const text = typeof a.confirm === "function" ? a.confirm(row) : t(a.confirm, locale);
      if (!window.confirm(text)) return;
    }
    try {
      await mesrjApi.post(a.endpoint, a.body ? a.body(row) : { id: row.id });
      setMsg(t("w18.done", locale)); void load();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  // label 既可能是 i18n key（"w18.c.station"）也可能是字面量（"SN"）：
  // t() 查不到时原样返回，所以两种都能安全过一遍，不会露出裸键。
  const L = (x?: string) => (x ? t(x, locale) : "");

  const exportCsv = () => {
    const cols = (def.columns?.length ? def.columns : autoCols(rows)).filter(c => !c.hide);
    const head = cols.map(c => L(c.label) || c.key).join(",");
    const body = rows.map(r => cols.map(c => `"${cell(r[c.key]).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + head + "\n" + body], { type: "text/csv" }));
    a.download = `${def.code}.csv`; a.click();
  };

  // select 选项：静态，或从当前数据某列去重
  const optsFor = (f: Filter): Array<{ v: string; t: string }> => {
    if (f.options) return f.options;
    if (f.fromColumn) {
      const seen = [...new Set(rows.map(r => cell(r[f.fromColumn!])).filter(Boolean))];
      return seen.map(v => ({ v, t: v }));
    }
    return [];
  };

  // 列：显式声明优先；留空则按首行键自动出列（后端形状未知时不空白）
  const shown = (def.columns?.length ? def.columns : autoCols(rows)).filter(c => !c.hide);
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={kw} onChange={e => setKw(e.target.value)} placeholder={t("w18.keyword", locale)} style={{ ...inp, width: 200 }} />
        {(def.filters || []).map(f => (
          f.type === "select" ? (
            <select key={f.key} value={fv[f.key] || ""} onChange={e => setFv(v => ({ ...v, [f.key]: e.target.value }))} style={inp}>
              <option value="">{L(f.label) || f.key}</option>
              {optsFor(f).map(o => <option key={o.v} value={o.v}>{L(o.t)}</option>)}
            </select>
          ) : f.type === "date" ? (
            <input key={f.key} type="date" value={fv[f.key] || ""} onChange={e => setFv(v => ({ ...v, [f.key]: e.target.value }))} style={inp} title={L(f.label) || f.key} />
          ) : (
            <input key={f.key} value={fv[f.key] || ""} onChange={e => setFv(v => ({ ...v, [f.key]: e.target.value }))} placeholder={L(f.label) || f.key} style={{ ...inp, width: 130 }} />
          )
        ))}
        <button onClick={() => void load()} disabled={busy}>{t("search", locale)}</button>
        {def.exportable !== false && <button onClick={exportCsv}>{t("w18.export", locale)}</button>}
        {total !== null && <span style={{ color: "#94a3b8", fontSize: 12, marginLeft: 6 }}>{t("w18.total", locale)} {total}</span>}
      </div>
      {def.note && <div style={{ ...box, fontSize: 13, color: "#475569" }}>{t(def.note, locale)}</div>}
      {err && <div style={{ color: "#b91c1c", fontSize: 13, padding: "4px 0", whiteSpace: "pre-wrap" }}>{err}</div>}
      {msg && <div style={{ color: "#15803d", fontSize: 13, padding: "4px 0" }}>{msg}</div>}
      <div style={box}>
        {!rows.length ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>{busy ? t("loading", locale) : t("w18.nodata", locale)}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>
                {shown.map(c => <th key={c.key} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left", width: c.width }}>{L(c.label) || c.key}</th>)}
                {def.actions?.length ? <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)" }}>{t("w18.actions", locale)}</th> : null}
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    {shown.map(c => (
                      <td key={c.key} style={{ padding: "5px 8px" }}>
                        {c.render && renderers?.[c.render] ? renderers[c.render](r[c.key], r, locale) : cell(r[c.key])}
                      </td>
                    ))}
                    {def.actions?.length ? (
                      <td style={{ padding: "5px 8px" }}>
                        {def.actions.filter(a => !a.show || a.show(r)).map(a => <button key={a.name} style={{ fontSize: 11, marginRight: 4 }} onClick={() => void runAction(a, r)}>{t(a.label, locale)}</button>)}
                      </td>
                    ) : null}
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

/**
 * 决策 b 的落地卡片：不复制 ERP 表格，而是把叶子指向 SMT 唯一的规范屏。
 * 模块选择本身是 hash 驱动（App.tsx:3120 `#<module>` + hashchange），所以这里
 * 只写 hash，不往共享 App.tsx 里塞 prop。
 */
export function JumpCard({ locale, module, label, entity }: {
  locale: Locale; module: string; label: string; entity: string;
}) {
  return (
    <div style={{ ...box, maxWidth: 720 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{entity}</div>
      <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.8, marginBottom: 14 }}>
        {t("w18j.body", locale)}
      </div>
      <a href={`#${module}`}
        style={{ display: "inline-block", background: "#1e293b", color: "#fff", borderRadius: 8,
                 padding: "9px 16px", fontSize: 14, textDecoration: "none" }}>
        {t("w18j.open", locale)} · {label}
      </a>
    </div>
  );
}
