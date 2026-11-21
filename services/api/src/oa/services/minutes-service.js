/**
 * S6 - 组织架构纪要服务
 *
 * 功能：
 *   - listMinutes / getMinutes / createMinutes / updateMinutes / deleteMinutes
 *   - minutesTemplate() 导入模板（中越双语）
 *   - importMinutes(rows, userId) / exportMinutes()
 *
 * 单号规则：ORG-<年>-<4 位流水>，如 ORG-2026-0001。
 *   序号池 org_minutes_seq(year, last_no) 用 INSERT ... ON CONFLICT DO UPDATE ... RETURNING
 *   原子取号，串行安全。
 */
import { many, one, query } from '../db/index.js';

/**
 * 生成下一个纪要单号（原子取号）。
 * @param {number} year 年份
 * @returns {Promise<string>} 如 'ORG-2026-0001'
 */
async function nextMinutesNo(year) {
  const row = await one(
    `INSERT INTO org_minutes_seq (year, last_no) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_no = org_minutes_seq.last_no + 1
     RETURNING last_no`,
    [year]
  );
  const n = Number(row?.last_no || 1);
  return `ORG-${year}-${String(n).padStart(4, '0')}`;
}

/**
 * 纪要列表（分页 + 关键词）。
 * @param {{keyword?:string,page?:number,pageSize?:number}} opts
 * @returns {Promise<{list:Array,total:number,page:number,pageSize:number}>}
 */
export async function listMinutes({ keyword, page = 1, pageSize = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.max(1, Number(pageSize) || 20);
  const offset = (p - 1) * s;

  const params = [];
  let where = '1=1';
  if (keyword) {
    params.push(`%${keyword}%`);
    where += ` AND (m.title ILIKE $${params.length} OR m.title_vi ILIKE $${params.length}
                    OR m.minutes_no ILIKE $${params.length} OR m.content ILIKE $${params.length})`;
  }

  const list = await many(
    `SELECT m.*, u.real_name AS host_name, cu.real_name AS creator_name
       FROM org_minutes m
       LEFT JOIN org_user u ON u.id = m.host_id
       LEFT JOIN org_user cu ON cu.id = m.created_by
      WHERE ${where}
      ORDER BY m.meeting_date DESC NULLS LAST, m.id DESC
      LIMIT ${s} OFFSET ${offset}`,
    params
  );
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM org_minutes m WHERE ${where}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: s };
}

/**
 * 单条纪要详情。
 * @param {number} id
 */
export async function getMinutes(id) {
  const row = await one(
    `SELECT m.*, u.real_name AS host_name, cu.real_name AS creator_name
       FROM org_minutes m
       LEFT JOIN org_user u ON u.id = m.host_id
       LEFT JOIN org_user cu ON cu.id = m.created_by
      WHERE m.id = $1`,
    [id]
  );
  return row || null;
}

/**
 * 创建纪要（自动生成单号）。
 * @param {object} data {title,titleVi,meetingDate,hostId,attendees,content,attachmentPath}
 * @param {number} userId 创建人
 */
export async function createMinutes(data, userId) {
  const title = data?.title ? String(data.title).trim() : '';
  if (!title) throw new Error('请填写纪要标题');

  const meetingDate = data.meetingDate ? String(data.meetingDate).slice(0, 10) : null;
  const year = meetingDate ? Number(meetingDate.slice(0, 4)) : new Date().getFullYear();
  const minutesNo = await nextMinutesNo(year);

  const row = await one(
    `INSERT INTO org_minutes
       (minutes_no, title, title_vi, meeting_date, host_id, attendees, content, attachment_path, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'archived',$9) RETURNING *`,
    [minutesNo, title, data.titleVi || null, meetingDate, data.hostId || null,
     data.attendees || null, data.content || null, data.attachmentPath || null, userId]
  );
  return row;
}

/**
 * 更新纪要。
 * @param {number} id
 * @param {object} data
 */
export async function updateMinutes(id, data) {
  const exist = await one(`SELECT id FROM org_minutes WHERE id = $1`, [id]);
  if (!exist) throw new Error('纪要不存在');

  await query(
    `UPDATE org_minutes SET
       title = COALESCE($2, title),
       title_vi = COALESCE($3, title_vi),
       meeting_date = COALESCE($4, meeting_date),
       host_id = COALESCE($5, host_id),
       attendees = COALESCE($6, attendees),
       content = COALESCE($7, content),
       attachment_path = COALESCE($8, attachment_path),
       updated_at = now()
     WHERE id = $1`,
    [id, data.title || null, data.titleVi || null,
     data.meetingDate ? String(data.meetingDate).slice(0, 10) : null,
     data.hostId || null, data.attendees || null, data.content || null,
     data.attachmentPath || null]
  );
  return { id };
}

/**
 * 删除纪要。
 * @param {number} id
 */
export async function deleteMinutes(id) {
  await query(`DELETE FROM org_minutes WHERE id = $1`, [id]);
  return { id };
}

/**
 * 纪要导入模板列（中越双语）。
 */
export function minutesTemplate() {
  return {
    columns: [
      { key: 'title', label: '标题', label_vi: 'Tiêu đề' },
      { key: 'title_vi', label: '标题(越)', label_vi: 'Tiêu đề (Việt)' },
      { key: 'meeting_date', label: '会议日期', label_vi: 'Ngày họp' },
      { key: 'host_name', label: '主持人姓名', label_vi: 'Người chủ trì' },
      { key: 'attendees', label: '参会人员', label_vi: 'Thành viên tham dự' },
      { key: 'content', label: '纪要内容', label_vi: 'Nội dung biên bản' },
    ],
  };
}

/**
 * 批量导入纪要。逐行生成单号（串行，原子取号）。
 * @param {object[]} rows
 * @param {number} userId
 * @returns {Promise<{inserted:number,failed:number,errors:Array}>}
 */
export async function importMinutes(rows, userId) {
  const errors = [];
  let inserted = 0, failed = 0;
  const list = Array.isArray(rows) ? rows : [];

  for (let idx = 0; idx < list.length; idx++) {
    const raw = list[idx] || {};
    const rowNo = idx + 2;
    const title = raw.title ? String(raw.title).trim() : '';
    if (!title) { errors.push({ row: rowNo, field: 'title', msg: '标题必填' }); failed++; continue; }

    try {
      // 主持人按姓名解析（可选）
      let hostId = null;
      if (raw.host_name) {
        const h = await one(`SELECT id FROM org_user WHERE real_name = $1 LIMIT 1`, [String(raw.host_name).trim()]);
        hostId = h?.id || null;
      }

      const meetingDate = raw.meeting_date ? String(raw.meeting_date).slice(0, 10) : null;
      const year = meetingDate ? Number(meetingDate.slice(0, 4)) : new Date().getFullYear();
      const minutesNo = await nextMinutesNo(year);

      await query(
        `INSERT INTO org_minutes
           (minutes_no, title, title_vi, meeting_date, host_id, attendees, content, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'archived',$8)`,
        [minutesNo, title, raw.title_vi || null, meetingDate, hostId,
         raw.attendees || null, raw.content || null, userId]
      );
      inserted++;
    } catch (err) {
      errors.push({ row: rowNo, field: '', msg: err.message });
      failed++;
    }
  }
  return { inserted, failed, errors };
}

/**
 * 导出全部纪要（中越双语表头）。
 */
export async function exportMinutes() {
  const columns = [
    { key: 'minutes_no', label: '纪要编号', label_vi: 'Số biên bản' },
    { key: 'title', label: '标题', label_vi: 'Tiêu đề' },
    { key: 'title_vi', label: '标题(越)', label_vi: 'Tiêu đề (Việt)' },
    { key: 'meeting_date', label: '会议日期', label_vi: 'Ngày họp' },
    { key: 'host_name', label: '主持人', label_vi: 'Người chủ trì' },
    { key: 'attendees', label: '参会人员', label_vi: 'Thành viên tham dự' },
    { key: 'content', label: '纪要内容', label_vi: 'Nội dung biên bản' },
    { key: 'status', label: '状态', label_vi: 'Trạng thái' },
  ];

  const rows = await many(
    `SELECT m.minutes_no, m.title, m.title_vi, m.meeting_date, m.attendees, m.content, m.status,
            u.real_name AS host_name
       FROM org_minutes m
       LEFT JOIN org_user u ON u.id = m.host_id
      ORDER BY m.meeting_date DESC NULLS LAST, m.id DESC`
  );

  const out = rows.map(r => ({
    minutes_no: r.minutes_no || '',
    title: r.title || '',
    title_vi: r.title_vi || '',
    meeting_date: r.meeting_date || '',
    host_name: r.host_name || '',
    attendees: r.attendees || '',
    content: r.content || '',
    status: r.status || 'archived',
  }));

  return { columns, rows: out };
}
