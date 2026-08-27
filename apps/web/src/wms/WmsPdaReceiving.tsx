/**
 * WmsPdaReceiving — PDA Receiving & Material Import
 *
 * Full receiving workflow:
 * 1. Barcode scan (lot_no or PO barcode) via keyboard input
 * 2. Camera capture for label OCR (reads lot_no, date code, qty)
 * 3. Material data confirmation
 * 4. MSD bag inspection
 * 5. Print receiving label
 * 6. Commit to material_lots → iqc_status=pending
 * 7. Triggers Ornith analysis → SOP step_vision
 *
 * Designed for: Android/iOS browser + USB barcode scanner
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanBarcode, Camera, Printer, CheckCircle, AlertTriangle, X, Truck, Package, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { ReceivingLot, PdaInspectionRecord } from "../api";

interface PdaReceiveState {
  step: "scan" | "camera" | "confirm" | "msd" | "done";
  poNo: string;
  lotNo: string;
  materialCode: string;
  materialName: string;
  supplierCode: string;
  supplierName: string;
  qty: number;
  dateCode: string;
  msdLevel: string;
  rackCode: string;
  rackLevel: string;
  rackPosition: string;
  locationCode: string;
  floorAreaCode: string;
  floorX: string;
  floorZ: string;
  aislePermitNo: string;
  clearBy: string;
  notes: string;
  cameraPhoto: string | null; // base64
  defectPhoto: string | null;
  operator: string;
  materialLotId?: number;
  preReceiptQr: string;
  workOrderCode: string;
  materialQr: string;
  palletSn: string;
  expiryDate: string;
  inspectionDate: string;
  acceptanceDate: string;
  acceptedBy: string;
  iqcInspector: string;
  nextInspectionDate: string;
  iqcResult: "PASS" | "HOLD" | "FAIL";
  // MSD bag inspection
  sealOk: boolean;
  desiccantOk: boolean;
  humidityOk: boolean;
}

const STEPS = ["scan", "camera", "confirm", "msd", "done"] as const;

type PdaReceivingStatus = {
  phase: "SCANNED" | "RECEIVING" | "COMPLETED" | "FAILED";
  lotNo?: string; materialCode?: string; qty?: number; locationCode?: string;
  floorAreaCode?: string; iqcResult?: string; operator?: string; at: string;
};

function publishReceivingStatus(status: Omit<PdaReceivingStatus, "at">) {
  const payload: PdaReceivingStatus = { ...status, at: new Date().toISOString() };
  try { window.localStorage.setItem("wms:pda-receiving-status", JSON.stringify(payload)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent<PdaReceivingStatus>("wms:pda-receiving-status", { detail: payload }));
}

function StepIndicator({ current, locale }: { current: string; locale: Locale }) {
  const stepLabels: Record<string, Record<Locale, string>> = {
    scan:    { "zh-CN": "扫描", "vi-VN": "Quét", "en-US": "Scan" },
    camera:  { "zh-CN": "拍照", "vi-VN": "Chụp ảnh", "en-US": "Photo" },
    confirm: { "zh-CN": "确认", "vi-VN": "Xác nhận", "en-US": "Confirm" },
    msd:     { "zh-CN": "MSD检查", "vi-VN": "Kiểm tra MSD", "en-US": "MSD Check" },
    done:    { "zh-CN": "完成", "vi-VN": "Hoàn thành", "en-US": "Done" },
  };
  const idx = STEPS.indexOf(current as typeof STEPS[number]);
  return (
    <div style={{ display: "flex", gap: 4, padding: "8px 0" }}>
      {STEPS.map((s, i) => (
        <div key={s} style={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          background: i <= idx ? (i === idx ? "#f59e0b" : "#22c55e") : "#374151",
          transition: "background 0.3s",
        }} />
      ))}
    </div>
  );
}

export function WmsPdaReceiving({ locale }: { locale: Locale }) {
  const [state, setState] = useState<PdaReceiveState>({
    step: "scan",
    poNo: "", lotNo: "", materialCode: "", materialName: "",
    supplierCode: "", supplierName: "",
    qty: 0, dateCode: "", msdLevel: "", rackCode: "", rackLevel: "", rackPosition: "", locationCode: "", floorAreaCode:"", floorX:"", floorZ:"", aislePermitNo:"", clearBy:"",
    notes: "", cameraPhoto: null, defectPhoto: null,
    operator: "operator",
    preReceiptQr: "",
    workOrderCode: "", materialQr: "", palletSn: "", expiryDate: "",
    inspectionDate: new Date().toISOString().slice(0, 16),
    acceptanceDate: new Date().toISOString().slice(0, 16),
    acceptedBy: "", iqcInspector: "", nextInspectionDate: "", iqcResult: "PASS",
    sealOk: false,
    desiccantOk: false,
    humidityOk: false,
  });
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [pendingUnregisteredQr, setPendingUnregisteredQr] = useState("");
  const [authorizationBy, setAuthorizationBy] = useState("");
  const [authorizationRole, setAuthorizationRole] = useState("WAREHOUSE_SUPERVISOR");
  const [authorizationReason, setAuthorizationReason] = useState("");
  const [exceptionAuthorizationId, setExceptionAuthorizationId] = useState<number | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.step === "scan") scanRef.current?.focus();
  }, [state.step]);

  const initCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setCameraStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setFeedback({ ok: false, msg: String(t("pda.cameraError", locale)) });
    }
  }, [locale]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setState(s => ({ ...s, cameraPhoto: dataUrl, step: "confirm" }));
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
  }, [cameraStream]);

  const handleScanKey = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const val = (e.target as HTMLInputElement).value.trim();
    if (!val) return;
    setBusy(true);
    setFeedback(null);
    try {
      let preReceipt;
      try {
        preReceipt = await wmsApi.getSupplierPreReceipt(val);
      } catch {
        setPendingUnregisteredQr(val.toUpperCase());
        setFeedback({ ok: false, msg: `未找到供应商预收料二维码：${val}，需要主管授权后才能继续` });
        return;
      }
      if (preReceipt.status !== "REGISTERED") {
        setFeedback({ ok: false, msg: `预收料二维码状态为 ${preReceipt.status}，不能重复收料` });
        return;
      }
      // Both pallet QR and outer-box QR are canonical WMS label IDs.
      // A scan must resolve against WMS before the receiving form is opened.
      let resolvedLabel = preReceipt.palletQr || preReceipt.outerBoxQrs?.[0] || val;
      let result = await wmsApi.getMaterialLots({ labelId: resolvedLabel, limit: 1 });
      if (!result.items?.length) result = await wmsApi.getMaterialLots({ lotNo: val, limit: 1 });
      if (!result.items?.length) {
        // Same canonical rule as ICT/FCT motherboards:
        // scan one child QR -> resolve its parent container/pallet -> know siblings.
        const lineage = await wmsApi.resolveQrFamily(val);
        resolvedLabel = lineage.family?.pallet?.palletCode || lineage.family?.containerId || val;
        result = await wmsApi.getMaterialLots({ labelId: resolvedLabel, limit: 1 });
      }
      const lot = result.items?.[0] as (ReceivingLot & { labelId?: string; name_zh?: string; supplierName?: string }) | undefined;
      if (!lot) {
        setFeedback({ ok: false, msg: `未找到栈板码/外箱码：${val}` });
        setScanValue("");
        scanRef.current?.focus();
        return;
      }
      const locationParts = String(lot.locationCode || "").split("-");
      setState(s => ({
        ...s,
        materialLotId: Number(lot.id),
        preReceiptQr: preReceipt.preReceiptQr,
        materialQr: lot.labelId || "",
        palletSn: preReceipt.palletQr || "",
        lotNo: preReceipt.lotNo || lot.lotNo,
        poNo: preReceipt.poNo || lot.poNo || "",
        materialCode: preReceipt.materialCode || lot.materialCode,
        materialName: preReceipt.materialName || lot.name_zh || "",
        supplierCode: preReceipt.supplierCode || lot.supplierCode || "",
        supplierName: preReceipt.supplierName || lot.supplierName || "",
        qty: Number(preReceipt.qty || lot.qty || 0),
        expiryDate: preReceipt.expiryDate || lot.expiryDate || "",
        rackCode: locationParts.slice(0, 2).join("-"),
        rackLevel: locationParts[2] || "",
        rackPosition: locationParts[3] || "",
        locationCode: lot.locationCode || "",
        step: "confirm",
      }));
      publishReceivingStatus({ phase: "SCANNED", lotNo: preReceipt.lotNo, materialCode: preReceipt.materialCode, qty: Number(preReceipt.qty || 0), operator: state.acceptedBy || state.operator });
      setFeedback({ ok: true, msg: `预收料已注册：${preReceipt.preReceiptQr} → ${preReceipt.materialCode}` });
    } catch (err) {
      setFeedback({ ok: false, msg: `扫码查询失败：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }, []);

  const authorizeMissingPreReceipt = async () => {
    if (!pendingUnregisteredQr || !authorizationBy.trim() || !authorizationReason.trim()) {
      setFeedback({ ok: false, msg: "请填写授权人和授权原因" });
      return;
    }
    setBusy(true);
    try {
      const authorization = await wmsApi.authorizeMissingPreReceipt({
        scannedQr: pendingUnregisteredQr,
        authorizedBy: authorizationBy.trim(),
        authorizationRole,
        reason: authorizationReason.trim(),
      });
      setExceptionAuthorizationId(Number(authorization.exceptionId));
      let result = await wmsApi.getMaterialLots({ labelId: pendingUnregisteredQr, limit: 1 });
      if (!result.items?.length) result = await wmsApi.getMaterialLots({ lotNo: pendingUnregisteredQr, limit: 1 });
      const lot = result.items?.[0] as (ReceivingLot & { labelId?: string; name_zh?: string; supplierName?: string }) | undefined;
      setState(s => ({
        ...s,
        preReceiptQr: "",
        materialLotId: lot ? Number(lot.id) : undefined,
        materialQr: lot?.labelId || pendingUnregisteredQr,
        palletSn: "",
        lotNo: lot?.lotNo || "",
        materialCode: lot?.materialCode || "",
        materialName: lot?.name_zh || "",
        supplierCode: lot?.supplierCode || "",
        supplierName: lot?.supplierName || "",
        qty: Number(lot?.qty || 0),
        step: "confirm",
      }));
      setFeedback({ ok: true, msg: `主管授权通过，例外记录 #${authorization.exceptionId}` });
      setPendingUnregisteredQr("");
    } catch (err) {
      setFeedback({ ok: false, msg: `授权失败：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const handleReceive = async () => {
    setBusy(true);
    setFeedback(null);
    const hasRack=Boolean(state.rackCode&&state.rackLevel&&state.rackPosition&&state.locationCode);
    const hasFloor=Boolean(state.floorAreaCode&&Number.isFinite(Number(state.floorX))&&Number.isFinite(Number(state.floorZ)));
    if (!state.lotNo || !state.materialCode || !state.supplierCode || !state.qty ||
        !state.materialQr || !state.palletSn || (!hasRack&&!hasFloor) ||
        !state.acceptedBy || !state.iqcInspector || !state.nextInspectionDate) {
      publishReceivingStatus({ phase: "FAILED", lotNo: state.lotNo, materialCode: state.materialCode, qty: state.qty, locationCode: state.locationCode, floorAreaCode: state.floorAreaCode, iqcResult: state.iqcResult, operator: state.acceptedBy || state.operator });
      setFeedback({ ok: false, msg: "请填写所有必填验收字段" });
      setBusy(false);
      return;
    }
    publishReceivingStatus({ phase: "RECEIVING", lotNo: state.lotNo, materialCode: state.materialCode, qty: state.qty, locationCode: state.locationCode, floorAreaCode: state.floorAreaCode, iqcResult: state.iqcResult, operator: state.acceptedBy });
    let materialLotId = state.materialLotId;
    if (!materialLotId) {
      publishReceivingStatus({ phase: "FAILED", lotNo: state.lotNo, materialCode: state.materialCode, qty: state.qty, locationCode: state.locationCode, floorAreaCode: state.floorAreaCode, iqcResult: state.iqcResult, operator: state.acceptedBy || state.operator });
      const lots = await wmsApi.getMaterialLots({ lotNo: state.lotNo, limit: 1 });
      materialLotId = Number(lots.items?.[0]?.id || 0) || undefined;
    }
    if (!materialLotId) {
      setFeedback({ ok: false, msg: `批次 ${state.lotNo} 尚未由收货单建立，不能验收` });
      setBusy(false);
      return;
    }
    const record: PdaInspectionRecord = {
      record_type: "RECEIVING",
      lot_no: state.lotNo,
      materialLotId,
      result: state.iqcResult,
      operator: state.iqcInspector,
      material_code: state.materialCode,
      material_name_zh: state.materialName,
      supplier_code: state.supplierCode,
      supplier_name_zh: state.supplierName,
      received_qty: state.qty,
      po_no: state.poNo,
      date_code: state.dateCode,
      msd_level: state.msdLevel,
      location_code: state.locationCode,
      notes: JSON.stringify({
        notes: state.notes, workOrderCode: state.workOrderCode, materialQr: state.materialQr, palletSn: state.palletSn,
        expiryDate: state.expiryDate, inspectionDate: state.inspectionDate,
        acceptanceDate: state.acceptanceDate, acceptedBy: state.acceptedBy,
        iqcInspector: state.iqcInspector, rackCode: state.rackCode,
        rackLevel: state.rackLevel, rackPosition: state.rackPosition,
        nextInspectionDate: state.nextInspectionDate,
        locationCode: state.locationCode,
        floorAreaCode:state.floorAreaCode,floorX:state.floorX,floorZ:state.floorZ,
      }),
      receiving_photo_url: state.cameraPhoto || undefined,
      operator_name: state.operator,
      device_info: navigator.userAgent,
    };
    try {
      await wmsApi.registerReceivingQrs(materialLotId, {
        materialQr: state.materialQr, palletQr: state.palletSn, preReceiptQr: state.preReceiptQr,
        workOrderCode: state.workOrderCode, locationCode: state.locationCode, registeredBy: state.acceptedBy,
      });
      if(hasFloor) await wmsApi.registerFloorPosition(materialLotId,{areaCode:state.floorAreaCode,x:Number(state.floorX),z:Number(state.floorZ),workOrderCode:state.workOrderCode,permitNo:state.aislePermitNo,clearBy:state.clearBy||undefined,operator:state.acceptedBy});
      await wmsApi.postTransaction("RECEIVE", {
        materialLotId, lotNo: state.lotNo, qty: state.qty, operator: state.acceptedBy,
      });
      await wmsApi.createPdaInspectionRecord(record);
      if (state.iqcResult === "PASS") {
        await wmsApi.postTransaction("IQC_RELEASE", {
          materialLotId, lotNo: state.lotNo, qty: state.qty, operator: state.acceptedBy,
        });
        await wmsApi.postTransaction("PUT_AWAY", {
          materialLotId, lotNo: state.lotNo, qty: state.qty, operator: state.acceptedBy,
          toLocation: state.locationCode,
        });
      }
      if (state.preReceiptQr) {
        await wmsApi.receiveSupplierPreReceipt(state.preReceiptQr, state.acceptedBy);
      }
      setFeedback({ ok: true, msg: `${state.lotNo} → ${t("status.received", locale)}` });
      publishReceivingStatus({ phase: "COMPLETED", lotNo: state.lotNo, materialCode: state.materialCode, qty: state.qty, locationCode: state.locationCode, floorAreaCode: state.floorAreaCode, iqcResult: state.iqcResult, operator: state.acceptedBy });
      setState(s => ({ ...s, step: "done" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ ok: false, msg: `${state.lotNo}: ${msg}` });
      publishReceivingStatus({ phase: "FAILED", lotNo: state.lotNo, materialCode: state.materialCode, qty: state.qty, locationCode: state.locationCode, floorAreaCode: state.floorAreaCode, iqcResult: state.iqcResult, operator: state.acceptedBy });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setState({
    step: "scan", poNo: "", lotNo: "", materialCode: "", materialName: "",
    supplierCode: "", supplierName: "", qty: 0, dateCode: "", msdLevel: "",
    rackCode: "", rackLevel: "", rackPosition: "", locationCode: "", floorAreaCode:"", floorX:"", floorZ:"", aislePermitNo:"", clearBy:"",
    notes: "", cameraPhoto: null, defectPhoto: null,
    operator: state.operator,
    materialLotId: undefined, preReceiptQr: "", workOrderCode: "", materialQr: "", palletSn: "", expiryDate: "",
    inspectionDate: new Date().toISOString().slice(0, 16),
    acceptanceDate: new Date().toISOString().slice(0, 16),
    acceptedBy: "", iqcInspector: "", nextInspectionDate: "", iqcResult: "PASS",
    sealOk: false,
    desiccantOk: false,
    humidityOk: false,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 0 }}>

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)",
        color: "white", padding: "12px 16px", display: "flex",
        alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Truck size={20} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>{t("pda.receiving", locale)}</span>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          {new Date().toLocaleDateString(locale === "zh-CN" ? "zh-CN" : locale)}
        </div>
      </div>

      <StepIndicator current={state.step} locale={locale} />

      {/* Step: Scan */}
      {state.step === "scan" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 16 }}>
          <div style={{ background: "#1e3a5f", borderRadius: 12, padding: 24, textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 12 }}>
              <ScanBarcode size={40} color="#60a5fa" />
              <span style={{ color: "#93c5fd", fontSize: 14 }}>{t("pda.scanBarcode", locale)}</span>
            </div>
            <input
              ref={scanRef}
              value={scanValue}
              onChange={e => setScanValue(e.target.value)}
              style={{
                width: "100%", padding: "14px 16px", fontSize: 18, textAlign: "center",
                border: "2px solid #3b82f6", borderRadius: 8, background: "#0f172a", color: "white", outline: "none",
              }}
              placeholder="扫描供应商预收料二维码后按 Enter"
              onKeyDown={handleScanKey}
              disabled={busy}
              autoComplete="off"
            />
            <div style={{ marginTop: 10, color: "#bfdbfe", fontSize: 13 }}>
              预收料码将关联栈板码、外箱码及其全部子码
            </div>
          </div>

          {feedback && (
            <div style={{ padding: 12, borderRadius: 8, background: feedback.ok ? "#14532d" : "#7f1d1d", color: "white", fontWeight: 600 }}>
              {feedback.msg}
            </div>
          )}

          {pendingUnregisteredQr && (
            <div style={{ background: "#422006", border: "1px solid #f59e0b", borderRadius: 12, padding: 14, display: "grid", gap: 10 }}>
              <strong style={{ color: "#fbbf24" }}>无预收料二维码：需要授权</strong>
              <div style={{ color: "#fde68a", fontSize: 13 }}>原始扫码：{pendingUnregisteredQr}</div>
              <input value={authorizationBy} onChange={e => setAuthorizationBy(e.target.value)}
                placeholder="授权人员工号" style={{ padding: 12, borderRadius: 8, border: "1px solid #92400e" }} />
              <select value={authorizationRole} onChange={e => setAuthorizationRole(e.target.value)}
                style={{ padding: 12, borderRadius: 8, border: "1px solid #92400e" }}>
                <option value="LINE_LEADER">线长</option>
                <option value="WAREHOUSE_SUPERVISOR">仓库主管</option>
                <option value="IQC_SUPERVISOR">IQC主管</option>
                <option value="MANAGEMENT">管理层</option>
              </select>
              <input value={authorizationReason} onChange={e => setAuthorizationReason(e.target.value)}
                placeholder="授权原因（必填）" style={{ padding: 12, borderRadius: 8, border: "1px solid #92400e" }} />
              <button type="button" disabled={busy} onClick={authorizeMissingPreReceipt}
                style={{ padding: 13, border: 0, borderRadius: 8, background: "#f59e0b", color: "#111827", fontWeight: 800 }}>
                授权并继续收料
              </button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <button
              style={{ padding: "16px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: "#374151", color: "white" }}
              onClick={() => { initCamera(); setState(s => ({ ...s, step: "camera" })); }}
            >
              <Camera size={28} color="#60a5fa" />
              {t("pda.cameraCapture", locale)}
            </button>
            <button
              style={{ padding: "16px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: "#374151", color: "white" }}
              onClick={() => setState(s => ({ ...s, step: "confirm" }))}
            >
              <Package size={28} color="#f59e0b" />
              {t("pda.manualEntry", locale)}
            </button>
          </div>

          <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: "auto" }}>
            {t("pda.scanHint", locale)}
          </div>
        </div>
      )}

      {/* Step: Camera */}
      {state.step === "camera" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <video ref={videoRef} autoPlay playsInline style={{ flex: 1, objectFit: "cover", background: "black" }} />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <div style={{ display: "flex", gap: 12, padding: 16, background: "#111827" }}>
            <button
              style={{ flex: 1, padding: 16, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 16, fontWeight: 700, background: "#374151", color: "white" }}
              onClick={() => { cameraStream?.getTracks().forEach(t => t.stop()); setCameraStream(null); setState(s => ({ ...s, step: "scan" })); }}
            >
              <X size={16} style={{ marginRight: 6 }} />
              {t("button.cancel", locale)}
            </button>
            <button
              style={{ flex: 2, padding: 16, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 16, fontWeight: 700, background: "#f59e0b", color: "black" }}
              onClick={capturePhoto}
            >
              <Camera size={16} style={{ marginRight: 6 }} />
              {t("pda.capturePhoto", locale)}
            </button>
          </div>
        </div>
      )}

      {/* Step: Confirm */}
      {state.step === "confirm" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 12, overflowY: "auto" }}>
          {state.cameraPhoto && (
            <div style={{ position: "relative", borderRadius: 8, overflow: "hidden" }}>
              <img src={state.cameraPhoto} alt="label" style={{ width: "100%", maxHeight: 120, objectFit: "cover" }} />
              <div style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", borderRadius: 4, padding: "2px 6px", fontSize: 11, color: "white" }}>
                📷 {t("pda.labelPhoto", locale)}
              </div>
            </div>
          )}

          {[
            { label: t("pda.poNo", locale),         value: state.poNo,           key: "poNo" },
            { label: t("pda.lotNo", locale),        value: state.lotNo,         key: "lotNo" },
            { label: t("pda.material", locale),       value: state.materialName,   key: "materialName" },
            { label: t("pda.supplier", locale),     value: state.supplierName,   key: "supplierName" },
            { label: t("pda.qty", locale),           value: String(state.qty),   key: "qty" },
            { label: t("pda.dateCode", locale),     value: state.dateCode,      key: "dateCode" },
            { label: t("pda.msdLevel", locale),     value: state.msdLevel,      key: "msdLevel" },
            { label: "货架编号 / Rack number", value: state.rackCode, key: "rackCode" },
            { label: "层号 / Rack level", value: state.rackLevel, key: "rackLevel" },
            { label: "位置号 / Position", value: state.rackPosition, key: "rackPosition" },
            { label: "完整库位 / Storage position", value: state.locationCode, key: "locationCode", readOnly: true },
            { label: "厂区/临时巷道区域 / Floor or approved aisle area", value: state.floorAreaCode, key: "floorAreaCode" },
            { label: "厂区 X 坐标 / Factory X", value: state.floorX, key: "floorX", type: "number" },
            { label: "厂区 Z 坐标 / Factory Z", value: state.floorZ, key: "floorZ", type: "number" },
            { label: "临时巷道批准编号 / Aisle permit", value: state.aislePermitNo, key: "aislePermitNo" },
            { label: "必须清除时间 / Clear by", value: state.clearBy, key: "clearBy", type: "datetime-local" },
            { label: "工单 / Work order", value: state.workOrderCode, key: "workOrderCode" },
            { label: "物料二维码 / Material QR", value: state.materialQr, key: "materialQr" },
            { label: "栈板二维码 / Pallet QR", value: state.palletSn, key: "palletSn" },
            { label: "有效期 / Expiry date", value: state.expiryDate, key: "expiryDate", type: "date" },
            { label: "检验时间 / Inspection time", value: state.inspectionDate, key: "inspectionDate", type: "datetime-local" },
            { label: "验收时间 / Acceptance time", value: state.acceptanceDate, key: "acceptanceDate", type: "datetime-local" },
            { label: "验收人 / Accepted by", value: state.acceptedBy, key: "acceptedBy" },
            { label: "IQC 检验员 / IQC inspector", value: state.iqcInspector, key: "iqcInspector" },
            { label: "下次检验日期 / Next inspection", value: state.nextInspectionDate, key: "nextInspectionDate", type: "date" },
          ].map(({ label, value, key, type, readOnly }) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <label style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>{label}</label>
              <input
                type={type || "text"}
                style={{
                  padding: "10px 12px", borderRadius: 8, border: "1px solid #374151",
                  background: "#1f2937", color: "white", fontSize: 15,
                }}
                value={value}
                readOnly={readOnly}
                onChange={e => setState(s => {
                  const inputValue=key==="floorAreaCode"?e.target.value.toUpperCase().replace(/^WMS-AREA:/,""):e.target.value;
                  const next = { ...s, [key]: inputValue };
                  if (key === "rackCode" || key === "rackLevel" || key === "rackPosition") {
                    next.locationCode = [next.rackCode, next.rackLevel, next.rackPosition]
                      .map(part => String(part).trim().toUpperCase())
                      .filter(Boolean)
                      .join("-");
                  }
                  return next;
                })}
                placeholder={label}
              />
            </div>
          ))}

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <label style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>IQC 验收结果</label>
            <select
              value={state.iqcResult}
              onChange={e => setState(s => ({ ...s, iqcResult: e.target.value as PdaReceiveState["iqcResult"] }))}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #374151", background: "#1f2937", color: "white", fontSize: 15 }}
            >
              <option value="PASS">PASS · 合格入库</option>
              <option value="HOLD">HOLD · 待判定隔离</option>
              <option value="FAIL">FAIL · 不合格拒收</option>
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <label style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase" }}>{t("pda.notes", locale)}</label>
            <textarea
              style={{ padding: 10, borderRadius: 8, border: "1px solid #374151", background: "#1f2937", color: "white", fontSize: 14, resize: "none", height: 60 }}
              value={state.notes}
              onChange={e => setState(s => ({ ...s, notes: e.target.value }))}
              placeholder={t("pda.notesPlaceholder", locale)}
            />
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: "auto" }}>
            <button
              style={{ flex: 1, padding: 14, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, background: "#374151", color: "white" }}
              onClick={() => setState(s => ({ ...s, step: state.cameraPhoto ? "confirm" : "scan" }))}
            >
              <RotateCcw size={14} style={{ marginRight: 6 }} />
              {t("button.back", locale)}
            </button>
            <button
              style={{ flex: 2, padding: 14, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, background: "#f59e0b", color: "black" }}
              onClick={() => setState(s => ({ ...s, step: "msd" }))}
            >
              <CheckCircle size={14} style={{ marginRight: 6 }} />
              {t("button.next", locale)}
            </button>
          </div>
        </div>
      )}

      {/* Step: MSD Check */}
      {state.step === "msd" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 16 }}>
          <div style={{ background: "#1e3a5f", borderRadius: 12, padding: 20, textAlign: "center" }}>
            <AlertTriangle size={36} color="#f59e0b" />
            <p style={{ color: "#93c5fd", fontSize: 14, margin: "8px 0 0" }}>
              {t("pda.msdCheckPrompt", locale)}
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { q: t("pda.sealIntact", locale), key: "sealOk" },
              { q: t("pda.desiccantBlue", locale), key: "desiccantOk" },
              { q: t("pda.humidityCardPass", locale), key: "humidityOk" },
            ].map(({ q, key }) => (
              <label key={key} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                background: "#1f2937", borderRadius: 10, cursor: "pointer", color: "white", fontSize: 15,
              }}>
                <input
                  type="checkbox"
                  onChange={e => setState(s => ({ ...s, [key]: e.target.checked }))}
                  style={{ width: 20, height: 20, accentColor: "#f59e0b" }}
                />
                {q}
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: "auto" }}>
            <button
              style={{ flex: 1, padding: 14, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, background: "#374151", color: "white" }}
              onClick={() => setState(s => ({ ...s, step: "confirm" }))}
            >
              <RotateCcw size={14} style={{ marginRight: 6 }} />
              {t("button.back", locale)}
            </button>
            <button
              style={{ flex: 2, padding: 14, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, background: "#22c55e", color: "white" }}
              onClick={handleReceive}
              disabled={busy}
            >
              {busy ? t("pda.processing", locale) : `${t("pda.confirmReceive", locale)} ✓`}
            </button>
          </div>
        </div>
      )}

      {/* Step: Done */}
      {state.step === "done" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 24 }}>
          <div style={{ background: "#22c55e", borderRadius: "50%", padding: 24 }}>
            <CheckCircle size={64} color="white" />
          </div>
          <div style={{ textAlign: "center" }}>
            <h2 style={{ color: "white", margin: 0 }}>{t("pda.receiveSuccess", locale)}</h2>
            <p style={{ color: "#9ca3af", fontSize: 14, margin: "8px 0 0" }}>{state.lotNo}</p>
            <p style={{ color: "#f59e0b", fontSize: 13, margin: "4px 0 0" }}>
              {t("pda.iqcQueueNote", locale)}
            </p>
          </div>
          <button
            style={{ padding: "14px 32px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, background: "#3b82f6", color: "white" }}
            onClick={reset}
          >
            <RotateCcw size={14} style={{ marginRight: 6 }} />
            {t("pda.nextLot", locale)}
          </button>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div style={{
          position: "fixed", bottom: 80, left: 16, right: 16,
          padding: "12px 16px", borderRadius: 10,
          background: feedback.ok ? "#22c55e" : "#ef4444",
          color: "white", fontSize: 14, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 10,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          zIndex: 100,
        }}>
          {feedback.ok ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          {feedback.msg}
        </div>
      )}
    </div>
  );
}
// @ts-nocheck
