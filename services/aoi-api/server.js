// AOI Quality Dashboard API Server
// Connects to MySQL at 192.168.6.50:3306 (root/root1234) -> database: pcb_detection
// Runs on port 6309

import express from 'express';
import mysql from 'mysql2/promise';

const app = express();
const PORT = 6309;
const DB = 'pcb_detection';

let pool = null;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: '192.168.6.50',
      port: 3306,
      user: 'root',
      password: 'root1234',
      database: DB,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
    });
  }
  return pool;
}

async function getMetaPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: '192.168.6.50',
      port: 3306,
      user: 'root',
      password: 'root1234',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
  }
  return pool;
}

async function query(sql, params = []) {
  try {
    const p = await getPool();
    const [rows] = await p.query(sql, params);
    return rows;
  } catch (err) {
    console.error('[MySQL Error]', err.message);
    return [];
  }
}

app.use(express.json());

// Helper: parse date filters
function parseDates(q) {
  const startDate = q.start_date || null;
  const endDate = q.end_date || null;
  return { startDate, endDate };
}

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    let sql = `SELECT COUNT(*) as board_count, SUM(\`ng\`) as total_ng, SUM(\`good\`) as total_good, SUM(\`total\`) as total_components FROM \`${DB}\`.\`detection_board\` WHERE del_flag=0`;
    const params = [];
    if (startDate) { sql += ' AND DATE(finish_time) >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND DATE(finish_time) <= ?'; params.push(endDate); }
    const rows = await query(sql, params);
    const stats = rows[0] || { board_count: 0, total_ng: 0, total_good: 0, total_components: 0 };
    const board_count = Number(stats.board_count) || 0;
    const total_ng = Number(stats.total_ng) || 0;
    const total_good = Number(stats.total_good) || 0;
    const total_components = Number(stats.total_components) || 0;
    const pass_rate = board_count > 0 ? Math.round(total_good / board_count * 1000) / 10 : 0;
    const ng_rate = board_count > 0 ? Math.round(total_ng / board_count * 1000) / 10 : 0;
    const dpu = board_count > 0 ? (total_components / board_count).toFixed(3) : 0;
    // DPPM = NG × 1M ÷ (board_count × 18子板 × 12子板数 × 125点位)
    const BOARD_POINTS = 18;
    const SUB_PANELS = 12;
    const POINTS_PER_SUB = 125;
    const opportunities = board_count * BOARD_POINTS * SUB_PANELS * POINTS_PER_SUB;
    const dppm = opportunities > 0 ? Math.round(total_ng / opportunities * 1000000) : 0;
    res.json({ board_count, total_ng, total_good, total_components, pass_rate, ng_rate, dppm, dpu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/defect_dist — defect type distribution from detection_board columns
app.get('/api/defect_dist', async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const defectTypes = [
      ['少锡/缺锡', 'less_tin'],
      ['半焊', 'half_weld'],
      ['漏件/少件', 'miss'],
      ['多件/连锡', 'lian_tin'],
      ['方向错误', 'error_direction'],
      ['异物/污染', 'foreign_material'],
      ['孔异常', 'hole'],
      ['引脚弯曲', 'pin_bend'],
      ['其他', 'other'],
    ];
    const whereParts = ['del_flag=0'];
    const params = [];
    if (startDate) { whereParts.push('DATE(finish_time) >= ?'); params.push(startDate); }
    if (endDate) { whereParts.push('DATE(finish_time) <= ?'); params.push(endDate); }
    const where = whereParts.join(' AND ');
    const defectSql = defectTypes.map(([name, col]) =>
      `SELECT '${name}' as defect_code, COALESCE(SUM(\`${col}\`),0) as \`count\` FROM \`${DB}\`.\`detection_board\` WHERE ${where}`
    ).join(' UNION ALL ');
    const rows = await query(defectSql, params);
    const filtered = rows.filter(r => Number(r.count) > 0);
    filtered.sort((a, b) => Number(b.count) - Number(a.count));
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/defect_pareto
app.get('/api/defect_pareto', async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const defectTypes = [
      ['少锡/缺锡', 'less_tin'],
      ['半焊', 'half_weld'],
      ['漏件/少件', 'miss'],
      ['多件/连锡', 'lian_tin'],
      ['方向错误', 'error_direction'],
      ['异物/污染', 'foreign_material'],
      ['孔异常', 'hole'],
      ['引脚弯曲', 'pin_bend'],
      ['其他', 'other'],
    ];
    const whereParts = ['del_flag=0'];
    const params = [];
    if (startDate) { whereParts.push('DATE(finish_time) >= ?'); params.push(startDate); }
    if (endDate) { whereParts.push('DATE(finish_time) <= ?'); params.push(endDate); }
    const where = whereParts.join(' AND ');
    const defectSql = defectTypes.map(([name, col]) =>
      `SELECT '${name}' as defect_code, COALESCE(SUM(\`${col}\`),0) as \`count\` FROM \`${DB}\`.\`detection_board\` WHERE ${where}`
    ).join(' UNION ALL ');
    const rows = await query(defectSql, params);
    const filtered = rows.filter(r => Number(r.count) > 0);
    filtered.sort((a, b) => Number(b.count) - Number(a.count));
    res.json(filtered.slice(0, 10));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/defect_comp — not available in this schema
app.get('/api/defect_comp', async (req, res) => {
  res.json([]);
});

// GET /api/false_alarm — not available in this schema
app.get('/api/false_alarm', async (req, res) => {
  res.json([]);
});

// GET /api/trend
app.get('/api/trend', async (req, res) => {
  try {
    const { startDate, endDate } = parseDates(req.query);
    const whereParts = ['del_flag=0'];
    const params = [];
    if (startDate) { whereParts.push('DATE(finish_time) >= ?'); params.push(startDate); }
    if (endDate) { whereParts.push('DATE(finish_time) <= ?'); params.push(endDate); }
    const where = whereParts.join(' AND ');
    const sql = `SELECT DATE(finish_time) as date,
      COUNT(*) as boards,
      SUM(\`ng\`) as ng,
      SUM(\`good\`) as good
    FROM \`${DB}\`.\`detection_board\`
    WHERE ${where} AND finish_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY DATE(finish_time)
    ORDER BY date ASC`;
    const rows = await query(sql, params);
    const result = rows.map(r => ({
      date: r.date,
      boards: Number(r.boards) || 0,
      ng: Number(r.ng) || 0,
      good: Number(r.good) || 0,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/boards
app.get('/api/boards', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const limit = Number(req.query.limit) || 200;
    const whereParts = ['del_flag=0'];
    const params = [];
    if (startDate) { whereParts.push('DATE(finish_time) >= ?'); params.push(startDate); }
    if (endDate) { whereParts.push('DATE(finish_time) <= ?'); params.push(endDate); }
    const where = whereParts.join(' AND ');
    const sql = `SELECT id, \`number\` as board_no, template_name, \`total\` as total_components, \`ng\` as ng_count, \`good\` as pass_count, finish_time as create_time
    FROM \`${DB}\`.\`detection_board\`
    WHERE ${where}
    ORDER BY finish_time DESC
    LIMIT ?`;
    params.push(limit);
    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/templates
app.get('/api/templates', async (req, res) => {
  try {
    const sql = `SELECT id, name FROM \`${DB}\`.\`template\` ORDER BY name`;
    const rows = await query(sql);
    res.json(rows.map(r => ({ id: r.id, name: r.name })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DB Browser endpoints
// GET /api/db/databases
app.get('/api/db/databases', async (req, res) => {
  try {
    const p = await getMetaPool();
    const [rows] = await p.query('SHOW DATABASES');
    res.json(rows.map(r => r.Database));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/tables?db=pcb_detection
app.get('/api/db/tables', async (req, res) => {
  try {
    const { db } = req.query;
    const p = await getMetaPool();
    const [rows] = await p.query(`SHOW TABLES FROM \`${db || DB}\``);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/data?db=pcb_detection&table=detection_board
app.get('/api/db/data', async (req, res) => {
  try {
    const { db, table, limit = 100, offset = 0 } = req.query;
    const p = await getMetaPool();
    const safeDb = db || DB;
    const safeTable = table || 'detection_board';
    const [rows] = await p.query(`SELECT * FROM \`${safeDb}\`.\`${safeTable}\` LIMIT ? OFFSET ?`, [Number(limit), Number(offset)]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/structure?db=pcb_detection&table=detection_board
app.get('/api/db/structure', async (req, res) => {
  try {
    const { db, table } = req.query;
    const p = await getMetaPool();
    const [rows] = await p.query(`DESCRIBE \`${db || DB}\`.\`${table}\``);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'aoi-api', mysql: '192.168.6.50:3306', database: DB });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[AOI API] Server running on http://0.0.0.0:${PORT}`);
  console.log(`[AOI API] MySQL: 192.168.6.50:3306, DB: ${DB}`);
});
