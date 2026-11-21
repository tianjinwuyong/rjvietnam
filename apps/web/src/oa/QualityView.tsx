import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { t } from "./i18n";
import { GenericListPage, fmtDate, type GenCol } from "./OaGeneric";
import { QcFillForm } from "./QcFill";

/**
 * 品质管理组 —— IQC 检验 / MRB 评审 / IPQC·FAI·点检记录 / OQC 抽样 / 检验模板库。
 * 填写类页面（IPQC/FAI/点检填写）依赖模板选择与逐项录入，暂留建设中。
 */

const btn = { padding: "6px 12px", cursor: "pointer" } as const;

// ============ IQC ============

function IqcPage({ locale }: { locale: Locale }) {
  const [stats, setStats] = useState<{ summary?: { total?: number; ok?: number; ng?: number; passRate?: number | null } } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient.get<{ summary?: { total?: number; ok?: number; ng?: number; passRate?: number | null } }>("/api/iqc/stats")
      .then(setStats)
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const s = stats?.summary;

  return (
    <div>
      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
      {s && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          {[
            { label: t("statsExtra.total", locale) === "statsExtra.total" ? "total" : t("statsExtra.total", locale), v: s.total ?? 0, c: "#0f766e" },
            { label: "OK", v: s.ok ?? 0, c: "#15803d" },
            { label: "NG", v: s.ng ?? 0, c: "#b91c1c" },
            { label: "passRate", v: s.passRate == null ? "—" : `${Math.round(s.passRate * 100)}%`, c: "#b45309" },
          ].map(x => (
            <div key={x.label} className="surface-panel" style={{ flex: "1 1 130px", minWidth: 130, padding: "12px 14px" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{x.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: x.c, marginTop: 2 }}>{x.v}</div>
            </div>
          ))}
        </div>
      )}
      <GenericListPage
        locale={locale}
        url="/api/iqc/lots"
        columns={[
          { key: "lot_no", label: "lot", fmt: (v, row) => String(v ?? row.lot_no ?? row.id ?? "-") },
          { key: "material_code", label: "material", fmt: (v, row) => String(v ?? row.material_code ?? "-") },
          { key: "supplier_name", label: "supplier", fmt: (v, row) => String(v ?? row.supplier_name ?? "-") },
          { key: "status", label: t("announce.status", locale) },
          { key: "created_at", label: t("driveExtra.time", locale), fmt: v => fmtDate(v) },
        ]}
      />
    </div>
  );
}

// ============ OQC ============

function OqcPage({ locale }: { locale: Locale }) {
  const [batch, setBatch] = useState("50");
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (b: string) => {
    setError("");
    try {
      setRows(await apiClient.get<Array<Record<string, unknown>>>("/api/oqc/sampling", { batch: Number(b) || 50 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(batch); }, [load, batch]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <label style={{ fontSize: 13 }}>batch</label>
        <input type="number" min={2} value={batch} onChange={e => setBatch(e.target.value)} style={{ width: 90, padding: "5px 8px" }} />
        <button onClick={() => void load(batch)} style={btn}>{t("common.search", locale)}</button>
      </div>
      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
      {!rows ? <div className="empty-state">{t("common.loading", locale)}</div>
        : rows.length === 0 ? <div className="empty-state">{t("common.empty", locale)}</div>
          : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>work_order</th>
                    <th>product</th>
                    <th>batch</th>
                    <th>sample</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={String(r.id ?? i)}>
                      <td>{String(r.work_order_no ?? r.work_order ?? "-")}</td>
                      <td>{String(r.product_code ?? r.product_name ?? "-")}</td>
                      <td>{String(r.batch_qty ?? r.batch ?? "-")}</td>
                      <td>{String(r.sample_qty ?? r.sample ?? "-")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}

// ============ 点检填写 ============

function InspectFillPage({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [picked, setPicked] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const all = await apiClient.get<Array<Record<string, unknown>>>("/api/equipment/tasks");
      setRows((all || []).filter(r => r.status === "pending"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const done = async () => {
    if (!picked) return;
    try {
      await apiClient.post(`/api/equipment/tasks/${picked.id}/done`, { result: result.trim() || null });
      setMessage(t("equipTask.submitOk", locale));
      setPicked(null);
      setResult("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (picked) {
    return (
      <div className="surface-panel" style={{ padding: "16px 18px", maxWidth: 640 }}>
        <h3 style={{ margin: "0 0 10px" }}>
          {t("inspectRt.fillTitle", locale)} · {String(picked.equipment_name ?? picked.equipment_code ?? "-")}
        </h3>
        <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: "0 0 12px" }}>
          {String(picked.template_name ?? "-")} · {fmtDate(picked.plan_date)}
        </p>
        <label style={{ display: "block", marginBottom: 5, fontSize: 13 }}>{t("equipTask.value", locale)}</label>
        <textarea value={result} onChange={e => setResult(e.target.value)} rows={6}
          style={{ width: "100%", boxSizing: "border-box", marginBottom: 12, resize: "vertical" }} />
        {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void done()}
            style={{ padding: "8px 18px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6 }}>
            {t("equipTask.execute", locale)}
          </button>
          <button onClick={() => setPicked(null)} style={{ padding: "8px 14px", cursor: "pointer" }}>{t("common.cancel", locale)}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {message && <p style={{ fontSize: 13, color: "#15803d" }}>{message}</p>}
      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
      {!rows ? <div className="empty-state">{t("common.loading", locale)}</div>
        : rows.length === 0 ? <div className="empty-state">{t("common.empty", locale)}</div>
          : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("equipment.name", locale)}</th>
                    <th style={{ width: 130 }}>{t("equipment.code", locale)}</th>
                    <th style={{ width: 160 }}>{t("inspectTpl.title", locale) === "inspectTpl.title" ? "template" : t("inspectTpl.title", locale)}</th>
                    <th style={{ width: 110 }}>{t("training.planDate", locale)}</th>
                    <th style={{ width: 110 }}>{""}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={String(r.id)}>
                      <td>{String(r.equipment_name ?? "-")}</td>
                      <td>{String(r.equipment_code ?? "-")}</td>
                      <td>{String(r.template_name ?? "-")}</td>
                      <td>{fmtDate(r.plan_date)}</td>
                      <td>
                        <button onClick={() => setPicked(r)} style={{ padding: "4px 10px", cursor: "pointer" }}>
                          {t("equipTask.execute", locale)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}

// ============ 出口 ============

export type QualitySubView =
  | "iqcInspect" | "mrbReview" | "ipqcFill" | "ipqcRecords" | "faiFill" | "faiRecords"
  | "inspectFill" | "inspectRecords" | "oqcInspect" | "qcTemplates";

export function QualityView({ locale, sub, onNavigate }: { locale: Locale; sub: QualitySubView; onNavigate?: (sub: QualitySubView) => void }) {
  // 提报表单：由 sub 直接派生（避免 useState 初始值不随路由更新的缺陷）
  if (sub === "ipqcFill" || sub === "faiFill") {
    const back: QualitySubView = sub === "ipqcFill" ? "ipqcRecords" : "faiRecords";
    return (
      <QcFillForm
        key={sub}
        locale={locale}
        mode={sub === "ipqcFill" ? "ipqc" : "fai"}
        onDone={() => onNavigate?.(back)}
        onCancel={() => onNavigate?.(back)}
      />
    );
  }

  if (sub === "inspectFill") return <InspectFillPage locale={locale} />;

  switch (sub) {
    case "iqcInspect":
      return <IqcPage locale={locale} />;
    case "mrbReview":
      return (
        <GenericListPage
          locale={locale}
          url="/api/mrb/list"
          columns={[
            { key: "mrb_no", label: "MRB", fmt: (v, row) => String(v ?? row.mrb_no ?? row.id ?? "-") },
            { key: "material_code", label: "material", fmt: (v, row) => String(v ?? row.material_code ?? "-") },
            { key: "qty", label: "qty", fmt: v => String(v ?? "-") },
            { key: "status", label: t("announce.status", locale) },
            { key: "created_at", label: t("driveExtra.time", locale), fmt: v => fmtDate(v) },
          ]}
        />
      );
    case "ipqcRecords":
      return (
        <GenericListPage
          locale={locale}
          url="/api/ipqc/records"
          columns={[
            { key: "record_no", label: "no", fmt: (v, row) => String(v ?? row.record_no ?? row.id ?? "-") },
            { key: "line_name", label: t("ipqc.line", locale), fmt: (v, row) => String(v ?? row.line_name ?? "-") },
            { key: "shift", label: t("ipqc.shift", locale), fmt: v => String(v ?? "-") },
            { key: "check_date", label: t("ipqc.date", locale), fmt: v => fmtDate(v) },
            { key: "status", label: t("announce.status", locale) },
            { key: "checker_name", label: t("ipqc.checker", locale), fmt: v => String(v ?? "-") },
          ]}
        />
      );
    case "faiRecords":
      return (
        <GenericListPage
          locale={locale}
          url="/api/fai/records"
          columns={[
            { key: "record_no", label: "no", fmt: (v, row) => String(v ?? row.record_no ?? row.id ?? "-") },
            { key: "work_order_no", label: t("flowList.instanceNo", locale), fmt: v => String(v ?? "-") },
            { key: "check_date", label: t("ipqc.date", locale), fmt: v => fmtDate(v) },
            { key: "status", label: t("announce.status", locale) },
          ]}
        />
      );
    case "inspectRecords":
      return (
        <GenericListPage
          locale={locale}
          url="/api/equipment/tasks"
          columns={[
            { key: "id", label: "ID" },
            { key: "equipment_name", label: t("equipment.name", locale), fmt: (v, row) => String(v ?? row.equipment_code ?? "-") },
            { key: "plan_date", label: t("training.planDate", locale), fmt: v => fmtDate(v) },
            { key: "status", label: t("announce.status", locale) },
          ]}
        />
      );
    case "oqcInspect":
      return <OqcPage locale={locale} />;
    case "qcTemplates":
      return (
        <GenericListPage
          locale={locale}
          url="/api/qc/templates"
          columns={[
            { key: "code", label: t("ipqcMod.templateCode", locale), fmt: (v, row) => String(v ?? row.code ?? "-") },
            { key: "name", label: t("ipqcMod.templateName", locale), fmt: (v, row) => String(v ?? row.name ?? "-") },
            { key: "type", label: t("customField.scope", locale), fmt: (v, row) => String(v ?? row.scope ?? row.type ?? "-") },
            { key: "item_count", label: t("ipqcMod.itemCount", locale), fmt: (v, row) => String(v ?? row.item_count ?? "-") },
            { key: "enabled", label: t("ipqcMod.enabled", locale), fmt: (v, row) => ((v ?? row.enabled) ? "✓" : "—") },
            { key: "updated_at", label: t("doc.updateTime", locale), fmt: v => fmtDate(v) },
          ]}
        />
      );
    default:
      return <div className="empty-state">{t("common.empty", locale)}</div>;
  }
}
