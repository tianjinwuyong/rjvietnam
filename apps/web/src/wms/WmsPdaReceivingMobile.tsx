/**
 * WmsPdaReceivingMobile — PDA 移动端收料工具
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, CheckCircle, AlertTriangle, X, RotateCcw, Package, Check } from "lucide-react";
import QRCode from "qrcode";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import { receivingActions, validateInboundReceiving } from "../../../../packages/business-rules/src/warehouse-receiving";

type Step = "pallet" | "scan" | "confirm" | "msd" | "done" | "binding";
// Pallet association remains a backend trace capability. It is intentionally
// hidden from the receiving operator's PDA workflow.
const PALLET_BINDING_ENABLED = false;
const createVirtualPalletQr = () => `WMS-VPALLET:${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

interface ReceiveForm {
  lotNo: string; materialCode: string; materialName: string; supplierName: string;
  supplierCode: string; poNo: string; preReceiptQr: string;
  qty: number; dateCode: string; msdLevel: string; locationCode: string; palletQr: string; palletType: "SINGLE_PRODUCT" | "MIXED_PRODUCT" | ""; notes: string;
  sealOk: boolean; desiccantOk: boolean; humidityOk: boolean;
  photoBase64: string | null; operator: string;
  materialLotId?: number;  // resolved from lookupLot
}

interface GeneratedReceivingQr {
  materialCode: string; lotNo: string; msdLevel: string; materialQr: string;
  palletQr: string; documentNo: string;
}

interface PdaGpsEvidence { latitude: number; longitude: number; accuracy: number; capturedAt: string }

interface PendingReceivingPo {
  id: number; po_no: string; material_code: string; lot_no: string;
  total_quantity: number; unit: string; outer_box_count: number;
  label_count: number; scanned_label_count: number; status: string;
  supplier_code: string; supplier_name: string;
}

const TEST_RECEIVING_POS: PendingReceivingPo[] = [
  { id: -1, po_no: "PO-TEST-RECV-001", material_code: "R0210-01019", lot_no: "LOT-20260904-A", total_quantity: 5000, unit: "PCS", outer_box_count: 5, label_count: 5, scanned_label_count: 0, status: "READY", supplier_code: "SUP-TEST-01", supplier_name: "测试供应商 A" },
  { id: -2, po_no: "PO-TEST-RECV-002", material_code: "R0210-01020", lot_no: "LOT-20260904-B", total_quantity: 3000, unit: "PCS", outer_box_count: 3, label_count: 3, scanned_label_count: 0, status: "READY", supplier_code: "SUP-TEST-02", supplier_name: "测试供应商 B" },
  { id: -3, po_no: "PO-TEST-RECV-003", material_code: "R0210-01021", lot_no: "LOT-20260904-C", total_quantity: 1200, unit: "PCS", outer_box_count: 2, label_count: 2, scanned_label_count: 0, status: "READY", supplier_code: "SUP-TEST-03", supplier_name: "测试供应商 C" },
];

const STEPS: Step[] = PALLET_BINDING_ENABLED ? ["pallet", "scan", "confirm", "msd", "done", "binding"] : ["scan", "confirm", "msd", "done"];

function ProgressBar({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div style={{ display: "flex", gap: 6, padding: "10px 0" }}>
      {STEPS.map((s, i) => (
        <div key={s} style={{
          flex: 1, height: 5, borderRadius: 3,
          background: i <= idx ? (i === idx ? "#f59e0b" : "#16a34a") : "#374151",
        }} />
      ))}
    </div>
  );
}

function Banner({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "10px 14px", borderRadius: 8, marginBottom: 12,
      background: ok ? "#f0fdf4" : "#fef2f2",
      border: `1px solid ${ok ? "#16a34a" : "#ef4444"}`,
      color: ok ? "#16a34a" : "#ef4444", fontWeight: 600, fontSize: 14,
    }}>
      {ok ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
      {msg}
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = "green", fullWidth = true }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean;
  variant?: "green" | "gray" | "blue"; fullWidth?: boolean;
}) {
  const base = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "15px 20px", fontSize: 17, fontWeight: 700, borderRadius: 10,
    border: "none", cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1, width: fullWidth ? "100%" : "auto",
  };
  if (variant === "green") return <button onClick={onClick} disabled={disabled} style={{ ...base, background: "#16a34a", color: "#fff" }}>{children}</button>;
  if (variant === "gray") return <button onClick={onClick} disabled={disabled} style={{ ...base, background: "#fff", color: "#374151", border: "1px solid #d1d5db" }}>{children}</button>;
  return <button onClick={onClick} disabled={disabled} style={{ ...base, background: "#2563eb", color: "#fff" }}>{children}</button>;
}

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 3 }}>{label}</div>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ width: "100%", padding: "11px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #d1d5db", boxSizing: "border-box" }} />
    </div>
  );
}

function CheckItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", borderRadius: 10, marginBottom: 8,
        border: `2px solid ${checked ? "#16a34a" : "#d1d5db"}`,
        background: checked ? "#f0fdf4" : "#fff", cursor: "pointer",
        textAlign: "left", fontSize: 15, transition: "all 0.15s",
      }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
        background: checked ? "#16a34a" : "transparent",
        border: `2px solid ${checked ? "#16a34a" : "#9ca3af"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {checked && <Check size={14} color="#fff" />}
      </div>
      <span style={{ fontWeight: checked ? 600 : 400 }}>{label}</span>
    </button>
  );
}

/* ---------- 单台 PDA 只读实时监控（?mode=monitor） ---------- */

interface MonitorDevice {
  operator: string; stage: string; material: string; pallet: string;
  completedBoxes: number; totalBoxes: number; lastAt: number;
}

const STAGE_LABELS: Record<string, string> = {
  DRAFT: "草稿", READY: "就绪", AREA_SCAN: "扫描库区", PALLET_TYPE: "选择托板类型",
  BOX_SCAN: "扫描箱 QR", BOX_QR: "扫描箱 QR", OCR: "WMS OCR 识别", AI_OCR: "WMS OCR 识别",
  QUANTITY: "确认数量", GENERATE_PALLET: "生成托板 QR", PRINT: "打印标签",
  PRINT_LABELS: "打印标签", BIND: "箱托板绑定", LABEL_BIND: "箱托板绑定",
  REVIEW: "复核", COMPLETE: "完成", RECEIVED: "已收料",
};

function describeActivity(payload: Record<string, any>): string {
  const stage = String(payload.workflowStage ?? payload.step ?? payload.phase ?? "").toUpperCase();
  const parts: string[] = [];
  const area = payload.areaQr ?? payload.receivingArea;
  if (area) parts.push(`库区 ${area}`);
  if (payload.palletType) {
    const type = String(payload.palletType);
    parts.push(`托板 ${type.includes("MIXED") ? "混装" : type.includes("SINGLE") ? "单一物料" : type}`);
  }
  const material = payload.vietnamMaterialCode ?? payload.materialCode;
  if (material) parts.push(`物料 ${material}`);
  if (payload.palletQr) parts.push(`托板QR ${payload.palletQr}`);
  if (payload.boxQr) parts.push(`箱 ${payload.boxQr}`);
  if (Array.isArray(payload.labelsScanned)) parts.push(`已扫标签 ${payload.labelsScanned.length}`);
  if (payload.boxCount != null) parts.push(`箱数 ${payload.boxCount}`);
  if (payload.quantityPerBox != null) parts.push(`每箱数量 ${payload.quantityPerBox}`);
  if (payload.completedBoxes != null) parts.push(`完成 ${payload.completedBoxes}/${payload.totalBoxes ?? "?"} 箱`);
  const base = STAGE_LABELS[stage] ?? (stage || "心跳");
  const text = [base, ...parts].join(" · ");
  return payload.changedField && parts.length === 0 ? `更新 ${payload.changedField}` : text;
}

function PdaReceivingMonitor({ deviceId }: { deviceId: string }) {
  const [device, setDevice] = useState<MonitorDevice | null>(null);
  const [events, setEvents] = useState<Array<{ at: number; text: string }>>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const applyActivity = (payload: Record<string, any>) => {
      if (!payload) return;
      const id = String(payload.deviceId ?? payload.device_id ?? payload.from ?? "").trim();
      if (!id || id === "wms_receiving" || id !== deviceId) return;
      const at = Number(payload.at) || Date.now();
      if (!active) return;
      setDevice(current => ({
        operator: String(payload.operatorName ?? payload.operator_name ?? payload.operator ?? current?.operator ?? "收料员"),
        stage: String(payload.workflowStage ?? payload.step ?? payload.phase ?? current?.stage ?? "DRAFT"),
        material: String(payload.materialCode ?? payload.vietnamMaterialCode ?? current?.material ?? ""),
        pallet: String(payload.palletQr ?? current?.pallet ?? ""),
        completedBoxes: Array.isArray(payload.labelsScanned) ? payload.labelsScanned.length : Number(payload.completedBoxes ?? current?.completedBoxes ?? 0) || 0,
        totalBoxes: Number(payload.boxCount ?? payload.totalBoxes ?? current?.totalBoxes ?? 0) || 0,
        lastAt: at,
      }));
      setEvents(current => [{ at, text: describeActivity(payload) }, ...current].slice(0, 40));
    };
    // 兜底轮询：页面打开前已注册的设备也能立即显示
    const refresh = () => {
      void fetch("/api/wms/pda-devices?pool=RECEIVING", { headers: { Authorization: `Bearer ${sessionStorage.getItem("auth_token") || ""}` } })
        .then(response => response.ok ? response.json() : null)
        .then(body => {
          const item = (body?.items || []).find((entry: any) => String(entry.device_id ?? entry.deviceId ?? entry.id) === deviceId);
          if (active && item) {
            setDevice(current => ({
              operator: String(item.operatorName ?? item.operator_name ?? item.assigned_to ?? current?.operator ?? ""),
              stage: String(item.stage ?? item.device_status ?? current?.stage ?? "READY"),
              material: String(item.currentMaterial ?? item.material ?? current?.material ?? ""),
              pallet: String(item.currentPallet ?? item.pallet ?? current?.pallet ?? ""),
              completedBoxes: Number(item.completedBoxes ?? current?.completedBoxes ?? 0),
              totalBoxes: Number(item.totalBoxes ?? current?.totalBoxes ?? 0),
              lastAt: item.lastSeenAt ? Number(item.lastSeenAt) : (item.last_event_at ? new Date(item.last_event_at).getTime() : current?.lastAt ?? 0),
            }));
          }
        }).catch(() => { /* SSE remains the live source */ });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    const stream = new EventSource("/api/pda/events?node=wms_receiving&replay=1&types=WMS_RECEIVING_PDA_ACTIVITY");
    stream.onmessage = (event) => { try { const item = JSON.parse(event.data); applyActivity(item.payload || item); } catch { /* ignore malformed */ } };
    return () => { active = false; window.clearInterval(timer); stream.close(); };
  }, [deviceId]);

  const online = device != null && device.lastAt > 0 && now - device.lastAt < 30000;
  const stageLabel = STAGE_LABELS[String(device?.stage ?? "").toUpperCase()] ?? device?.stage ?? "等待接入";

  return (
    <div style={{ padding: "0 16px 60px 16px", maxWidth: 1100, margin: "0 auto" }}>
      <section style={{ margin: "14px auto", padding: 16, borderRadius: 12, border: "2px solid #0f766e", background: "linear-gradient(135deg,#f0fdfa,#ffffff)", boxShadow: "0 4px 14px rgba(15,118,110,.10)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800 }}>WMS · PDA REAL-TIME MONITOR</div>
            <h2 style={{ margin: "4px 0", fontSize: 22 }}>收料 PDA 实时监控 · <span style={{ fontFamily: "monospace" }}>{deviceId}</span></h2>
            <div style={{ color: "#64748b", fontSize: 13 }}>只读视图：实时显示该设备的现场进度，不进行任何操作。</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ padding: "7px 12px", borderRadius: 999, fontWeight: 800, color: online ? "#166534" : "#92400e", background: online ? "#dcfce7" : "#fef3c7" }}>{online ? "● 在线" : "○ 等待心跳"}</span>
            <a href={`/?view=wms&wmsTab=pdaReceivingMobile&pdaId=${encodeURIComponent(deviceId)}`} style={{ padding: "7px 12px", borderRadius: 999, fontWeight: 800, color: "#1e40af", background: "#dbeafe", textDecoration: "none" }}>进入操作页 →</a>
            <a href="/?view=wms&wmsTab=materialReceiving" style={{ padding: "7px 12px", borderRadius: 999, fontWeight: 800, color: "#475569", background: "#f1f5f9", textDecoration: "none" }}>收料总控</a>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 14 }}>
          {[
            ["操作员", device?.operator || "-"],
            ["当前阶段", stageLabel],
            ["物料", device?.material || "-"],
            ["托板 QR", device?.pallet || "-"],
            ["箱进度", device ? `${device.completedBoxes} / ${device.totalBoxes || "?"}` : "-"],
            ["最后同步", device?.lastAt ? `${new Date(device.lastAt).toLocaleTimeString("zh-CN", { hour12: false })}（${Math.max(0, Math.round((now - device.lastAt) / 1000))}s 前）` : "-"],
          ].map(([label, value]) => (
            <div key={label} style={{ padding: "10px 12px", background: "#fff", border: "1px solid #ccfbf1", borderRadius: 8 }}>
              <div style={{ color: "#64748b", fontSize: 12 }}>{label}</div>
              <strong style={{ display: "block", marginTop: 4, wordBreak: "break-word" }}>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section style={{ margin: "14px auto", padding: 16, borderRadius: 12, border: "1px solid #e2e8f0", background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>实时事件流水</h3>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>最近 {events.length} 条（SSE 实时推送）</span>
        </div>
        {events.length === 0 ? (
          <div style={{ padding: "30px 10px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
            暂无事件 — 等待 {deviceId} 上报活动（扫描库区、选择托板、扫箱、打印、绑定等）
          </div>
        ) : (
          <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
            {events.map((event, index) => (
              <div key={`${event.at}-${index}`} style={{ display: "flex", gap: 10, padding: "8px 12px", borderBottom: "1px solid #f1f5f9", background: index === 0 ? "#f0fdfa" : "#fff", fontSize: 14 }}>
                <span style={{ fontFamily: "monospace", color: "#64748b", flexShrink: 0 }}>{new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                <span>{event.text}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function WmsPdaReceivingMobile({ locale }: { locale: Locale }) {
  const params = new URLSearchParams(window.location.search);
  const deviceId = params.get("pdaId") || "WMS 自动分配";
  // 只读实时监控模式：不进入表单，也不运行表单的 hooks
  if (params.get("mode") === "monitor") {
    return <PdaReceivingMonitor deviceId={deviceId} />;
  }
  const [step, setStep] = useState<Step>(PALLET_BINDING_ENABLED ? "pallet" : "scan");
  const [form, setForm] = useState<ReceiveForm>({ materialLotId: undefined,
    lotNo: "", materialCode: "", materialName: "", supplierName: "", supplierCode: "", poNo: "", preReceiptQr: "",
    qty: 0, dateCode: "", msdLevel: "", locationCode: "", palletQr: PALLET_BINDING_ENABLED ? "" : createVirtualPalletQr(), palletType: "", notes: "",
    sealOk: false, desiccantOk: false, humidityOk: false,
    photoBase64: null, operator: "VN_OP_001",
  });
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [monitorDevice, setMonitorDevice] = useState<{ operator?: string; stage?: string; material?: string; pallet?: string; completedBoxes?: number; totalBoxes?: number; lastAt?: number; status?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatedQr, setGeneratedQr] = useState<GeneratedReceivingQr | null>(null);
  const [palletMaterials, setPalletMaterials] = useState<GeneratedReceivingQr[]>([]);
  const [bindingScan, setBindingScan] = useState("");
  const [boundMaterialQrs, setBoundMaterialQrs] = useState<string[]>([]);
  const [gpsEvidence, setGpsEvidence] = useState<PdaGpsEvidence | null>(null);
  const [generatedQrImage, setGeneratedQrImage] = useState("");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [pendingPos, setPendingPos] = useState<PendingReceivingPo[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const publishBoxScan = useCallback((scanValue: string, next: ReceiveForm) => {
    const token = sessionStorage.getItem("auth_token");
    void fetch("/api/pda/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        from: deviceId,
        to: "wms_receiving",
        type: "WMS_RECEIVING_PDA_ACTIVITY",
        stationCode: "wms_receiving",
        payload: {
          deviceId,
          inputMethod: "STANDARD_QR",
          changedField: "boxQr",
          boxQr: scanValue,
          operator: next.operator,
          workflowStage: "CONFIRM",
          purchaseOrder: next.poNo,
          lotNo: next.lotNo,
          materialCode: next.materialCode,
          materialName: next.materialName,
          supplierCode: next.supplierCode,
          supplier: next.supplierName,
          quantity: next.qty || "",
          manufactureDate: next.dateCode,
          locationCode: next.locationCode,
          msdLevel: next.msdLevel,
          palletQr: PALLET_BINDING_ENABLED ? next.palletQr : "",
          at: Date.now(),
        },
      }),
    }).catch(() => { /* the normal status sync retries when the event service returns */ });
  }, [deviceId]);

  useEffect(() => { if (step === "scan") scanRef.current?.focus(); }, [step]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      const token = sessionStorage.getItem("auth_token");
      void fetch("/api/wms/receiving/pre-receiving-manifests", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((response) => (response.ok ? response.json() : { items: [] }))
        .then((body) => { if (active) setPendingPos(body.items?.length ? body.items : TEST_RECEIVING_POS); })
        .catch(() => { if (active) setPendingPos(TEST_RECEIVING_POS); });
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetch("/api/wms/pda-devices?pool=RECEIVING", { headers: { Authorization: `Bearer ${sessionStorage.getItem("auth_token") || ""}` } })
        .then(response => response.ok ? response.json() : null)
        .then(body => {
          const item = (body?.items || []).find((entry: any) => String(entry.device_id ?? entry.deviceId ?? entry.id) === deviceId);
          if (active) setMonitorDevice(item ? {
            operator: String(item.operatorName ?? item.operator_name ?? item.assigned_to ?? ""),
            stage: String(item.stage ?? item.device_status ?? "READY"), material: String(item.currentMaterial ?? item.material ?? ""),
            pallet: String(item.currentPallet ?? item.pallet ?? ""), completedBoxes: Number(item.completedBoxes ?? 0), totalBoxes: Number(item.totalBoxes ?? 0),
            lastAt: item.lastSeenAt ? Number(item.lastSeenAt) : (item.last_event_at ? new Date(item.last_event_at).getTime() : 0), status: String(item.status ?? item.device_status ?? "OFFLINE"),
          } : null);
        }).catch(() => { /* the input workflow remains usable when monitoring is offline */ });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [deviceId]);

  useEffect(() => {
    const stream = new EventSource("/api/pda/events?node=unified_pda_receiving&replay=1&types=WMS_RECEIVING_WMS_DRAFT");
    stream.onmessage = event => {
      try {
        const message = JSON.parse(event.data); const payload = message.payload || message;
        const target = String(payload.targetDeviceId || "").trim();
        if (target && target !== deviceId) return;
        setForm(current => ({ ...current,
          poNo: String(payload.purchaseOrder ?? payload.poNo ?? current.poNo),
          lotNo: String(payload.lotNo ?? payload.lot ?? current.lotNo),
          materialCode: String(payload.ruijingMaterialCode ?? payload.materialCode ?? payload.vietnamMaterialCode ?? current.materialCode),
          materialName: String(payload.materialName ?? current.materialName),
          supplierCode: String(payload.supplierCode ?? current.supplierCode),
          supplierName: String(payload.supplierName ?? payload.supplier ?? current.supplierName),
          qty: Number(payload.receivedQty ?? payload.quantity ?? payload.boxQty ?? current.qty) || current.qty,
          dateCode: String(payload.dateCode ?? payload.manufactureDate ?? current.dateCode),
          msdLevel: String(payload.msdLevel ?? payload.msLevel ?? current.msdLevel),
          locationCode: String(payload.locationCode ?? payload.locationQr ?? payload.storageLocation ?? current.locationCode),
          palletQr: PALLET_BINDING_ENABLED ? String(payload.palletQr ?? current.palletQr) : current.palletQr,
        }));
        setFeedback({ ok: true, msg: "已接收 WMS 下发的收料任务，请在现场扫码确认" });
      } catch { /* manual scanning remains available */ }
    };
    return () => stream.close();
  }, [deviceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const token = sessionStorage.getItem("auth_token");
      void fetch("/api/pda/events", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ from: deviceId, to: "wms_receiving", type: "WMS_RECEIVING_PDA_ACTIVITY", stationCode: "wms_receiving", payload: { deviceId, operator: form.operator, workflowStage: step.toUpperCase(), lotNo: form.lotNo, materialCode: form.materialCode, quantity: form.qty, locationCode: form.locationCode, msdLevel: form.msdLevel, palletQr: PALLET_BINDING_ENABLED ? form.palletQr : undefined, completedBoxes: palletMaterials.length, at: Date.now() } }) }).catch(() => { /* retry on next state change */ });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [deviceId, step, form.operator, form.lotNo, form.materialCode, form.qty, form.locationCode, form.msdLevel, form.palletQr, palletMaterials.length]);

  const lookupLot = useCallback(async (scanValue: string) => {
    const scannedForm = (current: ReceiveForm, values: Partial<ReceiveForm>): ReceiveForm => ({
      ...current,
      preReceiptQr: "", poNo: "", supplierCode: "", supplierName: "",
      materialCode: "", materialName: "", lotNo: "", qty: 0, dateCode: "",
      msdLevel: "", locationCode: "", materialLotId: undefined,
      ...values,
    });
    const applyScannedForm = (values: Partial<ReceiveForm>) => {
      const next = scannedForm(form, values);
      setForm(next);
      publishBoxScan(scanValue, next);
    };
    try {
      const pre = await wmsApi.getSupplierPreReceipt(scanValue);
      if (pre?.preReceiptQr) {
        if (pre.status !== "REGISTERED") throw new Error(`供应商预收货单状态为 ${pre.status}，不能重复收料`);
        applyScannedForm({ preReceiptQr: pre.preReceiptQr, poNo: pre.poNo || "", supplierCode: pre.supplierCode || "", supplierName: pre.supplierName || "", materialCode: pre.materialCode || "", materialName: pre.materialName || "", lotNo: pre.lotNo || "", qty: Number(pre.qty) || 0, palletQr: pre.palletQr || form.palletQr, dateCode: pre.manufacturingDate || "" });
        setFeedback({ok:true,msg:`已核对供应商预收货 QR · PO ${pre.poNo||"—"} · ${pre.materialCode}`});
        return;
      }
    } catch (preError) {
      if (preError instanceof Error && preError.message.includes("不能重复收料")) { setFeedback({ok:false,msg:preError.message}); return; }
    }
    try {
      const res = await wmsApi.getMaterialLots({ lotNo:scanValue, limit: 1 });
      if (res.items.length > 0) {
        const lot = res.items[0] as any;
        applyScannedForm({ lotNo:scanValue,
          materialCode: lot.materialCode ?? "",
          materialName: lot.materialNameZh ?? lot.materialName ?? "",
          supplierName: lot.supplierName ?? "",
          qty: lot.qty ?? 0,
          dateCode: lot.dateCode ?? "",
          msdLevel: lot.msdLevel ?? "",
          locationCode: lot.locationCode ?? "",
          palletQr: lot.palletQr ?? form.palletQr,
          materialLotId: lot.id ?? undefined,
        });
      } else {
        applyScannedForm({ lotNo: scanValue });
      }
    } catch { applyScannedForm({ lotNo: scanValue }); }
  }, [form, publishBoxScan]);

  const handleScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const val = (e.target as HTMLInputElement).value.trim();
    if (!val) return;
    lookupLot(val);
    setStep("confirm");
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { setFeedback({ ok: false, msg: "摄像头打开失败" }); }
  };

  const stopCamera = () => { cameraStream?.getTracks().forEach(t => t.stop()); setCameraStream(null); };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    setForm(f => ({ ...f, photoBase64: canvas.toDataURL("image/jpeg", 0.8) }));
    stopCamera();
  };

  const msdAllOk = form.sealOk && form.desiccantOk && form.humidityOk;

  useEffect(() => {
    if (!generatedQr?.materialQr) { setGeneratedQrImage(""); return; }
    void QRCode.toDataURL(generatedQr.materialQr, { width: 260, margin: 1, errorCorrectionLevel: "M" }).then(setGeneratedQrImage);
  }, [generatedQr]);

  const handleSubmit = async () => {
    setBusy(true);
    setFeedback(null);
    // MSD package checks do not replace supplier IQC. Newly received material
    // remains uninspected/pending until the IQC workflow releases the lot.
    const qcDecision = "PENDING" as const;
    const receivingDraft = {
      scanValue: form.lotNo,
      materialCode: form.materialCode,
      lotNo: form.lotNo,
      quantity: form.qty,
      operator: form.operator,
      qcDecision,
      locationCode: form.locationCode,
    };
    const validation = validateInboundReceiving(receivingDraft);
    if (!validation.ok) {
      setFeedback({ ok: false, msg: validation.errors.join("; ") });
      setBusy(false);
      return;
    }
    if (!form.locationCode.trim()) {
      setFeedback({ ok: false, msg: "请先扫描或输入 WMS 待检库位" });
      setBusy(false);
      return;
    }
    try {
      if (!form.materialLotId && form.preReceiptQr) {
        await wmsApi.postReceive({lot_no:form.lotNo,po_no:form.poNo,inbound_order_no:form.poNo,material_code:form.materialCode,supplier_code:form.supplierCode,received_qty:form.qty,received_at:new Date().toISOString(),receiving_notes:`PDA pre-receipt ${form.preReceiptQr}`});
      }
      // PDA only supplies the scanned identity. WMS is the authority for MSL.
      // Resolve it before writing any inventory transaction so missing/conflicting
      // mappings cannot leave a partially received lot.
      const resolution = await wmsApi.resolveReceivingMsl({ lotNo: form.lotNo, materialCode: form.materialCode });
      const authoritative = resolution.item;
      setForm(current => ({ ...current, materialCode: authoritative.materialCode, msdLevel: authoritative.msdLevel, materialLotId: authoritative.materialLotId }));
      // Record PDA inspection result
      if (authoritative.materialLotId) {
        try {
          await wmsApi.createPdaInspectionRecord({
            materialLotId: authoritative.materialLotId,
            result: form.sealOk && form.desiccantOk && form.humidityOk ? "PASS" : "FAIL",
            rejectReason: (!form.sealOk || !form.desiccantOk || !form.humidityOk)
              ? `MSD检查: 密封${form.sealOk?"✓":"✗"} 干燥剂${form.desiccantOk?"✓":"✗"} 湿度${form.humidityOk?"✓":"✗"}`
              : undefined,
            operator: form.operator,
            msdSealOk: form.sealOk,
            msdDesiccantOk: form.desiccantOk,
            msdHumidityOk: form.humidityOk,
            photoUrl: form.photoBase64 || undefined,
          });
        } catch (inspectErr) {
          console.warn("PDA inspection record failed:", inspectErr);
          // Non-fatal — still record the receive transaction
        }
      }
      // Keep the ledger sequence explicit: failed MSD checks are held and
      // must never be silently put away.
      for (const action of receivingActions(receivingDraft)) {
        await wmsApi.postTransaction(action, {
          lotNo: form.lotNo,
          qty: form.qty,
          operator: form.operator,
          toLocation: action === "PUT_AWAY" ? form.locationCode : undefined,
        });
      }
      const issued = (await wmsApi.createReceivingQr({
        lotNo: form.lotNo,
        materialCode: authoritative.materialCode,
        quantity: form.qty,
        sourceType: "PO_RECEIPT",
        warehouse: "RAW-MATERIAL",
        location: form.locationCode,
        operator: form.operator,
        sourcePalletCode: form.palletQr.trim() || undefined,
      })).item;
      setGeneratedQr({ materialCode: issued.materialCode, lotNo: issued.lotNo, msdLevel: issued.msdLevel, materialQr: issued.materialQr, palletQr: issued.pallet_qr, documentNo: issued.document_no });
      setPalletMaterials(current => current.some(item => item.materialQr === issued.materialQr) ? current : [...current, { materialCode: issued.materialCode, lotNo: issued.lotNo, msdLevel: issued.msdLevel, materialQr: issued.materialQr, palletQr: issued.pallet_qr, documentNo: issued.document_no }]);
      if (form.preReceiptQr) await wmsApi.receiveSupplierPreReceipt(form.preReceiptQr,form.operator);
      setStep("done");
      setFeedback({ ok: true, msg: `${form.lotNo} → WMS 已按 ${issued.msdLevel} 生成收料 QR` });
    } catch (err) {
      setFeedback({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally { setBusy(false); }
  };

  const reset = () => {
    setStep(PALLET_BINDING_ENABLED ? "pallet" : "scan");
    setForm({ lotNo: "", materialCode: "", materialName: "", supplierName: "", supplierCode: "", poNo: "", preReceiptQr: "", qty: 0, dateCode: "", msdLevel: "", locationCode: "", palletQr: PALLET_BINDING_ENABLED ? "" : createVirtualPalletQr(), palletType: "", notes: "", sealOk: false, desiccantOk: false, humidityOk: false, photoBase64: null, operator: "VN_OP_001", materialLotId: undefined });
    setFeedback(null);
    setGeneratedQr(null);
    setPalletMaterials([]);
    setBoundMaterialQrs([]);
    setBindingScan("");
    setGpsEvidence(null);
    stopCamera();
  };

  const continueOnPallet = () => {
    const palletQr = generatedQr?.palletQr || form.palletQr;
    setStep("scan");
    setForm(current => ({ ...current, lotNo: "", materialCode: "", materialName: "", supplierName: "", supplierCode: "", poNo: "", preReceiptQr: "", qty: 0, dateCode: "", msdLevel: "", palletQr, notes: "", sealOk: false, desiccantOk: false, humidityOk: false, photoBase64: null, materialLotId: undefined }));
    setGeneratedQr(null);
    setFeedback({ ok: true, msg: `继续托板 ${palletQr}：请扫描下一物料` });
    stopCamera();
  };

  const beginPallet = () => {
    if (!form.palletType) { setFeedback({ ok: false, msg: "请先选择单一物料托板或混合物料托板" }); return; }
    const palletQr = form.palletQr.trim() || `WMS-PALLET:${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    setForm(current => ({ ...current, palletQr }));
    setFeedback({ ok: true, msg: `${form.palletType === "SINGLE_PRODUCT" ? "单一物料" : "混合物料"}托板已建立：${palletQr}` });
    setStep("scan");
  };

  const bindScannedMaterial = async () => {
    const value = bindingScan.trim();
    const expected = palletMaterials.find(item => item.materialQr.toUpperCase() === value.toUpperCase());
    if (!expected) { setFeedback({ ok: false, msg: "该 QR 不属于当前托板的已收物料" }); return; }
    if (boundMaterialQrs.includes(expected.materialQr)) { setFeedback({ ok: false, msg: "该 QR 已绑定，请扫描下一张" }); return; }
    if (!form.locationCode.trim()) { setFeedback({ ok: false, msg: "请先扫描仓库位置 QR" }); return; }
    if (!gpsEvidence) { setFeedback({ ok: false, msg: "请先采集 PDA GPS 位置证据" }); return; }
    setBusy(true);
    try {
      await wmsApi.bindReceivingQrToPallet({ palletQr: form.palletQr, boxQr: expected.materialQr, lotNo: expected.lotNo, locationQr: form.locationCode, supplier: form.supplierName, gps: gpsEvidence });
      setBoundMaterialQrs(current => [...current, expected.materialQr]);
      setBindingScan("");
      setFeedback({ ok: true, msg: `${expected.materialCode} 已绑定到托板` });
    } catch (error) { setFeedback({ ok: false, msg: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };

  const captureGps = () => {
    if (!navigator.geolocation) { setFeedback({ ok: false, msg: "此 PDA 不支持 GPS 定位" }); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(position => {
      setGpsEvidence({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() });
      setFeedback({ ok: true, msg: `GPS 已采集，精度 ±${Math.round(position.coords.accuracy)}m` }); setBusy(false);
    }, error => { setFeedback({ ok: false, msg: `GPS 采集失败：${error.message}` }); setBusy(false); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };

  return (
    <div style={{ padding: "0 10px 80px", maxWidth: 520, margin: "0 auto", background: "#f8fafc", minHeight: "100vh" }}>
      <section style={{ display: "none", margin: "14px auto", padding: 16, borderRadius: 12, border: "2px solid #0f766e", background: "linear-gradient(135deg,#f0fdfa,#ffffff)", boxShadow: "0 4px 14px rgba(15,118,110,.10)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div><div style={{ fontSize: 12, color: "#0f766e", fontWeight: 800 }}>WMS · PDA REAL-TIME MONITOR</div><h2 style={{ margin: "4px 0", fontSize: 22 }}>收料 PDA 实时监控 · {deviceId}</h2><div style={{ color: "#64748b", fontSize: 13 }}>此页面只显示该设备，不会混入其他 PDA 的数据。</div></div>
          <span style={{ padding: "7px 12px", borderRadius: 999, fontWeight: 800, color: monitorDevice && monitorDevice.lastAt && Date.now() - monitorDevice.lastAt < 30000 ? "#166534" : "#92400e", background: monitorDevice && monitorDevice.lastAt && Date.now() - monitorDevice.lastAt < 30000 ? "#dcfce7" : "#fef3c7" }}>{monitorDevice && monitorDevice.lastAt && Date.now() - monitorDevice.lastAt < 30000 ? "在线" : "等待心跳"}</span>
          <a href={`/?view=wms&wmsTab=pdaReceivingMobile&pdaId=${encodeURIComponent(deviceId)}&mode=monitor`} style={{ padding: "7px 12px", borderRadius: 999, fontWeight: 800, color: "#1e40af", background: "#dbeafe", textDecoration: "none" }}>实时监控 →</a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 14 }}>
          {[['操作员', monitorDevice?.operator || '-'], ['当前阶段', monitorDevice?.stage || '等待接入'], ['物料', monitorDevice?.material || '-'], ['托板 QR', monitorDevice?.pallet || '-'], ['箱进度', `${monitorDevice?.completedBoxes || 0} / ${monitorDevice?.totalBoxes || '-'}`], ['最后同步', monitorDevice?.lastAt ? new Date(monitorDevice.lastAt).toLocaleTimeString() : '-']].map(([label, value]) => <div key={label} style={{ padding: "10px 12px", background: "#fff", border: "1px solid #ccfbf1", borderRadius: 8 }}><div style={{ color: "#64748b", fontSize: 12 }}>{label}</div><strong style={{ display: "block", marginTop: 4, wordBreak: "break-word" }}>{value}</strong></div>)}
        </div>
      </section>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <div style={{ margin: "8px 0", padding: "9px 11px", borderRadius: 9, border: "1px solid #99f6e4", background: "#f0fdfa", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 12 }}>
        <div><strong style={{ color: "#0f766e" }}>{deviceId}</strong><div style={{ color: "#64748b", marginTop: 2 }}>{form.operator}</div></div>
        <div style={{ textAlign: "right" }}><strong>{PALLET_BINDING_ENABLED ? (form.palletQr || "未选择托板") : "箱码直接收料"}</strong><div style={{ color: "#64748b", marginTop: 2 }}>{monitorDevice?.stage || "READY"}</div></div>
      </div>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", padding: "10px 12px 6px", border: "1px solid #e5e7eb", borderRadius: 10, boxShadow: "0 2px 8px rgba(15,23,42,.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>PDA 收料</h2>
          <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 13 }}>
            <RotateCcw size={14} /> 重置
          </button>
        </div>
        <ProgressBar current={step} />
      </div>

      <div style={{ padding: "12px 4px 0" }}>
        {feedback && <Banner ok={feedback.ok} msg={feedback.msg} />}

        {PALLET_BINDING_ENABLED && step === "pallet" && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>第一步：选择托板类型</h3>
            <p style={{ margin: "0 0 14px", color: "#64748b", fontSize: 13 }}>WMS 根据托板类型控制后续允许绑定的物料。</p>
            <button type="button" onClick={() => setForm(current => ({ ...current, palletType: "SINGLE_PRODUCT" }))} style={{ width: "100%", padding: 15, marginBottom: 10, borderRadius: 10, textAlign: "left", border: `2px solid ${form.palletType === "SINGLE_PRODUCT" ? "#2563eb" : "#cbd5e1"}`, background: form.palletType === "SINGLE_PRODUCT" ? "#eff6ff" : "#fff" }}><strong>单一物料托板</strong><div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>整个托板只能接收同一种物料编码</div></button>
            <button type="button" onClick={() => setForm(current => ({ ...current, palletType: "MIXED_PRODUCT" }))} style={{ width: "100%", padding: 15, marginBottom: 14, borderRadius: 10, textAlign: "left", border: `2px solid ${form.palletType === "MIXED_PRODUCT" ? "#7c3aed" : "#cbd5e1"}`, background: form.palletType === "MIXED_PRODUCT" ? "#f5f3ff" : "#fff" }}><strong>混合物料托板</strong><div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>同一托板可连续添加多种物料</div></button>
            <Field label="扫描托板 QR（留空则由 WMS 生成）" value={form.palletQr} onChange={value => setForm(current => ({ ...current, palletQr: value }))} />
            <Btn variant="blue" onClick={beginPallet} disabled={!form.palletType}>确认托板并开始收料</Btn>
          </div>
        )}

        {step === "scan" && (
          <div>
            {!form.poNo && <div style={{ background: "#fff", border: "2px solid #0f766e", borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <strong style={{ color: "#115e59" }}>第一步：选择待收料 PO</strong>
                <span style={{ fontSize: 12, color: "#64748b" }}>{pendingPos.length} 项</span>
              </div>
              <div style={{ display: "grid", gap: 8, maxHeight: 250, overflowY: "auto" }}>
                {pendingPos.map((row) => {
                  const selected = form.poNo === row.po_no && form.materialCode === row.material_code && form.lotNo === row.lot_no;
                  return (
                    <button key={row.id} type="button" onClick={() => {
                      setForm(current => ({ ...current, poNo: row.po_no, materialCode: row.material_code, lotNo: row.lot_no, supplierCode: row.supplier_code, supplierName: row.supplier_name, qty: Number(row.total_quantity) || 0 }));
                      setFeedback({ ok: true, msg: `已选择 PO ${row.po_no} · ${row.material_code}；请扫描供应商箱码` });
                    }} style={{ padding: 11, borderRadius: 8, border: `2px solid ${selected ? "#16a34a" : "#cbd5e1"}`, background: selected ? "#f0fdf4" : "#fff", textAlign: "left" }}>
                      <strong>{row.po_no}</strong> · {row.material_code}
                      <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>{row.supplier_name || row.supplier_code} · LOT {row.lot_no} · {row.total_quantity} {row.unit} · {row.scanned_label_count}/{row.label_count} 箱已扫</div>
                    </button>
                  );
                })}
                {!pendingPos.length && <div style={{ padding: 12, color: "#64748b", textAlign: "center" }}>暂无供应商 Portal 提交的待收料 PO</div>}
              </div>
            </div>}
            {form.poNo && <>
            <div style={{ padding: "10px 12px", marginBottom: 10, borderRadius: 8, background: "#f0fdf4", border: "1px solid #16a34a" }}>
              <strong>PO {form.poNo}</strong> · {form.materialCode} · LOT {form.lotNo}
              <div style={{ marginTop: 4, fontSize: 12, color: "#166534" }}>{form.supplierName || form.supplierCode} · 应收 {form.qty}</div>
            </div>
            <div style={{ background: "#eff6ff", border: "2px solid #3b82f6", borderRadius: 10, padding: "14px", marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", marginBottom: 8 }}>扫描枪输入区域</div>
              <input ref={scanRef} type="text" disabled={!form.poNo} placeholder={form.poNo ? "扫描供应商箱码后按 Enter" : "请先选择待收料 PO"}
                onKeyDown={handleScanKey} autoComplete="off"
                style={{ width: "100%", padding: "14px 12px", fontSize: 20, fontWeight: 700, borderRadius: 8, border: "2px solid #3b82f6", outline: "none", boxSizing: "border-box", background: "#fff", letterSpacing: 1 }} />
            </div>
            <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 14 }}>支持 USB 扫码枪 / 蓝牙扫描枪，输入后自动查询物料信息</p>
            <Btn variant="blue" disabled={!form.poNo} onClick={() => { lookupLot(""); setStep("confirm"); }}>手动确认 →</Btn>
            </>}
          </div>
        )}

        {step === "confirm" && (
          <div>
            <div style={{ display: "grid", gap: 2 }}>
              <Field label="批次号 *" value={form.lotNo} onChange={v => setForm(f => ({ ...f, lotNo: v }))} />
              <Field label="物料编码" value={form.materialCode} onChange={v => setForm(f => ({ ...f, materialCode: v }))} />
              <Field label="物料名称" value={form.materialName} onChange={v => setForm(f => ({ ...f, materialName: v }))} />
              <Field label="供应商" value={form.supplierName} onChange={v => setForm(f => ({ ...f, supplierName: v }))} />
              <Field label="数量" value={String(form.qty)} onChange={v => setForm(f => ({ ...f, qty: Number(v) }))} type="number" />
              <Field label="日期代码" value={form.dateCode} onChange={v => setForm(f => ({ ...f, dateCode: v }))} />
              <div style={{ marginBottom: 8 }}><div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 3 }}>MSL 等级（WMS 自动映射）</div><div style={{ padding: "11px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", fontWeight: 800 }}>{form.msdLevel || "提交时由 WMS 查询"}</div></div>
              <Field label="库位" value={form.locationCode} onChange={v => setForm(f => ({ ...f, locationCode: v }))} />
              {PALLET_BINDING_ENABLED && <Field label="托板 QR" value={form.palletQr} onChange={v => setForm(f => ({ ...f, palletQr: v }))} />}
            </div>
            {cameraStream ? (
              <div style={{ marginTop: 10 }}>
                <video ref={videoRef} autoPlay playsInline style={{ width: "100%", borderRadius: 8 }} />
                <canvas ref={canvasRef} style={{ display: "none" }} />
                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  <Btn variant="green" onClick={capturePhoto}><Camera size={18} /> 拍照</Btn>
                  <Btn variant="gray" onClick={stopCamera}><X size={18} /> 取消</Btn>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <Btn variant="gray" onClick={startCamera}><Camera size={18} /> 拍照存档</Btn>
              </div>
            )}
            {form.photoBase64 && <img src={form.photoBase64} alt="cap" style={{ width: "100%", borderRadius: 8, marginTop: 8 }} />}
            <div style={{ marginTop: 16 }}>
              <Btn variant="blue" onClick={() => setStep("msd")} disabled={!form.lotNo}>下一步 → MSD检查</Btn>
            </div>
          </div>
        )}

        {step === "msd" && (
          <div>
            <div style={{ background: "#fef3c7", borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <Package size={20} />
              <div>
                <div style={{ fontWeight: 700 }}>{form.lotNo || "—"}</div>
                <div style={{ fontSize: 13, color: "#92400e" }}>MSD等级: {form.msdLevel || "未指定"}</div>
              </div>
            </div>
            <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>检查湿敏元件包装袋：</p>
            <CheckItem label="① 包装袋封口完整" checked={form.sealOk} onChange={v => setForm(f => ({ ...f, sealOk: v }))} />
            <CheckItem label="② 干燥剂未变色" checked={form.desiccantOk} onChange={v => setForm(f => ({ ...f, desiccantOk: v }))} />
            <CheckItem label="③ 湿度卡指示 ≤ 正常值" checked={form.humidityOk} onChange={v => setForm(f => ({ ...f, humidityOk: v }))} />
            {!msdAllOk && (
              <div style={{ background: "#fef3c7", borderRadius: 8, padding: "10px 14px", margin: "12px 0", fontSize: 13, color: "#92400e" }}>
                <AlertTriangle size={14} style={{ display: "inline", marginRight: 4 }} />
                请完成全部 MSD 检查项
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <Btn variant="gray" onClick={() => setStep("confirm")}>← 返回</Btn>
              <Btn variant="green" onClick={handleSubmit} disabled={busy || !msdAllOk}>
                {busy ? "提交中..." : <><CheckCircle size={18} /> 确认收料</>}
              </Btn>
            </div>
          </div>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", paddingTop: 18 }}>
            <div style={{ width: 90, height: 90, borderRadius: "50%", background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", border: "3px solid #16a34a" }}>
              <CheckCircle size={52} color="#16a34a" />
            </div>
            <h3 style={{ fontSize: 24, fontWeight: 800, color: "#16a34a", margin: "0 0 8px" }}>收料成功</h3>
            <p style={{ color: "#6b7280", fontSize: 15, marginBottom: 8 }}>{form.lotNo}</p>
            {generatedQr && <div style={{ margin: "14px auto", padding: 14, border: "1px solid #bbf7d0", borderRadius: 10, background: "#f0fdf4", textAlign: "left" }}>
              {generatedQrImage && <img src={generatedQrImage} alt="WMS receiving QR" style={{ display: "block", width: 220, maxWidth: "100%", margin: "0 auto 10px" }} />}
              <div><strong>物料：</strong>{generatedQr.materialCode}</div><div><strong>MSL：</strong>{generatedQr.msdLevel}（WMS 主数据）</div><div><strong>单号：</strong>{generatedQr.documentNo}</div><div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{generatedQr.materialQr}</div>
            </div>}
            <div style={{ margin: "10px 0", padding: 10, borderRadius: 8, background: "#f8fafc", textAlign: "left", fontSize: 12 }}><strong>{PALLET_BINDING_ENABLED ? "当前托板" : "本次收料"}：{palletMaterials.length} 个物料箱</strong>{palletMaterials.map(item => <div key={item.materialQr} style={{ marginTop: 5 }}>{item.materialCode} · {item.lotNo} · {item.msdLevel}</div>)}</div>
            <p style={{ color: "#9ca3af", fontSize: 13 }}>QR 已登记，并移至 IQC 待检队列</p>
            <div style={{ marginTop: 30 }}>
              {PALLET_BINDING_ENABLED && form.palletType === "MIXED_PRODUCT" && <Btn variant="green" onClick={continueOnPallet}><RotateCcw size={18} /> 同一托板继续下一物料</Btn>}
              {!PALLET_BINDING_ENABLED && <Btn variant="green" onClick={continueOnPallet}><RotateCcw size={18} /> 继续收下一个物料箱</Btn>}
              {PALLET_BINDING_ENABLED && <div style={{ marginTop: 10 }}><Btn variant="blue" onClick={() => setStep("binding")} disabled={!palletMaterials.length}>全部物料完成，开始托板绑定</Btn></div>}
              <div style={{ marginTop: 10 }}><Btn variant="gray" onClick={reset}>{PALLET_BINDING_ENABLED ? "结束托板并重新开始" : "结束本次收料"}</Btn></div>
            </div>
          </div>
        )}

        {PALLET_BINDING_ENABLED && step === "binding" && (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
            <h3 style={{ margin: "0 0 4px" }}>托板 QR 绑定</h3>
            <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: 13 }}>扫描每张已粘贴的物料/箱 QR，WMS 验证后绑定到当前托板。</p>
            <div style={{ padding: 10, borderRadius: 8, background: "#eff6ff", marginBottom: 10 }}><strong>{form.palletQr}</strong><div style={{ fontSize: 12, marginTop: 3 }}>{boundMaterialQrs.length} / {palletMaterials.length} 已绑定</div></div>
            <Field label="仓库位置 QR" value={form.locationCode} onChange={value => setForm(current => ({ ...current, locationCode: value }))} />
            <div style={{ padding: 10, marginBottom: 10, borderRadius: 8, border: `1px solid ${gpsEvidence ? "#86efac" : "#fbbf24"}`, background: gpsEvidence ? "#f0fdf4" : "#fffbeb", fontSize: 12 }}><strong>PDA GPS 位置证据</strong><div style={{ margin: "5px 0 8px" }}>{gpsEvidence ? `${gpsEvidence.latitude.toFixed(6)}, ${gpsEvidence.longitude.toFixed(6)} · ±${Math.round(gpsEvidence.accuracy)}m` : "尚未采集"}</div><Btn variant="gray" onClick={captureGps} disabled={busy} fullWidth>{gpsEvidence ? "重新采集 GPS" : "采集 GPS"}</Btn></div>
            <Field label="扫描物料/箱 QR" value={bindingScan} onChange={setBindingScan} />
            <Btn variant="blue" onClick={() => void bindScannedMaterial()} disabled={busy || !bindingScan.trim() || !form.locationCode.trim() || !gpsEvidence}>{busy ? "绑定中..." : "确认绑定此 QR"}</Btn>
            <div style={{ marginTop: 12 }}>{palletMaterials.map(item => <div key={item.materialQr} style={{ padding: "8px 10px", marginTop: 6, borderRadius: 7, background: boundMaterialQrs.includes(item.materialQr) ? "#dcfce7" : "#fef3c7", fontSize: 12 }}><strong>{boundMaterialQrs.includes(item.materialQr) ? "已绑定" : "待扫描"}</strong> · {item.materialCode} · {item.lotNo}</div>)}</div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
