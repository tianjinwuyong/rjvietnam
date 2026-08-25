import { useState, useEffect, useCallback } from 'react';
import { maintenanceApi } from '../api/maintenance';

// ═══ 设备健康度 + OEE 实时看板 ═══

const GRADE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  A: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', label: '优秀' },
  B: { color: '#84cc16', bg: 'rgba(132,204,22,0.12)', label: '良好' },
  C: { color: '#eab308', bg: 'rgba(234,179,8,0.12)', label: '一般' },
  D: { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: '较差' },
  F: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: '危险' },
};

export default function EquipmentHealth() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lineFilter, setLineFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [sortBy, setSortBy] = useState<'health' | 'criticality' | 'failures'>('health');
  const [selected, setSelected] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (lineFilter) params.lineId = lineFilter;
      const res = await maintenanceApi.getHealth(params);
      if (res.success) setData(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [lineFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading && !data) return <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>加载健康度数据...</div>;

  const summary = data?.summary || {};
  const allEquipment = data?.data || [];
  const criticalAlerts = data?.critical_alerts || [];

  // Filter + sort
  let filtered = allEquipment;
  if (gradeFilter) filtered = filtered.filter((e: any) => e.grade === gradeFilter);
  filtered = [...filtered].sort((a: any, b: any) => {
    if (sortBy === 'health') return a.health_score - b.health_score;
    if (sortBy === 'failures') return (b.failures_90d || 0) - (a.failures_90d || 0);
    return (a.criticality || 'Z').localeCompare(b.criticality || 'Z');
  });

  const lines = Array.from(new Set(allEquipment.map((e: any) => e.line_code).filter(Boolean))).sort() as string[];

  // Score bar component
  const ScoreBar = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 3 }}>
        <span>{label}</span><span style={{ fontWeight: 700, color }}>{value}</span>
      </div>
      <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 3, transition: 'width 0.5s' }} />
      </div>
    </div>
  );

  return (
    <div style={{ padding: 20, fontFamily: "'Segoe UI',system-ui,sans-serif", background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', margin: 0 }}>🏥 设备健康度看板</h2>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>综合评分 = 可用率40% + 可靠性30% + 保养合规20% + 设备年龄10%</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={lineFilter} onChange={e => setLineFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
            <option value="">全部产线</option>
            {lines.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
            <option value="">全部等级</option>
            {Object.entries(GRADE_CONFIG).map(([g, c]) => <option key={g} value={g}>{g} - {c.label}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
            <option value="health">按健康度↑</option>
            <option value="criticality">按关键度</option>
            <option value="failures">按故障数↓</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>平均健康度</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: summary.avg_health >= 75 ? '#22c55e' : summary.avg_health >= 60 ? '#eab308' : '#ef4444' }}>{summary.avg_health || 0}</div>
        </div>
        {Object.entries(GRADE_CONFIG).map(([g, c]) => (
          <div key={g} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: `2px solid ${c.color}22` }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{g}级 ({c.label})</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: c.color }}>{summary.grade_distribution?.[g] || 0}</div>
          </div>
        ))}
      </div>

      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444', marginBottom: 10 }}>🚨 关键设备告警 ({criticalAlerts.length})</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {criticalAlerts.map((a: any) => (
              <div key={a.id} style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}
                onClick={() => setSelected(a)}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{a.asset_code}</div>
                <div style={{ fontSize: 11, color: '#ef4444' }}>健康度 {a.health_score} | {a.failures_90d}次故障/90天</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Equipment Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {filtered.map((e: any) => {
          const gc = GRADE_CONFIG[e.grade] || GRADE_CONFIG.C;
          return (
            <div key={e.id} onClick={() => setSelected(e)} style={{
              background: '#fff', borderRadius: 12, padding: 16, cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: `2px solid ${gc.color}33`,
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
              onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (ev.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; }}
              onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.transform = ''; (ev.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'; }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{e.asset_code}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{e.name_zh || e.category_name}</div>
                </div>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: gc.bg, border: `3px solid ${gc.color}`, fontSize: 18, fontWeight: 800, color: gc.color,
                }}>{e.health_score}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: gc.bg, color: gc.color, fontWeight: 600 }}>{e.grade}级 {gc.label}</span>
                {e.criticality === 'A' && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>关键设备</span>}
                {e.open_wos > 0 && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(249,115,22,0.1)', color: '#f97316' }}>{e.open_wos}个工单</span>}
                {e.failures_90d > 0 && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(234,179,8,0.1)', color: '#eab308' }}>{e.failures_90d}次故障</span>}
              </div>
              <ScoreBar label="可用率" value={e.availability_score} color="#3b82f6" />
              <ScoreBar label="可靠性" value={e.reliability_score} color="#22c55e" />
              <ScoreBar label="保养合规" value={e.maintenance_score} color="#8b5cf6" />
              <ScoreBar label="设备年龄" value={e.age_score} color="#f97316" />
            </div>
          );
        })}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setSelected(null)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 500, maxHeight: '80vh', overflow: 'auto' }}
            onClick={ev => ev.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>{selected.asset_code}</div>
                <div style={{ fontSize: 13, color: '#64748b' }}>{selected.name_zh || selected.category_name}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 80, height: 80, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: (GRADE_CONFIG[selected.grade] || GRADE_CONFIG.C).bg,
                border: `4px solid ${(GRADE_CONFIG[selected.grade] || GRADE_CONFIG.C).color}`,
                fontSize: 28, fontWeight: 800, color: (GRADE_CONFIG[selected.grade] || GRADE_CONFIG.C).color,
              }}>{selected.health_score}</div>
              <div style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>
                {(GRADE_CONFIG[selected.grade] || GRADE_CONFIG.C).label} | 产线: {selected.line_code || '-'}
              </div>
            </div>
            <ScoreBar label="可用率 (40%)" value={selected.availability_score} color="#3b82f6" />
            <ScoreBar label="可靠性 (30%)" value={selected.reliability_score} color="#22c55e" />
            <ScoreBar label="保养合规 (20%)" value={selected.maintenance_score} color="#8b5cf6" />
            <ScoreBar label="设备年龄 (10%)" value={selected.age_score} color="#f97316" />
            <div style={{ marginTop: 16, padding: 14, background: '#f8fafc', borderRadius: 10, fontSize: 13, color: '#475569' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>90天故障: <b>{selected.failures_90d || 0}次</b></div>
                <div>平均停机: <b>{selected.avg_downtime_90d || 0}分钟</b></div>
                <div>PM合规率: <b>{selected.pm_compliance != null ? selected.pm_compliance + '%' : 'N/A'}</b></div>
                <div>活跃工单: <b>{selected.open_wos || 0}个</b></div>
                <div>累计运行: <b>{Math.round(Number(selected.cumulative_runtime_hours) || 0)}h</b></div>
                <div>总维修次数: <b>{selected.total_repair_count || 0}</b></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
