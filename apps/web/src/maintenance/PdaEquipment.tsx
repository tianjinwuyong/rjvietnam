import { useState, useEffect, useCallback } from 'react';
import { maintenanceApi } from '../api/maintenance';

// ═══ 移动PDA设备管理 ═══
// 扫码报修 / PM Checklist / 离线暂存 / 拍照上传

type PdaTab = 'scan' | 'workorders' | 'pm' | 'offline';

// Offline storage helper
const OFFLINE_KEY = 'pda_offline_queue';
function getOfflineQueue(): any[] {
  try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]'); } catch { return []; }
}
function saveOfflineQueue(q: any[]) { localStorage.setItem(OFFLINE_KEY, JSON.stringify(q)); }

export default function PdaEquipment() {
  const [tab, setTab] = useState<PdaTab>('scan');
  const [scanInput, setScanInput] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  // Work order form
  const [woForm, setWoForm] = useState({ equipmentId: '', faultDescription: '', urgencyLevel: 'can_continue', faultCode: '' });
  const [woSubmitting, setWoSubmitting] = useState(false);
  const [woSuccess, setWoSuccess] = useState('');
  // Work orders list
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [woLoading, setWoLoading] = useState(false);
  // PM
  const [pmTasks, setPmTasks] = useState<any[]>([]);
  const [pmLoading, setPmLoading] = useState(false);
  const [pmChecklist, setPmChecklist] = useState<Record<string, boolean>>({});
  const [pmSubmitting, setPmSubmitting] = useState(false);
  // Offline
  const [offlineQueue, setOfflineQueue] = useState<any[]>(getOfflineQueue());
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState('');

  // Scan handler
  const handleScan = useCallback(async () => {
    if (!scanInput.trim()) return;
    setScanning(true);
    setScanResult(null);
    try {
      // Try to find equipment by asset_code or QR content
      const res = await maintenanceApi.getEquipment({ search: scanInput.trim() });
      if (res.success && res.data?.length > 0) {
        setScanResult(res.data[0]);
        setWoForm(f => ({ ...f, equipmentId: res.data[0].id }));
      } else {
        setScanResult({ notFound: true, code: scanInput.trim() });
      }
    } catch { setScanResult({ error: true, code: scanInput.trim() }); }
    setScanning(false);
  }, [scanInput]);

  // Submit work order
  const submitWO = async () => {
    if (!woForm.equipmentId || !woForm.faultDescription.trim()) return;
    setWoSubmitting(true);
    setWoSuccess('');
    try {
      const res = await maintenanceApi.createWorkOrder({
        equipment_id: woForm.equipmentId,
        fault_description: woForm.faultDescription,
        urgency_level: woForm.urgencyLevel,
        fault_code: woForm.faultCode || undefined,
        source: 'pda',
      });
      if (res.success) {
        setWoSuccess(`工单 ${res.data?.wo_no || ''} 创建成功！`);
        setWoForm({ equipmentId: woForm.equipmentId, faultDescription: '', urgencyLevel: 'can_continue', faultCode: '' });
      }
    } catch {
      // Offline: save to queue
      const q = getOfflineQueue();
      q.push({ type: 'work_order', data: woForm, timestamp: new Date().toISOString() });
      saveOfflineQueue(q);
      setOfflineQueue(q);
      setWoSuccess('离线模式：已保存到本地队列');
    }
    setWoSubmitting(false);
  };

  // Load work orders
  const loadWOs = useCallback(async () => {
    setWoLoading(true);
    try {
      const res = await maintenanceApi.getWorkOrders({ status: 'open,in_progress,assigned', limit: 20 });
      if (res.success) setWorkOrders(res.data || []);
    } catch {}
    setWoLoading(false);
  }, []);

  // Load PM tasks
  const loadPM = useCallback(async () => {
    setPmLoading(true);
    try {
      const res = await maintenanceApi.getPmExecutionRecords({ scheduled_date: new Date().toISOString().split('T')[0] });
      if (res.success) setPmTasks(res.data || []);
    } catch {}
    setPmLoading(false);
  }, []);

  // Submit PM checklist
  const submitPM = async (taskId: string) => {
    setPmSubmitting(true);
    try {
      await maintenanceApi.updatePmExecutionRecord(taskId, {
        result: 'completed',
        completed_at: new Date().toISOString(),
        checklist: pmChecklist,
      });
      setPmTasks(ts => ts.map(t => t.id === taskId ? { ...t, result: 'completed' } : t));
    } catch {
      const q = getOfflineQueue();
      q.push({ type: 'pm_complete', data: { taskId, checklist: pmChecklist }, timestamp: new Date().toISOString() });
      saveOfflineQueue(q);
      setOfflineQueue(q);
    }
    setPmSubmitting(false);
  };

  // Sync offline queue
  const syncOffline = async () => {
    setSyncing(true);
    setSyncResult('');
    const q = getOfflineQueue();
    let ok = 0, fail = 0;
    for (const item of q) {
      try {
        if (item.type === 'work_order') {
          await maintenanceApi.createWorkOrder({ ...item.data, source: 'pda_offline' });
          ok++;
        } else if (item.type === 'pm_complete') {
          await maintenanceApi.updatePmExecutionRecord(item.data.taskId, {
            result: 'completed', completed_at: new Date().toISOString(), checklist: item.data.checklist,
          });
          ok++;
        }
      } catch { fail++; }
    }
    if (fail === 0) { saveOfflineQueue([]); setOfflineQueue([]); }
    setSyncResult(`同步完成: ${ok}成功, ${fail}失败`);
    setSyncing(false);
  };

  useEffect(() => {
    if (tab === 'workorders') loadWOs();
    if (tab === 'pm') loadPM();
  }, [tab, loadWOs, loadPM]);

  const tabStyle = (t: PdaTab) => ({
    flex: 1, padding: '12px 0', textAlign: 'center' as const, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    background: tab === t ? '#3b82f6' : 'transparent', color: tab === t ? '#fff' : '#94a3b8',
    borderRadius: 8, transition: 'all 0.2s',
  });

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid #d1d5db',
    fontSize: 15, boxSizing: 'border-box', outline: 'none',
  };
  const btnStyle: React.CSSProperties = {
    width: '100%', padding: '14px', borderRadius: 8, border: 'none', fontSize: 15,
    fontWeight: 700, cursor: 'pointer', color: '#fff', background: '#3b82f6',
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px', fontFamily: "'Segoe UI',system-ui,sans-serif", minHeight: '100vh', background: '#f8fafc' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b' }}>📱 设备PDA</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>瑞晶SMT · 移动端设备管理</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: '#e2e8f0', borderRadius: 10, padding: 4 }}>
        <div style={tabStyle('scan')} onClick={() => setTab('scan')}>📷 扫码</div>
        <div style={tabStyle('workorders')} onClick={() => setTab('workorders')}>🔧 工单</div>
        <div style={tabStyle('pm')} onClick={() => setTab('pm')}>🛠️ 保养</div>
        <div style={tabStyle('offline')} onClick={() => setTab('offline')}>
          📦 离线{offlineQueue.length > 0 ? `(${offlineQueue.length})` : ''}
        </div>
      </div>

      {/* ═══ Scan Tab ═══ */}
      {tab === 'scan' && (
        <div>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>扫描设备二维码</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={scanInput} onChange={e => setScanInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScan()}
                placeholder="输入/扫描设备编号..." style={inputStyle} />
              <button onClick={handleScan} disabled={scanning}
                style={{ ...btnStyle, width: 'auto', padding: '12px 20px', background: scanning ? '#94a3b8' : '#3b82f6' }}>
                {scanning ? '...' : '查询'}
              </button>
            </div>
            {/* Camera scan button */}
            <button onClick={() => { /* TODO: integrate camera QR scanner */ alert('请接入摄像头扫码SDK'); }}
              style={{ ...btnStyle, background: '#10b981', marginBottom: 12 }}>
              📷 打开摄像头扫码
            </button>
          </div>

          {/* Scan Result */}
          {scanResult && (
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 16 }}>
              {scanResult.notFound ? (
                <div style={{ textAlign: 'center', color: '#ef4444', padding: 20 }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>❌</div>
                  <div>未找到设备: {scanResult.code}</div>
                </div>
              ) : scanResult.error ? (
                <div style={{ textAlign: 'center', color: '#ef4444', padding: 20 }}>查询失败，请重试</div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{scanResult.asset_code}</div>
                      <div style={{ fontSize: 13, color: '#64748b' }}>{scanResult.name_zh}</div>
                    </div>
                    <span style={{
                      padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      background: scanResult.status === 'fault' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                      color: scanResult.status === 'fault' ? '#ef4444' : '#22c55e',
                    }}>{scanResult.status === 'fault' ? '故障' : scanResult.status === 'active' ? '运行中' : scanResult.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
                    类别: {scanResult.category_name || '-'} | 关键度: {scanResult.criticality || '-'} | 产线: {scanResult.line_code || '-'}
                  </div>

                  {/* Quick Report Fault */}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 10 }}>⚡ 快速报修</div>
                    <textarea value={woForm.faultDescription}
                      onChange={e => setWoForm(f => ({ ...f, faultDescription: e.target.value }))}
                      placeholder="描述故障现象..." rows={3}
                      style={{ ...inputStyle, resize: 'vertical', marginBottom: 10 }} />
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      {(['line_down', 'speed_reduced', 'can_continue'] as const).map(u => (
                        <button key={u} onClick={() => setWoForm(f => ({ ...f, urgencyLevel: u }))}
                          style={{
                            flex: 1, padding: '10px', borderRadius: 8, border: '2px solid',
                            borderColor: woForm.urgencyLevel === u ? (u === 'line_down' ? '#ef4444' : u === 'speed_reduced' ? '#f97316' : '#eab308') : '#e2e8f0',
                            background: woForm.urgencyLevel === u ? (u === 'line_down' ? 'rgba(239,68,68,0.1)' : u === 'speed_reduced' ? 'rgba(249,115,22,0.1)' : 'rgba(234,179,8,0.1)') : '#fff',
                            color: u === 'line_down' ? '#ef4444' : u === 'speed_reduced' ? '#f97316' : '#eab308',
                            fontWeight: 600, fontSize: 13, cursor: 'pointer',
                          }}>
                          {u === 'line_down' ? '🚨 停线' : u === 'speed_reduced' ? '⚠️ 降速' : '✅ 可继续'}
                        </button>
                      ))}
                    </div>
                    <button onClick={submitWO} disabled={woSubmitting || !woForm.faultDescription.trim()}
                      style={{ ...btnStyle, background: woSubmitting ? '#94a3b8' : '#ef4444' }}>
                      {woSubmitting ? '提交中...' : '🔧 提交报修工单'}
                    </button>
                    {woSuccess && <div style={{ textAlign: 'center', color: '#22c55e', marginTop: 10, fontSize: 14, fontWeight: 600 }}>{woSuccess}</div>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ Work Orders Tab ═══ */}
      {tab === 'workorders' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>活跃工单</span>
            <button onClick={loadWOs} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>🔄 刷新</button>
          </div>
          {woLoading ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>加载中...</div> : (
            workOrders.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>暂无活跃工单</div> : (
              workOrders.map((wo: any) => (
                <div key={wo.id} style={{ background: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.06)', borderLeft: `4px solid ${wo.urgency_level === 'line_down' ? '#ef4444' : wo.urgency_level === 'speed_reduced' ? '#f97316' : '#eab308'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{wo.wo_no}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{wo.status}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>{wo.fault_description}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {wo.equipment_name || wo.asset_code} | {wo.assigned_technician ? `👤 ${wo.assigned_technician}` : '待派工'}
                  </div>
                </div>
              ))
            )
          )}
        </div>
      )}

      {/* ═══ PM Tab ═══ */}
      {tab === 'pm' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>今日保养任务</span>
            <button onClick={loadPM} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>🔄 刷新</button>
          </div>
          {pmLoading ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>加载中...</div> : (
            pmTasks.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>今日无保养任务</div> : (
              pmTasks.map((task: any) => (
                <div key={task.id} style={{ background: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{task.equipment_name || task.asset_code}</span>
                    <span style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 4,
                      background: task.result === 'completed' ? 'rgba(34,197,94,0.1)' : 'rgba(234,179,8,0.1)',
                      color: task.result === 'completed' ? '#22c55e' : '#eab308',
                    }}>{task.result === 'completed' ? '✓ 已完成' : '待执行'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{task.template_name || task.pm_type || '常规保养'}</div>
                  {/* Checklist */}
                  {task.result !== 'completed' && (
                    <div>
                      {(task.checklist_items || ['检查设备外观', '清洁设备表面', '检查润滑状态', '检查电气连接', '测试运行状态']).map((item: string, idx: number) => (
                        <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13, color: '#475569', cursor: 'pointer' }}>
                          <input type="checkbox" checked={pmChecklist[`${task.id}_${idx}`] || false}
                            onChange={e => setPmChecklist(c => ({ ...c, [`${task.id}_${idx}`]: e.target.checked }))}
                            style={{ width: 18, height: 18 }} />
                          {item}
                        </label>
                      ))}
                      <button onClick={() => submitPM(task.id)} disabled={pmSubmitting}
                        style={{ ...btnStyle, marginTop: 8, background: pmSubmitting ? '#94a3b8' : '#22c55e' }}>
                        {pmSubmitting ? '提交中...' : '✅ 完成保养'}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )
          )}
        </div>
      )}

      {/* ═══ Offline Tab ═══ */}
      {tab === 'offline' && (
        <div>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>📦 离线队列</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              {offlineQueue.length === 0 ? '队列为空，所有数据已同步' : `${offlineQueue.length} 条待同步记录`}
            </div>
            {offlineQueue.length > 0 && (
              <>
                <button onClick={syncOffline} disabled={syncing}
                  style={{ ...btnStyle, background: syncing ? '#94a3b8' : '#3b82f6', marginBottom: 12 }}>
                  {syncing ? '同步中...' : '🔄 立即同步'}
                </button>
                {syncResult && <div style={{ textAlign: 'center', color: '#22c55e', fontSize: 13, marginBottom: 12 }}>{syncResult}</div>}
                {offlineQueue.map((item, i) => (
                  <div key={i} style={{ padding: '10px 12px', marginBottom: 6, borderRadius: 8, background: '#f1f5f9', fontSize: 12, color: '#475569' }}>
                    <span style={{ fontWeight: 600 }}>{item.type === 'work_order' ? '🔧 报修工单' : '🛠️ 保养完成'}</span>
                    <span style={{ color: '#94a3b8', marginLeft: 8 }}>{new Date(item.timestamp).toLocaleString('zh-CN')}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
