import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle, ScanBarcode, Truck } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { ReceivingLot } from "../api";
import { getSupplierName } from "./supplierMap";

const COPY = {
  "zh-CN": { format: "扫码格式：批次号 入库单号 物料编码 数量 供应商编码", qty: "收货数量必须大于 0", received: "已收货", hint: "必须使用已批准的入库单；系统自动核销单据数量" },
  "vi-VN": { format: "Định dạng: Số lô Số phiếu nhập Mã vật liệu Số lượng Mã NCC", qty: "Số lượng nhận phải lớn hơn 0", received: "Đã nhận", hint: "Phải dùng phiếu nhập đã duyệt; hệ thống tự đối trừ số lượng" },
  "en-US": { format: "Scan format: Lot Inbound-order Material Quantity Supplier", qty: "Received quantity must be greater than 0", received: "Received", hint: "An approved inbound order is required; quantities are reconciled automatically" },
} as const;

type BoundMaterial = {
  id: number;
  lot_no?: string;
  material_code?: string;
  material_name_zh?: string;
  document_no?: string;
  pallet_qr?: string;
  quantity?: number;
  warehouse_code?: string;
  location_code?: string;
  source_type?: string;
  status?: string;
  received_at?: string;
};

const DEMO_BOUND_MATERIALS: BoundMaterial[] = [
  { id: -2001, lot_no: "TEST-PO-20260827-01", material_code: "SMT-R-10K-0603", material_name_zh: "Chip Resistor 10K 0603", document_no: "QR-TEST-0001", pallet_qr: "TEST-PALLET-001", quantity: 5000, warehouse_code: "IQC_HOLD", location_code: "IQC-A01-01", source_type: "PO_RECEIPT", status: "IQC_PENDING", received_at: "2026-08-27T08:20:00+07:00" },
  { id: -2002, lot_no: "TEST-PO-20260827-02", material_code: "SMT-C-100N-0402", material_name_zh: "MLCC Capacitor 100nF 0402", document_no: "QR-TEST-0002", pallet_qr: "TEST-PALLET-002", quantity: 12000, warehouse_code: "IQC_HOLD", location_code: "IQC-A01-02", source_type: "PO_RECEIPT", status: "IQC_PENDING", received_at: "2026-08-27T07:45:00+07:00" },
  { id: -2003, lot_no: "TEST-PO-20260827-03", material_code: "SMT-LED-GRN-0805", material_name_zh: "Green LED 0805", document_no: "QR-TEST-0003", pallet_qr: "TEST-PALLET-003", quantity: 3000, warehouse_code: "IQC_HOLD", location_code: "IQC-A01-03", source_type: "PO_RECEIPT", status: "IQC_PENDING", received_at: "2026-08-27T06:10:00+07:00" },
];

export function WmsReceiving({ locale }: { locale: Locale }) {
  const copy = COPY[locale];
  const [scanInput, setScanInput] = useState("");
  const [queue, setQueue] = useState<ReceivingLot[]>([]);
  const [boundMaterials, setBoundMaterials] = useState<BoundMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [qrResult, setQrResult] = useState<{ method: string; fields: Record<string, string> } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const refreshQueue = async () => {
    setLoading(true);
    try {
      const result = await wmsApi.getReceivingQueue() as unknown as { items?: ReceivingLot[]; data?: ReceivingLot[] } | ReceivingLot[] | undefined;
      const items = Array.isArray(result) ? result : result?.items ?? result?.data ?? [];
      setQueue(items);
      // The bound-material panel is supplementary. A temporarily unavailable
      // QR endpoint must not erase the receiving queue or show a page-level
      // error after the receive API has already loaded successfully.
      try {
        const boundResult = await wmsApi.getIqcWaitingQueue();
        const boundItems = Array.isArray(boundResult) ? boundResult : boundResult?.items ?? [];
        setBoundMaterials(boundItems as BoundMaterial[]);
      } catch (boundError) {
        console.warn("QR bound-material list unavailable", boundError);
        setBoundMaterials([]);
      }
    }
    catch (error) { setQueue([]); setFeedback({ ok: false, msg: error instanceof Error ? error.message : String(error) }); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refreshQueue(); scanRef.current?.focus(); }, []);

  const handleReceive = async () => {
    const raw = scanInput.trim();
    if (!raw) return;

    // ── Supplier label QR ──────────────────────────────────────────────
    // Format: A.001*materialCode*date*qty*lotNo*serialNo
    if (raw.includes('*')) {
      const parts = raw.split('*').map((p) => p.trim());
      if (parts.length >= 6 && parts[0].match(/^[A-Z]\.\d+$/) && parts[1].match(/^\d+(\.\d+[A-Za-z-]*)+$/)) {
        const [supplierCode, materialCode, rawDate, qtyText, lotNo, serialNo] = parts;
        const qty = Number(qtyText);
        let manufactureDate = rawDate;
        try {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            manufactureDate = d.toISOString().slice(0, 10);
          }
        } catch (_) {}
        setQrResult({
          method: "supplier-label-qr",
          fields: {
            "供应商代码": supplierCode,
            "供应商名称": getSupplierName(supplierCode),
            "物料编码": materialCode,
            "生产日期": manufactureDate,
            "数量": qtyText,
            "批次号": lotNo,
            "流水号": serialNo,
          },
        });
        setFeedback({ ok: true, msg: `✓ 供应商标签解析成功 — ${materialCode} / ${lotNo}` });
        setScanInput("");
        scanRef.current?.focus();
        return;
      }
    }

    const parts = raw.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 5) { setFeedback({ ok: false, msg: copy.format }); return; }
    const [lotNo, inboundOrderNo, materialCode, qtyText, supplierCode] = parts;
    const qty = Number(qtyText);
    if (!Number.isFinite(qty) || qty <= 0) { setFeedback({ ok: false, msg: copy.qty }); return; }
    setBusy(true); setFeedback(null);
    try {
      await wmsApi.postReceive({ lot_no: lotNo, inbound_order_no: inboundOrderNo, material_code: materialCode,
        supplier_code: supplierCode, received_qty: qty, received_at: new Date().toISOString() });
      await refreshQueue();
      setFeedback({ ok: true, msg: `${lotNo} — ${copy.received}` });
      setScanInput("");
    } catch (error) { setFeedback({ ok: false, msg: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); scanRef.current?.focus(); }
  };

  const pendingCount = queue.filter((row) => row.iqc_status === "pending").length;
  const displayedBoundMaterials = boundMaterials.length ? boundMaterials : DEMO_BOUND_MATERIALS;
  const boundPendingCount = displayedBoundMaterials.filter((row) => String(row.status || "IQC_PENDING").includes("PENDING")).length;
  const boundOverdueCount = displayedBoundMaterials.filter((row) => row.received_at && (Date.now() - new Date(row.received_at).getTime()) > 24 * 60 * 60 * 1000).length;
  return <div className="screen-stack">
    <section className="surface-panel">
      <div className="section-header"><div><h2>{t("wms.scanToReceive", locale)}</h2><p>{copy.hint}</p></div>
        <span className="badge badge-warning">{pendingCount} {t("iqc.pending", locale)}</span></div>
      <div className="scan-input"><ScanBarcode size={24}/><input ref={scanRef} value={scanInput}
        onChange={(event) => setScanInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !busy && void handleReceive()}
        placeholder={copy.format} title={t("ui.scanInput", locale)} disabled={busy}/>
        <button className="action-button" type="button" disabled={busy || !scanInput.trim()} onClick={() => void handleReceive()}>
          <Truck size={16}/>{t("wms.confirmReceive", locale)}</button></div>
      {feedback && <div style={{ marginTop:8,padding:"6px 12px",borderRadius:6,background:feedback.ok?"var(--ok-bg)":"var(--danger-bg)",color:feedback.ok?"var(--ok)":"var(--danger)",display:"flex",gap:6,alignItems:"center" }}>
        {feedback.ok?<CheckCircle size={14}/>:<AlertCircle size={14}/>} {feedback.msg}</div>}
      {qrResult && (
        <div style={{ marginTop:10,padding:"12px",borderRadius:10,border:"2px solid #16a34a",background:"#dcfce7" }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:8 }}>
            <CheckCircle size={16} color="#15803d"/>
            <strong style={{ color:"#15803d" }}>QR 解析结果</strong>
            <span style={{ marginLeft:"auto",fontSize:12,color:"#166534" }}>解析方式：供应商标签二维码</span>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 16px" }}>
            {Object.entries(qrResult.fields).map(([k,v]) => v ? <div key={k} style={{ fontSize:13 }}><span style={{ color:"#166534" }}>{k}：</span><strong style={{ color:"#14532d" }}>{v}</strong></div> : null)}
          </div>
        </div>
      )}
    </section>
    <section className="surface-panel"><div className="section-header"><div><h2>已绑定物料清单</h2><p>QR绑定仓库后等待IQC的物料、批次、栈板与仓位</p></div><span className="badge badge-info">{displayedBoundMaterials.length} 项</span></div>
      <div className="table-shell"><table><thead><tr><th>批次</th><th>物料</th><th>QR单据</th><th>栈板QR</th><th>数量</th><th>仓位</th><th>来源</th><th>状态</th></tr></thead>
      <tbody>{displayedBoundMaterials.map((row) => <tr key={row.id}>
        <td><strong>{row.lot_no || "—"}</strong><small style={{ display: "block", color: "#64748b" }}>{row.received_at ? new Date(row.received_at).toLocaleString() : ""}</small></td>
        <td><strong>{row.material_code || "—"}</strong><small style={{ display: "block" }}>{row.material_name_zh || ""}</small></td>
        <td><code>{row.document_no || "—"}</code></td><td><code>{row.pallet_qr || "—"}</code></td>
        <td>{Number(row.quantity || 0).toLocaleString()}</td><td><code>{row.location_code || row.warehouse_code || "—"}</code></td>
        <td>{row.source_type || "—"}</td><td><span className="badge badge-warning">{row.status || "IQC_PENDING"}</span></td>
      </tr>)}</tbody></table></div>
      {!boundMaterials.length && <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 12 }}>当前显示TEST演示数据；确认收料并生成QR后将自动替换为真实记录。</p>}
    </section>
    <section className="surface-panel"><div className="section-header"><div><h2>IQC管理</h2><p>管理待检、检验记录、复检档案与检验报告</p></div><a className="action-button" href="/?view=wms&wmsTab=iqc">进入IQC管理</a></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
        <div style={{ padding: 12, borderRadius: 8, background: "#eff6ff", border: "1px solid #bfdbfe" }}><small>QR绑定待检</small><strong style={{ display: "block", fontSize: 22, color: "#1d4ed8" }}>{boundPendingCount}</strong></div>
        <div style={{ padding: 12, borderRadius: 8, background: "#fff7ed", border: "1px solid #fed7aa" }}><small>收料待处理IQC</small><strong style={{ display: "block", fontSize: 22, color: "#c2410c" }}>{pendingCount}</strong></div>
        <div style={{ padding: 12, borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca" }}><small>超过24小时</small><strong style={{ display: "block", fontSize: 22, color: "#dc2626" }}>{boundOverdueCount}</strong></div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <a className="btn btn-secondary" href="/?view=wms&wmsTab=iqc">IQC待检队列</a>
        <a className="btn btn-secondary" href="/?view=wms&wmsTab=iqcInspect">IQC检验记录</a>
        <a className="btn btn-secondary" href="/?view=wms&wmsTab=iqcReinspection">IQC复检档案</a>
        <a className="btn btn-secondary" href="/?view=wms&wmsTab=iqcReport">IQC检验报告</a>
        <a className="btn btn-secondary" href="/?view=wms&wmsTab=iqcStandards">IQC标准</a>
      </div>
    </section>
    <section className="surface-panel"><div className="section-header"><div><h2>{t("wms.receivingQueue", locale)}</h2><p>{t("section.queue", locale)}</p></div></div>
      <div className="table-shell"><table><thead><tr><th>{t("wms.poNumber",locale)}</th><th>{t("common.material",locale)}</th><th>{t("common.supplier",locale)}</th><th>{t("common.qty",locale)}</th><th>{t("common.location",locale)}</th><th>{t("common.receiver",locale)}</th><th>{t("common.time",locale)}</th><th>{t("table.status",locale)}</th></tr></thead>
      <tbody>{loading?<tr><td colSpan={8}>{t("common.loading",locale)}</td></tr>:queue.length===0?<tr><td colSpan={8}>{t("common.noData",locale)}</td></tr>:queue.map((row)=><tr key={row.id}>
        <td><strong>{row.po_no}</strong><br/><code>{row.lot_no}</code></td><td><strong>{row.material_code}</strong><small style={{display:"block"}}>{row.material_name_zh}</small></td>
        <td>{row.supplier_name_zh??row.supplier_code}</td><td>{row.received_qty.toLocaleString()}</td><td><code>{row.location_code}</code></td><td>{row.receiver_name}</td><td>{new Date(row.received_at).toLocaleString()}</td>
        <td><span className={`badge badge-${row.has_open_issues?"danger":row.iqc_status==="pending"?"warning":"ok"}`}>{row.has_open_issues?t("wms.hasIssues",locale):t(row.iqc_status==="pending"?"iqc.pending":"iqc.released",locale)}</span></td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
