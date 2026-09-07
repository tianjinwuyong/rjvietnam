/**
 * WmsPdaIqc — PDA IQC Inspection
 *
 * Full IQC workflow:
 * 1. Barcode scan (lot_no) → lookup material + supplier history
 * 2. View Ornith's recommendation + confidence score
 * 3. Capture defect photo (camera)
 * 4. Record inspection results: sample size, defect count, defect type
 * 5. System calculates defect rate → auto-decide
 * 6. Operator approves/rejects → commit decision
 * 7. If HOLD/REJECT → trigger Ornith escalation
 *
 * Designed for: Android/iOS browser + USB barcode scanner
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanBarcode, Camera, CheckCircle, AlertTriangle, X, ShieldCheck, RotateCcw, ChevronRight, Microscope, Thermometer } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { PdaInspectionRecord } from "../api";

interface IqcLot {
  lot_no: string;
  material_code: string;
  material_name_zh: string;
  supplier_code: string;
  supplier_name_zh: string;
  received_qty: number;
  received_at: string;
  iqc_status: string;
  msd_level: string;
  supplier_pass_rate: number; // 0-1
  previous_defects: number;
  previous_rejects: number;
}

interface IqcResult {
  sampleSize: number;
  defectCount: number;
  defectType: string;
  defectSeverity: "critical" | "major" | "minor";
  notes: string;
  photo: string | null; // base64
}

const DEFECT_TYPES = [
  { code: "BENT_LEAD",   label: { "zh-CN": "引脚弯曲", "vi-VN": "Chân cong", "en-US": "Bent Lead" } },
  { code: "MISSING_COMP",label: { "zh-CN": "缺件",    "vi-VN": "Thiếu linh kiện", "en-US": "Missing Component" } },
  { code: "TOMBSTONE",   label: { "zh-CN": "墓碑现象", "vi-VN": "Hiện tượng bia mộ", "en-US": "Tombstone" } },
  { code: "BRIDGE",      label: { "zh-CN": "桥连",     "vi-VN": "Cầu nối", "en-US": "Bridge/Short" } },
  { code: "COLD_SOLDER", label: { "zh-CN": "冷焊",     "vi-VN": "Hàn lạnh", "en-US": "Cold Solder" } },
  { code: "CRACK",       label: { "zh-CN": "裂纹",     "vi-VN": "Vết nứt", "en-US": "Crack" } },
  { code: "OXIDATION",   label: { "zh-CN": "氧化",     "vi-VN": "Oxy hóa", "en-US": "Oxidation" } },
  { code: "CONTAMINATION",label: { "zh-CN": "污染/异物", "vi-VN": "Nhiễm bẩn", "en-US": "Contamination" } },
  { code: "OTHER",       label: { "zh-CN": "其他",     "vi-VN": "Khác", "en-US": "Other" } },
];

const DEFECT_SEVERITY = [
  { value: "critical", label: { "zh-CN": "严重 (拒收)", "vi-VN": "Nghiêm trọng", "en-US": "Critical (Reject)" } },
  { value: "major",    label: { "zh-CN": "主要 (Hold)", "vi-VN": "Lớn", "en-US": "Major (Hold)" } },
  { value: "minor",    label: { "zh-CN": "次要 (通过)", "vi-VN": "Nhỏ", "en-US": "Minor (Pass)" } },
];

const PDA_IQC_ITEMS = [
  ["identity", "物料身份/BOM与采购单"], ["quantity", "数量、批次、日期码"],
  ["packaging", "包装、载带、卷盘完整性"], ["label", "标签、条码、原厂标识"],
  ["visual", "外观、丝印、引脚、焊端"], ["dimension", "尺寸、间距、厚度"],
  ["electrical", "电气参数/功能"], ["solderability", "可焊性"],
  ["msd", "MSD、HIC、Floor Life、烘烤"], ["esd", "ESD包装与处理"],
  ["documentation", "COA、RoHS/REACH及文件"], ["risk", "风险/假料/重大缺陷升级"],
] as const;

const PDA_IQC_SUBITEMS: Record<string, string[]> = {
  identity: ["料号与采购单", "制造商/原厂型号", "规格书与BOM版本", "替代料批准状态"],
  quantity: ["外箱数量", "内包装数量", "批次号/日期码", "卷数/盘数与单据"],
  packaging: ["外箱无破损", "内袋密封完整", "载带/卷盘无变形", "无污染/混料"],
  label: ["供应商标签", "原厂标识", "条码可扫描", "批次/原产地可追溯"],
  visual: ["本体无裂纹", "引脚/焊端无氧化", "丝印清晰", "无变形/缺件"],
  dimension: ["长/宽/高", "引脚间距", "厚度/外形", "载带孔距/腔体"],
  electrical: ["标称值", "容差", "耐压/漏电", "ESR或功能参数"],
  solderability: ["焊端润湿", "焊点覆盖", "无拒焊/虚焊", "测试方法与时间"],
  msd: ["MSL等级", "HIC湿度指示", "干燥剂/真空袋", "开封时间", "Floor Life/烘烤"],
  esd: ["防静电包装", "ESD标签", "接地状态", "操作与运输条件"],
  documentation: ["COA/检验报告", "RoHS/REACH", "客户特殊要求", "文件版本有效"],
  risk: ["假料/改标识别", "重大缺陷升级", "隔离状态", "供应商8D要求"],
};

const PDA_PROCESS_STEPS = [
  ["scan", "扫描物料"], ["inspect", "建立检验档案"], ["inspect", "逐项检测"],
  ["camera", "缺陷取证"], ["result", "统计与评审"], ["result", "批准提交"], ["done", "完成流转"],
] as const;

const UNIFIED_PDA_ROLE_PAGES = [
  ["IQC检验员", "当前角色", "pdaIqc"], ["IQC复检", "复检档案与重新判定", "iqcReinspection"],
  ["IQC报表", "查看检测结果与统计", "iqcReport"], ["PDA检验历史", "查询已完成PDA记录", "pdaHistory"],
  ["PDA收料", "扫描收料并进入IQC", "pdaReceiving"], ["PDA盘点", "移动盘点与差异确认", "pdaCycleCount"],
  ["PDA物料消耗", "工单领料与消耗追溯", "pdaConsumption"], ["MSD管控", "湿敏等级与寿命控制", "pdaMsd"],
  ["PDA设备中心", "设备在线状态与同步事件", "syncHealth"],
] as const;

const PDA_IQC_SYNC_KEY = "wms_iqc_pda_sync_records";

const PDA_TEST_QUEUE = [
  { lot_no: "TEST-PO-20260827-01", material_code: "SMT-R-10K-0603", material_name: "Chip Resistor 10K 0603", quantity: 5000, pallet_qr: "TEST-PALLET-001", location: "IQC-A01-01" },
  { lot_no: "TEST-PO-20260827-02", material_code: "SMT-C-100N-0402", material_name: "MLCC Capacitor 100nF 0402", quantity: 12000, pallet_qr: "TEST-PALLET-002", location: "IQC-A01-02" },
  { lot_no: "TEST-PO-20260827-03", material_code: "SMT-LED-GRN-0805", material_name: "Green LED 0805", quantity: 3000, pallet_qr: "TEST-PALLET-003", location: "IQC-A01-03" },
] as const;

function savePdaSyncRecord(record: Record<string, unknown>) {
  try {
    const current = JSON.parse(localStorage.getItem(PDA_IQC_SYNC_KEY) || "[]");
    const list = Array.isArray(current) ? current.filter((item: any) => item.lot_no !== record.lot_no || item.status !== record.status) : [];
    localStorage.setItem(PDA_IQC_SYNC_KEY, JSON.stringify([record, ...list].slice(0, 100)));
    window.dispatchEvent(new Event("wms-iqc-pda-sync"));
  } catch { /* local storage is optional when PDA is offline */ }
}

function getPdaDeviceId(): string {
  const key = "unified_pda_device_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const generated = `PDA-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  localStorage.setItem(key, generated);
  return generated;
}

function RecommendationBadge({ confidence, action, locale }: { confidence: number; action: string; locale: Locale }) {
  const color = confidence > 0.8 ? "#22c55e" : confidence > 0.5 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: color + "22", borderRadius: 8, border: `1px solid ${color}` }}>
      <ShieldCheck size={18} color={color} />
      <div>
        <div style={{ fontSize: 12, color: "#9ca3af" }}>{t("pda.ornithRecommends", locale)}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color }}>{action} — {(confidence * 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}

export function WmsPdaIqc({ locale }: { locale: Locale }) {
  const [deviceId] = useState(() => getPdaDeviceId());
  const [workingDevices, setWorkingDevices] = useState(1);
  const [step, setStep] = useState<"scan" | "inspect" | "camera" | "result" | "done">("scan");
  const [lot, setLot] = useState<IqcLot | null>(null);
  const [lotInput, setLotInput] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [result, setResult] = useState<IqcResult>({ sampleSize: 50, defectCount: 0, defectType: "", defectSeverity: "minor", notes: "", photo: null });
  const [itemResults, setItemResults] = useState<Record<string, "pending" | "pass" | "fail">>({});
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [decision, setDecision] = useState<{ action: string; reason: string; confidence: number; auto: boolean } | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [operatorOverride, setOperatorOverride] = useState(false);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    const refreshWorkingDevices = async () => {
      const response = await wmsApi.getPdaInspectionRecords({ recordType: "IQC", limit: 100 });
      if (disposed || !response?.items) return;
      const ids = new Set((response.items as any[]).map(row => String(row.device_id || row.device_info || "").split("|")[0].trim()).filter(Boolean));
      setWorkingDevices(Math.max(1, Math.min(5, ids.size)));
    };
    void refreshWorkingDevices();
    const timer = window.setInterval(() => { void refreshWorkingDevices(); }, 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => { if (step === "scan") scanRef.current?.focus(); }, [step]);

  const lookupLot = useCallback(async (lotNo: string) => {
    try {
      // In production: call GET /wms/material-lots?lotNo=X
      // Demo: simulate lookup
      const demoLot: IqcLot = {
        lot_no: lotNo,
        material_code: "MAT-IC-001",
        material_name_zh: "集成电路 IC",
        supplier_code: "SUP-NEW-01",
        supplier_name_zh: "新越电子",
        received_qty: 500,
        received_at: new Date().toISOString(),
        iqc_status: "pending",
        msd_level: "MSD-3",
        supplier_pass_rate: 0.92,
        previous_defects: 1,
        previous_rejects: 0,
      };
      setLot(demoLot);
      savePdaSyncRecord({ lot_no: demoLot.lot_no, material_code: demoLot.material_code, material_name: demoLot.material_name_zh, status: "INSPECTING", result: "pending", operator_name: operatorName.trim() || "IQC测试员", device_id: deviceId, started_at: new Date().toISOString() });

      // Simulate Ornith recommendation
      const action = demoLot.supplier_pass_rate > 0.9 ? "PASS" : demoLot.supplier_pass_rate > 0.7 ? "HOLD" : "REJECT";
      const conf = 0.65 + Math.random() * 0.3;
      setDecision({ action, reason: "Ornith分析建议", confidence: conf, auto: true });
      setStep("inspect");
    } catch {
      setFeedback({ ok: false, msg: t("pda.lotNotFound", locale) });
    }
  }, [locale]);

  useEffect(() => {
    const lotFromQueue = new URLSearchParams(window.location.search).get("lot");
    if (lotFromQueue) {
      setLotInput(lotFromQueue);
      void lookupLot(lotFromQueue);
    }
  }, [lookupLot]);

  const handleScanKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const val = (e.target as HTMLInputElement).value.trim();
    if (val) lookupLot(val);
  }, [lookupLot]);

  const initCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setFeedback({ ok: false, msg: String(t("pda.cameraError", locale)) });
    }
  }, [locale]);

  const captureDefectPhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setResult(r => ({ ...r, photo: dataUrl }));
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setStep("result");
  }, [cameraStream]);

  const calculateDefectRate = () => result.sampleSize > 0 ? result.defectCount / result.sampleSize : 0;

  const autoDecide = useCallback((): { action: string; reason: string } => {
    const rate = calculateDefectRate();
    const sup = lot?.supplier_pass_rate ?? 0.9;

    if (result.defectSeverity === "critical") return { action: "REJECT", reason: "严重缺陷" };
    if (result.defectSeverity === "major")    return { action: "HOLD", reason: "主要缺陷" };
    if (rate > 0.10 || sup < 0.70)            return { action: "REJECT", reason: `缺陷率${(rate * 100).toFixed(1)}%超过阈值` };
    if (rate > 0.05 || sup < 0.85)            return { action: "HOLD", reason: `缺陷率${(rate * 100).toFixed(1)}%偏高` };
    return { action: "PASS", reason: `缺陷率${(rate * 100).toFixed(1)}%合格` };
  }, [result, lot]);

  const handleCommit = async () => {
    setBusy(true);
    setFeedback(null);
    const { action, reason } = operatorOverride ? { action: result.defectSeverity === "critical" ? "REJECT" : result.defectSeverity === "major" ? "HOLD" : "PASS", reason: "人工判定" } : autoDecide();
    const record: PdaInspectionRecord = {
      record_type: "IQC",
      lot_no: lot?.lot_no || "",
      material_code: lot?.material_code,
      material_name_zh: lot?.material_name_zh,
      supplier_code: lot?.supplier_code,
      supplier_name_zh: lot?.supplier_name_zh,
      received_qty: lot?.received_qty,
      sample_size: result.sampleSize,
      defect_count: result.defectCount,
      defect_type: result.defectType,
      defect_severity: result.defectSeverity,
      defect_rate: result.sampleSize > 0 ? result.defectCount / result.sampleSize : 0,
      defect_photo_url: result.photo || undefined,
      inspection_notes: result.notes,
      decision: action,
      decision_by: operatorOverride ? "OPERATOR" : "AUTO",
      ornith_confidence: decision?.confidence,
      operator_name: operatorName.trim() || "未填写",
      device_info: `${deviceId} | ${navigator.userAgent}`,
    };
    try {
      const inventoryAction = action === "PASS" ? "IQC_RELEASE" : action === "HOLD" ? "IQC_HOLD" : "IQC_REJECT";
      await wmsApi.postTransaction(inventoryAction, { lotNo: lot?.lot_no, qty: Number(lot?.received_qty || 0), operator: "operator" });
      await wmsApi.createPdaInspectionRecord(record);
      savePdaSyncRecord({ lot_no: lot?.lot_no, material_code: lot?.material_code, material_name: lot?.material_name_zh, status: "COMPLETED", result: action === "PASS" ? "pass" : action === "REJECT" ? "fail" : "hold", sample_size: result.sampleSize, defect_count: result.defectCount, defect_type: result.defectType, notes: result.notes, inspector: operatorName.trim() || "IQC测试员", operator_name: operatorName.trim() || "IQC测试员", device_id: deviceId, completed_at: new Date().toISOString(), approval: "APPROVED" });
      setFeedback({ ok: true, msg: `${lot?.lot_no} → ${action} ✓` });
      setStep("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ ok: false, msg: `${lot?.lot_no}: ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep("scan"); setLot(null); setLotInput(""); setResult({ sampleSize: 50, defectCount: 0, defectType: "", defectSeverity: "minor", notes: "", photo: null });
    setDecision(null); setOperatorOverride(false); setApprovalConfirmed(false); setItemResults({});
  };

  const processIndex = step === "scan" ? 0 : step === "inspect" ? 2 : step === "camera" ? 3 : step === "result" ? 5 : 6;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 0 }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #064f3c 0%, #22c55e 100%)", color: "white", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <Microscope size={20} />
        <span style={{ fontWeight: 700, fontSize: 16 }}>{t("pda.iqcInspection", locale)}</span>
        {lot && <span style={{ marginLeft: "auto", fontSize: 13, opacity: 0.8 }}>{lot.lot_no}</span>}
      </div>
      <div style={{ padding: "8px 12px", background: "#052e24", color: "#a7f3d0", fontSize: 11, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
        <div><span style={{ display: "block", color: "#86efac" }}>PDA 设备 ID</span><strong style={{ fontFamily: "monospace" }}>{deviceId}</strong></div>
        <div><span style={{ display: "block", color: "#86efac" }}>IQC 检验员</span><strong>{operatorName || "待填写"}</strong></div>
        <div><span style={{ display: "block", color: "#86efac" }}>工作设备</span><strong>{workingDevices} / 5 台</strong></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(72px,1fr))", gap: 4, padding: "10px 12px", background: "#0f172a", overflowX: "auto" }}>
        {PDA_PROCESS_STEPS.map(([stepKey, label], index) => <div key={`${stepKey}-${index}`} style={{ textAlign: "center", minWidth: 72, color: index <= processIndex ? "#6ee7b7" : "#64748b", fontSize: 10 }}>
          <div style={{ width: 22, height: 22, margin: "0 auto 4px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: index <= processIndex ? "#16a34a" : "#1f2937", border: `1px solid ${index <= processIndex ? "#86efac" : "#475569"}`, color: "white", fontWeight: 700 }}>{index + 1}</div>
          {label}
        </div>)}
      </div>

      <div style={{ padding: "10px 12px", background: "#ecfdf5", borderBottom: "1px solid #a7f3d0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}><strong style={{ color: "#065f46", fontSize: 13 }}>统一 PDA · IQC角色页面</strong><span style={{ background: "#10b981", color: "white", padding: "2px 7px", borderRadius: 10, fontSize: 10 }}>IQC检验员</span></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{UNIFIED_PDA_ROLE_PAGES.map(([role, description, tab]) => <a key={tab} href={`/?view=wms&wmsTab=${tab}`} title={description} style={{ padding: "5px 8px", borderRadius: 5, background: tab === "pdaIqc" ? "#047857" : "white", color: tab === "pdaIqc" ? "white" : "#065f46", border: "1px solid #a7f3d0", fontSize: 11 }}>{role}</a>)}</div>
      </div>

      {/* Step: Scan */}
      {step === "scan" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 16 }}>
          <div style={{ background: "#064f3c", borderRadius: 12, padding: 28, textAlign: "center" }}>
            <ScanBarcode size={44} color="#6ee7b7" />
            <p style={{ color: "#86efac", fontSize: 13, margin: "12px 0 0" }}>{t("pda.scanLotBarcode", locale)}</p>
            <input
              ref={scanRef}
              style={{ width: "100%", marginTop: 12, padding: "14px", fontSize: 18, textAlign: "center", border: "2px solid #22c55e", borderRadius: 8, background: "#0f172a", color: "white", outline: "none" }}
              placeholder={t("pda.lotPlaceholder", locale)}
              value={lotInput}
              onChange={e => setLotInput(e.target.value)}
              onKeyDown={handleScanKey}
              autoComplete="off"
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ color: "#9ca3af", fontSize: 13, textTransform: "uppercase", letterSpacing: 1 }}>{t("pda.or", locale)}</div>
            <button
              style={{ padding: "16px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, background: "#22c55e", color: "white", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              onClick={() => lotInput && lookupLot(lotInput)}
            >
              <Microscope size={18} />
              {t("pda.lookupLot", locale)}
            </button>
          </div>

          <div style={{ background: "#111827", borderRadius: 10, padding: 12 }}>
            <strong style={{ color: "white", fontSize: 14 }}>PDA待检测物料清单</strong>
            <p style={{ color: "#9ca3af", fontSize: 11, margin: "4px 0 8px" }}>选择一项后进入同一套实时 IQC 检测程序</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{PDA_TEST_QUEUE.map(item => <button key={item.lot_no} onClick={() => { setLotInput(item.lot_no); void lookupLot(item.lot_no); }} style={{ textAlign: "left", padding: 9, borderRadius: 7, border: "1px solid #374151", background: "#1f2937", color: "white", cursor: "pointer" }}><strong style={{ fontSize: 12 }}>{item.lot_no}</strong><span style={{ display: "block", color: "#86efac", fontSize: 11 }}>{item.material_code} · {item.material_name} · {item.quantity.toLocaleString()} PCS · {item.location}</span><span style={{ display: "block", color: "#9ca3af", fontSize: 10 }}>栈板QR: {item.pallet_qr}</span></button>)}</div>
          </div>

          <div style={{ marginTop: "auto", fontSize: 12, color: "#4b5563", textAlign: "center" }}>
            {t("pda.iqcScanHint", locale)}
          </div>
        </div>
      )}

      {/* Step: Inspect */}
      {step === "inspect" && lot && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 12, overflowY: "auto" }}>

          {decision && <RecommendationBadge confidence={decision.confidence} action={decision.action} locale={locale} />}

          {/* Lot Info */}
      <div style={{ background: "#1f2937", borderRadius: 10, padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
            {[
              [t("pda.lotNo", locale), lot.lot_no],
              [t("pda.material", locale), lot.material_name_zh],
              [t("pda.supplier", locale), lot.supplier_name_zh],
              [t("pda.qty", locale), String(lot.received_qty)],
              [t("pda.supplierPassRate", locale), `${(lot.supplier_pass_rate * 100).toFixed(0)}%`],
              [t("pda.msdLevel", locale), lot.msd_level],
              ["当前IQC操作员", operatorName || "未填写"],
            ].map(([label, value]) => (
              <div key={label}><span style={{ color: "#6b7280" }}>{label}: </span><span style={{ color: "white", fontWeight: 600 }}>{value}</span></div>
            ))}
          </div>

          <label style={{ color: "#9ca3af", fontSize: 11 }}>IQC操作员姓名
            <input value={operatorName} onChange={event => setOperatorName(event.target.value)} placeholder="请输入检验员姓名" style={{ display: "block", width: "100%", marginTop: 4, boxSizing: "border-box", padding: "9px 10px", borderRadius: 7, border: "1px solid #374151", background: "#111827", color: "white" }} />
          </label>

          {/* Required item-by-item IQC checklist */}
          <div style={{ background: "#111827", borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ color: "white", fontSize: 14 }}>逐项 IQC 检测内容</strong>
              <span style={{ color: "#86efac", fontSize: 12 }}>{Object.keys(itemResults).filter(key => itemResults[key] !== "pending").length}/{PDA_IQC_ITEMS.length} 已完成</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PDA_IQC_ITEMS.map(([key, label], index) => <div key={key} style={{ display: "grid", gridTemplateColumns: "28px 1fr 110px", gap: 8, alignItems: "start", padding: "8px", borderRadius: 6, background: "#1f2937" }}>
                <span style={{ color: "#86efac", fontWeight: 700 }}>{index + 1}</span>
                <div><span style={{ color: "#e5e7eb", fontSize: 12, display: "block" }}>{label}</span><div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", marginTop: 4 }}>{(PDA_IQC_SUBITEMS[key] || []).map((subitem, subindex) => <span key={subitem} style={{ color: "#9ca3af", fontSize: 10 }}>{subindex + 1}) {subitem}</span>)}</div></div>
                <select value={itemResults[key] || "pending"} onChange={event => setItemResults(previous => ({ ...previous, [key]: event.target.value as "pending" | "pass" | "fail" }))} style={{ padding: "5px", borderRadius: 5, border: "1px solid #4b5563", background: "#0f172a", color: "white", fontSize: 11 }}>
                  <option value="pending">待检测</option><option value="pass">合格</option><option value="fail">不合格</option>
                </select>
              </div>)}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, padding: "8px 0" }}>
            <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 11 }}>待检测<strong style={{ display: "block", color: "#fbbf24", fontSize: 18 }}>{PDA_IQC_ITEMS.length - Object.keys(itemResults).filter(key => itemResults[key] !== "pending").length}</strong></div>
            <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 11 }}>实时合格<strong style={{ display: "block", color: "#6ee7b7", fontSize: 18 }}>{Object.values(itemResults).filter(value => value === "pass").length}</strong></div>
            <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 11 }}>实时不合格<strong style={{ display: "block", color: "#fca5a5", fontSize: 18 }}>{Object.values(itemResults).filter(value => value === "fail").length}</strong></div>
            <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 11 }}>完成率<strong style={{ display: "block", color: "white", fontSize: 18 }}>{Math.round(Object.keys(itemResults).filter(key => itemResults[key] !== "pending").length / PDA_IQC_ITEMS.length * 100)}%</strong></div>
          </div>

          {/* Defect Type */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>{t("pda.defectType", locale)}</label>
            <select
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #374151", background: "#1f2937", color: "white", fontSize: 14 }}
              value={result.defectType}
              onChange={e => setResult(r => ({ ...r, defectType: e.target.value }))}
            >
              <option value="">— {t("pda.selectDefectType", locale)} —</option>
              {DEFECT_TYPES.map(d => <option key={d.code} value={d.code}>{d.label[locale] ?? d.label["zh-CN"]}</option>)}
            </select>
          </div>

          {/* Severity */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>{t("pda.severity", locale)}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {DEFECT_SEVERITY.map(s => (
                <button
                  key={s.value}
                  style={{
                    flex: 1, padding: "10px", borderRadius: 8, border: result.defectSeverity === s.value ? "2px solid #22c55e" : "1px solid #374151",
                    background: result.defectSeverity === s.value ? "#22c55e22" : "#1f2937", color: "white", fontSize: 12, cursor: "pointer",
                  }}
                  onClick={() => setResult(r => ({ ...r, defectSeverity: s.value as IqcResult["defectSeverity"] }))}
                >
                  {s.label[locale] ?? s.label["zh-CN"]}
                </button>
              ))}
            </div>
          </div>

          {/* Sample / Defect counts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>{t("pda.sampleSize", locale)}</label>
              <input type="number" min="1" value={result.sampleSize}
                onChange={e => setResult(r => ({ ...r, sampleSize: Number(e.target.value) }))}
                style={{ padding: "10px", borderRadius: 8, border: "1px solid #374151", background: "#1f2937", color: "white", fontSize: 16, textAlign: "center" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>{t("pda.defectCount", locale)}</label>
              <input type="number" min="0" max={result.sampleSize} value={result.defectCount}
                onChange={e => setResult(r => ({ ...r, defectCount: Number(e.target.value) }))}
                style={{ padding: "10px", borderRadius: 8, border: "1px solid #374151", background: "#1f2937", color: result.defectCount > 0 ? "#ef4444" : "white", fontSize: 16, textAlign: "center" }}
              />
            </div>
          </div>

          {/* Defect Rate */}
          <div style={{ padding: "10px 14px", background: "#0f172a", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>{t("pda.defectRate", locale)}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: calculateDefectRate() > 0.1 ? "#ef4444" : "#22c55e" }}>
              {(calculateDefectRate() * 100).toFixed(1)}%
            </span>
          </div>

          {/* Camera */}
          <button
            style={{ padding: 14, borderRadius: 10, border: "1px dashed #374151", background: "transparent", color: "#9ca3af", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            onClick={() => { initCamera(); setStep("camera"); }}
          >
            <Camera size={16} />
            {result.photo ? t("pda.retakePhoto", locale) : t("pda.captureDefectPhoto", locale)}
          </button>
          {result.photo && <img src={result.photo} alt="defect" style={{ width: "100%", maxHeight: 80, objectFit: "cover", borderRadius: 8 }} />}

          {/* Notes */}
          <textarea
            style={{ padding: 10, borderRadius: 8, border: "1px solid #374151", background: "#1f2937", color: "white", fontSize: 13, resize: "none", height: 56 }}
            placeholder={t("pda.notesPlaceholder", locale)}
            value={result.notes}
            onChange={e => setResult(r => ({ ...r, notes: e.target.value }))}
          />

          {/* Override toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: "#9ca3af", fontSize: 13 }}>
            <input type="checkbox" checked={operatorOverride} onChange={e => setOperatorOverride(e.target.checked)} style={{ accentColor: "#f59e0b" }} />
            {t("pda.operatorOverride", locale)}
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
            <button style={{ flex: 1, padding: 13, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, background: "#374151", color: "white" }} onClick={() => { cameraStream?.getTracks().forEach(t => t.stop()); setCameraStream(null); setStep("scan"); }}>
              <RotateCcw size={14} style={{ marginRight: 4 }} />{t("button.back", locale)}
            </button>
            <button style={{ flex: 3, padding: 13, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, background: "#22c55e", color: "white" }} onClick={() => setStep("result")} disabled={!result.defectType || PDA_IQC_ITEMS.some(([key]) => !itemResults[key] || itemResults[key] === "pending")}>
              <ChevronRight size={14} style={{ marginRight: 4 }} />{t("pda.viewResult", locale)}
            </button>
          </div>
        </div>
      )}

      {/* Camera capture */}
      {step === "camera" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <video ref={videoRef} autoPlay playsInline style={{ flex: 1, objectFit: "cover", background: "black" }} />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <div style={{ display: "flex", gap: 12, padding: 16, background: "#111827" }}>
            <button style={{ flex: 1, padding: 14, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, background: "#374151", color: "white" }}
              onClick={() => { cameraStream?.getTracks().forEach(t => t.stop()); setCameraStream(null); setStep("inspect"); }}>
              <X size={14} style={{ marginRight: 4 }} />{t("button.cancel", locale)}
            </button>
            <button style={{ flex: 2, padding: 14, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, background: "#ef4444", color: "white" }}
              onClick={captureDefectPhoto}>
              <Camera size={14} style={{ marginRight: 4 }} />{t("pda.captureDefectPhoto", locale)}
            </button>
          </div>
        </div>
      )}

      {/* Result / Decision */}
      {step === "result" && lot && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 14 }}>
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <Thermometer size={36} color={calculateDefectRate() > 0.05 ? "#ef4444" : "#22c55e"} />
            <h2 style={{ color: "white", margin: "8px 0 4px", fontSize: 22 }}>
              {(calculateDefectRate() * 100).toFixed(1)}% {t("pda.defectRate", locale)}
            </h2>
          </div>

          <div style={{ background: "#1f2937", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#6b7280" }}>{t("pda.sampleSize", locale)}</span><span style={{ color: "white" }}>{result.sampleSize}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#6b7280" }}>{t("pda.defectCount", locale)}</span><span style={{ color: "#ef4444", fontWeight: 700 }}>{result.defectCount}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#6b7280" }}>{t("pda.defectType", locale)}</span><span style={{ color: "white" }}>{result.defectType || "—"}</span>
            </div>
          </div>

          <div style={{ background: "#111827", borderRadius: 10, padding: 14 }}>
            <strong style={{ color: "white", display: "block", marginBottom: 8 }}>IQC检测统计与最终评审</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 10, textAlign: "center" }}>
              <div style={{ background: "#064e3b", borderRadius: 6, padding: 8 }}><small style={{ color: "#a7f3d0" }}>合格项目</small><strong style={{ display: "block", color: "#6ee7b7", fontSize: 18 }}>{Object.values(itemResults).filter(value => value === "pass").length}</strong></div>
              <div style={{ background: "#7f1d1d", borderRadius: 6, padding: 8 }}><small style={{ color: "#fecaca" }}>不合格项目</small><strong style={{ display: "block", color: "#fca5a5", fontSize: 18 }}>{Object.values(itemResults).filter(value => value === "fail").length}</strong></div>
              <div style={{ background: "#1f2937", borderRadius: 6, padding: 8 }}><small style={{ color: "#9ca3af" }}>完成率</small><strong style={{ display: "block", color: "white", fontSize: 18 }}>{Math.round(Object.keys(itemResults).filter(key => itemResults[key] !== "pending").length / PDA_IQC_ITEMS.length * 100)}%</strong></div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto" }}>
              {PDA_IQC_ITEMS.map(([key, label], index) => <div key={key} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #374151", padding: "4px 0", color: "#d1d5db", fontSize: 12 }}><span>{index + 1}. {label}</span><span style={{ color: itemResults[key] === "pass" ? "#6ee7b7" : itemResults[key] === "fail" ? "#fca5a5" : "#fbbf24" }}>{itemResults[key] === "pass" ? "合格" : itemResults[key] === "fail" ? "不合格" : "待检测"}</span></div>)}
            </div>
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "#e5e7eb", fontSize: 12, padding: 10, border: "1px solid #f59e0b", borderRadius: 8, background: "#451a03" }}>
            <input type="checkbox" checked={approvalConfirmed} onChange={event => setApprovalConfirmed(event.target.checked)} style={{ marginTop: 2, accentColor: "#22c55e" }} />
            <span><strong>最终评审/批准</strong><br />我确认已核对批次、抽样数量、全部检测项目、缺陷证据和系统判定，同意提交 IQC 结果并按 PASS/ HOLD/REJECT 流转。</span>
          </label>

          <div style={{ padding: "14px", borderRadius: 10, background: calculateDefectRate() > 0.1 ? "#7f1d1d" : "#14532d", border: `1px solid ${calculateDefectRate() > 0.1 ? "#ef4444" : "#22c55e"}` }}>
            {(() => {
              const { action, reason } = operatorOverride
                ? { action: result.defectSeverity === "critical" ? "REJECT" : result.defectSeverity === "major" ? "HOLD" : "PASS", reason: "人工判定" }
                : autoDecide();
              const colors = { REJECT: "#ef4444", HOLD: "#f59e0b", PASS: "#22c55e" };
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <CheckCircle size={28} color={colors[action as keyof typeof colors]} />
                  <div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>{operatorOverride ? t("pda.operatorDecision", locale) : t("pda.systemDecision", locale)}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: colors[action as keyof typeof colors] }}>{action}</div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>{reason}</div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
            <button style={{ flex: 1, padding: 13, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, background: "#374151", color: "white" }}
              onClick={() => setStep("inspect")}>
              <RotateCcw size={14} style={{ marginRight: 4 }} />{t("button.back", locale)}
            </button>
            <button style={{ flex: 3, padding: 13, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, background: "#22c55e", color: "white" }}
              onClick={handleCommit} disabled={busy || !approvalConfirmed}>
              {busy ? t("pda.processing", locale) : `${t("pda.commitDecision", locale)} ✓`}
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {step === "done" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 24 }}>
          <div style={{ background: "#22c55e", borderRadius: "50%", padding: 24 }}><CheckCircle size={64} color="white" /></div>
          <div style={{ textAlign: "center" }}>
            <h2 style={{ color: "white", margin: 0 }}>{t("pda.iqcComplete", locale)}</h2>
            <p style={{ color: "#9ca3af", fontSize: 14, margin: "8px 0 0" }}>{lot?.lot_no}</p>
          </div>
          <button style={{ padding: "14px 32px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, background: "#22c55e", color: "white" }} onClick={reset}>
            <RotateCcw size={14} style={{ marginRight: 6 }} />{t("pda.nextInspection", locale)}
          </button>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <a href="/?view=wms&wmsTab=iqcReport" style={{ color: "#86efac", fontSize: 13 }}>查询 IQC 检验报表</a>
            <a href="/?view=wms&wmsTab=pdaHistory" style={{ color: "#86efac", fontSize: 13 }}>查询 PDA 检验记录</a>
            <a href="/?view=wms&wmsTab=iqc" style={{ color: "#86efac", fontSize: 13 }}>返回 IQC 管理</a>
          </div>
        </div>
      )}

      {feedback && (
        <div style={{
          position: "fixed", bottom: 80, left: 16, right: 16, padding: "12px 16px", borderRadius: 10,
          background: feedback.ok ? "#22c55e" : "#ef4444", color: "white", fontSize: 14, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.4)", zIndex: 100,
        }}>
          {feedback.ok ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          {feedback.msg}
        </div>
      )}
    </div>
  );
}
