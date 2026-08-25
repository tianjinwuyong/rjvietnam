import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, QrCode, Clock, User, ChevronRight, LogOut, RefreshCw, Calendar, Plus, CheckCircle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import { apiClient } from "../api/client";
import type { LeaveRequest } from "../api/hr";
import QRCode from "qrcode";

interface EmployeeProfile {
  id: number;
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  gender: string;
  phone: string;
  email: string;
  department: string;
  position: string;
  hireDate: string;
  avatar_url: string | null;
}

interface QrData {
  hasActiveQr: boolean;
  qrContent?: string;
  expiresAt?: string;
  issuedAt?: string;
}

type TabKey = "profile" | "qr" | "clock" | "leave" | "grievance";

const LEAVE_TYPES = ["annual", "sick", "personal", "unpaid"] as const;
type LeaveType = typeof LEAVE_TYPES[number];

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
}

export function EmployeePanel({ locale, employeeId, onSignOut }: { locale: Locale; employeeId: number; onSignOut: () => void }) {
  const [tab, setTab] = useState<TabKey>("profile");
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [qrData, setQrData] = useState<QrData | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [clockLoading, setClockLoading] = useState(false);
  const [clockStatus, setClockStatus] = useState<"in" | "out" | null>(null);
  const [clockMessage, setClockMessage] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ leaveType: "annual" as LeaveType, startDate: "", endDate: "", reason: "" });
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveMessage, setLeaveMessage] = useState<{ ok: boolean; msg: string } | null>(null);
  const [grievances, setGrievances] = useState<any[]>([]);
  const [grievanceForm, setGrievanceForm] = useState({ subjectEmployeeCode: "", lineCode: "", allegationCategory: "UNFAIR_TREATMENT", complaintText: "" });
  const [grievanceMessage, setGrievanceMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load employee profile
  useEffect(() => {
    hrApi.getEmployeeById(employeeId).then((emp) => {
      setProfile(emp as unknown as EmployeeProfile);
    }).catch(() => {});
  }, [employeeId]);

  useEffect(() => {
    apiClient.get<any[]>("/hr/grievance-cases/mine").then((items) => setGrievances(items ?? [])).catch(() => {});
  }, [employeeId]);

  // Clock status
  useEffect(() => {
    hrApi.getAttendanceSummary(employeeId).then((res) => {
      const records = res.items ?? [];
      const today = new Date().toISOString().slice(0, 10);
      const todayRec = records.find((r: any) => (r.date ?? "").slice(0, 10) === today);
      if (todayRec) {
        setClockStatus((todayRec as any).clockOutTime ? "out" : "in");
      }
    }).catch(() => {});
  }, [employeeId]);

  // Load leave requests
  useEffect(() => {
    hrApi.getLeaveRequests({ employeeId, limit: 50 }).then((res) => {
      setLeaveRequests(res.items);
    }).catch(() => {});
  }, [employeeId]);

  // Generate QR
  const generateQr = useCallback(async () => {
    if (!profile) return;
    setQrLoading(true);
    try {
      const res = await hrApi.generateEmployeeQr(profile.id, 365);
      setQrData({ ...res.item });
      setTab("qr");
    } catch {
      setQrData({ hasActiveQr: false });
    }
    setQrLoading(false);
  }, [profile]);

  // Draw QR to canvas when qrData changes
  useEffect(() => {
    if (qrData?.qrContent && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrData.qrContent, {
        width: 220,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "M",
      }).catch(() => {});
    }
  }, [qrData?.qrContent]);

  // Clock in / out
  const handleClock = async () => {
    if (!profile) return;
    setClockLoading(true);
    setClockMessage(null);
    try {
      if (clockStatus === "in") {
        await hrApi.clockOut(profile.id);
        setClockStatus("out");
        setClockMessage(t("employee.clockOutSuccess", locale));
      } else {
        await hrApi.clockIn(profile.id);
        setClockStatus("in");
        setClockMessage(t("employee.clockInSuccess", locale));
      }
    } catch (e: any) {
      setClockMessage(e?.message ?? t("employee.clockError", locale));
    }
    setClockLoading(false);
    setTimeout(() => setClockMessage(null), 4000);
  };

  // Avatar upload
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      formData.append("employeeId", String(profile.id));
      const result = await hrApi.uploadAvatar(profile.id, formData);
      setProfile((p) => p ? { ...p, avatar_url: (result as any).avatar_url } : p);
    } catch {}
    setUploading(false);
  };

  // Leave request submit
  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveForm.startDate || !leaveForm.endDate) return;
    setLeaveSubmitting(true);
    setLeaveMessage(null);
    try {
      const res = await hrApi.createLeaveRequest(leaveForm);
      setLeaveRequests((prev) => [res.item, ...prev]);
      setLeaveMessage({ ok: true, msg: t("employee.leave.submitted", locale) ?? "Leave request submitted" });
      setLeaveForm({ leaveType: "annual", startDate: "", endDate: "", reason: "" });
    } catch {
      setLeaveMessage({ ok: false, msg: t("employee.leave.error", locale) ?? "Failed to submit" });
    }
    setLeaveSubmitting(false);
    setTimeout(() => setLeaveMessage(null), 4000);
  };

  const name = locale === "vi-VN" ? (profile?.name_vi ?? "—") : locale === "en-US" ? (profile?.name_en ?? "—") : (profile?.name_zh ?? "—") ?? "—";

  return (
    <div className="employee-panel">
      {/* Header */}
      <div className="ep-header">
        <div className="ep-avatar-wrap" onClick={() => fileInputRef.current?.click()}>
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt={name} className="ep-avatar" />
          ) : (
            <div className="ep-avatar ep-avatar-placeholder">
              {name.slice(0, 1)}
            </div>
          )}
          <div className="ep-avatar-overlay">
            <Camera size={18} />
          </div>
          {uploading && <div className="ep-avatar-uploading">{t("employee.uploading", locale)}</div>}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarChange} />
        <div className="ep-info">
          <div className="ep-name">{name}</div>
          <div className="ep-code">{profile?.code}</div>
          <div className="ep-dept">{profile?.department ?? ""} / {profile?.position ?? ""}</div>
        </div>
        <button className="ep-signout" onClick={onSignOut} title={t("auth.signOut", locale)}>
          <LogOut size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="ep-tabs">
        <button className={`ep-tab${tab === "profile" ? " active" : ""}`} onClick={() => setTab("profile")}>
          <User size={16} /> {t("employee.tab.profile", locale)}
        </button>
        <button className={`ep-tab${tab === "qr" ? " active" : ""}`} onClick={() => setTab("qr")}>
          <QrCode size={16} /> {t("employee.tab.qr", locale)}
        </button>
        <button className={`ep-tab${tab === "clock" ? " active" : ""}`} onClick={() => setTab("clock")}>
          <Clock size={16} /> {t("employee.tab.clock", locale)}
        </button>
        <button className={`ep-tab${tab === "leave" ? " active" : ""}`} onClick={() => setTab("leave")}>
          <Calendar size={16} /> {t("employee.tab.leave", locale)}
        </button>
        <button className={`ep-tab${tab === "grievance" ? " active" : ""}`} onClick={() => setTab("grievance")}>
          <CheckCircle size={16} /> 员工申诉
        </button>
      </div>

      {/* Profile Tab */}
      {tab === "profile" && profile && (
        <div className="ep-content">
          <div className="ep-card">
            <div className="ep-card-title">{t("employee.profileInfo", locale)}</div>
            <div className="ep-field"><span>{t("employee.fields.phone", locale)}</span><strong>{profile.phone || "—"}</strong></div>
            <div className="ep-field"><span>{t("employee.fields.email", locale)}</span><strong>{profile.email || "—"}</strong></div>
            <div className="ep-field"><span>{t("employee.fields.gender", locale)}</span><strong>{profile.gender === "M" ? t("employee.gender.male", locale) : profile.gender === "F" ? t("employee.gender.female", locale) : "—"}</strong></div>
            <div className="ep-field"><span>{t("employee.fields.hireDate", locale)}</span><strong>{formatDate(profile.hireDate)}</strong></div>
          </div>
          <button className="ep-primary-btn" onClick={() => fileInputRef.current?.click()}>
            <Camera size={16} /> {t("employee.uploadAvatar", locale)}
          </button>
        </div>
      )}

      {/* QR Tab */}
      {tab === "qr" && (
        <div className="ep-content">
          {!qrData && !qrLoading && (
            <div className="ep-card ep-center">
              <QrCode size={48} style={{ color: "var(--muted)", margin: "0 auto 16px" }} />
              <p style={{ color: "var(--muted)", marginBottom: 20 }}>{t("employee.qr.prompt", locale)}</p>
              <button className="ep-primary-btn" onClick={generateQr} disabled={qrLoading}>
                <QrCode size={16} /> {t("employee.qr.generate", locale)}
              </button>
            </div>
          )}
          {qrLoading && <div className="ep-loading">{t("common.loading", locale)}...</div>}
          {qrData && qrData.hasActiveQr && (
            <div className="ep-card ep-center">
              <canvas ref={canvasRef} style={{ display: "block", margin: "0 auto", borderRadius: 8 }} />
              <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
                {t("employee.qr.expiresAt", locale)}: {formatDate(qrData.expiresAt ?? null)}
              </p>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {t("employee.qr.hint", locale)}
              </p>
              <button className="ep-secondary-btn" onClick={generateQr} style={{ marginTop: 12 }}>
                <RefreshCw size={14} /> {t("employee.qr.regenerate", locale)}
              </button>
            </div>
          )}
          {qrData && !qrData.hasActiveQr && !qrLoading && (
            <div className="ep-card ep-center">
              <p style={{ color: "var(--muted)", marginBottom: 16 }}>{t("employee.qr.inactive", locale)}</p>
              <button className="ep-primary-btn" onClick={generateQr}>
                <QrCode size={16} /> {t("employee.qr.generate", locale)}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Clock Tab */}
      {tab === "clock" && (
        <div className="ep-content">
          <div className="ep-card ep-center">
            <div className={`ep-clock-status ${clockStatus === "in" ? "ep-clock-in" : clockStatus === "out" ? "ep-clock-out" : ""}`}>
              <Clock size={40} />
              <div className="ep-clock-label">
                {clockStatus === "in" ? t("employee.clockStatus.in", locale) : clockStatus === "out" ? t("employee.clockStatus.out", locale) : t("employee.clockStatus.none", locale)}
              </div>
            </div>
            {clockMessage && <div className="ep-clock-message">{clockMessage}</div>}
            <button
              className={`ep-clock-btn ${clockStatus === "in" ? "ep-clock-out-btn" : "ep-clock-in-btn"}`}
              onClick={handleClock}
              disabled={clockLoading}
            >
              {clockLoading ? t("common.loading", locale) + "..." : clockStatus === "in" ? t("employee.clockOut", locale) : t("employee.clockIn", locale)}
            </button>
          </div>
        </div>
      )}

      {/* Leave Tab */}
      {tab === "leave" && (
        <div className="ep-content">
          <div className="ep-card">
            <div className="ep-card-title">{t("employee.leave.newRequest", locale)}</div>
            <form onSubmit={handleLeaveSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, leaveType: e.target.value as LeaveType }))}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 6, background: "var(--nav)", color: "var(--fg)", border: "1px solid rgba(238,248,250,0.2)", fontSize: 13 }}
                >
                  {LEAVE_TYPES.map((t_) => (
                    <option key={t_} value={t_}>{t(`employee.leave.type.${t_}` as any, locale)}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="date"
                  value={leaveForm.startDate}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, startDate: e.target.value }))}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 6, background: "var(--nav)", color: "var(--fg)", border: "1px solid rgba(238,248,250,0.2)", fontSize: 13 }}
                />
                <input
                  type="date"
                  value={leaveForm.endDate}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, endDate: e.target.value }))}
                  style={{ flex: 1, padding: "6px 8px", borderRadius: 6, background: "var(--nav)", color: "var(--fg)", border: "1px solid rgba(238,248,250,0.2)", fontSize: 13 }}
                />
              </div>
              <textarea
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder={t("employee.leave.reason", locale)}
                rows={2}
                style={{ padding: "6px 8px", borderRadius: 6, background: "var(--nav)", color: "var(--fg)", border: "1px solid rgba(238,248,250,0.2)", fontSize: 13, resize: "vertical" }}
              />
              <button type="submit" className="ep-primary-btn" disabled={leaveSubmitting || !leaveForm.startDate || !leaveForm.endDate}>
                <Plus size={14} /> {leaveSubmitting ? t("common.loading", locale) : t("employee.leave.submit", locale)}
              </button>
              {leaveMessage && (
                <div style={{ fontSize: 13, color: leaveMessage.ok ? "var(--ok)" : "var(--danger)", padding: "4px 0" }}>
                  {leaveMessage.ok ? <CheckCircle size={13} style={{ verticalAlign: "middle", marginRight: 4 }} /> : null}
                  {leaveMessage.msg}
                </div>
              )}
            </form>
          </div>

          <div className="ep-card">
            <div className="ep-card-title">{t("employee.leave.history", locale)}</div>
            {leaveRequests.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 13, padding: "8px 0" }}>{t("common.noData", locale)}</p>
            ) : (
              leaveRequests.map((req) => (
                <div key={req.id} className="ep-field">
                  <span>
                    <span className={`badge badge-${req.status === "approved" ? "ok" : req.status === "pending" ? "warning" : "danger"}`} style={{ marginRight: 6 }}>
                      {t(`employee.leave.status.${req.status}` as any, locale)}
                    </span>
                    {req.startDate} – {req.endDate}
                  </span>
                  <strong>{t(`employee.leave.type.${req.leaveType}` as any, locale)}</strong>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "grievance" && (
        <div className="ep-content">
          <div className="ep-card"><div className="ep-card-title">员工申诉渠道</div>
            <p style={{ color: "var(--muted)", fontSize: 13 }}>投诉内容只提供给 HR 调查；被投诉线长只能看到事实并提交说明。</p>
            <input value={grievanceForm.subjectEmployeeCode} onChange={(e) => setGrievanceForm({ ...grievanceForm, subjectEmployeeCode: e.target.value })} placeholder="被投诉线长工号" />
            <input value={grievanceForm.lineCode} onChange={(e) => setGrievanceForm({ ...grievanceForm, lineCode: e.target.value })} placeholder="产线" />
            <input value={grievanceForm.allegationCategory} onChange={(e) => setGrievanceForm({ ...grievanceForm, allegationCategory: e.target.value })} placeholder="申诉类别" />
            <textarea value={grievanceForm.complaintText} onChange={(e) => setGrievanceForm({ ...grievanceForm, complaintText: e.target.value })} placeholder="请描述事实、时间和影响" />
            <button className="ep-primary-btn" onClick={async () => { try { await apiClient.post("/hr/grievance-cases", { payload: grievanceForm }); setGrievanceMessage("已提交 HR，案件将保密调查"); setGrievanceForm({ ...grievanceForm, complaintText: "" }); const items = await apiClient.get<any[]>("/hr/grievance-cases/mine"); setGrievances(items ?? []); } catch (e: any) { setGrievanceMessage(e.message ?? "提交失败"); } }}>提交给 HR</button>
            {grievanceMessage && <p>{grievanceMessage}</p>}
          </div>
          <div className="ep-card"><div className="ep-card-title">调查结果</div>{grievances.length === 0 ? <p>暂无案件</p> : grievances.map((g) => <div className="ep-field" key={g.id}><span>{g.caseNo} · {g.status}</span><strong>{g.hrFinding ?? "等待 HR 结论"}</strong>{g.status === "RESOLVED" && <><button className="ep-secondary-btn" onClick={async () => { await apiClient.post(`/hr/grievance-cases/${g.id}/employee-ack`, { payload: { decision: "ACKNOWLEDGED" } }); const items = await apiClient.get<any[]>("/hr/grievance-cases/mine"); setGrievances(items ?? []); }}>确认结果</button><button className="ep-secondary-btn" onClick={async () => { const appealText = window.prompt("申诉理由"); if (appealText) { await apiClient.post(`/hr/grievance-cases/${g.id}/employee-ack`, { payload: { decision: "APPEALED", appealText } }); } }}>提出复核</button></>}</div>)}</div>
        </div>
      )}
    </div>
  );
}
