/**
 * QmsPdaIqc — QMS侧 PDA/IQC移动端检验界面
 * 
 * P2 features:
 * - 扫码检验 + 离线暂存（localStorage + IndexedDB队列）
 * - 动态AQL（连续3批降级/2批升） + 当前AQL状态显示
 * - SPC测量数据实时录入 → 自动推送到控制图
 * - 检验完成后自动触发MES物料释放或锁定
 * - 照片拍照 → 本地压缩 → 离线队列
 * 
 * 区别于 WmsPdaIqc：WMS侧是来料登记驱动，本组件是QMS质量检验驱动。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ScanBarcode, Camera, CheckCircle, XCircle, AlertTriangle, Wifi, WifiOff,
  RefreshCw, ChevronRight, Clock, ShieldCheck, History, Settings
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  enqueueIqcInspection, getQueueCount, processQueue,
  useIqcOnlineStatus, getOnlineStatus, startAutoSync, clearQueue
} from "./iqcOfflineQueue";

interface IqcLot {
  id: number;
  lot_no: string;
  material_code: string;
  material_name: string;
  supplier_code: string;
  supplier_name: string;
  batch_size: number;
  received_qty: number;
  inspection_result?: string;
  aql_level: string;
  dynamic_aql_status: string; // NORMAL | REDUCED | TIGHTENED
  consecutive_pass: number;
  consecutive_fail: number;
}

interface MeasurementItem {
  sequence: number;
  code: string;
  name: string;
  category: string;
  lsl?: number;
  usl?: number;
  target?: number;
  measured?: number;
  result?: string;
  device_code?: string;
  device_name?: string;
}

interface DefectEntry {
  defect_type: string;
  defect_code: string;
  location: string;
  count: number;
  severity: string;
  photo?: string;
}

const DEFECT_TYPES = [
  { code: "BENT_LEAD",     label_zh: "引脚弯曲",     label_vi: "Chân cong",        label_en: "Bent Lead" },
  { code: "MISSING_COMP",  label_zh: "缺件",          label_vi: "Thiếu linh kiện",   label_en: "Missing Component" },
  { code: "TOMBSTONE",     label_zh: "墓碑现象",       label_vi: "Hiện tượng bia mộ", label_en: "Tombstone" },
  { code: "BRIDGE",        label_zh: "桥连",           label_vi: "Cầu nối",           label_en: "Bridge/Short" },
  { code: "COLD_SOLDER",  label_zh: "冷焊",           label_vi: "Hàn lạnh",          label_en: "Cold Solder" },
  { code: "CRACK",        label_zh: "裂纹",           label_vi: "Vết nứt",           label_en: "Crack" },
  { code: "OXIDATION",    label_zh: "氧化",           label_vi: "Oxy hóa",           label_en: "Oxidation" },
  { code: "CONTAMINATION",label_zh: "污染/异物",      label_vi: "Nhiễm bẩn",         label_en: "Contamination" },
  { code: "OTHER",        label_zh: "其他",           label_vi: "Khác",              label_en: "Other" },
];

const AQL_LEVELS = [
  { code: "II",   label: "Normal II",  aql_critical: 0.1, aql_major: 1.0, aql_minor: 2.5 },
  { code: "I",    label: "Reduced I",  aql_critical: 0.065, aql_major: 0.65, aql_minor: 1.5 },
  { code: "III",  label: "Tightened III", aql_critical: 0.15, aql_major: 1.5, aql_minor: 4.0 },
];

const SAMPLE_SIZES: Record<string, number> = {
  "2": 2, "5": 5, "8": 8, "13": 13, "20": 20, "32": 32, "50": 50,
  "80": 80, "125": 125, "200": 200, "315": 315, "500": 500,
};

function AqlBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const colors: Record<string, string> = { NORMAL: "#2563eb", REDUCED: "#16a34a", TIGHTENED: "#dc2626" };
  const labelKeys: Record<string, string> = { NORMAL: "qms.pda.aqlNormal", REDUCED: "qms.pda.aqlReduced", TIGHTENED: "qms.pda.aqlTightened" };
  return (
    <span style={{ background: colors[status] || "#2563eb", color: "#fff", padding: "2px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
      AQL {t(labelKeys[status]) || status}
    </span>
  );
}

function StatusBar({ online, queueCount, syncing, t }: { online: boolean; queueCount: number; syncing: boolean; t: (key: string) => string }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 50,
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "8px 16px",
      background: online ? "#16a34a" : "#dc2626",
      color: "#fff", fontSize: 13, fontWeight: 600,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {online ? <Wifi size={16} /> : <WifiOff size={16} />}
        {online ? t("qms.pda.online") : t("qms.pda.offlineMode")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {queueCount > 0 && (
          <span style={{ background: "#fbbf24", color: "#000", padding: "1px 8px", borderRadius: 10, fontSize: 12, fontWeight: 700 }}>
            {queueCount} {t("qms.pda.pendingSync")}
          </span>
        )}
        {syncing && <RefreshCw size={14} className="spin" />}
      </div>
    </div>
  );
}

function ResultBadge({ result, t }: { result: string; t: (key: string) => string }) {
  const m: Record<string, { bg: string; textKey: string }> = {
    PASS: { bg: "#16a34a", textKey: "qms.pda.passResult" },
    FAIL: { bg: "#dc2626", textKey: "qms.pda.failResult" },
    HOLD: { bg: "#f97316", textKey: "qms.pda.holdResult" },
    CONDITIONAL_PASS: { bg: "#eab308", textKey: "qms.pda.conditionalPass" },
  };
  const s = m[result] || { bg: "#64748b", textKey: result };
  return <span style={{ background: s.bg, color: "#fff", padding: "3px 12px", borderRadius: 4, fontSize: 13, fontWeight: 700 }}>{t(s.textKey)}</span>;
}

export function QmsPdaIqc() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "zh";
  const [online, setOnline] = useState(getOnlineStatus());
  const [queueCount, setQueueCount] = useState(getQueueCount());
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState<"scan" | "inspect" | "history" | "settings">("scan");
  const [lot, setLot] = useState<IqcLot | null>(null);
  const [lotInput, setLotInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [measurementItems, setMeasurementItems] = useState<MeasurementItem[]>([]);
  const [defects, setDefects] = useState<DefectEntry[]>([]);
  const [inspectionResult, setInspectionResult] = useState("");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [pendingInspections, setPendingInspections] = useState<Record<string, unknown>[]>([]);
  const [pendingIqcLots, setPendingIqcLots] = useState<IqcLot[]>([]);
  const [iqcWaitingNotice, setIqcWaitingNotice] = useState<Record<string, unknown> | null>(null);
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Online/offline listener
  useEffect(() => {
    const cleanup = useIqcOnlineStatus(setOnline);
    return cleanup;
  }, []);

  // Auto-sync
  useEffect(() => {
    startAutoSync(30000);
    return () => {};
  }, []);

  const loadIqcQueue = useCallback(async () => {
    const token = sessionStorage.getItem("auth_token") || localStorage.getItem("token") || "";
    const response = await fetch("/wms/receiving-queue?status=iqc&limit=200", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error("无法读取 IQC 待检队列");
    const body = await response.json() as { items?: IqcLot[] } | IqcLot[];
    const items = Array.isArray(body) ? body : body.items || [];
    setPendingIqcLots(items);
    return items;
  }, []);

  useEffect(() => {
    void loadIqcQueue().catch(() => setPendingIqcLots([]));
  }, [loadIqcQueue]);

  // Receiving publishes a live QMS/PDA prompt as soon as a lot enters IQC_PENDING.
  useEffect(() => {
    const stream = new EventSource("/api/pda/events?node=qms_pda_iqc&replay=1&types=WMS_IQC_MATERIAL_WAITING");
    stream.onmessage = (event) => {
      try {
        const item = JSON.parse(event.data) as { payload?: Record<string, unknown> };
        const payload = item.payload || item;
        setIqcWaitingNotice(payload);
        setView("scan");
      } catch { /* keep manual scan available */ }
    };
    return () => stream.close();
  }, []);

  // Update queue count periodically
  useEffect(() => {
    const id = setInterval(() => setQueueCount(getQueueCount()), 5000);
    return () => clearInterval(id);
  }, []);

  // Load pending from queue
  useEffect(() => {
    if (view === "history") {
      try {
        const raw = localStorage.getItem("iqc_offline_queue") || "[]";
        setPendingInspections(JSON.parse(raw));
      } catch { setPendingInspections([]); }
    }
  }, [view]);

  const lookupLot = useCallback(async (lotNo: string) => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("token");
      const resp = await fetch(`/api/wms/incoming-records?lot_no=${encodeURIComponent(lotNo)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Lot not found");
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error("Lot not found");
      const record = data[0];
      // Fetch IQC AQL status for this supplier/material
      const aqlResp = await fetch(`/api/qms/iqc/aql-status?supplier_code=${record.supplier_code}&material_code=${record.material_code}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let aqlStatus = { aql_level: "II", dynamic_aql_status: "NORMAL", consecutive_pass: 0, consecutive_fail: 0 };
      if (aqlResp.ok) {
        const aqlData = await aqlResp.json();
        if (aqlData) aqlStatus = aqlData;
      }
      setLot({
        id: record.id,
        lot_no: record.lot_no,
        material_code: record.material_code,
        material_name: record.material_name || record.material_code,
        supplier_code: record.supplier_code,
        supplier_name: record.supplier_name || record.supplier_code,
        batch_size: record.received_qty || 0,
        received_qty: record.received_qty || 0,
        inspection_result: record.iqc_status,
        ...aqlStatus,
      });
      // Load default measurement items based on material category
      loadMeasurementTemplate(record.material_code);
      setView("inspect");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMeasurementTemplate = async (materialCode: string) => {
    // Pre-populate with common measurement items for the material category
    const dimName = t("qms.pda.dim001");
    const visName = t("qms.pda.vis001");
    const pkgName = t("qms.pda.pkg001");
    const template: MeasurementItem[] = [
      { sequence: 1, code: "DIM_001", name: dimName, category: "dimension", lsl: 0, usl: 0.1, target: 0 },
      { sequence: 2, code: "VIS_001", name: visName, category: "appearance", lsl: 0, usl: 0, target: 0 },
      { sequence: 3, code: "PKG_001", name: pkgName, category: "package", lsl: 0, usl: 0, target: 0 },
    ];
    setMeasurementItems(template);
  };

  const updateMeasurement = (seq: number, field: string, value: string | number) => {
    setMeasurementItems(prev => prev.map(item =>
      item.sequence === seq ? { ...item, [field]: value } : item
    ));
  };

  const evaluateResult = useCallback(() => {
    if (!lot) return;
    const aqlConfig = AQL_LEVELS.find(a => a.code === lot.aql_level) || AQL_LEVELS[0];
    // Count defects by severity
    let criticalDefects = 0, majorDefects = 0, minorDefects = 0;
    for (const d of defects) {
      if (d.severity === "critical") criticalDefects += d.count;
      else if (d.severity === "major") majorDefects += d.count;
      else minorDefects += d.count;
    }
    // Simple AQL evaluation
    const accept = (criticalDefects === 0 && majorDefects === 0 && minorDefects === 0) ||
      (criticalDefects === 0 && majorDefects <= aqlConfig.aql_major && minorDefects <= aqlConfig.aql_minor);
    if (criticalDefects > 0) {
      setInspectionResult("FAIL");
    } else if (accept) {
      setInspectionResult("PASS");
    } else {
      setInspectionResult("HOLD");
    }
  }, [lot, defects]);

  useEffect(() => { evaluateResult(); }, [defects, evaluateResult]);

  const submitInspection = async () => {
    if (!lot || !inspectionResult) return;
    setSubmitting(true);
    const payload = {
      incoming_record_id: lot.id,
      lot_no: lot.lot_no,
      material_code: lot.material_code,
      supplier_code: lot.supplier_code,
      batch_size: lot.batch_size,
      aql_level: lot.aql_level,
      dynamic_aql_status: lot.dynamic_aql_status,
      inspection_result: inspectionResult,
      measurement_items: measurementItems,
      defects: defects.map(d => ({ ...d, photo: undefined })), // strip base64
      notes,
      inspector_id: localStorage.getItem("user_id") || "",
      inspector_name: localStorage.getItem("user_name") || "",
      factory_id: 1,
    };
    if (online) {
      try {
        const token = localStorage.getItem("token");
        const resp = await fetch("/api/qms/iqc/inspections", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (resp.ok) {
          setSubmitted(true);
          setQueueCount(getQueueCount());
        } else {
          // Fallback to offline queue
          enqueueIqcInspection(payload);
          setSubmitted(true);
          setQueueCount(getQueueCount());
        }
      } catch {
        enqueueIqcInspection(payload);
        setSubmitted(true);
        setQueueCount(getQueueCount());
      }
    } else {
      enqueueIqcInspection(payload);
      setSubmitted(true);
      setQueueCount(getQueueCount());
    }
    const nextQueue = await loadIqcQueue().catch(() => [] as IqcLot[]);
    const nextLot = nextQueue.find(item => item.lot_no !== lot.lot_no);
    if (nextLot) {
      setLotInput(nextLot.lot_no);
      await lookupLot(nextLot.lot_no);
    } else {
      setView("scan");
      setLot(null);
    }
    setSubmitting(false);
  };

  const syncNow = async () => {
    setSyncing(true);
    await processQueue();
    setQueueCount(getQueueCount());
    setSyncing(false);
  };

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (cameraRef.current) cameraRef.current.srcObject = stream;
    } catch (err) {
      alert(t("qms.pda.cameraError") + ": " + String(err));
    }
  };

  const capturePhoto = () => {
    if (!cameraRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = cameraRef.current.videoWidth;
    canvas.height = cameraRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(cameraRef.current, 0, 0);
    const url = canvas.toDataURL("image/jpeg", 0.7);
    setPhotoUrl(url);
    // Add to defects if needed
    if (defects.length > 0) {
      setDefects(prev => prev.map((d, i) => i === prev.length - 1 ? { ...d, photo: url } : d));
    }
    // Stop camera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  const addDefect = () => {
    setDefects(prev => [...prev, { defect_type: "", defect_code: "", location: "", count: 1, severity: "minor" }]);
  };

  const removeDefect = (idx: number) => {
    setDefects(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Scan View ──────────────────────────────────────────────────────────────
  if (view === "scan") {
    return (
      <div style={{ background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
        <StatusBar online={online} queueCount={queueCount} syncing={syncing} t={t} />
        <div style={{ padding: 24 }}>
          {iqcWaitingNotice && <div role="alert" style={{ background: "#7f1d1d", border: "1px solid #f87171", borderRadius: 10, padding: 14, marginBottom: 18, color: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
              <div><strong>QMS / PDA IQC 待检提示</strong><div style={{ marginTop: 6, fontSize: 13 }}>物料批次 <b>{String(iqcWaitingNotice.lotNo || "-")}</b> 已收料完成，请进行 IQC 检测。</div><div style={{ marginTop: 4, fontSize: 12, color: "#fecaca" }}>来源：{String(iqcWaitingNotice.sourceType || "PO_RECEIPT")} · 数量：{String(iqcWaitingNotice.quantity || 0)} · 状态：IQC_PENDING</div></div>
              <button onClick={() => setIqcWaitingNotice(null)} style={{ background: "transparent", border: "1px solid #fecaca", color: "#fff", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>关闭</button>
            </div>
          </div>}
          <h2 style={{ color: "#e2e8f0", fontSize: 22, marginTop: 8, marginBottom: 4 }}>{t("qms.pda.scanTitle")}</h2>
          <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24 }}>{t("qms.pda.scanHint")}</p>

          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: 14, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <strong style={{ color: "#fbbf24" }}>IQC 待检队列</strong>
              <button onClick={() => void loadIqcQueue()} style={{ background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 5, padding: "5px 9px", cursor: "pointer" }}>刷新</button>
            </div>
            {pendingIqcLots.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13 }}>当前没有待检物料</div> : <div style={{ display: "grid", gap: 8 }}>
              {pendingIqcLots.map(item => <button key={item.id} onClick={() => { setLotInput(item.lot_no); void lookupLot(item.lot_no); }} style={{ textAlign: "left", background: item.lot_no === lotInput ? "#1d4ed8" : "#0f172a", color: "#e2e8f0", border: "1px solid #475569", borderRadius: 7, padding: "9px 10px", cursor: "pointer" }}>
                <div style={{ fontWeight: 700 }}>{item.lot_no} · {item.material_code}</div><div style={{ color: "#cbd5e1", fontSize: 12, marginTop: 3 }}>数量 {item.received_qty} · 收料时间 {item.received_at ? new Date(item.received_at).toLocaleString() : "-"} · IQC_PENDING</div>
              </button>)}
            </div>}
          </div>

          <div style={{ background: "#1e293b", border: "2px dashed #334155", borderRadius: 12, padding: "40px 24px", textAlign: "center", marginBottom: 20 }}>
            <ScanBarcode size={64} color="#38bdf8" style={{ margin: "0 auto 16px" }} />
            <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 16 }}>{t("qms.pda.scanAlign")}</div>
            <input
              value={lotInput}
              onChange={e => setLotInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && lotInput && lookupLot(lotInput)}
              placeholder={t("qms.pda.inputLot")}
              style={{
                width: "100%", padding: "12px 16px", background: "#0f172a", border: "1px solid #334155",
                borderRadius: 8, color: "#e2e8f0", fontSize: 16, textAlign: "center", outline: "none",
              }}
            />
            {error && <div style={{ color: "#f87171", marginTop: 8, fontSize: 13 }}>{error}</div>}
            <button
              onClick={() => lotInput && lookupLot(lotInput)}
              disabled={!lotInput || loading}
              style={{
                marginTop: 16, width: "100%", padding: "14px", background: loading ? "#334155" : "#2563eb",
                color: "#fff", border: "none", borderRadius: 8, fontSize: 16, cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {loading ? t("qms.pda.querying") : t("qms.pda.startInspect")}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <button onClick={() => setView("history")} style={{ padding: 16, background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", cursor: "pointer", textAlign: "center" }}>
              <History size={24} style={{ margin: "0 auto 8px" }} />
              <div style={{ fontSize: 13 }}>{t("qms.pda.offlineRecords")} ({queueCount})</div>
            </button>
            <button onClick={() => setView("settings")} style={{ padding: 16, background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", cursor: "pointer", textAlign: "center" }}>
              <Settings size={24} style={{ margin: "0 auto 8px" }} />
              <div style={{ fontSize: 13 }}>{t("qms.pda.settings")}</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── History View ──────────────────────────────────────────────────────────
  if (view === "history") {
    return (
      <div style={{ background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
        <StatusBar online={online} queueCount={queueCount} syncing={syncing} t={t} />
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ color: "#e2e8f0", fontSize: 18, margin: 0 }}>{t("qms.pda.offlineRecords")}</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={syncNow} disabled={!online || syncing} style={{ padding: "6px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: online ? "pointer" : "not-allowed", opacity: online ? 1 : 0.5 }}>
                {syncing ? t("qms.pda.syncing") : t("qms.pda.syncNow")}
              </button>
              <button onClick={() => setView("scan")} style={{ padding: "6px 16px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>{t("qms.pda.back")}</button>
            </div>
          </div>
          {pendingInspections.length === 0 ? (
            <div style={{ color: "#475569", textAlign: "center", padding: 40 }}>{t("qms.pda.noPendingRecords")}</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {pendingInspections.map(item => (
                <div key={item.id as string} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "12px 16px" }}>
                  <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{item.lot_no as string}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>{item.material_code as string} | {t("qms.pda.inspectionResult")}: {item.inspection_result as string}</div>
                  <div style={{ color: "#475569", fontSize: 11 }}>{t("common.created", locale)}: {item.createdAt as string}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Settings View ──────────────────────────────────────────────────────────
  if (view === "settings") {
    return (
      <div style={{ background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
        <StatusBar online={online} queueCount={queueCount} syncing={syncing} t={t} />
        <div style={{ padding: 16 }}>
          <h2 style={{ fontSize: 18, marginBottom: 16 }}>{t("qms.pda.settings")}</h2>
          <div style={{ background: "#1e293b", borderRadius: 8, padding: 16, marginBottom: 12 }}>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>{t("qms.pda.offlineQueueStatus")}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: queueCount > 0 ? "#fbbf24" : "#34d399", fontSize: 24, fontWeight: 700 }}>{queueCount}</span>
              <span style={{ color: "#64748b", fontSize: 13 }}>{t("qms.pda.recordsPending")}</span>
            </div>
          </div>
          <button onClick={clearQueue} style={{ width: "100%", padding: 12, background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>{t("qms.pda.clearQueue")}</button>
          <button onClick={() => setView("scan")} style={{ width: "100%", padding: 12, marginTop: 8, background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8, cursor: "pointer" }}>{t("qms.pda.back")}</button>
        </div>
      </div>
    );
  }

  // ── Inspect View ───────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div style={{ background: "#0f172a", minHeight: "100vh", color: "#e2e8f0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
        <div style={{ background: inspectionResult === "PASS" ? "#16a34a" : "#dc2626", width: 80, height: 80, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
          {inspectionResult === "PASS" ? <CheckCircle size={40} color="#fff" /> : <XCircle size={40} color="#fff" />}
        </div>
        <h2 style={{ fontSize: 24, color: "#e2e8f0", marginBottom: 8 }}>{inspectionResult === "PASS" ? t("qms.pda.inspectPassed") : t("qms.pda.inspectComplete")}</h2>
        <p style={{ color: "#64748b", marginBottom: 24 }}>
          {!online ? t("qms.pda.storedLocally") : t("qms.pda.submittedServer")}
        </p>
        <button onClick={() => { setSubmitted(false); setView("scan"); setLot(null); setDefects([]); setMeasurementItems([]); setNotes(""); setPhotoUrl(null); }}
          style={{ padding: "12px 32px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 16 }}>
          {t("qms.pda.continueScan")}
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
      <StatusBar online={online} queueCount={queueCount} syncing={syncing} t={t} />

      {/* Header */}
      <div style={{ padding: "12px 16px", background: "#1e293b", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={() => setView("scan")} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 20 }}>←</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 16 }}>{lot?.lot_no}</div>
          <div style={{ color: "#64748b", fontSize: 11 }}>{lot?.material_code} | {lot?.supplier_name}</div>
        </div>
        <button onClick={submitInspection} disabled={!inspectionResult || submitting}
          style={{ padding: "6px 16px", background: inspectionResult ? "#16a34a" : "#334155", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: inspectionResult ? "pointer" : "not-allowed" }}>
          {submitting ? t("qms.pda.submitting") : t("qms.pda.submit")}
        </button>
      </div>

      {/* Lot Info */}
      {lot && (
        <div style={{ padding: "8px 16px", background: "#0f172a", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid #1e293b" }}>
          <AqlBadge status={lot.dynamic_aql_status} t={t} />
          <span style={{ color: "#64748b", fontSize: 12 }}>{t("qms.pda.aqlLevel")}: {lot.aql_level}</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>|</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>{t("qms.pda.batchSize")}: {lot.batch_size}</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>|</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>{t("qms.pda.supplier")}: {lot.supplier_name}</span>
          <span style={{ color: "#64748b", fontSize: 12 }}>|</span>
          <span style={{ color: inspectionResult === "PASS" ? "#34d399" : inspectionResult === "FAIL" ? "#f87171" : "#fbbf24", fontSize: 13, fontWeight: 700 }}>
            {inspectionResult === "PASS" ? t("qms.pda.passResult") : inspectionResult === "FAIL" ? t("qms.pda.failResult") : inspectionResult === "HOLD" ? t("qms.pda.holdResult") : t("qms.pda.evaluating")}
          </span>
        </div>
      )}

      <div style={{ padding: 16 }}>
        {/* Camera */}
        <div style={{ background: "#1e293b", borderRadius: 8, marginBottom: 16, overflow: "hidden" }}>
          <video ref={cameraRef} style={{ width: "100%", maxHeight: 200, display: photoUrl ? "none" : "block", background: "#000" }} autoPlay playsInline />
          {photoUrl && <img src={photoUrl} style={{ width: "100%", maxHeight: 200, objectFit: "cover" }} alt="Captured" />}
          <div style={{ padding: "8px 12px", display: "flex", gap: 8 }}>
            {!streamRef.current && !photoUrl && (
              <button onClick={openCamera} style={{ flex: 1, padding: 8, background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Camera size={16} /> {t("qms.pda.takePhoto")}
              </button>
            )}
            {streamRef.current && (
              <button onClick={capturePhoto} style={{ flex: 1, padding: 8, background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>{t("qms.pda.capture")}</button>
            )}
            {photoUrl && <button onClick={() => setPhotoUrl(null)} style={{ flex: 1, padding: 8, background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>{t("qms.pda.clear")}</button>}
          </div>
        </div>

        {/* Measurement Items */}
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <h3 style={{ color: "#38bdf8", margin: "0 0 12px", fontSize: 14 }}>{t("qms.pda.measurementItems")}</h3>
          {measurementItems.map(item => (
            <div key={item.sequence} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 12px", marginBottom: 8 }}>
              <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>{item.code} — {item.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                <input type="number" placeholder={`LSL`} value={item.lsl ?? ""} onChange={e => updateMeasurement(item.sequence, "lsl", Number(e.target.value))}
                  style={{ padding: "6px 8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 13, width: "100%" }} />
                <input type="number" placeholder={t("qms.pda.measuredValue")} value={item.measured ?? ""} onChange={e => {
                  const v = Number(e.target.value);
                  updateMeasurement(item.sequence, "measured", v);
                  const res = (item.lsl !== undefined && item.usl !== undefined) ? (v >= item.lsl && v <= item.usl ? "PASS" : "FAIL") : "PASS";
                  updateMeasurement(item.sequence, "result", res);
                }}
                  style={{ padding: "6px 8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 13, width: "100%" }} />
                <input type="number" placeholder={`USL`} value={item.usl ?? ""} onChange={e => updateMeasurement(item.sequence, "usl", Number(e.target.value))}
                  style={{ padding: "6px 8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 13, width: "100%" }} />
              </div>
              {item.result && (
                <div style={{ textAlign: "right", marginTop: 4 }}>
                  <span style={{ background: item.result === "PASS" ? "#16a34a" : "#dc2626", color: "#fff", padding: "1px 8px", borderRadius: 3, fontSize: 11, fontWeight: 600 }}>{item.result}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Defects */}
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ color: "#f87171", margin: 0, fontSize: 14 }}>{t("qms.pda.defectRecords")} {defects.length > 0 && `(${defects.length})`}</h3>
            <button onClick={addDefect} style={{ padding: "4px 12px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>+ {t("qms.pda.addDefect")}</button>
          </div>
          {defects.map((d, idx) => (
            <div key={idx} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 12px", marginBottom: 8, borderLeft: "3px solid #f87171" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                <select value={d.defect_code} onChange={e => setDefects(prev => prev.map((x, i) => i === idx ? { ...x, defect_code: e.target.value, defect_type: e.target.options[e.target.selectedIndex].text } : x))}
                  style={{ flex: 1, padding: "4px 8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, minWidth: 100 }}>
                  <option value="">{t("qms.pda.defectType")}</option>
                  {DEFECT_TYPES.map(dt => <option key={dt.code} value={dt.code}>{dt.label_zh}</option>)}
                </select>
                <select value={d.severity} onChange={e => setDefects(prev => prev.map((x, i) => i === idx ? { ...x, severity: e.target.value } : x))}
                  style={{ padding: "4px 8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: d.severity === "critical" ? "#dc2626" : d.severity === "major" ? "#f97316" : "#fbbf24", fontSize: 12 }}>
                  <option value="minor">{t("qms.pda.minor")}</option>
                  <option value="major">{t("qms.pda.major")}</option>
                  <option value="critical">{t("qms.pda.critical")}</option>
                </select>
                <input type="number" min={1} value={d.count} onChange={e => setDefects(prev => prev.map((x, i) => i === idx ? { ...x, count: Number(e.target.value) } : x))}
                  style={{ width: 60, padding: "4px 8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12 }} />
                <button onClick={() => removeDefect(idx)} style={{ padding: "4px 8px", background: "none", color: "#f87171", border: "1px solid #f87171", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>×</button>
              </div>
              <input type="text" placeholder={t("qms.pda.defectLocation")} value={d.location} onChange={e => setDefects(prev => prev.map((x, i) => i === idx ? { ...x, location: e.target.value } : x))}
                style={{ width: "100%", padding: "4px 8px", background: "#1e293b", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0", fontSize: 12, boxSizing: "border-box" }} />
              {d.photo && <img src={d.photo} style={{ width: "100%", maxHeight: 100, objectFit: "cover", borderRadius: 4, marginTop: 4 }} alt="Defect" />}
            </div>
          ))}
          {defects.length === 0 && (
            <div style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: "12px 0" }}>{t("qms.pda.noDefectRecords")}</div>
          )}
        </div>

        {/* Notes */}
        <div style={{ background: "#1e293b", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <h3 style={{ color: "#94a3b8", margin: "0 0 8px", fontSize: 14 }}>{t("qms.pda.notes")}</h3>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder={t("qms.pda.notesPlaceholder")}
            style={{ width: "100%", padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 14, resize: "vertical", boxSizing: "border-box" }} />
        </div>
      </div>
    </div>
  );
}
