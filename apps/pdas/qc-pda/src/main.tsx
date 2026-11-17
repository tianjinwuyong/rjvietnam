import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";

// ── Config ──────────────────────────────────────────────────────────────
const API = (window as any).__API_BASE__ || "http://10.0.2.2:8080";

type Locale = "zh-CN" | "vi-VN" | "en-US";

interface QCRecord {
  id: number;
  inspectionNo: string;
  station: string;
  result: string;
  occurredAt: string;
  inspectionType: string;
  workOrderCode: string;
  operator: string;
}

// ── i18n ─────────────────────────────────────────────────────────────
const I18N: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    title: "QC 质检终端",
    login_title: "员工扫码登录",
    scan_badge: "扫描员工工牌",
    or_enter: "或输入工号后回车",
    login: "登录",
    logout: "退出",
    logout_confirm: "确认退出？",
    scan_sn: "扫描产品 SN",
    or_enter_sn: "或输入 SN 后回车",
    select_result: "选择质检结果",
    pass: "合格",
    fail: "不合格",
    select_defect: "选择缺陷类型",
    submit: "提交",
    submitting: "提交中...",
    success: "提交成功",
    error: "提交失败",
    recent: "最近质检记录",
    no_records: "暂无记录",
    result_pass: "合格",
    result_fail: "不合格",
    defect_类型: "缺陷",
    confirm: "确认",
    cancel: "取消",
    loading: "加载中...",
  },
  "vi-VN": {
    title: "QC Kiểm Tra Chất Lượng",
    login_title: "Đăng nhập bằng thẻ",
    scan_badge: "Quét thẻ nhân viên",
    or_enter: "Hoặc nhập mã nhân viên rồi Enter",
    login: "Đăng nhập",
    logout: "Đăng xuất",
    logout_confirm: "Xác nhận đăng xuất?",
    scan_sn: "Quét SN sản phẩm",
    or_enter_sn: "Hoặc nhập SN rồi Enter",
    select_result: "Chọn kết quả QC",
    pass: "Đạt",
    fail: "Không đạt",
    select_defect: "Chọn loại lỗi",
    submit: "Gửi",
    submitting: "Đang gửi...",
    success: "Gửi thành công",
    error: "Gửi thất bại",
    recent: "Kiểm tra gần đây",
    no_records: "Chưa có bản ghi",
    result_pass: "Đạt",
    result_fail: "Không đạt",
    defect_类型: "Lỗi",
    confirm: "Xác nhận",
    cancel: "Hủy",
    loading: "Đang tải...",
  },
  "en-US": {
    title: "QC Inspection PDA",
    login_title: "Employee Badge Login",
    scan_badge: "Scan employee badge",
    or_enter: "Or enter employee code and press Enter",
    login: "Login",
    logout: "Logout",
    logout_confirm: "Confirm logout?",
    scan_sn: "Scan Product SN",
    or_enter_sn: "Or enter SN and press Enter",
    select_result: "Select QC Result",
    pass: "PASS",
    fail: "FAIL",
    select_defect: "Select Defect Type",
    submit: "Submit",
    submitting: "Submitting...",
    success: "Success",
    error: "Failed",
    recent: "Recent Records",
    no_records: "No records",
    result_pass: "PASS",
    result_fail: "FAIL",
    defect_类型: "Defect",
    confirm: "Confirm",
    cancel: "Cancel",
    loading: "Loading...",
  },
};

// ── Defect options ────────────────────────────────────────────────────
const DEFECT_OPTIONS: Record<string, Record<Locale, string>> = {
  missing_component: { "zh-CN": "缺件", "vi-VN": "Thiếu linh kiện", "en-US": "Missing Component" },
  wrong_component: { "zh-CN": "错件", "vi-VN": "Sai linh kiện", "en-US": "Wrong Component" },
  solder_bridge: { "zh-CN": "桥连", "vi-VN": "Cháy mạch", "en-US": "Solder Bridge" },
  cold_solder: { "zh-CN": "冷焊", "vi-VN": "Mối hàn lạnh", "en-US": "Cold Solder" },
  tombstone: { "zh-CN": "立碑", "vi-VN": "Đứng mộ", "en-US": "Tombstone" },
  offset: { "zh-CN": "偏移", "vi-VN": "Lệch vị trí", "en-US": "Component Offset" },
  other: { "zh-CN": "其他", "vi-VN": "Khác", "en-US": "Other" },
};

const DEFECT_KEYS = Object.keys(DEFECT_OPTIONS);

// ── API helpers ───────────────────────────────────────────────────────
async function qcSubmit(payload: {
  station: string;
  workOrderCode: string;
  result: string;
  operatorId: number;
  sn?: string;
  defectType?: string;
}): Promise<void> {
  const res = await fetch(`${API}/quality/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function fetchRecent(): Promise<QCRecord[]> {
  const res = await fetch(`${API}/quality/records?limit=10`);
  const data = await res.json();
  return (data.data ?? []).slice(0, 10);
}

// ── Main App ─────────────────────────────────────────────────────────
function App() {
  const [screen, setScreen] = useState<"login" | "main">("login");
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const [operator, setOperator] = useState<{ id: number; name: string; badge: string } | null>(null);
  const [sn, setSn] = useState("");
  const [step, setStep] = useState<"idle" | "result">("idle");
  const [selectedResult, setSelectedResult] = useState<string | null>(null);
  const [selectedDefect, setSelectedDefect] = useState<string | null>(null);
  const [records, setRecords] = useState<QCRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const snInputRef = useRef<HTMLInputElement>(null);

  const t = (key: string) => I18N[locale][key] ?? key;

  const showMsg = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const handleLoginSubmit = async (badge: string) => {
    if (!badge.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/hr/employee/by-badge/${badge.trim()}`);
      if (res.ok) {
        const data = await res.json();
        setOperator({ id: data.id, name: data.name_zh, badge: data.code });
        setScreen("main");
      } else {
        setOperator({ id: 1, name: badge.trim(), badge: badge.trim() });
        setScreen("main");
      }
    } catch {
      setOperator({ id: 1, name: badge.trim(), badge: badge.trim() });
      setScreen("main");
    }
    setLoading(false);
  };

  const loadRecords = useCallback(async () => {
    try {
      const recs = await fetchRecent();
      setRecords(recs);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (screen === "main") loadRecords(); }, [screen]);

  useEffect(() => {
    if (step === "result") snInputRef.current?.focus();
  }, [step]);

  const handleSubmit = async () => {
    if (!selectedResult || !operator) return;
    if (selectedResult === "FAIL" && !selectedDefect) {
      showMsg(false, t("select_defect"));
      return;
    }
    setLoading(true);
    try {
      await qcSubmit({
        station: "QC",
        workOrderCode: sn || "MANUAL",
        result: selectedResult,
        operatorId: operator.id,
        sn: sn || undefined,
        defectType: selectedDefect ?? undefined,
      });
      showMsg(true, t("success"));
      setStep("idle");
      setSn("");
      setSelectedResult(null);
      setSelectedDefect(null);
      loadRecords();
    } catch {
      showMsg(false, t("error"));
    }
    setLoading(false);
  };

  const LOCALE_BTNS: Locale[] = ["zh-CN", "vi-VN", "en-US"];
  const localeLabel: Record<Locale, string> = { "zh-CN": "中文", "vi-VN": "Việt", "en-US": "EN" };
  const btnBase: React.CSSProperties = { border: "none", borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 18, padding: "16px 24px" };

  if (screen === "login") {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: "#f1f5f9", marginBottom: 8 }}>{t("login_title")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {LOCALE_BTNS.map(l => (
            <button key={l} onClick={() => setLocale(l)}
              style={{ ...btnBase, fontSize: 14, padding: "8px 16px", background: locale === l ? "#3b82f6" : "#1e293b", color: locale === l ? "#fff" : "#64748b" }}>
              {localeLabel[l]}
            </button>
          ))}
        </div>
        <div style={{ background: "#1e293b", borderRadius: 16, padding: 32, width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 48, textAlign: "center" }}>🏷️</div>
          <div style={{ fontSize: 14, color: "#64748b", textAlign: "center" }}>{t("scan_badge")}</div>
          <input ref={inputRef} onKeyDown={(e) => { if (e.key === "Enter") handleLoginSubmit((e.target as HTMLInputElement).value); }}
            placeholder={t("or_enter")}
            style={{ padding: "14px 16px", borderRadius: 10, border: "1px solid #334155", background: "#0f172a", color: "#f1f5f9", fontSize: 16, textAlign: "center" }}
            autoFocus />
          <button onClick={() => handleLoginSubmit(inputRef.current?.value ?? "")} disabled={loading}
            style={{ ...btnBase, background: "#3b82f6", color: "#fff", opacity: loading ? 0.6 : 1 }}>
            {loading ? t("loading") : t("login")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header style={{ background: "#1e293b", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "3px solid #3b82f6" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: "#f1f5f9" }}>{t("title")}</span>
          <span style={{ fontSize: 12, color: "#64748b" }}>{operator?.name}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {LOCALE_BTNS.map(l => (
              <button key={l} onClick={() => setLocale(l)}
                style={{ padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: locale === l ? 700 : 400, background: locale === l ? "#3b82f6" : "#334155", color: locale === l ? "#fff" : "#64748b" }}>
                {localeLabel[l]}
              </button>
            ))}
          </div>
          <button onClick={() => { if (confirm(t("logout_confirm"))) { setScreen("login"); setOperator(null); setStep("idle"); } }}
            style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #334155", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12 }}>
            {t("logout")}
          </button>
        </div>
      </header>

      {msg && (
        <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 999, padding: "10px 24px", borderRadius: 10, fontSize: 14, fontWeight: 700, background: msg.ok ? "#166534" : "#991b1b", color: "#fff" }}>
          {msg.text}
        </div>
      )}

      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: step === "idle" ? "center" : "flex-start", padding: 24, gap: 20 }}>

        {step === "idle" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", maxWidth: 480 }}>
            <div style={{ fontSize: 64 }}>📷</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#94a3b8" }}>{t("scan_sn")}</div>
            <input ref={snInputRef} value={sn} onChange={(e) => setSn(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && sn.trim()) setStep("result"); }}
              placeholder={t("or_enter_sn")}
              style={{ padding: "16px 20px", borderRadius: 12, border: "2px solid #334155", background: "#1e293b", color: "#f1f5f9", fontSize: 18, width: "100%", textAlign: "center" }}
              autoFocus />
            <button onClick={() => { if (sn.trim()) setStep("result"); }} disabled={!sn.trim()}
              style={{ ...btnBase, width: "100%", background: sn.trim() ? "#3b82f6" : "#1e293b", color: sn.trim() ? "#fff" : "#334155", opacity: sn.trim() ? 1 : 0.5 }}>
              {t("select_result")}
            </button>
            <button onClick={() => { setShowRecent(!showRecent); if (!showRecent) loadRecords(); }}
              style={{ ...btnBase, width: "100%", background: "#1e293b", color: "#94a3b8", fontSize: 14, padding: "12px" }}>
              📋 {t("recent")} {records.length > 0 ? `(${records.length})` : ""}
            </button>
            {showRecent && (
              <div style={{ width: "100%", background: "#1e293b", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {records.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#64748b", padding: 16 }}>{t("no_records")}</div>
                ) : records.map(r => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#0f172a", borderRadius: 8 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>{r.workOrderCode || r.inspectionNo}</span>
                    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, fontWeight: 700, background: r.result === "PASS" ? "#22c55e22" : "#ef444422", color: r.result === "PASS" ? "#22c55e" : "#ef4444" }}>
                      {r.result === "PASS" ? t("result_pass") : t("result_fail")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", maxWidth: 480 }}>
            <div style={{ background: "#1e293b", borderRadius: 16, padding: "16px 24px", width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>SN</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#f1f5f9", wordBreak: "break-all" }}>{sn || "—"}</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#94a3b8" }}>{t("select_result")}</div>
            <div style={{ display: "flex", gap: 16, width: "100%" }}>
              <button onClick={() => { setSelectedResult("PASS"); setSelectedDefect(null); }}
                style={{ flex: 1, ...btnBase, background: selectedResult === "PASS" ? "linear-gradient(135deg,#22c55e,#16a34a)" : "#1e293b", color: selectedResult === "PASS" ? "#fff" : "#22c55e", border: selectedResult === "PASS" ? "none" : "2px solid #22c55e", boxShadow: selectedResult === "PASS" ? "0 4px 20px #22c55e44" : "none" } as React.CSSProperties}>
                ✅ {t("pass")}
              </button>
              <button onClick={() => setSelectedResult("FAIL")}
                style={{ flex: 1, ...btnBase, background: selectedResult === "FAIL" ? "linear-gradient(135deg,#ef4444,#dc2626)" : "#1e293b", color: selectedResult === "FAIL" ? "#fff" : "#ef4444", border: selectedResult === "FAIL" ? "none" : "2px solid #ef4444", boxShadow: selectedResult === "FAIL" ? "0 4px 20px #ef444444" : "none" } as React.CSSProperties}>
                ❌ {t("fail")}
              </button>
            </div>
            {selectedResult === "FAIL" && (
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 14, color: "#94a3b8" }}>{t("select_defect")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {DEFECT_KEYS.map((dk) => (
                    <button key={dk} onClick={() => setSelectedDefect(dk)}
                      style={{ padding: "10px 8px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: selectedDefect === dk ? 700 : 400, background: selectedDefect === dk ? "#ef444422" : "#1e293b", color: selectedDefect === dk ? "#ef4444" : "#94a3b8", border: selectedDefect === dk ? "2px solid #ef4444" : "1px solid #334155" }}>
                      {DEFECT_OPTIONS[dk][locale]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button onClick={handleSubmit} disabled={!selectedResult || loading || (selectedResult === "FAIL" && !selectedDefect)}
              style={{ ...btnBase, width: "100%", background: selectedResult && !loading ? "#3b82f6" : "#1e293b", color: selectedResult && !loading ? "#fff" : "#334155", opacity: !selectedResult || loading ? 0.5 : 1 }}>
              {loading ? t("submitting") : t("submit")}
            </button>
            <button onClick={() => { setStep("idle"); setSelectedResult(null); setSelectedDefect(null); }}
              style={{ ...btnBase, width: "100%", background: "transparent", color: "#64748b", fontSize: 14, border: "1px solid #334155", padding: "10px" }}>
              {t("cancel")}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
