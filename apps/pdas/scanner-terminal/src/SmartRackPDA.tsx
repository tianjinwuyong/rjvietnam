/**
 * SmartRackPDA — SMT 料架领料 PDA 页面
 *
 * Two workflows:
 *  A. Scan WO barcode (传统扫码模式)
 *     Scan WO → 显示 BOM 物料需求 → 查找料架 → 扫描卷盘 → 确认上料
 *
 *  B. Dispatch 模式 (工单派发模式)
 *     查看已派发工单列表 → 加入工单会话 → 认领物料 → 扫描卷盘 → 确认上料
 *
 * 移动端优先：大按钮、高对比度、语音反馈、最少输入
 *
 * API: http://127.0.0.1:8080 (Node API — JWT auth required)
 * Auth: username+password login → Bearer token stored in sessionStorage
 */
import React, { useState, useCallback } from "react";

const API = `${window.location.protocol}//${window.location.hostname}:8080`;

const I18N: Record<string, Record<string, string>> = {
  "zh-CN": {
    title: "SMT 料架领料",
    login_title: "操作员登录",
    username: "账号",
    password: "密码",
    login_btn: "登录",
    login_failed: "登录失败",
    // Navigation
    nav_scan: "扫码模式",
    nav_dispatch: "派发模式",
    // Steps
    step_scan_wo: "扫描工单条码",
    step_loading: "工单物料加载中...",
    step_scan_lot: "扫描卷盘条码",
    step_confirm: "确认上料",
    step_done: "上料完成",
    // Session list (dispatch mode)
    session_list_title: "待处理工单",
    session_loaded: "已上料",
    session_pending: "待上料",
    session_join: "加入",
    session_joined: "已加入",
    session_no_data: "暂无已派发的工单",
    // Dispatch load
    dispatch_title: "工单物料领取",
    dispatch_assignments: "物料分配",
    dispatch_claim: "领取",
    dispatch_claiming: "领取中...",
    dispatch_claimed: "已领取",
    dispatch_scan_lot: "扫描卷盘",
    dispatch_load_confirm: "确认上料",
    dispatch_back: "返回工单列表",
    // WO view
    wo_code: "工单",
    wo_product: "产品",
    wo_qty: "计划数量",
    wo_line: "产线",
    material_required: "需求物料",
    material_shortfall: "缺口",
    material_fulfilled: "已满足",
    // Rack search
    search_rack: "查找物料",
    searching: "正在查询料架...",
    rack_found: "在料架找到该物料",
    rack_not_found: "料架中无此物料",
    led_lit: "LED 已点亮",
    // Loading
    lot_label: "卷盘条码",
    slot_no: "飞达槽位",
    qty: "数量",
    confirm_load: "确认上料",
    loading: "上料中...",
    load_success: "上料成功",
    load_failed: "上料失败",
    // Status
    fulfilled: "已满足",
    shortfall: "缺口",
    no_data: "无数据",
    scan_hint: "请扫描...",
    logout: "登出",
    back: "返回",
    all_loaded: "全部上料完成",
    join_session_failed: "加入工单失败",
    claim_failed: "领取失败",
  },
  "vi-VN": {
    title: "Kệ linh kiện SMT",
    login_title: "Đăng nhập",
    username: "Tài khoản",
    password: "Mật khẩu",
    login_btn: "Đăng nhập",
    login_failed: "Đăng nhập thất bại",
    nav_scan: "Quét mã",
    nav_dispatch: "Điều phối",
    step_scan_wo: "Quét mã WO",
    step_loading: "Đang tải...",
    step_scan_lot: "Quét cuộn",
    step_confirm: "Xác nhận nạp",
    step_done: "Hoàn thành",
    session_list_title: "WO đã điều phối",
    session_loaded: "Đã nạp",
    session_pending: "Chưa nạp",
    session_join: "Tham gia",
    session_joined: "Đã tham gia",
    session_no_data: "Không có WO điều phối",
    dispatch_title: "Nhận vật liệu WO",
    dispatch_assignments: "Phân bổ vật liệu",
    dispatch_claim: "Nhận",
    dispatch_claiming: "Đang nhận...",
    dispatch_claimed: "Đã nhận",
    dispatch_scan_lot: "Quét cuộn",
    dispatch_load_confirm: "Xác nhận nạp",
    dispatch_back: " Quay lại danh sách",
    wo_code: "WO",
    wo_product: "Sản phẩm",
    wo_qty: "Số lượng",
    wo_line: "Dây chuyền",
    material_required: "Vật liệu yêu cầu",
    material_shortfall: "Thiếu",
    material_fulfilled: "Đủ",
    search_rack: "Tìm kiếm",
    searching: "Đang tìm...",
    rack_found: "Tìm thấy trên kệ",
    rack_not_found: "Không có trên kệ",
    led_lit: "LED đã bật",
    lot_label: "Mã cuộn",
    slot_no: "Khe feeder",
    qty: "Số lượng",
    confirm_load: "Xác nhận nạp",
    loading: "Đang nạp...",
    load_success: "Nạp thành công",
    load_failed: "Nạp thất bại",
    fulfilled: "Đủ",
    shortfall: "Thiếu",
    no_data: "Không có",
    scan_hint: "Quét...",
    logout: "Đăng xuất",
    back: " Quay lại",
    all_loaded: "Hoàn thành tất cả",
    join_session_failed: "Tham gia thất bại",
    claim_failed: "Nhận thất bại",
  },
};

// ── Auth helpers ──────────────────────────────────────────────────────
async function pdaLogin(username: string, password: string): Promise<string> {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const d = await r.json();
  if (!d.success) throw new Error(d.error?.message ?? "Login failed");
  const token = d.data?.token;
  if (!token) throw new Error("No token");
  sessionStorage.setItem("pda_token", token);
  sessionStorage.setItem("pda_username", username);
  return token;
}

function getToken(): string | null {
  return sessionStorage.getItem("pda_token");
}

function getUsername(): string {
  return sessionStorage.getItem("pda_username") ?? "operator";
}

async function apiGet<T>(path: string): Promise<T> {
  const token = getToken();
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const d = await r.json();
  if (!d.success && !d.data) throw new Error(d.error ?? d.message ?? "API error");
  return (d.data ?? d) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = getToken();
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!d.success) throw new Error(d.error ?? d.message ?? "API error");
  return d as T;
}

// ── Types ─────────────────────────────────────────────────────────────
type Locale = "zh-CN" | "vi-VN";
type Step = "scan_wo" | "show_wo" | "scan_lot" | "done"
  | "session_list" | "dispatch_load" | "dispatch_scan";

interface WMSData {
  workOrder: { woCode: string; productCode: string; plannedQty: number; lineCode: string };
  items: MaterialItem[];
}

interface MaterialItem {
  materialCode: string;
  materialNameZh: string;
  qtyPer: number;
  totalRequired: number;
  pickedQty: number;
  shortfall: number;
  bestLot: { lotNo: string; shelfCode: string; cellNo: string; availQty: number; locType: string } | null;
}

interface LotOnRack {
  shelfCode: string;
  cellNumber: string;
  lotNo: string;
  labelId: string;
  qty: number;
  materialCode: string;
  ledColor: number | null;
}

// Dispatch session types
interface DispatchSession {
  id: number;
  workOrderCode: string;
  lineCode: string | null;
  status: string;
  createdAt: string;
  pdas: { pdaId: string; operator: string; lineCode: string | null }[];
  progress: { total: number; loaded: number; pending: number };
}

interface DispatchAssignment {
  id: number;
  materialCode: string;
  materialNameZh: string;
  smtFlag: string | null;
  unit: string | null;
  assignedOperator: string | null;
  assignedPda: string | null;
  claimOperator: string | null;
  claimPda: string | null;
  claimedAt: string | null;
  status: "pending" | "loading" | "loaded";
  feederSlot: string | null;
  lotNo: string | null;
  loadedAt: string | null;
}

interface DispatchSessionDetail {
  id: number;
  workOrderCode: string;
  lineCode: string | null;
  status: string;
  createdAt: string;
  pdas: { pdaId: string; operator: string; lineCode: string | null }[];
  assignments: DispatchAssignment[];
  progress: { total: number; loaded: number; pending: number };
}

// ── Login screen ───────────────────────────────────────────────────────
function LoginScreen({ onLogin, locale }: { onLogin: (token: string) => void; locale: Locale }) {
  const t = I18N[locale];
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    if (!u || !p) return;
    setLoading(true);
    setErr("");
    try {
      const token = await pdaLogin(u, p);
      onLogin(token);
    } catch (e) {
      setErr(t.login_failed + ": " + (e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "80vh", gap: 20, padding: 24 }}>
      <div style={{ fontSize: 28, fontWeight: 900, color: "#1a237e" }}>{t.title}</div>
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 380, boxShadow: "0 4px 24px #0002" }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, textAlign: "center" }}>{t.login_title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input value={u} onChange={e => setU(e.target.value)} placeholder={t.username}
            style={{ padding: "14px 16px", fontSize: 16, borderRadius: 8, border: "1px solid #ccc" }} />
          <input type="password" value={p} onChange={e => setP(e.target.value)} placeholder={t.password}
            onKeyDown={e => e.key === "Enter" && doLogin()}
            style={{ padding: "14px 16px", fontSize: 16, borderRadius: 8, border: "1px solid #ccc" }} />
          {err && <div style={{ color: "#c62828", fontSize: 13 }}>{err}</div>}
          <button onClick={doLogin} disabled={loading || !u || !p}
            style={{ padding: "14px", fontSize: 18, fontWeight: 700, borderRadius: 8, border: "none", cursor: "pointer", background: loading ? "#9e9e9e" : "#1a237e", color: "#fff" }}>
            {t.login_btn}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main SmartRack PDA ─────────────────────────────────────────────────
export default function SmartRackPDA({ locale = "zh-CN" }: { locale?: Locale }) {
  const t = I18N[locale];
  const [token, setToken] = useState<string | null>(getToken());
  const [step, setStep] = useState<Step>("scan_wo");
  const [woData, setWoData] = useState<WMSData | null>(null);
  const [selectedItem, setSelectedItem] = useState<MaterialItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [slotNo, setSlotNo] = useState("");
  const [qty, setQty] = useState("");
  const [flashMsg, setFlashMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [flashLed, setFlashLed] = useState<string | null>(null);

  // Dispatch state
  const [sessions, setSessions] = useState<DispatchSession[]>([]);
  const [currentSession, setCurrentSession] = useState<DispatchSessionDetail | null>(null);
  const [activeAssignment, setActiveAssignment] = useState<DispatchAssignment | null>(null);
  const [joined, setJoined] = useState(false); // whether current PDA has joined the session

  const username = getUsername();

  const flash = (text: string, ok: boolean) => {
    setFlashMsg({ ok, text });
    setTimeout(() => setFlashMsg(null), 3000);
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = locale === "zh-CN" ? "zh-CN" : "vi-VN";
      speechSynthesis.speak(utter);
    } catch { /* no speech */ }
  };

  // ── Dispatch: Load session list ────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<{ sessions: DispatchSession[] }>("/api/dispatch/sessions?status=active");
      setSessions(data.sessions ?? []);
      setStep("session_list");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Dispatch: Join session ────────────────────────────────────────────
  const joinSession = useCallback(async (session: DispatchSession) => {
    setLoading(true);
    setError("");
    try {
      await apiPost("/api/dispatch/pdas", {
        sessionId: session.id,
        pdaId: `PDA_${username}_${Date.now()}`,
        operator: username,
        lineCode: session.lineCode,
      });
      // Load full session detail first, then transition in same batch
      const detail = await apiGet<DispatchSessionDetail>(`/api/dispatch/sessions/${session.id}`);
      setJoined(true);
      setCurrentSession(detail);
      setStep("dispatch_load");
    } catch (e) {
      flash(`${t.join_session_failed}: ${(e as Error).message}`, false);
    } finally {
      setLoading(false);
    }
  }, [username, t]);

  // ── Dispatch: Refresh current session ────────────────────────────────
  const refreshSession = useCallback(async () => {
    if (!currentSession) return;
    try {
      const detail = await apiGet<DispatchSessionDetail>(`/api/dispatch/sessions/${currentSession.id}`);
      setCurrentSession(detail);
    } catch { /* ignore refresh errors */ }
  }, [currentSession]);

  // ── Dispatch: Claim assignment ────────────────────────────────────────
  const claimAssignment = useCallback(async (assignment: DispatchAssignment) => {
    setLoading(true);
    setError("");
    try {
      await apiPost("/api/dispatch/claim", {
        assignmentId: assignment.id,
        pdaId: `PDA_${username}`,
        operator: username,
      });
      setActiveAssignment(assignment);
      setStep("dispatch_scan");
    } catch (e) {
      flash(`${t.claim_failed}: ${(e as Error).message}`, false);
    } finally {
      setLoading(false);
    }
  }, [username, t]);

  // ── Dispatch: Confirm feeder loading ─────────────────────────────────
  const confirmDispatchLoad = useCallback(async () => {
    if (!activeAssignment) return;
    setLoading(true);
    setError("");
    try {
      const lotNoVal = scanInput.trim() || activeAssignment.lotNo || "";
      await apiPost("/mes/feeder-loading", {
        workOrderCode: currentSession?.workOrderCode,
        lineCode: currentSession?.lineCode,
        slotNo: slotNo || "SMT-01",
        lotNo: lotNoVal,
        materialCode: activeAssignment.materialCode,
        qty: Number(qty) || 0,
        operator: username,
        assignmentId: activeAssignment.id,
      });
      flash(`${activeAssignment.materialCode} ${t.load_success}`, true);
      setScanInput("");
      setSlotNo("");
      setQty("");
      setActiveAssignment(null);
      setStep("dispatch_load");
      // Refresh session to see updated status
      await refreshSession();
    } catch (e) {
      flash(`${t.load_failed}: ${(e as Error).message}`, false);
    } finally {
      setLoading(false);
    }
  }, [activeAssignment, slotNo, scanInput, qty, currentSession, username, t, refreshSession]);

  // ── Traditional scan WO flow ────────────────────────────────────────
  const handleWoScan = useCallback(async () => {
    const code = scanInput.trim();
    if (!code) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<WMSData>(`/pmc/work-order-material-status?workOrderCode=${encodeURIComponent(code)}`);
      setWoData(data);
      setScanInput("");
      setStep("show_wo");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scanInput]);

  const handleSearchRack = useCallback(async (item: MaterialItem) => {
    setSelectedItem(item);
    setLoading(true);
    setError("");
    setFlashLed(null);
    try {
      const lots = await apiGet<{ items: LotOnRack[] }>(`/wms/shelf/material-lots?materialCode=${encodeURIComponent(item.materialCode)}`);
      if (lots.items?.length) {
        const lot = lots.items[0];
        await apiPost("/wms/shelf/rack-light", {
          shelfCode: lot.shelfCode,
          cellNumber: lot.cellNumber,
          color: 6,
        });
        setFlashLed(`${lot.shelfCode}-${lot.cellNumber}`);
        flash(`${item.materialCode} → ${lot.shelfCode}-${lot.cellNumber}`, true);
        setSelectedItem({ ...item, bestLot: { lotNo: lot.lotNo, shelfCode: lot.shelfCode, cellNo: lot.cellNumber, availQty: lot.qty, locType: "smart_rack" } });
      } else {
        flash(`${item.materialCode}: ${t.rack_not_found}`, false);
      }
      setStep("scan_lot");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleLotScan = useCallback(async () => {
    if (!selectedItem || !slotNo) return;
    setLoading(true);
    setError("");
    try {
      const lotNoOrLabel = scanInput.trim() || selectedItem.bestLot?.lotNo || "";
      await apiPost("/mes/feeder-loading", {
        workOrderCode: woData?.workOrder.woCode,
        lineCode: woData?.workOrder.lineCode,
        slotNo: slotNo || "SMT-01",
        lotNo: lotNoOrLabel,
        materialCode: selectedItem.materialCode,
        qty: Number(qty) || selectedItem.bestLot?.availQty || 0,
      });
      flash(`${selectedItem.materialCode} ${t.load_success}`, true);
      setScanInput("");
      setStep("done");
      setTimeout(() => {
        setStep("show_wo");
        setSelectedItem(null);
        setFlashLed(null);
      }, 2500);
    } catch (e) {
      flash(`${t.load_failed}: ${(e as Error).message}`, false);
    } finally {
      setLoading(false);
    }
  }, [selectedItem, scanInput, slotNo, qty, woData, t]);

  // ── Reset / logout ───────────────────────────────────────────────────
  const handleLogout = () => {
    sessionStorage.removeItem("pda_token");
    sessionStorage.removeItem("pda_username");
    setToken(null);
    setStep("scan_wo");
    setWoData(null);
    setCurrentSession(null);
    setSessions([]);
    setJoined(false);
    setActiveAssignment(null);
  };

  const resetToWoScan = () => {
    setStep("scan_wo");
    setWoData(null);
    setSelectedItem(null);
    setCurrentSession(null);
    setSessions([]);
    setJoined(false);
    setActiveAssignment(null);
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (!token) {
    return <LoginScreen locale={locale} onLogin={setToken} />;
  }

  const isDispatchMode = step === "session_list" || step === "dispatch_load" || step === "dispatch_scan";

  const bg: Record<string, string> = {
    scan_wo: "#e8eaf6",
    show_wo: "#e8f5e9",
    scan_lot: "#fff8e1",
    done: "#e8f5e9",
    session_list: "#f3e5f5",
    dispatch_load: "#e8f5e9",
    dispatch_scan: "#fff8e1",
  };

  return (
    <div style={{ fontFamily: "Arial, sans-serif", minHeight: "100vh", background: bg[step], display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header style={{ background: "#1a237e", color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 20, fontWeight: 900 }}>{t.title}</span>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 6, marginLeft: 12 }}>
          <button onClick={() => { if (step !== "scan_wo") resetToWoScan(); }}
            style={{ background: step === "scan_wo" || step === "show_wo" || step === "scan_lot" || step === "done" ? "#3949ab" : "#283593", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            📋 {t.nav_scan}
          </button>
          <button onClick={loadSessions}
            style={{ background: isDispatchMode ? "#3949ab" : "#283593", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            📡 {t.nav_dispatch}
          </button>
        </div>

        {/* Session badge */}
        {currentSession && (
          <span style={{ background: "#3949ab", borderRadius: 6, padding: "4px 10px", fontSize: 13 }}>
            {currentSession.workOrderCode}
          </span>
        )}

        <button onClick={handleLogout}
          style={{ marginLeft: "auto", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>
          {t.logout}
        </button>
      </header>

      {/* Flash message */}
      {flashMsg && (
        <div style={{
          margin: 12, padding: "10px 16px", borderRadius: 8, textAlign: "center", fontWeight: 700, fontSize: 16,
          background: flashMsg.ok ? "#e8f5e9" : "#ffebee",
          color: flashMsg.ok ? "#2e7d32" : "#c62828",
          border: `2px solid ${flashMsg.ok ? "#2e7d32" : "#c62828"}`,
        }}>
          {flashMsg.text}
        </div>
      )}

      {/* ── Session List ──────────────────────────────────────────── */}
      {step === "session_list" && (
        <main style={{ flex: 1, padding: 12, overflow: "auto" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a237e", marginBottom: 12 }}>{t.session_list_title}</div>
          {loading ? (
            <div style={{ textAlign: "center", color: "#888", padding: 32 }}>{t.step_loading}</div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: "center", color: "#888", padding: 32 }}>{t.session_no_data}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sessions.map((s) => {
                const pct = s.progress.total > 0 ? Math.round(s.progress.loaded / s.progress.total * 100) : 0;
                const isDone = s.progress.loaded === s.progress.total && s.progress.total > 0;
                return (
                  <div key={s.id} style={{ background: "#fff", borderRadius: 12, padding: 14, boxShadow: "0 2px 8px #0001",
                    borderLeft: `5px solid ${isDone ? "#2e7d32" : "#7b1fa2"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 16, color: "#1a237e" }}>{s.workOrderCode}</div>
                        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{s.lineCode ? `Line: ${s.lineCode}` : ""} · {new Date(s.createdAt).toLocaleTimeString()}</div>
                      </div>
                      <button
                        onClick={() => joinSession(s)}
                        style={{ background: "#7b1fa2", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                        {t.session_join}
                      </button>
                    </div>
                    {/* Progress bar */}
                    <div style={{ background: "#e0e0e0", borderRadius: 6, height: 10, overflow: "hidden", marginBottom: 6 }}>
                      <div style={{ background: isDone ? "#2e7d32" : "#7b1fa2", height: "100%", width: `${pct}%`, transition: "width 0.3s" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666" }}>
                      <span>{t.session_loaded}: <b style={{ color: "#2e7d32" }}>{s.progress.loaded}</b> / <b>{s.progress.total}</b></span>
                      <span style={{ color: isDone ? "#2e7d32" : "#f57c00", fontWeight: 700 }}>
                        {isDone ? t.all_loaded : `${s.progress.pending} ${t.session_pending}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {error && <div style={{ color: "#c62828", fontSize: 14, marginTop: 8 }}>{error}</div>}
          <button onClick={resetToWoScan}
            style={{ marginTop: 16, padding: "10px 24px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer", background: "#fff", fontSize: 14 }}>
            ← {t.back}
          </button>
        </main>
      )}

      {/* ── Dispatch Load (assignments list) ─────────────────────── */}
      {step === "dispatch_load" && currentSession && (
        <main style={{ flex: 1, padding: 12, overflow: "auto" }}>
          {/* Session header */}
          <div style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 12, boxShadow: "0 2px 8px #0001" }}>
            <div style={{ fontWeight: 900, fontSize: 16, color: "#1a237e" }}>{currentSession.workOrderCode}</div>
            <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
              {currentSession.lineCode ? `Line: ${currentSession.lineCode}` : ""} · {t.dispatch_assignments}: {currentSession.progress.loaded}/{currentSession.progress.total}
            </div>
          </div>

          {/* All done */}
          {currentSession.progress.loaded === currentSession.progress.total && currentSession.progress.total > 0 && (
            <div style={{ background: "#e8f5e9", borderRadius: 10, padding: 20, textAlign: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#2e7d32" }}>{t.all_loaded}</div>
            </div>
          )}

          {/* Assignments */}
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#333" }}>{t.dispatch_assignments}</div>
          {currentSession.assignments.length === 0 ? (
            <div style={{ textAlign: "center", color: "#888", padding: 24 }}>{t.no_data}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {currentSession.assignments.map((a) => {
                const isLoaded = a.status === "loaded";
                const isLoading = a.status === "loading";
                const isPending = a.status === "pending";
                const borderColor = isLoaded ? "#2e7d32" : isLoading ? "#f57c00" : "#9e9e9e";
                const statusLabel = isLoaded ? t.fulfilled : isLoading ? t.loading : t.dispatch_claim;
                return (
                  <div key={a.id} style={{ background: "#fff", borderRadius: 10, padding: 12, boxShadow: "0 2px 6px #0001",
                    borderLeft: `4px solid ${borderColor}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#1a237e" }}>{a.materialCode}</div>
                        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{a.materialNameZh}</div>
                        {isLoaded && a.feederSlot && (
                          <div style={{ fontSize: 12, color: "#2e7d32", fontWeight: 600, marginTop: 4 }}>
                            ✓ Slot {a.feederSlot} · {a.lotNo}
                          </div>
                        )}
                        {isLoading && (
                          <div style={{ fontSize: 12, color: "#f57c00", fontWeight: 600, marginTop: 4 }}>
                            {t.dispatch_claimed}...
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: "4px 8px", borderRadius: 6,
                          background: isLoaded ? "#e8f5e9" : isLoading ? "#fff3e0" : "#e3f2fd",
                          color: isLoaded ? "#2e7d32" : isLoading ? "#f57c00" : "#1565c0",
                        }}>
                          {statusLabel}
                        </span>
                        {isPending && (
                          <button onClick={() => claimAssignment(a)}
                            style={{ fontSize: 13, fontWeight: 700, padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", background: "#1565c0", color: "#fff" }}>
                            {t.dispatch_claim}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error && <div style={{ color: "#c62828", fontSize: 14, marginTop: 8 }}>{error}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={() => { setStep("session_list"); setCurrentSession(null); setJoined(false); setActiveAssignment(null); }}
              style={{ flex: 1, padding: "10px 24px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer", background: "#fff", fontSize: 14 }}>
              ← {t.dispatch_back}
            </button>
            <button onClick={refreshSession} disabled={loading}
              style={{ flex: 1, padding: "10px 24px", borderRadius: 8, border: "none", cursor: "pointer", background: "#1565c0", color: "#fff", fontSize: 14, fontWeight: 700 }}>
              🔄 刷新
            </button>
          </div>
        </main>
      )}

      {/* ── Dispatch Scan Lot (claim → scan → load) ───────────────── */}
      {step === "dispatch_scan" && activeAssignment && (
        <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a237e" }}>{t.dispatch_scan_lot}</div>

          {/* Selected material */}
          <div style={{ background: "#fff", borderRadius: 12, padding: "16px 24px", textAlign: "center", boxShadow: "0 2px 12px #0001" }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#1a237e" }}>{activeAssignment.materialCode}</div>
            <div style={{ fontSize: 14, color: "#666", marginTop: 4 }}>{activeAssignment.materialNameZh}</div>
          </div>

          {/* Slot input */}
          <input value={slotNo} onChange={e => setSlotNo(e.target.value)}
            placeholder={`${t.slot_no} (选填)`}
            style={{ fontSize: 20, padding: "14px 20px", width: "100%", maxWidth: 400, borderRadius: 10, border: "2px solid #9e9e9e", textAlign: "center", outline: "none" }} />

          {/* Lot scan */}
          <input value={scanInput} onChange={e => setScanInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !loading && confirmDispatchLoad()}
            placeholder={`${t.lot_label} (${t.scan_hint})`}
            style={{ fontSize: 20, padding: "14px 20px", width: "100%", maxWidth: 400, borderRadius: 10, border: "2px solid #f57c00", textAlign: "center", outline: "none" }} />

          <button onClick={confirmDispatchLoad} disabled={loading}
            style={{ fontSize: 22, fontWeight: 900, padding: "18px 72px", borderRadius: 14, border: "none", cursor: "pointer", background: loading || !slotNo ? "#9e9e9e" : "#f57c00", color: "#fff", boxShadow: "0 4px 16px #f57c0044" }}>
            {loading ? t.loading : `✓ ${t.dispatch_load_confirm}`}
          </button>

          {error && <div style={{ color: "#c62828", fontSize: 14 }}>{error}</div>}

          <button onClick={() => { setStep("dispatch_load"); setActiveAssignment(null); setSlotNo(""); setScanInput(""); }}
            style={{ padding: "8px 20px", borderRadius: 6, border: "1px solid #ccc", cursor: "pointer", background: "#fff" }}>
            ← {t.back}
          </button>
        </main>
      )}

      {/* ── Traditional scan WO (kept as-is) ────────────────────── */}
      {step === "scan_wo" && (
        <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, gap: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a237e" }}>{t.step_scan_wo}</div>
          <input value={scanInput} onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !loading && handleWoScan()}
            placeholder={t.scan_hint}
            style={{ fontSize: 22, padding: "16px 24px", width: "100%", maxWidth: 400, borderRadius: 12, border: "2px solid #1a237e", textAlign: "center", outline: "none" }}
            autoFocus />
          <button onClick={handleWoScan} disabled={loading || !scanInput.trim()}
            style={{ fontSize: 20, fontWeight: 700, padding: "16px 64px", borderRadius: 12, border: "none", cursor: "pointer", background: loading ? "#9e9e9e" : "#1a237e", color: "#fff" }}>
            {loading ? t.step_loading : "🔍 " + t.search_rack}
          </button>
          {error && <div style={{ color: "#c62828", fontSize: 14 }}>{error}</div>}
        </main>
      )}

      {/* Step: Show WO materials */}
      {step === "show_wo" && woData && (
        <main style={{ flex: 1, padding: 12, overflow: "auto" }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 12, marginBottom: 12, boxShadow: "0 2px 8px #0001" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a237e" }}>{woData.workOrder.woCode}</div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{woData.workOrder.productCode} · {woData.workOrder.lineCode}</div>
            <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{t.wo_qty}: {woData.workOrder.plannedQty}</div>
          </div>

          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#333" }}>{t.material_required}</div>
          {woData.items.length === 0 ? (
            <div style={{ textAlign: "center", color: "#888", padding: 24 }}>{t.no_data}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {woData.items.map((item, idx) => {
                const isShortfall = item.shortfall > 0;
                const isFulfilled = item.shortfall === 0;
                return (
                  <div key={idx} style={{ background: "#fff", borderRadius: 10, padding: 12, boxShadow: "0 2px 6px #0001",
                    borderLeft: `4px solid ${isFulfilled ? "#2e7d32" : isShortfall ? "#f57c00" : "#888"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#1a237e" }}>{item.materialCode}</div>
                        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{item.materialNameZh}</div>
                        <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                          {t.qty}: {item.totalRequired} | 已拣: {item.pickedQty}
                        </div>
                        {item.bestLot && (
                          <div style={{ fontSize: 12, color: "#2e7d32", fontWeight: 600, marginTop: 4 }}>
                            📍 {item.bestLot.shelfCode}-{item.bestLot.cellNo} · {item.bestLot.lotNo} · {item.bestLot.availQty}pcs
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <span style={{
                          fontSize: 12, fontWeight: 700, padding: "4px 8px", borderRadius: 6,
                          background: isFulfilled ? "#e8f5e9" : "#fff3e0",
                          color: isFulfilled ? "#2e7d32" : "#f57c00",
                        }}>
                          {isFulfilled ? t.fulfilled : `${t.shortfall}: ${item.shortfall}`}
                        </span>
                        <button onClick={() => handleSearchRack(item)}
                          style={{ fontSize: 13, fontWeight: 700, padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", background: "#1a237e", color: "#fff" }}>
                          🔍 {t.search_rack}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button onClick={resetToWoScan}
            style={{ marginTop: 16, padding: "10px 24px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer", background: "#fff", fontSize: 14 }}>
            ← {t.step_scan_wo}
          </button>
        </main>
      )}

      {/* Step: Scan lot + confirm feeder load (traditional) */}
      {(step === "scan_lot" || step === "done") && selectedItem && (
        <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
          {step === "scan_lot" ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a237e" }}>{t.step_scan_lot}</div>

              <div style={{ background: "#fff", borderRadius: 12, padding: "16px 24px", textAlign: "center", boxShadow: "0 2px 12px #0001" }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#1a237e" }}>{selectedItem.materialCode}</div>
                {selectedItem.bestLot && (
                  <div style={{ fontSize: 16, color: "#2e7d32", fontWeight: 600, marginTop: 6 }}>
                    📍 {selectedItem.bestLot.shelfCode}-{selectedItem.bestLot.cellNo}
                    {flashLed && <span style={{ marginLeft: 8, background: "#e8f5e9", borderRadius: 4, padding: "2px 8px" }}>💡 {t.led_lit}</span>}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{selectedItem.bestLot?.lotNo} · {selectedItem.bestLot?.availQty}pcs</div>
              </div>

              <div style={{ display: "flex", gap: 12, width: "100%", maxWidth: 400 }}>
                <input value={slotNo} onChange={e => setSlotNo(e.target.value)}
                  placeholder={`${t.slot_no} (选填)`}
                  style={{ flex: 1, padding: "14px 16px", fontSize: 18, borderRadius: 8, border: "1px solid #ccc", textAlign: "center" }} />
                <input value={qty} onChange={e => setQty(e.target.value)}
                  placeholder={t.qty}
                  type="number"
                  style={{ width: 100, padding: "14px 12px", fontSize: 18, borderRadius: 8, border: "1px solid #ccc", textAlign: "center" }} />
              </div>

              <input value={scanInput} onChange={e => setScanInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !loading && slotNo && handleLotScan()}
                placeholder={`${t.lot_label} (${t.scan_hint})`}
                style={{ fontSize: 20, padding: "14px 20px", width: "100%", maxWidth: 400, borderRadius: 10, border: "2px solid #f57c00", textAlign: "center", outline: "none" }}
                autoFocus />

              <button onClick={handleLotScan} disabled={loading}
                style={{ fontSize: 22, fontWeight: 900, padding: "18px 72px", borderRadius: 14, border: "none", cursor: "pointer", background: loading ? "#9e9e9e" : "#f57c00", color: "#fff", boxShadow: "0 4px 16px #f57c0044" }}>
                {loading ? t.loading : `✓ ${t.confirm_load}`}
              </button>

              {error && <div style={{ color: "#c62828", fontSize: 14 }}>{error}</div>}

              <button onClick={() => { setStep("show_wo"); setSelectedItem(null); setFlashLed(null); }}
                style={{ padding: "8px 20px", borderRadius: 6, border: "1px solid #ccc", cursor: "pointer", background: "#fff" }}>
                ← 返回物料列表
              </button>
            </>
          ) : (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#2e7d32" }}>{t.step_done}</div>
              <div style={{ fontSize: 16, color: "#666", marginTop: 8 }}>{selectedItem.materialCode}</div>
            </div>
          )}
        </main>
      )}

    </div>
  );
}
