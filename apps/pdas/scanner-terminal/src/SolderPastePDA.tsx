/**
 * SolderPastePDA — 锡膏管理 PDA 页面
 * 扫描批次条码 → 开封(温度/湿度/拍照) / 消耗(工单/机台) / 关闭
 *
 * 移动端优先：大按钮、高对比度、语音反馈、最少输入
 *
 * API: http://127.0.0.1:8080 (Node API — JWT auth required)
 * MES: /api/mes/work-orders/active (工单查询)
 * QMS: /api/qms/solder-paste/thresholds (质量阈值)
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

// ── Config ────────────────────────────────────────────────────────────────────
const API = (window as any).__API_BASE__ ?? `${window.location.protocol}//${window.location.hostname}:8080`;
const TTS_LANG = "zh-CN";

// ── i18n ──────────────────────────────────────────────────────────────────────
const I18N: Record<string, Record<string, string>> = {
  "zh-CN": {
    title: "锡膏管理",
    scan_hint: "请扫描锡膏批次条码",
    scanning: "正在查询...",
    no_data: "未找到该批次",
    // Status
    status_frozen: "冷冻中",
    status_opened: "开封中",
    status_exhausted: "已用完",
    status_expired: "已过期",
    remaining_hours: "剩余",
    remaining_days: "剩余天数",
    // QMS
    temp超标: "温度超标",
    humidity超标: "湿度超标",
    temp_ok: "温度正常",
    humidity_ok: "湿度正常",
    // Actions
    action_open: "📦 开封锡膏",
    action_consume: "📉 记录消耗",
    action_close: "✅ 关闭开封",
    action_back: "← 返回",
    // Open form
    open_title: "开封锡膏",
    open_lot: "批次号",
    open_shelf_life: "开封有效期（小时）",
    open_temp: "温度（°C）",
    open_humidity: "湿度（%）",
    open_temp_required: "温度°C（必填，超标触发预警）",
    open_humidity_required: "湿度%（必填，超标触发预警）",
    open_image: "开封照片URL",
    open_line: "产线",
    open_machine: "机台",
    open_submit: "确认开封",
    // Consume form
    consume_title: "记录锡膏消耗",
    consume_lot: "批次号",
    consume_remaining: "剩余时间",
    consume_qty: "消耗数量(kg)",
    consume_qty_required: "消耗数量(kg)（必填）",
    consume_wo: "工单号",
    consume_line: "产线",
    consume_machine: "机台",
    consume_image: "消耗照片URL",
    consume_submit: "确认消耗",
    // Feedback
    success: "✓ 成功",
    error: "✗ 失败",
    network_error: "网络错误",
    auth_error: "认证失败，请重新登录",
    open_success: "开封成功",
    open_fail: "开封失败",
    consume_success: "消耗记录成功",
    consume_fail: "消耗记录失败",
    camera_placeholder: "📷 拍照（相机功能待集成）",
    threshold_info: "质量阈值",
    temp_threshold: "温度 ≤30°C",
    humidity_threshold: "湿度 ≤60%",
    exceeded: "超标",
    within_spec: "正常",
  },
  vi: {
    title: "Quản lý hàn",
    scan_hint: "Quét mã lô hàn",
    scanning: "Đang truy vấn...",
    no_data: "Không tìm thấy lô",
    status_frozen: "Đông lạnh",
    status_opened: "Đã mở",
    status_exhausted: "Đã dùng xong",
    status_expired: "Đã hết hạn",
    remaining_hours: "Còn lại",
    remaining_days: "Còn lại",
    temp超标: "Nhiệt độ vượt ngưỡng",
    humidity超标: "Độ ẩm vượt ngưỡng",
    temp_ok: "Nhiệt độ bình thường",
    humidity_ok: "Độ ẩm bình thường",
    action_open: "📦 Mở lô hàn",
    action_consume: "📉 Ghi tiêu thụ",
    action_close: "✅ Đóng mở",
    action_back: "← Quay lại",
    open_title: "Mở lô hàn",
    open_lot: "Mã lô",
    open_shelf_life: "Thời hạn sau mở (giờ)",
    open_temp: "Nhiệt độ (°C)",
    open_humidity: "Độ ẩm (%)",
    open_temp_required: "Nhiệt độ°C (bắt buộc)",
    open_humidity_required: "Độ ẩm% (bắt buộc)",
    open_image: "Ảnh mở URL",
    open_line: "Dây chuyền",
    open_machine: "Máy",
    open_submit: "Xác nhận mở",
    consume_title: "Ghi tiêu thụ hàn",
    consume_lot: "Mã lô",
    consume_remaining: "Còn lại",
    consume_qty: "Số lượng tiêu thụ(kg)",
    consume_qty_required: "Số lượng(kg) (bắt buộc)",
    consume_wo: "Mã WO",
    consume_line: "Dây chuyền",
    consume_machine: "Máy",
    consume_image: "Ảnh tiêu thụ URL",
    consume_submit: "Xác nhận tiêu thụ",
    success: "✓ Thành công",
    error: "✗ Thất bại",
    network_error: "Lỗi mạng",
    auth_error: "Lỗi xác thực",
    open_success: "Mở thành công",
    open_fail: "Mở thất bại",
    consume_success: "Ghi tiêu thụ thành công",
    consume_fail: "Ghi tiêu thụ thất bại",
    camera_placeholder: "📷 Chụp ảnh (chức năng camera chưa tích hợp)",
    threshold_info: "Ngưỡng chất lượng",
    temp_threshold: "Nhiệt độ ≤30°C",
    humidity_threshold: "Độ ẩm ≤60%",
    exceeded: "Vượt ngưỡng",
    within_spec: "Bình thường",
  },
};

// ── Auth helpers ───────────────────────────────────────────────────────────────
interface Auth { token: string; username: string; permissions: string[]; display_name?: string; }
function getAuth(): Auth | null {
  try { const raw = localStorage.getItem("solder_paste_auth"); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function setAuth(auth: Auth) { localStorage.setItem("solder_paste_auth", JSON.stringify(auth)); }

// ── API helpers ────────────────────────────────────────────────────────────────
async function apiFetch(path: string, options: RequestInit = {}, token?: string): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...(options.headers as Record<string, string> || {}) } });
  if (res.status === 401) { localStorage.removeItem("solder_paste_auth"); throw new Error("AUTH_ERROR"); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.data ?? body;
}

// ── TTS ─────────────────────────────────────────────────────────────────────────
function speak(text: string) {
  try {
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = TTS_LANG;
    utt.volume = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(utt);
  } catch { /* ignore */ }
}

// ── Types ────────────────────────────────────────────────────────────────────────
interface Lot {
  id: number; lot_no: string; material_code: string; material_name_zh: string;
  supplier_name: string; received_at: string; shelf_life_days: number; msd_level: string;
  qty_kg: number; qty_remaining_kg: number; status: string; iqc_status: string;
  remaining_days: number;
  open_temp?: number; open_humidity?: number; open_image_url?: string;
  line_code?: string; machine_code?: string;
}
interface ActiveOpening {
  id: number; lot_id: number; lot_no: string; material_code: string; material_name_zh: string;
  opened_at: string; shelf_life_hours: number; expires_at: string; status: string;
  consumption_kg: number; remaining_hours: number;
  open_temp?: number; open_humidity?: number;
  line_code?: string; machine_code?: string;
}
interface QmsThreshold {
  temp_max: number; humidity_max: number; open_shelf_life_hours_default: number; open_shelf_life_hours_max: number;
}

// ── Formatters ──────────────────────────────────────────────────────────────────
function fmtDt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtHours(h: number): string {
  if (!isFinite(h) || h < 0) return "已过期";
  if (h < 1) return Math.round(h * 60) + "m";
  if (h < 24) return h.toFixed(1) + "h";
  return (h / 24).toFixed(1) + "d";
}
function tempColor(temp: number | undefined, max: number): string {
  if (temp === undefined) return "var(--muted)";
  return temp > max ? "var(--danger)" : "var(--ok)";
}
function humidityColor(humidity: number | undefined, max: number): string {
  if (humidity === undefined) return "var(--muted)";
  return humidity > max ? "var(--danger)" : "var(--ok)";
}
function statusText(status: string, locale: string): string {
  const map: Record<string, Record<string, string>> = {
    frozen: { "zh-CN": "冷冻中", vi: "Đông lạnh" },
    opened: { "zh-CN": "开封中", vi: "Đã mở" },
    exhausted: { "zh-CN": "已用完", vi: "Đã dùng xong" },
    expired: { "zh-CN": "已过期", vi: "Đã hết hạn" },
    scrapped: { "zh-CN": "已报废", vi: "Đã thanh lý" },
    active: { "zh-CN": "开封中", vi: "Đã mở" },
    closed: { "zh-CN": "已关闭", vi: "Đã đóng" },
  };
  return map[status]?.[locale] ?? status;
}

// ── UI Components (inline, mobile-first) ──────────────────────────────────────
function BigButton({ onClick, variant = "primary", disabled = false, children }: {
  onClick?: () => void; variant?: string; disabled?: boolean; children: React.ReactNode;
}) {
  const base: React.CSSProperties = {
    display: "block", width: "100%", padding: "16px", borderRadius: 10,
    fontSize: 16, fontWeight: 700, border: "none", cursor: disabled ? "not-allowed" : "pointer",
    textAlign: "center", marginBottom: 10, opacity: disabled ? 0.5 : 1,
  };
  const colors: Record<string, React.CSSProperties> = {
    primary: { background: "#3b82f6", color: "#fff" },
    secondary: { background: "#374151", color: "#9ca3af" },
    danger: { background: "#dc2626", color: "#fff" },
    success: { background: "#16a34a", color: "#fff" },
    warning: { background: "#d97706", color: "#fff" },
  };
  return (
    <button style={{ ...base, ...colors[variant] }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function InputField({ label, value, onChange, type = "text", placeholder, disabled, required, step }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; disabled?: boolean; required?: boolean; step?: string;
}) {
  const [id] = useState(() => Math.random().toString(36).slice(2));
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
        {label}{required && <span style={{ color: "#f87171" }}> *</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        step={step}
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 8,
          border: "1px solid #374151", background: "#1f2937",
          color: disabled ? "#6b7280" : "#f9fafb", fontSize: 15,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const [id] = useState(() => Math.random().toString(36).slice(2));
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 8,
          border: "1px solid #374151", background: "#1f2937",
          color: "#f9fafb", fontSize: 15, boxSizing: "border-box",
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function LotCard({ lot, threshold, locale }: {
  lot: Lot | ActiveOpening; threshold: QmsThreshold | null; locale: string;
}) {
  const isOpening = "opened_at" in lot;
  const tc = tempColor(lot.open_temp, threshold?.temp_max ?? 30);
  const hc = humidityColor(lot.open_humidity, threshold?.humidity_max ?? 60);
  return (
    <div style={{
      background: "#1f2937", borderRadius: 10, padding: "14px 16px",
      marginBottom: 14, borderLeft: "4px solid #3b82f6",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <code style={{ fontSize: 18, color: "#f9fafb", fontWeight: 700 }}>{lot.lot_no}</code>
        <span style={{
          background: lot.status === "frozen" ? "#1e40af" : lot.status === "active" || lot.status === "opened" ? "#d97706" : "#374151",
          color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 12,
        }}>
          {statusText(lot.status, locale)}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: "1.7" }}>
        <div>物料：{lot.material_name_zh || lot.material_code}</div>
        {isOpening ? (
          <>
            <div>开封时间：{fmtDt((lot as ActiveOpening).opened_at)}</div>
            <div>剩余：<span style={{ color: "var(--ok)", fontWeight: 600 }}>{fmtHours((lot as ActiveOpening).remaining_hours)}</span></div>
          </>
        ) : (
          <div>剩余：<span style={{ color: "#3b82f6" }}>{(lot as Lot).remaining_days}天</span></div>
        )}
        {lot.open_temp !== undefined && (
          <div style={{ marginTop: 6 }}>
            <span style={{ color: tc, fontWeight: 600 }}>
              {lot.open_temp}°C — {tc === "var(--danger)" ? (locale === "zh-CN" ? "温度超标" : "Vượt ngưỡng") : (locale === "zh-CN" ? "温度正常" : "Bình thường")}
            </span>
            <span style={{ margin: "0 8px", color: "#4b5563" }}>|</span>
            <span style={{ color: hc, fontWeight: 600 }}>
              {lot.open_humidity}% — {hc === "var(--danger)" ? (locale === "zh-CN" ? "湿度超标" : "Vượt ngưỡng") : (locale === "zh-CN" ? "湿度正常" : "Bình thường")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function SolderPastePDA() {
  const locale = "zh-CN"; // Could be expanded to detect from auth
  const t = (key: string) => I18N[locale]?.[key] ?? key;

  const [auth, setAuth] = useState<Auth | null>(null);
  const [mode, setMode] = useState<"scan" | "open" | "consume">("scan");
  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lot, setLot] = useState<Lot | null>(null);
  const [activeOpening, setActiveOpening] = useState<ActiveOpening | null>(null);
  const [threshold, setThreshold] = useState<QmsThreshold | null>(null);
  const [err, setErr] = useState("");

  // Open form
  const [openShelfLife, setOpenShelfLife] = useState("24");
  const [openTemp, setOpenTemp] = useState("");
  const [openHumidity, setOpenHumidity] = useState("");
  const [openImageUrl, setOpenImageUrl] = useState("");
  const [openLine, setOpenLine] = useState("");
  const [openMachine, setOpenMachine] = useState("");
  const [openSubmitting, setOpenSubmitting] = useState(false);

  // Consume form
  const [consumeQty, setConsumeQty] = useState("");
  const [consumeWo, setConsumeWo] = useState("");
  const [consumeLine, setConsumeLine] = useState("");
  const [consumeMachine, setConsumeMachine] = useState("");
  const [consumeImageUrl, setConsumeImageUrl] = useState("");
  const [consumeSubmitting, setConsumeSubmitting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Load auth + thresholds on mount
  useEffect(() => {
    const a = getAuth();
    if (!a) { speak(t("auth_error")); return; }
    setAuth(a);
    // Fetch QMS thresholds
    apiFetch("/api/qms/solder-paste/thresholds", {}, a.token)
      .then(d => setThreshold(d))
      .catch(() => {});
    inputRef.current?.focus();
  }, []);

  // Scan handler
  const handleScan = useCallback(async () => {
    if (!scanInput.trim() || !auth) return;
    setScanning(true); setErr(""); setLot(null); setActiveOpening(null);
    try {
      const data = await apiFetch(`/api/solder-paste/lots?limit=10&q=${encodeURIComponent(scanInput.trim())}`, {}, auth.token);
      const items: Lot[] = data.items ?? data;
      if (!items.length) { speak(t("no_data")); setErr(t("no_data")); return; }
      // Match by lot_no exactly or take first
      const matched = items.find(l => l.lot_no === scanInput.trim()) ?? items[0];
      setLot(matched);
      speak(`找到 ${matched.lot_no}`);
      // Check if there's an active opening
      if (matched.status === "opened" || matched.status === "frozen") {
        const openData = await apiFetch(`/api/solder-paste/openings?status=active&limit=50`, {}, auth.token);
        const openings: any[] = openData.items ?? openData;
        const myOpen = openings.find(o => o.lot_id === matched.id && o.status === "active");
        if (myOpen) setActiveOpening(myOpen as ActiveOpening);
      }
    } catch (e: any) {
      if (e.message === "AUTH_ERROR") { speak(t("auth_error")); setAuth(null); }
      else { speak(t("network_error")); setErr(e.message); }
    } finally { setScanning(false); }
  }, [scanInput, auth, t]);

  // Open submit
  const handleOpen = async () => {
    if (!lot || !auth) return;
    if (!openTemp) { speak("请填写温度"); setErr("温度必填"); return; }
    if (!openHumidity) { speak("请填写湿度"); setErr("湿度必填"); return; }
    setOpenSubmitting(true); setErr("");
    try {
      await apiFetch("/api/solder-paste/openings", {
        method: "POST",
        body: JSON.stringify({
          lotId: lot.id,
          shelfLifeHours: parseInt(openShelfLife),
          openTemp: parseFloat(openTemp),
          openHumidity: parseFloat(openHumidity),
          openImageUrl: openImageUrl || undefined,
          lineCode: openLine || undefined,
          machineCode: openMachine || undefined,
        }),
      }, auth.token);
      speak(t("open_success"));
      setMode("scan"); setScanInput(""); setLot(null);
    } catch (e: any) {
      speak(t("open_fail")); setErr(e.message);
    } finally { setOpenSubmitting(false); }
  };

  // Consume submit
  const handleConsume = async () => {
    if (!activeOpening || !auth) return;
    if (!consumeQty) { speak("请填写消耗数量"); setErr("消耗数量必填"); return; }
    setConsumeSubmitting(true); setErr("");
    try {
      await apiFetch(`/api/solder-paste/openings/${activeOpening.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "consume",
          qtyKg: parseFloat(consumeQty),
          workOrderCode: consumeWo || undefined,
          lineCode: consumeLine || undefined,
          machineCode: consumeMachine || undefined,
          consumeImageUrl: consumeImageUrl || undefined,
        }),
      }, auth.token);
      speak(t("consume_success"));
      setMode("scan"); setScanInput(""); setLot(null); setActiveOpening(null);
      setConsumeQty(""); setConsumeWo(""); setConsumeLine(""); setConsumeMachine(""); setConsumeImageUrl("");
    } catch (e: any) {
      speak(t("consume_fail")); setErr(e.message);
    } finally { setConsumeSubmitting(false); }
  };

  // Close opening
  const handleClose = async (reason: string) => {
    if (!activeOpening || !auth) return;
    try {
      await apiFetch(`/api/solder-paste/openings/${activeOpening.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "close", reason }),
      }, auth.token);
      speak("已关闭");
      setMode("scan"); setScanInput(""); setLot(null); setActiveOpening(null);
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#111827", color: "#f9fafb", padding: "12px", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t("title")}</h1>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{auth?.username ?? ""}</span>
      </div>

      {/* QMS Threshold badge */}
      {threshold && (
        <div style={{ background: "#1f2937", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#9ca3af" }}>
          {t("threshold_info")}: <span style={{ color: "var(--ok)" }}>{t("temp_threshold")}</span> | <span style={{ color: "var(--ok)" }}>{t("humidity_threshold")}</span>
        </div>
      )}

      {err && (
        <div style={{ background: "#7f1d1d", color: "#fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 10, fontSize: 13 }}>
          {t("error")}: {err}
        </div>
      )}

      {/* Scan input */}
      {mode === "scan" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              ref={inputRef}
              type="text"
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleScan()}
              placeholder={t("scan_hint")}
              style={{
                flex: 1, padding: "14px 12px", borderRadius: 10,
                border: "1px solid #374151", background: "#1f2937",
                color: "#f9fafb", fontSize: 16,
              }}
            />
            <button
              onClick={handleScan}
              disabled={scanning}
              style={{
                padding: "14px 20px", borderRadius: 10, background: "#3b82f6",
                color: "#fff", border: "none", fontSize: 15, fontWeight: 600,
                cursor: scanning ? "not-allowed" : "pointer", opacity: scanning ? 0.6 : 1,
              }}
            >
              {scanning ? "..." : t("scanning")}
            </button>
          </div>

          {/* Lot card */}
          {lot && (
            <LotCard lot={activeOpening ?? lot} threshold={threshold} locale={locale} />
          )}

          {/* Action buttons */}
          {lot && (
            <div>
              {lot.status === "frozen" && (
                <BigButton onClick={() => { setMode("open"); setErr(""); }}>
                  {t("action_open")}
                </BigButton>
              )}
              {(lot.status === "opened" || lot.status === "active") && activeOpening && (
                <>
                  <BigButton variant="warning" onClick={() => { setMode("consume"); setErr(""); }}>
                    {t("action_consume")}
                  </BigButton>
                  <BigButton variant="secondary" onClick={() => handleClose("used")}>
                    {t("action_close")}
                  </BigButton>
                </>
              )}
              <BigButton variant="secondary" onClick={() => { setScanInput(""); setLot(null); setActiveOpening(null); }}>
                {t("action_back")}
              </BigButton>
            </div>
          )}
        </div>
      )}

      {/* Open form */}
      {mode === "open" && lot && (
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 12 }}>{t("open_title")}</h2>
          <LotCard lot={lot} threshold={threshold} locale={locale} />

          <SelectField
            label={t("open_shelf_life")}
            value={openShelfLife}
            onChange={v => setOpenShelfLife(v)}
            options={[
              { value: "24", label: "24 小时（标准）" },
              { value: "48", label: "48 小时（最长）" },
            ]}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <InputField
              label={t("open_temp_required")}
              value={openTemp}
              onChange={setOpenTemp}
              type="number"
              step="0.1"
              placeholder="例: 25.5"
              required
            />
            <InputField
              label={t("open_humidity_required")}
              value={openHumidity}
              onChange={setOpenHumidity}
              type="number"
              step="0.1"
              placeholder="例: 45"
              required
            />
          </div>

          {/* Temperature/humidity threshold reminder */}
          {openTemp && openHumidity && threshold && (
            <div style={{ fontSize: 12, marginBottom: 10, padding: "6px 10px", borderRadius: 6, background: "#1f2937" }}>
              {parseFloat(openTemp) > threshold.temp_max && (
                <span style={{ color: "var(--danger)" }}>⚠ {t("temp超标")}（阈值{threshold.temp_max}°C）</span>
              )}
              {parseFloat(openHumidity) > threshold.humidity_max && (
                <span style={{ color: "var(--danger)" }}>⚠ {t("humidity超标")}（阈值{threshold.humidity_max}%）</span>
              )}
              {parseFloat(openTemp) <= threshold.temp_max && parseFloat(openHumidity) <= threshold.humidity_max && (
                <span style={{ color: "var(--ok)" }}>✓ {t("within_spec")}</span>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <InputField label={t("open_line")} value={openLine} onChange={setOpenLine} placeholder="例: L01" />
            <InputField label={t("open_machine")} value={openMachine} onChange={setOpenMachine} placeholder="例: M01" />
          </div>

          <InputField label={t("open_image")} value={openImageUrl} onChange={setOpenImageUrl} placeholder="粘贴照片URL" />

          <button
            onClick={() => alert(t("camera_placeholder"))}
            style={{
              width: "100%", padding: "12px", borderRadius: 8, background: "#374151",
              color: "#9ca3af", border: "1px dashed #4b5563", cursor: "pointer",
              fontSize: 14, marginBottom: 12,
            }}
          >
            {t("camera_placeholder")}
          </button>

          <BigButton onClick={handleOpen} disabled={openSubmitting}>
            {openSubmitting ? "..." : t("open_submit")}
          </BigButton>
          <BigButton variant="secondary" onClick={() => setMode("scan")}>
            {t("action_back")}
          </BigButton>
        </div>
      )}

      {/* Consume form */}
      {mode === "consume" && activeOpening && (
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 12 }}>{t("consume_title")}</h2>
          <LotCard lot={activeOpening} threshold={threshold} locale={locale} />

          <div style={{ background: "#1f2937", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, color: "#9ca3af" }}>
            {t("consume_remaining")}: <span style={{ color: "var(--ok)", fontWeight: 600 }}>{fmtHours(activeOpening.remaining_hours)}</span>
          </div>

          <InputField
            label={t("consume_qty_required")}
            value={consumeQty}
            onChange={setConsumeQty}
            type="number"
            step="0.001"
            placeholder="0.000"
            required
          />

          <InputField label={t("consume_wo")} value={consumeWo} onChange={setConsumeWo} placeholder="扫描或输入工单号" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <InputField label={t("consume_line")} value={consumeLine} onChange={setConsumeLine} placeholder="例: L01" />
            <InputField label={t("consume_machine")} value={consumeMachine} onChange={setConsumeMachine} placeholder="例: M01" />
          </div>
          <InputField label={t("consume_image")} value={consumeImageUrl} onChange={setConsumeImageUrl} placeholder="粘贴照片URL" />

          <button
            onClick={() => alert(t("camera_placeholder"))}
            style={{
              width: "100%", padding: "12px", borderRadius: 8, background: "#374151",
              color: "#9ca3af", border: "1px dashed #4b5563", cursor: "pointer",
              fontSize: 14, marginBottom: 12,
            }}
          >
            {t("camera_placeholder")}
          </button>

          <BigButton variant="warning" onClick={handleConsume} disabled={consumeSubmitting}>
            {consumeSubmitting ? "..." : t("consume_submit")}
          </BigButton>
          <BigButton variant="secondary" onClick={() => setMode("scan")}>
            {t("action_back")}
          </BigButton>
        </div>
      )}
    </div>
  );
}
