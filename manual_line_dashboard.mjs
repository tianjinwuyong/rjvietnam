/**
 * manual_line_dashboard.mjs
 * 手动线 L004 实时 NG 看板 — HTTP 服务
 * 使用: node manual_line_dashboard.mjs
 * 访问: http://localhost:4000
 */
import { query, shutdown } from './services/_shared/db.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const PORT = 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'station_sync_state.json');

const STATION_META = {
  manu_ict:        { name: 'ICT',         ip: '192.168.6.91', icon: '⚡', order: 1 },
  manu_fct:        { name: 'FCT',         ip: '192.168.6.92', icon: '🔬', order: 2 },
  manu_depanel:    { name: '分板',        ip: '192.168.6.93', icon: '🔪', order: 3 },
  manu_shellbinding: { name: '外壳绑码',    ip: '192.168.6.94', icon: '🔗', order: 4 },
  manu_assem_ate:  { name: '组装ATE',     ip: '192.168.6.95', icon: '🛠️', order: 5 },
  manu_supersonic: { name: '超声',        ip: '192.168.6.96', icon: '📡', order: 6 },
  manu_agingcab:   { name: '老化柜',      ip: '192.168.6.97', icon: '⏳', order: 7 },
  manu_hivolt_ate: { name: '高压ATE',     ip: '192.168.6.98', icon: '⚡', order: 8 },
  manu_package_ate:{ name: '包装ATE',     ip: '192.168.6.99', icon: '📦', order: 9 },
  manu_aio:        { name: 'AOI',         ip: '192.168.6.90', icon: '🔍', order: 0 },
};

async function getDashboardData() {
  // Today's NG counts
  const ngR = await query(`
    SELECT station_code, COUNT(*)::int as cnt
    FROM ng_defect_records
    WHERE created_at >= CURRENT_DATE + INTERVAL '8 hours'
    GROUP BY station_code
    ORDER BY cnt DESC
  `);
  const ngMap = {};
  for (const r of ngR.rows) ngMap[r.station_code] = r.cnt;

  // Hourly breakdown (from 8AM to now)
  const hourlyR = await query(`
    SELECT station_code,
      to_char(created_at, 'YYYY-MM-DD HH24:00') as hour,
      COUNT(*)::int as cnt
    FROM ng_defect_records
    WHERE created_at >= CURRENT_DATE + INTERVAL '8 hours'
    GROUP BY station_code, hour
    ORDER BY hour, station_code
  `);

  // Last 20 NG records
  const lastR = await query(`
    SELECT to_char(created_at, 'HH24:MI:SS') as t,
      station_code, sn,
      defect_code, channel, error_code
    FROM ng_defect_records
    WHERE created_at >= CURRENT_DATE + INTERVAL '8 hours'
    ORDER BY created_at DESC
    LIMIT 20
  `);

  // Read sync state
  let syncState = {};
  try { syncState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch {}

  // Total today
  const totalR = await query(`
    SELECT COUNT(*)::int as total_today
    FROM ng_defect_records WHERE created_at >= CURRENT_DATE + INTERVAL '8 hours'
  `);
  const totalToday = totalR.rows[0]?.total_today ?? 0;

  return { ngMap, hourlyR: hourlyR.rows, lastR: lastR.rows, syncState, totalToday };
}

function buildHtml(data) {
  const { ngMap, hourlyR, lastR, totalToday } = data;

  // Split AOI vs other stations
  const allStations = Object.entries(STATION_META)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([code, meta]) => {
      const cnt = ngMap[code] ?? 0;
      return { code, ...meta, cnt };
    });
  const aoi = allStations.find(s => s.code === 'manu_aio');
  const stations = allStations.filter(s => s.code !== 'manu_aio');

  const maxNonAoi = Math.max(1, ...stations.map(s => s.cnt));
  const cntAoi = aoi?.cnt ?? 0;
  const totalNonAoi = stations.reduce((s, x) => s + x.cnt, 0);

  // Annotate stations with cls/pct relative to max
  for (const s of stations) {
    s.cls = s.cnt === 0 ? 'ok' : s.cnt > 100 ? 'bad' : s.cnt > 10 ? 'warn' : 'ok';
    s.pct = maxNonAoi > 1 ? ((s.cnt / maxNonAoi) * 100).toFixed(1) : '0';
  }

  // Build hourly chart data (exclude AOI or show separate)
  const nonAoiHourly = hourlyR.filter(r => r.station_code !== 'manu_aio');
  const hours = [...new Set(nonAoiHourly.map(r => r.hour))].sort().slice(-8);
  const stationCodes = stations.map(s => s.code);

  const hourRows = hours.map(h => {
    const cols = stationCodes.map(sc => {
      const found = nonAoiHourly.find(r => r.station_code === sc && r.hour === h);
      return found ? found.cnt : 0;
    });
    return { hour: h.slice(-5), cols };
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>手动线 L004 NG 看板</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0f172a; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; padding: 20px; }
  h1 { font-size: 24px; font-weight: 700; background: linear-gradient(90deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 4px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
  .header .sub { color: #94a3b8; font-size: 13px; }
  .header .clock { font-family: monospace; color: #64748b; font-size: 14px; }
  .total-bar { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 16px 24px; margin-bottom: 20px; display: flex; gap: 30px; align-items: center; flex-wrap: wrap; }
  .total-bar .big { font-size: 36px; font-weight: 800; color: #f87171; }
  .total-bar .lbl { font-size: 12px; color: #94a3b8; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #1e293b; border: 1.5px solid #334155; border-radius: 12px; padding: 16px; text-align: center; transition: all 0.2s; }
  .card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(56,189,248,0.1); }
  .card .icon { font-size: 28px; margin-bottom: 4px; }
  .card h3 { font-size: 14px; font-weight: 600; color: #f1f5f9; }
  .card .ip { font-size: 10px; color: #facc15; font-family: monospace; margin-top: 2px; }
  .card .cnt { font-size: 32px; font-weight: 800; margin: 6px 0; }
  .card .cnt.ok { color: #4ade80; }
  .card .cnt.warn { color: #fbbf24; }
  .card .cnt.bad { color: #f87171; }
  .card .pct { font-size: 10px; color: #64748b; }
  .card .bar-wrap { background: #0f172a; border-radius: 4px; height: 6px; margin-top: 6px; overflow: hidden; }
  .card .bar { height: 100%; border-radius: 4px; transition: width 0.5s; }
  .card .bar.ok { background: #4ade80; }
  .card .bar.warn { background: #fbbf24; }
  .card .bar.bad { background: #f87171; }
  .section { margin: 20px 0 10px; display: flex; align-items: center; gap: 8px; }
  .section h2 { font-size: 16px; font-weight: 600; color: #e2e8f0; }
  .section small { color: #64748b; font-weight: 400; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; }
  th { background: #1e293b; color: #94a3b8; font-weight: 600; padding: 8px 12px; text-align: left; border-bottom: 2px solid #334155; position: sticky; top: 0; }
  td { padding: 8px 12px; border-bottom: 1px solid #1e293b; }
  tr:hover td { background: rgba(56,189,248,0.03); }
  .num { font-family: monospace; text-align: right; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 10px; font-weight: 500; }
  .badge.ok { background: rgba(34,197,94,0.15); color: #4ade80; }
  .badge.warn { background: rgba(245,158,11,0.15); color: #fbbf24; }
  .badge.ng { background: rgba(239,68,68,0.15); color: #f87171; }
  .footer { text-align: center; padding: 20px 0; color: #475569; font-size: 11px; }
  .chart-table th { font-size: 10px; padding: 6px 8px; text-align: center; }
  .chart-table td { font-size: 10px; padding: 6px 8px; text-align: center; }
  .chart-table td:first-child { text-align: left; color: #94a3b8; font-weight: 600; }
  .max-col { color: #f87171; font-weight: 700; }
  @media (max-width: 600px) { .grid { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>🏭 手动线 L004 — NG 实时看板</h1>
    <div class="sub">越南工厂瑞晶 · Station Sync NG Monitoring</div>
  </div>
  <div class="clock" id="clock"></div>
</div>

<div class="total-bar">
  <div>
    <div class="big">${totalToday}</div>
    <div class="lbl">今日 NG (8:00~)</div>
  </div>
  <div>
    <div style="font-size:36px;font-weight:800;color:#f87171">${totalNonAoi}</div>
    <div class="lbl">手动线 NG (8:00~, 不含AOI)</div>
  </div>
  <div>
    <div style="font-size:24px;font-weight:700;color:${stations.filter(s => s.cnt > 0).length > 0 ? '#f87171' : '#4ade80'}">${stations.filter(s => s.cnt > 0).length}/${stations.length}</div>
    <div class="lbl">手动线 NG 工站</div>
  </div>
</div>

<!-- AOI 单独卡 -->
<div class="card" style="grid-column:1/-1;border-color:#f59e0b;background:#1c1408;margin-bottom:4px">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:28px">🔍</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:#f1f5f9">AOI (手动AOI)</div>
        <div class="ip">192.168.6.90 · MySQL 直连</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:20px">
      <div style="text-align:right">
        <div style="font-size:32px;font-weight:800;color:#f87171">${cntAoi.toLocaleString()}</div>
        <div style="font-size:11px;color:#94a3b8">今日 NG</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:32px;font-weight:800;color:#fbbf24">${totalToday > 0 ? ((cntAoi / totalToday) * 100).toFixed(1) : '0'}%</div>
        <div style="font-size:11px;color:#94a3b8">占总 NG 比例</div>
      </div>
    </div>
  </div>
</div>

<!-- 其他 9 站 -->
<div class="section"><h2>🧩 手动线工站 NG</h2> <small>（不含 AOI）</small></div>
<div class="grid">
  ${stations.map(s => `
    <div class="card">
      <div class="icon">${s.icon}</div>
      <h3>${s.name}</h3>
      <div class="ip">${s.ip}</div>
      <div class="cnt ${s.cls}">${s.cnt}</div>
      <div class="pct">${s.pct}% of total</div>
      <div class="bar-wrap"><div class="bar ${s.cls}" style="width:${s.pct}%"></div></div>
    </div>
  `).join('')}
</div>

<div class="section"><h2>📊 近 8 小时 NG 趋势</h2></div>
<table class="chart-table">
  <thead><tr><th>时间</th>${stationCodes.map(c => `<th>${STATION_META[c].name}</th>`).join('')}</tr></thead>
  <tbody>
    ${hourRows.map(r => {
      const maxVal = Math.max(...r.cols, 1);
      return `<tr><td>${r.hour}</td>${r.cols.map((c, i) => `<td class="${c === maxVal && c > 0 ? 'max-col' : ''}">${c > 0 ? c : '—'}</td>`).join('')}</tr>`;
    }).join('')}
  </tbody>
</table>

<div class="section"><h2>📋 最新 NG 记录</h2> <small>(近 20 条)</small></div>
<table>
  <thead><tr><th>时间</th><th>工站</th><th>SN</th><th>缺陷</th><th>通道</th><th>错误码</th></tr></thead>
  <tbody>
    ${lastR.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px">暂无 NG 记录</td></tr>' :
      lastR.map(r => `<tr><td>${r.t}</td><td><span class="badge ${r.station_code.includes('aio') ? 'ng' : 'warn'}">${STATION_META[r.station_code]?.name ?? r.station_code}</span></td><td style="font-family:monospace;color:#facc15">${r.sn}</td><td>${r.defect_code || '—'}</td><td>${r.channel || '—'}</td><td>${r.error_code || '—'}</td></tr>`).join('')}
  </tbody>
</table>

<div class="footer" id="footer">
  自动刷新每 30 秒 · SMT Factory MES · 越南工厂瑞晶
</div>

<script>
function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleString('zh-CN', { hour12: false });
}
updateClock();
setInterval(updateClock, 1000);
setTimeout(() => location.reload(), 30000);
</script>
</body>
</html>`;
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    try {
      const data = await getDashboardData();
      const html = buildHtml(data);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error: ' + e.message);
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`🏭 手动线 L004 NG 看板: http://localhost:${PORT}`);
});

process.on('SIGINT', () => { shutdown(); process.exit(); });
process.on('SIGTERM', () => { shutdown(); process.exit(); });
