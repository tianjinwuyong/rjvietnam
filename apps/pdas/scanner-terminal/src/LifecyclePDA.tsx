/**
 * LifecyclePDA — 物料有效期管控 PDA 页面
 * 扫描物料批次条码 → 查看状态 → 执行开封/复检/报废操作
 *
 * 移动端优先：大按钮、高对比度、语音反馈、最少输入
 *
 * API: http://127.0.0.1:8080 (Node API — JWT auth required)
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

// ── Config ────────────────────────────────────────────────────────────────────
const API = (window as any).__API_BASE__ ?? `${window.location.protocol}//${window.location.hostname}:8080`;
const TTS_LANG = "zh-CN";

// ── i18n ──────────────────────────────────────────────────────────────────────
const I18N: Record<string, Record<string, string>> = {
  "zh-CN": {
    title: "物料有效期管控",
    scan_hint: "请扫描物料批次条码",
    scanning: "正在查询...",
    no_data: "未找到该批次",
    // Status
    status_normal: "正常",
    status_warning: "临期预警",
    status_blue: "临期",
    status_red: "超期",
    status_expired: "已过期",
    remaining_days: "剩余",
    days: "天",
    overdue_days: "已超",
    // Actions
    action_open: "📦 登记开封",
    action_reinspect: "🔬 提交复检",
    action_scrap: "🗑  申请报废",
    action_back: "← 返回",
    // Open form
    open_title: "登记开封日期",
    open_date: "开封日期",
    open_days: "开封后可用天数",
    open_qty: "开封数量",
    open_dept: "领用部门",
    open_submit: "确认开封",
    // Reinspect form
    reinspect_title: "提交复检报告",
    reinspect_lot: "批次",
    overdue_days_label: "超期天数",
    sample_qty_label: "抽检数量",
    test_items_label: "检验项目",
    test_result_label: "检验结果",
    pass_label: "判定",
    pass_yes: "合格",
    pass_no: "不合格",
    disposal_label: "处置意见",
    reinspect_submit: "提交复检",
    // Scrap form
    scrap_title: "申请报废",
    scrap_lot: "批次",
    scrap_qty_label: "报废数量",
    scrap_reason_label: "报废原因",
    isolation_label: "隔离状态",
    disposal_method_label: "处置方式",
    scrap_submit: "提交申请",
    // Alerts
    alert_title: "更新处理状态",
    processing_status_label: "处理状态",
    action_plan_label: "处理方案",
    responsible_label: "负责人",
    plan_date_label: "计划日期",
    alert_submit: "确认更新",
    // Feedback
    success: "✓ 成功",
    error: "✗ 失败",
    network_error: "网络错误",
    auth_error: "认证失败，请重新登录",
    // Info
    expiry_date: "到期日期",
    material_name: "物料名称",
    lot_no: "批次号",
    quantity: "数量",
    location: "库位",
  },
  vi: {
    title: "Quản lý tuổi thọ",
    scan_hint: "Quét mã lô vật liệu",
    scanning: "Đang truy vấn...",
    no_data: "Không tìm thấy lô",
    status_normal: "Bình thường",
    status_warning: "Cảnh báo",
    status_blue: "Gần hết hạn",
    status_red: "Quá hạn",
    status_expired: "Đã hết hạn",
    remaining_days: "Còn lại",
    days: "ngày",
    overdue_days: "Đã quá",
    action_open: "📦 Ghi nhận mở gói",
    action_reinspect: "🔬 Nộp kiểm tra lại",
    action_scrap: "🗑  Xin thanh lý",
    action_back: "← Quay lại",
    open_title: "Ghi nhận mở gói",
    open_date: "Ngày mở",
    open_days: "Số ngày sau khi mở",
    open_qty: "Số lượng mở",
    open_dept: "Bộ phận",
    open_submit: "Xác nhận mở",
    reinspect_title: "Nộp báo cáo kiểm tra",
    reinspect_lot: "Lô",
    overdue_days_label: "Số ngày quá hạn",
    sample_qty_label: "Số lượng mẫu",
    test_items_label: "Hạng mục kiểm tra",
    test_result_label: "Kết quả",
    pass_label: "Đánh giá",
    pass_yes: "Đạt",
    pass_no: "Không đạt",
    disposal_label: "Xử lý",
    reinspect_submit: "Nộp kiểm tra",
    scrap_title: "Xin thanh lý",
    scrap_lot: "Lô",
    scrap_qty_label: "Số lượng thanh lý",
    scrap_reason_label: "Lý do",
    isolation_label: "Tình trạng cách ly",
    disposal_method_label: "Phương thức xử lý",
    scrap_submit: "Nộp đơn",
    alert_title: "Cập nhật trạng thái",
    processing_status_label: "Trạng thái",
    action_plan_label: "Kế hoạch",
    responsible_label: "Người phụ trách",
    plan_date_label: "Ngày dự kiến",
    alert_submit: "Xác nhận",
    success: "✓ Thành công",
    error: "✗ Thất bại",
    network_error: "Lỗi mạng",
    auth_error: "Lỗi xác thực",
    expiry_date: "Hạn sử dụng",
    material_name: "Tên vật liệu",
    lot_no: "Mã lô",
    quantity: "Số lượng",
    location: "Vị trí",
  },
};

// ── Auth helpers ───────────────────────────────────────────────────────────────
interface Auth {
  token: string;
  username: string;
  permissions: string[];
}

function getAuth(): Auth | null {
  try {
    const raw = localStorage.getItem("lifecycle_auth");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setAuth(auth: Auth) {
  localStorage.setItem("lifecycle_auth", JSON.stringify(auth));
}

// ── API helpers ────────────────────────────────────────────────────────────────
async function apiFetch(path: string, options: RequestInit = {}, token?: string): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...(options.headers as Record<string, string> || {}) } });
  if (res.status === 401) {
    localStorage.removeItem("lifecycle_auth");
    throw new Error("AUTH_ERROR");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body.data ?? body;
}

// ── TTS ─────────────────────────────────────────────────────────────────────────
function speak(text: string) {
  try {
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = TTS_LANG === "vi" ? "vi-VN" : "zh-CN";
    utt.rate = 1.1;
    speechSynthesis.speak(utt);
  } catch {}
}

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    normal: "#22c55e",
    yellow_l1: "#eab308",
    blue_l2: "#3b82f6",
    red_l3: "#ef4444",
    expired: "#7f1d1d",
  };
  const labels: Record<string, string> = {
    normal: "正常",
    yellow_l1: "临期预警",
    blue_l2: "临期",
    red_l3: "超期",
    expired: "已过期",
  };
  return (
    <span style={{
      background: colors[level] ?? "#888",
      color: "#fff",
      padding: "6px 16px",
      borderRadius: 20,
      fontSize: 16,
      fontWeight: 700,
    }}>
      {labels[level] ?? level}
    </span>
  );
}

// ── BigButton ──────────────────────────────────────────────────────────────────
function BigButton({ onClick, variant, children, disabled }: {
  onClick: () => void;
  variant?: "primary" | "danger" | "secondary";
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const bg = variant === "danger" ? "#dc2626" : variant === "secondary" ? "#374151" : "#2563eb";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "20px",
        fontSize: 18,
        fontWeight: 700,
        background: disabled ? "#4b5563" : bg,
        color: "#fff",
        border: "none",
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        marginTop: 12,
      }}
    >
      {children}
    </button>
  );
}

// ── InputField ─────────────────────────────────────────────────────────────────
function InputField({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 13, color: "#9ca3af", marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "14px 12px",
          fontSize: 18,
          background: "#1f2937",
          color: "#f9fafb",
          border: "1px solid #374151",
          borderRadius: 8,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

// ── SelectField ────────────────────────────────────────────────────────────────
function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 13, color: "#9ca3af", marginBottom: 4 }}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "14px 12px",
          fontSize: 18,
          background: "#1f2937",
          color: "#f9fafb",
          border: "1px solid #374151",
          borderRadius: 8,
          boxSizing: "border-box",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── Quick login demo users ───────────────────────────────────────────────────
const QUICK_USERS = [
  { username: "VN_OP_001", label: "操作员", role: "SMT Operator", color: "#2563eb" },
  { username: "VN_WH_001", label: "仓管", role: "Warehouse", color: "#16a34a" },
  { username: "PMC_CN_01", label: "PMC", role: "Production", color: "#9333ea" },
  { username: "QC_VN_01", label: "质检", role: "Quality", color: "#ea580c" },
];

function QuickButton({ username, label, role, color, onLogin }: {
  username: string; label: string; role: string; color: string;
  onLogin: (auth: Auth) => void;
}) {
  const [loading, setLoading] = useState(false);
  const handleQuickLogin = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: "Factory@123" }),
      });
      const body = await res.json();
      if (!res.ok || !body.data?.item?.token) return;
      const { token, user } = body.data.item;
      onLogin({ token, username: user.username, permissions: user.permissions ?? [] });
      speak("登录成功");
    } catch { /* network error */ }
    finally { setLoading(false); }
  };
  return (
    <button
      onClick={handleQuickLogin}
      disabled={loading}
      style={{
        padding: "14px 8px",
        fontSize: 14,
        fontWeight: 700,
        background: loading ? "#374151" : color,
        color: "#fff",
        border: "none",
        borderRadius: 10,
        cursor: loading ? "not-allowed" : "pointer",
        flex: 1,
        minWidth: 80,
      }}
    >
      {loading ? "..." : label}
      <br /><span style={{ fontSize: 11, fontWeight: 400, opacity: 0.85 }}>{role}</span>
    </button>
  );
}

// ── LoginScreen ────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (auth: Auth) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok || !body.data?.item?.token) {
        setError(body.error?.message ?? "登录失败");
        return;
      }
      const { token, user } = body.data.item;
      onLogin({ token, username: user.username, permissions: user.permissions ?? [] });
      speak("登录成功");
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 400, margin: "60px auto" }}>
      <h2 style={{ color: "#f9fafb", textAlign: "center", marginBottom: 8 }}>物料有效期管控</h2>
      <p style={{ color: "#6b7280", textAlign: "center", fontSize: 13, marginBottom: 28 }}>快速登录</p>

      {/* Quick login grid */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {QUICK_USERS.map((u) => (
          <QuickButton key={u.username} {...u} onLogin={onLogin} />
        ))}
      </div>

      <div style={{ borderTop: "1px solid #374151", paddingTop: 20, marginTop: 4 }}>
        <p style={{ color: "#6b7280", textAlign: "center", fontSize: 12, marginBottom: 12 }}>或使用账号密码登录</p>
        <InputField label="用户名" value={username} onChange={setUsername} placeholder="输入用户名" />
        <InputField label="密码" value={password} onChange={setPassword} type="password" placeholder="输入密码" />
        {error && <p style={{ color: "#f87171", margin: "8px 0" }}>{error}</p>}
        <BigButton onClick={handleLogin} disabled={loading}>
          {loading ? "登录中..." : "登录"}
        </BigButton>
      </div>
    </div>
  );
}

// ── LotCard ────────────────────────────────────────────────────────────────────
function LotCard({ lot, locale }: { lot: any; locale: string }) {
  const t = I18N[locale] ?? I18N["zh-CN"];
  return (
    <div style={{ background: "#1f2937", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "#f9fafb" }}>{lot.lot_no ?? lot.lotNo}</span>
        <StatusBadge level={lot.alert_level ?? lot.alertLevel ?? "normal"} />
      </div>
      <div style={{ color: "#9ca3af", fontSize: 15 }}>
        <div style={{ marginBottom: 4 }}><b style={{ color: "#e5e7eb" }}>{t.material_name}:</b> {lot.material_name ?? lot.materialName ?? "-"}</div>
        <div style={{ marginBottom: 4 }}><b style={{ color: "#e5e7eb" }}>{t.quantity}:</b> {lot.quantity ?? lot.received_qty ?? lot.receivedQty ?? "-"} {lot.unit ?? ""}</div>
        <div style={{ marginBottom: 4 }}><b style={{ color: "#e5e7eb" }}>{t.location}:</b> {lot.location ?? lot.location_code ?? lot.locationCode ?? "-"}</div>
        <div style={{ marginBottom: 4 }}>
          <b style={{ color: "#e5e7eb" }}>{t.expiry_date}:</b>{" "}
          <span style={{ color: lot.alert_level === "red_l3" || lot.alert_level === "expired" ? "#f87171" : "#86efac" }}>
            {lot.expiry_date ?? lot.expiryDate ?? "-"}
          </span>
        </div>
        <div style={{ marginBottom: 4 }}>
          <b style={{ color: "#e5e7eb" }}>{lot.remaining_days != null ? t.remaining_days : lot.overdue_days != null ? t.overdue_days : ""}:</b>{" "}
          {lot.remaining_days ?? lot.overdue_days ?? "-"} {lot.remaining_days != null ? t.days : ""}
        </div>
        {lot.processing_status && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: "#374151", borderRadius: 6, fontSize: 13 }}>
            <b style={{ color: "#e5e7eb" }}>处理状态:</b> {lot.processing_status}
            {lot.action_plan ? ` → ${lot.action_plan}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function LifecyclePDA() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [locale, setLocale] = useState<"zh-CN" | "vi">("zh-CN");
  const t = I18N[locale] ?? I18N["zh-CN"];

  // Scan state
  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lot, setLot] = useState<any | null>(null);
  const [scanError, setScanError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Action sheet
  const [action, setAction] = useState<"open" | "reinspect" | "scrap" | "alert" | null>(null);

  // Form states
  const [openForm, setOpenForm] = useState({ opened_at: "", opened_shelf_life_days: "", opened_qty: "", department: "" });
  const [reinspectForm, setReinspectForm] = useState({ overdue_days: "", sample_qty: "10", test_items: "", test_results: "", pass: "true", disposal_advice: "" });
  const [scrapForm, setScrapForm] = useState({ scrap_qty: "", scrap_reason: "", isolation_status: "ISOLATED", disposal_method: "DESTROY" });
  const [alertForm, setAlertForm] = useState({ processing_status: "", action_plan: "", responsible: "", plan_date: "" });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Init from localStorage
  useEffect(() => {
    const saved = getAuth();
    if (saved) setAuth(saved);
    // Focus scan input on mount
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  // Auto-focus scan input
  useEffect(() => {
    if (!action) inputRef.current?.focus();
  }, [action]);

  const showMsg = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    if (ok) speak(text.replace("✓ ", ""));
    setTimeout(() => setMsg(null), 3000);
  };

  // ── Scan lot ─────────────────────────────────────────────────────────────────
  const handleScan = useCallback(async (lotNo: string) => {
    if (!lotNo.trim()) return;
    setScanning(true);
    setScanError("");
    setLot(null);
    setAction(null);
    try {
      const data = await apiFetch(`/api/lifecycle/lots?lotNo=${encodeURIComponent(lotNo.trim())}&limit=1`, {}, auth?.token);
      const lots = Array.isArray(data) ? data : data?.items ?? [];
      if (!lots.length) {
        setScanError(t.no_data);
        speak(t.no_data);
        return;
      }
      setLot(lots[0]);
      speak("已找到");
    } catch (e: any) {
      if (e.message === "AUTH_ERROR") {
        setAuth(null);
        setScanError(t.auth_error);
      } else {
        setScanError(e.message || t.network_error);
      }
    } finally {
      setScanning(false);
      setScanInput("");
      inputRef.current?.focus();
    }
  }, [auth?.token, t]);

  const handleScanKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan(scanInput);
    }
  };

  // ── Open form submit ─────────────────────────────────────────────────────────
  const handleOpenSubmit = async () => {
    if (!openForm.opened_at || !openForm.opened_shelf_life_days || !lot) return;
    setSubmitting(true);
    try {
      await apiFetch("/api/lifecycle/openings", {
        method: "POST",
        body: JSON.stringify({
          material_lot_id: lot.id,
          opened_at: openForm.opened_at,
          opened_shelf_life_days: Number(openForm.opened_shelf_life_days),
          opened_qty: openForm.opened_qty ? Number(openForm.opened_qty) : undefined,
          department: openForm.department || undefined,
          operator: auth?.username,
        }),
      }, auth?.token);
      showMsg(true, `${t.success} ${t.action_open}`);
      setAction(null);
      setOpenForm({ opened_at: "", opened_shelf_life_days: "", opened_qty: "", department: "" });
    } catch (e: any) {
      showMsg(false, e.message || t.error);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Reinspect submit ──────────────────────────────────────────────────────────
  const handleReinspectSubmit = async () => {
    if (!lot) return;
    setSubmitting(true);
    try {
      await apiFetch("/api/lifecycle/reinspection", {
        method: "POST",
        body: JSON.stringify({
          material_lot_id: lot.id,
          inspected_at: new Date().toISOString().slice(0, 10),
          overdue_days: reinspectForm.overdue_days ? Number(reinspectForm.overdue_days) : undefined,
          sample_qty: reinspectForm.sample_qty ? Number(reinspectForm.sample_qty) : undefined,
          test_items: reinspectForm.test_items || undefined,
          test_results: reinspectForm.test_results || undefined,
          pass: reinspectForm.pass === "true",
          disposal_advice: reinspectForm.disposal_advice || undefined,
        }),
      }, auth?.token);
      showMsg(true, `${t.success} ${t.action_reinspect}`);
      setAction(null);
    } catch (e: any) {
      showMsg(false, e.message || t.error);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Scrap submit ─────────────────────────────────────────────────────────────
  const handleScrapSubmit = async () => {
    if (!lot || !scrapForm.scrap_qty) return;
    setSubmitting(true);
    try {
      await apiFetch("/api/lifecycle/scrapping", {
        method: "POST",
        body: JSON.stringify({
          material_lot_id: lot.id,
          scrap_qty: Number(scrapForm.scrap_qty),
          scrap_reason: scrapForm.scrap_reason || undefined,
          isolation_status: scrapForm.isolation_status,
          disposal_method: scrapForm.disposal_method,
        }),
      }, auth?.token);
      showMsg(true, `${t.success} ${t.action_scrap}`);
      setAction(null);
    } catch (e: any) {
      showMsg(false, e.message || t.error);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Alert status submit ───────────────────────────────────────────────────────
  const handleAlertSubmit = async () => {
    if (!lot) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/lifecycle/alert-status/${lot.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          processing_status: alertForm.processing_status || undefined,
          action_plan: alertForm.action_plan || undefined,
          responsible: alertForm.responsible || undefined,
          plan_date: alertForm.plan_date || undefined,
        }),
      }, auth?.token);
      showMsg(true, `${t.success} ${t.alert_submit}`);
      setAction(null);
    } catch (e: any) {
      showMsg(false, e.message || t.error);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Login ────────────────────────────────────────────────────────────────────
  if (!auth) {
    return <LoginScreen onLogin={(a) => { setAuth(a); setMsg(null); }} />;
  }

  const canEdit = auth.permissions.includes("lifecycle.edit");
  const canApprove = auth.permissions.includes("lifecycle.approve");

  return (
    <div style={{ padding: 12, maxWidth: 480, margin: "0 auto", background: "#111827", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#f9fafb", margin: 0, fontSize: 18 }}>{t.title}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setLocale(locale === "zh-CN" ? "vi" : "zh-CN")}
            style={{ background: "#374151", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            {locale === "zh-CN" ? "VI" : "中"}
          </button>
          <button onClick={() => { setAuth(null); localStorage.removeItem("lifecycle_auth"); }}
            style={{ background: "#374151", color: "#fff", border: "none", padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
            登出
          </button>
        </div>
      </div>

      {/* Scan input */}
      {!action && (
        <div style={{ marginBottom: 16 }}>
          <input
            ref={inputRef}
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={handleScanKeyDown}
            disabled={scanning}
            placeholder={scanning ? t.scanning : t.scan_hint}
            autoFocus
            style={{
              width: "100%",
              padding: "18px 14px",
              fontSize: 20,
              fontWeight: 700,
              background: "#1f2937",
              color: scanInput ? "#f9fafb" : "#6b7280",
              border: `2px solid ${scanError ? "#f87171" : scanning ? "#2563eb" : "#374151"}`,
              borderRadius: 10,
              textAlign: "center",
              letterSpacing: 2,
              boxSizing: "border-box",
            }}
          />
          {scanError && <p style={{ color: "#f87171", margin: "6px 0 0", fontSize: 14 }}>{scanError}</p>}
          {scanning && <p style={{ color: "#60a5fa", margin: "6px 0 0", fontSize: 14 }}>{t.scanning}</p>}
        </div>
      )}

      {/* Message toast */}
      {msg && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          background: msg.ok ? "#166534" : "#991b1b", color: "#fff",
          padding: "12px 24px", borderRadius: 10, fontSize: 16, fontWeight: 700,
          zIndex: 999, whiteSpace: "nowrap",
        }}>
          {msg.text}
        </div>
      )}

      {/* Lot info */}
      {lot && !action && <LotCard lot={lot} locale={locale} />}

      {/* Action sheet */}
      {lot && !action && (
        <div>
          {canEdit && (
            <>
              <BigButton onClick={() => { setAction("open"); setOpenForm({ opened_at: new Date().toISOString().slice(0, 10), opened_shelf_life_days: String(lot.shelf_life_months ? Number(lot.shelf_life_months) * 30 : 30), opened_qty: "", department: "" }); }}>
                {t.action_open}
              </BigButton>
              <BigButton onClick={() => { setAction("reinspect"); setReinspectForm({ overdue_days: lot.overdue_days ?? lot.remaining_days < 0 ? String(Math.abs(lot.remaining_days ?? 0)) : "", sample_qty: "10", test_items: "", test_results: "", pass: "true", disposal_advice: "" }); }}>
                {t.action_reinspect}
              </BigButton>
              <BigButton variant="danger" onClick={() => setAction("scrap")}>
                {t.action_scrap}
              </BigButton>
              <BigButton variant="secondary" onClick={() => { setAction("alert"); setAlertForm({ processing_status: lot.processing_status ?? "", action_plan: lot.action_plan ?? "", responsible: "", plan_date: "" }); }}>
                ⚠ 更新处理状态
              </BigButton>
            </>
          )}
          {!canEdit && (
            <p style={{ color: "#9ca3af", textAlign: "center", marginTop: 16, fontSize: 14 }}>
              当前用户无编辑权限（lifecycle.edit）
            </p>
          )}
        </div>
      )}

      {/* ── Open form ──────────────────────────────────────────────────────── */}
      {action === "open" && (
        <div>
          <h3 style={{ color: "#f9fafb", margin: "0 0 16px" }}>{t.open_title}</h3>
          <LotCard lot={lot} locale={locale} />
          <InputField label={t.open_date} value={openForm.opened_at} onChange={(v) => setOpenForm(f => ({ ...f, opened_at: v }))} type="date" />
          <InputField label={`${t.open_days}（${t.days}）`} value={openForm.opened_shelf_life_days} onChange={(v) => setOpenForm(f => ({ ...f, opened_shelf_life_days: v }))} type="number" placeholder="30" />
          <InputField label={t.open_qty} value={openForm.opened_qty} onChange={(v) => setOpenForm(f => ({ ...f, opened_qty: v }))} type="number" />
          <InputField label={t.open_dept} value={openForm.department} onChange={(v) => setOpenForm(f => ({ ...f, department: v }))} placeholder="部门名称" />
          <BigButton onClick={handleOpenSubmit} disabled={submitting}>{submitting ? "..." : t.open_submit}</BigButton>
          <BigButton variant="secondary" onClick={() => setAction(null)}>{t.action_back}</BigButton>
        </div>
      )}

      {/* ── Reinspect form ─────────────────────────────────────────────────── */}
      {action === "reinspect" && (
        <div>
          <h3 style={{ color: "#f9fafb", margin: "0 0 16px" }}>{t.reinspect_title}</h3>
          <LotCard lot={lot} locale={locale} />
          <InputField label={t.overdue_days_label} value={reinspectForm.overdue_days} onChange={(v) => setReinspectForm(f => ({ ...f, overdue_days: v }))} type="number" />
          <InputField label={t.sample_qty_label} value={reinspectForm.sample_qty} onChange={(v) => setReinspectForm(f => ({ ...f, sample_qty: v }))} type="number" />
          <InputField label={t.test_items_label} value={reinspectForm.test_items} onChange={(v) => setReinspectForm(f => ({ ...f, test_items: v }))} placeholder="外观/电气性能/焊接性" />
          <InputField label={t.test_result_label} value={reinspectForm.test_results} onChange={(v) => setReinspectForm(f => ({ ...f, test_results: v }))} placeholder="合格/不合格项描述" />
          <SelectField
            label={t.pass_label}
            value={reinspectForm.pass}
            onChange={(v) => setReinspectForm(f => ({ ...f, pass: v }))}
            options={[{ value: "true", label: t.pass_yes }, { value: "false", label: t.pass_no }]}
          />
          <InputField label={t.disposal_label} value={reinspectForm.disposal_advice} onChange={(v) => setReinspectForm(f => ({ ...f, disposal_advice: v }))} placeholder="继续使用/降级使用/报废" />
          <BigButton onClick={handleReinspectSubmit} disabled={submitting}>{submitting ? "..." : t.reinspect_submit}</BigButton>
          <BigButton variant="secondary" onClick={() => setAction(null)}>{t.action_back}</BigButton>
        </div>
      )}

      {/* ── Scrap form ──────────────────────────────────────────────────────── */}
      {action === "scrap" && (
        <div>
          <h3 style={{ color: "#f9fafb", margin: "0 0 16px" }}>{t.scrap_title}</h3>
          <LotCard lot={lot} locale={locale} />
          <InputField label={`${t.scrap_qty_label} *`} value={scrapForm.scrap_qty} onChange={(v) => setScrapForm(f => ({ ...f, scrap_qty: v }))} type="number" />
          <InputField label={t.scrap_reason_label} value={scrapForm.scrap_reason} onChange={(v) => setScrapForm(f => ({ ...f, scrap_reason: v }))} placeholder="过期/损坏/超期" />
          <SelectField
            label={t.isolation_label}
            value={scrapForm.isolation_status}
            onChange={(v) => setScrapForm(f => ({ ...f, isolation_status: v }))}
            options={[
              { value: "ISOLATED", label: "已隔离" },
              { value: "PENDING", label: "待隔离" },
              { value: "NONE", label: "未隔离" },
            ]}
          />
          <SelectField
            label={t.disposal_method_label}
            value={scrapForm.disposal_method}
            onChange={(v) => setScrapForm(f => ({ ...f, disposal_method: v }))}
            options={[
              { value: "DESTROY", label: "销毁" },
              { value: "RECYCLE", label: "回收变卖" },
              { value: "RETURN", label: "退回供应商" },
            ]}
          />
          <BigButton variant="danger" onClick={handleScrapSubmit} disabled={submitting || !scrapForm.scrap_qty}>{submitting ? "..." : t.scrap_submit}</BigButton>
          <BigButton variant="secondary" onClick={() => setAction(null)}>{t.action_back}</BigButton>
        </div>
      )}

      {/* ── Alert status update form ───────────────────────────────────────── */}
      {action === "alert" && (
        <div>
          <h3 style={{ color: "#f9fafb", margin: "0 0 16px" }}>{t.alert_title}</h3>
          <LotCard lot={lot} locale={locale} />
          <SelectField
            label={t.processing_status_label}
            value={alertForm.processing_status}
            onChange={(v) => setAlertForm(f => ({ ...f, processing_status: v }))}
            options={[
              { value: "PENDING", label: "待处理" },
              { value: "IN_PROGRESS", label: "处理中" },
              { value: "RESOLVED", label: "已解决" },
              { value: "ESCALATED", label: "已升级" },
            ]}
          />
          <InputField label={t.action_plan_label} value={alertForm.action_plan} onChange={(v) => setAlertForm(f => ({ ...f, action_plan: v }))} placeholder="处理方案" />
          <InputField label={t.responsible_label} value={alertForm.responsible} onChange={(v) => setAlertForm(f => ({ ...f, responsible: v }))} placeholder="负责人" />
          <InputField label={t.plan_date_label} value={alertForm.plan_date} onChange={(v) => setAlertForm(f => ({ ...f, plan_date: v }))} type="date" />
          <BigButton onClick={handleAlertSubmit} disabled={submitting}>{submitting ? "..." : t.alert_submit}</BigButton>
          <BigButton variant="secondary" onClick={() => setAction(null)}>{t.action_back}</BigButton>
        </div>
      )}
    </div>
  );
}
