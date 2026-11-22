import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { t } from "./i18n";

// 运行中 OA 的薪酬引擎配置面板 —— 2026-11-23 前端 parity 审计补的最后一块。
// /api/payroll/{overview,params,insurance-rates,bands} + /api/salary/classes
// 返回嵌套对象/多表结构,通用 GenericListPage(单 URL+单表)放不下,所以做成
// 专用(bespoke)面板。只读:引擎配置归运行中的 OA 所有,调档在源系统做,
// live-sync 每 5 分钟把 salary_param / salary_insurance_rate /
// attendance_time_band / salary_class 带进来。

interface DeferralBucket { count: number; amount: number }
interface EngineOverview {
  period: string; engine: string; employees: number; hireDateMissing: number;
  deferral: { pending: DeferralBucket; settled: DeferralBucket; waived: DeferralBucket };
  params: Record<string, unknown>;
  tax?: unknown;
}
interface ParamItem { key: string; value: string; type: string; label: string; effectiveFrom?: string; editable?: boolean }
interface ParamsPayload { editable: string[]; items: ParamItem[] }
interface InsRow {
  id: number; code: string; name: string; nameVi?: string; mode: string;
  employeeRate?: number; companyRate?: number; employeeFixed?: number; companyFixed?: number;
  baseMode?: string; capBase?: number; capNote?: string; active?: boolean; effectiveFrom?: string;
}
interface BandSet { id: number; code: string; version: number; effectiveFrom: string; name: string }
interface BandRow {
  id: number; seq: number; code: string; name: string; nameVi?: string;
  dayKind?: string; shiftType?: string; start?: string; end?: string;
  standardHours?: number; tableRate?: number; legalMinRate?: number; adoptedRate?: number;
  isOt?: boolean; countsTowardOtCap?: boolean;
}
interface BandsPayload { set: BandSet | null; bands: BandRow[] }
interface ClassNode {
  id: string | number; code?: string; name?: string; name_vi?: string; source?: string;
  default_card_rule_code?: string | null; active?: boolean; children?: ClassNode[] | null;
}

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
};
const yn = (v: unknown, locale: Locale) =>
  v ? (locale === "en-US" ? "yes" : locale === "vi-VN" ? "có" : "是") : (locale === "en-US" ? "no" : locale === "vi-VN" ? "không" : "否");

function flattenClasses(nodes: ClassNode[], depth = 0, out: Array<{ node: ClassNode; depth: number }> = []) {
  for (const n of nodes ?? []) {
    out.push({ node: n, depth });
    if (n.children?.length) flattenClasses(n.children, depth + 1, out);
  }
  return out;
}

export function PayrollEngineView({ locale }: { locale: Locale }) {
  const L = (zh: string, en: string, vi: string) => (locale === "vi-VN" ? vi : locale === "en-US" ? en : zh);
  const [data, setData] = useState<{ ov: EngineOverview; params: ParamsPayload; ins: InsRow[]; bands: BandsPayload; classes: ClassNode[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [ov, params, ins, bands, classes] = await Promise.all([
        apiClient.get<EngineOverview>("/api/payroll/overview"),
        apiClient.get<ParamsPayload>("/api/payroll/params"),
        apiClient.get<InsRow[]>("/api/payroll/insurance-rates"),
        apiClient.get<BandsPayload>("/api/payroll/bands"),
        apiClient.get<ClassNode[]>("/api/salary/classes"),
      ]);
      setData({ ov, params, ins, bands, classes });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{L(`加载失败:`, "Load failed: ", "Tải thất bại: ")}{error}</p>;
  if (loading || !data) return <div className="empty-state">{t("common.loading", locale)}</div>;
  const { ov, params, ins, bands, classes } = data;

  const card = (k: string, v: string | number, hint?: string) => (
    <div className="surface-panel" key={k} style={{ flex: "1 1 180px", minWidth: 170, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{k}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{v}</div>
      {hint ? <div style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)", marginTop: 4 }}>{hint}</div> : null}
    </div>
  );

  const th = (s: string) => <th key={s} style={{ whiteSpace: "nowrap" }}>{s}</th>;
  const td = (s: ReactNode, k: string) => <td key={k}>{s}</td>;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{L("薪酬引擎 · 运行中 OA", "Payroll engine · running OA", "Engine bảng lương · OA trực tiếp")}</h2>
            <p className="text-xs" style={{ color: "var(--text-muted, #64748b)" }}>
              {L("只读镜像:引擎配置归源系统,调档请去运行中的 OA,同步每 5 分钟生效。",
                "Read-only mirror: the engine config belongs to the source system — change it in the running OA; sync applies every 5 minutes.",
                "Bản sao chỉ đọc: cấu hình engine thuộc hệ thống nguồn — hãy sửa trong OA trực tiếp, đồng bộ áp dụng mỗi 5 phút.")}
            </p>
          </div>
          <button type="button" onClick={() => void load()} title={t("common.refresh", locale)}>{t("common.refresh", locale)}</button>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {card(L("结算期", "Period", "Kỳ"), ov.period, `${L("引擎", "Engine", "Engine")} ${ov.engine}`)}
          {card(L("在册员工", "Employees", "Nhân viên"), ov.employees, ov.hireDateMissing ? `${L("缺入职日期", "missing hire date", "thiếu ngày vào")} ${ov.hireDateMissing}` : undefined)}
          {card(L("递延·待处理", "Deferral · pending", "Hoãn · chờ"), `${ov.deferral.pending.count} · ${money(ov.deferral.pending.amount)}`)}
          {card(L("递延·已结", "Deferral · settled", "Hoãn · đã xử lý"), `${ov.deferral.settled.count} · ${money(ov.deferral.settled.amount)}`)}
          {card(L("递延·豁免", "Deferral · waived", "Hoãn · miễn"), `${ov.deferral.waived.count} · ${money(ov.deferral.waived.amount)}`)}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {Object.entries(ov.params ?? {}).map(([k, v]) => (
            <span key={k} style={{ fontSize: 12, background: "#f1f5f9", borderRadius: 6, padding: "4px 8px" }}>
              <b>{k}</b>={String(v)}
            </span>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <h3 style={{ margin: "0 0 8px" }}>{L("引擎参数", "Engine parameters", "Tham số engine")}</h3>
        <div className="table-shell">
          <table>
            <thead><tr>{[L("参数", "Parameter", "Tham số"), L("值", "Value", "Giá trị"), L("类型", "Type", "Loại"), L("生效日", "Effective", "Hiệu lực"), L("源侧可改", "Editable at source", "Sửa được ở nguồn")].map(th)}</tr></thead>
            <tbody>
              {(params.items ?? []).map(p => (
                <tr key={p.key}>
                  {td(<span title={p.key}>{p.label}</span>, "l")}
                  {td(p.value, "v")}
                  {td(p.type, "t")}
                  {td(p.effectiveFrom ?? "—", "e")}
                  {td(p.editable ? "✓" : "—", "x")}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-panel">
        <h3 style={{ margin: "0 0 8px" }}>{L("保险费率", "Insurance rates", "Tỷ lệ bảo hiểm")}</h3>
        <div className="table-shell">
          <table>
            <thead><tr>{[L("险种", "Type", "Loại"), L("名称", "Name", "Tên"), L("模式", "Mode", "Chế độ"), L("个人%", "Employee %", "NV %"), L("公司%", "Company %", "CTY %"), L("个人固定", "Emp fixed", "NV cố định"), L("公司固定", "Co fixed", "CTY cố định"), L("基数口径", "Base", "Gốc"), L("封顶基数", "Cap", "Trần"), L("生效", "Effective", "Hiệu lực")].map(th)}</tr></thead>
            <tbody>
              {(ins ?? []).map(r => (
                <tr key={r.id} style={r.active ? undefined : { opacity: .55 }}>
                  {td(<code>{r.code}</code>, "c")}
                  {td(`${r.name}${r.nameVi ? ` / ${r.nameVi}` : ""}${r.capNote ? "" : ""}`, "n")}
                  {td(r.mode, "m")}
                  {td(r.employeeRate ?? "—", "er")}
                  {td(r.companyRate ?? "—", "cr")}
                  {td(r.employeeFixed ? money(r.employeeFixed) : "—", "ef")}
                  {td(r.companyFixed ? money(r.companyFixed) : "—", "cf")}
                  {td(r.baseMode ?? "—", "bm")}
                  {td(r.capBase ? `${money(r.capBase)}${r.capNote ? ` · ${r.capNote}` : ""}` : "—", "cb")}
                  {td(r.effectiveFrom ?? "—", "ef2")}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-panel">
        <h3 style={{ margin: "0 0 8px" }}>
          {L("时段倍率表", "Time-band rates", "Bảng hệ số khung giờ")}
          {bands.set ? <span style={{ fontWeight: 400, fontSize: 13, color: "var(--text-muted, #64748b)" }}> · {bands.set.code} v{bands.set.version} ({bands.set.effectiveFrom})</span> : null}
        </h3>
        <div className="table-shell">
          <table>
            <thead><tr>{[L("档", "Band", "Bậc"), L("名称", "Name", "Tên"), L("日型", "Day kind", "Loại ngày"), L("班次", "Shift", "Ca"), L("时段", "Window", "Khung giờ"), L("标准工时", "Std hrs", "Giờ chuẩn"), L("表定倍率", "Table rate", "Hệ số bảng"), L("法定下限", "Legal min", "Tối thiểu luật"), L("采用倍率", "Adopted", "Áp dụng"), L("加班?", "OT?", "OT?")].map(th)}</tr></thead>
            <tbody>
              {(bands.bands ?? []).map(b => (
                <tr key={b.id}>
                  {td(<span><code>{b.code}</code> #{b.seq}</span>, "cd")}
                  {td(`${b.name}${b.nameVi ? ` / ${b.nameVi}` : ""}`, "n")}
                  {td(b.dayKind ?? "—", "dk")}
                  {td(b.shiftType ?? "—", "st")}
                  {td(b.start ? `${b.start}–${b.end}` : "—", "w")}
                  {td(b.standardHours ?? "—", "sh")}
                  {td(b.tableRate ?? "—", "tr")}
                  {td(b.legalMinRate ?? "—", "lr")}
                  {td(b.adoptedRate ?? "—", "ar")}
                  {td(b.isOt ? `${yn(true, locale)}${b.countsTowardOtCap ? "" : ` (${L("不计上限", "not capped", "không tính trần")})`}` : yn(false, locale), "ot")}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-panel">
        <h3 style={{ margin: "0 0 8px" }}>{L("工资类别", "Salary classes", "Bậc lương")}</h3>
        <div className="table-shell">
          <table>
            <thead><tr>{[L("代码", "Code", "Mã"), L("名称", "Name", "Tên"), L("来源", "Source", "Nguồn"), L("默认打卡规则", "Default card rule", "Quy tắc chấm công"), L("启用", "Active", "Kích hoạt")].map(th)}</tr></thead>
            <tbody>
              {flattenClasses(classes ?? []).map(({ node, depth }, i) => (
                <tr key={`${node.id}-${i}`} style={node.active === false ? { opacity: .55 } : undefined}>
                  {td(<code>{node.code ?? "—"}</code>, "c")}
                  {td(<span style={{ paddingLeft: depth * 18, fontWeight: depth ? 400 : 600 }}>{node.name ?? "—"}{node.name_vi && node.name_vi !== node.name ? ` / ${node.name_vi}` : ""}</span>, "n")}
                  {td(node.source ?? "—", "s")}
                  {td(node.default_card_rule_code ?? "—", "r")}
                  {td(node.active === false ? yn(false, locale) : yn(true, locale), "a")}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
