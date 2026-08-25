import { useState, useEffect, useCallback } from 'react';
import { maintenanceApi } from '../api/maintenance';

// ═══ 设备报表中心 ═══
// 月度报表 / OEE报表 / CSV导出

type ReportTab = 'monthly' | 'oee';

export default function EquipmentReports() {
  const [tab, setTab] = useState<ReportTab>('monthly');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [monthlyData, setMonthlyData] = useState<any>(null);
  const [oeeData, setOeeData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadMonthly = useCallback(async () => {
    setLoading(true);
    try {
      const res = await maintenanceApi.getMonthlyReport({ year, month });
      if (res.success) setMonthlyData(res.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [year, month]);

  const loadOee = useCallback(async () => {
    setLoading(true);
    try {
      const res = await maintenanceApi.getOeeReport({ startDate, endDate });
      if (res.success) setOeeData(res.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => {
    if (tab === 'monthly') loadMonthly();
    else loadOee();
  }, [tab, loadMonthly, loadOee]);

  // CSV export helper
  const exportCSV = (filename: string, headers: string[], rows: any[][]) => {
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  };

  const exportMonthlyCSV = () => {
    if (!monthlyData) return;
    const wo = monthlyData.work_orders || {};
    const pm = monthlyData.pm_compliance || {};
    const cost = monthlyData.cost_breakdown || {};
    exportCSV(`设备月报_${year}年${month}月.csv`,
      ['指标', '数值'],
      [
        ['报表周期', `${year}年${month}月`],
        ['工单总数', wo.total_wos || 0],
        ['完成工单', wo.completed_wos || 0],
        ['停线工单', wo.line_down_wos || 0],
        ['平均停机(分钟)', Math.round(Number(wo.avg_downtime) || 0)],
        ['平均维修时长(小时)', Math.round(Number(wo.avg_repair_hours) * 10) / 10 || 0],
        ['维修总费用($)', Math.round(Number(wo.total_repair_cost) || 0)],
        ['PM总数', pm.total_pm || 0],
        ['PM完成', pm.completed_pm || 0],
        ['PM逾期', pm.overdue_pm || 0],
        ['PM合规率', pm.total_pm > 0 ? Math.round((pm.completed_pm / pm.total_pm) * 100) + '%' : 'N/A'],
        ['备件费用($)', Math.round(Number(cost.spare_cost) || 0)],
        ['易耗品费用($)', Math.round(Number(cost.consumable_cost) || 0)],
        ['外修费用($)', Math.round(Number(cost.external_cost) || 0)],
      ]);
  };

  const exportOeeCSV = () => {
    if (!oeeData?.equipment) return;
    exportCSV(`OEE报表_${startDate}_${endDate}.csv`,
      ['设备编号', '设备名称', '关键度', 'OEE%', '可用率%', '性能率%', '质量率%', '工单数', '总停机(分)'],
      oeeData.equipment.map((e: any) => [
        e.asset_code, e.name_zh, e.criticality, e.oee, e.availability_pct,
        Math.round(Number(e.performance) * 10000) / 100, Math.round(Number(e.quality) * 10000) / 100,
        e.wo_count, e.total_downtime_min,
      ]));
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  };
  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #e2e8f0',
    fontSize: 12, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: '8px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#475569',
  };

  return (
    <div style={{ padding: 24, fontFamily: "'Segoe UI',system-ui,sans-serif", background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', margin: 0 }}>📊 设备报表中心</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTab('monthly')} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === 'monthly' ? '#3b82f6' : '#e2e8f0', color: tab === 'monthly' ? '#fff' : '#64748b',
          }}>📅 月度报表</button>
          <button onClick={() => setTab('oee')} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: tab === 'oee' ? '#3b82f6' : '#e2e8f0', color: tab === 'oee' ? '#fff' : '#64748b',
          }}>📈 OEE报表</button>
        </div>
      </div>

      {/* Period selector */}
      <div style={{ ...cardStyle, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
        {tab === 'monthly' ? (
          <>
            <span style={{ fontSize: 13, color: '#64748b' }}>报表周期:</span>
            <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}年</option>)}
            </select>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
            </select>
            <button onClick={exportMonthlyCSV} style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ⬇️ 导出CSV
            </button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, color: '#64748b' }}>日期范围:</span>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }} />
            <span style={{ color: '#94a3b8' }}>至</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }} />
            <button onClick={exportOeeCSV} style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ⬇️ 导出CSV
            </button>
          </>
        )}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>加载中...</div>}

      {/* ═══ Monthly Report ═══ */}
      {tab === 'monthly' && monthlyData && !loading && (
        <div>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: '工单总数', value: monthlyData.work_orders?.total_wos || 0, sub: `完成 ${monthlyData.work_orders?.completed_wos || 0}`, color: '#3b82f6' },
              { label: '平均停机', value: `${Math.round(Number(monthlyData.work_orders?.avg_downtime) || 0)}分`, sub: `停线 ${monthlyData.work_orders?.line_down_wos || 0}次`, color: '#ef4444' },
              { label: 'PM合规率', value: monthlyData.pm_compliance?.total_pm > 0 ? `${Math.round((monthlyData.pm_compliance.completed_pm / monthlyData.pm_compliance.total_pm) * 100)}%` : 'N/A', sub: `${monthlyData.pm_compliance?.completed_pm || 0}/${monthlyData.pm_compliance?.total_pm || 0}`, color: '#22c55e' },
              { label: '维修总费用', value: `$${Math.round(Number(monthlyData.work_orders?.total_repair_cost) || 0).toLocaleString()}`, sub: `备件 $${Math.round(Number(monthlyData.cost_breakdown?.spare_cost) || 0).toLocaleString()}`, color: '#f97316' },
            ].map((c, i) => (
              <div key={i} style={{ ...cardStyle, textAlign: 'center', borderTop: `3px solid ${c.color}` }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: c.color }}>{c.value}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Cost Breakdown */}
          <div style={{ ...cardStyle, marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 14 }}>💰 费用构成</div>
            <div style={{ display: 'flex', gap: 16 }}>
              {[
                { label: '维修费用', value: Number(monthlyData.cost_breakdown?.repair_cost) || 0, color: '#3b82f6' },
                { label: '外修费用', value: Number(monthlyData.cost_breakdown?.external_cost) || 0, color: '#8b5cf6' },
                { label: '备件费用', value: Number(monthlyData.cost_breakdown?.spare_cost) || 0, color: '#22c55e' },
                { label: '易耗品费用', value: Number(monthlyData.cost_breakdown?.consumable_cost) || 0, color: '#f97316' },
              ].map((c, i) => {
                const total = [monthlyData.cost_breakdown?.repair_cost, monthlyData.cost_breakdown?.external_cost, monthlyData.cost_breakdown?.spare_cost, monthlyData.cost_breakdown?.consumable_cost].reduce((s: number, v: any) => s + (Number(v) || 0), 0) || 1;
                const pct = Math.round((c.value / total) * 100);
                return (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: c.color }}>${Math.round(c.value).toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{c.label}</div>
                    <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: c.color, borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Failures + Fault Pareto */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>🔧 故障TOP10设备</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={thStyle}>设备</th><th style={thStyle}>次数</th><th style={thStyle}>停机(分)</th><th style={thStyle}>费用($)</th>
                </tr></thead>
                <tbody>
                  {(monthlyData.top_failures || []).map((f: any, i: number) => (
                    <tr key={i}>
                      <td style={tdStyle}><b>{f.asset_code}</b> {f.name_zh}</td>
                      <td style={{ ...tdStyle, color: '#ef4444', fontWeight: 700 }}>{f.failure_count}</td>
                      <td style={tdStyle}>{Math.round(Number(f.total_downtime) || 0)}</td>
                      <td style={tdStyle}>{Math.round(Number(f.total_cost) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>📊 故障代码帕累托</div>
              {(monthlyData.fault_pareto || []).map((f: any, i: number, arr: any[]) => {
                const total = arr.reduce((s: number, x: any) => s + Number(x.count), 0) || 1;
                const pct = Math.round((Number(f.count) / total) * 100);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: '#475569', width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name_zh || f.code}</span>
                    <div style={{ flex: 1, height: 16, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: i < 3 ? '#ef4444' : i < 6 ? '#f97316' : '#eab308', borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', width: 30, textAlign: 'right' }}>{f.count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Spare Parts Usage */}
          <div style={cardStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>📦 备件消耗TOP10</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thStyle}>备件编号</th><th style={thStyle}>名称</th><th style={thStyle}>用量</th><th style={thStyle}>单价($)</th><th style={thStyle}>总费用($)</th>
              </tr></thead>
              <tbody>
                {(monthlyData.spare_parts_usage || []).map((s: any, i: number) => (
                  <tr key={i}>
                    <td style={tdStyle}>{s.part_code}</td>
                    <td style={tdStyle}>{s.name_zh}</td>
                    <td style={tdStyle}>{s.total_used}</td>
                    <td style={tdStyle}>{Number(s.unit_price).toFixed(2)}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: '#f97316' }}>${Math.round(Number(s.total_cost) || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ OEE Report ═══ */}
      {tab === 'oee' && oeeData && !loading && (
        <div>
          {/* Avg OEE */}
          <div style={{ ...cardStyle, marginBottom: 20, textAlign: 'center', borderTop: '3px solid #3b82f6' }}>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>平均OEE ({startDate} ~ {endDate})</div>
            <div style={{ fontSize: 48, fontWeight: 800, color: oeeData.avg_oee >= 85 ? '#22c55e' : oeeData.avg_oee >= 60 ? '#eab308' : '#ef4444' }}>
              {oeeData.avg_oee}%
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              目标: 85% | {oeeData.avg_oee >= 85 ? '✅ 达标' : '⚠️ 未达标'}
            </div>
          </div>

          {/* OEE Table */}
          <div style={cardStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>设备OEE明细</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thStyle}>设备</th><th style={thStyle}>关键度</th><th style={thStyle}>OEE%</th>
                <th style={thStyle}>可用率%</th><th style={thStyle}>性能率%</th><th style={thStyle}>质量率%</th>
                <th style={thStyle}>工单数</th><th style={thStyle}>停机(分)</th>
              </tr></thead>
              <tbody>
                {(oeeData.equipment || []).map((e: any, i: number) => (
                  <tr key={i} style={{ background: e.oee < 60 ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
                    <td style={tdStyle}><b>{e.asset_code}</b> {e.name_zh}</td>
                    <td style={tdStyle}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: e.criticality === 'A' ? 'rgba(239,68,68,0.1)' : '#e2e8f0', color: e.criticality === 'A' ? '#ef4444' : '#64748b' }}>{e.criticality}</span>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 800, color: e.oee >= 85 ? '#22c55e' : e.oee >= 60 ? '#eab308' : '#ef4444' }}>{e.oee}%</td>
                    <td style={tdStyle}>{e.availability_pct}%</td>
                    <td style={tdStyle}>{Math.round(Number(e.performance) * 10000) / 100}%</td>
                    <td style={tdStyle}>{Math.round(Number(e.quality) * 10000) / 100}%</td>
                    <td style={tdStyle}>{e.wo_count}</td>
                    <td style={tdStyle}>{e.total_downtime_min}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
