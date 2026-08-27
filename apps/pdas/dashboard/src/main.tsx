import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { BrowserMultiFormatReader } from "@zxing/browser";

type Lang = "en" | "zh" | "vi";
const T = {
  en: {
    title: "Unified Management Application",
    queue: "Queue",
    wo: "Work orders",
    active: "Active",
    queued: "Queued",
    open: "Open material loading",
    selected: "Selected",
    confirmWorkOrder: "Confirm and enter loading",
    choose: "Select a work order for material loading",
    only: "All released WOs can be opened. MES validates execution permission when loading starts.",
    domain: "SMT BINDING",
    site: "Site binding mode",
    record: "MES records scan events only",
    standard: "Daily standard",
    standardWaiting: "Waiting for first complete scan",
    standardSet: "Set for this WO",
    loading: "Material loading",
    reverse: "Binding sequence",
    scan: "Scan",
    next: "Next scan",
    done: "Binding complete",
    blocked: "Loading is blocked until all scans pass.",
    load: "Load 100 pcs",
    material: "Material",
    quantity: "Quantity",
    feeder: "Feeder",
    channel: "Channel",
    machine: "Machine",
    workOrder: "Work order",
    back: "Back to work orders",
    previous: "Previous material",
    forward: "Next material",
    ready: "Ready",
    activateBinding: "Activate binding",
    completeBinding: "Complete binding",
    bindingIncomplete: "Scan material, machine, channel and feeder before completing the binding.",
    bindingPage: "Binding required",
  },
  zh: {
    title: "统一管理应用",
    queue: "队列",
    wo: "工单列表",
    active: "执行中",
    queued: "排队中",
    open: "进入上料",
    selected: "已选中",
    confirmWorkOrder: "确认并进入上料",
    choose: "选择要上料的工单",
    only: "所有已下发工单均可打开；开始上料时由 MES 校验执行权限。",
    domain: "SMT 上料",
    site: "现场上料模式",
    record: "MES 记录扫码与上料事件",
    standard: "当日标准",
    standardWaiting: "等待首次完整扫码",
    standardSet: "已为此工单设定",
    loading: "物料上料",
    reverse: "扫码顺序",
    scan: "扫码",
    next: "下一步扫码",
    done: "上料完成",
    blocked: "所有扫码通过前不能上料。",
    load: "确认上料",
    material: "物料",
    quantity: "数量",
    feeder: "Feeder",
    channel: "通道",
    machine: "机台",
    workOrder: "工单",
    back: "返回工单",
    previous: "上一个物料",
    forward: "下一个物料",
    ready: "准备完成",
    activateBinding: "激活绑定",
    completeBinding: "完成绑定",
    bindingIncomplete: "请依次扫描物料、机台、通道和 Feeder，全部校验通过后完成绑定。",
    bindingPage: "需要绑定",
  },
  vi: {
    title: "Ứng dụng hợp nhất · Nạp liệu SMT",
    queue: "Hàng đợi",
    wo: "Danh sách lệnh sản xuất",
    active: "Đang thực hiện",
    queued: "Đang chờ",
    open: "Vào nạp liệu",
    selected: "Đã chọn",
    confirmWorkOrder: "Xác nhận và vào nạp liệu",
    choose: "Chọn lệnh sản xuất cần nạp liệu",
    only: "Tất cả lệnh đã phát hành đều có thể mở; MES kiểm tra quyền khi bắt đầu nạp liệu.",
    domain: "NẠP LIỆU SMT",
    site: "Chế độ nạp liệu tại hiện trường",
    record: "MES ghi nhận sự kiện quét và nạp liệu",
    standard: "Tiêu chuẩn trong ngày",
    standardWaiting: "Chờ lần quét đầy đủ đầu tiên",
    standardSet: "Đã thiết lập cho lệnh này",
    loading: "Nạp vật liệu",
    reverse: "Thứ tự quét",
    scan: "Qu茅t",
    next: "Bước quét tiếp theo",
    done: "Nạp liệu hoàn tất",
    blocked: "Không thể nạp liệu cho đến khi tất cả mã quét hợp lệ.",
    load: "Xác nhận nạp liệu",
    material: "Vật liệu",
    quantity: "Số lượng",
    feeder: "Feeder",
    channel: "K锚nh",
    machine: "Máy",
    workOrder: "Lệnh sản xuất",
    back: "Quay lại danh sách lệnh",
    previous: "Vật liệu trước",
    forward: "Vật liệu tiếp theo",
    ready: "Sẵn sàng",
    activateBinding: "Kích hoạt liên kết",
    completeBinding: "Hoàn tất liên kết",
    bindingIncomplete: "Quét vật liệu, máy, kênh và feeder trước khi hoàn tất liên kết.",
    bindingPage: "Cần liên kết",
  },
} as const;

type Material = {
  code: string;
  name: string;
  sn: string;
  quantity: number;
  loaded: number;
  machine: string;
  channel: string;
  feeder: string;
};
function quantityFromMaterialQr(raw: string): number | null {
  const text = raw.trim();
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["quantity", "qty", "count", "数量", "数量PCS"]) {
      const value = Number(parsed[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  } catch {
    // Material labels are often plain text rather than JSON.
  }
  const match = text.match(/(?:quantity|qty|count|数量)\s*[:=：]?\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
function materialSnFromQr(raw: string): string {
  const text = raw.trim();
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["sn", "serialNumber", "reelCode", "materialSn", "materialSN"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    // Plain QR labels are valid material SNs.
  }
  return text;
}
function materialDataFromQr(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
    return String(parsed.schema || "").startsWith("ruijing.material-roll.") ? parsed : null;
  } catch { return null; }
}
function publishPdaLoadingStatus(payload: Record<string, unknown>) {
  const value = { ...payload, at: new Date().toISOString() };
  try { localStorage.setItem("wms:pda-receiving-status", JSON.stringify(value)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent("wms:pda-receiving-status", { detail: value }));
}
function parseReceivingQr(raw: string): Record<string, string> {
  const text = raw.trim();
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.toLowerCase(), String(item ?? "").trim()]).filter(([, item]) => item));
  } catch {
    return { value: text };
  }
}
const mesHost = () => localStorage.getItem("ruijing.mesHost")?.trim() || window.location.hostname;
const mesLoadingPage = () => window.location.protocol + "//" + mesHost() + ":5178/?view=mes&mesTab=smtLoading3d";
const pdaInstallationKey = () => {
  const stored = localStorage.getItem("ruijing.pdaInstallationKey")?.trim();
  if (stored) return stored;
  const key = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem("ruijing.pdaInstallationKey", key);
  return key;
};
const pdaDeviceId = () => sessionStorage.getItem("pda_mes_device_id")?.trim() || "PDA-PENDING-MES";
async function syncMesManagedPdaProfile(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${mesApiBase()}/pda/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ installationKey: pdaInstallationKey(), operator: pdaOperator(), appVersion: "pda-dashboard" }),
    });
    const body = await response.json().catch(() => ({}));
    const id = body?.data?.deviceId ?? body?.data?.item?.deviceId ?? body?.deviceId;
    if (response.ok && typeof id === "string" && id.trim()) {
      sessionStorage.setItem("pda_mes_device_id", id.trim());
      window.dispatchEvent(new Event("pda-device-id-updated"));
      return true;
    }
  } catch {
    // MES remains the authority; keep the pending label until its profile is available.
  }
  return false;
}
const mesApiBase = () => {
  if (window.location.protocol === "http:" && window.location.port === "5180") return `${window.location.origin}/backend`;
  if (window.location.protocol === "file:") return `http://${mesHost() || "192.168.6.155"}:8080`;
  return `${window.location.protocol}//${mesHost()}:8080`;
};
const smtMachinePositions = ["NPM-01", "NPM-02", "NPM-03", "NPM-04", "NPM-05", "NPM-06"] as const;
async function getPdaMesToken(): Promise<string> {
  const cached=sessionStorage.getItem("pda_mes_token");
  if(cached) {
    if (sessionStorage.getItem("pda_mes_device_id") || await syncMesManagedPdaProfile(cached)) return cached;
    sessionStorage.removeItem("pda_mes_token");
  }
  const response=await fetch(`${mesApiBase()}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"Factory@123"})});
  const body=await response.json().catch(()=>({}));
  const token=body?.data?.token ?? body?.data?.item?.token;
  if(!response.ok||!token) throw new Error(body?.error?.message||"MES temporary login failed");
  sessionStorage.setItem("pda_mes_token",token);
  sessionStorage.setItem("pda_mes_operator","TEMP_SMT_LOADER");
  const profileDeviceId = body?.data?.deviceId ?? body?.data?.user?.deviceId;
  if (typeof profileDeviceId === "string" && profileDeviceId.trim()) sessionStorage.setItem("pda_mes_device_id", profileDeviceId.trim());
  await syncMesManagedPdaProfile(token);
  return token;
}
const pdaOperator = () => sessionStorage.getItem("pda_mes_operator") || "TEMP_SMT_LOADER";
async function reportLoadingActivity(payload: {activityType:"CYCLE_STARTED"|"MACHINE_SELECTED"|"CHANNEL_SELECTED"|"FEEDER_SELECTED"|"MATERIAL_SCANNED";workOrderCode:string;machineCode?:string;channelCode?:string;feederCode?:string;materialSn?:string;result?:"PASS"|"REJECT";requestId?:string}): Promise<string | null> {
  const token=await getPdaMesToken();
  const response=await fetch(`${mesApiBase()}/mes/smt-loading/pda-activity`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({...payload,operator:pdaOperator(),deviceId:pdaDeviceId()})});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body?.error?.message||"MES realtime update failed");}
  const body=await response.json().catch(()=>({}));
  return typeof body?.data?.requestId === "string" ? body.data.requestId : null;
}
// The temporary PDA uses site-test material identities; MES owns final validation.
// so the PDA uses site-test SN placeholders until the loader scans real stock.
const materials: Material[] = Array.from({ length: 109 }, (_, i) => ({
  code: `REAL-BOM-${String(i + 1).padStart(3, "0")}`,
  name: `WO material ${String(i + 1).padStart(3, "0")}`,
  sn: `SITE-TEST-SN-${String(i + 1).padStart(3, "0")}`,
  quantity: 12,
  loaded: 0,
  machine: "NXT-01",
  channel: `CH-${String((i % 20) + 1).padStart(2, "0")}`,
  feeder: `FD-${String((i % 20) + 1).padStart(2, "0")}`,
}));
const workOrders = [
  {
    id: "26061010008",
    product: "SMT material-binding validation WO",
    planQty: 20,
    plannedAt: "2026-08-13 08:00",
  },
  {
    id: "WO-20260810-002",
    product: "Main board A2673",
    planQty: 800,
    plannedAt: "2026-08-10 13:30",
  },
  {
    id: "WO-20260810-003",
    product: "Main board B1200",
    planQty: 600,
    plannedAt: "2026-08-11 08:00",
  },
];

function Header({
  lang,
  setLang,
  back,
  t,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  back?: () => void;
  t: typeof T.en;
}) {
  const [deviceId, setDeviceId] = useState(pdaDeviceId());
  useEffect(() => {
    const refresh = () => setDeviceId(pdaDeviceId());
    window.addEventListener("pda-device-id-updated", refresh);
    const timer = window.setInterval(refresh, 1000);
    return () => { window.clearInterval(timer); window.removeEventListener("pda-device-id-updated", refresh); };
  }, []);
  return (
    <header className="header">
      <div className="header-controls">
        {back && (
          <button className="back" onClick={back}>
            ← {t.back}
          </button>
        )}
        <span>{t.title}</span>
        <span className="pda-device-id" aria-label="PDA ID">PDA ID · {deviceId}</span>
      </div>
      <div>
        <span className="health">
          {t.site} · {t.record}
        </span>
        <div className="language-switch" role="group" aria-label="Language">
          <button type="button" className={lang === "zh" ? "active" : ""} onClick={() => setLang("zh")}>中文</button>
          <button type="button" className={lang === "vi" ? "active" : ""} onClick={() => setLang("vi")}>VI</button>
          <button type="button" className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
        </div>
      </div>
    </header>
  );
}

function WorkOrders({
  lang,
  setLang,
  select,
  confirm,
  activeWorkOrderId,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  select: (workOrderId: string) => void;
  confirm: () => void;
  activeWorkOrderId: string;
}) {
  const t = T[lang];
  const [configuredMesHost,setConfiguredMesHost]=useState(mesHost());
  const [mesConfigMessage,setMesConfigMessage]=useState("");
  const openMesPage=()=>{window.open(mesLoadingPage(),"_blank","noopener,noreferrer");};
  const saveMesHost=()=>{const value=configuredMesHost.trim().replace(/^https?:\/\//,"").replace(/:\d+.*$/,"");if(!value)return;localStorage.setItem("ruijing.mesHost",value);sessionStorage.removeItem("pda_mes_token");setConfiguredMesHost(value);setMesConfigMessage(lang==="vi"?`Đã lưu địa chỉ MES: ${value}`:`MES 地址已保存：${value}`)};
  return (
    <>
      <Header lang={lang} setLang={setLang} t={t} />
      <main className="container">
        <div className="page-title">
          <div>
            <p className="eyebrow">
              {t.domain} · {t.wo}
            </p>
            <h1>{t.choose}</h1>
            <p className="muted">{t.only}</p>
          </div>
          <span className="domain">{t.domain}</span>
        </div>
        <section className="wo-list">
          <div className="wo-list-head">
            <strong>{t.wo}</strong>
            <span>
              {workOrders.length} {t.open}
            </span>
          </div>
          {workOrders.map((wo, i) => (
            <button
              key={wo.id}
              type="button"
              className={`wo-row ${wo.id === activeWorkOrderId ? "active" : "available"}`}
              onClick={() => select(wo.id)}
              aria-label={`${wo.id} ${wo.product} · ${wo.planQty} pcs · ${wo.plannedAt} ${t.open}`}
            >
              <div>
                <strong>{wo.id}</strong>
                <small>
                  {wo.product} · {wo.planQty} pcs · {wo.plannedAt}
                </small>
              </div>
              <span>{wo.id === activeWorkOrderId ? `✓ ${t.selected}` : t.open}</span>
            </button>
          ))}
        </section>
        <button type="button" className="wo-confirm" onClick={confirm}>✓ {t.confirmWorkOrder}</button>
        <section className="mes-host-config">
          <label>MES 电脑 IP 地址<input value={configuredMesHost} onChange={e=>setConfiguredMesHost(e.target.value)} inputMode="decimal" placeholder="192.168.6.155"/></label>
          <button type="button" onClick={saveMesHost}>保存并用于实时同步</button>
          <button type="button" onClick={openMesPage}>打开 MES 实时上料页</button>
          {mesConfigMessage&&<small>{mesConfigMessage}</small>}
          <p>PDA 向该 IP 的 MES 发送扫码与上料周期；MES 前端收到后自动打开实时上料页。</p>
        </section>
      </main>
    </>
  );
}

function MaterialLoading({
  lang,
  setLang,
  back,
  showStatus,
  workOrderId,
  bindingOnly = false,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  back: () => void;
  showStatus: () => void;
  workOrderId: string;
  bindingOnly?: boolean;
}) {
  const t = T[lang];
  const selectedWorkOrder = workOrders.find((wo) => wo.id === workOrderId) ?? workOrders[0];
  const [items, setItems] = useState(materials);
  const [active, setActive] = useState(0);
  const [step, setStep] = useState(4);
  const [phase, setPhase] = useState<"material-check" | "binding" | "loading-check" | "loading">("material-check");
  const [dailyStandard, setDailyStandard] = useState<string[] | null>(null);
  const [bindingRules, setBindingRules] = useState<Record<string, string[]>>({});
  const [pendingBinding, setPendingBinding] = useState<string[] | null>(null);
  const [showBindingMap, setShowBindingMap] = useState(false);
  const current = items[active];
  const labels = [
    t.workOrder,
    t.machine,
    t.channel,
    t.feeder,
    t.material,
  ];
  const [scanned, setScanned] = useState([
    selectedWorkOrder.id,
    "",
    "",
    "",
    "",
  ]);
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [bindingMessage, setBindingMessage] = useState("");
  const [bindingBusy, setBindingBusy] = useState(false);
  const [loadingBusy, setLoadingBusy] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<"READY" | "VALIDATING" | "COMMITTING" | "COMPLETED" | "FAILED">("READY");
  const [sourceLocationCode, setSourceLocationCode] = useState("WH-RAW-01");
  const [destinationLocationCode, setDestinationLocationCode] = useState("L001-MATERIAL-BUFFER");
  const [loadingSuccess, setLoadingSuccess] = useState<null | {
    eventId:string; workOrderCode:string; materialSn:string; machineCode:string;
    channelCode:string; feederCode:string; loadedQty:number;
  }>(null);
  const [registrationRequired, setRegistrationRequired] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<"L"|"R"|null>(null);
  const [selectedFeeder, setSelectedFeeder] = useState<string | null>(null);
  const [loadingTarget, setLoadingTarget] = useState<{machineCode:string;channelCode:string;feederCode:string;materialSn:string}|null>(null);
  const [quantityFromQr, setQuantityFromQr] = useState(false);
  const [rollCount, setRollCount] = useState(1);
  const touchStartX = useRef<number | null>(null);
  const cycleStartedForWo = useRef<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const cameraPurpose = useRef<"workflow"|"material"|"machine"|"channel"|"feeder">("workflow");
  const loadingRequestId = useRef<string | null>(null);
  const values = scanned;
  const complete = phase === "loading";
  const workflowTitle = {
    en: {
      "material-check": "Scan Material Roll",
      binding: "Create Binding Rule",
      "loading-check": "Verify Loading Position",
      loading: "Confirm Material Loading",
    },
    zh: {
      "material-check": "鎵弿鏂欏嵎",
      binding: "寤虹珛缁戝畾瑙勫垯",
      "loading-check": "鏍稿涓婃枡浣嶇疆",
      loading: "纭瀹屾垚涓婃枡",
    },
    vi: {
      "material-check": "Qu茅t cu峄檔 v岷璽 li峄噓",
      binding: "T岷 quy t岷痗 li锚n k岷縯",
      "loading-check": "X谩c minh v峄?tr铆 n岷",
      loading: "X谩c nh岷璶 n岷 v岷璽 li峄噓",
    },
  }[lang][phase];
  const workflowHint = {
    en: "Scan roll 鈫?MES checks rule 鈫?bind if missing 鈫?load",
    zh: "鎵弿鏂欏嵎 鈫?MES妫€鏌ヨ鍒?鈫?鏈粦瀹氬垯琛ョ粦瀹?鈫?鑷姩涓婃枡",
    vi: "Qu茅t cu峄檔 鈫?MES ki峄僲 tra 鈫?thi岷縰 th矛 li锚n k岷縯 鈫?n岷 li峄噓",
  }[lang];
  const waitingForScan = { en: "Waiting for scan", zh: "绛夊緟鎵弿", vi: "Ch峄?qu茅t" }[lang];
  const waitingForMes = { en: "Waiting for MES", zh: "绛夊緟 MES 杩斿洖", vi: "Ch峄?MES" }[lang];
  useEffect(()=>{
    if(cycleStartedForWo.current===selectedWorkOrder.id)return;
    cycleStartedForWo.current=selectedWorkOrder.id;
    void reportLoadingActivity({activityType:"CYCLE_STARTED",workOrderCode:selectedWorkOrder.id,result:"PASS"})
      .then((requestId)=>{if(requestId) loadingRequestId.current=requestId;})
      .catch(error=>setScanError(error instanceof Error?error.message:"MES realtime update failed"));
  },[selectedWorkOrder.id]);
  const scan = async (raw = scanInput) => {
    if (step >= labels.length) return;
    if (!raw.trim()) return;
      const value = raw.trim();
    if (phase === "material-check") {
      const qrQuantity = quantityFromMaterialQr(value);
      const rollSn = materialSnFromQr(value);
      try {
        const response = await fetch(`${mesApiBase()}/wms/material-roll-labels/resolve/${encodeURIComponent(rollSn)}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error?.message || "Material roll is not registered in WMS");
        const roll = result?.data;
        if (!roll?.canBind) throw new Error("Material roll is retired, empty, or blocked by WMS");
        const wmsQty = Number(roll.remainingQty);
        if (!Number.isFinite(wmsQty) || wmsQty <= 0) throw new Error("WMS remaining quantity is invalid");
        if (qrQuantity != null && Number(qrQuantity) !== Number(roll.originalQty)) throw new Error("QR quantity does not match WMS original quantity");
        void reportLoadingActivity({activityType:"MATERIAL_SCANNED",workOrderCode:selectedWorkOrder.id,machineCode:selectedMachine||undefined,channelCode:selectedChannel||undefined,feederCode:selectedFeeder||undefined,materialSn:roll.materialSn,result:"PASS",requestId:loadingRequestId.current||undefined})
          .then((requestId)=>{if(requestId) loadingRequestId.current=requestId;})
          .catch(()=>undefined);
        setItems((old) => old.map((m, i) => i === active ? {
          ...m,
          code: String(roll.qrPayload?.vietnamMaterialCode || roll.qrPayload?.materialCode || m.code),
          name: String(roll.qrPayload?.description || m.name),
          sn: roll.materialSn,
          quantity: bindingOnly ? Number(roll.originalQty) : wmsQty,
        } : m));
        setQuantityFromQr(true);
      } catch (error) {
        setScanError(error instanceof Error ? error.message : "WMS lookup failed");
        return;
      }
      if (bindingOnly) {
        setScanned([selectedWorkOrder.id, "", "", "", rollSn]);
        setStep(1);
        setPhase("binding");
      } else {
        try {
          const bindingResponse = await fetch(`${mesApiBase()}/mes/material-roll-bindings/active?workOrderCode=${encodeURIComponent(selectedWorkOrder.id)}&materialSn=${encodeURIComponent(rollSn)}`);
          const bindingResult = await bindingResponse.json().catch(() => ({}));
          if (bindingResponse.status === 404 || bindingResult?.error?.code === "MATERIAL_NOT_BOUND") {
            // No binding: continue with the reverse scan (machine → channel → feeder).
            // The completed scan is registered by commitBindingToMes and then enters
            // the normal loading confirmation cycle; do not reject the roll here.
            setLoadingTarget(null);
            setScanned([selectedWorkOrder.id, "", "", "", rollSn]);
            setPendingBinding(null);
            setStep(1);
            setPhase("binding");
            setRegistrationRequired(true);
            setBindingMessage(lang === "zh"
              ? "该料卷尚未绑定，请依次扫描机位、通道和 Feeder；完成扫描后注册并上料。"
              : lang === "vi"
                ? "Cuộn vật liệu chưa liên kết. Quét máy, kênh và feeder; sau đó đăng ký và nạp liệu."
                : "No binding found. Scan machine, channel and feeder to register, then load.");
            setScanInput("");
            setScanError("");
            return;
          }
          if (!bindingResponse.ok) throw new Error(bindingResult?.error?.message || "MES binding lookup failed");
          const activeBinding = bindingResult?.data;
          if (selectedMachine && String(activeBinding.machineCode) !== selectedMachine) {
            throw new Error(`该料卷属于 ${activeBinding.machineCode}，当前扫描机位为 ${selectedMachine}。`);
          }
          if (selectedChannel && String(activeBinding.channelCode||'').toUpperCase() !== selectedChannel) {
            throw new Error(`该料卷绑定槽位为 ${activeBinding.channelCode||'未登记'}，当前扫描为 ${selectedChannel}。`);
          }
          if (selectedFeeder && String(activeBinding.feederCode||'').toUpperCase() !== selectedFeeder) {
            throw new Error(`该料卷绑定 Feeder 为 ${activeBinding.feederCode||'未登记'}，当前扫描为 ${selectedFeeder}。`);
          }
          const rule = [activeBinding.machineCode, activeBinding.channelCode, activeBinding.feederCode, activeBinding.materialSn];
          if (rule.some((entry) => !String(entry || "").trim())) throw new Error("MES binding is incomplete; loading is blocked");
          setBindingRules((old) => ({ ...old, [String(roll.qrPayload?.vietnamMaterialCode || current.code)]: rule }));
           setLoadingTarget({ machineCode:rule[0], channelCode:rule[1], feederCode:rule[2], materialSn:rule[3] });
           setSelectedMachine(rule[0]);
           setSelectedChannel(rule[1]);
           setSelectedFeeder(rule[2]);
          // A registered material still requires a physical scan of the
          // machine, channel and feeder before loading is allowed.
          setScanned([selectedWorkOrder.id, "", "", "", rollSn]);
          setStep(1);
          setPhase("loading-check");
          setBindingMessage(`MES 已找到绑定：${rule[0]} / ${rule[1]} / ${rule[2]}。请依次扫描机位、通道和 Feeder。`);
        } catch (error) {
          setScanError(error instanceof Error ? error.message : "MES binding lookup failed");
          return;
        }
      }
      setScanInput("");
      setScanError("");
      return;
    }
    if (phase === "binding" && step === 1 && selectedMachine && value !== selectedMachine) {
      setScanError(`机位错误：已选 ${selectedMachine}，扫描到 ${value}。`);
      return;
    }
    if (phase === "binding" && step === 2 && selectedChannel && value.toUpperCase() !== selectedChannel) {
      setScanError(`槽位错误：已选 ${selectedChannel}，扫描到 ${value}。`);
      return;
    }
    if (phase === "binding" && step === 3 && selectedFeeder && value.toUpperCase() !== selectedFeeder) {
      setScanError(`Feeder 错误：已选 ${selectedFeeder}，扫描到 ${value}。`);
      return;
    }
    if (phase === "loading-check") {
      const rule = bindingRules[current.code] || Object.values(bindingRules).find((entry) => entry[3] === scanned[4]);
      if (!rule) {
        setScanError("Loading rejected: MES active binding is missing.");
        return;
      }
      try {
        const token=await getPdaMesToken();
        const verifyResponse=await fetch(`${mesApiBase()}/mes/smt-loading/verify-scan`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({
          workOrderCode:selectedWorkOrder.id,materialSn:scanned[4],scanStep:step===1?"MACHINE":step===2?"CHANNEL":"FEEDER",scannedValue:value,operator:pdaOperator(),deviceId:pdaDeviceId()
        })});
        const verifyResult=await verifyResponse.json().catch(()=>({}));
        if(!verifyResponse.ok||verifyResult?.data?.result!=="PASS") throw new Error(verifyResult?.data?.reason||verifyResult?.error?.message||"MES rejected this QR");
      } catch(error) {
        setScanError(`MES verification rejected: ${error instanceof Error?error.message:"wrong QR"}`);
        return;
      }
      const next = scanned.map((v, i) => (i === step ? value : v));
      setScanned(next);
      if (step === 3) {
        setStep(labels.length);
        setPhase("loading");
      } else {
        setStep((currentStep) => currentStep + 1);
      }
      setScanInput("");
      setScanError("");
      return;
    }
    const next = scanned.map((v, i) => (i === step ? value : v));
    if (phase === "binding" && step === labels.length - 2) {
      setScanned(next);
      setPendingBinding(next.slice(1));
      setStep(labels.length);
      setScanInput("");
      setScanError("");
      return;
    }
    if (step === labels.length - 1 && !dailyStandard) setDailyStandard(next);
    setScanned(next);
    setStep((currentStep) => currentStep + 1);
    setScanInput("");
    setScanError("");
  };
  const acceptCameraScan = (value:string) => {
    const scannedValue=value.trim();
    if(!scannedValue)return;
    if(cameraPurpose.current==="machine"){
      if(!smtMachinePositions.includes(scannedValue)){setScanError(`鏈轰綅浜岀淮鐮侀敊璇細${scannedValue}`);return;}
      if(phase==="loading-check"){setScanInput(scannedValue);void scan(scannedValue);return;}
      setSelectedMachine(scannedValue);setScanned(old=>old.map((entry,i)=>i===1?scannedValue:entry));setScanError("");
      void reportLoadingActivity({activityType:"MACHINE_SELECTED",workOrderCode:selectedWorkOrder.id,machineCode:scannedValue,result:"PASS",requestId:loadingRequestId.current||undefined}).catch(()=>undefined);return;
    }
    if(cameraPurpose.current==="channel"){
      const channel=scannedValue.toUpperCase();if(channel!=="L"&&channel!=="R"){setScanError(`閫氶亾浜岀淮鐮侀敊璇細${scannedValue}`);return;}
      if(phase==="loading-check"){setScanInput(channel);void scan(channel);return;}
      setSelectedChannel(channel);setScanned(old=>old.map((entry,i)=>i===2?channel:entry));setScanError("");
      void reportLoadingActivity({activityType:"CHANNEL_SELECTED",workOrderCode:selectedWorkOrder.id,machineCode:selectedMachine||undefined,channelCode:channel,result:"PASS",requestId:loadingRequestId.current||undefined}).catch(()=>undefined);return;
    }
    if(cameraPurpose.current==="feeder"){
      const feeder=scannedValue.toUpperCase();if(!/^F(?:0[1-9]|1[0-2])$/.test(feeder)){setScanError(`Feeder 浜岀淮鐮侀敊璇細${scannedValue}`);return;}
      if(phase==="loading-check"){setScanInput(feeder);void scan(feeder);return;}
      setSelectedFeeder(feeder);const completed=[selectedWorkOrder.id,selectedMachine||"",selectedChannel||"",feeder,scanned[4]];setScanned(completed);if(phase==="binding"&&scanned[4]){setPendingBinding(completed.slice(1));setStep(labels.length)}setScanError("");
      void reportLoadingActivity({activityType:"FEEDER_SELECTED",workOrderCode:selectedWorkOrder.id,machineCode:selectedMachine||undefined,channelCode:selectedChannel||undefined,feederCode:feeder,result:"PASS",requestId:loadingRequestId.current||undefined}).catch(()=>undefined);return;
    }
    setScanInput(scannedValue);void scan(scannedValue);
  };
  useEffect(() => {
    (window as Window & { receiveNativeScan?: (value: string) => void }).receiveNativeScan = (value) => {
      acceptCameraScan(value);
    };
    return () => {
      delete (window as Window & { receiveNativeScan?: (value: string) => void }).receiveNativeScan;
    };
  });
  const load = async () => {
    if (!complete || loadingBusy) return;
    if (!sourceLocationCode.trim() || !destinationLocationCode.trim() || sourceLocationCode.trim().toUpperCase() === destinationLocationCode.trim().toUpperCase()) { setScanError("请确认有效且不同的来源库位和目标库位"); setLoadingStatus("FAILED"); return; }
    setLoadingBusy(true);setLoadingStatus("VALIDATING");setScanError("");
    publishPdaLoadingStatus({ phase: "RECEIVING", lotNo: scanned[4], materialCode: current.code, qty: current.quantity, locationCode: destinationLocationCode, operator: pdaOperator() });
    try {
      const token=await getPdaMesToken();
      const idempotencyKey=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setLoadingStatus("COMMITTING");
      const response=await fetch(`${mesApiBase()}/api/smt/loading/pda-load`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payload: {
          idempotencyKey, workOrderCode: selectedWorkOrder.id, lineCode: "L001", materialSn: scanned[4], materialCode: current.code, qty: current.quantity,
          operatorBadge: pdaOperator(), deviceId: pdaDeviceId(), machineCode: scanned[1], channelCode: scanned[2], feederCode: scanned[3], slotNo: scanned[3], sourceLocationCode, destinationLocationCode,
        }}),
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result?.data?.status!=="COMPLETED")throw new Error(result?.error?.message||"WMS/MES did not confirm loading");
      setItems((old)=>old.map((m,i)=>i===active?{...m,loaded:Math.min(m.quantity,m.loaded+m.quantity)}:m));
      setLoadingStatus("COMPLETED");
      publishPdaLoadingStatus({ phase: "COMPLETED", lotNo: scanned[4], materialCode: current.code, qty: current.quantity, locationCode: destinationLocationCode, operator: pdaOperator() });
      setBindingMessage(`WMS/MES 上料完成 · TX ${result.data.transactionNo || result.data.transactionId}`);
      setLoadingSuccess({eventId:String(result.data.transactionId),workOrderCode:selectedWorkOrder.id,materialSn:scanned[4],machineCode:scanned[1],channelCode:scanned[2],feederCode:scanned[3],loadedQty:Number(current.quantity)});
    } catch(error) { setLoadingStatus("FAILED"); publishPdaLoadingStatus({ phase: "FAILED", lotNo: scanned[4], materialCode: current.code, qty: current.quantity, locationCode: destinationLocationCode, operator: pdaOperator() }); setScanError(`上料未完成：${error instanceof Error?error.message:"WMS/MES rejected loading"}`); }
    finally { setLoadingBusy(false); }
  };
  const acknowledgeLoadingSuccess = () => {
    const hasNext=active<items.length-1;
    setLoadingSuccess(null);
    setRegistrationRequired(false);
    if(hasNext)setActive((i)=>i+1);
    setStep(4);setPhase("material-check");setScanned([selectedWorkOrder.id,"","","",""]);
    setScanInput("");setScanError("");setBindingMessage("");setPendingBinding(null);setLoadingTarget(null);
    setSelectedMachine(null);setSelectedChannel(null);setSelectedFeeder(null);setQuantityFromQr(false);
  };
  const moveMaterial = (direction: 1 | -1) => {
    const next = active + direction;
    if (next < 0 || next >= items.length) return;
    setActive(next);
    setStep(4);
    setPhase("material-check");
    setScanned([selectedWorkOrder.id, "", "", "", ""]);
    setScanInput("");
    setScanError("");
    setPendingBinding(null);
    setLoadingTarget(null);
    setRegistrationRequired(false);
    setQuantityFromQr(false);
  };
  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    if (touchStartX.current == null) return;
    const distance = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) >= 70) moveMaterial(distance < 0 ? 1 : -1);
  };
  const openCamera = async (purpose:"workflow"|"material"|"machine"|"channel"|"feeder"="workflow") => {
    cameraPurpose.current=purpose;
    const bridge = (window as Window & { AndroidCamera?: { startScanner: () => void } }).AndroidCamera;
    if (bridge?.startScanner) {
      bridge.startScanner();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      cameraStream.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch (error) {
      setScanInput("Camera permission required");
    }
  };
  const closeCamera = () => {
    cameraStream.current?.getTracks().forEach((track) => track.stop());
    cameraStream.current = null;
    setCameraOpen(false);
  };
  useEffect(() => {
    if (!cameraOpen) return;
    const reader = new BrowserMultiFormatReader(undefined,{delayBetweenScanAttempts:120,delayBetweenScanSuccess:500});
    let stopped=false;
    let controls:{stop:()=>void}|undefined;
    const start=async()=>{
      if(!cameraStream.current||!videoRef.current)return;
      try{
        controls=await reader.decodeFromStream(cameraStream.current,videoRef.current,(result)=>{
          const value=String(result?.getText()||"").trim();
          if(!value||stopped)return;
          stopped=true;controls?.stop();closeCamera();acceptCameraScan(value);
        });
      }catch(error){if(!stopped)setScanError(`鐩告満鎵爜鍚姩澶辫触锛?{error instanceof Error?error.message:"unknown error"}`)}
    };
    void start();
    return()=>{stopped=true;controls?.stop()};
  }, [cameraOpen, phase, step, selectedWorkOrder.id]);
  const cameraOverlay = cameraOpen ? (
    <div className="camera-overlay">
      <video ref={videoRef} autoPlay playsInline />
      <div className="camera-guide"><span /><strong>{lang === "zh" ? "将二维码对准扫描框" : lang === "vi" ? "Đưa mã QR vào khung quét" : "Align the QR code inside the frame"}</strong></div>
      <button type="button" onClick={closeCamera}>{lang === "zh" ? "关闭相机" : lang === "vi" ? "Đóng camera" : "Close camera"}</button>
    </div>
  ) : null;
  const commitBindingToMes = async (binding: string[]) => {
    setBindingBusy(true);
    setBindingMessage("");
    setScanError("");
    try {
      const rollSn = binding[3];
      const token = await getPdaMesToken();

      const rollResponse = await fetch(`${mesApiBase()}/wms/material-roll-labels/resolve/${encodeURIComponent(rollSn)}`, { headers: { Authorization: `Bearer ${token}` } });
      const rollResult = await rollResponse.json().catch(() => ({}));
      if (!rollResponse.ok) throw new Error(rollResult?.error?.message ?? "Material roll is not registered in WMS");
      const roll = rollResult?.data;
      if (!roll?.canBind) throw new Error("Material roll is retired, empty, or blocked by WMS");
      const rollQuantity = Number(roll.remainingQty);
      if (!Number.isFinite(rollQuantity) || rollQuantity <= 0) throw new Error("WMS remaining quantity is invalid");
      const scannedQr = materialDataFromQr(JSON.stringify(roll.qrPayload || {}));
      if (scannedQr && Number(scannedQr.quantity) !== Number(roll.originalQty)) throw new Error("QR quantity does not match the immutable WMS quantity");
      const vietnamMaterialCode = String(roll.qrPayload?.vietnamMaterialCode || roll.qrPayload?.materialCode || "").trim();
      const chinaMaterialCode = String(roll.qrPayload?.chinaMaterialCode || roll.qrPayload?.internalCode || "").trim();
      const expectedMaterialCode = current.code.startsWith("REAL-BOM-") ? "" : current.code;
      if (expectedMaterialCode && ![vietnamMaterialCode, chinaMaterialCode].includes(expectedMaterialCode)) {
        throw new Error(`Wrong material: WO requires ${expectedMaterialCode}, scanned VN ${vietnamMaterialCode || "-"} / CN ${chinaMaterialCode || "-"}`);
      }
      setItems((old) => old.map((m, i) => i === active ? {
        ...m,
        code: vietnamMaterialCode || chinaMaterialCode || m.code,
        name: String(roll.qrPayload?.description || roll.qrPayload?.rawExcelRecord?.["鐗╂枡鍚嶇О"] || m.name),
        sn: roll.materialSn,
        quantity: rollQuantity,
      } : m));

      const response = await fetch(`${mesApiBase()}/mes/material-roll-bindings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "bind",
          payload: {
            workOrderCode: selectedWorkOrder.id,
            lineCode: "L001",
            machineCode: binding[0],
            channelCode: binding[1],
            feederCode: binding[2],
            materialSn: binding[3],
            expectedMaterialCode,
            materialCode: vietnamMaterialCode || chinaMaterialCode,
            chinaMaterialCode,
            vietnamMaterialCode,
            materialOriginalQuantity: Number(roll.originalQty),
            materialRemainingQuantity: rollQuantity,
            materialQuantity: rollQuantity,
            quantityPerRoll: rollQuantity,
            rollCount,
            materialRecord: roll.qrPayload,
            operator: pdaOperator(),
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? `MES rejected binding (${response.status})`);
      const resolvedCode = vietnamMaterialCode || chinaMaterialCode || current.code;
      setBindingRules((old) => ({ ...old, [resolvedCode]: binding }));
      setPendingBinding(null);
      setQuantityFromQr(false);
      setBindingMessage(`MES binding saved 路 ID ${result?.data?.item?.id ?? "OK"}`);
      window.dispatchEvent(new CustomEvent("mes:feeder-binding-created"));
      if (bindingOnly) {
        if (active < items.length - 1) setActive((index) => index + 1);
        setScanned([selectedWorkOrder.id, "", "", "", ""]);
        setStep(4);
        setPhase("material-check");
        setRollCount(1);
      } else {
        // The registration scan already captured machine/channel/feeder.
        // Do not make the loader repeat the same physical scan; continue
        // directly to the loading confirmation step.
        setScanned([selectedWorkOrder.id, binding[0], binding[1], binding[2], binding[3]]);
        setLoadingTarget({machineCode:binding[0],channelCode:binding[1],feederCode:binding[2],materialSn:binding[3]});
        setSelectedMachine(binding[0]);
        setSelectedChannel(binding[1]);
        setSelectedFeeder(binding[2]);
        setStep(4);
        setPhase("loading");
        setBindingMessage(`MES 绑定已保存：${binding[0]} / ${binding[1]} / ${binding[2]}。可直接确认上料。`);
      }
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "MES binding failed");
    } finally {
      setBindingBusy(false);
    }
  };
  if (showBindingMap) {
    return <BindingMap lang={lang} setLang={setLang} rules={bindingRules} workOrderId={workOrderId} back={() => setShowBindingMap(false)} />;
  }
  if (!selectedMachine) {
    const chooseMachineTitle = { en: "Scan machine QR", zh: "扫描上料机位", vi: "Quét QR máy" }[lang];
    const chooseMachineHint = { en: "Six NPM machines: three on the left and three on the right. Scan the physical machine QR.", zh: "6 台 NPM：产线左侧 3 台、右侧 3 台。请扫描实体机器 QR。", vi: "6 máy NPM: 3 bên trái và 3 bên phải. Quét QR máy thực." }[lang];
    return <>
      <Header lang={lang} setLang={setLang} back={back} t={t} />
      <main className="container machine-select-page">
        <div className="page-title"><div><p className="eyebrow">{selectedWorkOrder.id} 路 SMT</p><h1>{chooseMachineTitle}</h1><p className="muted">{chooseMachineHint}</p></div><span className="domain">3 NPM</span></div>
        <section className="material-first-entry">
          <strong>{lang === "zh" ? "也可以先扫描料卷" : lang === "vi" ? "Có thể quét cuộn vật liệu trước" : "You may scan the material roll first"}</strong>
          <p>{lang === "zh" ? "MES 将查询绑定；已绑定则显示机位、通道和 Feeder，未绑定则继续反向扫描并完成注册上料。" : lang === "vi" ? "MES kiểm tra liên kết và hiển thị máy, kênh, feeder." : "MES checks the binding and displays the machine, channel and feeder."}</p>
          <div><input value={scanInput} readOnly inputMode="none" placeholder={lang === "zh" ? "只能使用相机扫描料卷 QR" : "Camera scan only"}/><button type="button" onClick={()=>void openCamera("material")}>{lang === "zh" ? "📷 扫描料卷" : "📷 Scan roll"}</button></div>
          {scanError&&<p className="scan-error">{scanError}</p>}
        </section>
        <section className="machine-position-grid" aria-label={chooseMachineTitle}>
          {smtMachinePositions.map((machine, index) => <div key={machine} className="machine-position-card display-only">
            <span className="machine-icon-3d" aria-hidden="true"><i/><b/><u>{index + 1}</u></span><div><small>{lang === "zh" ? `机位号：${index + 1}` : lang === "vi" ? `Vị trí: ${index + 1}` : `Position No.: ${index + 1}`}</small><strong>{machine}</strong><em>{lang === "zh" ? "扫描实体机器二维码" : lang === "vi" ? "Quét QR máy thực" : "Scan the physical machine QR"}</em></div><b>→</b>
          </div>)}
        </section>
        <button type="button" className="camera-scan-primary" onClick={()=>void openCamera("machine")}>📷 {lang==="zh"?"扫描机器二维码":lang==="vi"?"Quét QR máy":"Scan machine QR"}</button>
      </main>
      {cameraOverlay}
    </>;
  }
  if (!selectedChannel) {
    const title={en:"Scan loading channel",zh:"扫描上料通道",vi:"Quét kênh nạp liệu"}[lang];
    return <><Header lang={lang} setLang={setLang} back={()=>setSelectedMachine(null)} t={t}/><main className="container machine-select-page">
      <div className="page-title"><div><p className="eyebrow">{selectedWorkOrder.id} · {selectedMachine}</p><h1>{title}</h1><p className="muted">{lang==='zh'?'请扫描实体通道二维码，结果实时发送 MES。':'Scan the physical channel QR. MES receives the result in real time.'}</p></div><span className="domain">{selectedMachine}</span></div>
      <section className="channel-position-grid" aria-label={title}>{(['L','R'] as const).map(channel=><div key={channel} className="channel-position-card display-only"><span>{channel}</span><div><small>{channel==='L'?(lang==='zh'?'左侧通道':'Left channel'):(lang==='zh'?'右侧通道':'Right channel')}</small><strong>{selectedMachine}-{channel}</strong></div></div>)}</section><button type="button" className="camera-scan-primary" onClick={()=>void openCamera("channel")}>📷 {lang==="zh"?"扫描通道二维码":"Scan channel QR"}</button>
    </main>{cameraOverlay}</>;
  }
  if (!selectedFeeder) {
    const title={en:"Scan feeder",zh:"扫描 Feeder",vi:"Quét feeder"}[lang];
    return <><Header lang={lang} setLang={setLang} back={()=>setSelectedChannel(null)} t={t}/><main className="container machine-select-page">
      <div className="page-title"><div><p className="eyebrow">{selectedWorkOrder.id} · {selectedMachine} · {selectedChannel}</p><h1>{title}</h1><p className="muted">{lang==='zh'?'请扫描实体 Feeder 二维码，MES 同步显示当前结果。':'Scan the physical feeder QR. MES shows the result in real time.'}</p></div><span className="domain">{selectedMachine}-{selectedChannel}</span></div>
      <section className="feeder-position-grid" aria-label={title}>{Array.from({length:12},(_,i)=>`F${String(i+1).padStart(2,'0')}`).map(feeder=><div key={feeder} className="feeder-position-card display-only"><span>FEEDER</span><strong>{feeder}</strong></div>)}</section><button type="button" className="camera-scan-primary" onClick={()=>void openCamera("feeder")}>📷 {lang==="zh"?"扫描 Feeder 二维码":"Scan feeder QR"}</button>
    </main>{cameraOverlay}</>;
  }
  return (
    <>
      <Header lang={lang} setLang={setLang} back={back} t={t} />
      <main
        className="container loading-page"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="page-title">
          <div>
            <p className="eyebrow">
              {t.domain} 路 {t.site}
            </p>
            <h1>{workflowTitle}</h1>
            <p className="muted">{workflowHint}</p>
          </div>
          <div>
            <span className="domain">{t.domain}</span>
            <span className="status-pill">{complete ? t.ready : t.scan}</span>
          </div>
        </div>
        <section className="summary">
          <div>
            <span>{t.workOrder}</span>
            <strong>{selectedWorkOrder.id}</strong>
          </div>
          <div>
            <span>{t.machine}</span>
            <strong>{selectedMachine}</strong>
          </div>
          <div>
            <span>{t.channel}</span>
            <strong>{selectedChannel}</strong>
          </div>
          <div>
            <span>{t.feeder}</span>
            <strong>{selectedFeeder}</strong>
          </div>
          <div>
            <span>{t.material}</span>
            <strong>
              {active + 1} / {items.length}
            </strong>
          </div>
          <div>
            <span>{t.record}</span>
            <strong>{complete ? t.done : t.site}</strong>
          </div>
        </section>
        <button type="button" className="change-machine" onClick={() => { setSelectedMachine(null); setSelectedChannel(null); setSelectedFeeder(null); setStep(4); setPhase("material-check"); setScanned([selectedWorkOrder.id, "", "", "", ""]); setScanError(""); setLoadingTarget(null); }}>
          {lang === "zh" ? "鏇存崲鏈轰綅" : lang === "vi" ? "膼峄昳 v峄?tr铆 m谩y" : "Change machine"}
        </button>
        <section className="loading-layout">
          {!bindingOnly && <div className="materials">
            {items.map((m, i) => (
              <button
                key={m.sn}
                className={`material-row ${i === active ? "selected" : ""}`}
                onClick={() => {
                  setActive(i);
                  setStep(4);
                  setPhase("material-check");
                  setScanned([selectedWorkOrder.id, "", "", "", ""]);
                  setScanInput("");
                  setScanError("");
                  setPendingBinding(null);
                }}
              >
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {m.code} 路 SN {m.sn}
                  </small>
                </div>
                <div className="qty">
                  {m.loaded} / {m.quantity}
                </div>
              </button>
            ))}
          </div>}
          <div className="detail">
            <div className="detail-head">
              <div>
                <p className="eyebrow">{phase === "binding" ? t.bindingPage : t.reverse}</p>
                <h2>{current.name}</h2>
              </div>
              <span className="scan-state">
                {complete ? t.done : `${t.scan}: ${labels[step]}`}
              </span>
            </div>
            <dl>
              <div>
                <dt>{t.workOrder}</dt>
                <dd>{selectedWorkOrder.id}</dd>
              </div>
              <div>
                <dt>{t.material}</dt>
                <dd>{values[4] || waitingForScan}</dd>
              </div>
              <div>
                <dt>{t.quantity}</dt>
                <dd>
                  <input
                    type="number"
                    min="1"
                    value={current.quantity}
                    readOnly={quantityFromQr}
                    aria-label="Material roll quantity"
                    onChange={(event) => {
                      const quantity = Math.max(1, Number(event.target.value) || 1);
                      setItems((old) => old.map((m, i) => (i === active ? { ...m, quantity } : m)));
                    }}
                    style={{ width: 100, minHeight: 38, padding: "0 8px" }}
                  /> {"pcs"} {quantityFromQr && <small style={{ color: "#36d399" }}>From material QR</small>}
                </dd>
              </div>
              {bindingOnly && <div>
                <dt>Roll count</dt>
                <dd>
                  <input
                    type="number"
                    min="1"
                    value={rollCount}
                    aria-label="Number of rolls"
                    onChange={(event) => setRollCount(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                    style={{ width: 100, minHeight: 38, padding: "0 8px" }}
                  /> rolls
                </dd>
              </div>}
              <div>
                <dt>{t.feeder}</dt>
                <dd>{values[3] || waitingForMes}</dd>
              </div>
              <div>
                <dt>{t.channel}</dt>
                <dd>{values[2] || waitingForMes}</dd>
              </div>
              <div>
                <dt>{t.machine}</dt>
                <dd>{values[1] || waitingForMes}</dd>
              </div>
            </dl>
            {!bindingOnly && <section style={{margin:"16px 0",padding:16,border:`2px solid ${loadingTarget ? "#18c6d9" : "#536572"}`,borderRadius:8,background:loadingTarget?"#12343b":"#192833"}} aria-label="MES loading destination">
              <div style={{fontSize:12,fontWeight:800,letterSpacing:".08em",color:"#18c6d9",marginBottom:10}}>MES LOADING DESTINATION</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,textAlign:"center"}}>
                <div className={`target-qr-card ${loadingTarget&&step===1?(scanError?"scan-wrong":"flashing"):step>1?"verified":""}`}><small>Machine Number</small><strong>{loadingTarget?.machineCode || waitingForMes}</strong>{loadingTarget&&step===1&&<em>{scanError?"WRONG QR 鈥?SCAN AGAIN":"SCAN QR"}</em>}</div>
                <div className={`target-qr-card ${loadingTarget&&step===2?(scanError?"scan-wrong":"flashing"):step>2?"verified":""}`}><small>Channel Number</small><strong>{loadingTarget?.channelCode || waitingForMes}</strong>{loadingTarget&&step===2&&<em>{scanError?"WRONG QR 鈥?SCAN AGAIN":"SCAN QR"}</em>}</div>
                <div className={`target-qr-card ${loadingTarget&&step===3?(scanError?"scan-wrong":"flashing"):step>3?"verified":""}`}><small>Feeder Number</small><strong>{loadingTarget?.feederCode || waitingForMes}</strong>{loadingTarget&&step===3&&<em>{scanError?"WRONG QR 鈥?SCAN AGAIN":"SCAN QR"}</em>}</div>
              </div>
              <div style={{marginTop:10,color:"#f2f6f8",fontWeight:700}}>{loadingTarget ? "Go to this position, then scan machine 鈫?channel 鈫?feeder to verify." : "Scan a material roll QR to receive the MES loading destination."}</div>
            </section>}
            {!bindingOnly && <section style={{margin:"16px 0",padding:16,border:"2px solid #536572",borderRadius:8,background:"#192833"}} aria-label="WMS source and destination confirmation">
              <div style={{fontSize:12,fontWeight:800,letterSpacing:".08em",color:"#f0b429",marginBottom:10}}>WMS SOURCE → DESTINATION</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <label style={{color:"#f2f6f8",fontWeight:700}}>来源库位 / Source location<input aria-label="Source location" value={sourceLocationCode} onChange={e=>setSourceLocationCode(e.target.value.toUpperCase())} disabled={loadingBusy} style={{width:"100%",minHeight:42,marginTop:5}} /></label>
                <label style={{color:"#f2f6f8",fontWeight:700}}>目标库位 / Destination location<input aria-label="Destination location" value={destinationLocationCode} onChange={e=>setDestinationLocationCode(e.target.value.toUpperCase())} disabled={loadingBusy} style={{width:"100%",minHeight:42,marginTop:5}} /></label>
              </div>
              <div style={{marginTop:10,color:loadingStatus==="FAILED"?"#ff8a80":loadingStatus==="COMPLETED"?"#36d399":"#b8c7d1",fontWeight:700}} aria-live="polite">状态 / Status: {loadingStatus}{loadingStatus==="VALIDATING"?" · validating operator, lot and quantity":loadingStatus==="COMMITTING"?" · posting MES binding and WMS ledger":loadingStatus==="COMPLETED"?" · WMS ledger posted":" · source and destination must be confirmed"}</div>
            </section>}
            <input
              className="scan-input"
              value={scanInput}
              readOnly
              autoFocus
              inputMode="none"
              disabled={complete}
              placeholder={complete ? t.done : `QR scanner 鈫?${labels[step]}`}
              style={{
                width: "100%",
                minHeight: 48,
                margin: "16px 0",
                padding: "0 14px",
                border: "2px solid #18c6d9",
                borderRadius: 6,
                background: "#08131d",
                color: "#f2f6f8",
                fontSize: 16,
              }}
            />
            <button
              type="button"
              onClick={() => void openCamera("workflow")}
              disabled={complete}
              style={{
                width: "100%",
                minHeight: 48,
                marginBottom: 16,
                border: "1px solid #18c6d9",
                borderRadius: 6,
                background: "#12343b",
                color: "#18c6d9",
                fontWeight: 700,
              }}
            >
              馃摲 Camera QR scan
            </button>
            {cameraOpen && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 20,
                  background: "#000",
                  padding: 16,
                }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  style={{ width: "100%", height: "80%", objectFit: "cover" }}
                />
                <button
                  type="button"
                  onClick={closeCamera}
                  style={{
                    width: "100%",
                    minHeight: 52,
                    marginTop: 16,
                    border: 0,
                    borderRadius: 6,
                    background: "#ef5350",
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  Close camera
                </button>
              </div>
            )}
            <div className="binding-steps">
              {labels.map((label, i) => (
                <div
                  key={label}
                  className={`binding-step ${i < step ? "done" : i === step ? "active" : "pending"}`}
                >
                  <span>{i + 1}</span>
                  <div>
                    <strong>{label}</strong>
                    <small>{values[i]}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="qr-hint">
              {complete ? t.done : pendingBinding ? t.activateBinding : phase === "binding" ? t.bindingPage : `${t.scan}: ${labels[step]}`}
              <br />
              <small>{t.blocked}</small>
            </div>
            {scanError && <div role="alert" style={{ color: "#fff", background:"#a81717", border:"2px solid #ff5a5a", borderRadius:6, padding:"12px 14px", fontWeight: 900, marginBottom: 12 }}>鈿?{scanError}</div>}
            {bindingMessage && <div style={{ color: "#36d399", fontWeight: 700, marginBottom: 12 }}>{bindingMessage}</div>}
            <div className="actions">
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <button type="button" onClick={() => moveMaterial(-1)} disabled={active === 0} style={{ flex: 1, minHeight: 48 }}>
                  鈫?{t.previous}
                </button>
                <button type="button" onClick={() => moveMaterial(1)} disabled={active === items.length - 1} style={{ flex: 1, minHeight: 48 }}>
                  {t.forward} 鈫?                </button>
              </div>
              {!bindingOnly && <button type="button" onClick={showStatus}>
                Loading status
              </button>}
              {!bindingOnly && <button type="button" onClick={() => setShowBindingMap(true)}>
                Binding map
              </button>}
              {phase === "binding" && !complete && (
                <button
                  type="button"
                  className="primary"
                  disabled={!pendingBinding || bindingBusy}
                  title={!pendingBinding ? t.bindingIncomplete : t.completeBinding}
                  onClick={() => pendingBinding && void commitBindingToMes(pendingBinding)}
                >
                  {bindingBusy ? "Saving to MES..." : t.completeBinding}
                </button>
              )}
              <button
                className="primary"
                onClick={() => void openCamera("workflow")}
                disabled={complete || step >= labels.length || Boolean(pendingBinding)}
              >
                {complete ? t.done : `馃摲 ${t.next}: ${labels[step]}`}
              </button>
              {!bindingOnly && <button
                onClick={() => void load()}
                disabled={!complete || loadingBusy || current.loaded >= current.quantity}
              >
                {loadingBusy ? "Waiting for MES..." : t.load}
              </button>}
            </div>
          </div>
        </section>
      </main>
      {loadingSuccess&&<div className="loading-success-overlay" role="dialog" aria-modal="true" aria-labelledby="loading-success-title">
        <section className="loading-success-dialog">
          <div className="loading-success-mark" aria-hidden="true">✓</div>
          <h2 id="loading-success-title">上料成功</h2>
          <p>本次上料已由 MES 确认并同步。</p>
          <dl>
            <div><dt>WO</dt><dd>{loadingSuccess.workOrderCode}</dd></div>
            <div><dt>料卷 SN</dt><dd>{loadingSuccess.materialSn}</dd></div>
            <div><dt>机位 SN</dt><dd>{loadingSuccess.machineCode}</dd></div>
            <div><dt>槽位 SN</dt><dd>{loadingSuccess.channelCode}</dd></div>
            <div><dt>Feeder SN</dt><dd>{loadingSuccess.feederCode}</dd></div>
            <div><dt>上料数量</dt><dd>{loadingSuccess.loadedQty.toLocaleString()} pcs</dd></div>
          </dl>
          <small>MES Event ID: {loadingSuccess.eventId}</small>
          <button type="button" className="primary" onClick={acknowledgeLoadingSuccess}>{active<items.length-1?"确认，进入下一料卷":"确认，本工单上料完成"}</button>
        </section>
      </div>}
      {registrationRequired&&<div className="loading-success-overlay" role="alertdialog" aria-modal="true" aria-labelledby="registration-required-title">
        <section className="loading-success-dialog" style={{borderColor:"#f0b429",background:"#fff8df",color:"#4a3200"}}>
          <div className="loading-success-mark" aria-hidden="true" style={{background:"#f0b429"}}>!</div>
          <h2 id="registration-required-title">需要注册物料绑定</h2>
          <p>MES 未找到该物料卷的绑定记录。请继续扫描机位、通道和 Feeder，完成注册后才能上料。</p>
          <button type="button" className="primary" onClick={()=>setRegistrationRequired(false)}>继续扫描并注册</button>
        </section>
      </div>}
    </>
  );
}

function LoadingStatus({
  lang,
  setLang,
  back,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  back: () => void;
}) {
  const t = T[lang];
  return (
    <>
      <Header lang={lang} setLang={setLang} back={back} t={t} />
      <main className="container">
        <div className="page-title">
          <div>
            <p className="eyebrow">{t.domain}</p>
            <h1>Loading status</h1>
            <p className="muted">WO {selectedWorkOrder.id} 路 109 BOM materials</p>
          </div>
          <span className="domain">
            {t.workOrder}: {selectedWorkOrder.id}
          </span>
        </div>
        <section className="materials status-materials">
          {materials.map((m, i) => (
            <div key={m.code} className="material-row">
              <div>
                <strong>
                  {i + 1}. {m.name}
                </strong>
                <small>
                  {m.code} 路 {m.sn}
                </small>
              </div>
              <div className="qty">
                {m.loaded} / {m.quantity} pcs
              </div>
              <span
                className={`state ${m.loaded >= m.quantity ? "done" : "pending"}`}
              >
                {m.loaded >= m.quantity ? "Loaded" : "Waiting"}
              </span>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}

function BindingMap({
  lang,
  setLang,
  rules,
  back,
  workOrderId,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  rules: Record<string, string[]>;
  back: () => void;
  workOrderId: string;
}) {
  const t = T[lang];
  const selectedWorkOrder = workOrders.find((wo) => wo.id === workOrderId) ?? workOrders[0];
  const [mesBindings, setMesBindings] = useState<Array<{id:number;machineCode:string;channelCode:string;feederCode:string;materialCode:string;materialName?:string;materialSn:string;quantityPerRoll:number;rollCount:number}>>([]);
  const [mapMessage, setMapMessage] = useState("Loading MES binding map...");
  useEffect(() => {
    void fetch(`${mesApiBase()}/mes/material-roll-bindings?workOrderCode=${encodeURIComponent(selectedWorkOrder.id)}`)
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error?.message || "MES binding map failed");
        setMesBindings(result?.data?.items || result?.items || []);
        setMapMessage("");
      })
      .catch((error) => setMapMessage(error instanceof Error ? error.message : "MES binding map failed"));
  }, [selectedWorkOrder.id]);
  return (
    <>
      <Header lang={lang} setLang={setLang} back={back} t={t} />
      <main className="container">
        <div className="page-title">
          <div>
            <p className="eyebrow">{t.domain}</p>
            <h1>Binding map</h1>
            <p className="muted">WO {workOrders[0].id} 路 PDA-created binding rules</p>
          </div>
          <span className="domain">{t.workOrder}: {workOrders[0].id}</span>
        </div>
        {mapMessage && <div className="qr-hint">{mapMessage}</div>}
        {mesBindings.length > 0 && <section className="materials status-materials" style={{ marginBottom: 16 }}>
          {mesBindings.map((binding, i) => <div key={binding.id} className="material-row">
            <div><strong>{i + 1}. {binding.materialName || binding.materialCode}</strong><small>{binding.materialCode} 路 SN {binding.materialSn}</small></div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(5,minmax(72px,1fr))", gap: 8, fontSize: 12 }}>
              <span>Machine<br/><strong>{binding.machineCode}</strong></span>
              <span>Channel<br/><strong>{binding.channelCode}</strong></span>
              <span>Feeder<br/><strong>{binding.feederCode}</strong></span>
              <span>Qty/roll<br/><strong>{binding.quantityPerRoll}</strong></span>
              <span>Rolls<br/><strong>{binding.rollCount}</strong></span>
            </div>
            <span className="state done">Bound</span>
          </div>)}
        </section>}
        {!mapMessage && mesBindings.length === 0 && <div className="qr-hint">No completed bindings for this work order.</div>}
        <section className="materials status-materials">
          {materials.map((m, i) => {
            const rule = rules[m.code];
            return (
              <div key={m.code} className="material-row">
                <div>
                  <strong>{i + 1}. {m.name}</strong>
                  <small>{m.code} 路 {m.sn}</small>
                </div>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(4, minmax(90px, 1fr))", gap: 8, fontSize: 12 }}>
                  <span>Machine<br /><strong>{rule?.[0] ?? "—"}</strong></span>
                  <span>Channel<br /><strong>{rule?.[1] ?? "—"}</strong></span>
                  <span>Feeder<br /><strong>{rule?.[2] ?? "—"}</strong></span>
                  <span>Material<br /><strong>{rule?.[3] ?? "Unbound"}</strong></span>
                </div>
                <span className={`state ${rule ? "done" : "pending"}`}>{rule ? "Bound" : "Unbound"}</span>
              </div>
            );
          })}
        </section>
      </main>
    </>
  );
}

function RealMachineMapping({lang,setLang}:{lang:Lang;setLang:(l:Lang)=>void}) {
  const t=T[lang];
  const channelPositions=Array.from({length:34},(_,index)=>({side:index<17?"L":"R",position:index%17+1,label:`${index<17?"L":"R"}${String(index%17+1).padStart(2,"0")}`}));
  const [machines,setMachines]=useState(()=>Array.from({length:6},(_,i)=>({machineNo:i+1,machineSn:"",channels:Array(34).fill("")})));
  const [active,setActive]=useState(0);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [cameraOpen,setCameraOpen]=useState(false);
  const [scanTarget,setScanTarget]=useState<{kind:"machine"}|{kind:"channel";index:number}|null>(null);
  const cameraStream=useRef<MediaStream|null>(null);
  const videoRef=useRef<HTMLVideoElement|null>(null);
  const closeCamera=()=>{cameraStream.current?.getTracks().forEach(track=>track.stop());cameraStream.current=null;setCameraOpen(false)};
  const applyScan=(value:string)=>{
    const qr=value.trim();if(!qr||!scanTarget)return;
    setMachines(old=>old.map((m,i)=>i!==active?m:scanTarget.kind==="machine"?{...m,machineSn:qr}:{...m,channels:m.channels.map((v,j)=>j===scanTarget.index?qr:v)}));
    setMessage(lang==="zh"?`扫描成功：${qr}`:lang==="vi"?`Quét thành công: ${qr}`:`Scan successful: ${qr}`);setScanTarget(null);
  };
  const openCamera=async(target:{kind:"machine"}|{kind:"channel";index:number})=>{
    setMessage("");setScanTarget(target);
    const bridge=(window as Window & {AndroidCamera?:{startScanner:()=>void}}).AndroidCamera;
    if(bridge?.startScanner){bridge.startScanner();return;}
    try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});cameraStream.current=stream;setCameraOpen(true);requestAnimationFrame(()=>{if(videoRef.current)videoRef.current.srcObject=stream})}
    catch(error){setMessage(lang==="zh"?"无法打开相机，请允许相机权限。":"Camera permission is required.");setScanTarget(null)}
  };
  useEffect(()=>{
    if(!cameraOpen)return;const reader=new BrowserMultiFormatReader(undefined,{delayBetweenScanAttempts:120,delayBetweenScanSuccess:500});let stopped=false;let controls:{stop:()=>void}|undefined;
    const start=async()=>{if(!cameraStream.current||!videoRef.current)return;try{controls=await reader.decodeFromStream(cameraStream.current,videoRef.current,result=>{const value=String(result?.getText()||"").trim();if(!value||stopped)return;stopped=true;controls?.stop();closeCamera();applyScan(value)})}catch(error){if(!stopped)setMessage(lang==="zh"?"相机扫码启动失败":"Camera scanner failed")}};
    void start();return()=>{stopped=true;controls?.stop()};
  },[cameraOpen,active,scanTarget]);
  useEffect(()=>{
    (window as Window & {receiveNativeScan?:(value:string)=>void}).receiveNativeScan=(value)=>applyScan(value);
    return()=>{delete (window as Window & {receiveNativeScan?:(value:string)=>void}).receiveNativeScan};
  },[active,scanTarget,lang]);
  const save=async()=>{
    setSaving(true);setMessage("");
    try{
      const records=machines.flatMap(machine=>machine.channels.map((channel,index)=>({machineNo:machine.machineNo,machineSn:machine.machineSn.trim(),channelSide:channelPositions[index].side,channelNo:channelPositions[index].position,channelCode:channelPositions[index].label,channelSn:channel.trim()}))).filter(item=>item.machineSn&&item.channelSn);
      const token=await getPdaMesToken();const response=await fetch(`${mesApiBase()}/mes/smt-machine-mapping`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({records,operator:pdaOperator(),deviceId:pdaDeviceId()})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error?.message||"MES save failed");const count=body?.data?.saved??records.length;
      setMessage(lang==="zh"?`已保存 ${count} 条固定映射到 MES`:lang==="vi"?`Đã lưu ${count} ánh xạ cố định vào MES`:`Saved ${count} fixed mappings to MES`);
    }catch(error){setMessage(error instanceof Error?error.message:"MES save failed");}finally{setSaving(false)}
  };
  const machine=machines[active];
  return <><Header lang={lang} setLang={setLang} t={t}/><main className="container mapping-page">
    <div className="page-title"><div><p className="eyebrow">SMT · REAL MACHINE MAPPING</p><h1>{lang==="zh"?"实体机器映射":lang==="vi"?"Ánh xạ máy thực tế":"Real Machine Mapping"}</h1><p className="muted">{lang==="zh"?"6 台机器；每台左侧 L01–L17、右侧 R01–R17，共 34 个固定通道。":lang==="vi"?"6 máy; mỗi máy có L01–L17 bên trái và R01–R17 bên phải.":"Six machines; each has fixed left L01–L17 and right R01–R17 channels."}</p></div></div>
    <section className="mapping-machine-tabs">{machines.map((m,i)=><button key={m.machineNo} className={active===i?"active":""} onClick={()=>setActive(i)}>M{i+1}<small>{m.machineSn||"未填写"}</small></button>)}</section>
    <section className="mapping-form"><label className="machine-sn-field"><strong>Machine {machine.machineNo} · {lang==="zh"?"机器 QR / SN":"Machine QR / SN"}</strong><div className="mapping-scan-row"><input value={machine.machineSn} readOnly inputMode="none" placeholder={`Machine ${machine.machineNo} QR/SN`}/><button type="button" onClick={()=>void openCamera({kind:"machine"})}>📷 {lang==="zh"?"扫描机器":"Scan"}</button></div></label>
      <div className="channel-input-grid">{machine.channels.map((value,index)=><label key={index}><span>Machine {machine.machineNo} · {channelPositions[index].label} ({channelPositions[index].side==="L"?"左侧":"右侧"})</span><div className="mapping-scan-row"><input value={value} readOnly inputMode="none" placeholder={`${channelPositions[index].label} QR / SN`}/><button type="button" onClick={()=>void openCamera({kind:"channel",index})}>📷 {lang==="zh"?"扫描":"Scan"}</button></div></label>)}</div>
    </section>
    {message&&<p className="mapping-message">{message}</p>}<button className="wo-confirm" disabled={saving} onClick={()=>void save()}>{saving?"Saving...":lang==="zh"?"确认并保存到 MES":lang==="vi"?"Xác nhận và lưu vào MES":"Confirm and save to MES"}</button>
  </main>{cameraOpen&&<div className="camera-overlay"><video ref={videoRef} autoPlay playsInline/><div className="camera-guide"><span/><strong>{lang==="zh"?"将二维码对准扫描框":lang==="vi"?"Đưa mã QR vào khung quét":"Align QR code inside the frame"}</strong></div><button type="button" onClick={()=>{closeCamera();setScanTarget(null)}}>{lang==="zh"?"关闭相机":"Close camera"}</button></div>}</>;
}

function BottomNav({
  lang,
  tab,
  goHome,
  goBinding,
  goLoading,
  goStatus,
  goQr,
  goReceiving,
}: {
  lang: Lang;
  tab: "home" | "binding" | "loading" | "status" | "qr" | "mapping" | "receiving";
  goHome: () => void;
  goBinding: () => void;
  goLoading: () => void;
  goStatus: () => void;
  goQr: () => void;
  goReceiving: () => void;
}) {
  const labels = {
    en: ["Work Orders", "Receive", "Scan Material", "Status"],
    zh: ["工单", "收料", "扫描物料", "状态"],
    vi: ["Lệnh SX", "Nhận liệu", "Quét vật liệu", "Trạng thái"],
  }[lang];
  const items: Array<[typeof tab, string, () => void]> = [
    ["home", labels[0], goHome],
    ["receiving", labels[1], goReceiving],
    ["loading", labels[2], goLoading],
    ["status", labels[3], goStatus],
  ];
  return (
    <nav className="bottom-nav" aria-label="PDA navigation">
      {items.map(([key, label, action]) => (
        <button key={key} className={tab === key ? "selected" : ""} onClick={action}>
          <span className="bottom-nav-icon">{key === "home" ? "▦" : key === "loading" ? "⇧" : "●"}</span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function MaterialReceivingPage({ lang, setLang, back }: { lang: Lang; setLang: (l: Lang) => void; back: () => void }) {
  const [supplier, setSupplier] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [palletQr, setPalletQr] = useState("");
  const [locationQr, setLocationQr] = useState("");
  const [boxes, setBoxes] = useState<string[]>([]);
  const [iqcResult, setIqcResult] = useState<"PENDING" | "PASS" | "FAIL">("PENDING");
  const [scanTarget, setScanTarget] = useState<"supplier" | "lot" | "pallet" | "location" | "box" | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const t = (en: string, zh: string, vi: string) => lang === "zh" ? zh : lang === "vi" ? vi : en;
  const closeCamera = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setCameraOpen(false); setScanTarget(null); };
  const applyScan = (raw: string) => {
    const parsed = parseReceivingQr(raw); const value = parsed.value || parsed.qr || parsed.code || parsed.id || raw.trim();
    if (!value) return;
    if (scanTarget === "supplier") setSupplier(parsed.supplier || parsed.suppliername || value);
    if (scanTarget === "lot") setLotNo(parsed.lot || parsed.lotno || parsed.batch || value);
    if (scanTarget === "pallet") setPalletQr(parsed.palletqr || parsed.pallet || parsed.qr || value);
    if (scanTarget === "location") setLocationQr(parsed.locationqr || parsed.location || parsed.qr || value);
    if (scanTarget === "box") setBoxes((old) => old.includes(value) ? old : [...old, value]);
    publishPdaLoadingStatus({ phase: "SCANNED", receivingField: scanTarget, supplier, lotNo, palletQr, locationCode: locationQr, boxQr: value, iqcResult, operator: pdaOperator() });
    closeCamera();
  };
  const openScanner = async (target: typeof scanTarget) => {
    setScanTarget(target); setMessage("");
    const bridge = (window as Window & { AndroidCamera?: { startScanner: () => void } }).AndroidCamera;
    if (bridge?.startScanner) { bridge.startScanner(); return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); streamRef.current = stream; setCameraOpen(true); requestAnimationFrame(() => { if (videoRef.current) videoRef.current.srcObject = stream; }); }
    catch { setMessage(t("Camera permission is required.", "请允许相机权限。", "Cần cấp quyền camera.")); setScanTarget(null); }
  };
  useEffect(() => {
    (window as Window & { receiveNativeScan?: (value: string) => void }).receiveNativeScan = applyScan;
    return () => { delete (window as Window & { receiveNativeScan?: (value: string) => void }).receiveNativeScan; };
  });
  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return;
    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 500 }); let stopped = false; let controls: { stop: () => void } | undefined;
    void reader.decodeFromStream(streamRef.current, videoRef.current, (result) => { const value = String(result?.getText() || "").trim(); if (!value || stopped) return; stopped = true; controls?.stop(); applyScan(value); });
    return () => { stopped = true; controls?.stop(); };
  }, [cameraOpen, scanTarget]);
  const submit = async () => {
    if (!supplier.trim() || !lotNo.trim() || !palletQr.trim() || !locationQr.trim() || !boxes.length) { setMessage(t("Supplier, lot, pallet, location and at least one box are required.", "供应商、批次、托盘、库位和至少一个箱码不能为空。", "Cần nhà cung cấp, lot, pallet, vị trí và ít nhất một box.")); return; }
    if (iqcResult === "FAIL") { setMessage(t("IQC failed material cannot be received as available stock.", "IQC 不合格物料不能作为可用库存收料。", "Vật liệu IQC lỗi không thể nhập kho khả dụng.")); return; }
    setSaving(true); setMessage(""); publishPdaLoadingStatus({ phase: "RECEIVING", supplier, lotNo, palletQr, locationCode: locationQr, boxQrs: boxes, iqcResult, operator: pdaOperator() });
    try {
      const token = await getPdaMesToken();
      for (const boxQr of boxes) {
        const response = await fetch(`${mesApiBase()}/api/wms/receiving/pallet-box-bindings`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ palletQr, boxQr, lotNo, supplier, locationQr, iqcResult }) });
        const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error?.message || `Box ${boxQr} rejected`);
      }
      publishPdaLoadingStatus({ phase: "COMPLETED", supplier, lotNo, palletQr, locationCode: locationQr, boxQrs: boxes, iqcResult, operator: pdaOperator() });
      setMessage(t(`Received ${boxes.length} box(es).`, `已收料 ${boxes.length} 箱。`, `Đã nhận ${boxes.length} box.`)); setBoxes([]);
    } catch (error) { publishPdaLoadingStatus({ phase: "FAILED", supplier, lotNo, palletQr, locationCode: locationQr, iqcResult, operator: pdaOperator() }); setMessage(error instanceof Error ? error.message : "WMS receiving failed"); }
    finally { setSaving(false); }
  };
  const field = (label: string, value: string, setValue: (value: string) => void, target: typeof scanTarget) => <label style={{ display: "block", marginBottom: 12 }}><strong>{label}</strong><div style={{ display: "flex", gap: 8 }}><input value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: 1, minHeight: 44 }} /><button type="button" onClick={() => void openScanner(target)}>📷</button></div></label>;
  return <><Header lang={lang} setLang={setLang} back={back} t={T[lang]} /><main className="container"><div className="page-title"><div><p className="eyebrow">WMS · MATERIAL RECEIVING</p><h1>{t("Material Receiving", "物料收料", "Nhận vật liệu")}</h1><p className="muted">{t("Scan and bind pallet, boxes, lot and warehouse location.", "扫描并绑定托盘、箱、批次和仓库库位。", "Quét và liên kết pallet, box, lot và vị trí kho.")}</p></div></div><section className="detail" style={{ maxWidth: 720, margin: "0 auto" }}>{field(t("Supplier", "供应商", "Nhà cung cấp"), supplier, setSupplier, "supplier")}{field(t("Lot / batch", "批次 / Lot", "Lot / lô"), lotNo, setLotNo, "lot")}{field(t("Pallet QR", "托盘 QR", "QR pallet"), palletQr, setPalletQr, "pallet")}{field(t("Location QR", "库位 QR", "QR vị trí"), locationQr, setLocationQr, "location")}<label style={{ display: "block", marginBottom: 12 }}><strong>{t("Supplier IQC result", "供应商 IQC 结果", "Kết quả IQC nhà cung cấp")}</strong><select value={iqcResult} onChange={(e) => setIqcResult(e.target.value as typeof iqcResult)} style={{ width: "100%", minHeight: 44 }}><option value="PENDING">PENDING · {t("Uninspected", "待检", "Chờ kiểm tra")}</option><option value="PASS">PASS · {t("Qualified", "合格", "Đạt")}</option><option value="FAIL">FAIL · {t("Rejected", "不合格", "Lỗi")}</option></select></label><div style={{ border: "1px solid #294653", padding: 12, marginBottom: 12 }}><strong>{t("Box QRs on pallet", "托盘上的箱 QR", "QR box trên pallet")}</strong>{boxes.map((box) => <div key={box} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span>{box}</span><button type="button" onClick={() => setBoxes((old) => old.filter((item) => item !== box))}>×</button></div>)}<button type="button" onClick={() => void openScanner("box")} style={{ width: "100%", minHeight: 44 }}>📷 {t("Scan box QR", "扫描箱 QR", "Quét QR box")}</button></div>{message && <p role="alert" style={{ color: message.includes("Received") || message.includes("已收料") || message.includes("Đã nhận") ? "#36d399" : "#ff8b8b" }}>{message}</p>}<button className="wo-confirm" disabled={saving} onClick={() => void submit()}>{saving ? t("Submitting...", "提交中...", "Đang gửi...") : t("Receive and bind to WMS", "收料并绑定到 WMS", "Nhận và liên kết WMS")}</button></section></main>{cameraOpen && <div className="camera-overlay"><video ref={videoRef} autoPlay playsInline /><button type="button" onClick={closeCamera}>{t("Close camera", "关闭相机", "Đóng camera")}</button></div>}</>;
}

function QrGenerator({ lang, setLang, back }: { lang: Lang; setLang: (l: Lang) => void; back: () => void }) {
  const t = T[lang];
  const [rollSn, setRollSn] = useState("RJ-VN-20260813-000001");
  const [quantity, setQuantity] = useState(5000);
  const [qr, setQr] = useState("");
  const payload = JSON.stringify({
    schema: "ruijing.material-roll.v1",
    materialSn: rollSn,
    quantity,
    unit: "PCS",
  });
  useEffect(() => { void QRCode.toDataURL(payload, { width: 320, margin: 2 }).then(setQr); }, [payload]);
  return <>
    <Header lang={lang} setLang={setLang} back={back} t={t} />
    <main className="container">
      <div className="page-title"><div><p className="eyebrow">RUIJING VIETNAM 路 MATERIAL CONTROL</p><h1>Material Roll QR Generator</h1><p className="muted">Generate a QR containing the Ruijing material roll SN and its quantity.</p></div></div>
      <section className="detail" style={{ maxWidth: 720, margin: "0 auto" }}>
        <label>Ruijing material roll SN<input aria-label="Ruijing material roll SN" value={rollSn} onChange={(e) => setRollSn(e.target.value)} style={{ width: "100%", minHeight: 48 }} /></label>
        <label>Roll quantity<input aria-label="QR material quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} style={{ width: "100%", minHeight: 48 }} /></label>
        {qr && <div style={{ background: "white", color: "#111", padding: 16, marginTop: 16, textAlign: "center" }}><strong>RUIJING MATERIAL ROLL</strong><br/><span>SN {rollSn}</span><br/><img src={qr} alt="Ruijing material roll QR code" style={{ width: 320, maxWidth: "100%" }} /><br/><span>QTY {quantity} PCS</span></div>}
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{payload}</pre>
      </section>
    </main>
  </>;
}

function App() {
  const [lang, setLang] = useState<Lang>("zh");
  useEffect(() => { void getPdaMesToken().catch(() => undefined); }, []);
  const [open, setOpen] = useState(false);
  const [activeWorkOrderId, setActiveWorkOrderId] = useState(workOrders[0].id);
  const [status, setStatus] = useState(false);
  const [bindingMap, setBindingMap] = useState(false);
  const [bindingOnly, setBindingOnly] = useState(false);
  const [qrGenerator, setQrGenerator] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const tab = qrGenerator ? "qr" : receiving ? "receiving" : status ? "status" : bindingOnly || bindingMap ? "binding" : open ? "loading" : "home";
  const page = qrGenerator ? <QrGenerator lang={lang} setLang={setLang} back={() => setQrGenerator(false)} /> : receiving ? (
      <MaterialReceivingPage lang={lang} setLang={setLang} back={() => setReceiving(false)} />
  ) : status ? (
      <LoadingStatus
        lang={lang}
        setLang={setLang}
        back={() => setStatus(false)}
      />
  ) : bindingMap ? (
    <BindingMap
      lang={lang}
      setLang={setLang}
      rules={{}}
      workOrderId={activeWorkOrderId}
      back={() => setBindingMap(false)}
    />
  ) : open ? (
    <MaterialLoading
      lang={lang}
      setLang={setLang}
      back={() => setOpen(false)}
      showStatus={() => setStatus(true)}
      workOrderId={activeWorkOrderId}
      bindingOnly={bindingOnly}
    />
  ) : (
    <WorkOrders
      lang={lang}
      setLang={setLang}
      activeWorkOrderId={activeWorkOrderId}
      select={setActiveWorkOrderId}
      // Keep the confirm action inside the unified PDA SPA.  Opening the MES
      // URL here sent the operator away from the loading workflow.
      confirm={() => setOpen(true)}
    />
  );
  return (
    <>
      <div className="app-shell">{page}</div>
      <BottomNav
        lang={lang}
        tab={tab}
        goHome={() => { setQrGenerator(false); setReceiving(false); setStatus(false); setBindingMap(false); setBindingOnly(false); setOpen(false); }}
        goReceiving={() => { setQrGenerator(false); setReceiving(true); setStatus(false); setBindingMap(false); setBindingOnly(false); setOpen(false); }}
        goBinding={() => { setQrGenerator(false); setStatus(false); setBindingMap(false); setBindingOnly(true); setOpen(true); }}
        goLoading={() => { setQrGenerator(false); setStatus(false); setBindingMap(false); setBindingOnly(false); setOpen(true); }}
        goStatus={() => { setQrGenerator(false); setBindingMap(false); setStatus(true); }}
        goQr={() => { setStatus(false); setBindingMap(false); setBindingOnly(false); setOpen(false); setQrGenerator(true); }}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
