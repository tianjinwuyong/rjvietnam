import { useState, useEffect, useCallback, useRef } from 'react';
import { maintenanceApi } from '../api/maintenance';

// ═══ Andon 实时状态大屏 ═══
const STATUS_MAP: Record<string, { label: string; color: string; bg: string; pulse?: boolean }> = {
  active:    { label: '运行中', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  online:    { label: '在线',   color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  idle:      { label: '待机',   color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
  offline:   { label: '离线',   color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  maintenance: { label: '保养中', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  fault:     { label: '故障',   color: '#ef4444', bg: 'rgba(239,68,68,0.2)', pulse: true },
  repair:    { label: '维修中', color: '#f97316', bg: 'rgba(249,115,22,0.2)', pulse: true },
  scrapped:  { label: '报废',   color: '#374151', bg: 'rgba(55,65,81,0.1)' },
};
const URGENCY_MAP: Record<string, { label: string; color: string }> = {
  line_down:    { label: '停线', color: '#ef4444' },
  speed_reduced:{ label: '降速', color: '#f97316' },
  can_continue: { label: '可继续', color: '#eab308' },
  normal:       { label: '一般', color: '#6b7280' },
};

interface AndonData {
  timestamp: string; equipment: any[]; alerts: any[]; pm_today: any[];
  stats: { total: number; running: number; fault: number; maintenance: number; idle: number; active_alerts: number };
}

export default function AndonBoard() {
  const [data, setData] = useState<AndonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [interval_, setInterval_] = useState(10);
  const [fullscreen, setFullscreen] = useState(false);
  const [lineFilter, setLineFilter] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const alertScrollRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const params: any = {};
      if (lineFilter) params.lineId = lineFilter;
      const res = await maintenanceApi.getAndon(params);
      if (res.success) {
        setData(res); setLastRefresh(new Date());
        const ls = new Set<string>();
        res.equipment?.forEach((e: any) => { if (e.line_code) ls.add(e.line_code); });
        setLines(Array.from(ls).sort());
      }
    } catch (e) { console.error('Andon fetch error:', e); }
    setLoading(false);
  }, [lineFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const t = setInterval(fetchData, interval_ * 1000); return () => clearInterval(t); }, [fetchData, interval_]);

  // Alert auto-scroll
  useEffect(() => {
    const el = alertScrollRef.current;
    if (!el || !data?.alerts?.length) return;
    let pos = 0;
    const anim = setInterval(() => { pos += 0.5; if (pos >= el.scrollHeight - el.clientHeight) pos = 0; el.scrollTop = pos; }, 50);
    return () => clearInterval(anim);
  }, [data?.alerts]);

  const toggleFS = () => {
    if (!document.fullscreenElement) { containerRef.current?.requestFullscreen(); setFullscreen(true); }
    else { document.exitFullscreen(); setFullscreen(false); }
  };

  if (loading && !data) return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#0a0e1a',color:'#64748b' }}>
      <div style={{ textAlign:'center' }}><div style={{ fontSize:48,marginBottom:16 }}>⚙️</div><div>加载Andon数据...</div></div>
    </div>
  );

  const stats = data?.stats || { total:0, running:0, fault:0, maintenance:0, idle:0, active_alerts:0 };
  const equipment = data?.equipment || [];
  const alerts = data?.alerts || [];
  const pmToday = data?.pm_today || [];
  const byLine: Record<string, any[]> = {};
  equipment.forEach(e => { const k = e.line_code || '未分配'; if (!byLine[k]) byLine[k] = []; byLine[k].push(e); });

  return (
    <div ref={containerRef} style={{ background:'linear-gradient(135deg,#0a0e1a 0%,#111827 50%,#0a0e1a 100%)',color:'#e2e8f0',minHeight:'100vh',fontFamily:"'Segoe UI',system-ui,sans-serif",overflow:'hidden',position:'relative' }}>
      {/* Header */}
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 24px',borderBottom:'1px solid rgba(148,163,184,0.1)',background:'rgba(15,23,42,0.8)',backdropFilter:'blur(10px)' }}>
        <div style={{ display:'flex',alignItems:'center',gap:16 }}>
          <span style={{ fontSize:28,fontWeight:800,background:'linear-gradient(90deg,#3b82f6,#8b5cf6)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent' }}>🏭 瑞晶SMT Andon</span>
          <span style={{ fontSize:13,color:'#64748b' }}>{lastRefresh.toLocaleTimeString('zh-CN')} | {interval_}s</span>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:12 }}>
          <select value={lineFilter} onChange={e=>setLineFilter(e.target.value)} style={{ background:'rgba(30,41,59,0.8)',border:'1px solid rgba(148,163,184,0.2)',borderRadius:6,color:'#e2e8f0',padding:'6px 12px',fontSize:13 }}>
            <option value="">全部产线</option>
            {lines.map(l=><option key={l} value={l}>{l}</option>)}
          </select>
          <select value={interval_} onChange={e=>setInterval_(Number(e.target.value))} style={{ background:'rgba(30,41,59,0.8)',border:'1px solid rgba(148,163,184,0.2)',borderRadius:6,color:'#e2e8f0',padding:'6px 12px',fontSize:13 }}>
            <option value={5}>5s</option><option value={10}>10s</option><option value={30}>30s</option><option value={60}>60s</option>
          </select>
          <button onClick={toggleFS} style={{ background:'rgba(59,130,246,0.2)',border:'1px solid rgba(59,130,246,0.4)',borderRadius:6,color:'#93c5fd',padding:'6px 14px',fontSize:13,cursor:'pointer' }}>
            {fullscreen ? '⊡ 退出' : '⊞ 全屏'}
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div style={{ display:'flex',gap:16,padding:'16px 24px' }}>
        {[
          { label:'设备总数', value:stats.total, color:'#94a3b8', icon:'🔧' },
          { label:'运行中', value:stats.running, color:'#22c55e', icon:'✅' },
          { label:'故障/维修', value:stats.fault, color:'#ef4444', icon:'🚨' },
          { label:'保养中', value:stats.maintenance, color:'#3b82f6', icon:'🛠️' },
          { label:'待机/离线', value:stats.idle, color:'#eab308', icon:'⏸️' },
          { label:'活跃告警', value:stats.active_alerts, color:stats.active_alerts>0?'#ef4444':'#22c55e', icon:'⚠️' },
        ].map((s,i)=>(
          <div key={i} style={{ flex:1,background:'rgba(30,41,59,0.6)',borderRadius:12,padding:'16px 20px',border:`1px solid ${s.color}22`,textAlign:'center',boxShadow:s.value>0&&s.label==='活跃告警'?`0 0 20px ${s.color}33`:'none' }}>
            <div style={{ fontSize:13,color:'#94a3b8',marginBottom:4 }}>{s.icon} {s.label}</div>
            <div style={{ fontSize:36,fontWeight:800,color:s.color,lineHeight:1 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Main: Equipment Grid + Alerts Sidebar */}
      <div style={{ display:'flex',gap:16,padding:'0 24px 24px',height:'calc(100vh - 200px)' }}>
        {/* Equipment Grid */}
        <div style={{ flex:1,overflow:'auto' }}>
          {Object.entries(byLine).map(([line, equips])=>(
            <div key={line} style={{ marginBottom:20 }}>
              <div style={{ fontSize:15,fontWeight:700,color:'#93c5fd',marginBottom:10,display:'flex',alignItems:'center',gap:8 }}>
                <span style={{ width:4,height:18,background:'#3b82f6',borderRadius:2,display:'inline-block' }} />
                {line} ({equips.length}台)
              </div>
              <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10 }}>
                {equips.map((e:any)=>{
                  const st = STATUS_MAP[e.status] || STATUS_MAP.offline;
                  return (
                    <div key={e.id} style={{ background:st.bg,borderRadius:10,padding:'12px 14px',border:`1px solid ${st.color}44`,animation:st.pulse?'andonPulse 1.5s ease-in-out infinite':'none',position:'relative',overflow:'hidden' }}>
                      <div style={{ position:'absolute',top:10,right:10,width:12,height:12,borderRadius:'50%',background:st.color,boxShadow:st.pulse?`0 0 12px ${st.color}`:`0 0 6px ${st.color}66` }} />
                      <div style={{ fontSize:13,fontWeight:700,color:'#f1f5f9',marginBottom:4 }}>{e.asset_code}</div>
                      <div style={{ fontSize:12,color:'#94a3b8',marginBottom:6 }}>{e.name_zh || e.category_name}</div>
                      <div style={{ display:'flex',alignItems:'center',gap:6 }}>
                        <span style={{ fontSize:11,padding:'2px 8px',borderRadius:4,background:`${st.color}22`,color:st.color,fontWeight:600 }}>{st.label}</span>
                        {e.criticality==='A'&&<span style={{ fontSize:10,padding:'1px 6px',borderRadius:3,background:'rgba(239,68,68,0.2)',color:'#fca5a5' }}>关键</span>}
                      </div>
                      {e.active_wo&&(
                        <div style={{ marginTop:6,fontSize:11,color:'#fbbf24',display:'flex',alignItems:'center',gap:4 }}>
                          <span>🔧</span><span style={{ overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{e.active_wo}: {e.active_fault}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Right Sidebar */}
        <div style={{ width:340,display:'flex',flexDirection:'column',gap:16 }}>
          {/* Alerts */}
          <div style={{ flex:1,background:'rgba(30,41,59,0.6)',borderRadius:12,border:'1px solid rgba(239,68,68,0.2)',overflow:'hidden',display:'flex',flexDirection:'column' }}>
            <div style={{ padding:'12px 16px',borderBottom:'1px solid rgba(148,163,184,0.1)',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
              <span style={{ fontSize:14,fontWeight:700,color:'#fca5a5' }}>🚨 活跃告警 ({alerts.length})</span>
              {alerts.length>0&&<span style={{ width:8,height:8,borderRadius:'50%',background:'#ef4444',animation:'andonPulse 1s infinite' }} />}
            </div>
            <div ref={alertScrollRef} style={{ flex:1,overflow:'hidden',padding:'8px 12px' }}>
              {alerts.length===0 ? (
                <div style={{ textAlign:'center',color:'#4ade80',padding:40,fontSize:14 }}>✅ 无活跃告警</div>
              ) : alerts.map((a:any)=>{
                const urg = URGENCY_MAP[a.urgency_level] || URGENCY_MAP.normal;
                return (
                  <div key={a.id} style={{ padding:'10px 12px',marginBottom:8,borderRadius:8,background:`${urg.color}11`,border:`1px solid ${urg.color}33` }}>
                    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4 }}>
                      <span style={{ fontSize:12,fontWeight:700,color:urg.color }}>{urg.label}</span>
                      <span style={{ fontSize:11,color:'#64748b' }}>{a.wo_no}</span>
                    </div>
                    <div style={{ fontSize:12,color:'#e2e8f0',marginBottom:2 }}>{a.equipment_name} ({a.asset_code})</div>
                    <div style={{ fontSize:11,color:'#94a3b8' }}>{a.fault_description}</div>
                    <div style={{ fontSize:10,color:'#64748b',marginTop:4 }}>
                      {a.assigned_technician?`👤 ${a.assigned_technician}`:'⏳ 待派工'} | {new Date(a.issue_time).toLocaleString('zh-CN',{hour:'2-digit',minute:'2-digit'})}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* PM Today */}
          <div style={{ background:'rgba(30,41,59,0.6)',borderRadius:12,border:'1px solid rgba(59,130,246,0.2)',maxHeight:200,overflow:'hidden' }}>
            <div style={{ padding:'12px 16px',borderBottom:'1px solid rgba(148,163,184,0.1)' }}>
              <span style={{ fontSize:14,fontWeight:700,color:'#93c5fd' }}>🛠️ 今日保养 ({pmToday.length})</span>
            </div>
            <div style={{ padding:'8px 12px',overflow:'auto',maxHeight:150 }}>
              {pmToday.length===0 ? (
                <div style={{ textAlign:'center',color:'#64748b',padding:20,fontSize:13 }}>今日无保养计划</div>
              ) : pmToday.map((p:any)=>(
                <div key={p.id} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 8px',marginBottom:4,borderRadius:6,background:p.result==='completed'?'rgba(34,197,94,0.1)':'rgba(234,179,8,0.1)' }}>
                  <span style={{ fontSize:12,color:'#e2e8f0' }}>{p.equipment_name}</span>
                  <span style={{ fontSize:11,padding:'1px 8px',borderRadius:4,background:p.result==='completed'?'rgba(34,197,94,0.2)':'rgba(234,179,8,0.2)',color:p.result==='completed'?'#4ade80':'#fbbf24' }}>
                    {p.result==='completed'?'✓ 完成':'⏳ 待执行'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes andonPulse { 0%,100%{opacity:1} 50%{opacity:0.6} }`}</style>
    </div>
  );
}
