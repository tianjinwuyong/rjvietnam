// @ts-nocheck
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { qmsApi, QmsSpcParam, QmsSpcReading, QmsSpcCpk, QmsSpcAlert } from "../api/qms";

const catColor: Record<string,string> = { SPI: "#fbbf24", AOI: "#fb923c", PLACEMENT: "#38bdf8", REFLOW: "#f87171", WAVE: "#a78bfa", FAI: "#34d399" };

function ControlChart({ readings, param }: { readings: QmsSpcReading[]; param: QmsSpcParam }) {
  if (!readings.length) return <div style={{ color: "#64748b", padding: 20, textAlign: "center" }}>No data</div>;
  const vals = readings.map(r => r.measured_value).reverse();
  const w = 600, h = 200, pad = 40;
  const allVals = [...vals];
  if (param.ucl != null) allVals.push(param.ucl);
  if (param.lcl != null) allVals.push(param.lcl);
  if (param.usl != null) allVals.push(param.usl);
  if (param.lsl != null) allVals.push(param.lsl);
  const min = Math.min(...allVals) - 5;
  const max = Math.max(...allVals) + 5;
  const range = max - min || 1;
  const x = (i: number) => pad + (i / Math.max(vals.length - 1, 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const line = (v: number, color: string, label: string, dash?: string) => (
    <g key={label}>
      <line x1={pad} y1={y(v)} x2={w - pad} y2={y(v)} stroke={color} strokeWidth={1} strokeDasharray={dash ?? "4,4"} opacity={0.7} />
      <text x={w - pad + 4} y={y(v) + 4} fill={color} fontSize={9}>{label}</text>
    </g>
  );
  const points = vals.map((v, i) => {
    const ooc = readings[readings.length - 1 - i]?.is_ooc;
    return <circle key={i} cx={x(i)} cy={y(v)} r={ooc ? 5 : 3} fill={ooc ? "#f87171" : "#38bdf8"} stroke={ooc ? "#f87171" : "none"} strokeWidth={ooc ? 2 : 0} />;
  });
  const path = vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b" }}>
      {param.ucl != null && line(param.ucl, "#f87171", "UCL")}
      {param.lcl != null && line(param.lcl, "#f87171", "LCL")}
      {param.usl != null && line(param.usl, "#fb923c", "USL", "8,4")}
      {param.lsl != null && line(param.lsl, "#fb923c", "LSL", "8,4")}
      {param.target_value != null && line(param.target_value, "#34d399", "Target", "2,4")}
      <path d={path} fill="none" stroke="#38bdf8" strokeWidth={1.5} opacity={0.6} />
      {points}
      <text x={pad} y={14} fill="#94a3b8" fontSize={11}>{param.param_name} ({param.unit})</text>
    </svg>
  );
}

export function QmsSpc({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useState<QmsSpcParam[]>([]);
  const [selParam, setSelParam] = useState<QmsSpcParam | null>(null);
  const [readings, setReadings] = useState<QmsSpcReading[]>([]);
  const [cpk, setCpk] = useState<QmsSpcCpk | null>(null);
  const [alerts, setAlerts] = useState<QmsSpcAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"chart" | "alerts">("chart");

  const loadParams = useCallback(() => {
    setLoading(true);
    qmsApi.listSpcParams({ is_active: "true" })
      .then(r => {
        const data = r.data?.data ?? r.data ?? [];
        setParams(data);
        if (data.length && !selParam) setSelParam(data[0]);
      })
      .catch(e => console.error("SPC params:", e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadParams(); }, [loadParams]);

  useEffect(() => {
    if (!selParam) return;
    qmsApi.listSpcReadings({ param_id: String(selParam.id), hours: "24", limit: "100" })
      .then(r => setReadings(r.data?.data ?? r.data ?? []))
      .catch(() => setReadings([]));
    qmsApi.getSpcCpk(selParam.id, 168)
      .then(r => setCpk(r.data?.data ?? r.data))
      .catch(() => setCpk(null));
  }, [selParam]);

  useEffect(() => {
    qmsApi.listSpcAlerts({ status: "OPEN" })
      .then(r => setAlerts(r.data?.data ?? r.data ?? []))
      .catch(() => setAlerts([]));
  }, [tab]);

  const ackAlert = (id: number) => {
    qmsApi.updateSpcAlert(id, { status: "ACKNOWLEDGED", acknowledged_by: "QC" })
      .then(() => setAlerts(a => a.filter(x => x.id !== id)))
      .catch(e => alert(e.message));
  };

  const cpkColor = (v: number | null) => v == null ? "#64748b" : v >= 1.33 ? "#34d399" : v >= 1.0 ? "#fbbf24" : "#f87171";

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ color: "#e2e8f0", fontSize: 20, marginBottom: 16 }}>{t("qms.spcTitle")}</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab("chart")} style={{ padding: "6px 16px", background: tab === "chart" ? "#2563eb" : "#1e293b", color: tab === "chart" ? "#fff" : "#94a3b8", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.controlChart")}</button>
        <button onClick={() => setTab("alerts")} style={{ padding: "6px 16px", background: tab === "alerts" ? "#dc2626" : "#1e293b", color: tab === "alerts" ? "#fff" : "#94a3b8", border: "none", borderRadius: 6, cursor: "pointer", position: "relative" }}>
          {t("qms.spcAlerts")} {alerts.length > 0 && <span style={{ background: "#f87171", color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 11, marginLeft: 4 }}>{alerts.length}</span>}
        </button>
      </div>

      {tab === "chart" && (
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ width: 200, flexShrink: 0 }}>
            <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>{t("qms.spcParams")}</div>
            {loading ? <div style={{ color: "#64748b" }}>...</div> : params.map(p => (
              <button key={p.id} onClick={() => setSelParam(p)}
                style={{ display: "block", width: "100%", padding: "8px 12px", marginBottom: 4, background: selParam?.id === p.id ? "#2563eb22" : "#1e293b", border: selParam?.id === p.id ? "1px solid #2563eb" : "1px solid #334155", borderRadius: 6, color: selParam?.id === p.id ? "#60a5fa" : "#94a3b8", cursor: "pointer", fontSize: 12, textAlign: "left" }}>
                <span style={{ color: catColor[p.category] ?? "#94a3b8", fontWeight: 600, marginRight: 6 }}>{p.category}</span>
                {locale === "zh" ? p.param_name : (p.param_name_en ?? p.param_name)}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            {selParam ? (
              <>
                <ControlChart readings={readings} param={selParam} />
                <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
                  <div style={{ background: "#1e293b", borderRadius: 10, padding: "14px 20px", minWidth: 120, textAlign: "center" }}>
                    <div style={{ color: "#94a3b8", fontSize: 11 }}>CPK</div>
                    <div style={{ color: cpkColor(cpk?.cpk ?? null), fontSize: 24, fontWeight: 700 }}>{cpk?.cpk ?? "-"}</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, padding: "14px 20px", minWidth: 120, textAlign: "center" }}>
                    <div style={{ color: "#94a3b8", fontSize: 11 }}>CP</div>
                    <div style={{ color: cpkColor(cpk?.cp ?? null), fontSize: 24, fontWeight: 700 }}>{cpk?.cp ?? "-"}</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, padding: "14px 20px", minWidth: 120, textAlign: "center" }}>
                    <div style={{ color: "#94a3b8", fontSize: 11 }}>Mean</div>
                    <div style={{ color: "#e2e8f0", fontSize: 24, fontWeight: 700 }}>{cpk?.mean ?? "-"}</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, padding: "14px 20px", minWidth: 120, textAlign: "center" }}>
                    <div style={{ color: "#94a3b8", fontSize: 11 }}>Std</div>
                    <div style={{ color: "#e2e8f0", fontSize: 24, fontWeight: 700 }}>{cpk?.std ?? "-"}</div>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 10, padding: "14px 20px", minWidth: 120, textAlign: "center" }}>
                    <div style={{ color: "#94a3b8", fontSize: 11 }}>N</div>
                    <div style={{ color: "#e2e8f0", fontSize: 24, fontWeight: 700 }}>{cpk?.count ?? 0}</div>
                  </div>
                  {cpk?.trend && (
                    <div style={{ background: "#fbbf2422", borderRadius: 10, padding: "14px 20px", minWidth: 120, textAlign: "center", border: "1px solid #fbbf24" }}>
                      <div style={{ color: "#fbbf24", fontSize: 11 }}>Trend</div>
                      <div style={{ color: "#fbbf24", fontSize: 16, fontWeight: 700 }}>{cpk.trend}</div>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>
                  USL: {selParam.usl ?? "-"} | LSL: {selParam.lsl ?? "-"} | UCL: {selParam.ucl ?? "-"} | LCL: {selParam.lcl ?? "-"} | Target: {selParam.target_value ?? "-"} {selParam.unit}
                </div>
              </>
            ) : <div style={{ color: "#64748b", padding: 40 }}>{t("qms.selectParam")}</div>}
          </div>
        </div>
      )}

      {tab === "alerts" && (
        <div>
          {alerts.length === 0 ? <div style={{ color: "#34d399", padding: 24 }}>{t("qms.noAlerts")}</div> : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid #334155" }}>
                {[t("qms.param"), t("qms.alertType"), t("qms.severity"), t("qms.message"), t("qms.time"), t("qms.action")].map(h => (
                  <th key={h} style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12, textAlign: "left" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {alerts.map(a => (
                  <tr key={a.id} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ padding: "10px 12px", color: "#38bdf8" }}>{a.param_code ?? a.param_id}</td>
                    <td style={{ padding: "10px 12px", color: a.alert_type === "OOC" ? "#f87171" : "#fbbf24", fontWeight: 600, fontSize: 12 }}>{a.alert_type}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ color: a.severity === "CRITICAL" ? "#f87171" : "#fbbf24", fontSize: 12 }}>{a.severity}</span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.message}</td>
                    <td style={{ padding: "10px 12px", color: "#64748b", fontSize: 12 }}>{new Date(a.created_at).toLocaleString()}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <button onClick={() => ackAlert(a.id)} style={{ padding: "4px 12px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>{t("qms.acknowledge")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
