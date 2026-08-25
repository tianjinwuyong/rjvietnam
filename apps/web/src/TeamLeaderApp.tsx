import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────
type Locale = 'zh' | 'vi' | 'en';
type CheckinType = 'in' | 'out' | 'arrive_post' | 'leave_post';
type ViewMode = 'list' | 'card' | 'timeline';
type LeaveStatus = 'pending_group_leader' | 'pending_hr' | 'approved' | 'rejected' | 'cancelled';

interface TeamMember { id: number; code: string; name_zh: string; dept_name: string; position: string; hire_date: string; status: string; }
interface TodayCheckin { employee_id: number; emp_no: string; emp_name: string; dept_name: string; checkin_type: string; checkin_time: string; face_result: string; location_type: string; fail_reason: string; retry_count: number; }
interface LeaveType { id: number; code: string; name_zh: string; name_en: string; name_vi: string; color: string; requires_attachment: number; max_days_per_year: number; }
interface LeaveRecord { id: number; employee_id: number; emp_no: string; emp_name: string; leave_type_name: string; leave_color: string; start_date: string; end_date: string; days_count: number; reason: string; status: string; group_leader_result: string; hr_result: string; created_at: string; group_leader_at: string; hr_at: string; }
interface AppNotification { id: number; type: string; title_zh: string; body_zh: string; data_json: string; is_read: number; sent_at: string; }
interface Shift { id: number; shift_name: string; shift_code: string; work_start: string; work_end: string; break_start: string; break_end: string; is_night_shift: number; }
interface EmployeeProfile { id: number; code: string; name_zh: string; name_vi: string; dept_name: string; department: string; position: string; hire_date: string; status: string; gender: string; phone: string; emergency_contact: string; emergency_phone: string; bank_name: string; bank_account: string; basic_salary: number; }

// ── i18n ────────────────────────────────────────────────────
const i18n: Record<string, Record<Locale, string>> = {
  app_title:      { zh: '班组长管理', vi: 'Quản lý nhóm', en: 'Team Leader' },
  team_checkin:   { zh: '团队打卡', vi: 'Chấm công nhóm', en: 'Team Check-in' },
  leave:          { zh: '请假审批', vi: 'Nghỉ phép', en: 'Leave' },
  roster:         { zh: '员工花名册', vi: 'Danh sách nhân viên', en: 'Roster' },
  attendance:     { zh: '考勤查询', vi: 'Chấm công', en: 'Attendance' },
  notification:   { zh: '通知', vi: 'Thông báo', en: 'Notifications' },
  shift:          { zh: '班次规则', vi: 'Ca làm việc', en: 'Shift Rules' },
  swap:           { zh: '替岗审批', vi: 'Đổi ca', en: 'Swap' },
  employee_info:   { zh: '员工信息', vi: 'TT NV', en: 'Employee Info' },
  profile:        { zh: '员工档案', vi: 'Hồ sơ', en: 'Profile' },
  my_checkin:     { zh: '我的打卡', vi: 'Chấm công của tôi', en: 'My Check-in' },
  // checkin types
  in:             { zh: '上班', vi: 'Vào ca', en: 'Clock In' },
  out:            { zh: '下班', vi: 'Ra ca', en: 'Clock Out' },
  arrive_post:    { zh: '到岗', vi: 'Đến nơi', en: 'Arrive' },
  leave_post:     { zh: '离岗', vi: 'Rời nơi', en: 'Leave Post' },
  // status
  pending_group_leader: { zh: '待班组长审批', vi: 'Chờ TL duyệt', en: 'Pending TL' },
  pending_hr:          { zh: '待HR审批', vi: 'Chờ HR duyệt', en: 'Pending HR' },
  approved:            { zh: '已批准', vi: 'Đã duyệt', en: 'Approved' },
  rejected:            { zh: '已拒绝', vi: 'Đã từ chối', en: 'Rejected' },
  // tabs
  list_view:      { zh: '列表', vi: 'Danh sách', en: 'List' },
  card_view:      { zh: '卡片', vi: 'Thẻ', en: 'Cards' },
  timeline_view:  { zh: '时间线', vi: 'Thời gian', en: 'Timeline' },
  // actions
  approve:        { zh: '批准', vi: 'Duyệt', en: 'Approve' },
  reject:         { zh: '拒绝', vi: 'Từ chối', en: 'Reject' },
  view_detail:    { zh: '查看', vi: 'Xem', en: 'View' },
  no_data:        { zh: '暂无数据', vi: 'Không có dữ liệu', en: 'No data' },
  loading:        { zh: '加载中...', vi: 'Đang tải...', en: 'Loading...' },
  refresh:        { zh: '刷新', vi: 'Làm mới', en: 'Refresh' },
  // attendance
  today_realtime: { zh: '今日实时', vi: 'Hôm nay', en: 'Today' },
  last_7_days:    { zh: '近7天', vi: '7 ngày', en: 'Last 7 days' },
  this_month:     { zh: '本月', vi: 'Tháng này', en: 'This month' },
  custom_range:   { zh: '自定义', vi: 'Tùy chọn', en: 'Custom' },
  // leave
  new_leave:      { zh: '新建请假', vi: 'Tạo nghỉ phép', en: 'New Leave' },
  my_leaves:      { zh: '我的请假', vi: 'Nghỉ phép của tôi', en: 'My Leaves' },
  pending_approval:{ zh: '待我审批', vi: 'Chờ duyệt', en: 'Pending Approval' },
  leave_history:  { zh: '请假历史', vi: 'Lịch sử', en: 'Leave History' },
  leave_type:     { zh: '假别', vi: 'Loại', en: 'Type' },
  start_date:     { zh: '开始日期', vi: 'Ngày bắt đầu', en: 'Start' },
  end_date:       { zh: '结束日期', vi: 'Ngày kết thúc', en: 'End' },
  days_count:     { zh: '天数', vi: 'Số ngày', en: 'Days' },
  reason:         { zh: '原因', vi: 'Lý do', en: 'Reason' },
  submit:         { zh: '提交', vi: 'Gửi', en: 'Submit' },
  cancel:         { zh: '取消', vi: 'Hủy', en: 'Cancel' },
  // notifications
  all_notif:     { zh: '全部', vi: 'Tất cả', en: 'All' },
  unread:         { zh: '未读', vi: 'Chưa đọc', en: 'Unread' },
  mark_read:      { zh: '标记已读', vi: 'Đánh dấu', en: 'Mark Read' },
};

function t(key: string, locale: Locale) {
  return (i18n[key]?.[locale]) || key;
}

// ── API helpers ─────────────────────────────────────────────
async function api(path: string, opts?: RequestInit) {
  const res = await fetch(path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// ── Badge ────────────────────────────────────────────────────
function Badge({ color, text }: { color: string; text: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 12,
      background: color + '22', color, fontSize: 11, fontWeight: 600, gap: 4,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {text}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; zh: string }> = {
    pending_group_leader: { color: '#f59e0b', zh: '待班组长' },
    pending_hr:          { color: '#3b82f6', zh: '待HR' },
    approved:            { color: '#22c55e', zh: '已批准' },
    rejected:            { color: '#ef4444', zh: '已拒绝' },
    cancelled:           { color: '#6b7280', zh: '已取消' },
  };
  const m = map[status] || { color: '#6b7280', zh: status };
  return <Badge color={m.color} text={m.zh} />;
}

function CheckinTypeBadge({ type }: { type: string }) {
  const map: Record<string, { color: string; label: string }> = {
    in:          { color: '#22c55e', label: '上班' },
    out:         { color: '#3b82f6', label: '下班' },
    arrive_post:  { color: '#f59e0b', label: '到岗' },
    leave_post:  { color: '#a855f7', label: '离岗' },
  };
  const m = map[type] || { color: '#6b7280', label: type };
  return <Badge color={m.color} text={m.label} />;
}

// ── Main App ────────────────────────────────────────────────
export default function TeamLeaderApp({ locale = 'zh' }: { locale?: Locale }) {
  const [activeTab, setActiveTab] = useState<string>('checkin');
  const [user] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('demo_user') || '{}'); }
    catch { return {}; }
  });

  const loc = locale as Locale;

  const tabs = [
    { key: 'checkin',     label: () => t('team_checkin', loc),  icon: '📋' },
    { key: 'leave',       label: () => t('leave', loc),        icon: '📝' },
    { key: 'roster',      label: () => t('roster', loc),       icon: '👥' },
    { key: 'attendance',  label: () => t('attendance', loc),   icon: '📊' },
    { key: 'mycheckin',  label: () => t('my_checkin', loc),   icon: '🕐' },
    { key: 'notification',label: () => t('notification', loc), icon: '🔔' },
    { key: 'shift',      label: () => t('shift', loc),         icon: '🗓' },
    { key: 'swap',      label: () => t('swap', loc),             icon: '🔄' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#1e293b', borderBottom: '1px solid #334155',
        padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
            👷
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t('app_title', loc)}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{user.displayName || user.name || '班组长'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>{new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' })}</span>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '12px 12px 80px' }}>
        {activeTab === 'checkin'    && <TeamCheckinPanel locale={loc} />}
        {activeTab === 'leave'      && <LeavePanel locale={loc} />}
        {activeTab === 'roster'     && <RosterPanel locale={loc} />}
        {activeTab === 'attendance' && <AttendancePanel locale={loc} />}
        {activeTab === 'mycheckin' && <MyCheckinPanel locale={loc} />}
        {activeTab === 'notification' && <NotificationPanel locale={loc} />}
        {activeTab === 'shift'      && <ShiftPanel locale={loc} />}
        {activeTab === 'swap'      && <SwapApprovalSection locale={loc} />}
      </div>

      {/* Bottom Nav */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: '#1e293b', borderTop: '1px solid #334155',
        display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1, padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              color: activeTab === tab.key ? '#3b82f6' : '#64748b',
              transition: 'color 0.2s',
            }}
          >
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontWeight: activeTab === tab.key ? 600 : 400 }}>{tab.label()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Team Checkin Panel ──────────────────────────────────────
function TeamCheckinPanel({ locale }: { locale: Locale }) {
  const [checkins, setCheckins] = useState<TodayCheckin[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [filter, setFilter] = useState<string>('all'); // all/in/out/arrive/leave

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await api('/hr/team/checkins/today');
      setCheckins(json.checkins || []);
    } catch { setCheckins([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  const t2 = (k: string) => t(k, locale);

  const filtered = filter === 'all'
    ? checkins
    : checkins.filter(c => c.checkin_type === filter);

  const arrivedCount = checkins.filter(c => c.checkin_type === 'in').length;
  const leftCount = checkins.filter(c => c.checkin_type === 'out').length;

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        {[
          { label: t2('in'), value: arrivedCount, color: '#22c55e' },
          { label: t2('out'), value: leftCount, color: '#3b82f6' },
          { label: '未打卡', value: (checkins.filter(c => c.checkin_type).length === 0 ? checkins.length : 0), color: '#64748b' },
        ].map((s, i) => (
          <div key={i} style={{ background: '#1e293b', borderRadius: 12, padding: '12px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* View mode switcher */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['list', 'card', 'timeline'] as ViewMode[]).map(mode => (
          <button key={mode} onClick={() => setViewMode(mode)}
            style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid', borderColor: viewMode === mode ? '#3b82f6' : '#334155', background: viewMode === mode ? '#1d4ed8' : 'transparent', color: '#f1f5f9', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {t2(mode + '_view')}
          </button>
        ))}
      </div>

      {/* Type filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto' }}>
        {[
          { key: 'all', label: '全部' },
          { key: 'in', label: t2('in') },
          { key: 'out', label: t2('out') },
          { key: 'arrive_post', label: t2('arrive_post') },
          { key: 'leave_post', label: t2('leave_post') },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid', borderColor: filter === f.key ? '#3b82f6' : '#334155', background: filter === f.key ? '#1d4ed822' : 'transparent', color: filter === f.key ? '#3b82f6' : '#64748b', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t2('loading')}</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t2('no_data')}</div>
      ) : viewMode === 'list' ? (
        <ListView data={filtered} locale={locale} />
      ) : viewMode === 'card' ? (
        <CardView data={filtered} locale={locale} />
      ) : (
        <TimelineView data={filtered} locale={locale} />
      )}

      <button onClick={load} style={{ width: '100%', marginTop: 10, padding: '10px', borderRadius: 10, background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
        🔄 {t2('refresh')}
      </button>
    </div>
  );
}

function ListView({ data, locale }: { data: TodayCheckin[]; locale: Locale }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.map((c, i) => (
        <div key={i} style={{ background: '#1e293b', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{c.emp_name || '未知'}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{c.emp_no} · {c.dept_name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <CheckinTypeBadge type={c.checkin_type} />
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              {c.checkin_time ? new Date(c.checkin_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CardView({ data, locale }: { data: TodayCheckin[]; locale: Locale }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
      {data.map((c, i) => {
        const hasCheckedIn = !!c.checkin_type;
        const statusColor = c.checkin_type === 'in' ? '#22c55e' : c.checkin_type === 'out' ? '#3b82f6' : '#64748b';
        return (
          <div key={i} style={{ background: '#1e293b', borderRadius: 12, padding: 12, textAlign: 'center', border: '2px solid', borderColor: hasCheckedIn ? statusColor + '44' : '#334155' }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>{hasCheckedIn ? (c.checkin_type === 'in' ? '✅' : c.checkin_type === 'out' ? '🚪' : '📍') : '⏳'}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{c.emp_name?.slice(0, 4)}</div>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>{c.emp_no}</div>
            {hasCheckedIn ? (
              <>
                <CheckinTypeBadge type={c.checkin_type} />
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                  {new Date(c.checkin_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </>
            ) : (
              <Badge color="#64748b" text={locale === 'zh' ? '未打卡' : locale === 'vi' ? 'Chưa chấm công' : 'Not checked in'} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TimelineView({ data, locale }: { data: TodayCheckin[]; locale: Locale }) {
  const sorted = [...data].sort((a, b) => (b.checkin_time > a.checkin_time ? 1 : -1));
  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, width: 2, background: '#334155' }} />
      {sorted.map((c, i) => (
        <div key={i} style={{ position: 'relative', marginBottom: 16, paddingLeft: 20 }}>
          <div style={{ position: 'absolute', left: -16, top: 8, width: 12, height: 12, borderRadius: '50%', background: c.checkin_type === 'in' ? '#22c55e' : c.checkin_type === 'out' ? '#3b82f6' : '#64748b', border: '2px solid #0f172a' }} />
          <div style={{ background: '#1e293b', borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{c.emp_name}</span>
              <CheckinTypeBadge type={c.checkin_type} />
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {c.emp_no} · {c.checkin_time ? new Date(c.checkin_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '未打卡'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Leave Panel ─────────────────────────────────────────────
function LeavePanel({ locale }: { locale: Locale }) {
  const [subTab, setSubTab] = useState<'pending' | 'history' | 'new'>('pending');
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[
          { key: 'pending', label: t('pending_approval', locale) },
          { key: 'history',  label: t('leave_history', locale) },
          { key: 'new',     label: t('new_leave', locale) },
        ].map(s => (
          <button key={s.key} onClick={() => setSubTab(s.key as any)}
            style={{ flex: 1, padding: '8px 6px', borderRadius: 8, border: '1px solid', borderColor: subTab === s.key ? '#3b82f6' : '#334155', background: subTab === s.key ? '#1d4ed8' : 'transparent', color: '#f1f5f9', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {s.label}
          </button>
        ))}
      </div>
      {subTab === 'pending' && <LeaveApprovalSection locale={locale} />}
      {subTab === 'history' && <LeaveHistorySection locale={locale} />}
      {subTab === 'new'     && <NewLeaveForm locale={locale} />}
    </div>
  );
}

function LeaveApprovalSection({ locale }: { locale: Locale }) {
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<number | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [showSummaryFor, setShowSummaryFor] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await api('/hr/leave/pending-approval');
      setLeaves(json.leaves || []);
    } catch { setLeaves([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openSummary = async (leaveId: number, employeeId: number) => {
    setShowSummaryFor(leaveId);
    try {
      const json = await api(`/hr/leave/employee-summary/${employeeId}`);
      setSummary(json);
    } catch { setSummary(null); }
  };

  const handleApprove = async (leaveId: number) => {
    setApproving(leaveId);
    try {
      await api('/hr/leave/approve', {
        method: 'POST',
        body: JSON.stringify({ leaveId, result: 'approved' }),
      });
      await load();
    } catch {}
    setApproving(null);
    setShowSummaryFor(null);
    setSummary(null);
  };

  const handleReject = async (leaveId: number) => {
    setApproving(leaveId);
    try {
      await api('/hr/leave/approve', {
        method: 'POST',
        body: JSON.stringify({ leaveId, result: 'rejected', reason: rejectReason }),
      });
      setShowRejectModal(null);
      setRejectReason('');
      await load();
    } catch {}
    setApproving(null);
    setShowSummaryFor(null);
    setSummary(null);
  };

  // Q15: Employee summary modal
  const renderSummaryModal = (leave: LeaveRecord) => {
    if (showSummaryFor !== leave.id) return null;
    const att = summary?.attendance || {};
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => { setShowSummaryFor(null); setSummary(null); }}>
        <div style={{ background: '#1e293b', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#f1f5f9' }}>
            📋 {t('employee_info', locale)} — {leave.emp_name}
          </div>

          {summary ? (
            <>
              {/* 当月考勤 */}
              <div style={{ background: '#0f172a', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>当月考勤统计</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                  {[
                    { label: '应到', val: att.total_days || 0, color: '#94a3b8' },
                    { label: '实到', val: att.present_days || 0, color: '#22c55e' },
                    { label: '缺勤', val: att.absent_days || 0, color: '#ef4444' },
                    { label: '迟到', val: att.late_days || 0, color: '#f59e0b' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center', background: '#1e293b', borderRadius: 8, padding: '8px 4px' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.val}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 请假余额 */}
              <div style={{ background: '#0f172a', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>请假余额</div>
                {summary.balances?.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {summary.balances.map((b: any) => (
                      <div key={b.leave_type} style={{ background: '#1e293b', borderRadius: 8, padding: '6px 12px', minWidth: 80, textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{b.leave_type_name || b.leave_type}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#22d3ee' }}>{b.days_left ?? 0}</div>
                        <div style={{ fontSize: 10, color: '#475569' }}>剩余/共{b.days_total ?? 0}天</div>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ color: '#475569', fontSize: 12 }}>暂无余额数据</div>}
              </div>

              {/* 当月请假天数 */}
              {summary.monthDays?.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>当月已请假</div>
                  {summary.monthDays.map((m: any) => (
                    <div key={m.leave_type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#e2e8f0', marginBottom: 4 }}>
                      <span>{m.leave_type}</span>
                      <span style={{ color: '#f59e0b' }}>{m.days_taken}天</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 最近请假记录 */}
              <div style={{ background: '#0f172a', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>最近请假记录</div>
                {summary.recentHistory?.length > 0 ? (
                  summary.recentHistory.map((h: any) => (
                    <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 12 }}>
                      <span style={{ color: '#94a3b8' }}>{h.start_date}~{h.end_date} <span style={{ color: '#475569' }}>({h.leave_type_name})</span></span>
                      <span style={{
                        color: h.status === 'approved' || h.status === 'pending_hr' ? '#22c55e' : h.status === 'rejected' ? '#ef4444' : '#f59e0b',
                        fontWeight: 600
                      }}>{h.status === 'approved' ? '通过' : h.status === 'pending_hr' ? '审批中' : h.status === 'rejected' ? '已拒绝' : h.status}</span>
                    </div>
                  ))
                ) : <div style={{ color: '#475569', fontSize: 12 }}>暂无记录</div>}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>加载中...</div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => handleApprove(leave.id)}
              disabled={approving === leave.id}
              style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#22c55e', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: approving === leave.id ? 0.6 : 1 }}>
              ✅ {approving === leave.id ? '...' : t('approve', locale)}
            </button>
            <button
              onClick={() => setShowRejectModal(leave.id)}
              style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#ef444422', border: '1px solid #ef4444', color: '#ef4444', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              ❌ {t('reject', locale)}
            </button>
            <button onClick={() => { setShowSummaryFor(null); setSummary(null); }}
              style={{ padding: '10px 14px', borderRadius: 8, background: '#334155', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
              ✕
            </button>
          </div>

          {showRejectModal === leave.id && (
            <div style={{ marginTop: 12, padding: 12, background: '#0f172a', borderRadius: 8 }}>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="拒绝原因（选填）"
                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 13, boxSizing: 'border-box', resize: 'vertical', minHeight: 60 }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={() => handleReject(leave.id)} style={{ flex: 1, padding: '8px', borderRadius: 6, background: '#ef4444', border: 'none', color: '#fff', fontSize: 13, cursor: 'pointer' }}>确认拒绝</button>
                <button onClick={() => setShowRejectModal(null)} style={{ flex: 1, padding: '8px', borderRadius: 6, background: '#334155', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>取消</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('loading', locale)}</div>;
  if (leaves.length === 0) return <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('no_data', locale)}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {leaves.map(leave => (
        <div key={leave.id} style={{ background: '#1e293b', borderRadius: 14, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{leave.emp_name}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{leave.emp_no}</div>
            </div>
            <Badge color={leave.leave_color || '#6366f1'} text={leave.leave_type_name} />
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
            📅 {leave.start_date} ~ {leave.end_date}  ({leave.days_count}天)
          </div>
          {leave.reason && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>📝 {leave.reason}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => openSummary(leave.id, leave.employee_id)}
              style={{ flex: 1, padding: '8px', borderRadius: 8, background: '#3b82f6', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              👁 查看员工信息
            </button>
          </div>
          {renderSummaryModal(leave)}
        </div>
      ))}
    </div>
  );
}


function LeaveHistorySection({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'team' | 'mine'>('team');

  useEffect(() => {
    setLoading(true);
    api(`/hr/leave/records?scope=${scope}`)
      .then(json => setRecords(json.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [scope]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['team', '团队'], ['mine', '我的']].map(([k, l]) => (
          <button key={k} onClick={() => setScope(k as any)}
            style={{ flex: 1, padding: '7px', borderRadius: 8, border: '1px solid', borderColor: scope === k ? '#3b82f6' : '#334155', background: scope === k ? '#1d4ed8' : 'transparent', color: '#f1f5f9', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {l}
          </button>
        ))}
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('loading', locale)}</div>
       : records.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('no_data', locale)}</div>
       : records.map(r => (
          <div key={r.id} style={{ background: '#1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{r.emp_name}</span>
              <StatusBadge status={r.status} />
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              <Badge color={r.leave_color} text={r.leave_type_name} /> &nbsp;
              {r.start_date} ~ {r.end_date} ({r.days_count}天)
            </div>
          </div>
        ))
      }
    </div>
  );
}

function NewLeaveForm({ locale }: { locale: Locale }) {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [form, setForm] = useState({ leaveType: '', startDate: '', endDate: '', daysCount: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api('/hr/leave/types').then(json => setLeaveTypes(json.types || [])).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!form.leaveType || !form.startDate || !form.endDate || !form.daysCount) {
      setMsg('请填写必填项');
      return;
    }
    setSubmitting(true);
    try {
      const user = JSON.parse(sessionStorage.getItem('demo_user') || '{}');
      const result = await api('/hr/leave/request', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: user.employeeId,
          leaveType: form.leaveType,
          startDate: form.startDate,
          endDate: form.endDate,
          daysCount: parseFloat(form.daysCount),
          reason: form.reason,
        }),
      });
      if (result.success) {
        setMsg('提交成功！');
        setForm({ leaveType: '', startDate: '', endDate: '', daysCount: '', reason: '' });
      } else {
        setMsg(result.error || '提交失败');
      }
    } catch (e: any) {
      setMsg(e.message);
    }
    setSubmitting(false);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #334155',
    background: '#0f172a', color: '#f1f5f9', fontSize: 14, boxSizing: 'border-box', outline: 'none',
  };

  return (
    <div style={{ background: '#1e293b', borderRadius: 14, padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>{t('leave_type', locale)} *</label>
        <select value={form.leaveType} onChange={e => setForm(f => ({ ...f, leaveType: e.target.value }))} style={{ ...inputStyle }}>
          <option value="">选择假别</option>
          {leaveTypes.map(lt => <option key={lt.id} value={lt.code}>{lt.name_zh}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>{t('start_date', locale)} *</label>
          <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>{t('end_date', locale)} *</label>
          <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} style={inputStyle} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>{t('days_count', locale)} *</label>
        <input type="number" step="0.5" min="0.5" value={form.daysCount} onChange={e => setForm(f => ({ ...f, daysCount: e.target.value }))} style={inputStyle} placeholder="0.5=半天" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>{t('reason', locale)}</label>
        <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} placeholder="请假原因（选填）" />
      </div>
      {msg && <div style={{ padding: '8px 12px', borderRadius: 8, background: msg.includes('成功') ? '#22c55e22' : '#ef444422', color: msg.includes('成功') ? '#22c55e' : '#ef4444', fontSize: 13, marginBottom: 10 }}>{msg}</div>}
      <button onClick={handleSubmit} disabled={submitting} style={{ width: '100%', padding: '12px', borderRadius: 10, background: '#1d4ed8', border: 'none', color: '#fff', fontSize: 15, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
        {submitting ? t('loading', locale) : t('submit', locale)}
      </button>
    </div>
  );
}

// ── Roster Panel ─────────────────────────────────────────────
function RosterPanel({ locale }: { locale: Locale }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TeamMember | null>(null);

  useEffect(() => {
    setLoading(true);
    api('/hr/team/members')
      .then(json => setMembers(json.members || []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('loading', locale)}</div>
       : members.map(m => (
          <div key={m.id} onClick={() => setSelected(m)}
            style={{ background: '#1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                {m.name_zh?.slice(0, 1) || '?'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{m.name_zh}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{m.code} · {m.dept_name} · {m.position}</div>
              </div>
              <div style={{ fontSize: 18, color: '#334155' }}>›</div>
            </div>
          </div>
        ))
      }
      {selected && <EmployeeProfileModal employee={selected} locale={locale} onClose={() => setSelected(null)} />}
    </div>
  );
}

function EmployeeProfileModal({ employee, locale, onClose }: { employee: TeamMember; locale: Locale; onClose: () => void }) {
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api(`/hr/employee/${employee.id}/profile`)
      .then(json => setProfile(json.employee || null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [employee]);

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</div>
      <div style={{ background: '#0f172a', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );

  const Row = ({ label, value }: { label: string; value: string | number | undefined }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ color: '#f1f5f9', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ background: '#1e293b', borderRadius: 16, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
            {employee.name_zh?.slice(0, 1) || '?'}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{employee.name_zh}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{employee.code}</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: '#334155', border: 'none', borderRadius: 8, color: '#94a3b8', padding: '6px 10px', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        {loading ? <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>{t('loading', locale)}</div>
         : profile ? (
          <>
            <Section title={locale === 'zh' ? '基本信息' : locale === 'vi' ? 'Thông tin cơ bản' : 'Basic Info'}>
              <Row label={locale === 'zh' ? '工号' : locale === 'vi' ? 'Mã NV' : 'Code'} value={profile.code} />
              <Row label={locale === 'zh' ? '部门' : locale === 'vi' ? 'Phòng ban' : 'Department'} value={profile.dept_name} />
              <Row label={locale === 'zh' ? '职位' : locale === 'vi' ? 'Chức vụ' : 'Position'} value={profile.position} />
              <Row label={locale === 'zh' ? '入职日期' : locale === 'vi' ? 'Ngày vào' : 'Hire Date'} value={profile.hire_date} />
              <Row label={locale === 'zh' ? '状态' : locale === 'vi' ? 'Trạng thái' : 'Status'} value={profile.status} />
            </Section>
            <Section title={locale === 'zh' ? '联系方式' : locale === 'vi' ? 'Liên hệ' : 'Contact'}>
              <Row label={locale === 'zh' ? '电话' : locale === 'vi' ? 'Điện thoại' : 'Phone'} value={profile.phone} />
              <Row label={locale === 'zh' ? '紧急联系人' : locale === 'vi' ? 'Liên hệ khẩn' : 'Emergency Contact'} value={profile.emergency_contact} />
              <Row label={locale === 'zh' ? '紧急联系电话' : locale === 'vi' ? 'Điện thoại khẩn' : 'Emergency Phone'} value={profile.emergency_phone} />
            </Section>
            <Section title={locale === 'zh' ? '财务信息' : locale === 'vi' ? 'Tài chính' : 'Financial'}>
              <Row label={locale === 'zh' ? '基本工资' : locale === 'vi' ? 'Lương cơ bản' : 'Basic Salary'} value={profile.basic_salary ? `¥${profile.basic_salary.toLocaleString()}` : undefined} />
              <Row label={locale === 'zh' ? '开户行' : locale === 'vi' ? 'Ngân hàng' : 'Bank'} value={profile.bank_name} />
              <Row label={locale === 'zh' ? '银行账户' : locale === 'vi' ? 'Tài khoản' : 'Bank Account'} value={profile.bank_account ? '****' + profile.bank_account.slice(-4) : undefined} />
            </Section>
          </>
         ) : <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>{t('no_data', locale)}</div>}
      </div>
    </div>
  );
}

// ── Attendance Panel ─────────────────────────────────────────
function AttendancePanel({ locale }: { locale: Locale }) {
  const [range, setRange] = useState<'today' | '7d' | 'month' | 'custom'>('7d');
  const [records, setRecords] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    let startDate = '', endDate = new Date().toISOString().split('T')[0];
    if (range === 'today') startDate = endDate;
    else if (range === '7d') { const d = new Date(); d.setDate(d.getDate() - 7); startDate = d.toISOString().split('T')[0]; }
    else if (range === 'month') { startDate = new Date().toISOString().split('T')[0].slice(0, 7) + '-01'; }
    api(`/hr/attendance/stats?scope=team&startDate=${startDate}&endDate=${endDate}`)
      .then(json => { setRecords(json.records || []); setSummary(json.summary || []); })
      .catch(() => { setRecords([]); setSummary([]); })
      .finally(() => setLoading(false));
  }, [range]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['today', t('today_realtime', locale)], ['7d', t('last_7_days', locale)], ['month', t('this_month', locale)]].map(([k, l]) => (
          <button key={k} onClick={() => setRange(k as any)}
            style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid', borderColor: range === k ? '#3b82f6' : '#334155', background: range === k ? '#1d4ed8' : 'transparent', color: '#f1f5f9', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            {l}
          </button>
        ))}
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('loading', locale)}</div>
       : summary.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('no_data', locale)}</div>
       : (
        <>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>共 {records.length} 条记录</div>
          {summary.map((s: any) => (
            <div key={s.emp_no} style={{ background: '#1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>{s.emp_name}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>{s.emp_no}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                <span style={{ color: '#94a3b8' }}>打卡 <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{s.total}</span> 次</span>
                <span style={{ color: '#94a3b8' }}>失败 <span style={{ color: s.face_fail > 0 ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{s.face_fail}</span> 次</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── My Checkin Panel ────────────────────────────────────────
function MyCheckinPanel({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const user = JSON.parse(sessionStorage.getItem('demo_user') || '{}');
    api(`/hr/checkin/history?employeeId=${user.employeeId}&limit=30`)
      .then(json => setRecords(json.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('loading', locale)}</div>
       : records.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('no_data', locale)}</div>
       : records.map((r: any) => (
          <div key={r.id} style={{ background: '#1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <CheckinTypeBadge type={r.checkin_type} />
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                {r.checkin_time ? new Date(r.checkin_time).toLocaleString('zh-CN') : '—'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {r.face_score != null && (
                <div style={{ fontSize: 13, color: r.face_result === 'pass' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                  {Math.round(r.face_score * 100)}%
                </div>
              )}
              <Badge color={r.face_result === 'pass' ? '#22c55e' : '#ef4444'} text={r.face_result || 'pending'} />
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ── Notification Panel ──────────────────────────────────────
function NotificationPanel({ locale }: { locale: Locale }) {
  const [notifs, setNotifs] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await api('/hr/notifications');
      setNotifs(json.notifications || []);
    } catch { setNotifs([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'unread' ? notifs.filter(n => !n.is_read) : notifs;
  const unreadCount = notifs.filter(n => !n.is_read).length;

  const markRead = async () => {
    const ids = notifs.filter(n => !n.is_read).map(n => n.id);
    if (!ids.length) return;
    await api('/hr/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
    await load();
  };

  const iconMap: Record<string, string> = {
    leave_new: '📋', leave_approved: '✅', leave_rejected: '❌', attendance_alert: '⚠️',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['all', t('all_notif', locale) + (unreadCount ? ` (${unreadCount})` : '')], ['unread', t('unread', locale)]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k as any)}
              style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid', borderColor: filter === k ? '#3b82f6' : '#334155', background: filter === k ? '#1d4ed822' : 'transparent', color: filter === k ? '#3b82f6' : '#64748b', fontSize: 12, cursor: 'pointer' }}>
              {l}
            </button>
          ))}
        </div>
        {unreadCount > 0 && (
          <button onClick={markRead} style={{ padding: '6px 10px', borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
            {t('mark_read', locale)}
          </button>
        )}
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('loading', locale)}</div>
       : filtered.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('no_data', locale)}</div>
       : filtered.map(n => (
          <div key={n.id} style={{ background: n.is_read ? '#1e293b' : '#1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 8, borderLeft: n.is_read ? '3px solid #334155' : '3px solid #3b82f6' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 20 }}>{iconMap[n.type] || '🔔'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: n.is_read ? 400 : 600, marginBottom: 2 }}>{n.title_zh}</div>
                {n.body_zh && <div style={{ fontSize: 12, color: '#64748b' }}>{n.body_zh}</div>}
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                  {n.sent_at ? new Date(n.sent_at).toLocaleString('zh-CN') : ''}
                </div>
              </div>
              {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', marginTop: 6 }} />}
            </div>
          </div>
        ))
      }
    </div>
  );
}

// ── Shift Panel ─────────────────────────────────────────────
function ShiftPanel({ locale }: { locale: Locale }) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setLoading(true);
    api('/hr/shifts')
      .then(json => setShifts(json.shifts || []))
      .catch(() => setShifts([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t('loading', locale)}</div>;

  return (
    <div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        {locale === 'zh' ? '当前生效班次（HR 配置） · 如需调整请联系 HR' : locale === 'vi' ? 'Ca đang áp dụng (HR cấu hình) · Liên hệ HR để điều chỉnh' : 'Current active shift (HR configured) · Contact HR to adjust'}
      </div>
      {shifts.map(s => (
        <div key={s.id} style={{ background: '#1e293b', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{s.shift_name}</span>
            {s.is_night_shift ? <Badge color="#a855f7" text={locale === 'zh' ? '夜班' : locale === 'vi' ? 'Ca đêm' : 'Night'} /> : <Badge color="#22c55e" text={locale === 'zh' ? '白班' : locale === 'vi' ? 'Ca ngày' : 'Day'} />}
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#94a3b8' }}>
            <span>🕐 {s.work_start} - {s.work_end}</span>
            {s.break_start && s.break_end && <span>🍜 {s.break_start} - {s.break_end}</span>}
          </div>
        </div>
      ))}
      <button onClick={() => setMsg(locale === 'zh' ? '请联系 HR 申请班次调整' : locale === 'vi' ? 'Liên hệ HR để xin điều chỉnh ca' : 'Contact HR to request shift adjustment')} style={{ width: '100%', marginTop: 10, padding: '10px', borderRadius: 10, background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
        {locale === 'zh' ? '申请班次调整' : locale === 'vi' ? 'Xin điều chỉnh ca' : 'Request Shift Adjustment'}
      </button>
      {msg && <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: '#3b82f622', color: '#3b82f6', fontSize: 13 }}>{msg}</div>}
    </div>
  );
}


// ── Swap Approval Section (Q4) ─────────────────────────────────────────────
function SwapApprovalSection({ locale }: { locale: Locale }) {
  const [swaps, setSwaps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<number | null>(null);
  const t = (k: string) => (i18n[locale] as Record<string, string>)[k] ?? k;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch pending swap requests (status='pending') for supervisor approval
      const json = await api('/hr/swap/requests?status=pending');
      const items = Array.isArray(json.items) ? json.items : [];
      setSwaps(items);
    } catch { setSwaps([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: number) => {
    setActioning(id);
    try {
      await api('/hr/swap/requests/' + id + '/approve', {
        method: 'PATCH',
        body: JSON.stringify({ approver_id: 1, approver_name_zh: '班组长' }),
      });
      await load();
    } catch {}
    setActioning(null);
  };

  const handleReject = async (id: number) => {
    const remark = prompt('请输入拒绝原因：');
    if (remark === null) return;
    setActioning(id);
    try {
      await api('/hr/swap/requests/' + id + '/reject', {
        method: 'PATCH',
        body: JSON.stringify({ remark }),
      });
      await load();
    } catch {}
    setActioning(null);
  };

  if (loading) return <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>{t('loading')}</div>;

  const pendingSwaps = swaps.filter(s => s.status === 'pending');
  const approvedSwaps = swaps.filter(s => s.status === 'supervisor_approved');

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
        🔄 {t('swap')} — {t('pending_approval')} ({pendingSwaps.length})
      </div>
      {pendingSwaps.length === 0 && (
        <div style={{ textAlign: 'center', color: '#64748b', padding: 30 }}>{t('no_data')}</div>
      )}
      {pendingSwaps.map(swap => (
        <div key={swap.id} style={{ background: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 10, border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: '#94a3b8' }}>{swap.request_no || 'SWP-' + swap.id}</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#f59e0b22', color: '#f59e0b' }}>{t('pending')}</span>
          </div>
          <div style={{ fontSize: 14, color: '#e2e8f0', marginBottom: 4 }}>
            📤 {swap.requester_name_zh || '未知'} → 📥 {swap.swap_partner_name_zh || '未知'}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>
            原班：{swap.original_shift_date} · 替班：{swap.target_shift_date}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            原因：{swap.reason_zh || '无'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleApprove(swap.id)}
              disabled={actioning === swap.id}
              style={{
                flex: 1, padding: '8px', borderRadius: 8, background: '#22c55e22', border: '1px solid #22c55e',
                color: '#22c55e', fontSize: 13, cursor: actioning === swap.id ? 'not-allowed' : 'pointer',
                opacity: actioning === swap.id ? 0.5 : 1,
              }}>
              {t('approve')}
            </button>
            <button
              onClick={() => handleReject(swap.id)}
              disabled={actioning === swap.id}
              style={{
                flex: 1, padding: '8px', borderRadius: 8, background: '#ef444422', border: '1px solid #ef4444',
                color: '#ef4444', fontSize: 13, cursor: actioning === swap.id ? 'not-allowed' : 'pointer',
                opacity: actioning === swap.id ? 0.5 : 1,
              }}>
              {t('reject')}
            </button>
          </div>
        </div>
      ))}

      {/* Q4: 已批准待对方确认 */}
      {approvedSwaps.length > 0 && (
        <>
          <div style={{ marginTop: 20, marginBottom: 12, fontSize: 14, fontWeight: 600, color: '#3b82f6' }}>
            ⏳ 待对方确认 ({approvedSwaps.length})
          </div>
          {approvedSwaps.map(swap => (
            <div key={swap.id} style={{ background: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 10, border: '1px solid #3b82f644' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{swap.request_no || 'SWP-' + swap.id}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#3b82f622', color: '#3b82f6' }}>待对方确认</span>
              </div>
              <div style={{ fontSize: 14, color: '#e2e8f0', marginBottom: 4 }}>
                📤 {swap.requester_name_zh || '未知'} → 📥 {swap.swap_partner_name_zh || '未知'}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>
                替班日期：{swap.target_shift_date}
              </div>
              <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 6 }}>
                ✓ 班组长已批准，等待 {swap.swap_partner_name_zh || '对方'} 在手机上确认
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}


export { TeamLeaderApp };
