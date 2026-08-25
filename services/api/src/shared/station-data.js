// ── Station data source config + query functions ────────────────────
// All manual-line station data sources (dir, mysql, excel)

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import XLSX from "xlsx";

export const STATION_DATA_SOURCES = {
  manu_aio:           { type: "mysql",     label: "AOI",         host: "192.168.6.50",  port: 3306,  user: "root",     password: "root1234",  database: "pcb_detection" },
  manu_ict:           { type: "dir",       label: "ICT",         path: "\\\\192.168.6.91\\D$\\SRC" },
  manu_fct:           { type: "dir",       label: "FCT",         path: "\\\\192.168.6.92\\D$\\ATS\\测试报表" },
  manu_depanel:       { type: "dir",       label: "分板机",       path: "\\\\192.168.6.93\\D$\\ATS\\测试报表" },
  manu_shellbinding:  { type: "dir",       label: "绑码",         path: "\\\\192.168.6.94\\D$\\ATS\\测试报表" },
  manu_assem_ate:     { type: "dir",       label: "组装ATE",     path: "\\\\192.168.6.95\\D$\\ATS\\测试报表" },
  manu_supersonic:    { type: "dir",       label: "超声波",       path: "\\\\192.168.6.96\\D$\\ATS\\测试报表" },
  manu_agingcab:      { type: "excel",     label: "老化",         path: "\\\\192.168.6.97\\D$\\ATS\\测试报表\\aging" },
  manu_hivolt_ate:    { type: "dir",       label: "高压测试",     path: "\\\\192.168.6.98\\D$\\ATS\\测试报表" },
  manu_package_ate:   { type: "dir",       label: "包装ATE",     path: "\\\\192.168.6.99\\D$\\ATS\\测试报表" },
  manu_outer_box_binding: { type: "dir", label: "外箱绑码", path: "\\\\192.168.6.100\\D$\\ATS\\测试报表" },
  manu_pallet_binding: { type: "dir", label: "栈板绑码", path: "\\\\192.168.6.161\\D$\\ATS\\测试报表" },
};

export async function queryMysqlDs(cfg) {
  const mysql = (await import('mysql2/promise')).default;
  const conn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, connectTimeout: 5000 });
  const [tables] = await conn.query("SHOW TABLES");
  const tableNames = tables.map(r => Object.values(r)[0]);
  const schema = [];
  for (const tbl of tableNames) {
    const [cnt] = await conn.query(`SELECT COUNT(*) as cnt FROM \`${tbl}\``);
    const [cols] = await conn.query(`SHOW COLUMNS FROM \`${tbl}\``);
    schema.push({ name: tbl, totalRows: cnt[0]?.cnt ?? 0, columns: cols.map(c => ({ field: c.Field, type: c.Type, key: c.Key, nullable: c.Null === "YES" })) });
  }
  await conn.end();
  return { sourceType: "mysql", host: cfg.host, port: cfg.port, database: cfg.database, tables: schema };
}

export async function querySqlserverDs(cfg) {
  const mssql = await import('mssql');
  const conn = await mssql.connect({ server: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, options: { encrypt: false, trustServerCertificate: true, connectionTimeout: 5000 }, pool: { max: 1 } });
  const tables = await conn.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
  const schema = [];
  for (const row of tables.recordset) {
    const tbl = row.TABLE_NAME;
    const cnt = await conn.request().query(`SELECT COUNT(*) as cnt FROM "${tbl}"`);
    const cols = await conn.request().query(`SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY='PRI' as is_pk FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${tbl}' ORDER BY ORDINAL_POSITION`);
    schema.push({ name: tbl, totalRows: cnt.recordset[0]?.cnt ?? 0, columns: cols.recordset.map(c => ({ field: c.COLUMN_NAME, type: c.DATA_TYPE, key: c.is_pk ? "PRI" : "", nullable: c.IS_NULLABLE === "YES" })) });
  }
  conn.close();
  return { sourceType: "sqlserver", host: cfg.host, port: cfg.port, database: cfg.database, tables: schema };
}

export async function queryDirDs(cfg) {
  const dir = cfg.path;
  // Pre-check: if UNC path, verify host is reachable (avoid Windows UNC blocking)
  const uncMatch = dir.match(/^\\\\([^\\]+)/);
  if (uncMatch) {
    const host = uncMatch[1];
    try {
      await new Promise((resolve, reject) => {
        const s = net.connect({ host, port: 445, timeout: 2000 }, resolve);
        s.on("error", reject);
        s.on("timeout", () => { s.destroy(); reject(new Error("timeout")); });
      });
    } catch {
      return { sourceType: "dir", path: dir, error: `Host ${host} unreachable`, files: [], ngRecords: [] };
    }
  }
  const TIMEOUT = 5000;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    return { sourceType: "dir", path: dir, error: e?.message || "Unreachable", files: [], ngRecords: [] };
  }
  const files = [];
  const ngRecords = [];
  for (const item of entries) {
    if (item.isDirectory()) {
      files.push({ name: item.name, type: "dir" });
    } else {
      const ext = path.extname(item.name).toLowerCase();
      let sheets = null;
      if (ext === ".xlsx" || ext === ".xls") {
        try {
          const wb = XLSX.readFile(path.join(dir, item.name));
          sheets = Object.keys(wb.Sheets).map(s => {
            const ws = wb.Sheets[s];
            const ref = ws["!ref"];
            const rowCount = ref ? ref.split(":")[1].replace(/[A-Z]/g, "") : 0;
            return { name: s, rows: Number(rowCount) || 0 };
          });
        } catch {}
        let size = 0;
        try { size = (await fs.promises.stat(path.join(dir, item.name), { signal: AbortSignal.timeout(2000) })).size; } catch {}
        files.push({ name: item.name, type: "file", ext, size, sheets });
      } else if (ext === ".csv") {
        const fullPath = path.join(dir, item.name);
        let size = 0;
        try { size = (await fs.promises.stat(fullPath, { signal: AbortSignal.timeout(2000) })).size; } catch {}
        files.push({ name: item.name, type: "file", ext, size });
        if (item.name.toUpperCase().includes("FAIL")) {
          try {
            const content = await fs.promises.readFile(fullPath, { encoding: "latin1", signal: AbortSignal.timeout(3000) });
            const lines = content.split(/\r?\n/).filter(l => l.trim());
            for (const line of lines) {
              const parts = line.split(",");
              if (parts.length >= 6) {
                const result = parts[1]?.trim().toUpperCase();
                if (result === "FAIL" || result === "NG") {
                  ngRecords.push({
                    filename: item.name,
                    mainboard: parts[0]?.trim() || "",
                    productSn: parts[2]?.trim() || "",
                    timestamp: parts[3]?.trim() || "",
                    errorCode: parts[4]?.trim() || "",
                    slot: parts[5]?.trim() || "",
                  });
                }
              }
            }
          } catch (e) {
            // ignore parse/IO errors
          }
        }
      } else {
        let size = 0;
        try { size = (await fs.promises.stat(path.join(dir, item.name), { signal: AbortSignal.timeout(2000) })).size; } catch {}
        files.push({ name: item.name, type: "file", ext, size });
      }
    }
  }
  return { sourceType: "dir", path: dir, files, ngRecords };
}

/** AOI KPI — query pcb_detection.detection_board (today's data) */
export async function queryAoiKpi(cfg) {
  const mysql = (await import('mysql2/promise')).default;
  const conn = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user,
    password: cfg.password, database: cfg.database, connectTimeout: 5000,
  });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [statRows] = await conn.query(`
      SELECT COUNT(*) as board_count,
             COALESCE(SUM(\`pass\`=1 OR NULL),0) as pass_count,
             COALESCE(SUM(\`pass\`<>1 OR NULL),0) as fail_count,
             COALESCE(SUM(\`total\`),0) as total_components,
             COALESCE(SUM(\`ng\`),0) as total_ng
      FROM detection_board
      WHERE DATE(create_time)=? AND del_flag=0
    `, [today]);
    const s = statRows[0] || {};
    const bc = Number(s.board_count) || 0;
    const fc = Number(s.fail_count) || 0;
    const pc = Number(s.pass_count) || 0;
    const stats = {
      board_count: bc, pass_count: pc, fail_count: fc,
      pass_rate: bc > 0 ? Math.round(pc / bc * 1000) / 10 : 0,
      ng_rate: bc > 0 ? Math.round(fc / bc * 1000) / 10 : 0,
      dppm: s.total_components > 0 ? Math.round(Number(s.total_ng) * 1_000_000 / Number(s.total_components)) : 0,
      dpu: bc > 0 ? Math.round(Number(s.total_ng) / bc * 1000) / 1000 : 0,
    };
    const [defRows] = await conn.query(`
      SELECT d.wrong_types, COUNT(*) as cnt
      FROM detection_rect_det d
      JOIN detection_board b ON d.board_id=b.id
      WHERE DATE(b.create_time)=? AND b.del_flag=0
      GROUP BY d.wrong_types ORDER BY cnt DESC LIMIT 8
    `, [today]);
    const DEFECT_MAP = { '2':'少锡/缺锡','7':'半焊','10':'漏件/少件','12':'多件/连锡','1':'方向错误','4':'异物/污染','13':'孔异常','6':'引脚弯曲' };
    const defectTotals = {};
    for (const row of defRows) {
      if (!row.wrong_types) continue;
      for (const code of row.wrong_types.split(',')) {
        const name = DEFECT_MAP[code.trim()] || `其他(${code.trim()})`;
        defectTotals[name] = (defectTotals[name] || 0) + Number(row.cnt);
      }
    }
    const defects = Object.entries(defectTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => ({ type, count }));
    const [ngRows] = await conn.query(`
      SELECT id, number, \`pass\`, ng, total, create_time, template_name
      FROM detection_board
      WHERE DATE(create_time)=? AND del_flag=0 AND \`pass\`=0
      ORDER BY id DESC LIMIT 20
    `, [today]);
    const ng_pool = ngRows.map(r => ({
      id: r.id, sn: r.number || `AOI-${r.id}`,
      template: r.template_name || '',
      result: 'FAIL',
      failed_components: Number(r.ng) || 0,
      test_time: String(r.create_time || '').slice(0, 19),
    }));
    const [trendRows] = await conn.query(`
      SELECT DATE(create_time) as dt,
             COUNT(*) as boards,
             COALESCE(SUM(\`pass\`=1 OR NULL),0) as passed,
             COALESCE(SUM(\`pass\`<>1 OR NULL),0) as ng
      FROM detection_board WHERE del_flag=0
      GROUP BY DATE(create_time) ORDER BY dt DESC LIMIT 7
    `);
    const trend = trendRows.reverse().map(r => ({
      date: String(r.dt).slice(0, 10),
      boards: Number(r.boards) || 0,
      ng: Number(r.ng) || 0,
    }));
    return { sourceType: 'mysql', stats, defects, ng_pool, trend, _host: cfg.host, _port: cfg.port, _database: cfg.database };
  } finally {
    await conn.end();
  }
}

/** ICT / FCT KPI — query pcb_detection.imported_boards */
export async function queryImportKpi(cfg, sourceFilter) {
  const mysql = (await import('mysql2/promise')).default;
  const conn = await mysql.createConnection({
    host: '192.168.6.50', port: 3306, user: 'root',
    password: 'root1234', database: 'pcb_detection', connectTimeout: 5000,
  });
  try {
    const [statRows] = await conn.query(`
      SELECT COUNT(*) as board_count,
             SUM(CASE WHEN result='PASS' THEN 1 ELSE 0 END) as pass_count,
             SUM(CASE WHEN result<>'PASS' THEN 1 ELSE 0 END) as fail_count,
             SUM(COALESCE(failed_components,0)) as total_ng
      FROM imported_boards WHERE source IN (${sourceFilter.map(() => '?').join(',')})
    `, sourceFilter);
    const s = statRows[0] || {};
    const bc = Number(s.board_count) || 0;
    const fc = Number(s.fail_count) || 0;
    const pc = Number(s.pass_count) || 0;
    const stats = {
      board_count: bc, pass_count: pc, fail_count: fc,
      pass_rate: bc > 0 ? Math.round(pc / bc * 1000) / 10 : 0,
      ng_rate: bc > 0 ? Math.round(fc / bc * 1000) / 10 : 0,
      dppm: 0, dpu: bc > 0 ? Math.round(fc / bc * 1000) / 1000 : 0,
    };
    const [ngRows] = await conn.query(`
      SELECT id, board_sn as sn, template, result, failed_components, created_at as test_time
      FROM imported_boards
      WHERE source IN (${sourceFilter.map(() => '?').join(',')}) AND result<>'PASS'
      ORDER BY id DESC LIMIT 20
    `, sourceFilter);
    const ng_pool = ngRows.map(r => ({
      id: r.id, sn: r.sn || `ICT-${r.id}`, template: r.template || '',
      result: r.result || 'FAIL', failed_components: Number(r.failed_components) || 0,
      test_time: String(r.test_time || '').slice(0, 19),
    }));
    const [trendRows] = await conn.query(`
      SELECT DATE(created_at) as dt, COUNT(*) as boards,
             SUM(CASE WHEN result='PASS' THEN 1 ELSE 0 END) as passed,
             SUM(CASE WHEN result<>'PASS' THEN 1 ELSE 0 END) as ng
      FROM imported_boards WHERE source IN (${sourceFilter.map(() => '?').join(',')})
      GROUP BY DATE(created_at) ORDER BY dt DESC LIMIT 7
    `, sourceFilter);
    const trend = trendRows.reverse().map(r => ({
      date: String(r.dt).slice(0, 10), boards: Number(r.boards) || 0, ng: Number(r.ng) || 0,
    }));
    return { sourceType: 'mysql', stats, defects: [], ng_pool, trend };
  } finally {
    await conn.end();
  }
}

/** Excel KPI — parse Excel report files */
export async function queryExcelKpi(cfg) {
  const path2 = cfg.path || (cfg.code === 'manu_agingcab' ? 'D:\\ATS\\测试报表\\aging' : 'D:\\ATS\\测试报表\\ate');
  let workbook;
  try {
    const files = fs.existsSync(path2) ? fs.readdirSync(path2).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls')) : [];
    if (files.length === 0) return { sourceType: 'excel', stats: null, ng_pool: [], defects: [], trend: [], note: `No Excel files in ${path2}` };
    const filePath = path2 + '\\' + files[0];
    workbook = XLSX.readFile(filePath);
  } catch (e) {
    return { sourceType: 'excel', stats: null, ng_pool: [], defects: [], trend: [], error: `Cannot read Excel: ${e.message}` };
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (raw.length < 2) return { sourceType: 'excel', stats: null, ng_pool: [], defects: [], trend: [] };
  const header = raw[0].map((h, i) => String(h ?? `col${i}`).toLowerCase());
  const resultCol = header.findIndex(h => ['result','结果','判定','pass/fail','status'].some(x => h.includes(x)));
  const snCol     = header.findIndex(h => ['sn','serial','条码','board_sn','板号'].some(x => h.includes(x)));
  const tmplCol   = header.findIndex(h => ['template','模板','型号','model'].some(x => h.includes(x)));
  const failCol   = header.findIndex(h => ['fail','ng','failed','不良','fail components'].some(x => h.includes(x)));
  const passCol   = header.findIndex(h => h.includes('pass') && !h.includes('fail'));
  const data = raw.slice(1).filter(row => row.length > 0);
  const total = data.length;
  let failCount = 0, passCount = 0;
  const ng_pool = [];
  for (const row of data) {
    const resultVal = resultCol >= 0 ? String(row[resultCol] || '').toUpperCase() : '';
    const isFail = ['FAIL','NG','不良','FALSE'].some(r => resultVal.includes(r));
    if (isFail) {
      failCount++;
      ng_pool.push({
        id: ng_pool.length + 1,
        sn: snCol >= 0 ? String(row[snCol] || `ROW-${ng_pool.length + 1}`) : `ROW-${ng_pool.length + 1}`,
        template: tmplCol >= 0 ? String(row[tmplCol] || '') : '',
        result: 'FAIL',
        failed_components: failCol >= 0 ? parseInt(row[failCol]) || 0 : 0,
        test_time: '',
      });
    } else {
      passCount++;
    }
  }
  const bc = total;
  const stats = {
    board_count: bc, pass_count: passCount, fail_count: failCount,
    pass_rate: bc > 0 ? Math.round(passCount / bc * 1000) / 10 : 0,
    ng_rate: bc > 0 ? Math.round(failCount / bc * 1000) / 10 : 0,
    dppm: 0, dpu: bc > 0 ? Math.round(failCount / bc * 1000) / 1000 : 0,
  };
  return { sourceType: 'excel', stats, ng_pool: ng_pool.slice(0, 20), defects: [], trend: [], _path: path2 };
}
