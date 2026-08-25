import { useState, useEffect, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import type { EquipmentAsset, EquipmentTimelineEvent, EquipmentDocument, EquipmentComponent, MeterReading } from "../api/maintenance";

interface Props {
  locale: Locale;
  equipmentId: string;
  onBack?: () => void;
}

const TABS = [
  { key: "info", label: "基本信息" },
  { key: "timeline", label: "全历史时间线" },
  { key: "documents", label: "文档资料" },
  { key: "components", label: "子部件" },
  { key: "readings", label: "运行读数" },
] as const;

const CRIT_COLORS: Record<string, string> = { A: "#ef4444", B: "#f59e0b", C: "#22c55e" };
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active: { label: "运行中", cls: "badge-ok" }, online: { label: "运行中", cls: "badge-ok" },
  idle: { label: "待机", cls: "badge-info" }, maintenance: { label: "保养中", cls: "badge-warning" },
  repair: { label: "维修中", cls: "badge-danger" }, fault: { label: "故障", cls: "badge-danger" },
  offline: { label: "停机", cls: "badge-muted" }, scrapped: { label: "报废", cls: "badge-muted" },
};

const EVENT_ICONS: Record<string, string> = {
  repair: "🔧", pm: "🛡️", calibration: "📐", status_change: "🔄", event: "📋",
};

function InfoRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div style={{ display: "flex", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
      <span style={{ width: 140, color: "var(--muted)", flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, fontFamily: mono ? "monospace" : undefined }}>{value ?? "-"}</span>
    </div>
  );
}

export function MaintenanceEquipmentDetail({ locale, equipmentId, onBack }: Props) {
  const [asset, setAsset] = useState<EquipmentAsset | null>(null);
  const [tab, setTab] = useState<string>("info");
  const [loading, setLoading] = useState(true);
  const [timeline, setTimeline] = useState<EquipmentTimelineEvent[]>([]);
  const [documents, setDocuments] = useState<EquipmentDocument[]>([]);
  const [components, setComponents] = useState<EquipmentComponent[]>([]);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [tabLoading, setTabLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    maintenanceApi.getAssetById(equipmentId).then((res: any) => {
      setAsset(res?.data ?? res);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [equipmentId]);

  const loadTab = useCallback((tabKey: string) => {
    setTabLoading(true);
    const p = tabKey === "timeline" ? maintenanceApi.getAssetTimeline(equipmentId)
      : tabKey === "documents" ? maintenanceApi.getAssetDocuments(equipmentId)
      : tabKey === "components" ? maintenanceApi.getAssetComponents(equipmentId)
      : tabKey === "readings" ? maintenanceApi.getAssetReadings(equipmentId, { limit: 100 })
      : Promise.resolve(null);
    p.then((res: any) => {
      const d = res?.data ?? [];
      if (tabKey === "timeline") setTimeline(d);
      else if (tabKey === "documents") setDocuments(d);
      else if (tabKey === "components") setComponents(d);
      else if (tabKey === "readings") setReadings(d);
      setTabLoading(false);
    }).catch(() => setTabLoading(false));
  }, [equipmentId]);

  useEffect(() => { if (tab !== "info") loadTab(tab); }, [tab, loadTab]);

  if (loading) {
    return <div className="screen-stack"><section className="surface-panel" style={{padding:24}}>
      <div className="skeleton" style={{height:24,width:200,marginBottom:16}} />
      {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{height:14,width:"80%",marginBottom:8}} />)}
    </section></div>;
  }

  if (!asset) return <div className="screen-stack"><section className="surface-panel" style={{padding:24}}>设备未找到</section></div>;

  const st = STATUS_MAP[asset.status] ?? { label: asset.status, cls: "badge-muted" };

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel" style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          {onBack && <button className="btn btn-sm" onClick={onBack} style={{ fontSize: 12 }}>← 返回</button>}
          <h2 style={{ margin: 0, fontSize: 18 }}>{asset.name_zh}</h2>
          <span className={`badge ${st.cls}`}>{st.label}</span>
          <span style={{
            display: "inline-block", width: 24, height: 24, lineHeight: "24px", borderRadius: "50%",
            background: CRIT_COLORS[asset.criticality] ?? "#666", color: "#fff", fontSize: 12, fontWeight: 700, textAlign: "center",
          }}>{asset.criticality}</span>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)" }}>
          <span>编号: <strong style={{ fontFamily: "monospace" }}>{asset.asset_code}</strong></span>
          <span>类别: {asset.category_zh ?? "-"}</span>
          <span>产线: {asset.line_code ?? "-"}</span>
          <span>序列号: {asset.serial_no ?? "-"}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="surface-panel" style={{ padding: "0 16px" }}>
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
          {TABS.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              style={{
                padding: "10px 16px", fontSize: 13, border: "none", cursor: "pointer",
                background: "transparent", color: tab === tb.key ? "var(--primary)" : "var(--muted)",
                borderBottom: tab === tb.key ? "2px solid var(--primary)" : "2px solid transparent",
                fontWeight: tab === tb.key ? 600 : 400,
              }}>
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {tab === "info" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <section className="surface-panel" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>📋 基本信息</h3>
            <InfoRow label="资产编号" value={asset.asset_code} mono />
            <InfoRow label="中文名称" value={asset.name_zh} />
            <InfoRow label="英文名称" value={asset.name_en} />
            <InfoRow label="越南名称" value={asset.name_vi} />
            <InfoRow label="设备类别" value={asset.category_zh} />
            <InfoRow label="品牌" value={asset.vendor_name} />
            <InfoRow label="型号" value={asset.model_name} />
            <InfoRow label="序列号" value={asset.serial_no} mono />
            <InfoRow label="关键度" value={`${asset.criticality}级`} />
            <InfoRow label="状态" value={st.label} />
            <InfoRow label="负责工程师" value={asset.responsible_engineer_name} />
            <InfoRow label="位置" value={asset.location_name} />
          </section>
          <section className="surface-panel" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>💰 资产信息</h3>
            <InfoRow label="购入日期" value={asset.purchase_date?.slice(0, 10)} />
            <InfoRow label="购入价格" value={asset.purchase_price != null ? `${asset.currency ?? "USD"} ${Number(asset.purchase_price).toLocaleString()}` : null} />
            <InfoRow label="折旧年限" value={asset.depreciation_years ? `${asset.depreciation_years}年` : null} />
            <InfoRow label="当前价值" value={asset.current_value != null ? `${asset.currency ?? "USD"} ${Number(asset.current_value).toLocaleString()}` : null} />
            <InfoRow label="安装日期" value={asset.install_date?.slice(0, 10)} />
            <InfoRow label="投产日期" value={asset.commissioned_date?.slice(0, 10)} />
            <InfoRow label="保修到期" value={asset.warranty_expiry?.slice(0, 10)} />
            <InfoRow label="制造商" value={asset.manufacturer} />
            <InfoRow label="制造日期" value={asset.manufacture_date?.slice(0, 10)} />
            <h3 style={{ fontSize: 14, margin: "16px 0 12px" }}>⚙️ 技术参数</h3>
            <InfoRow label="额定功率" value={asset.rated_power_kw ? `${asset.rated_power_kw} kW` : null} />
            <InfoRow label="额定电压" value={asset.rated_voltage} />
            <InfoRow label="额定速度" value={asset.rated_speed} />
            <InfoRow label="外形尺寸" value={asset.dimensions} />
            <InfoRow label="重量" value={asset.weight_kg ? `${asset.weight_kg} kg` : null} />
            <InfoRow label="软件版本" value={asset.software_version} mono />
            <InfoRow label="固件版本" value={asset.firmware_version} mono />
          </section>
          <section className="surface-panel" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>📊 运行统计</h3>
            <InfoRow label="累计运行时间" value={asset.cumulative_runtime_hours != null ? `${Number(asset.cumulative_runtime_hours).toLocaleString()} h` : null} />
            <InfoRow label="累计产出计数" value={asset.cumulative_output_count != null ? Number(asset.cumulative_output_count).toLocaleString() : null} />
            <InfoRow label="维修次数" value={asset.total_repair_count} />
            <InfoRow label="维修总费用" value={asset.total_repair_cost != null ? `USD ${Number(asset.total_repair_cost).toLocaleString()}` : null} />
            <InfoRow label="保养次数" value={asset.total_pm_count} />
          </section>
          <section className="surface-panel" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>🇻🇳 越南合规</h3>
            <InfoRow label="进口报关单号" value={asset.import_customs_no} mono />
            <InfoRow label="原产地证号" value={asset.origin_certificate_no} mono />
            <InfoRow label="越南检验证号" value={asset.vn_inspection_cert_no} mono />
            <InfoRow label="QR码" value={asset.qr_code} mono />
          </section>
        </div>
      )}

      {tab === "timeline" && (
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>📜 全历史时间线 ({timeline.length}条)</h3>
          {tabLoading ? <div className="skeleton" style={{ height: 200, width: "100%" }} /> : (
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              {timeline.map((ev, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                  <span style={{ fontSize: 16 }}>{EVENT_ICONS[ev.event_type] ?? "📋"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="badge badge-muted" style={{ fontSize: 10 }}>{ev.event_type}</span>
                      {ev.ref_no && <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--muted)" }}>{ev.ref_no}</span>}
                      <span className={`badge ${ev.status === "completed" || ev.status === "pass" ? "badge-ok" : ev.status === "in_progress" ? "badge-warning" : "badge-muted"}`} style={{ fontSize: 10 }}>{ev.status}</span>
                    </div>
                    <div style={{ marginTop: 2 }}>{ev.description}</div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {ev.occurred_at ? new Date(ev.occurred_at).toLocaleString("zh-CN") : "-"}
                  </span>
                </div>
              ))}
              {timeline.length === 0 && <div style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>暂无记录</div>}
            </div>
          )}
        </section>
      )}

      {tab === "documents" && (
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>📁 文档资料 ({documents.length})</h3>
          {tabLoading ? <div className="skeleton" style={{ height: 120, width: "100%" }} /> : (
            <div className="table-shell"><table>
              <thead><tr><th>类型</th><th>文件名</th><th>文件编号</th><th>大小</th><th>有效期至</th><th>上传时间</th></tr></thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id}>
                    <td><span className="badge badge-muted" style={{ fontSize: 11 }}>{doc.doc_type}</span></td>
                    <td>{doc.file_url ? <a href={doc.file_url} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>{doc.doc_name}</a> : doc.doc_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{doc.doc_no ?? "-"}</td>
                    <td style={{ fontSize: 12 }}>{doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : "-"}</td>
                    <td style={{ fontSize: 12 }}>{doc.valid_until?.slice(0, 10) ?? "-"}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{doc.created_at?.slice(0, 10)}</td>
                  </tr>
                ))}
                {documents.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>暂无文档</td></tr>}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === "components" && (
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>🔩 子部件 ({components.length})</h3>
          {tabLoading ? <div className="skeleton" style={{ height: 120, width: "100%" }} /> : (
            <div className="table-shell"><table>
              <thead><tr><th>部件编号</th><th>名称</th><th>类型</th><th>序列号</th><th>制造商</th><th>安装日期</th><th>预期寿命(h)</th><th>状态</th></tr></thead>
              <tbody>
                {components.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{c.component_code}</td>
                    <td>{c.name_zh}</td>
                    <td><span className="badge badge-muted" style={{ fontSize: 11 }}>{c.component_type ?? "-"}</span></td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{c.serial_no ?? "-"}</td>
                    <td style={{ fontSize: 12 }}>{c.manufacturer ?? "-"}</td>
                    <td style={{ fontSize: 12 }}>{c.install_date?.slice(0, 10) ?? "-"}</td>
                    <td style={{ fontSize: 12, textAlign: "right" }}>{c.expected_life_hours?.toLocaleString() ?? "-"}</td>
                    <td><span className={`badge ${c.status === "active" ? "badge-ok" : "badge-muted"}`}>{c.status ?? "active"}</span></td>
                  </tr>
                ))}
                {components.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>暂无子部件</td></tr>}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === "readings" && (
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>📈 运行读数 ({readings.length})</h3>
          {tabLoading ? <div className="skeleton" style={{ height: 120, width: "100%" }} /> : (
            <div className="table-shell"><table>
              <thead><tr><th>时间</th><th>类型</th><th>读数</th><th>单位</th><th>来源</th><th>备注</th></tr></thead>
              <tbody>
                {readings.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{r.read_at ? new Date(r.read_at).toLocaleString("zh-CN") : "-"}</td>
                    <td><span className="badge badge-muted" style={{ fontSize: 11 }}>{r.reading_type}</span></td>
                    <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{Number(r.reading_value).toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{r.reading_unit ?? "-"}</td>
                    <td><span className={`badge ${r.source === "auto" ? "badge-ok" : "badge-info"}`} style={{ fontSize: 10 }}>{r.source === "auto" ? "自动" : "人工"}</span></td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.notes ?? "-"}</td>
                  </tr>
                ))}
                {readings.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>暂无读数</td></tr>}
              </tbody>
            </table></div>
          )}
        </section>
      )}
    </div>
  );
}
