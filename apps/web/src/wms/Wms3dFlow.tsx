import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import { useRef, useState } from "react";
import type { Mesh } from "three";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";

type NodeKey = "receiving" | "qr" | "iqc" | "finished" | "defect" | "mrb" | "issue";
type FlowNode = { key: NodeKey; label: string; en: string; position: [number, number, number]; color: string; tab: string };

const NODES: FlowNode[] = [
  { key: "receiving", label: "收货待办", en: "Receiving", position: [-9, 1, 0], color: "#f59e0b", tab: "materialReceiving" },
  { key: "qr", label: "QR绑定仓库", en: "QR binding", position: [-5.5, 1, 0], color: "#2563eb", tab: "qrBinding" },
  { key: "iqc", label: "IQC检验", en: "IQC inspection", position: [-2, 1, 0], color: "#7c3aed", tab: "iqcInspect" },
  { key: "finished", label: "成品仓库", en: "Finished stock", position: [2, 1.4, 2.8], color: "#16a34a", tab: "inventory" },
  { key: "defect", label: "不良品仓库", en: "Defect stock", position: [2, 1.4, -2.8], color: "#dc2626", tab: "defectArchive" },
  { key: "mrb", label: "MRB评审", en: "MRB review", position: [5.5, 1.4, -2.8], color: "#b91c1c", tab: "mrbApproval" },
  { key: "issue", label: "工单领料/使用", en: "Issue and use", position: [5.5, 1.4, 2.8], color: "#0891b2", tab: "pdaConsumption" },
];
const SLA_HOURS: Record<string, number> = { receiving: 2, qr: 1, iqc: 24, defect: 8, mrb: 24 };

function FlowNode3d({ node, locale }: { node: FlowNode; locale: Locale }) {
  const mesh = useRef<Mesh>(null);
  return <group position={node.position} onClick={(event) => { event.stopPropagation(); window.location.href = `/?view=wms&wmsTab=${node.tab}`; }}>
    <mesh ref={mesh} castShadow receiveShadow>
      <boxGeometry args={[2.4, 1.15, 1.35]} />
      <meshStandardMaterial color={node.color} metalness={0.2} roughness={0.35} />
    </mesh>
    <Text position={[0, 0.08, 0.7]} fontSize={0.25} color="white" anchorX="center" anchorY="middle" maxWidth={2.1}>{locale === "en-US" ? node.en : node.label}</Text>
    <Text position={[0, -0.3, 0.7]} fontSize={0.14} color="#e0f2fe" anchorX="center" anchorY="middle">{node.key.toUpperCase()}</Text>
  </group>;
}

function FlowLine({ from, to, color = "#94a3b8" }: { from: [number, number, number]; to: [number, number, number]; color?: string }) {
  const dx = to[0] - from[0], dz = to[2] - from[2];
  const length = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dz, dx);
  return <mesh position={[(from[0] + to[0]) / 2, 0.55, (from[2] + to[2]) / 2]} rotation={[0, -angle, 0]}>
    <boxGeometry args={[length, 0.08, 0.08]} />
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
  </mesh>;
}

function MovingMaterial() {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.position.x = -9 + ((clock.getElapsedTime() * 1.2) % 7) ; });
  return <mesh ref={ref} position={[-9, 1.8, 0]} castShadow><sphereGeometry args={[0.18, 16, 16]} /><meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={1.5} /></mesh>;
}

export function Wms3dFlow({ locale }: { locale: Locale }) {
  const isEn = locale === "en-US";
  const params = new URLSearchParams(window.location.search);
  const [batch, setBatch] = useState(() => params.get("lotNo") || "");
  const [materialId, setMaterialId] = useState(() => params.get("materialId") || params.get("materialCode") || "");
  const [palletQr, setPalletQr] = useState(() => params.get("palletQr") || params.get("qr") || "");
  const [trace, setTrace] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const waitingMinutes = trace?.receivedAt ? Math.max(0, Math.floor((Date.now() - new Date(trace.receivedAt).getTime()) / 60000)) : null;
  const currentStage = trace?.iqcStatus && ["FAIL", "REJECTED", "HOLD"].includes(String(trace.iqcStatus).toUpperCase()) ? "mrb" : trace?.iqcStatus && ["PASS", "RELEASED"].includes(String(trace.iqcStatus).toUpperCase()) ? "finished" : "iqc";
  const slaMinutes = SLA_HOURS[currentStage] ? SLA_HOURS[currentStage] * 60 : null;
  const slaState = waitingMinutes == null || slaMinutes == null ? "unknown" : waitingMinutes >= slaMinutes ? "overdue" : waitingMinutes >= slaMinutes * 0.8 ? "warning" : "ok";
  const waitLabel = waitingMinutes == null ? "-" : Math.floor(waitingMinutes / 60) + "h " + (waitingMinutes % 60) + "m";
  const slaLabel = slaMinutes == null ? "-" : SLA_HOURS[currentStage] + "h";
  const search = async () => {
    const value = batch.trim() || materialId.trim() || palletQr.trim();
    if (!value) return;
    setLoading(true); setError("");
    try { const response: any = await wmsApi.getMaterialTrace(value); setTrace(response.data ?? response); }
    catch (err) { setTrace(null); setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  };
  const goTrace = () => { window.location.href = "/?view=wms&wmsTab=materialTrace"; };
  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header">
        <div><h2>{isEn ? "3D WMS Material Flow" : "3D WMS物料流程模拟"}</h2><p>{isEn ? "Trace by batch, material ID or pallet QR. Click a node to open its operation page." : "可按批次号、物料ID或栈板QR追踪；点击节点进入对应业务页面。"}</p></div>
        <div className="toolbar"><button className="action-button" type="button" onClick={goTrace}>{isEn ? "Open material trace" : "打开物料流程追踪"}</button></div>
      </div>
      <div className="toolbar" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input value={batch} onChange={event => setBatch(event.target.value)} placeholder={isEn ? "Batch no." : "批次号"} />
        <input value={materialId} onChange={event => setMaterialId(event.target.value)} placeholder={isEn ? "Material ID / code" : "物料ID / 物料编码"} />
        <input value={palletQr} onChange={event => setPalletQr(event.target.value)} placeholder={isEn ? "Pallet QR" : "栈板QR"} onKeyDown={event => { if (event.key === "Enter") void search(); }} />
        <button className="action-button" type="button" onClick={() => void search()} disabled={loading}>{loading ? "..." : (isEn ? "Trace" : "开始追踪")}</button>
        {error && <span style={{ color: "var(--danger)" }}>{error}</span>}
        {trace && <span>{isEn ? `${trace.materialCode || "Material"} · ${trace.lotNo || "-"} · ${trace.locationCode || "-"}` : `${trace.materialCode || "物料"} · ${trace.lotNo || "-"} · ${trace.locationCode || "-"}`}</span>}
      </div>
      <div style={{ height: 620, borderRadius: 14, overflow: "hidden", background: "linear-gradient(180deg,#0f172a,#1e293b)" }}>
        <Canvas camera={{ position: [0, 12, 17], fov: 42 }} shadows>
          <ambientLight intensity={0.8} /><directionalLight position={[4, 10, 8]} intensity={2} castShadow />
          <gridHelper args={[26, 26, "#475569", "#1e293b"]} position={[0, 0, 0]} />
          {NODES.map(node => <FlowNode3d key={node.key} node={node} locale={locale} />)}
          <FlowLine from={[-7.8, 1, 0]} to={[-6.7, 1, 0]} color="#fbbf24" />
          <FlowLine from={[-4.3, 1, 0]} to={[-3.2, 1, 0]} color="#60a5fa" />
          <FlowLine from={[-0.8, 1, 0]} to={[0.8, 1.4, 2.8]} color="#4ade80" />
          <FlowLine from={[-0.8, 1, 0]} to={[0.8, 1.4, -2.8]} color="#f87171" />
          <FlowLine from={[3.2, 1.4, -2.8]} to={[4.3, 1.4, -2.8]} color="#f87171" />
          <FlowLine from={[3.2, 1.4, 2.8]} to={[4.3, 1.4, 2.8]} color="#22d3ee" />
          <MovingMaterial />
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        </Canvas>
      </div>
      {trace && <section className="surface-panel" style={{ marginTop: 12, background: "#f8fafc" }}>
        <div className="section-header"><div><h3>{isEn ? "Material positions" : "物料所在位置"}</h3><p>{isEn ? "Current warehouse position and historical position changes" : "当前仓位及历史位置变化"}</p></div><strong>{trace.locationCode || (isEn ? "Location not assigned" : "尚未分配仓位")}</strong></div>
        <div className="toolbar" style={{ gap: 24, marginBottom: 12, flexWrap: "wrap" }}><span><strong>{isEn ? "Process status:" : "流程状态："}</strong> {trace.iqcStatus || trace.quality?.iqcStatus || (isEn ? "Pending IQC" : "待IQC")}</span><span><strong>{isEn ? "Current quantity:" : "当前数量："}</strong> {trace.remainingQty ?? trace.warehouseQty ?? 0}</span><span><strong>{isEn ? "Wait time:" : "已等待："}</strong> {waitLabel}</span><span><strong>{isEn ? "SLA:" : "处理时限："}</strong> {slaLabel}</span><span style={{ color: slaState === "overdue" ? "#dc2626" : slaState === "warning" ? "#d97706" : "#16a34a", fontWeight: 700 }}>{slaState === "overdue" ? (isEn ? "OVERDUE" : "已超时") : slaState === "warning" ? (isEn ? "Due soon" : "即将超时") : slaState === "ok" ? (isEn ? "Within SLA" : "时限内") : (isEn ? "SLA pending" : "等待时间数据")}</span><span><strong>{isEn ? "Material:" : "物料："}</strong> {trace.materialCode || "-"}</span><span><strong>{isEn ? "Batch:" : "批次："}</strong> {trace.lotNo || "-"}</span></div>
        <div className="table-shell"><table><thead><tr><th>{isEn ? "Time" : "时间"}</th><th>{isEn ? "Area" : "区域"}</th><th>{isEn ? "Location" : "库位"}</th><th>{isEn ? "Quantity" : "数量"}</th><th>{isEn ? "Position" : "坐标"}</th><th>{isEn ? "Type" : "动作"}</th><th>{isEn ? "Pallet QR" : "栈板QR"}</th></tr></thead><tbody>{(trace.positions || []).length ? trace.positions.map((row: any, index: number) => <tr key={row.id || index}><td>{row.occurredAt ? new Date(row.occurredAt).toLocaleString() : "-"}</td><td>{row.areaCode || "-"}</td><td>{row.locationCode || trace.locationCode || "-"}</td><td>{row.qty ?? (row.locationCode === trace.locationCode ? (trace.remainingQty ?? trace.warehouseQty ?? 0) : "-")}</td><td>{row.x ?? "-"},{row.z ?? "-"}</td><td>{row.movementType || row.positionType || "-"}</td><td>{trace.palletQr || palletQr || "-"}</td></tr>) : <tr><td colSpan={7}>{isEn ? "No position history" : "暂无位置记录"}</td></tr>}</tbody></table></div>
      </section>}
      <div className="toolbar" style={{ marginTop: 12, gap: 16 }}><span>🟡 {isEn ? "Material moving" : "物料流转中"}</span><span>🟢 {isEn ? "Pass / finished stock" : "合格/成品仓"}</span><span>🔴 {isEn ? "NG / MRB" : "不良/MRB"}</span><span style={{ color: "var(--muted)" }}>{isEn ? "3D simulation view" : "3D模拟视图"}</span></div>
    </section>
  </div>;
}
