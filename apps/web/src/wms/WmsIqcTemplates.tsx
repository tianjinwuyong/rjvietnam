import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, ClipboardCheck } from "lucide-react";
import { t } from "../i18n";
import { apiClient } from "../api/client";
import type { Locale } from "../../../../packages/shared-types/src/factory";

/** /wms/iqc-templates 一行（源 WMS /iqc/template + /iqc/standard-library） */
interface TemplateRow {
  id: number;
  templateName: string;
  templateCode: string;
  version?: string | null;
  status?: string | null;
  description?: string | null;
  packagingAql?: number | null;
  appearanceLevel?: string | null;
  appearanceAql?: number | null;
  dimensionLevel?: string | null;
  dimensionAql?: number | null;
  reliabilitySampleSize?: number | null;
  environmentalSampleSize?: number | null;
  itemCount?: number;
}

interface TemplateItem {
  id: number;
  sectionType: string;
  itemName: string;
  standard?: string | null;
  spec?: string | null;
  lsl?: number | null;
  usl?: number | null;
  unit?: string | null;
  aql?: number | null;
  samplingPlan?: string | null;
  sampleSize?: number | null;
  ac?: number | null;
  re?: number | null;
  isRequired?: boolean | number | null;
}

interface TemplateDetail extends TemplateRow {
  items: TemplateItem[];
}

const SECTION_LABEL: Record<string, string> = {
  packaging: "包装",
  appearance: "外观",
  dimension: "尺寸",
  reliability: "可靠性",
  environmental: "环境",
};

export function WmsIqcTemplates({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiClient.get<{ items: TemplateRow[] }>("/wms/iqc-templates", { q })
      .then((r) => { if (alive) { setRows(r.items || []); setError(""); } })
      .catch((err) => { if (alive) setError(String(err?.message || err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q]);

  useEffect(() => {
    if (openId == null) { setDetail(null); return; }
    let alive = true;
    setDetailError("");
    apiClient.get<{ data: TemplateDetail }>(`/wms/iqc-templates/${openId}`)
      .then((r) => { if (alive) setDetail(r.data); })
      .catch((err) => { if (alive) setDetailError(String(err?.message || err)); });
    return () => { alive = false; };
  }, [openId]);

  const grouped = useMemo(() => {
    const map = new Map<string, TemplateItem[]>();
    for (const it of detail?.items || []) {
      const key = String(it.sectionType || "other");
      map.set(key, [...(map.get(key) || []), it]);
    }
    return [...map.entries()];
  }, [detail]);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><FileSpreadsheet size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />IQC 检验模板库</h2>
            <p>原 WMS 的检验报告模板（包装/外观/尺寸/可靠性/环境），点一行看检验项。</p>
          </div>
          <div className="toolbar" style={{ gap: 8, alignItems: "center" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("common.search", locale)}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
            {loading ? <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.loading", locale)}</span> : null}
          </div>
        </div>
        {error ? <p style={{ color: "var(--danger)", fontSize: 12 }}>{error}</p> : null}
        <div className="table-shell" style={{ maxHeight: 320, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>模板编号</th>
                <th>模板名称</th>
                <th>版本</th>
                <th>包装AQL</th>
                <th>外观</th>
                <th>尺寸</th>
                <th>检验项</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  style={{ cursor: "pointer", background: openId === r.id ? "var(--nav)" : undefined }}>
                  <td><code style={{ fontSize: 11 }}>{r.templateCode}</code></td>
                  <td>
                    <strong>{r.templateName}</strong>
                    {r.description ? <div style={{ fontSize: 10, color: "var(--muted)" }}>{r.description}</div> : null}
                  </td>
                  <td>{r.version || "-"}</td>
                  <td>{r.packagingAql ?? "-"}</td>
                  <td>{r.appearanceLevel || "-"}{r.appearanceAql != null ? ` / ${r.appearanceAql}` : ""}</td>
                  <td>{r.dimensionLevel || "-"}{r.dimensionAql != null ? ` / ${r.dimensionAql}` : ""}</td>
                  <td>{r.itemCount ?? 0}</td>
                  <td><span className="badge badge-ok">{r.status || "ACTIVE"}</span></td>
                </tr>
              ))}
              {!rows.length && !loading ? (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)" }}>没有模板</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {openId != null ? (
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h3><ClipboardCheck size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />{detail?.templateName || `模板 #${openId}`}</h3>
              <p style={{ fontSize: 12, color: "var(--muted)" }}>
                可靠性抽样 {detail?.reliabilitySampleSize ?? "-"} / 环境抽样 {detail?.environmentalSampleSize ?? "-"}
              </p>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => setOpenId(null)}>收起</button>
          </div>
          {detailError ? <p style={{ color: "var(--danger)", fontSize: 12 }}>{detailError}</p> : null}
          {grouped.map(([section, items]) => (
            <div key={section} style={{ marginBottom: 14 }}>
              <h4 style={{ fontSize: 13, margin: "8px 0 6px" }}>{SECTION_LABEL[section] || section}</h4>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>检验项</th>
                      <th>标准</th>
                      <th>规格</th>
                      <th>LSL</th>
                      <th>USL</th>
                      <th>单位</th>
                      <th>AQL</th>
                      <th>抽样</th>
                      <th>Ac/Re</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id}>
                        <td>{it.itemName}</td>
                        <td style={{ fontSize: 12 }}>{it.standard || "-"}</td>
                        <td style={{ fontSize: 12 }}>{it.spec || "-"}</td>
                        <td>{it.lsl ?? "-"}</td>
                        <td>{it.usl ?? "-"}</td>
                        <td>{it.unit || "-"}</td>
                        <td>{it.aql ?? "-"}</td>
                        <td style={{ fontSize: 11 }}>{it.samplingPlan || (it.sampleSize != null ? `n=${it.sampleSize}` : "-")}</td>
                        <td>{it.ac ?? "-"}/{it.re ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {detail && !detail.items.length ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>这个模板没有明细行（原系统只存了表头）。</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
