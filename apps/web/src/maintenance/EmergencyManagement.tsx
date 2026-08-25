import { useState, useEffect, useCallback } from 'react';
import { maintenanceApi } from '../api/maintenance';

// ═══ 紧急应变管理系统 ═══

type Tab = 'dashboard' | 'events' | 'new' | 'sop';

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  L1: { label: 'L1 可继续', color: '#eab308', bg: 'rgba(234,179,8,0.12)', icon: '⚠️' },
  L2: { label: 'L2 停线30min内', color: '#f97316', bg: 'rgba(249,115,22,0.12)', icon: '🚨' },
  L3: { label: 'L3 严重/安全', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', icon: '🔴' },
};

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  equipment: { label: '设备故障', color: '#3b82f6' },
  quality: { label: '质量事故', color: '#ef4444' },
  safety: { label: '安全事故', color: '#dc2626' },
  supply: { label: '供应断供', color: '#f97316' },
  personnel: { label: '人员紧急', color: '#8b5cf6' },
  natural_disaster: { label: '自然灾害', color: '#0891b2' },
  other: { label: '其他', color: '#6b7280' },
};

const STATUS_STEPS = ['reported', 'acknowledged', 'in_progress', 'resolved', 'closed'];

export default function EmergencyManagement() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [events, setEvents] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [sopList, setSopList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [filter, setFilter] = useState({ status: '', severity: '', event_type: '' });

  // New event form
  const [form, setForm] = useState({ title: '', description: '', event_type: 'equipment', severity: 'L2', affected_equipment_id: '', affected_line_id: '' });
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean | string>>({});
  const [closeForm, setCloseForm] = useState({ root_cause: '', corrective_action: '', preventive_action: '' });

  const toggleStep = (key: string) => {
    setCompletedSteps(prev => ({
      ...prev,
      [key]: prev[key] ? false : new Date().toISOString()
    }));
  };

  const handleResolve = async (id: number, status: string) => {
    try {
      await maintenanceApi.updateEmergencyEvent(id, { status, ...closeForm });
      loadEvents();
      setSelectedEvent(null);
    } catch (e: any) { alert('更新失败: ' + e.message); }
  };

  const handleClose = async (id: number) => {
    if (!closeForm.root_cause || !closeForm.corrective_action || !closeForm.preventive_action) {
      alert('请填写: 根本原因 + 纠正措施 + 预防措施');
      return;
    }
    try {
      await maintenanceApi.updateEmergencyEvent(id, { status: 'closed', ...closeForm });
      loadEvents();
      setSelectedEvent(null);
      setCloseForm({ root_cause: '', corrective_action: '', preventive_action: '' });
    } catch (e: any) { alert('关闭失败: ' + e.message); }
  };
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<any>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filter.status) params.status = filter.status;
      if (filter.severity) params.severity = filter.severity;
      if (filter.event_type) params.event_type = filter.event_type;
      const res = await maintenanceApi.getEmergencyEvents(params);
      if (res.success) { setEvents(res.data); setStats(res.stats || {}); }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [filter]);

  const loadSOP = useCallback(async () => {
    try {
      const res = await maintenanceApi.getEmergencySOP({});
      if (res.success) setSopList(res.data || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { if (tab === 'sop') loadSOP(); }, [tab, loadSOP]);

  const submitNewEvent = async () => {
    if (!form.title.trim()) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await maintenanceApi.createEmergencyEvent(form);
      if (res.success) {
        setSubmitResult(res.data);
        setForm({ title: '', description: '', event_type: 'equipment', severity: 'L2', affected_equipment_id: '', affected_line_id: '' });
        loadEvents();
      }
    } catch (e: any) { setSubmitResult({ error: e.message }); }
    setSubmitting(false);
  };

  const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, boxSizing: 'border-box' as const };
  const btnStyle: React.CSSProperties = { padding: '10px 20px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' };

  return (
    <div style={{ padding: 24, fontFamily: "'Segoe UI',system-ui,sans-serif", background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: 0 }}>🚨 紧急应变管理系统</h2>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>设备/质量/安全/供应/自然灾害全覆盖</span>
        </div>
        <button onClick={() => setTab('new')} style={{ ...btnStyle, background: '#ef4444', color: '#fff' }}>
          + 新建紧急事件
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: '#e2e8f0', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {(['dashboard', 'events', 'sop'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 20px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            background: tab === t ? '#3b82f6' : 'transparent', color: tab === t ? '#fff' : '#64748b',
          }}>{t === 'dashboard' ? '📊 仪表盘' : t === 'events' ? '📋 事件列表' : '📖 SOP库'}</button>
        ))}
      </div>

      {/* ═══ Dashboard ═══ */}
      {tab === 'dashboard' && (
        <div>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: '待处理事件', value: stats.open_count || 0, color: '#ef4444', icon: '🚨' },
              { label: 'L3严重事件', value: stats.l3_count || 0, color: '#dc2626', icon: '🔴' },
              { label: '本月已解决', value: stats.resolved_count || 0, color: '#22c55e', icon: '✅' },
              { label: '近7天解决', value: stats.resolved_7d || 0, color: '#22c55e', icon: '📅' },
              { label: '累计损失', value: `${(Number(stats.total_loss_hours)||0).toFixed(1)}h`, color: '#f97316', icon: '💰' },
            ].map((s, i) => (
              <div key={i} style={{ ...cardStyle, textAlign: 'center', borderTop: `3px solid ${s.color}` }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{s.icon} {s.label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Quick new event */}
          <div style={{ ...cardStyle, marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>⚡ 快速上报紧急事件</div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="简要描述事件..." style={inputStyle} />
              <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} style={inputStyle}>
                {Object.entries(SEVERITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))} style={inputStyle}>
                {Object.entries(EVENT_TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="详细描述(可选)..." rows={2} style={{ ...inputStyle, resize: 'vertical', marginTop: 10 }} />
            <button onClick={submitNewEvent} disabled={submitting || !form.title.trim()} style={{ ...btnStyle, background: '#ef4444', color: '#fff', marginTop: 10 }}>
              {submitting ? '提交中...' : '🚨 立即上报'}
            </button>
            {submitResult && !submitResult.error && (
              <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 14 }}>
                ✅ 事件已创建: {submitResult.event_no} | 已发送{submitResult.notifications_sent}条通知
              </div>
            )}
          </div>

          {/* Recent events */}
          <div style={cardStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>📋 最近紧急事件</div>
            {events.slice(0, 5).map((e: any) => {
              const sc = SEVERITY_CONFIG[e.severity] || SEVERITY_CONFIG.L2;
              return (
                <div key={e.id} onClick={() => { setSelectedEvent(e); setTab('events'); }}
                  style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{sc.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{e.title}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{e.event_no} | {EVENT_TYPE_CONFIG[e.event_type]?.label} | {new Date(e.reported_at).toLocaleString('zh-CN')}</div>
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>{sc.label}</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: e.status === 'resolved' ? 'rgba(34,197,94,0.1)' : '#f1f5f9', color: e.status === 'resolved' ? '#22c55e' : '#64748b' }}>{e.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Events List ═══ */}
      {tab === 'events' && (
        <div>
          {/* Filters */}
          <div style={{ ...cardStyle, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
            <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} style={inputStyle}>
              <option value="">全部状态</option>
              {STATUS_STEPS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filter.severity} onChange={e => setFilter(f => ({ ...f, severity: e.target.value }))} style={inputStyle}>
              <option value="">全部等级</option>
              {Object.entries(SEVERITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={filter.event_type} onChange={e => setFilter(f => ({ ...f, event_type: e.target.value }))} style={inputStyle}>
              <option value="">全部类型</option>
              {Object.entries(EVENT_TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button onClick={loadEvents} style={{ ...btnStyle, background: '#3b82f6', color: '#fff' }}>🔄 刷新</button>
          </div>

          {/* Event list */}
          {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>加载中...</div> : (
            events.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>暂无紧急事件</div> : (
              events.map((e: any) => {
                const sc = SEVERITY_CONFIG[e.severity] || SEVERITY_CONFIG.L2;
                const etc = EVENT_TYPE_CONFIG[e.event_type] || EVENT_TYPE_CONFIG.other;
                return (
                  <div key={e.id} style={{ ...cardStyle, marginBottom: 12, borderLeft: `4px solid ${sc.color}`, cursor: 'pointer' }}
                    onClick={() => setSelectedEvent(e)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div>
                        <span style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{e.title}</span>
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#94a3b8' }}>{e.event_no}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.color }}>{sc.label}</span>
                        <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, background: `${etc.color}15`, color: etc.color }}>{etc.label}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>{e.description || '无描述'}</div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#94a3b8' }}>
                      <span>📍 {e.reporter_name || '-'} | {e.reporter_role || '-'}</span>
                      <span>🕐 {new Date(e.reported_at).toLocaleString('zh-CN')}</span>
                      {e.unacknowledged_count > 0 && <span style={{ color: '#ef4444' }}>📬 {e.unacknowledged_count}条未读通知</span>}
                      {e.production_loss_hours > 0 && <span>💰 损失{e.production_loss_hours}h</span>}
                    </div>
                    {/* Status steps */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
                      {STATUS_STEPS.map((s, i) => (
                        <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: STATUS_STEPS.indexOf(e.status) >= i ? '#22c55e' : '#e2e8f0', color: STATUS_STEPS.indexOf(e.status) >= i ? '#fff' : '#94a3b8',
                            fontSize: 11, fontWeight: 700,
                          }}>{i+1}</div>
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>{s}</span>
                          {i < STATUS_STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: STATUS_STEPS.indexOf(e.status) > i ? '#22c55e' : '#e2e8f0' }} />}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>
      )}

      {/* ═══ SOP Library ═══ */}
      {tab === 'sop' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {sopList.map((sop: any) => (
              <div key={sop.id} style={{ ...cardStyle, borderTop: `3px solid ${EVENT_TYPE_CONFIG[sop.event_type]?.color || '#6b7280'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{sop.title}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{sop.sop_code}</span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                  {EVENT_TYPE_CONFIG[sop.event_type]?.label} | {sop.severity_level || '全部等级'}
                </div>
                {/* Steps */}
                <div style={{ marginBottom: 12 }}>
                  {(sop.steps || []).map((step: any, i: number) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 13 }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#3b82f6', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{step.seq}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: '#475569' }}>{step.step}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>👤 {step.responsible} | ⏱ {step.timeout_min}min</div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Check items */}
                {(sop.check_items || []).length > 0 && (
                  <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 8, fontSize: 12, color: '#475569' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>✅ 验收项:</div>
                    {(sop.check_items || []).map((item: string, i: number) => (
                      <div key={i}>• {item}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedEvent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setSelectedEvent(null)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 600, maxHeight: '85vh', overflow: 'auto' }}
            onClick={ev => ev.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>{selectedEvent.title}</div>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>{selectedEvent.event_no}</div>
              </div>
              <button onClick={() => setSelectedEvent(null)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <span style={{ padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: SEVERITY_CONFIG[selectedEvent.severity]?.bg, color: SEVERITY_CONFIG[selectedEvent.severity]?.color }}>
                {SEVERITY_CONFIG[selectedEvent.severity]?.icon} {SEVERITY_CONFIG[selectedEvent.severity]?.label}
              </span>
              <span style={{ padding: '4px 12px', borderRadius: 6, fontSize: 13, background: `${EVENT_TYPE_CONFIG[selectedEvent.event_type]?.color}15`, color: EVENT_TYPE_CONFIG[selectedEvent.event_type]?.color }}>
                {EVENT_TYPE_CONFIG[selectedEvent.event_type]?.label}
              </span>
            </div>
            <div style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>{selectedEvent.description || '无描述'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, fontSize: 13, color: '#64748b' }}>
              <div>📍 上报人: {selectedEvent.reporter_name || '-'} ({selectedEvent.reporter_role || '-'})</div>
              <div>🕐 上报时间: {new Date(selectedEvent.reported_at).toLocaleString('zh-CN')}</div>
              <div>🏭 设备: {selectedEvent.affected_equipment_code || '-'}</div>
              <div>💰 损失: {selectedEvent.production_loss_hours || 0}h / ${selectedEvent.actual_loss_amount || 0}</div>
            </div>
            {/* Root cause */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>根本原因</div>
              <div style={{ padding: 10, background: '#f8fafc', borderRadius: 8, fontSize: 13, color: '#475569', minHeight: 40 }}>
                {selectedEvent.root_cause || '(未填写)'}
              </div>
            </div>
            {/* Corrective + Preventive */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>纠正措施</div>
                <div style={{ padding: 10, background: '#f8fafc', borderRadius: 8, fontSize: 13, color: '#475569', minHeight: 40 }}>
                  {selectedEvent.corrective_action || '(未填写)'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>预防措施</div>
                <div style={{ padding: 10, background: '#f8fafc', borderRadius: 8, fontSize: 13, color: '#475569', minHeight: 40 }}>
                  {selectedEvent.preventive_action || '(未填写)'}
                </div>
              </div>
            </div>
            {/* Close form - requires 3 fields */}
            {selectedEvent.status !== 'closed' && (
              <div style={{ margin: '16px 0', padding: 16, background: '#fef3c7', borderRadius: 10, border: '1px solid #f59e0b' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 10 }}>🔒 关闭条件 (必填3项)</div>
                <textarea placeholder="根本原因 (Root Cause)" rows={2}
                  value={closeForm.root_cause} onChange={e => setCloseForm(f => ({ ...f, root_cause: e.target.value }))}
                  style={{ ...inputStyle, marginBottom: 8, border: '1px solid #f59e0b' }} />
                <textarea placeholder="纠正措施 (Corrective Action)" rows={2}
                  value={closeForm.corrective_action} onChange={e => setCloseForm(f => ({ ...f, corrective_action: e.target.value }))}
                  style={{ ...inputStyle, marginBottom: 8, border: '1px solid #f59e0b' }} />
                <textarea placeholder="预防措施 (Preventive Action)" rows={2}
                  value={closeForm.preventive_action} onChange={e => setCloseForm(f => ({ ...f, preventive_action: e.target.value }))}
                  style={{ ...inputStyle, marginBottom: 8, border: '1px solid #f59e0b' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleResolve(selectedEvent.id, 'resolved')}
                    style={{ ...btnStyle, background: '#22c55e', color: '#fff', flex: 1 }}>
                    ✅ 标记已解决 (继续生产)
                  </button>
                  <button onClick={() => handleClose(selectedEvent.id)}
                    disabled={!closeForm.root_cause || !closeForm.corrective_action || !closeForm.preventive_action}
                    style={{ ...btnStyle, background: (!closeForm.root_cause || !closeForm.corrective_action || !closeForm.preventive_action) ? '#e2e8f0' : '#dc2626', color: (!closeForm.root_cause || !closeForm.corrective_action || !closeForm.preventive_action) ? '#94a3b8' : '#fff', flex: 1 }}>
                    🔒 关闭事件
                  </button>
                </div>
              </div>
            )}

            {/* Notifications log */}
            {selectedEvent.notifications?.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>通知记录</div>
                {(selectedEvent.notifications || []).map((n: any) => (
                  <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', marginBottom: 4, borderRadius: 6, background: n.acknowledged_at ? 'rgba(34,197,94,0.06)' : 'rgba(234,179,8,0.06)', fontSize: 12 }}>
                    <span style={{ color: n.message?.includes('超时未确认') ? '#f97316' : undefined }}>📬 {n.channel} → {n.recipient_role} ({n.recipient_name || '-'}) {n.message?.includes('超时未确认') && <span style={{ color: '#f97316', fontWeight: 600 }}>⚠️超时未确认</span>}</span>
                    <span style={{ color: n.acknowledged_at ? '#22c55e' : '#eab308' }}>{n.acknowledged_at ? '✓ 已读' : '⏳ 待读'}{n.response_time_seconds > 0 && ` (${Math.floor(n.response_time_seconds/60)}min)`}</span>
                  </div>
                ))}
              </div>
            )}
            {/* SOP */}
            {selectedEvent.sop && (
              <div style={{ marginTop: 16, padding: 16, background: `${EVENT_TYPE_CONFIG[selectedEvent.event_type]?.color}08`, borderRadius: 10, border: `1px solid ${EVENT_TYPE_CONFIG[selectedEvent.event_type]?.color}22` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>📖 应急预案: {selectedEvent.sop.title}</div>
                {(selectedEvent.sop.steps || []).map((step: any) => {
                  const completed = completedSteps[`sop_${step.seq}`];
                  return (
                    <div key={step.seq} style={{ fontSize: 12, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => toggleStep(`sop_${step.seq}`)}
                        style={{
                          width: 22, height: 22, borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
                          background: completed ? '#22c55e' : '#e2e8f0',
                          color: completed ? '#fff' : '#94a3b8', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                        {completed ? '✓' : step.seq}
                      </button>
                      <div style={{ flex: 1, color: completed ? '#22c55e' : '#475569', textDecoration: completed ? 'none' : 'none' }}>
                        {step.step} (👤{step.responsible} ⏱{step.timeout_min}min)
                      </div>
                      {completed && <span style={{ fontSize: 10, color: '#94a3b8' }}>{new Date(String(completed)).toLocaleString('zh-CN')}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
