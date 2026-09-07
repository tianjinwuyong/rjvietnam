import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ClipboardCheck, CheckCircle, XCircle, AlertTriangle, Search,
  Plus, X, Camera, Clock, FileText, ChevronDown
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api/wms";
import { apiClient } from "../api/client";
import { IqcEmployeeCommunication } from "./IqcEmployeeCommunication";

interface IncomingRecord {
  id: number; lot_no: string; material_code: string; material_name: string;
  supplier_code: string; supplier_name: string; received_qty: number;
  uom_code: string; received_at: string; packaging_status: string;
  msd_level: string; iqc_status: string;
}

interface IqcInspection {
  id: number; incoming_record_id: number; lot_no: string; material_code: string;
  supplier_code: string; batch_size: number; sample_size: number; aql_level: string;
  inspector_id: string; inspection_types: string[]; result: string;
  submitted_at: string; completed_at: string; defects: IqcDefect[];
  ac_critical?: number; re_critical?: number; ac_major?: number; re_major?: number;
  ac_minor?: number; re_minor?: number;
}
interface IqcDefect {
  id: number; defect_type: string; defect_location: string;
  defect_count: number; severity: string; photo_url: string;
}
interface IqcAqlRule {
  id: number; material_category: string; supplier_grade: string;
  aql_critical: number; aql_major: number; aql_minor: number;
}

const IQC_DEMO_INSPECTIONS: IqcInspection[] = [
  { id: -3001, incoming_record_id: -1001, lot_no: "TEST-PO-20260827-01", material_code: "SMT-R-10K-0603", supplier_code: "TEST-SUPPLIER", batch_size: 5000, sample_size: 40, aql_level: "II", inspector_id: "IQC_TESTER", inspection_types: ["identity", "quantity", "packaging", "label", "visual", "dimension", "electrical", "solderability", "msd", "esd", "documentation", "risk", "functional"], result: "pending", submitted_at: "2026-08-28T08:30:00+07:00", completed_at: "", defects: [] },
  { id: -3002, incoming_record_id: -1002, lot_no: "TEST-PO-20260827-02", material_code: "SMT-C-100N-0402", supplier_code: "TEST-SUPPLIER", batch_size: 12000, sample_size: 80, aql_level: "II", inspector_id: "IQC_TESTER", inspection_types: ["identity", "quantity", "packaging", "label", "visual", "dimension", "electrical", "solderability", "msd", "esd", "documentation", "risk", "functional"], result: "pass", submitted_at: "2026-08-27T10:00:00+07:00", completed_at: "2026-08-27T10:20:00+07:00", defects: [] },
  { id: -3003, incoming_record_id: -1003, lot_no: "TEST-PO-20260827-03", material_code: "SMT-LED-GRN-0805", supplier_code: "TEST-SUPPLIER", batch_size: 3000, sample_size: 50, aql_level: "II", inspector_id: "IQC_TESTER", inspection_types: ["identity", "quantity", "packaging", "label", "visual", "dimension", "electrical", "solderability", "msd", "esd", "documentation", "risk", "functional"], result: "fail", submitted_at: "2026-08-27T09:00:00+07:00", completed_at: "2026-08-27T09:15:00+07:00", defects: [{ id: -301, defect_type: "OXIDATION", defect_location: "焊端", defect_count: 2, severity: "major", photo_url: "" }] },
];

const IQC_ROLE_PAGE_LINKS = [["IQC检验", "iqc"], ["IQC复检", "iqcReinspection"], ["IQC报表", "iqcReport"], ["PDA检验历史", "pdaHistory"], ["PDA收料", "pdaReceiving"], ["PDA盘点", "pdaCycleCount"], ["PDA物料消耗", "pdaConsumption"], ["MSD管控", "pdaMsd"], ["PDA设备中心", "syncHealth"]] as const;

interface IqcQueueRecord {
  id: number; lot_no: string; material_code: string; material_name?: string; material_qr?: string;
  pallet_qr?: string; source_type?: string; warehouse_code?: string; location_code?: string;
  quantity?: number; uom?: string; status?: string; received_at?: string; waiting_minutes?: number;
  receiving_pda_id?: string;
}

const PDA_IQC_SYNC_KEY = "wms_iqc_pda_sync_records";

const IQC_PO_DEMO_MATERIALS: IqcQueueRecord[] = [
  { id: -1001, lot_no: "TEST-PO-20260827-01", material_code: "SMT-R-10K-0603", material_name: "Chip Resistor 10KΩ 0603", material_qr: "TEST-QR-R0603-001", pallet_qr: "TEST-PALLET-001", source_type: "PO_RECEIPT", quantity: 5000, uom: "PCS", warehouse_code: "IQC_HOLD", location_code: "IQC-A01-01", received_at: "2026-08-27T08:20:00+07:00", waiting_minutes: 38, status: "IQC_PENDING" },
  { id: -1002, lot_no: "TEST-PO-20260827-02", material_code: "SMT-C-100N-0402", material_name: "MLCC Capacitor 100nF 0402", material_qr: "TEST-QR-C0402-002", pallet_qr: "TEST-PALLET-002", source_type: "PO_RECEIPT", quantity: 12000, uom: "PCS", warehouse_code: "IQC_HOLD", location_code: "IQC-A01-02", received_at: "2026-08-27T07:45:00+07:00", waiting_minutes: 73, status: "IQC_PENDING" },
  { id: -1003, lot_no: "TEST-PO-20260827-03", material_code: "SMT-LED-GRN-0805", material_name: "Green LED 0805", material_qr: "TEST-QR-LED0805-003", pallet_qr: "TEST-PALLET-003", source_type: "PO_RECEIPT", quantity: 3000, uom: "PCS", warehouse_code: "IQC_HOLD", location_code: "IQC-A01-03", received_at: "2026-08-27T06:10:00+07:00", waiting_minutes: 168, status: "IQC_PENDING" },
];

// SMT incoming-IQC checklist. Selected items are stored on each inspection.
const SMT_IQC_ITEMS = [
  ["identity", "物料身份/BOM", "料号、制造商、规格、版本、替代料与采购单一致"],
  ["quantity", "数量/批次", "包装数量、批次号、日期码、卷数与单据一致"],
  ["packaging", "包装完整性", "外箱、内袋、载带/卷盘无破损、污染、受潮或混料"],
  ["label", "标签/追溯", "标签、条码、原厂标识、原产地、批次清晰可追溯"],
  ["visual", "外观/标识", "本体、引脚、焊端、丝印无裂纹、氧化、变形、缺件"],
  ["dimension", "尺寸/机械规格", "长宽高、引脚间距、厚度、载带孔距符合图纸"],
  ["electrical", "电气参数", "阻值、电容、ESR、耐压、漏电或功能参数符合规格"],
  ["solderability", "可焊性", "必要时记录润湿/焊接端可焊性验证方法与结果"],
  ["msd", "MSD湿敏控制", "MSL、HIC、干燥剂、真空袋、开封时间、Floor Life、烘烤"],
  ["esd", "ESD防护", "防静电包装、标识、接地与敏感器件处理条件符合要求"],
  ["documentation", "文件/合规", "COA、检验报告、RoHS/REACH及客户特殊要求"],
  ["risk", "风险升级", "可疑标签、假料、重大缺陷触发隔离、8D或实验室验证"],
] as const;

function guidedSampleSize(batchSize: number, rows: unknown[][]): number | null {
  for (const row of rows) {
    const range = row.map(cell => String(cell ?? "")).find(text => /\d+\s*[~～]\s*\d+/.test(text));
    if (!range) continue;
    const match = range.match(/(\d+)\s*[~～]\s*(\d+)/);
    if (!match) continue;
    const min = Number(match[1]); const max = Number(match[2]);
    if (batchSize >= min && batchSize <= max) {
      const preferred = Number(String(row[3] ?? "").replace(/[^0-9.]/g, ""));
      const candidates = [preferred, ...row.slice(2).map(cell => Number(String(cell ?? "").replace(/[^0-9.]/g, "")))].filter(Number.isFinite).filter(value => value > 0);
      return candidates.length ? candidates[0] : null;
    }
  }
  return null;
}

async function readDamagePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  if (file.size > 12 * 1024 * 1024) throw new Error("图片不能超过 12 MB");
  const source = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file); });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = () => reject(new Error("图片格式无效")); value.src = source; });
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

type View = "pending" | "submitted" | "history";

const f = (key: string, locale: Locale) => t("wms.iqc." + key, locale);

function IqcInspectionDiagram({ locale }: { locale: Locale }) {
  const en = locale === "en-US";
  const label = (zh: string, english: string) => en ? english : zh;
  const node = (x: number, y: number, w: number, title: string, sub: string, fill = "#ffffff", stroke = "#2563eb") => <g key={`${x}-${y}-${title}`}><rect x={x} y={y} width={w} height="58" rx="10" fill={fill} stroke={stroke} strokeWidth="2"/><text x={x + w / 2} y={y + 24} textAnchor="middle" fontSize="14" fontWeight="700" fill="#0f172a">{title}</text><text x={x + w / 2} y={y + 44} textAnchor="middle" fontSize="10" fill="#475569">{sub}</text></g>;
  const arrow = (x1: number, y1: number, x2: number, y2: number, color = "#64748b") => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="2.5" markerEnd="url(#iqc-arrow)"/>;
  return <section style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 20 }}>
    <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{label("IQC 检验项目与判定流程", "IQC inspection aspects and decision flow")}</div>
    <svg viewBox="0 0 1120 250" role="img" aria-label="IQC inspection flow" style={{ width: "100%", minWidth: 780, height: "auto" }}>
      <defs><marker id="iqc-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b" /></marker></defs>
      {arrow(150, 50, 190, 50)}{arrow(330, 50, 370, 50)}{arrow(510, 50, 550, 50)}{arrow(690, 50, 730, 50)}{arrow(870, 50, 910, 50)}
      {arrow(1000, 78, 1000, 130, "#16a34a")}{arrow(940, 164, 800, 164, "#16a34a")}{arrow(940, 192, 800, 220, "#dc2626")}
      {node(10, 21, 140, label("收料/QR绑定", "Receive / QR bind"), label("待检仓", "IQC warehouse"), "#dbeafe")}
      {node(190, 21, 140, label("抽样计划", "Sampling plan"), label("批量 / AQL", "Lot / AQL"), "#ffffff")}
      {node(370, 21, 140, label("检验项目", "Test setup"), label("选择检验类型", "Select tests"), "#ffffff")}
      {node(550, 21, 140, label("样品检验", "Sample test"), label("逐项记录结果", "Record each item"), "#ffffff")}
      {node(730, 21, 140, label("缺陷记录", "Defect record"), label("代码 / 数量 / 图片", "Code / qty / photo"), "#fef3c7", "#d97706")}
      {node(910, 21, 180, label("IQC判定", "IQC decision"), label("PASS / FAIL / 特采", "PASS / FAIL / special"), "#ede9fe", "#7c3aed")}
      {node(620, 136, 180, label("良品仓库", "Good stock"), label("解除QR / 建立有效期", "Release QR / shelf life"), "#dcfce7", "#16a34a")}
      {node(620, 192, 180, label("不良品仓库 → MRB", "Defect stock → MRB"), label("建档 / 移除栈板 / 评审", "Archive / pallet removal / review"), "#fee2e2", "#dc2626")}
      <g><rect x="890" y="124" width="200" height="98" rx="10" fill="#fff" stroke="#94a3b8"/><text x="990" y="146" textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">{label("必检项目", "Required test aspects")}</text><text x="905" y="166" fontSize="10" fill="#475569">• {label("外观 / 包装", "Visual / packaging")}</text><text x="905" y="182" fontSize="10" fill="#475569">• {label("尺寸 / 规格", "Dimension / spec")}</text><text x="905" y="198" fontSize="10" fill="#475569">• MSD / {label("寿命", "floor life")}</text><text x="905" y="214" fontSize="10" fill="#475569">• {label("功能 / 电性", "Functional / electrical")}</text></g>
      <text x="1010" y="112" textAnchor="middle" fontSize="10" fill="#16a34a">PASS</text><text x="850" y="184" textAnchor="middle" fontSize="10" fill="#dc2626">FAIL</text>
    </svg>
  </section>;
}

function resultBadge(r: string, locale: Locale) {
  const m: Record<string, { bg: string; text: string; icon: any }> = {
    pass:      { bg: "#d1fae5", text: "#065f46", icon: CheckCircle },
    fail:      { bg: "#fee2e2", text: "#991b1b", icon: XCircle },
    conditional_pass: { bg: "#fef3c7", text: "#92400e", icon: AlertTriangle },
    pending:   { bg: "#f3f4f6", text: "#374151", icon: Clock },
  };
  const s = m[r] || m.pending;
  const Icon = s.icon;
  const labels: Record<string, string> = {
    pass: locale === "vi-VN" ? "Dat" : locale === "en-US" ? "Pass" : "合格",
    fail: locale === "vi-VN" ? "Khong dat" : locale === "en-US" ? "Fail" : "不合格",
    conditional_pass: locale === "vi-VN" ? "Dac biet" : locale === "en-US" ? "Conditional" : "特采",
    pending: locale === "vi-VN" ? "Cho" : locale === "en-US" ? "Pending" : "待检",
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: s.bg, color: s.text, padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
      <Icon size={12} /> {labels[r] || r}
    </span>
  );
}

export function WmsIqc({ locale }: { locale: Locale }) {
  const [view, setView] = useState<View>("pending");
  const [pending, setPending] = useState<IncomingRecord[]>([]);
  const [iqcQueue, setIqcQueue] = useState<IqcQueueRecord[]>([]);
  const [submitted, setSubmitted] = useState<IqcInspection[]>([]);
  const [history, setHistory] = useState<IqcInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IncomingRecord | IqcInspection | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showJudgeModal, setShowJudgeModal] = useState<IqcInspection | null>(null);
  const [rules, setRules] = useState<IqcAqlRule[]>([]);
  const [defects, setDefects] = useState<IqcDefect[]>([]);
  const [submitForm, setSubmitForm] = useState({ batch_size: "", inspector_id: "", inspection_types: [] as string[] });
  const [judgeForm, setJudgeForm] = useState({ defect_type: "", defect_location: "", defect_count: "1", severity: "major", photo_url: "" });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [activePda, setActivePda] = useState<any>({ device_id: "PDA-IQC-01", operator_name: "IQC测试员", status: "IDLE" });
  const [workingDeviceCount, setWorkingDeviceCount] = useState(1);
  const [iqcGuidance, setIqcGuidance] = useState<any>(null);
  useEffect(() => { if (showSubmitModal && selected && iqcGuidance) { const qty = Number((selected as any).received_qty || (selected as any).quantity || 0); if (qty > 0) setSubmitForm(form => ({ ...form, batch_size: String(qty), inspection_types: ["identity", "quantity", "packaging", "label", "visual", "dimension", "msd", "documentation"] })); } }, [showSubmitModal, selected, iqcGuidance]);
  const [virtualStatus, setVirtualStatus] = useState("IDLE");
  const [virtualPlan, setVirtualPlan] = useState<any>(null);
  // IQC-VIRTUAL-01 starts in watch mode when the WMS IQC page opens. The
  // employee only plans and flags work; deterministic IQC rules and human
  // gates still control release, MRB, and approval decisions.
  const [virtualWatching, setVirtualWatching] = useState(true);
  const [virtualAnswer, setVirtualAnswer] = useState("");
  const [virtualDropContext, setVirtualDropContext] = useState("");
  const [virtualChatOpen, setVirtualChatOpen] = useState(false);
  const [virtualChatInput, setVirtualChatInput] = useState("");
  const [virtualChatMessages, setVirtualChatMessages] = useState<{ role: string; text: string }[]>([]);
  const [virtualChannelsOpen, setVirtualChannelsOpen] = useState(false);
  const [virtualCronTask, setVirtualCronTask] = useState("每15分钟监控IQC待检表，读取新ACTIVE Excel版本，检查超时批次和缺少真实检验结果，并创建提醒任务；禁止自动放行。");
  const [virtualCronInterval, setVirtualCronInterval] = useState("15");
  const [virtualCronPriority, setVirtualCronPriority] = useState("HIGH");
  const [virtualCronStatus, setVirtualCronStatus] = useState("");
  const [simulationBatch, setSimulationBatch] = useState("");
  const [simulationResults, setSimulationResults] = useState("");
  const activeInspectionItems: ReadonlyArray<readonly [string, string, string]> = iqcGuidance?.inspectionItems?.length
    ? iqcGuidance.inspectionItems.map((item: string, index: number) => [`excel_${index}`, item, "来自导入的 IQC 指导文件"] as const)
    : [];

  useEffect(() => {
    let disposed = false;
    void apiClient.get<any>("/qms/iqc/guidance-documents").then(async (response: any) => {
      if (disposed) return;
      const active = (response.items ?? response ?? []).find((doc: any) => doc.status === "ACTIVE");
      const guidance = active?.workbook ? { ...active.workbook, fileName: `${active.file_name} (${active.version_no})` } : null;
      setIqcGuidance(guidance);
      if (guidance) {
        setVirtualStatus("LEARNING_EXCEL");
        try {
          await apiClient.post("/qms/iqc/virtual-employee/learn-guidance", {
            guidanceKey: "SMT_IQC",
            materialCode: "",
            guidance,
          });
          setVirtualStatus("WATCHING");
        } catch {
          setVirtualStatus("GUIDANCE_ERROR");
        }
      } else {
        setVirtualStatus("GUIDANCE_REQUIRED");
      }
    }).catch(() => { if (!disposed) setIqcGuidance(null); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const sync = () => {
      try {
        const rows = JSON.parse(localStorage.getItem(PDA_IQC_SYNC_KEY) || "[]");
        const current = Array.isArray(rows) ? rows.find((row: any) => row.status === "INSPECTING") || rows[0] : null;
        if (current) setActivePda(current);
      } catch { /* offline PDA */ }
    };
    sync();
    window.addEventListener("wms-iqc-pda-sync", sync);
    return () => window.removeEventListener("wms-iqc-pda-sync", sync);
  }, []);

  useEffect(() => {
    let disposed = false;
    const refreshSitePdas = async () => {
      const response = await wmsApi.getPdaInspectionRecords({ recordType: "IQC", limit: 100 });
      if (disposed || !response?.items?.length) return;
      const rows = response.items as any[];
      const latest = rows.slice().sort((a, b) => String(b.recorded_at || b.created_at || "").localeCompare(String(a.recorded_at || a.created_at || "")))[0];
      const deviceIds = new Set(rows.map(row => String(row.device_id || row.device_info || "").split("|")[0].trim()).filter(Boolean));
      setWorkingDeviceCount(Math.max(1, Math.min(5, deviceIds.size)));
      if (latest) {
        const device = String(latest.device_id || latest.device_info || "PDA-IQC-01").split("|")[0].trim();
        setActivePda({ ...latest, device_id: device, operator_name: latest.operator_name || latest.operator || latest.inspector || "IQC测试员", status: latest.decision ? "COMPLETED" : "INSPECTING" });
      }
    };
    void refreshSitePdas();
    const timer = window.setInterval(() => { void refreshSitePdas(); }, 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    // The receiving-to-IQC queue must remain visible even if an older IQC
    // management endpoint is unavailable.
    (typeof wmsApi.getIqcWaitingQueue === "function" ? wmsApi.getIqcWaitingQueue() : Promise.resolve({ items: [], total: 0 }))
      .then((q: { items: IqcQueueRecord[]; total: number }) => {
        const realItems = (q.items || []).filter((item: IqcQueueRecord) => ["IQC_PENDING", "CREATED"].includes(String(item.status)));
        setIqcQueue(realItems.length ? realItems : IQC_PO_DEMO_MATERIALS);
      })
      .catch((e: unknown) => {
        console.error("IQC receiving queue failed", e);
        setIqcQueue(IQC_PO_DEMO_MATERIALS);
      });
    try {
      const [p, inspections, r] = await Promise.all([
        wmsApi.getIncomingRecords({ iqc_status: "pending", limit: 200 }),
        wmsApi.getIqcInspections({ limit: 200 }),
        wmsApi.getIqcRules(),
      ]);
      setPending(p.items || []);
      const inspectionRows: IqcInspection[] = inspections.items || [];
      const pendingInspections = inspectionRows.filter(row => String(row.result).toLowerCase() === "pending");
      const completedInspections = inspectionRows.filter(row => String(row.result).toLowerCase() !== "pending");
      setSubmitted(pendingInspections.length ? pendingInspections : IQC_DEMO_INSPECTIONS.filter(row => row.result === "pending"));
      setHistory(completedInspections.length ? completedInspections : IQC_DEMO_INSPECTIONS.filter(row => row.result !== "pending"));
      setRules(r || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const pendingCount = pending.length;
  const submittedCount = submitted.length;
  const historyCount = history.length;
  const visibleIqcQueue = iqcQueue.length ? iqcQueue : IQC_PO_DEMO_MATERIALS;
  const runVirtualEmployee = async () => {
    const item = visibleIqcQueue[0]; if (!item || !iqcGuidance) return;
    setVirtualStatus("RUNNING");
    try { await apiClient.post("/qms/iqc/virtual-employee/learn-guidance", { guidanceKey: "SMT_IQC", materialCode: item.material_code }); const result: any = await apiClient.post("/qms/iqc/virtual-employee/plan", { lotNo: item.lot_no, materialCode: item.material_code, batchSize: item.quantity, guidance: iqcGuidance }); setVirtualPlan(result.item ?? result); setVirtualStatus(virtualWatching ? "WATCHING" : "WAITING_REAL_DATA"); }
    catch (e) { setVirtualStatus("ERROR"); setFeedback({ ok: false, msg: e instanceof Error ? e.message : String(e) }); }
  };
  const teachVirtualEmployee = async () => {
    if (!iqcGuidance) return;
    setVirtualStatus("LEARNING_EXCEL");
    try { await apiClient.post("/qms/iqc/virtual-employee/learn-guidance", { guidanceKey: "SMT_IQC", materialCode: visibleIqcQueue[0]?.material_code }); setVirtualStatus(virtualWatching ? "WATCHING" : "READY"); setFeedback({ ok: true, msg: "IQC员工已读取当前ACTIVE Excel并保存来源记忆" }); }
    catch (e) { setVirtualStatus("ERROR"); setFeedback({ ok: false, msg: e instanceof Error ? e.message : String(e) }); }
  };
  const dropVirtualEmployee = async (event: React.DragEvent<HTMLDivElement>) => {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("section, tr, [data-iqc-region]") as HTMLElement | null;
    const context = (target?.innerText || document.elementFromPoint(event.clientX, event.clientY)?.textContent || "").trim().slice(0, 6000);
    if (!context || !iqcGuidance) return;
    setVirtualDropContext(context); setVirtualAnswer("正在读取放置区域并分析…");
    try { const result: any = await apiClient.post("/qms/iqc/virtual-employee/advice", { guidance: iqcGuidance, pageContext: context, lotNo: visibleIqcQueue[0]?.lot_no, materialCode: visibleIqcQueue[0]?.material_code, realResults: [] }); const output = result.item?.output || result.output || {}; setVirtualAnswer(typeof output === "string" ? output : output.summary || JSON.stringify(output)); }
    catch (e) { setVirtualAnswer(e instanceof Error ? e.message : String(e)); }
  };
  const sendVirtualChat = async () => {
    const question = virtualChatInput.trim(); if (!question) return;
    if (question.toLowerCase().startsWith("/task ")) { await assignVirtualTask(question.slice(6)); return; }
    setVirtualChatMessages(messages => [...messages, { role: "user", text: question }, { role: "assistant", text: "已收到指令。我正在读取当前页面、ACTIVE IQC Excel 和批次数据…" }]); setVirtualChatInput("");
    if (!iqcGuidance) {
      setVirtualChatMessages(messages => [...messages, { role: "assistant", text: "当前没有 ACTIVE Excel 指导文件。请先在“指导版本与检验等级”页面导入并设为当前使用，然后我才能按正式规则回答和执行。" }]);
      return;
    }
    try { const request = apiClient.post("/qms/iqc/virtual-employee/advice", { guidance: iqcGuidance, pageContext: document.body.innerText.slice(0, 6000), question, lotNo: visibleIqcQueue[0]?.lot_no, materialCode: visibleIqcQueue[0]?.material_code, realResults: [] }); const result: any = await Promise.race([request, new Promise((_, reject) => window.setTimeout(() => reject(new Error("IQC-VIRTUAL-01：模型响应超时。请检查 Ollama；系统未生成检验结果。")), 65_000))]); const output = result.item?.output || result.output || result.data?.output || {}; const answer = typeof output === "string" ? output : output.summary || output.nextAction || JSON.stringify(output); setVirtualChatMessages(messages => [...messages, { role: "assistant", text: answer }]); }
    catch (e) { setVirtualChatMessages(messages => [...messages, { role: "assistant", text: e instanceof Error ? e.message : String(e) }]); }
  };
  const assignVirtualTask = async (input = virtualChatInput) => {
    const instruction = input.trim(); if (!instruction) return;
    setVirtualChatMessages(messages => [...messages, { role: "manager", text: `已派工：${instruction}` }]); setVirtualChatInput("");
    try { await apiClient.post("/qms/iqc/virtual-employee/tasks/assign", { title: instruction.slice(0, 220), instructions: instruction, lotNo: visibleIqcQueue[0]?.lot_no, materialCode: visibleIqcQueue[0]?.material_code, assignedTo: "IQC-VIRTUAL-01", priority: "HIGH" }); setVirtualChatMessages(messages => [...messages, { role: "assistant", text: "任务已进入 IQC-VIRTUAL-01 工作队列。我会先查物料历史，再读取 ACTIVE Excel，完成后回报。" }]); }
    catch (e) { setVirtualChatMessages(messages => [...messages, { role: "assistant", text: e instanceof Error ? e.message : String(e) }]); }
  };
  const runVirtualCronNow = async () => {
    setVirtualCronStatus("正在运行…");
    try { const result: any = await apiClient.post("/qms/iqc/virtual-employee/run-now", { instructions: virtualCronTask }); const item = result.item || result.data?.item || result; setVirtualCronStatus(`已完成：${item.planned ?? 0} 个任务，指导：${item.guidance || "当前 ACTIVE Excel"}`); setVirtualChatOpen(true); setVirtualChatMessages(messages => [...messages, { role: "assistant", text: `Cron已执行：发现并安排 ${item.planned ?? 0} 个IQC任务。${item.guidance || "已使用当前 ACTIVE Excel"}` }]); }
    catch (e) { setVirtualCronStatus(`失败：${e instanceof Error ? e.message : String(e)}`); }
  };
  useEffect(() => { if (!virtualWatching) return; setVirtualStatus("WATCHING"); const timer = window.setInterval(() => { void runVirtualEmployee(); }, 15000); return () => window.clearInterval(timer); }, [virtualWatching, iqcGuidance, iqcQueue]);
  const poIqcQueue = visibleIqcQueue.filter(item => String(item.source_type || "PO_RECEIPT").toUpperCase() === "PO_RECEIPT");

  const showFeedback = (ok: boolean, msg: string) => {
    setFeedback({ ok, msg });
    setTimeout(() => setFeedback(null), 3000);
  };

  // Submit for inspection
  const handleSubmit = async () => {
    if (!selected || !submitForm.batch_size) return;
    const guidedSample = guidedSampleSize(Number(submitForm.batch_size), iqcGuidance?.samplingRows || []);
    if (!iqcGuidance?.samplingRows?.length || !iqcGuidance?.inspectionItems?.length || !guidedSample) {
      showFeedback(false, "请先导入国家标准 IQC 指导文件，并确认该批量范围有样本量；未匹配指导参数不能启动检验。");
      return;
    }
    setSaving(true);
    try {
      const rec = selected as IncomingRecord;
      if (rec.id < 0) {
        const demoInspection: IqcInspection = {
          id: rec.id, incoming_record_id: rec.id, lot_no: rec.lot_no, material_code: rec.material_code,
          supplier_code: rec.supplier_code || "TEST-SUPPLIER", batch_size: Number(submitForm.batch_size), sample_size: guidedSample,
          aql_level: "II", inspector_id: submitForm.inspector_id || "IQC_TESTER", inspection_types: submitForm.inspection_types,
          result: "pending", submitted_at: new Date().toISOString(), completed_at: "", defects: [],
        };
        setSubmitted(previous => [demoInspection, ...previous.filter(item => item.id !== demoInspection.id)]);
        setIqcQueue(previous => previous.filter(item => item.id !== rec.id));
        setShowSubmitModal(false); setSelected(null); setSubmitForm({ batch_size: "", inspector_id: "", inspection_types: [] });
        setView("submitted");
        showFeedback(true, "TEST IQC档案已建立，请完成检验判定");
        setSaving(false);
        return;
      }
      await wmsApi.createIqcInspection({
        incoming_record_id: rec.id,
        lot_no: rec.lot_no,
        material_code: rec.material_code,
        supplier_code: rec.supplier_code,
        batch_size: parseInt(submitForm.batch_size),
        sample_size: guidedSample,
        inspector_id: submitForm.inspector_id || "IQC_USER",
        inspection_types: submitForm.inspection_types,
      });
      setShowSubmitModal(false);
      setSelected(null);
      setSubmitForm({ batch_size: "", inspector_id: "", inspection_types: [] });
      loadAll();
      showFeedback(true, locale === "vi-VN" ? "Da gui kiem" : locale === "en-US" ? "Inspection submitted" : "已提交检验");
    } catch (e: any) {
      showFeedback(false, e?.message || "Error");
    }
    setSaving(false);
  };

  // Add defect record
  const handleAddDefect = async () => {
    if (!showJudgeModal || !judgeForm.defect_type || !judgeForm.defect_count) return;
    setSaving(true);
    try {
      if (showJudgeModal.id < 0) {
        const defect: IqcDefect = { id: Date.now(), defect_type: judgeForm.defect_type, defect_location: judgeForm.defect_location, defect_count: parseInt(judgeForm.defect_count), severity: judgeForm.severity, photo_url: judgeForm.photo_url };
        const updated = { ...showJudgeModal, defects: [...(showJudgeModal.defects || []), defect] };
        setShowJudgeModal(updated);
        setSubmitted(previous => previous.map(item => item.id === updated.id ? updated : item));
        setJudgeForm({ defect_type: "", defect_location: "", defect_count: "1", severity: "major", photo_url: "" });
        setSaving(false);
        return;
      }
      await wmsApi.addIqcDefect(showJudgeModal.id, {
        defect_type: judgeForm.defect_type,
        defect_location: judgeForm.defect_location,
        defect_count: parseInt(judgeForm.defect_count),
        severity: judgeForm.severity,
        photo_url: judgeForm.photo_url,
      });
      // Reload inspection with defects
      const updated = await wmsApi.getIqcInspection(showJudgeModal.id);
      setShowJudgeModal(updated as IqcInspection);
      setJudgeForm({ defect_type: "", defect_location: "", defect_count: "1", severity: "major", photo_url: "" });
    } catch (e: any) {
      showFeedback(false, e?.message || "Error");
    }
    setSaving(false);
  };

  // Complete inspection (submit judgment)
  const handleComplete = async () => {
    if (!showJudgeModal) return;
    setSaving(true);
    try {
      if (showJudgeModal.id < 0) {
        const result = showJudgeModal.defects.length ? "fail" : "pass";
        const completed = { ...showJudgeModal, result, completed_at: new Date().toISOString() };
        setSubmitted(previous => previous.filter(item => item.id !== completed.id));
        setHistory(previous => [completed, ...previous]);
        setShowJudgeModal(null);
        showFeedback(true, result === "pass" ? "TEST IQC合格，已模拟转入良品仓库" : "TEST IQC不合格，已模拟转入不良品仓库/MRB");
        setSaving(false);
        return;
      }
      await apiClient.post("/qms/iqc/inspection-levels/record", {
        supplierCode: showJudgeModal.supplier_code || "UNKNOWN",
        materialCode: showJudgeModal.material_code,
        lotNo: showJudgeModal.lot_no,
        result: showJudgeModal.defects.length ? "FAIL" : "PASS",
        operator: showJudgeModal.inspector_id || "iqc",
      });
      await wmsApi.completeIqcInspection(showJudgeModal.id);
      setShowJudgeModal(null);
      loadAll();
      showFeedback(true, locale === "vi-VN" ? "Da hoan thanh" : locale === "en-US" ? "Judgment submitted" : "判定已提交");
    } catch (e: any) {
      showFeedback(false, e?.message || "Error");
    }
    setSaving(false);
  };

  const inspectionTypeLabels: Record<string, string> = {
    identity: "身份/BOM", quantity: "数量/批次", packaging: "包装", label: "标签/追溯",
    visual: locale === "vi-VN" ? "外观检验" : locale === "en-US" ? "Visual" : "外观",
    dimension: locale === "vi-VN" ? "尺寸测量" : locale === "en-US" ? "Dimension" : "尺寸",
    electrical: "电气参数", solderability: "可焊性",
    msd: locale === "vi-VN" ? "MSD验证" : locale === "en-US" ? "MSD" : "MSD",
    esd: "ESD防护", documentation: "文件合规", risk: "风险升级",
    functional: locale === "vi-VN" ? "功能测试" : locale === "en-US" ? "Functional" : "功能",
  };

  return (
    <>
      <IqcEmployeeCommunication locale={locale} />
    <div style={{ padding: "0 24px 24px" }} onDragOver={event => event.preventDefault()} onDrop={event => void dropVirtualEmployee(event)}>
      {virtualChatOpen && <div style={{ position: "fixed", right: 18, bottom: 120, zIndex: 21, width: 360, maxWidth: "calc(100vw - 36px)", background: "#fff", border: "1px solid #c7d2fe", borderRadius: 12, boxShadow: "0 12px 35px rgba(15,23,42,.25)" }} onClick={event => event.stopPropagation()}><div style={{ padding: "10px 12px", background: "#312e81", color: "#fff", borderRadius: "12px 12px 0 0", display: "flex", justifyContent: "space-between" }}><strong>IQC-VIRTUAL-01</strong><button onClick={() => setVirtualChatOpen(false)}>×</button></div><div style={{ padding: 10, maxHeight: 260, overflow: "auto" }}>{virtualChatMessages.length === 0 && <div style={{ color: "#64748b", fontSize: 12 }}>请询问当前Excel指导、批次、检验项目或下一步操作。</div>}{virtualChatMessages.map((message, index) => <div key={index} style={{ textAlign: message.role === "user" ? "right" : "left", margin: "6px 0" }}><span style={{ display: "inline-block", padding: "6px 8px", borderRadius: 8, background: message.role === "user" ? "#dbeafe" : "#f1f5f9", fontSize: 12 }}>{message.text}</span></div>)}</div><div style={{ display: "flex", gap: 6, padding: 10, borderTop: "1px solid #e2e8f0" }}><input value={virtualChatInput} onChange={event => setVirtualChatInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void sendVirtualChat(); }} placeholder="输入IQC问题" style={{ flex: 1 }} /><button className="btn btn-primary" onClick={() => void sendVirtualChat()}>发送</button></div></div>}
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <ClipboardCheck size={22} style={{ color: "#3b82f6" }} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          {locale === "vi-VN" ? "IQC Kiem tra chat luong" : locale === "en-US" ? "IQC Quality Inspection" : "IQC 来料质量检验"}
        </h2>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <a className="btn btn-secondary" href="/?view=wms&wmsTab=poReceipt">{locale === "en-US" ? "Receiving / Excel Import" : locale === "vi-VN" ? "Nhận hàng / Nhập Excel" : "收货 / 导入Excel"}</a>
          <a className="btn btn-secondary" href="/?view=wms&wmsTab=iqcInspectionLevels">{locale === "en-US" ? "Guidance Versions & Levels" : locale === "vi-VN" ? "Phiên bản hướng dẫn & cấp kiểm tra" : "指导版本与检验等级"}</a>
          <a className="btn btn-secondary" href="/?view=wms&wmsTab=iqcDefectLoop">{locale === "en-US" ? "QR / Defect / MRB" : locale === "vi-VN" ? "QR / Lỗi / MRB" : "QR / 不良品 / MRB"}</a>
        </div>
        {feedback && (
          <span style={{
            marginLeft: "auto", padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
            background: feedback.ok ? "#d1fae5" : "#fee2e2",
            color: feedback.ok ? "#065f46" : "#991b1b",
          }}>{feedback.msg}</span>
        )}
      </div>

      {iqcGuidance && <section style={{ background: "#f0fdfa", border: "1px solid #99f6e4", borderRadius: 10, padding: 14, marginBottom: 16 }}><strong>当前 IQC 指导文件：{iqcGuidance.fileName}</strong><p style={{ margin: "6px 0", fontSize: 12 }}>抽样量和 Ac/Re 来自导入的 GB/T 2828.1 指导表；包装、标签、外观/尺寸等项目来自进料检验报告。检验员录入实际结果后，系统再判定 PASS/FAIL。</p>{iqcGuidance.inspectionItems?.length > 0 && <div style={{ fontSize: 12 }}>{iqcGuidance.inspectionItems.join(" · ")}</div>}</section>}
      {iqcGuidance && <section style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 10, padding: 14, marginBottom: 16 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong>Excel指导实时执行 / 结果预演</strong><span style={{ fontSize: 12, color: "#9a3412" }}>真实检验以ACTIVE版本为准</span></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}><input value={simulationBatch} onChange={e => setSimulationBatch(e.target.value)} placeholder="批量数量，例如 5000" /><input value={simulationResults} onChange={e => setSimulationResults(e.target.value)} placeholder="预演历史结果：PASS PASS FAIL" style={{ minWidth: 240 }} /></div><div style={{ marginTop: 10, fontSize: 13 }}>预演样本量：<strong>{guidedSampleSize(Number(simulationBatch || 0), iqcGuidance.samplingRows || []) || "未匹配批量范围"}</strong>；历史结果：{simulationResults.split(/[ ,，\n]+/).filter(v => ["PASS", "FAIL"].includes(v.toUpperCase())).length} 批。点击下方“开始IQC”后，系统将按当前ACTIVE Excel生成真实检验任务并保存实际结果。</div></section>}
      {iqcGuidance && <section style={{ background: "#eef2ff", border: "1px solid #a5b4fc", borderRadius: 10, padding: 14, marginBottom: 16, position: "sticky", top: 8, zIndex: 3 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong>虚拟IQC员工：IQC-VIRTUAL-01</strong><div style={{ display: "flex", gap: 6 }}><button className="btn btn-primary" onClick={() => void runVirtualEmployee()} disabled={virtualStatus === "RUNNING"}>{virtualStatus === "RUNNING" ? "执行中…" : "立即检查"}</button><button className="btn btn-secondary" onClick={() => { setVirtualWatching(v => !v); setVirtualStatus(virtualWatching ? "IDLE" : "WATCHING"); }}>{virtualWatching ? "停止监控" : "持续监控页面"}</button></div></div><div style={{ fontSize: 12, marginTop: 6 }}>状态：{virtualStatus}；模型：qwen3.8；{virtualWatching ? "每15秒检查待检队列" : "未启动持续监控"}；仅使用ACTIVE Excel和真实数据，不得编造结果或自动批准免检。</div>{virtualPlan && <div style={{ marginTop: 8, fontSize: 12 }}>当前计划：样本量 <strong>{virtualPlan.sampleSize ?? "未匹配"}</strong>，项目 {virtualPlan.inspectionItems?.length ?? 0} 项，下一步：{virtualPlan.decision}</div>}</section>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        <button className="btn btn-primary" onClick={() => { setVirtualChatOpen(true); setVirtualChatInput("请检查当前IQC批次，先读取物料历史和ACTIVE Excel，再告诉我下一步操作"); }}>
          测试 IQC-VIRTUAL-01
        </button>
        <button className="btn btn-secondary" onClick={() => setVirtualChannelsOpen(value => !value)}>
          {virtualChannelsOpen ? "关闭全部频道" : "打开全部频道"}
        </button>
      </div>
      {virtualChannelsOpen && <section style={{ background: "#ffffff", border: "1px solid #c7d2fe", borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>IQC-VIRTUAL-01 工作频道</strong>
          <span style={{ fontSize: 12, color: "#64748b" }}>统一管理系统频道</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 8, marginTop: 10 }}>
          {[
            ["主管指令频道", "接收主管指令、优先级和人工任务"],
            ["IQC任务频道", "查看派工、定时、逾期和已完成任务"],
            ["执行监控频道", "查看虚拟员工当前步骤和执行状态"],
            ["检验证据频道", "接收PDA、测试仪、扫码和人工结果"],
            ["人工审批频道", "处理免检、暂停恢复和异常转回审批"],
            ["不良/MRB频道", "处理不良档案、MRB、返工、报废和退货"],
            ["部门协作频道", "协调采购、工程、生产、仓库和供应商"],
            ["学习审核频道", "审核Excel和实际结果形成的学习候选"],
            ["定时任务频道", "查看Cron计划、提醒和健康检查"],
          ].map(([name, purpose]) => <div key={name} style={{ padding: 10, border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
            <strong style={{ display: "block", fontSize: 13 }}>{name}</strong>
            <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "#475569" }}>{purpose}</span>
          </div>)}
        </div>
      </section>}
      {virtualChannelsOpen && <section style={{ background: "#f8fafc", border: "1px solid #c7d2fe", borderRadius: 10, padding: 14, marginBottom: 16 }}><strong>Cron任务：IQC-VIRTUAL-01</strong><p style={{ margin: "6px 0", fontSize: 12, color: "#475569" }}>新ACTIVE Excel才重新读取；仅创建提醒和任务，不自动放行。</p><div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) 120px 120px", gap: 8 }}><input value={virtualCronTask} onChange={event => setVirtualCronTask(event.target.value)} placeholder="输入要重复执行的IQC任务" style={{ padding: 8 }} /><input value={virtualCronInterval} onChange={event => setVirtualCronInterval(event.target.value)} type="number" min="1" placeholder="分钟" style={{ padding: 8 }} /><select value={virtualCronPriority} onChange={event => setVirtualCronPriority(event.target.value)}><option value="HIGH">高优先级</option><option value="NORMAL">普通</option></select></div><div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><button className="btn btn-primary" onClick={() => void runVirtualCronNow()}>立即运行Cron</button><span style={{ fontSize: 12, color: "#64748b" }}>周期：{virtualCronInterval} 分钟</span>{virtualCronStatus && <span style={{ fontSize: 12, color: "#475569" }}>{virtualCronStatus}</span>}</div></section>}
      <IqcInspectionDiagram locale={locale} />
      {virtualPlan && <div style={{ marginBottom: 12, padding: 10, background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12 }}>IQC员工已先检查物料历史：{virtualPlan.historyCount ?? 0} 条记录；当前程序建议基于历史风险提示与 ACTIVE Excel生成。</div>}
      {virtualPlan?.procedureIdeas?.length > 0 && <section style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 10, padding: 14, marginBottom: 16 }}><strong>Excel指导生成的 IQC 检验程序建议</strong><p style={{ fontSize: 12, margin: "6px 0" }}>以下是执行顺序建议；实际参数、抽样量和合格限值必须回到 ACTIVE Excel核对。</p><ol style={{ margin: 0, paddingLeft: 22 }}>{virtualPlan.procedureIdeas.map((idea: any, index: number) => <li key={`${idea.item}-${index}`} style={{ marginBottom: 6 }}><strong>{idea.item}</strong><div style={{ fontSize: 12 }}>{idea.sequence}</div><div style={{ fontSize: 11, color: "#475569" }}>证据：{idea.evidence}；来源：{idea.source}</div></li>)}</ol></section>}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, background: "#052e24", color: "#d1fae5", borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <div><small style={{ color: "#86efac" }}>当前 PDA 设备 ID</small><strong style={{ display: "block", fontFamily: "monospace", fontSize: 16 }}>{activePda.device_id || "PDA-IQC-01"}</strong></div>
        <div><small style={{ color: "#86efac" }}>当前 IQC 检验员</small><strong style={{ display: "block", fontSize: 16 }}>{activePda.operator_name || activePda.inspector || "IQC测试员"}</strong></div>
        <div><small style={{ color: "#86efac" }}>正在检测批次</small><strong style={{ display: "block", fontFamily: "monospace", fontSize: 14 }}>{activePda.lot_no || "待机"}</strong></div>
        <div><small style={{ color: "#86efac" }}>工作设备数量</small><strong style={{ display: "block", fontSize: 16 }}>{workingDeviceCount} / 5 台</strong></div>
        <div><small style={{ color: "#86efac" }}>实时状态</small><strong style={{ display: "block", fontSize: 16 }}>{activePda.status === "INSPECTING" ? "检测中" : activePda.status === "COMPLETED" ? "已完成" : "待机"}</strong></div>
      </section>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <a className="action-button" href="/?view=wms&wmsTab=pdaIqc">打开 PDA IQC 检验</a>
        <a className="btn btn-secondary" style={{ marginLeft: 8 }} href="/?view=wms&wmsTab=iqcReport">查看检测结果</a>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 14, padding: "8px 10px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8 }}><strong style={{ color: "#065f46", fontSize: 12 }}>IQC检验员可用页面：</strong>{IQC_ROLE_PAGE_LINKS.map(([label, tab]) => <a key={tab} href={`/?view=wms&wmsTab=${tab}`} style={{ color: "#065f46", background: "#fff", border: "1px solid #a7f3d0", borderRadius: 5, padding: "4px 7px", fontSize: 11 }}>{label}</a>)}</div>

      <section style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 10, padding: 14, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 10px", color: "#0f172a" }}>IQC使用说明</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 8 }}>
          {[["1", "确认收料", "在收料页面扫描批次，确认数量与供应商"], ["2", "QR绑定仓库", "绑定待检仓位并生成系统QR单据"], ["3", "进入IQC待检", "在下方队列找到批次，核对物料QR和栈板QR"], ["4", "打开PDA检测", "扫描或从队列带入批次，逐项完成全部检测"], ["5", "最终评审批准", "核对缺陷、照片、统计后勾选批准并提交"], ["6", "查询结果", "在检验中、历史、IQC报表或PDA记录查询"]].map(([no, title, detail]) => <div key={no} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}><strong style={{ color: "#2563eb" }}>{no}. {title}</strong><p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 12 }}>{detail}</p></div>)}
        </div>
      </section>

      <section style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div><h3 style={{ margin: 0 }}>SMT IQC检验项目清单</h3><p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 12 }}>按物料规格、供应商风险和客户要求选择；每项应记录结果、判定、检验员和证据。</p></div>
          <span className="badge badge-info">{activeInspectionItems.length} 项</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 8 }}>
          {activeInspectionItems.map(([key, title, detail], index) => <div key={key} style={{ display: "flex", gap: 8, padding: 10, border: "1px solid #e2e8f0", borderRadius: 8, background: index % 2 ? "#f8fafc" : "#fff" }}>
            <span style={{ minWidth: 24, height: 24, borderRadius: "50%", background: "#dbeafe", color: "#1d4ed8", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{index + 1}</span>
            <div><strong style={{ display: "block", fontSize: 13 }}>{title}</strong><span style={{ color: "#64748b", fontSize: 12 }}>{detail}</span></div>
          </div>)}
        </div>
      </section>

      {false && poIqcQueue.length === 0 && <section style={{ background: "#fffbeb", border: "1px dashed #f59e0b", borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><div><h3 style={{ margin: 0, color: "#92400e" }}>测试物料展示 / IQC demo materials</h3><p style={{ margin: "4px 0 0", color: "#92400e", fontSize: 12 }}>当前没有真实 PO 收货记录，以下 TEST 数据仅用于演示页面，不写入库存。</p></div><span style={{ background: "#fef3c7", color: "#92400e", padding: "4px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700 }}>TEST DATA</span></div>
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#fff" }}><thead><tr>{["批次", "物料", "物料QR", "栈板QR", "数量", "待检仓位", "等待"].map(h => <th key={h} style={{ padding: "8px", textAlign: "left", color: "#92400e", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead><tbody>{IQC_PO_DEMO_MATERIALS.map(item => <tr key={item.id} style={{ borderTop: "1px solid #fde68a" }}><td style={{ padding: "8px", fontFamily: "monospace" }}>{item.lot_no}</td><td style={{ padding: "8px" }}><strong>{item.material_code}</strong><br /><span style={{ color: "#64748b" }}>{item.material_name}</span></td><td style={{ padding: "8px", fontFamily: "monospace" }}>{item.material_qr}</td><td style={{ padding: "8px", fontFamily: "monospace" }}>{item.pallet_qr}</td><td style={{ padding: "8px" }}>{item.quantity} {item.uom}</td><td style={{ padding: "8px" }}>{item.location_code}</td><td style={{ padding: "8px", color: Number(item.waiting_minutes) > 60 ? "#dc2626" : "#475569" }}>{item.waiting_minutes} min</td></tr>)}</tbody></table></div>
      </section>}

      <section style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div><h3 style={{ margin: 0, color: "#166534" }}>PO采购到货 IQC待检清单</h3><p style={{ margin: "4px 0 0", color: "#475569", fontSize: 12 }}>采购订单收货完成后，已完成 QR 绑定并等待 IQC 检验的物料</p></div>
          <strong style={{ color: "#15803d" }}>{poIqcQueue.length}</strong>
        </div>
        {iqcQueue.filter(item => String(item.source_type || "PO_RECEIPT").toUpperCase() === "PO_RECEIPT").length === 0 ? <div style={{ color: "#64748b", padding: 14 }}>当前没有 PO采购到货待检物料</div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#fff" }}><thead><tr>{["批次", "物料编码/名称", "物料QR", "栈板QR", "收货数量", "待检仓位", "收货时间", "等待时长", "操作"].map(h => <th key={h} style={{ padding: "8px", textAlign: "left", color: "#475569", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead><tbody>{iqcQueue.filter(item => String(item.source_type || "PO_RECEIPT").toUpperCase() === "PO_RECEIPT").map(item => <tr key={`po-${item.id}`} style={{ borderTop: "1px solid #e2e8f0" }}><td style={{ padding: "8px", fontFamily: "monospace" }}>{item.lot_no}</td><td style={{ padding: "8px" }}><strong>{item.material_code}</strong><br /><span style={{ color: "#64748b" }}>{item.material_name || "-"}</span></td><td style={{ padding: "8px", fontFamily: "monospace" }}>{item.material_qr || "-"}</td><td style={{ padding: "8px", fontFamily: "monospace" }}>{item.pallet_qr || "-"}</td><td style={{ padding: "8px" }}>{item.quantity ?? 0} {item.uom || ""}</td><td style={{ padding: "8px" }}>{item.location_code || item.warehouse_code || "-"}</td><td style={{ padding: "8px", whiteSpace: "nowrap" }}>{item.received_at ? new Date(item.received_at).toLocaleString() : "-"}</td><td style={{ padding: "8px", color: Number(item.waiting_minutes) > 60 ? "#dc2626" : "#475569" }}>{Math.max(0, Math.floor(Number(item.waiting_minutes || 0)))} min</td><td style={{ padding: "8px" }}><button onClick={() => { const mapped: IncomingRecord = { id: item.id, lot_no: item.lot_no, material_code: item.material_code, material_name: item.material_name || item.material_code, supplier_code: "-", supplier_name: "-", received_qty: Number(item.quantity || 0), uom_code: item.uom || "", received_at: item.received_at || "", packaging_status: "good", msd_level: "", iqc_status: "pending" }; setSelected(mapped); setShowSubmitModal(true); }} style={{ background: "#15803d", color: "#fff", border: 0, borderRadius: 5, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>开始IQC</button></td></tr>)}</tbody></table></div>}
      </section>

      <section style={{ display: "none", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div><h3 style={{ margin: 0, color: "#1e3a8a" }}>{locale === "en-US" ? "IQC waiting queue" : locale === "vi-VN" ? "Hang doi IQC" : "IQC 待检物料队列"}</h3><p style={{ margin: "4px 0 0", color: "#475569", fontSize: 12 }}>{locale === "en-US" ? "Materials received and QR-bound, waiting for inspection" : "已收料并完成 QR 绑定，等待 IQC 检验的物料"}</p></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><strong style={{ color: "#1d4ed8" }}>{visibleIqcQueue.length}</strong>{visibleIqcQueue.some(item => item.id < 0) && <span className="badge badge-warning">TEST DATA</span>}</div>
        </div>
        {visibleIqcQueue.length === 0 ? <div style={{ color: "#64748b", padding: 14 }}>{locale === "en-US" ? "No QR-bound materials waiting for IQC" : "当前没有等待 IQC 的 QR 物料"}</div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#fff" }}><thead><tr>{["批次", "物料", "物料QR", "栈板QR", "数量", "待检仓位", "等待", "操作"].map((h) => <th key={h} style={{ padding: "8px", textAlign: "left", color: "#475569", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead><tbody>{visibleIqcQueue.map(item => <tr key={item.id} style={{ borderTop: "1px solid #e2e8f0" }}><td style={{ padding: "8px", fontFamily: "monospace" }}>{item.lot_no}</td><td style={{ padding: "8px" }}><strong>{item.material_code}</strong><br /><span style={{ color: "#64748b" }}>{item.material_name || "-"}</span></td><td style={{ padding: "8px", fontFamily: "monospace" }}>{item.material_qr || "-"}</td><td style={{ padding: "8px", fontFamily: "monospace" }}>{item.pallet_qr || "-"}</td><td style={{ padding: "8px" }}>{item.quantity ?? 0} {item.uom || ""}</td><td style={{ padding: "8px" }}>{item.location_code || item.warehouse_code || "-"}</td><td style={{ padding: "8px", color: Number(item.waiting_minutes) > 60 ? "#dc2626" : "#475569" }}>{Math.max(0, Math.floor(Number(item.waiting_minutes || 0)))} min</td><td style={{ padding: "8px" }}><button onClick={() => { const mapped: IncomingRecord = { id: item.id, lot_no: item.lot_no, material_code: item.material_code, material_name: item.material_name || item.material_code, supplier_code: "-", supplier_name: "-", received_qty: Number(item.quantity || 0), uom_code: item.uom || "", received_at: item.received_at || "", packaging_status: "good", msd_level: "", iqc_status: "pending" }; setSelected(mapped); setShowSubmitModal(true); }} style={{ background: "#2563eb", color: "#fff", border: 0, borderRadius: 5, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>{locale === "en-US" ? "Start IQC" : "开始检验"}</button></td></tr>)}</tbody></table></div>}
      </section>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "2px solid #e5e7eb", marginBottom: 20, gap: 0 }}>
        {([
          { key: "pending" as View, label: f("pending", locale) || "待检", count: pendingCount },
          { key: "submitted" as View, label: locale === "vi-VN" ? "Dang kiem" : locale === "en-US" ? "Inspecting" : "检验中", count: submittedCount },
          { key: "history" as View, label: locale === "vi-VN" ? "Lich su" : locale === "en-US" ? "History" : "历史", count: historyCount },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setView(tab.key)} style={{
            padding: "8px 20px", border: "none", borderBottom: view === tab.key ? "2px solid #3b82f6" : "2px solid transparent",
            background: "none", cursor: "pointer", fontWeight: view === tab.key ? 700 : 400, color: view === tab.key ? "#3b82f6" : "#6b7280",
            fontSize: 14, marginBottom: -2,
          }}>
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>Loading...</div> : (
        <>
          {/* PENDING: Incoming records not yet submitted */}
          {view === "pending" && (
            <>
              {pending.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 15 }}>
                  {locale === "vi-VN" ? "Khong co phieu cho" : locale === "en-US" ? "No pending items" : "无待检批次"}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                      {[
                        locale === "vi-VN" ? "So lo" : locale === "en-US" ? "Lot No." : "批次号",
                        locale === "vi-VN" ? "Ma vat tu" : locale === "en-US" ? "Material Code" : "物料编码",
                        locale === "vi-VN" ? "NCC" : locale === "en-US" ? "Supplier" : "供应商",
                        locale === "vi-VN" ? "SL" : locale === "en-US" ? "Qty" : "数量",
                        locale === "vi-VN" ? "Tinh trang" : locale === "en-US" ? "Status" : "包装状态",
                        locale === "vi-VN" ? "MSD" : "MSD Level",
                        locale === "vi-VN" ? "Han tao" : locale === "en-US" ? "Received" : "到货时间",
                        "",
                      ].map((h, i) => (
                        <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(r => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1d4ed8" }}>{r.lot_no}</td>
                        <td style={{ padding: "8px 12px" }}>{r.material_code}</td>
                        <td style={{ padding: "8px 12px", color: "#374151" }}>{r.supplier_name || r.supplier_code}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{r.received_qty} {r.uom_code}</td>
                        <td style={{ padding: "8px 12px" }}>
                          {r.packaging_status === "good" ? (
                            <span style={{ background: "#d1fae5", color: "#065f46", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                              {locale === "vi-VN" ? "Tot" : "完好"}
                            </span>
                          ) : r.packaging_status === "minor_damage" ? (
                            <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                              {locale === "vi-VN" ? "Hao nhe" : "轻微破损"}
                            </span>
                          ) : (
                            <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                              {locale === "vi-VN" ? "Hao nang" : "严重破损"}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          {r.msd_level && <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>MSD {r.msd_level}</span>}
                        </td>
                        <td style={{ padding: "8px 12px", color: "#6b7280" }}>{r.received_at?.slice(0, 10)}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <button onClick={() => { setSelected(r); setShowSubmitModal(true); }}
                            style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                            {f("submitInspection", locale) || "送检"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* SUBMITTED: Inspections in progress */}
          {view === "submitted" && (
            <>
              {submitted.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 15 }}>
                  {locale === "vi-VN" ? "Khong co phieu dang kiem" : locale === "en-US" ? "No items in inspection" : "无检验中批次"}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                      {[
                        locale === "vi-VN" ? "So lo" : "批次号",
                        locale === "vi-VN" ? "Ma vat tu" : "物料编码",
                        locale === "vi-VN" ? "NCC" : "供应商",
                        locale === "vi-VN" ? "Nguoi kiem" : "检验员",
                        locale === "vi-VN" ? "Mau" : "抽样数",
                        locale === "vi-VN" ? "Thoi gian" : "送检时间",
                        locale === "vi-VN" ? "Ket qua" : "结果",
                        "",
                      ].map((h, i) => <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {submitted.map(s => (
                      <tr key={s.id} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }} onClick={() => setShowJudgeModal(s as IqcInspection)} title="点击查看检测结果">
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1d4ed8" }}>{s.lot_no}</td>
                        <td style={{ padding: "8px 12px" }}>{s.material_code}</td>
                        <td style={{ padding: "8px 12px" }}>{s.supplier_code}</td>
                        <td style={{ padding: "8px 12px" }}>{s.inspector_id}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{s.sample_size}/{s.batch_size}</td>
                        <td style={{ padding: "8px 12px", color: "#6b7280" }}>{s.submitted_at?.slice(0, 16)}</td>
                        <td style={{ padding: "8px 12px" }}>{resultBadge(s.result, locale)}</td>
                        <td style={{ padding: "8px 12px" }}>
                          <button onClick={() => setShowJudgeModal(s as IqcInspection)}
                            style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                            {f("judge", locale) || "判定"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* HISTORY */}
          {view === "history" && (
            <>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 15 }}>
                  {locale === "vi-VN" ? "Chua co lich su" : "No history"}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                      {[
                        locale === "vi-VN" ? "So lo" : "批次号",
                        locale === "vi-VN" ? "Ma vat tu" : "物料编码",
                        locale === "vi-VN" ? "NCC" : "供应商",
                        locale === "vi-VN" ? "Ket qua" : "判定结果",
                        locale === "vi-VN" ? "Hoan thanh" : "完成时间",
                      ].map((h, i) => <th key={i} style={{ padding: "8px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.id} style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }} onClick={() => setShowJudgeModal(h)}>
                        <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#1d4ed8" }}>{h.lot_no}</td>
                        <td style={{ padding: "8px 12px" }}>{h.material_code}</td>
                        <td style={{ padding: "8px 12px" }}>{h.supplier_code}</td>
                        <td style={{ padding: "8px 12px" }}>{resultBadge(h.result, locale)}</td>
                        <td style={{ padding: "8px 12px", color: "#6b7280" }}>{h.completed_at?.slice(0, 16)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </>
      )}

      {/* Submit Inspection Modal */}
      {showSubmitModal && selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => { setShowSubmitModal(false); setSelected(null); }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, width: "90%", maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{f("submitInspection", locale) || "送检"}</h3>
              <button onClick={() => { setShowSubmitModal(false); setSelected(null); }} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            {/* Record info */}
            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12, marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"So lo":(locale==="en-US")?"Lot:":"批次号"}</span> {(selected as IncomingRecord).lot_no}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"Ma VT":(locale==="en-US")?"Mat.Cd:":"物料"}</span> {(selected as IncomingRecord).material_code}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"NCC":(locale==="en-US")?"Supplier:":"供应商"}</span> {(selected as IncomingRecord).supplier_name || (selected as IncomingRecord).supplier_code}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"SL":(locale==="en-US")?"Qty:":"数量"}</span> {(selected as IncomingRecord).received_qty}</div>
            </div>
            {iqcGuidance && <div style={{ marginBottom: 16, padding: 10, background: "#f0fdfa", border: "1px solid #99f6e4", borderRadius: 6, fontSize: 12 }}>Guided procedure: sample size {guidedSampleSize(Number(submitForm.batch_size || 0), iqcGuidance.samplingRows || []) || "use imported Ac/Re table"}; inspect {iqcGuidance.inspectionItems?.slice(0, 8).join(" · ") || "the imported checklist"}.</div>}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{(locale==="vi-VN")?"Kich thuoc lo *":(locale==="en-US")?"Batch Size *":"批量大小 *"}</label>
              <input type="number" value={submitForm.batch_size} onChange={e => setSubmitForm(p => ({ ...p, batch_size: e.target.value }))}
                placeholder={locale==="vi-VN"?"Nhap so luong":(locale==="en-US")?"Enter qty":"输入批量大小"}
                style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 8 }}>{(locale==="vi-VN")?"Loai kiem tra":(locale==="en-US")?"Inspection Type":"检验类型"}</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {activeInspectionItems.map(([tp, title]) => (
                  <label key={tp} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", border: `1px solid ${submitForm.inspection_types.includes(tp) ? "#3b82f6" : "#d1d5db"}`, borderRadius: 6, cursor: "pointer", background: submitForm.inspection_types.includes(tp) ? "#eff6ff" : "#fff", fontSize: 12 }}>
                    <input type="checkbox" checked={submitForm.inspection_types.includes(tp)}
                      onChange={e => setSubmitForm(p => ({
                        ...p, inspection_types: e.target.checked ? [...p.inspection_types, tp] : p.inspection_types.filter(x => x !== tp)
                      }))} style={{ display: "none" }} />
                    {inspectionTypeLabels[tp] || title}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowSubmitModal(false); setSelected(null); }}
                style={{ padding: "8px 20px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" }}>
                {locale === "vi-VN" ? "Huy" : locale === "en-US" ? "Cancel" : "取消"}
              </button>
              <button onClick={handleSubmit} disabled={saving || !submitForm.batch_size}
                style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: saving ? "#9ca3af" : "#3b82f6", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {saving ? "..." : f("submitInspection", locale) || "送检"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Judge / Defect Entry Modal */}
      {showJudgeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowJudgeModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 24, width: "90%", maxWidth: 580 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>
                {showJudgeModal.result === "pending"
                  ? (locale === "vi-VN" ? "Danh gia" : locale === "en-US" ? "Judge" : "判定")
                  : (locale === "vi-VN" ? "Chi tiet" : locale === "en-US" ? "Details" : "详情")}
              </h3>
              <button onClick={() => setShowJudgeModal(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>

            {/* Inspection info */}
            <div style={{ background: "#f9fafb", borderRadius: 8, padding: 12, marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"So lo":(locale==="en-US")?"Lot:":"批次号"}</span> {showJudgeModal.lot_no}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"AQL:":":AQL"}</span> {showJudgeModal.aql_level}</div>
              <div><span style={{ color: "#6b7280" }}>{(locale==="vi-VN")?"Mau:":(locale==="en-US")?"Sample:":"抽样"}</span> {showJudgeModal.sample_size}/{showJudgeModal.batch_size}</div>
            </div>

            {/* AQL reference */}
            <div style={{ background: "#eff6ff", borderRadius: 6, padding: 10, marginBottom: 16, fontSize: 12, color: "#1e40af" }}>
              AQL | Critical: AC={showJudgeModal.ac_critical}/{showJudgeModal.re_critical} | Major: AC={showJudgeModal.ac_major}/{showJudgeModal.re_major} | Minor: AC={showJudgeModal.ac_minor}/{showJudgeModal.re_minor}
            </div>

            {showJudgeModal.result === "pending" && (
              <>
                {/* Add defect form */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{f("defectType", locale)} *</label>
                    <input value={judgeForm.defect_type} onChange={e => setJudgeForm(p => ({ ...p, defect_type: e.target.value }))}
                      placeholder={locale==="vi-VN"?"VD: Chan oxit":(locale==="en-US")?"e.g. Pin oxide":"引脚氧化"}
                      style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{f("defectLocation", locale)}</label>
                    <input value={judgeForm.defect_location} onChange={e => setJudgeForm(p => ({ ...p, defect_location: e.target.value }))}
                      placeholder={locale==="vi-VN"?"VD: Chan #3":(locale==="en-US")?"e.g. Pin #3":"引脚#3"}
                      style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{f("defectCount", locale)} *</label>
                    <input type="number" value={judgeForm.defect_count} onChange={e => setJudgeForm(p => ({ ...p, defect_count: e.target.value }))}
                      style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>{f("severity", locale)}</label>
                    <select value={judgeForm.severity} onChange={e => setJudgeForm(p => ({ ...p, severity: e.target.value }))}
                      style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>
                      <option value="critical">{f("critical", locale) || "严重"}</option>
                      <option value="major">{f("major", locale) || "主要"}</option>
                      <option value="minor">{f("minor", locale) || "次要"}</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 16, padding: 12, border: "1px dashed #f97316", borderRadius: 8, background: "#fff7ed" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#9a3412" }}>
                    <Camera size={18} /> 拍摄/上传损坏产品图片
                    <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const photo_url = await readDamagePhoto(file); setJudgeForm(p => ({ ...p, photo_url })); } catch (error: any) { showFeedback(false, error.message); } e.currentTarget.value = ""; }} />
                  </label>
                  {judgeForm.photo_url && <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "flex-start" }}><img src={judgeForm.photo_url} alt="损坏产品证据" style={{ width: 150, height: 100, objectFit: "cover", borderRadius: 6, border: "1px solid #fed7aa" }} /><button type="button" onClick={() => setJudgeForm(p => ({ ...p, photo_url: "" }))} style={{ border: 0, background: "transparent", color: "#dc2626", cursor: "pointer" }}>删除图片</button></div>}
                  <small style={{ display: "block", marginTop: 6, color: "#9a3412" }}>图片绑定当前不良记录，并随 IQC 结果发送给供应商。</small>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <button onClick={handleAddDefect} disabled={saving || !judgeForm.defect_type || !judgeForm.defect_count}
                    style={{ padding: "6px 14px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 13 }}>
                    + {f("addDefect", locale) || "添加不良"}
                  </button>
                </div>
              </>
            )}

            {/* Defect list */}
            {(showJudgeModal.defects || []).length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>{locale === "vi-VN" ? "Danh sach loi" : locale === "en-US" ? "Defects" : "不良记录"}</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {["Type","Location","Count","Severity"].map(h => (
                        <th key={h} style={{ padding: "5px 8px", textAlign: "left", color: "#6b7280" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(showJudgeModal.defects || []).map(d => (
                      <tr key={d.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "5px 8px" }}>{d.defect_type}</td>
                        <td style={{ padding: "5px 8px", color: "#6b7280" }}>{d.defect_location || "-"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: "#dc2626" }}>{d.defect_count}</td>
                        <td style={{ padding: "5px 8px" }}>
                          <span style={{ color: d.severity === "critical" ? "#991b1b" : d.severity === "major" ? "#b45309" : "#374151", fontSize: 11, fontWeight: 600 }}>
                            {d.severity.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {showJudgeModal.result === "pending" && (
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button onClick={() => setShowJudgeModal(null)}
                  style={{ padding: "8px 20px", border: "1px solid #d1d5db", borderRadius: 6, background: "#fff", cursor: "pointer" }}>
                  {locale === "vi-VN" ? "Huy" : "Cancel"}
                </button>
                <button onClick={handleComplete} disabled={saving}
                  style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: "#3b82f6", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                  {saving ? "..." : f("submitJudgment", locale) || "提交判定"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </>
  );
}
