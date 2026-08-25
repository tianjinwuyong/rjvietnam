import { useState, useEffect, useCallback } from 'react';
import { enqueue, useOfflineSync } from './services/offlineQueue';

function getCurrentUser() {
  try {
    const stored = localStorage.getItem('smt_current_user');
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

type Locale = 'zh-CN' | 'vi-VN' | 'en-US';

const i18n = {
  'zh-CN': {
    title: '员工自助', tab_leave: '请假', tab_swap: '替岗', tab_balance: '余额', tab_history: '记录', tab_notif: '通知',
    leave_type: '请假类型', type_personal: '事假', type_sick: '病假', type_annual: '年假', type_report: '报休（事后补）',
    start_date: '开始日期', end_date: '结束日期', reason: '请假原因', reason_placeholder: '请输入请假原因...',
    urgent_hint: '紧急申请将即时通知班组长审批', submit: '提交申请', submitting: '提交中...',
    insufficient_balance: '余额不足：当前剩余{0}天，申请{1}天', attachment_required: '3天以上请假需上传附件证明', report_attach_reminder: '报休：事后24小时内补充附件证明，不扣余额', attachment_label: '上传附件证明',
    submit_success: '提交成功！等待班组长审批', submit_error: '提交失败：{0}',
    balance_title: '请假余额', days: '天', remaining: '剩余',
    history_title: '请假记录', no_records: '暂无记录', swap_title: '替岗申请', swap_partner: '替岗对象', select_partner: '选择替岗同事',
    swap_date: '替岗日期', swap_reason: '替岗原因', swap_success: '替岗申请已提交！', swap_error: '提交失败',
    filter_all: '全部', filter_type: '请假类型', filter_status: '审批状态', filter_date_from: '开始日期', filter_date_to: '结束日期', filter_reset: '重置',
    status_pending: '待审批', status_approved: '已批准', status_rejected: '已拒绝', status_supervisor_approved: '班组长已批',
    pending_confirm: '待我确认', swap_confirmed: '已确认替岗', swap_rejected: '已拒绝替岗', confirm_swap: '确认替岗', reject_swap: '拒绝',
  },
  'vi-VN': {
    title: 'Tự phục vụ', tab_leave: 'Nghỉ phép', tab_swap: 'Đổi ca', tab_balance: 'Số dư', tab_history: 'Lịch sử', tab_notif: 'Thông báo',
    leave_type: 'Loại nghỉ', type_personal: 'Nghỉ việc riêng', type_sick: 'Nghỉ ốm', type_annual: 'Nghỉ phép năm', type_report: 'Nghỉ báo trước',
    start_date: 'Ngày bắt đầu', end_date: 'Ngày kết thúc', reason: 'Lý do nghỉ', reason_placeholder: 'Nhập lý do nghỉ...',
    urgent_hint: 'Đơn khẩn sẽ được leader phê duyệt ngay', submit: 'Gửi đơn', submitting: 'Đang gửi...',
    insufficient_balance: 'Không đủ số dư: còn {0} ngày, đăng ký {1} ngày', attachment_required: 'Nghỉ 3+ ngày cần đính kèm chứng từ', report_attach_reminder: 'Báo nghỉ: bổ sung chứng từ trong 24h, không trừ số dư', attachment_label: 'Đính kèm chứng từ',
    submit_success: 'Gửi thành công! Chờ leader phê duyệt', submit_error: 'Gửi thất bại: {0}',
    balance_title: 'Số dư nghỉ phép', days: 'ngày', remaining: 'còn lại',
    history_title: 'Lịch sử nghỉ phép', no_records: 'Chưa có bản ghi', swap_title: 'Đơn đổi ca', swap_partner: 'Người đổi ca', select_partner: 'Chọn đồng nghiệp đổi ca',
    swap_date: 'Ngày đổi ca', swap_reason: 'Lý do đổi ca', swap_success: 'Đơn đổi ca đã gửi!', swap_error: 'Gửi thất bại',
    filter_all: 'Tất cả', filter_type: 'Loại nghỉ', filter_status: 'Trạng thái', filter_date_from: 'Từ ngày', filter_date_to: 'Đến ngày', filter_reset: 'Đặt lại',
    status_pending: 'Chờ duyệt', status_approved: 'Đã duyệt', status_rejected: 'Đã từ chối', status_supervisor_approved: 'Leader duyệt rồi',
    pending_confirm: 'Chờ tôi xác nhận', swap_confirmed: 'Đã xác nhận đổi ca', swap_rejected: 'Đã từ chối đổi ca', confirm_swap: 'Xác nhận đổi ca', reject_swap: 'Từ chối',
  },
  'en-US': {
    title: 'Self-Service', tab_leave: 'Leave', tab_swap: 'Swap', tab_balance: 'Balance', tab_history: 'History', tab_notif: 'Notifications',
    leave_type: 'Leave Type', type_personal: 'Personal', type_sick: 'Sick', type_annual: 'Annual', type_report: 'Report Leave',
    start_date: 'Start Date', end_date: 'End Date', reason: 'Reason', reason_placeholder: 'Enter reason...',
    urgent_hint: 'Urgent requests notify supervisor immediately', submit: 'Submit', submitting: 'Submitting...',
    insufficient_balance: 'Insufficient balance: {0} days left, applied for {1} days', attachment_required: 'Leave 3+ days requires attachment proof', report_attach_reminder: 'Report leave: attach proof within 24h, not deducted from balance', attachment_label: 'Upload attachment proof',
    submit_success: 'Submitted! Awaiting supervisor approval', submit_error: 'Submit failed: {0}',
    balance_title: 'Leave Balance', days: 'days', remaining: 'remaining',
    history_title: 'Leave History', no_records: 'No records', swap_title: 'Shift Swap', swap_partner: 'Swap Partner', select_partner: 'Select colleague',
    swap_date: 'Swap Date', swap_reason: 'Swap Reason', swap_success: 'Swap request submitted!', swap_error: 'Submit failed',
    filter_all: 'All', filter_type: 'Type', filter_status: 'Status', filter_date_from: 'From', filter_date_to: 'To', filter_reset: 'Reset',
    status_pending: 'Pending', status_approved: 'Approved', status_rejected: 'Rejected', status_supervisor_approved: 'Supervisor Approved',
    pending_confirm: 'Awaiting My Confirm', swap_confirmed: 'Swap Confirmed', swap_rejected: 'Swap Rejected', confirm_swap: 'Confirm Swap', reject_swap: 'Reject',
  },
};

function t(locale: Locale, key: string, ...args: any[]): string {
  const dict = i18n[locale] || i18n['zh-CN'];
  let text = (dict as any)[key] || key;
  args.forEach((a, i) => { text = text.replace(`{${i}}`, String(a)); });
  return text;
}

// ── API Functions ─────────────────────────────────────────────────────────────
async function submitLeaveOnline(employeeId: number, leaveType: string, startDate: string, endDate: string, reason: string, attachment: File | null, isUrgent: boolean) {
  const formData = new FormData();
  formData.append('employee_id', String(employeeId));
  formData.append('leave_type', leaveType);
  formData.append('start_date', startDate);
  formData.append('end_date', endDate);
  formData.append('reason', reason);
  formData.append('is_urgent', String(isUrgent));
  if (attachment) formData.append('attachment', attachment);
  const r = await fetch('/api/hr/mobile/leave/submit', { method: 'POST', body: formData });
  return r.json();
}

async function submitLeave(employeeId: number, leaveType: string, startDate: string, endDate: string, reason: string, attachment: File | null, isUrgent: boolean): Promise<{ queued?: boolean; error?: string }> {
  if (!navigator.onLine) {
    enqueue('leave', { employeeId, leaveType, startDate, endDate, reason, isUrgent });
    return { queued: true };
  }
  try {
    return await submitLeaveOnline(employeeId, leaveType, startDate, endDate, reason, attachment, isUrgent);
  } catch {
    enqueue('leave', { employeeId, leaveType, startDate, endDate, reason, isUrgent });
    return { queued: true };
  }
}

async function fetchLeaveBalance(employeeId: number): Promise<any[]> {
  const r = await fetch(`/api/hr/mobile/leave/balance/${employeeId}`);
  return r.ok ? r.json() : [];
}

async function fetchLeaveHistory(employeeId: number): Promise<any[]> {
  const r = await fetch(`/api/hr/mobile/leave/history/${employeeId}`);
  return r.ok ? r.json() : [];
}

async function submitSwapOnline(requesterId: number, targetEmployeeId: number, targetShiftDate: string, reason: string) {
  const r = await fetch('/api/hr/mobile/swap/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requester_id: requesterId, target_employee_id: targetEmployeeId, target_shift_date: targetShiftDate, reason }),
  });
  return r.json();
}

async function submitSwap(requesterId: number, targetEmployeeId: number, targetShiftDate: string, reason: string): Promise<{ queued?: boolean; error?: string }> {
  if (!navigator.onLine) {
    enqueue('swap', { requesterId, targetEmployeeId, targetShiftDate, reason });
    return { queued: true };
  }
  try {
    return await submitSwapOnline(requesterId, targetEmployeeId, targetShiftDate, reason);
  } catch {
    enqueue('swap', { requesterId, targetEmployeeId, targetShiftDate, reason });
    return { queued: true };
  }
}

async function fetchSwapHistory(employeeId: number): Promise<any[]> {
  const r = await fetch(`/api/hr/mobile/swap/history/${employeeId}`);
  return r.ok ? r.json() : [];
}

async function fetchPendingConfirmation(employeeId: number): Promise<any[]> {
  const r = await fetch(`/api/hr/mobile/swap/pending-confirmation/${employeeId}`);
  return r.ok ? r.json() : [];
}

async function confirmSwap(id: number, partnerId: number) {
  const r = await fetch(`/api/hr/mobile/swap/confirm/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partner_id: partnerId }),
  });
  return r.json();
}

async function rejectSwap(id: number, partnerId: number, remark: string) {
  const r = await fetch(`/api/hr/mobile/swap/reject/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partner_id: partnerId, remark }),
  });
  return r.json();
}

async function fetchNotifications(employeeId: number): Promise<any[]> {
  const r = await fetch(`/api/hr/mobile/notifications/${employeeId}`);
  return r.ok ? r.json() : [];
}

function today(): string { return new Date().toISOString().split('T')[0]; }
function calcDays(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
}

// ── Leave Balance Bar ──────────────────────────────────────────────────────────
function BalanceBar({ balances, locale }: { balances: any[]; locale: Locale }) {
  if (!balances.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 0', borderBottom: '1px solid #334155' }}>
      {balances.map(b => (
        <div key={b.leave_type} style={{ minWidth: 80, background: '#1e293b', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{b.leave_type_name || b.leave_type}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#22d3ee' }}>{b.days_left ?? b.remaining ?? 0}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>{t(locale, 'remaining')}</div>
        </div>
      ))}
    </div>
  );
}

// ── Leave Form ─────────────────────────────────────────────────────────────────
function LeaveForm({ t, locale, onSuccess, balances }: { t: (k: string) => string; locale: Locale; onSuccess: () => void; balances: any[] }) {
  const user = getCurrentUser();
  const [leaveType, setLeaveType] = useState('personal');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [reason, setReason] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isUrgent, setIsUrgent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const days = calcDays(startDate, endDate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!user?.employee_id) { setError('User not found'); return; }
    if (leaveType !== 'sick' && leaveType !== 'report' && balances.length > 0) {
      const bal = balances.find(b => b.leave_type === leaveType);
      if (bal) {
        const remaining = Number(bal.days_left ?? bal.remaining ?? 0);
        if (remaining < days) {
          setError(t(locale, 'insufficient_balance', remaining, days));
          return;
        }
      }
    }
    if (days > 3 && leaveType !== 'report' && !attachment) { setError(t(locale, 'attachment_required')); return; }
    setLoading(true);
    try {
      const result = await submitLeave(user.employee_id, leaveType, startDate, endDate, reason, attachment, isUrgent);
      if (result.error) { setError(t(locale, 'submit_error', result.error)); return; }
      setLeaveType('personal'); setStartDate(today()); setEndDate(today()); setReason(''); setAttachment(null); setIsUrgent(false);
      onSuccess();
    } catch (err: any) {
      setError(t(locale, 'submit_error', err.message));
    } finally {
      setLoading(false);
    }
  };

  const typeName = leaveType === 'personal' ? t('type_personal') : leaveType === 'sick' ? t('type_sick') : leaveType === 'annual' ? t('type_annual') : t('type_report');

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {['personal','sick','annual','report'].map(type => (
          <button type="button" key={type} onClick={() => setLeaveType(type)}
            style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: leaveType === type ? (type === 'report' ? '#f59e0b' : '#3b82f6') : '#334155', color: '#fff', fontSize: 13 }}>
            {type === 'personal' ? t('type_personal') : type === 'sick' ? t('type_sick') : type === 'annual' ? t('type_annual') : t('type_report')}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t('start_date')}</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required
            style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t('end_date')}</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required
            style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
        </div>
      </div>
      <div style={{ background: '#1e293b', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#22d3ee' }}>
        {days} {t('days')} · {typeName}
      </div>
      {leaveType === 'report' && (
        <div style={{ background: '#78350f', border: '1px solid #f59e0b', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#fcd34d', marginTop: 4 }}>
          ⚠️ {t('report_attach_reminder')}
        </div>
      )}
      <div>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t('reason')}</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={t('reason_placeholder')} required
          rows={3} style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14, resize: 'none', boxSizing: 'border-box' }} />
      </div>
      {days > 3 && (
        <div>
          <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t('attachment_label')} *</label>
          <input type="file" accept="image/*,.pdf,.doc,.docx"
            onChange={e => setAttachment(e.target.files?.[0] || null)}
            style={{ color: '#e2e8f0', fontSize: 13 }} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id="urgent" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} />
        <label htmlFor="urgent" style={{ fontSize: 13, color: '#fbbf24', cursor: 'pointer' }}>{t('urgent_hint')}</label>
      </div>
      {error && <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#fca5a5' }}>{error}</div>}
      <button type="submit" disabled={loading}
        style={{ padding: '12px', borderRadius: 6, border: 'none', background: loading ? '#1e40af' : '#3b82f6', color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
        {loading ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}

// ── Swap Form ──────────────────────────────────────────────────────────────────
function SwapForm({ t, locale, onSuccess }: { t: (k: string) => string; locale: Locale; onSuccess: () => void }) {
  const user = getCurrentUser();
  const [partnerId, setPartnerId] = useState('');
  const [shiftDate, setShiftDate] = useState(today());
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [partners, setPartners] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/hr/mobile/swap/candidates').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setPartners(data.filter((p: any) => p.id !== user?.employee_id));
    }).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!user?.employee_id) { setError('User not found'); return; }
    const pid = Number(partnerId);
    if (!pid) { setError('Please select a partner'); return; }
    setLoading(true);
    try {
      const result = await submitSwap(user.employee_id, pid, shiftDate, reason);
      if (result.queued) {
        setPartnerId(''); setShiftDate(today()); setReason('');
        onSuccess();
        return;
      }
      if (result.error) { setError(t(locale, 'swap_error') + ': ' + result.error); return; }
      setPartnerId(''); setShiftDate(today()); setReason('');
      onSuccess();
    } catch (err: any) { setError(t(locale, 'swap_error')); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t('select_partner')}</label>
        <select value={partnerId} onChange={e => setPartnerId(e.target.value)} required
          style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }}>
          <option value="">{t('select_partner')}</option>
          {partners.map((p: any) => <option key={p.id} value={p.id}>{p.name_zh || p.name || p.code}</option>)}
        </select>
      </div>
      <div>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t('swap_date')}</label>
        <input type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)} required
          style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
      </div>
      <div>
        <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>{t('swap_reason')}</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
          style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14, resize: 'none', boxSizing: 'border-box' }} />
      </div>
      {error && <div style={{ background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#fca5a5' }}>{error}</div>}
      <button type="submit" disabled={loading}
        style={{ padding: '10px', borderRadius: 6, border: 'none', background: loading ? '#166534' : '#16a34a', color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
        {loading ? '...' : t('swap_title')}
      </button>
    </form>
  );
}

// ── PendingConfirmPanel (Q4) ──────────────────────────────────────────────────
function PendingConfirmPanel({ t, locale, onRefresh }: { t: (k: string) => string; locale: Locale; onRefresh: () => void }) {
  const user = getCurrentUser();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!user?.employee_id) return;
    setLoading(true);
    fetchPendingConfirmation(user.employee_id)
      .then(setItems)
      .finally(() => setLoading(false));
  }, [user?.employee_id]);

  useEffect(() => { load(); }, [load]);

  const handleConfirm = async (id: number) => {
    if (!confirm(t('confirm_swap') + '?')) return;
    setActionId(id);
    try {
      await confirmSwap(id, user!.employee_id);
      setItems(prev => prev.filter(i => i.id !== id));
      onRefresh();
    } catch { } finally { setActionId(null); }
  };

  const handleReject = async (id: number) => {
    const remark = prompt(t('reject_swap') + ' (可选原因):') || '';
    setActionId(id);
    try {
      await rejectSwap(id, user!.employee_id, remark);
      setItems(prev => prev.filter(i => i.id !== id));
      onRefresh();
    } catch { } finally { setActionId(null); }
  };

  if (items.length === 0 && !loading) return null;

  return (
    <div style={{ marginTop: 12, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 600, color: '#c2410c', marginBottom: 8 }}>
        ⚠️ {t('pending_confirm')} ({items.length})
      </div>
      {items.map(item => (
        <div key={item.id} style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: '#444' }}>
            <b>{item.requester_name || item.requester_name_zh || '同事'}</b> 申请与您替岗
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            替岗日期：{item.target_shift_date || item.shift_date}
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>原因：{item.reason_zh || item.reason || '无'}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => handleConfirm(item.id)} disabled={actionId === item.id}
              style={{ flex: 1, padding: '6px 0', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
              {actionId === item.id ? '...' : t('confirm_swap')}
            </button>
            <button onClick={() => handleReject(item.id)} disabled={actionId === item.id}
              style={{ flex: 1, padding: '6px 0', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
              {t('reject_swap')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── History Panel (Q14) ────────────────────────────────────────────────────────
function HistoryPanel({ t, locale, refreshKey }: { t: (k: string) => string; locale: Locale; refreshKey: number }) {
  const user = getCurrentUser();
  const [leaveHistory, setLeaveHistory] = useState<any[]>([]);
  const [swapHistory, setSwapHistory] = useState<any[]>([]);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  useEffect(() => {
    if (!user?.employee_id) return;
    Promise.all([fetchLeaveHistory(user.employee_id), fetchSwapHistory(user.employee_id)])
      .then(([l, s]) => { setLeaveHistory(l); setSwapHistory(s); });
  }, [refreshKey, user?.employee_id]);

  const allRecords = [
    ...leaveHistory.map(l => ({ ...l, _type: 'leave' })),
    ...swapHistory.map(s => ({ ...s, _type: 'swap' })),
  ].sort((a, b) => new Date(b.created_at || b.start_date || 0).getTime() - new Date(a.created_at || a.start_date || 0).getTime());

  const filtered = allRecords.filter(r => {
    if (filterType !== 'all' && r._type !== filterType) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    const d = r.start_date || r.shift_date || '';
    if (filterDateFrom && d < filterDateFrom) return false;
    if (filterDateTo && d > filterDateTo) return false;
    return true;
  });

  const statusColor = (s: string) => s === 'approved' || s === 'completed' || s === 'confirmed' ? '#22c55e' : s === 'rejected' || s === 'partner_rejected' ? '#ef4444' : s === 'pending' ? '#f59e0b' : '#94a3b8';

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 12 }}>
          <option value="all">{t('filter_all')}</option>
          <option value="leave">{t('tab_leave')}</option>
          <option value="swap">{t('tab_swap')}</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 12 }}>
          <option value="all">{t('filter_all')}</option>
          <option value="pending">{t('status_pending')}</option>
          <option value="approved">{t('status_approved')}</option>
          <option value="rejected">{t('status_rejected')}</option>
        </select>
        <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} style={{ padding: '4px 6px', borderRadius: 4, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 12 }} />
        <span style={{ color: '#64748b', fontSize: 12 }}>~</span>
        <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} style={{ padding: '4px 6px', borderRadius: 4, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 12 }} />
        <button onClick={() => { setFilterType('all'); setFilterStatus('all'); setFilterDateFrom(''); setFilterDateTo(''); }}
          style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #334155', background: '#334155', color: '#e2e8f0', fontSize: 12, cursor: 'pointer' }}>
          {t('filter_reset')}
        </button>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>共{filtered.length}条</div>
      {filtered.length === 0 && <div style={{ textAlign: 'center', color: '#475569', padding: 20, fontSize: 14 }}>{t('no_records')}</div>}
      {filtered.map((r, i) => (
        <div key={i} style={{ background: '#1e293b', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
              {r._type === 'leave' ? t('tab_leave') : t('tab_swap')} · {r.start_date || r.shift_date}
            </span>
            <span style={{ fontSize: 12, color: statusColor(r.status), fontWeight: 600 }}>
              {r.status === 'pending' ? t('status_pending') : r.status === 'approved' ? t('status_approved') : r.status === 'rejected' ? t('status_rejected') : r.status === 'supervisor_approved' ? t('status_supervisor_approved') : r.status || ''}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{r.reason_zh || r.reason || '—'}</div>
        </div>
      ))}
    </div>
  );
}

// ── Notif Panel ─────────────────────────────────────────────────────────────────
function NotifPanel({ t, locale }: { t: (k: string) => string; locale: Locale }) {
  const user = getCurrentUser();
  const [notifs, setNotifs] = useState<any[]>([]);
  useEffect(() => {
    if (!user?.employee_id) return;
    fetchNotifications(user.employee_id).then(setNotifs).catch(() => {});
  }, [user?.employee_id]);
  if (!notifs.length) return <div style={{ textAlign: 'center', color: '#475569', padding: 20, fontSize: 14 }}>暂无通知</div>;
  return notifs.map((n, i) => (
    <div key={i} style={{ background: '#1e293b', borderRadius: 8, padding: 10, marginBottom: 8, borderLeft: '3px solid #3b82f6' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{n.title}</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{n.body}</div>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</div>
    </div>
  ));
}


export default function MobileLeave() {
  const user = getCurrentUser();
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const [activeTab, setActiveTab] = useState('leave');
  const [balances, setBalances] = useState<any[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [queuedSuccess, setQueuedSuccess] = useState('');
  const { online, pendingCount, syncing } = useOfflineSync(({ success }) => {
    if (success > 0) setRefreshKey(k => k + 1);
  });

  useEffect(() => {
    if (!user?.employee_id) return;
    fetchLeaveBalance(user.employee_id).then(setBalances).catch(() => {});
  }, [user?.employee_id]);

  const tt = useCallback((key: string, ...args: any[]) => t(locale, key, ...args), [locale]);

  const tabBarStyle = (tab: string) => ({
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: activeTab === tab ? '#3b82f6' : 'transparent',
    color: activeTab === tab ? '#fff' : '#94a3b8',
    fontSize: 13,
    cursor: 'pointer',
    borderRadius: 6,
  } as any);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      {!online && (
        <div style={{ background: '#dc2626', color: '#fff', textAlign: 'center', padding: '6px 12px', fontSize: 13, fontWeight: 600 }}>
          📡 离线模式 — 申请已暂存本地，联网后自动提交
        </div>
      )}
      {online && pendingCount > 0 && (
        <div style={{ background: '#f59e0b', color: '#1e293b', textAlign: 'center', padding: '4px 12px', fontSize: 12, fontWeight: 600 }}>
          {syncing ? '🔄 正在同步...' : `📤 ${pendingCount}条待同步`}
        </div>
      )}
      <div style={{ padding: '12px 16px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{tt('title')}</div>
        <select value={locale} onChange={e => setLocale(e.target.value as Locale)}
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 12 }}>
          <option value="zh-CN">中文</option>
          <option value="vi-VN">Tiếng Việt</option>
          <option value="en-US">English</option>
        </select>
      </div>
      {queuedSuccess && (
        <div style={{ background: '#16a34a', color: '#fff', textAlign: 'center', padding: '8px 12px', fontSize: 13, fontWeight: 600, animation: 'fadeIn 0.3s' }}>
          ✅ {queuedSuccess}
        </div>
      )}

      <BalanceBar balances={balances} locale={locale} />

      <div style={{ display: 'flex', padding: '8px 12px', gap: 6, background: '#1e293b', borderBottom: '1px solid #334155' }}>
        <button onClick={() => setActiveTab('leave')} style={tabBarStyle('leave')}>📋 {tt('tab_leave')}</button>
        <button onClick={() => setActiveTab('swap')} style={tabBarStyle('swap')}>🔄 {tt('tab_swap')}</button>
        <button onClick={() => setActiveTab('balance')} style={tabBarStyle('balance')}>💰 {tt('tab_balance')}</button>
        <button onClick={() => setActiveTab('history')} style={tabBarStyle('history')}>📋 {tt('tab_history')}</button>
        <button onClick={() => setActiveTab('notif')} style={tabBarStyle('notif')}>🔔</button>
      </div>

      <div style={{ padding: 16 }}>
        {activeTab === 'leave' && <LeaveForm t={tt} locale={locale} onSuccess={() => setRefreshKey(k => k + 1)} balances={balances} />}
        {activeTab === 'swap' && (
          <div>
            <SwapForm t={tt} locale={locale} onSuccess={() => setRefreshKey(k => k + 1)} />
            <PendingConfirmPanel t={tt} locale={locale} onRefresh={() => setRefreshKey(k => k + 1)} />
          </div>
        )}
        {activeTab === 'balance' && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{tt('balance_title')}</div>
            {balances.map(b => (
              <div key={b.leave_type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ fontSize: 14 }}>{b.leave_type_name || b.leave_type}</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: '#22d3ee' }}>{b.days_left ?? b.remaining ?? 0} <span style={{ fontSize: 12, color: '#64748b' }}>{tt('days')}</span></span>
              </div>
            ))}
          </div>
        )}
        {activeTab === 'history' && <HistoryPanel t={tt} locale={locale} refreshKey={refreshKey} />}
        {activeTab === 'notif' && <NotifPanel t={tt} locale={locale} />}
      </div>
    </div>
  );
}
// @ts-nocheck
