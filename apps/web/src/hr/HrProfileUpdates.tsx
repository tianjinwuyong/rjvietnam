import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

interface UpdateRequest {
  id: number;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  requestType: string;
  photoUrl?: string;
  photoDataUrl?: string;
  status: string;
  submittedAt: string;
}

export function HrProfileUpdates({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<UpdateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const labels = {
    title: locale === "vi-VN" ? "Phê duyệt cập nhật hồ sơ" : locale === "zh-CN" ? "员工资料更新审批" : "Employee Profile Update Approvals",
    pending: locale === "vi-VN" ? "Đang chờ HR phê duyệt" : locale === "zh-CN" ? "待 HR 审批" : "Pending HR Approval",
    approve: locale === "vi-VN" ? "Phê duyệt" : locale === "zh-CN" ? "批准更新" : "Approve Update",
    reject: locale === "vi-VN" ? "Từ chối" : locale === "zh-CN" ? "拒绝" : "Reject",
    empty: locale === "vi-VN" ? "Không có yêu cầu đang chờ" : locale === "zh-CN" ? "暂无待审批申请" : "No pending requests",
    submitted: locale === "vi-VN" ? "Thời gian gửi" : locale === "zh-CN" ? "提交时间" : "Submitted"
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<{ items: UpdateRequest[] }>("/hr/profile-update-requests?status=pending_hr");
      setItems(response.items || []);
      setMessage("");
    } catch (error: any) {
      setMessage(error.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (id: number, decision: "approved" | "rejected") => {
    setBusyId(id);
    try {
      await apiClient.post(`/hr/profile-update-requests/${id}/decision`, {
        decision,
        comment: decision === "approved" ? "HR verified employee photo" : "HR rejected employee photo"
      });
      await load();
    } catch (error: any) {
      setMessage(error.message || "Decision failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><h2 style={{ margin: 0 }}>{labels.title}</h2><span style={{ color: "#f59e0b" }}>{labels.pending}</span></div>
        <button type="button" onClick={() => void load()}>Refresh</button>
      </div>
      {message && <div className="error-message">{message}</div>}
      {loading ? <div>Loading...</div> : items.length === 0 ? <div className="empty-state">{labels.empty}</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
          {items.map(item => (
            <article key={item.id} style={{ border: "1px solid #334155", borderRadius: 14, padding: 16, background: "#0f172a" }}>
              <div style={{ color: "#60a5fa", fontWeight: 800 }}>{item.employeeName} · {item.employeeCode}</div>
              <div style={{ color: "#94a3b8", margin: "6px 0 12px" }}>{labels.submitted}: {new Date(item.submittedAt).toLocaleString()}</div>
              {item.photoDataUrl ? (
                <img src={item.photoDataUrl} alt={`${item.employeeCode} pending`} style={{ width: "100%", maxHeight: 360, objectFit: "contain", borderRadius: 10, background: "#020617" }} />
              ) : <div className="empty-state">Photo unavailable</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button disabled={busyId === item.id} onClick={() => void decide(item.id, "approved")} style={{ flex: 1, background: "#16a34a", color: "white" }}>{labels.approve}</button>
                <button disabled={busyId === item.id} onClick={() => void decide(item.id, "rejected")} style={{ flex: 1, background: "#dc2626", color: "white" }}>{labels.reject}</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
