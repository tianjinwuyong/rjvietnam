// 知识共享、培训考试、设备管理、IPQC 巡线、统计 的聚合服务
import { many, one, query, transaction } from '../db/index.js';
import { normJudgeConfig } from '../utils/judge-config.js';
import { notify } from './notify.js';
import { dateParam } from '../utils/params.js';

/* ============ 知识共享 ============ */
export async function listKnowledge({ status, keyword, page = 1, size = 20, userId } = {}) {
  const params = [];
  // 主列表默认只看当前生效版本（is_current=TRUE）；存量单版本数据天然满足，行为不变。
  // includeHistory=true 时不加该过滤（供个别场景回溯全量）。
  let where = 'k.is_current = TRUE';
  if (status) { params.push(status); where += ` AND k.status = $${params.length}`; }
  if (keyword) { params.push(`%${keyword}%`); where += ` AND k.title ILIKE $${params.length}`; }
  // 先做 count（仅用过滤参数），避免被下文的 liked/favorited 参数污染
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM knowledge_doc k WHERE ${where}`, params);
  // 当前用户维度：是否已点赞/已收藏（userId 缺省时恒 false，向后兼容）
  const uid = userId ?? null;
  const likeIdx = params.push(uid);
  const favIdx = params.push(uid);
  const rows = await many(
    `SELECT k.*, u.real_name AS uploader_name, a.real_name AS approver_name,
            EXISTS (SELECT 1 FROM knowledge_like kl
                     WHERE kl.doc_id = k.id AND kl.user_id = $${likeIdx}) AS liked,
            EXISTS (SELECT 1 FROM knowledge_favorite kf
                     WHERE kf.doc_id = k.id AND kf.user_id = $${favIdx}) AS favorited
       FROM knowledge_doc k
       LEFT JOIN org_user u ON u.id = k.uploader_id
       LEFT JOIN org_user a ON a.id = k.approver_id
      WHERE ${where} ORDER BY k.created_at DESC
      LIMIT ${size} OFFSET ${(page - 1) * size}`,
    params
  );
  return { list: rows, total: cnt?.n || 0 };
}

export async function createKnowledge({ title, category, description, filePath, fileSize, uploaderId }) {
  const r = await one(
    `INSERT INTO knowledge_doc (title, category, description, file_path, file_size, uploader_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
    [title, category || null, description || null, filePath, fileSize || 0, uploaderId]
  );
  // 通知部门负责人审批
  const uploader = await one(`SELECT department_id FROM org_user WHERE id = $1`, [uploaderId]);
  if (uploader?.department_id) {
    const leader = await one(`SELECT leader_id FROM org_department WHERE id = $1`, [uploader.department_id]);
    if (leader?.leader_id) {
      await notify(leader.leader_id, {
        title: `【待审核】知识文档「${title}」`,
        content: `${title} 已上传，请审核后开放共享。`,
        link: '/knowledge',
        category: 'todo',
      });
    }
  }
  return r;
}

/* ---------- 简版版本管理 ----------
 * 语义（务必与前端/审批链路一致）：
 *   · 每条 knowledge_doc 记录 = 一个「版本」；同一条文档链通过 supersedes_id 串联。
 *   · 首版：version=1，is_current=TRUE，supersedes_id=NULL。
 *   · 上传新版本：基于当前版本（必须已 approved）建一条 version+1 的新记录，
 *       - 新记录 status='pending'（仍需走审批），is_current=FALSE、supersedes_id=旧id；
 *       - 旧记录此刻【不动】：仍是 is_current=TRUE，直到新版本审批通过才被归档。
 *   · 审批通过新版本：新记录 is_current=TRUE，其 supersedes 指向的旧记录 is_current=FALSE。
 *     ——「归档」= is_current=FALSE，旧版本记录保留、仍可查/可下载，只是不再进主列表。
 *   · 审批驳回新版本：新记录保持 is_current=FALSE，旧版本继续对外，链不受损。
 */

/**
 * 查询某文档所属版本链的历史版本列表（按 version 倒序）。
 * 以入参文档为锚点，沿 supersedes_id 向上回溯到链首，再向下收集整条链。
 * @param {number} id 任一本链中的文档 id
 */
export async function listKnowledgeVersions(id) {
  const anchor = await one(`SELECT id, supersedes_id FROM knowledge_doc WHERE id = $1`, [id]);
  if (!anchor) throw new Error('文档不存在');
  // 先回溯到链首（防环：限制 100 跳）
  let rootId = anchor.id;
  let cur = anchor;
  for (let i = 0; i < 100 && cur?.supersedes_id; i++) {
    const prev = await one(`SELECT id, supersedes_id FROM knowledge_doc WHERE id = $1`, [cur.supersedes_id]);
    if (!prev) break;
    rootId = prev.id;
    cur = prev;
  }
  // 再从链首向下递归收集全部后代（含自身）
  const rows = await many(
    `WITH RECURSIVE chain AS (
        SELECT * FROM knowledge_doc WHERE id = $1
        UNION ALL
        SELECT k.* FROM knowledge_doc k JOIN chain c ON k.supersedes_id = c.id
     )
     SELECT c.id, c.title, c.category, c.version, c.status, c.is_current,
            c.supersedes_id, c.file_path, c.file_size, c.created_at,
            u.real_name AS uploader_name
       FROM chain c
       LEFT JOIN org_user u ON u.id = c.uploader_id
      ORDER BY c.version DESC, c.id DESC`,
    [rootId]
  );
  return rows;
}

/**
 * 上传新版本：以 baseId 为当前版本，建一条 version+1 的新记录（走审批）。
 * @param {number} baseId 被取代的（当前）文档 id
 * @param {{title?:string, category?:string, description?:string, filePath:string, fileSize?:number, uploaderId:number}} data
 * @returns {Promise<object>} 新记录
 */
export async function createKnowledgeVersion(baseId, { title, category, description, filePath, fileSize, uploaderId }) {
  const base = await one(`SELECT * FROM knowledge_doc WHERE id = $1`, [baseId]);
  if (!base) throw new Error('原文档不存在');
  if (base.status !== 'approved') throw new Error('仅已开放共享的文档可上传新版本');
  if (!base.is_current) throw new Error('该文档已被更新版本取代，请对最新版本操作');

  const newVer = (Number(base.version) || 1) + 1;
  // 标题锁定沿用原文档标题（前端亦锁定），分类/说明可改
  const r = await one(
    `INSERT INTO knowledge_doc
       (title, category, description, file_path, file_size, uploader_id, status,
        version, supersedes_id, is_current)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,FALSE) RETURNING *`,
    [title || base.title, category ?? base.category, description ?? base.description,
     filePath, fileSize || 0, uploaderId, newVer, base.id]
  );

  // 通知部门负责人审批新版本（与首版一致）
  const uploader = await one(`SELECT department_id FROM org_user WHERE id = $1`, [uploaderId]);
  if (uploader?.department_id) {
    const leader = await one(`SELECT leader_id FROM org_department WHERE id = $1`, [uploader.department_id]);
    if (leader?.leader_id) {
      await notify(leader.leader_id, {
        title: `【待审核】知识文档「${r.title}」v${newVer}`,
        content: `${r.title} 新版本 v${newVer} 已上传，请审核后开放共享。`,
        link: '/knowledge',
        category: 'todo',
      });
    }
  }
  return r;
}

export async function approveKnowledge(id, userId, action) {
  const k = await one(`SELECT * FROM knowledge_doc WHERE id = $1`, [id]);
  if (!k) throw new Error('文档不存在');
  if (k.status !== 'pending') throw new Error('该文档已处理');
  const status = action === 'approve' ? 'approved' : 'rejected';

  if (status === 'approved') {
    // 发布：本版置为当前，并归档它取代的旧版本（旧记录保留，仅 is_current=FALSE）。
    // 用事务保证「新版本转正」与「旧版本归档」原子完成。
    await transaction(async (tx) => {
      await tx.query(
        `UPDATE knowledge_doc SET status = 'approved', approver_id = $2, approved_at = now(),
                is_current = TRUE
          WHERE id = $1`,
        [id, userId]
      );
      if (k.supersedes_id) {
        await tx.query(
          `UPDATE knowledge_doc SET is_current = FALSE WHERE id = $1`,
          [k.supersedes_id]
        );
      }
    });
  } else {
    // 驳回：新版本保持 is_current=FALSE，旧版本继续有效，版本链不受损。
    await query(
      `UPDATE knowledge_doc SET status = $2, approver_id = $3, approved_at = now() WHERE id = $1`,
      [id, status, userId]
    );
  }

  await notify(k.uploader_id, {
    title: status === 'approved' ? `【已开放】${k.title}` : `【已驳回】${k.title}`,
    content: status === 'approved'
      ? (Number(k.version) > 1 ? `您的文档新版本 v${k.version} 已开放共享` : '您的文档已开放共享')
      : '您的文档未通过审核',
    link: '/knowledge',
    category: 'system',
  });
  return { status, version: k.version };
}

export async function viewKnowledge(id) {
  await query(`UPDATE knowledge_doc SET view_count = view_count + 1 WHERE id = $1`, [id]);
}

/**
 * 记录一次下载，维护 knowledge_doc.download_count。
 * 口径：与浏览量同源但独立计数；仅对已开放共享（approved）的文档计数，
 * 未审批/已驳回文档拒绝，避免越权下载被计入统计。
 * @param {number} id 文档 id
 * @returns {Promise<{downloadCount:number, filePath:string}>} 供调用方取 file_path 直出下载
 */
export async function downloadKnowledge(id) {
  const doc = await one(
    `SELECT id, status, file_path, download_count FROM knowledge_doc WHERE id = $1`,
    [id]
  );
  if (!doc) throw new Error('文档不存在');
  if (doc.status !== 'approved') throw new Error('该文档未开放共享，无法下载');
  await query(`UPDATE knowledge_doc SET download_count = download_count + 1 WHERE id = $1`, [id]);
  const c = await one(`SELECT download_count FROM knowledge_doc WHERE id = $1`, [id]);
  return { downloadCount: c?.download_count || 0, filePath: doc.file_path };
}

/**
 * 下载统计看板：按浏览量/下载量排序，供知识库「统计」视图使用。
 * @param {{limit?:number}} opts
 */
export async function knowledgeDownloadStats({ limit = 20 } = {}) {
  const rows = await many(
    `SELECT id, title, category, status, view_count, download_count, like_count, favorite_count
       FROM knowledge_doc
      WHERE status = 'approved'
      ORDER BY download_count DESC, view_count DESC, id DESC
      LIMIT ${Math.min(Number(limit) || 20, 100)}`
  );
  return rows;
}

/* ============ 培训与考试 ============ */
export async function listTraining() {
  const rows = await many(
    `SELECT t.*, u.real_name AS owner_name,
            (SELECT COUNT(*)::int FROM training_record r WHERE r.training_id = t.id) AS enrolled
       FROM training t LEFT JOIN org_user u ON u.id = t.owner_id
      ORDER BY t.created_at DESC`
  );
  return rows;
}

export async function createTraining(data) {
  return one(
    `INSERT INTO training (name, category, description, plan_date, owner_id, need_exam, cert_valid_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [data.name, data.category || 'on_job', data.description || null, data.plan_date || null,
     data.ownerId || null, data.needExam !== false, data.certValidDays || 0]
  );
}

export async function listQuestions(category) {
  const params = [];
  let where = '1=1';
  if (category) { params.push(category); where += ` AND category = $${params.length}`; }
  return many(`SELECT id, question, qtype, options, category FROM exam_question WHERE ${where} ORDER BY id`, params);
}

export async function importQuestions(items) {
  let n = 0;
  for (const it of items) {
    if (!it.question || !it.answer) continue;
    await query(
      `INSERT INTO exam_question (question, qtype, options, answer, category)
       VALUES ($1,$2,$3,$4,$5)`,
      [it.question, it.qtype || 'choice', JSON.stringify(it.options || []), String(it.answer), it.category || null]
    );
    n++;
  }
  return n;
}

/** 记录考试成绩，通过则颁发/续期上岗证 */
export async function recordExam({ trainingId, userId, score, passed }) {
  const training = await one(`SELECT * FROM training WHERE id = $1`, [trainingId]);
  if (!training) throw new Error('培训不存在');

  await query(
    `INSERT INTO training_record (training_id, user_id, status, score, passed, attended_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (training_id, user_id) DO UPDATE
       SET score = EXCLUDED.score, passed = EXCLUDED.passed, status = EXCLUDED.status, attended_at = now()`,
    [trainingId, userId, passed ? 'completed' : 'pending_cert', score, passed]
  );

  if (passed && training.cert_valid_days > 0) {
    const exist = await one(
      `SELECT * FROM staff_certificate WHERE user_id = $1 AND status IN ('valid','expiring')`,
      [userId]
    );
    const expire = new Date();
    expire.setDate(expire.getDate() + training.cert_valid_days);
    const certNo = `CERT-${userId}-${Date.now().toString().slice(-6)}`;
    if (exist) {
      // 续期
      await query(
        `INSERT INTO staff_certificate (user_id, cert_no, training_id, issued_at, expire_at, status, renewed_from)
         VALUES ($1,$2,$3,now(),$4,'valid',$5)`,
        [userId, certNo, trainingId, expire.toISOString().slice(0, 10), exist.id]
      );
      await query(`UPDATE staff_certificate SET status='renewed' WHERE id=$1`, [exist.id]);
    } else {
      await query(
        `INSERT INTO staff_certificate (user_id, cert_no, training_id, issued_at, expire_at, status)
         VALUES ($1,$2,$3,now(),$4,'valid')`,
        [userId, certNo, trainingId, expire.toISOString().slice(0, 10)]
      );
    }
  }
  return { score, passed };
}

export async function listCertificates() {
  return many(
    `SELECT c.*, u.real_name, u.position, d.name AS dept_name, d.name_en AS dept_name_en
       FROM staff_certificate c
       JOIN org_user u ON u.id = c.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
      ORDER BY c.status, c.expire_at`
  );
}

/* ============ 设备管理 ============ */

/**
 * 设备台账列表。
 * 向后兼容：不传分页参数（page/pageSize）时，返回数组（旧前端 Equipment.vue 依赖）。
 * 传 page 时返回 { list, total, page, pageSize }。
 *
 * @param {object} opts keyword/status/departmentId/freqType/page/pageSize
 */
export async function listEquipment({ keyword, status, departmentId, freqType, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (keyword) {
    params.push(`%${keyword}%`);
    const i = params.length;
    where += ` AND (e.name ILIKE $${i} OR e.code ILIKE $${i} OR e.model ILIKE $${i}`
           + ` OR e.serial_no ILIKE $${i})`;
  }
  if (status) { params.push(status); where += ` AND e.status = $${params.length}`; }
  if (departmentId) { params.push(departmentId); where += ` AND e.department_id = $${params.length}`; }
  if (freqType) { params.push(freqType); where += ` AND e.freq_type = $${params.length}`; }

  const selectSql =
    `SELECT e.*, d.name AS dept_name, d.name_en AS dept_name_en FROM equipment e
       LEFT JOIN org_department d ON d.id = e.department_id
      WHERE ${where} ORDER BY e.id`;

  // 兼容路径：未传 page → 返回数组，行为与改造前一致
  if (page === undefined || page === null || page === '') {
    return many(selectSql, params);
  }

  // 分页路径
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM equipment e WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/** 依据周期（天）计算下次日期 */
function addDays(base, days) {
  if (!days || Number(days) <= 0) return null;
  const d = new Date(base);
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/** 解析日期字符串，兼容 YYYY-MM-DD 与 YYYY/M/D；非法返回 null */
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) return null;
  const [_, y, mo, da] = m;
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

export async function createEquipment(data) {
  const e = await one(
    `INSERT INTO equipment (code, name, model, location, department_id, maintain_cycle_days, external_cycle_days,
                            freq_type, freq_interval, spec, manufacturer, serial_no, purchase_date,
                            first_external_date, calibration_org, calibration_no, status, status_since)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now()) RETURNING *`,
    [data.code, data.name, data.model || null, data.location || null, data.departmentId || null,
     data.maintainCycleDays || 0, data.externalCycleDays || 0,
     data.freqType || null, data.freqInterval || 1, data.spec || null, data.manufacturer || null,
     data.serialNo || null, data.purchaseDate || null, data.firstExternalDate || null,
     data.calibrationOrg || null, data.calibrationNo || null, data.status || 'running']
  );
  // 计算首次保养与下次外校日期
  const today = new Date();
  const nextMaintain = addDays(today, data.maintainCycleDays);
  const nextExternal = addDays(today, data.externalCycleDays);
  await query(
    `UPDATE equipment SET next_maintain_date = COALESCE($2, next_maintain_date), next_external_date = COALESCE($3, next_external_date) WHERE id = $1`,
    [e.id, nextMaintain, nextExternal]
  );
  return one(`SELECT * FROM equipment WHERE id = $1`, [e.id]);
}

/**
 * 按资产编号（code）精确定位单台设备详情。
 * 供二维码扫码跳转使用：二维码内容即设备 code，扫码后调用本函数定位设备。
 * @param {string} code 设备资产编号（如 EQ-CNC-01），大小写不敏感
 * @param {number} [id] 当前用户 id（预留，便于后续做可见性控制；当前与 GET /api/equipment 权限一致）
 * @returns {object|null} 设备详情（含 dept_name），找不到返回 null
 */
export async function getEquipmentByCode(code, id = null) {
  const key = code ? String(code).trim() : '';
  if (!key) throw new Error('资产编号必填');
  return one(
    `SELECT e.*, d.name AS dept_name, d.name_en AS dept_name_en FROM equipment e
       LEFT JOIN org_department d ON d.id = e.department_id
      WHERE upper(e.code) = upper($1)
      ORDER BY e.id LIMIT 1`,
    [key]
  );
}

/**
 * 更新设备台账。
 * - status 变更时同步写 status_since，并向 equipment_history 写一条 status_change 履历。
 * - 周期变更时重算 next_*_date。
 * @param {number} id
 * @param {object} data 允许更新的字段
 */
export async function updateEquipment(id, data = {}) {
  const cur = await one(`SELECT * FROM equipment WHERE id = $1`, [id]);
  if (!cur) throw new Error('设备不存在');

  const next = {
    name: data.name ?? cur.name,
    model: data.model ?? cur.model,
    location: data.location ?? cur.location,
    department_id: data.departmentId ?? cur.department_id,
    maintain_cycle_days: data.maintainCycleDays ?? cur.maintain_cycle_days,
    external_cycle_days: data.externalCycleDays ?? cur.external_cycle_days,
    freq_type: data.freqType ?? cur.freq_type,
    freq_interval: data.freqInterval ?? cur.freq_interval,
    spec: data.spec ?? cur.spec,
    manufacturer: data.manufacturer ?? cur.manufacturer,
    serial_no: data.serialNo ?? cur.serial_no,
    purchase_date: data.purchaseDate ?? cur.purchase_date,
    first_external_date: data.firstExternalDate ?? cur.first_external_date,
    calibration_org: data.calibrationOrg ?? cur.calibration_org,
    calibration_no: data.calibrationNo ?? cur.calibration_no,
    status: data.status ?? cur.status,
  };

  const statusChanged = data.status && data.status !== cur.status;

  // 周期变更 → 重算 next 日期（以今天为基准）
  const today = new Date();
  let nextMaintain = cur.next_maintain_date;
  let nextExternal = cur.next_external_date;
  if (data.maintainCycleDays !== undefined && Number(data.maintainCycleDays) !== Number(cur.maintain_cycle_days)) {
    nextMaintain = addDays(today, data.maintainCycleDays) || cur.next_maintain_date;
  }
  if (data.externalCycleDays !== undefined && Number(data.externalCycleDays) !== Number(cur.external_cycle_days)) {
    nextExternal = addDays(today, data.externalCycleDays) || cur.next_external_date;
  }

  await transaction(async client => {
    await client.query(
      `UPDATE equipment SET name=$2, model=$3, location=$4, department_id=$5,
              maintain_cycle_days=$6, external_cycle_days=$7, freq_type=$8, freq_interval=$9,
              spec=$10, manufacturer=$11, serial_no=$12, purchase_date=$13,
              first_external_date=$14,
              calibration_org=$15, calibration_no=$16, status=$17,
              status_since = CASE WHEN $18 THEN now() ELSE status_since END,
              next_maintain_date=$19, next_external_date=$20,
              updated_at=now()
        WHERE id=$1`,
      [id, next.name, next.model, next.location, next.department_id,
       next.maintain_cycle_days, next.external_cycle_days, next.freq_type, next.freq_interval,
       next.spec, next.manufacturer, next.serial_no, next.purchase_date,
       next.first_external_date,
       next.calibration_org, next.calibration_no, next.status, !!statusChanged,
       nextMaintain, nextExternal]
    );
    if (statusChanged) {
      await client.query(
        `INSERT INTO equipment_history (equipment_id, event_type, title, content, operator_id)
         VALUES ($1, 'status_change', $2, $3, $4)`,
        [id, `状态 ${cur.status} → ${next.status}`,
         `设备状态由 ${cur.status} 变更为 ${next.status}`, data.operatorId || null]
      );
    }
  });

  return one(`SELECT * FROM equipment WHERE id = $1`, [id]);
}

/**
 * 删除设备。若存在未完成任务则拒绝。
 * @param {number} id
 */
export async function deleteEquipment(id) {
  const eq = await one(`SELECT id, code, name FROM equipment WHERE id = $1`, [id]);
  if (!eq) throw new Error('设备不存在');

  const pending = await one(
    `SELECT COUNT(*)::int AS n FROM equipment_task WHERE equipment_id = $1 AND status <> 'done'`,
    [id]
  );
  if ((pending?.n || 0) > 0) {
    throw new Error(`该设备存在 ${pending.n} 个未完成任务，请先处理后再删除`);
  }
  await query(`DELETE FROM equipment WHERE id = $1`, [id]);
  return { id };
}

/**
 * 批量导入设备（逐行 upsert：按 code 判断存在则 UPDATE，否则 INSERT）。
 * 逐行校验，收集错误而非中断；导入属于建档，不写履历。
 * @param {object[]} rows
 * @param {number} userId
 * @returns {{inserted:number, updated:number, failed:number, errors:Array}}
 */
export async function importEquipment(rows, userId) {
  const errors = [];
  let inserted = 0, updated = 0, failed = 0;
  const today = new Date();

  for (let idx = 0; idx < (rows || []).length; idx++) {
    const raw = rows[idx] || {};
    const rowNo = idx + 2; // Excel 行号（含表头）——用户友好
    const code = raw.code ? String(raw.code).trim() : '';
    const name = raw.name ? String(raw.name).trim() : '';

    if (!code) { errors.push({ row: rowNo, field: 'code', msg: '资产编号必填' }); failed++; continue; }
    if (!name) { errors.push({ row: rowNo, field: 'name', msg: '设备名称必填' }); failed++; continue; }

    // 部门解析：支持 dept_code 或 dept_name
    let departmentId = null;
    const deptKey = raw.dept_code || raw.dept_name;
    if (deptKey) {
      const dept = await one(
        `SELECT id FROM org_department WHERE code = $1 OR name = $1 LIMIT 1`,
        [String(deptKey).trim()]
      );
      if (!dept) { errors.push({ row: rowNo, field: 'dept_code', msg: `部门不存在：${deptKey}` }); failed++; continue; }
      departmentId = dept.id;
    }

    // 日期字段兼容
    const purchaseDate = parseDate(raw.purchase_date);
    if (raw.purchase_date && !purchaseDate) {
      errors.push({ row: rowNo, field: 'purchase_date', msg: `日期格式无效：${raw.purchase_date}` });
      failed++;
      continue;
    }
    // 首次外校日期（第 44 轮新增，人工录入，不参与 next_external_date 推算）
    const firstExternalDate = parseDate(raw.first_external_date);
    if (raw.first_external_date && !firstExternalDate) {
      errors.push({ row: rowNo, field: 'first_external_date', msg: `日期格式无效：${raw.first_external_date}` });
      failed++;
      continue;
    }

    const maintainDays = Number(raw.maintain_cycle_days) || 0;
    const externalDays = Number(raw.external_cycle_days) || 0;
    const freqInterval = Number(raw.freq_interval) || 1;

    const exist = await one(`SELECT id FROM equipment WHERE code = $1`, [code]);
    try {
      if (exist) {
        await query(
          `UPDATE equipment SET name=$2, model=$3, spec=$4, manufacturer=$5, serial_no=$6,
                  location=$7, department_id=$8, purchase_date=$9, maintain_cycle_days=$10,
                  external_cycle_days=$11, freq_type=$12, freq_interval=$13,
                  first_external_date=$14, updated_at=now()
            WHERE code=$1`,
          [code, name, raw.model || null, raw.spec || null, raw.manufacturer || null,
           raw.serial_no || null, raw.location || null, departmentId,
           purchaseDate, maintainDays, externalDays, raw.freq_type || null, freqInterval,
           firstExternalDate]
        );
        updated++;
      } else {
        const e = await one(
          `INSERT INTO equipment (code, name, model, spec, manufacturer, serial_no, location,
                                  department_id, purchase_date, maintain_cycle_days, external_cycle_days,
                                  freq_type, freq_interval, first_external_date, status, status_since)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'running',now()) RETURNING id`,
          [code, name, raw.model || null, raw.spec || null, raw.manufacturer || null,
           raw.serial_no || null, raw.location || null, departmentId,
           purchaseDate, maintainDays, externalDays, raw.freq_type || null, freqInterval,
           firstExternalDate]
        );
        const nextM = addDays(today, maintainDays);
        const nextE = addDays(today, externalDays);
        if (nextM || nextE) {
          await query(
            `UPDATE equipment SET next_maintain_date=COALESCE($2,next_maintain_date),
                    next_external_date=COALESCE($3,next_external_date) WHERE id=$1`,
            [e.id, nextM, nextE]
          );
        }
        inserted++;
      }
    } catch (err) {
      errors.push({ row: rowNo, field: '', msg: err.message });
      failed++;
    }
  }
  return { inserted, updated, failed, errors };
}

/** 导入模板列定义（供前端生成 Excel），参照 doc-ledger 的 {columns:[{key,label,label_vi}]} 范式 */
export function equipmentImportTemplate() {
  return {
    columns: [
      { key: 'code', label: '资产编号', label_vi: 'Mã tài sản' },
      { key: 'name', label: '设备名称', label_vi: 'Tên thiết bị' },
      { key: 'model', label: '型号', label_vi: 'Kiểu mẫu' },
      { key: 'spec', label: '规格/量程', label_vi: 'Thông số' },
      { key: 'manufacturer', label: '制造商', label_vi: 'Nhà sản xuất' },
      { key: 'serial_no', label: '出厂编号', label_vi: 'Số sê-ri' },
      { key: 'location', label: '安装位置', label_vi: 'Vị trí' },
      { key: 'dept_code', label: '使用部门编码', label_vi: 'Mã bộ phận' },
      { key: 'purchase_date', label: '购置日期', label_vi: 'Ngày mua' },
      { key: 'first_external_date', label: '首次外校日期', label_vi: 'Ngày hiệu chuẩn lần đầu' },
      { key: 'maintain_cycle_days', label: '保养周期(天)', label_vi: 'Chu kỳ bảo dưỡng (ngày)' },
      { key: 'external_cycle_days', label: '外校周期(天)', label_vi: 'Chu kỳ hiệu chuẩn (ngày)' },
      { key: 'freq_type', label: '点检频率类型', label_vi: 'Loại tần suất' },
      { key: 'freq_interval', label: '频率间隔', label_vi: 'Khoảng tần suất' },
    ],
  };
}

/**
 * 校准计划/证书列表（S3-T03）。
 * JOIN equipment 取 code/name；支持 equipmentId/status 过滤；返回分页对象。
 * @param {{equipmentId?:number, status?:string, page?:number, pageSize?:number}} opts
 */
export async function listCalibrations({ equipmentId, status, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (equipmentId) { params.push(equipmentId); where += ` AND c.equipment_id = $${params.length}`; }
  if (status) { params.push(status); where += ` AND c.status = $${params.length}`; }

  const selectSql =
    `SELECT c.*, e.code AS equipment_code, e.name AS equipment_name,
            u.real_name AS operator_name
       FROM equipment_calibration c
       JOIN equipment e ON e.id = c.equipment_id
       LEFT JOIN org_user u ON u.id = c.operator_id
      WHERE ${where} ORDER BY c.plan_date DESC NULLS LAST, c.id DESC`;

  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM equipment_calibration c WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 新增校准计划/证书。status 默认 planned。支持 cert_file_id（证书附件 id）。
 * @param {object} data
 */
export async function createCalibration(data = {}) {
  if (!data.equipmentId) throw new Error('请选择设备');
  const eq = await one(`SELECT id FROM equipment WHERE id = $1`, [data.equipmentId]);
  if (!eq) throw new Error('设备不存在');

  return one(
    `INSERT INTO equipment_calibration
       (equipment_id, plan_date, actual_date, calibration_org, certificate_no,
        result, cert_file_id, cost, operator_id, remark, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [data.equipmentId, parseDate(data.planDate) || null, parseDate(data.actualDate) || null,
     data.calibrationOrg || null, data.certificateNo || null, data.result || null,
     data.certFileId || null, data.cost || null, data.operatorId || null,
     data.remark || null, data.status || 'planned']
  );
}

/**
 * 更新校准记录（S3-T03）。
 * - 若 result/actual_date 有值且未显式传 status，则自动置 done。
 * - 当状态变为 done 且有 result 时联动设备：
 *     回写 last_calib_result / calibration_org / calibration_no / last_external_date，
 *     写一条 equipment_history(event_type='calibration')，
 *     按 external_cycle_days 重算 next_external_date。
 * @param {number} id
 * @param {object} data
 */
export async function updateCalibration(id, data = {}) {
  const cur = await one(`SELECT * FROM equipment_calibration WHERE id = $1`, [id]);
  if (!cur) throw new Error('校准记录不存在');

  const actualDate = data.actualDate !== undefined ? parseDate(data.actualDate) : cur.actual_date;
  const result = data.result !== undefined ? data.result : cur.result;
  // 有实测结果/实际日期且未显式给 status → 自动完成
  let status = data.status !== undefined ? data.status
    : (result || actualDate) ? 'done' : cur.status;

  const next = {
    plan_date: data.planDate !== undefined ? parseDate(data.planDate) : cur.plan_date,
    actual_date: actualDate,
    calibration_org: data.calibrationOrg ?? cur.calibration_org,
    certificate_no: data.certificateNo ?? cur.certificate_no,
    result,
    cert_file_id: data.certFileId ?? cur.cert_file_id,
    cost: data.cost ?? cur.cost,
    operator_id: data.operatorId ?? cur.operator_id,
    remark: data.remark ?? cur.remark,
    status,
  };

  const becameDone = status === 'done' && cur.status !== 'done';

  return transaction(async client => {
    await client.query(
      `UPDATE equipment_calibration
          SET plan_date=$2, actual_date=$3, calibration_org=$4, certificate_no=$5,
              result=$6, cert_file_id=$7, cost=$8, operator_id=$9, remark=$10,
              status=$11, updated_at=now()
        WHERE id=$1`,
      [id, next.plan_date, next.actual_date, next.calibration_org, next.certificate_no,
       next.result, next.cert_file_id, next.cost, next.operator_id, next.remark, next.status]
    );

    // 联动：变为已完成且有结果时，回写设备并写履历、重算下次外校
    if (becameDone && next.result) {
      const eq = (await client.query(`SELECT * FROM equipment WHERE id = $1`, [cur.equipment_id])).rows[0];
      const lastExternal = next.actual_date || new Date().toISOString().slice(0, 10);

      // 按外校周期重算下次到期日
      let nextExternal = eq.next_external_date;
      if (eq.external_cycle_days && Number(eq.external_cycle_days) > 0) {
        nextExternal = addDays(lastExternal, eq.external_cycle_days) || eq.next_external_date;
      }

      await client.query(
        `UPDATE equipment
            SET last_calib_result=$2, calibration_org=$3, calibration_no=$4,
                last_external_date=$5, next_external_date=$6, updated_at=now()
          WHERE id=$1`,
        [cur.equipment_id, next.result, next.calibration_org, next.certificate_no,
         lastExternal, nextExternal]
      );

      await client.query(
        `INSERT INTO equipment_history (equipment_id, event_type, event_date, title, content, operator_id)
         VALUES ($1, 'calibration', $2, $3, $4, $5)`,
        [cur.equipment_id, lastExternal,
         `校准完成（${next.result === 'pass' ? '合格' : '不合格'}）`,
         `校准机构：${next.calibration_org || '-'}，证书编号：${next.certificate_no || '-'}，` +
         `结果：${next.result}，下次外校：${nextExternal || '-'}`,
         next.operator_id || null]
      );
    }

    return (await client.query(`SELECT * FROM equipment_calibration WHERE id = $1`, [id])).rows[0];
  });
}

/**
 * 删除校准记录。
 * @param {number} id
 */
export async function deleteCalibration(id) {
  const cur = await one(`SELECT id FROM equipment_calibration WHERE id = $1`, [id]);
  if (!cur) throw new Error('校准记录不存在');
  await query(`DELETE FROM equipment_calibration WHERE id = $1`, [id]);
  return { id };
}

export async function listEquipmentTasks({ assigneeId, status, equipmentId, todo } = {}) {
  const params = [];
  let where = '1=1';
  if (assigneeId) { params.push(assigneeId); where += ` AND t.assignee_id = $${params.length}`; }
  if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
  if (equipmentId) { params.push(equipmentId); where += ` AND t.equipment_id = $${params.length}`; }
  // 契约 API-T1：仅 todo=1 时筛「未完成」。HTTP query 参数是字符串，'0' 亦为真值，
  // 故按数值判定为 1 才算真，避免 todo=0 也过滤。逾期仍由客户端按 plan_date 计算（I-3）。
  if (Number(todo) === 1 || todo === true) { where += ` AND t.status <> 'done'`; }
  return many(
    `SELECT t.*, e.name AS equipment_name, e.code AS equipment_code, u.real_name AS assignee_name,
            tp.name AS template_name, tp.name_vi AS template_name_vi
       FROM equipment_task t
       JOIN equipment e ON e.id = t.equipment_id
       LEFT JOIN org_user u ON u.id = t.assignee_id
       LEFT JOIN equipment_inspect_template tp ON tp.id = t.template_id
      WHERE ${where} ORDER BY t.plan_date DESC`, params
  );
}

/** 单条点检/保养任务（供「点检填写页」按 taskId 深链读取模板与设备） */
export async function getEquipmentTask(id) {
  return one(
    `SELECT t.*, e.name AS equipment_name, e.code AS equipment_code, u.real_name AS assignee_name,
            tp.name AS template_name, tp.name_vi AS template_name_vi
       FROM equipment_task t
       JOIN equipment e ON e.id = t.equipment_id
       LEFT JOIN org_user u ON u.id = t.assignee_id
       LEFT JOIN equipment_inspect_template tp ON tp.id = t.template_id
      WHERE t.id = $1`,
    [id]
  );
}

export async function completeEquipmentTask(id, userId, result) {
  const t = await one(`SELECT * FROM equipment_task WHERE id = $1`, [id]);
  if (!t) throw new Error('任务不存在');
  await query(`UPDATE equipment_task SET status='done', result=$2, done_at=now() WHERE id=$1`, [id, result || null]);
  // 保养完成后更新设备最后保养日期
  if (t.task_type === 'maintain') {
    await query(`UPDATE equipment SET last_maintain_date = current_date WHERE id = $1`, [t.equipment_id]);
  }
  if (t.task_type === 'external') {
    await query(`UPDATE equipment SET last_external_date = current_date WHERE id = $1`, [t.equipment_id]);
  }
  return true;
}

/* ============ IPQC 巡线 ============ */
// 旧 ipqc_checklist 链路（listChecklists/createChecklist/updateChecklist）已随
// 「巡线/首件改造」下线（页面/路由/端点一并移除）；遗留表与 DROP 脚本见
// server/sql/deferred/99_drop_ipqc_fai_legacy.sql。
// 现行实现：services/ipqc-service.js（Excel 导入模板 + 富文本填写）。

/* ============ 统计 ============ */
export async function getAdvancedStats() {
  // 平均审批时长（从提交到完成，单位小时）
  const avg = await one(
    `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (finished_at - submitted_at))/3600)::numeric, 1) AS hours
       FROM flow_instance WHERE status IN ('approved','rejected') AND submitted_at IS NOT NULL AND finished_at IS NOT NULL`
  );
  // 按时率：2小时内完成的占比
  const onTime = await one(
    `SELECT
       COUNT(*) FILTER (WHERE finished_at - submitted_at <= interval '2 hours')::int AS ok,
       COUNT(*)::int AS total
     FROM flow_instance WHERE status IN ('approved','rejected') AND submitted_at IS NOT NULL AND finished_at IS NOT NULL`
  );
  // 近 7 天每日单量
  const daily = await many(
    `SELECT to_char(created_at, 'MM-DD') AS day, COUNT(*)::int AS n
       FROM flow_instance WHERE created_at > now() - interval '7 days'
      GROUP BY 1 ORDER BY 1`
  );
  // 各状态
  const byStatus = await many(`SELECT status, COUNT(*)::int AS n FROM flow_instance GROUP BY status`);
  // 各流程（带 id/code，供前端按流程钻取筛选）
  const byDef = await many(
    `SELECT fd.id, fd.code, fd.name, fd.name_vi, fd.category, COUNT(i.id)::int AS n
       FROM flow_definition fd LEFT JOIN flow_instance i ON i.definition_id = fd.id
      WHERE fd.active = TRUE GROUP BY fd.id ORDER BY n DESC`
  );
  // 各人待办
  const byAssignee = await many(
    `SELECT u.real_name, u.position, COUNT(t.id)::int AS n
       FROM flow_task t JOIN org_user u ON u.id = t.assignee_id
      WHERE t.status = 'assigned' GROUP BY u.id ORDER BY n DESC`
  );
  return {
    avgHours: avg?.hours || 0,
    onTime: onTime?.total ? Math.round((onTime.ok / onTime.total) * 100) : 100,
    onTimeOk: onTime?.ok || 0,
    onTimeTotal: onTime?.total || 0,
    daily, byStatus, byDef, byAssignee,
  };
}

/* ============================================================
 * S3-T04 点检模板 / 点检记录 / 点检任务 —— 「Excel 导入模板 + 富文本填写」模型
 * ------------------------------------------------------------
 * 范式与巡线(IPQC)/首件(FAI)同构（见 services/ipqc-service.js）：
 *   · 模板 = 管理员导入的 Excel → 富文本底稿 HTML（content）+ 原 Excel 归档（source_file_id）
 *   · 记录 = 创建时复制模板 content 作为起点（快照），提交后固定；改模板不影响已存记录
 *   · 不再逐项判定 ok/ng：异常由**人工标注 + 一键上报**设备维修申请单（equip_repair 流程）
 *   · 任务制保留：generateInspectTasks 仅按模板级配置派任务（不再读结构化项表）
 *   · equipment_task 表结构不变 ⇒ 首页日历聚合零影响
 * ============================================================ */

/** DB 侧 today（避免 JS/UTC 日期与库内 current_date 错位） */
async function dbToday() {
  const r = await one(`SELECT current_date::text AS d`);
  return r?.d || new Date().toISOString().slice(0, 10);
}

/** N-2 纵深防御：写库前剥离正文 img src 上的会话 token（与 ipqc-service 等价实现） */
function stripTokens(html) {
  return String(html == null ? '' : html).replace(/(\/api\/files\/[^"'\s?]+)\?token=[^"'\s&]+/g, '$1');
}
/** null 透传 + 剥离（保持"未提供则不改"的 COALESCE 语义） */
function cleanContent(v) {
  return v === undefined || v === null ? null : stripTokens(v);
}
/** 纯文本化（用于异常单描述：剥离 HTML 标签） */
function stripTags(html) {
  return String(html == null ? '' : html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 模板行 SELECT（列表/详情共用；source_file 走 attachment JOIN） */
const INSPECT_TPL_SELECT =
  `SELECT t.id, t.code, t.name, t.name_vi, t.equipment_id,
          e.name AS equipment_name, e.code AS equipment_code,
          t.freq_type, t.freq_interval, t.description, t.description_vi, t.active, t.content,
          t.page_orientation, t.judge_config,
          a.file_path AS source_file_path, a.file_name AS source_file_name
     FROM equipment_inspect_template t
     LEFT JOIN equipment e ON e.id = t.equipment_id
     LEFT JOIN attachment a ON a.id = t.source_file_id`;

/**
 * 点检模板列表（**裸数组**，非 {list,total}）。
 * @param {{equipmentId?:number, active?:boolean|string, keyword?:string}} opts
 */
export async function listInspectTemplates({ equipmentId, active, keyword } = {}) {
  const params = [];
  const where = [];
  if (equipmentId) { params.push(equipmentId); where.push(`t.equipment_id = $${params.length}`); }
  if (active !== undefined && active !== null && active !== '') {
    params.push(active === true || active === 'true' || active === '1');
    where.push(`t.active = $${params.length}`);
  }
  if (keyword) {
    params.push(`%${keyword}%`);
    where.push(`(t.name ILIKE $${params.length} OR COALESCE(t.name_vi,'') ILIKE $${params.length} OR t.code ILIKE $${params.length})`);
  }
  const w = where.length ? where.join(' AND ') : 'TRUE';
  // item_count：结构化项已弃用（底稿即模板），保留契约字段以免前端取值报错
  return many(`${INSPECT_TPL_SELECT} WHERE ${w} ORDER BY t.active DESC, t.id DESC`, params)
    .then(rows => rows.map(r => ({ ...r, item_count: 0 })));
}

/** 模板详情（含完整 content）；未找到返回 null（与 ipqc/fai 详情一致） */
export async function getInspectTemplate(id) {
  const tpl = await one(`${INSPECT_TPL_SELECT} WHERE t.id = $1`, [id]);
  return tpl ? { ...tpl, item_count: 0 } : null;
}

/**
 * 新增点检模板（底稿即模板，不再维护结构化项 / 自定义字段）。
 * @param {object} data
 */
export async function createInspectTemplate(data = {}) {
  if (!data.code) throw new Error('模板编号必填');
  if (!data.name) throw new Error('模板名称必填');
  const dup = await one(`SELECT id FROM equipment_inspect_template WHERE code = $1`, [data.code]);
  if (dup) throw Object.assign(new Error(`模板编号已存在：${data.code}`), { statusCode: 409 });
  return one(
    `INSERT INTO equipment_inspect_template
       (code, name, name_vi, equipment_id, freq_type, freq_interval,
        description, description_vi, content, source_file_id, active, created_by, page_orientation, judge_config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [data.code, data.name, data.nameVi ?? data.name_vi ?? null,
     data.equipmentId ?? data.equipment_id ?? null,
     data.freqType ?? data.freq_type ?? null,
     data.freqInterval ?? data.freq_interval ?? 1,
     data.description ?? null, data.descriptionVi ?? data.description_vi ?? null,
     cleanContent(data.content), data.sourceFileId ?? data.source_file_id ?? null,
     data.active !== false, data.createdBy || null,
     (data.pageOrientation ?? data.page_orientation) === 'landscape' ? 'landscape' : 'portrait',
     normJudgeConfig(data.judgeConfig ?? data.judge_config) ?? null]
  );
}

/**
 * 更新点检模板 —— **部分更新语义**：只更新请求中出现的键；
 * 支持只传 active 做启停（其余字段不动）。
 * @param {number} id
 * @param {object} data
 */
export async function updateInspectTemplate(id, data = {}) {
  const cur = await one(`SELECT * FROM equipment_inspect_template WHERE id = $1`, [id]);
  if (!cur) throw new Error('点检模板不存在');
  if (data.code && data.code !== cur.code) {
    const dup = await one(`SELECT id FROM equipment_inspect_template WHERE code = $1 AND id <> $2`, [data.code, id]);
    if (dup) throw Object.assign(new Error(`模板编号已存在：${data.code}`), { statusCode: 409 });
  }

  const params = [id];
  const sets = [];
  const put = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (data.code !== undefined) put('code', data.code);
  if (data.name !== undefined) put('name', data.name);
  if (data.nameVi !== undefined) put('name_vi', data.nameVi);
  else if (data.name_vi !== undefined) put('name_vi', data.name_vi);
  if (data.equipmentId !== undefined) put('equipment_id', data.equipmentId || null);
  else if (data.equipment_id !== undefined) put('equipment_id', data.equipment_id || null);
  if (data.freqType !== undefined) put('freq_type', data.freqType || null);
  else if (data.freq_type !== undefined) put('freq_type', data.freq_type || null);
  if (data.freqInterval !== undefined) put('freq_interval', data.freqInterval ?? 1);
  else if (data.freq_interval !== undefined) put('freq_interval', data.freq_interval ?? 1);
  if (data.description !== undefined) put('description', data.description);
  if (data.descriptionVi !== undefined) put('description_vi', data.descriptionVi);
  else if (data.description_vi !== undefined) put('description_vi', data.description_vi);
  if (data.content !== undefined) put('content', cleanContent(data.content));
  if (data.sourceFileId !== undefined) put('source_file_id', data.sourceFileId || null);
  else if (data.source_file_id !== undefined) put('source_file_id', data.source_file_id || null);
  if (data.active !== undefined) put('active', !!data.active);
  // 版面方向：只接 portrait / landscape
  if (data.pageOrientation !== undefined || data.page_orientation !== undefined) {
    put('page_orientation', (data.pageOrientation ?? data.page_orientation) === 'landscape' ? 'landscape' : 'portrait');
  }
  if (data.judgeConfig !== undefined || data.judge_config !== undefined) {
    put('judge_config', normJudgeConfig(data.judgeConfig ?? data.judge_config) ?? null);
  }
  sets.push('updated_at = now()');

  return one(
    `UPDATE equipment_inspect_template SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params
  );
}

/**
 * 删除点检模板。
 * 业务裁定：台账类数据不可因删模板而丢失 —— 若模板已被点检记录引用，
 * 禁止删除并返回友好提示（不级联删除记录），避免 PG 原始 FK 错误泄漏到接口层。
 * @param {number} id
 */
export async function deleteInspectTemplate(id) {
  const cur = await one(`SELECT id FROM equipment_inspect_template WHERE id = $1`, [id]);
  if (!cur) throw new Error('点检模板不存在');
  const used = await one(
    `SELECT COUNT(*)::int AS n FROM equipment_inspect_record WHERE template_id = $1`,
    [id]
  );
  if ((used?.n || 0) > 0) {
    throw new Error('该点检模板已被点检记录引用，无法删除（可停用）');
  }
  await query(`DELETE FROM equipment_inspect_template WHERE id = $1`, [id]);
  return { id };
}

/**
 * 点检记录列表（分页契约 {list,total,page,pageSize}，F-11 与其它模块统一）。
 * @param {{status?:string, abnormal?:boolean|string|number, from?:string, to?:string,
 *          equipmentId?:number, templateId?:number, keyword?:string, page?:number, pageSize?:number}} opts
 */
export async function listInspectRecords({ status, abnormal, from, to, equipmentId, templateId, keyword, page, pageSize } = {}) {
  const params = [];
  const where = [];
  if (equipmentId) { params.push(equipmentId); where.push(`r.equipment_id = $${params.length}`); }
  if (templateId) { params.push(templateId); where.push(`r.template_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`r.status = $${params.length}`); }
  // abnormal=1 只看异常；其余值（0/空）不过滤
  if (abnormal === true || abnormal === 'true' || abnormal === 1 || abnormal === '1') {
    where.push('r.abnormal = TRUE');
  }
  if (from) { params.push(dateParam(from, '起始')); where.push(`r.inspected_at::date >= $${params.length}::date`); }
  if (to) { params.push(dateParam(to, '结束')); where.push(`r.inspected_at::date <= $${params.length}::date`); }
  if (keyword) {
    params.push(`%${keyword}%`);
    where.push(`(e.name ILIKE $${params.length} OR e.code ILIKE $${params.length} OR COALESCE(r.template_name,'') ILIKE $${params.length})`);
  }
  const w = where.length ? where.join(' AND ') : 'TRUE';
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(500, Math.max(1, Number(pageSize) || 50));
  const cnt = await one(
    `SELECT COUNT(*)::int AS n
       FROM equipment_inspect_record r
       LEFT JOIN equipment e ON e.id = r.equipment_id
      WHERE ${w}`,
    params
  );
  const list = await many(
    `SELECT r.id, r.equipment_id, e.name AS equipment_name, e.code AS equipment_code,
            r.template_id, r.template_name, r.inspector_id, u.real_name AS inspector_name,
            r.inspected_at, r.status, r.abnormal, r.abnormal_note, r.result, r.repair_instance_id
       FROM equipment_inspect_record r
       LEFT JOIN equipment e ON e.id = r.equipment_id
       LEFT JOIN org_user u ON u.id = r.inspector_id
      WHERE ${w}
      ORDER BY r.inspected_at DESC NULLS LAST, r.id DESC
      LIMIT ${size} OFFSET ${(p - 1) * size}`, params
  );
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/** 点检记录详情（含完整 content） */
export async function getInspectRecord(id) {
  const rec = await one(
    `SELECT r.*, e.name AS equipment_name, e.code AS equipment_code, u.real_name AS inspector_name,
            COALESCE(t.page_orientation, 'portrait') AS page_orientation
       FROM equipment_inspect_record r
       LEFT JOIN equipment e ON e.id = r.equipment_id
       LEFT JOIN org_user u ON u.id = r.inspector_id
       LEFT JOIN equipment_inspect_template t ON t.id = r.template_id
      WHERE r.id = $1`, [id]
  );
  if (!rec) throw new Error('点检记录不存在');
  return rec;
}

/**
 * 新增点检记录（**快照语义**：不再逐项判定、不再自动开维修单）。
 * - content 直接落库；未传则回退复制模板底稿（快照）；
 * - template_name 从模板取一次存快照；equipment_id 缺省取模板的；
 * - status 缺省 'draft'；带 taskId 则把 equipment_task 置 done。
 * @param {object} data
 */
export async function createInspectRecord(data = {}) {
  if (!data.templateId) throw new Error('请选择点检模板');
  const tpl = await one(
    `SELECT id, name, equipment_id, content FROM equipment_inspect_template WHERE id = $1`,
    [data.templateId]
  );
  if (!tpl) throw new Error('点检模板不存在');

  const equipmentId = data.equipmentId ?? tpl.equipment_id;
  if (!equipmentId) throw new Error('请选择设备');
  const submit = data.status === 'submitted';

  return transaction(async client => {
    const row = (await client.query(
      `INSERT INTO equipment_inspect_record
         (equipment_id, template_id, template_name, task_id, inspector_id, inspected_at,
          result, remark, content, status, abnormal, abnormal_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [equipmentId, tpl.id, tpl.name, data.taskId || null, data.inspectorId || null,
       submit ? new Date() : null, data.abnormal ? 'ng' : 'ok', data.remark || null,
       cleanContent(data.content) ?? cleanContent(tpl.content) ?? null,
       submit ? 'submitted' : 'draft', !!data.abnormal, data.abnormalNote || null]
    )).rows[0];
    if (data.taskId) {
      await client.query(
        `UPDATE equipment_task SET status='done', done_at=now() WHERE id=$1 AND status <> 'done'`,
        [data.taskId]
      );
    }
    return row;
  });
}

/**
 * 更新点检记录（草稿续写 / 提交）。已提交记录拒绝再改（admin 例外，参照 ipqc）。
 * @param {number} id
 * @param {number} userId
 * @param {object} data
 * @param {boolean} isAdmin
 */
export async function updateInspectRecord(id, userId, data = {}, isAdmin = false) {
  const cur = await one(`SELECT * FROM equipment_inspect_record WHERE id = $1`, [id]);
  if (!cur) throw new Error('点检记录不存在');
  // 与 ipqc-service.js:235 `updateIpqcRecord` 口径**严格一致**：提交后一律不可改，无 admin 例外
  if (cur.status === 'submitted') throw new Error('记录已提交，不可修改');
  if (!isAdmin && userId && cur.inspector_id && Number(cur.inspector_id) !== Number(userId)) {
    throw new Error('仅本人或管理员可修改该记录');
  }
  const submit = data.status === 'submitted';
  return transaction(async client => {
    const row = (await client.query(
      `UPDATE equipment_inspect_record SET
         content = COALESCE($2, content),
         abnormal = COALESCE($3, abnormal),
         abnormal_note = COALESCE($4, abnormal_note),
         status = CASE WHEN $5 THEN 'submitted' ELSE status END,
         inspected_at = CASE WHEN $5 THEN now() ELSE inspected_at END,
         result = CASE WHEN $3 IS TRUE THEN 'ng' WHEN $5 THEN COALESCE(result,'ok') ELSE result END,
         task_id = COALESCE($6, task_id)
       WHERE id = $1 RETURNING *`,
      [id, cleanContent(data.content),
       (data.abnormal === undefined ? null : !!data.abnormal), data.abnormalNote ?? null,
       submit, data.taskId || null]
    )).rows[0];
    if (data.taskId) {
      await client.query(
        `UPDATE equipment_task SET status='done', done_at=now() WHERE id=$1 AND status <> 'done'`,
        [data.taskId]
      );
    }
    return row;
  });
}

/**
 * 创建设备维修申请单（equip_repair 流程）。
 * 事务外调用：点检记录已落库是事实，流程单失败不回滚，由调用方通过 error 感知。
 */
async function triggerEquipRepairFlow({ userId, title, formData }) {
  if (!userId) {
    const error = '缺少发起人（userId 为空），无法创建设备维修申请单';
    console.warn(`[inspect] ${error}`);
    return { instanceId: null, error };
  }
  try {
    const def = await one(`SELECT id FROM flow_definition WHERE code = 'equip_repair' AND active = TRUE`);
    if (!def) return { instanceId: null, error: '未找到启用的 equip_repair 流程定义' };
    const { createInstance } = await import('./flow-engine.js');
    const inst = await createInstance({ definitionId: def.id, userId, title, formData });
    return { instanceId: inst.id, error: null };
  } catch (err) {
    console.warn(`[inspect] 设备维修申请单创建失败：`, err.message);
    return { instanceId: null, error: err.message };
  }
}

/** 一键上报设备维修申请单（人工口径，幂等：已上报返回 already） */
export async function reportInspectIssue(id, userId) {
  const rec = await one(`SELECT * FROM equipment_inspect_record WHERE id = $1`, [id]);
  if (!rec) throw new Error('点检记录不存在');
  if (rec.repair_instance_id) return { instanceId: rec.repair_instance_id, error: null, already: true };

  const eq = await one(`SELECT code, name FROM equipment WHERE id = $1`, [rec.equipment_id]);
  const inspector = rec.inspector_id
    ? await one(`SELECT real_name FROM org_user WHERE id = $1`, [rec.inspector_id]) : null;
  const inspTime = rec.inspected_at instanceof Date
    ? rec.inspected_at.toISOString().slice(0, 19).replace('T', ' ')
    : String(rec.inspected_at || '').slice(0, 19).replace('T', ' ');

  const { instanceId, error } = await triggerEquipRepairFlow({
    userId,
    title: `点检异常-${eq?.name || ''}(${eq?.code || ''})`,
    // 报修单已改为「多项一起提交」：设备信息进明细行 items，
    // 表头只留报修时间/紧急等级/维修需求（与 equip_repair 的 form_schema 对齐）。
    formData: {
      fault_time: inspTime,
      urgency: 'medium',
      repair_need: '点检发现异常，请维修',
      items: [{
        equip_no: eq?.code || '',
        equip_name: eq?.name || '',
        fault_phenomenon: rec.abnormal_note || stripTags(rec.content).slice(0, 500) || '点检发现异常',
        downtime_hours: '',
      }],
      // 追溯信息（不在表单结构里，但留在 form_data 供查询）
      template_name: rec.template_name || '',
      inspector_name: inspector?.real_name || '',
      inspect_time: inspTime,
    },
  });
  if (instanceId) {
    await query(
      `UPDATE equipment_inspect_record SET repair_instance_id=$2, result='ng', abnormal=TRUE WHERE id=$1`,
      [rec.id, instanceId]
    );
  } else if (userId) {
    await notify(userId, {
      title: `【维修单创建失败】${eq?.name || '设备'}点检异常`,
      content: `点检记录#${rec.id} 上报异常失败：${error}。请联系设备主管手工开单。`,
      link: '/equipment/tasks', category: 'system',
    }).catch(() => {});
  }
  return { instanceId, error };
}

/* ============================================================
 * S3-T04 点检任务生成（供 cron 与手工触发复用）
 * ------------------------------------------------------------
 * 重写：仅按**模板级**配置派任务，**不再读结构化项表**（项级频率已随富文本改造废弃）。
 * 遍历「active=TRUE + equipment_id 非空 + freq_type 非空」的模板 ⇒ 每模板每日 1 条 pending。
 * ============================================================ */

/**
 * 生成点检任务（重写：不读 item 表）。
 * 每模板每日生成 1 条 pending 任务（plan_date = 今天），due_item_ids 置 NULL。
 * 幂等：应用层按 (equipment_id, template_id, task_type='inspect', plan_date, status='pending')
 *   判重（PG 无对应唯一索引），并保留 ON CONFLICT DO NOTHING 兜底。
 * equipment_task 结构未变 ⇒ 首页日历聚合零影响。
 * @param {string} [today] 便于测试注入（YYYY-MM-DD）
 * @returns {Promise<number>} 新建任务数
 */
export async function generateInspectTasks(today) {
  const planDate = parseDate(today) || await dbToday();
  const tpls = await many(
    `SELECT t.id, t.name, t.equipment_id,
            e.code AS equipment_code, e.name AS equipment_name, e.department_id
       FROM equipment_inspect_template t
       JOIN equipment e ON e.id = t.equipment_id
      WHERE t.active = TRUE AND t.equipment_id IS NOT NULL
        AND t.freq_type IS NOT NULL AND t.freq_type <> ''`
  );
  let created = 0;
  for (const tpl of tpls) {
    const dup = await one(
      `SELECT 1 FROM equipment_task
        WHERE equipment_id=$1 AND template_id=$2 AND task_type='inspect'
          AND status='pending' AND plan_date=$3::date LIMIT 1`,
      [tpl.equipment_id, tpl.id, planDate]
    );
    if (dup) continue;

    const staff = await one(
      `SELECT u.id FROM org_user u
         WHERE u.department_id = $1 AND u.active = TRUE ORDER BY u.id LIMIT 1`,
      [tpl.department_id]
    );
    const res = await query(
      `INSERT INTO equipment_task (equipment_id, template_id, task_type, plan_date, assignee_id, status, due_item_ids)
       VALUES ($1,$2,'inspect',$3::date,$4,'pending',NULL)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [tpl.equipment_id, tpl.id, planDate, staff?.id || null]
    );
    if (res.rowCount > 0) {
      created++;
      if (staff?.id) {
        await notify(staff.id, {
          title: `【点检任务】${tpl.name}`,
          content: `设备「${tpl.equipment_name}」（${tpl.equipment_code}）点检任务已生成（计划 ${planDate}），任务号 #${res.rows[0].id}。`,
          link: `/equipment/inspect-fill?taskId=${res.rows[0].id}`,
          category: 'todo',
        });
      }
    }
  }
  return created;
}

/**
 * 设备执行率 / 异常率报表（S3-T04）。
 *
 * 时区安全：默认区间基于 **DB 的 current_date**（而非 JS 的 UTC 日期），
 * 避免「上海已是次日、UTC 仍是前一天」导致当天数据漏统计；
 * 调用方传 from/to 时一律 `::date` 显式转型，保证与 `xxx::date` 边界对齐。
 * @param {{from?:string, to?:string}} opts 默认近 30 天（含今天）
 */
export async function getEquipmentStats({ from, to } = {}) {
  // 区间表达式：未传时直接用 DB current_date 推导（完全绕开 JS/UTC 时区）
  const hasRange = !!from || !!to;
  let cond, params;
  if (hasRange) {
    // 显式 ::date 转型，避免字符串被 pg 当 timestamp 解析产生 8 小时错位
    params = [from || null, to || null];
    cond = (col) => {
      // 命中：>= from（若给）且 <= to（若给）
      const parts = [];
      if (from) parts.push(`${col} >= $1::date`);
      if (to) parts.push(`${col} <= $2::date`);
      return parts.length ? parts.join(' AND ') : 'TRUE';
    };
  } else {
    // 默认近 30 天：current_date - 29 ~ current_date（含今天）
    params = [];
    cond = (col) => `${col} BETWEEN current_date - 29 AND current_date`;
  }

  // 任务完成率（按 task_type 分组）
  const taskRows = await many(
    `SELECT task_type,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status='done')::int AS done,
            COUNT(*) FILTER (WHERE status='pending')::int AS pending,
            COUNT(*) FILTER (WHERE status='pending' AND plan_date < current_date)::int AS overdue
       FROM equipment_task
      WHERE ${cond('plan_date')}
      GROUP BY task_type`,
    params
  );
  const taskStats = { applicable: true, total: 0, done: 0, pending: 0, overdue: 0, completionRate: 0, byType: taskRows };
  for (const r of taskRows) {
    taskStats.total += r.total; taskStats.done += r.done;
    taskStats.pending += r.pending; taskStats.overdue += r.overdue;
  }
  taskStats.completionRate = taskStats.total ? Math.round((taskStats.done / taskStats.total) * 100) : 0;

  // 点检合格率（陈旧口径：按 result 列；保留给既有报表消费方，勿删）
  const insp = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE result='ok')::int AS ok,
            COUNT(*) FILTER (WHERE result='ng')::int AS ng
       FROM equipment_inspect_record
      WHERE ${cond('inspected_at::date')}`,
    params
  );
  const inspectStats = {
    total: insp?.total || 0, ok: insp?.ok || 0, ng: insp?.ng || 0,
    okRate: insp?.total ? Math.round((insp.ok / insp.total) * 100) : 0,
  };

  // 点检合格率 / 异常率（**人工上报口径**：仅已提交，异常 = 已上报维修单）
  const inspRep = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE repair_instance_id IS NULL)::int AS ok,
            COUNT(*) FILTER (WHERE repair_instance_id IS NOT NULL)::int AS ng
       FROM equipment_inspect_record
      WHERE status = 'submitted' AND ${cond('inspected_at::date')}`,
    params
  );
  const inspectionStats = {
    applicable: true,
    total: inspRep?.total || 0, ok: inspRep?.ok || 0, ng: inspRep?.ng || 0,
    okRate: inspRep?.total ? Math.round((inspRep.ok / inspRep.total) * 100) : 0,
    ngRate: inspRep?.total ? Math.round((inspRep.ng / inspRep.total) * 100) : 0,
    metric: 'reported',
  };

  // 异常关闭率（人工上报口径）：分母 = 已上报维修单的点检记录，分子 = 流程单已关闭态
  const closure = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE fi.status IN ('completed','archived'))::int AS closed
       FROM equipment_inspect_record r
       JOIN flow_instance fi ON fi.id = r.repair_instance_id
      WHERE r.status = 'submitted' AND ${cond('r.inspected_at::date')}`,
    params
  );
  const closureRate = {
    total: closure?.total || 0, closed: closure?.closed || 0,
    open: (closure?.total || 0) - (closure?.closed || 0),
    rate: closure?.total ? Math.round((closure.closed / closure.total) * 100) : 0,
    scope: 'reported_only',
  };

  // 校准完成率
  const cal = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status='done')::int AS done,
            COUNT(*) FILTER (WHERE status='planned')::int AS planned,
            COUNT(*) FILTER (WHERE status NOT IN ('done') AND plan_date < current_date)::int AS overdue
       FROM equipment_calibration
      WHERE ${cond('plan_date')}`,
    params
  );
  const calibrationStats = {
    total: cal?.total || 0, done: cal?.done || 0,
    planned: cal?.planned || 0, overdue: cal?.overdue || 0,
  };

  // 异常最多设备 TOP
  const topNgEquipment = await many(
    `SELECT r.equipment_id, e.code, e.name, COUNT(*)::int AS ng_count
       FROM equipment_inspect_record r
       JOIN equipment e ON e.id = r.equipment_id
      WHERE r.result = 'ng' AND ${cond('r.inspected_at::date')}
      GROUP BY r.equipment_id, e.code, e.name
      ORDER BY ng_count DESC LIMIT 10`,
    params
  );

  /* ---- S3-T05 报表深化（向后兼容：旧字段不动，仅新增） ---- */

  // MTTR：equip_repair 类流程单，从建单→终态完成的平均时长（小时 + 天）。
  // 口径：flow_definition.code='equip_repair' 且已完成（finished_at 非空）；
  //       以 created_at 落入查询区间过滤（与 cond 生成器一致）。
  const mttrRow = await one(
    `SELECT COUNT(*)::int AS cnt,
            AVG(EXTRACT(EPOCH FROM (fi.finished_at - fi.created_at))/3600)::numeric AS avg_hours
       FROM flow_instance fi
       JOIN flow_definition fd ON fd.id = fi.definition_id
      WHERE fd.code = 'equip_repair' AND fi.finished_at IS NOT NULL
        AND ${cond('fi.created_at::date')}`,
    params
  );
  const avgHours = mttrRow?.avg_hours != null ? Number(mttrRow.avg_hours) : null;
  const mttr = {
    count: mttrRow?.cnt || 0,
    avgHours: avgHours != null ? Math.round(avgHours * 10) / 10 : 0,
    avgDays: avgHours != null ? Math.round((avgHours / 24) * 10) / 10 : 0,
  };

  // 设备故障 / 维修次数 TOP：按 equipment_history 的维修类事件聚合
  // （含 event_type IN ('repair','repair_done')；两者同一实例只算一条，因为终态是 UPDATE 而非新增）。
  const topRepairEquipment = await many(
    `SELECT h.equipment_id, e.code, e.name, COUNT(*)::int AS repair_count
       FROM equipment_history h
       JOIN equipment e ON e.id = h.equipment_id
      WHERE h.event_type IN ('repair','repair_done')
        AND ${cond('h.event_date')}
      GROUP BY h.equipment_id, e.code, e.name
      ORDER BY repair_count DESC LIMIT 10`,
    params
  );

  // 校准到期分布：未来 30/60/90 天内到期数量分桶（基于 plan_date，相对 DB current_date）
  const calBucket = await one(
    `SELECT
       COUNT(*) FILTER (WHERE plan_date BETWEEN current_date AND current_date + 30)::int AS d30,
       COUNT(*) FILTER (WHERE plan_date BETWEEN current_date + 31 AND current_date + 60)::int AS d60,
       COUNT(*) FILTER (WHERE plan_date BETWEEN current_date + 61 AND current_date + 90)::int AS d90,
       COUNT(*) FILTER (WHERE plan_date < current_date)::int AS overdue
       FROM equipment_calibration
      WHERE status <> 'done'`
  );
  const calibrationExpiry = {
    within30: calBucket?.d30 || 0,
    within60: calBucket?.d60 || 0,
    within90: calBucket?.d90 || 0,
    overdue: calBucket?.overdue || 0,
  };

  return {
    from: from || null, to: to || null, rangeMode: hasRange ? 'explicit' : 'last30d',
    taskStats, inspectStats, calibrationStats, topNgEquipment,
    // 点检富文本改造：人工上报口径（新增，前端契约字段）
    inspectionStats, closureRate,
    // S3-T05 新增
    mttr, topRepairEquipment, calibrationExpiry,
  };
}

/* ============================================================
 * S7 知识库增强：点赞 / 收藏 / 我的收藏 / 全文检索
 * 说明：保留现有 listKnowledge 不动，新增独立函数。
 * ============================================================ */

/**
 * 点赞切换（toggle）。维护 knowledge_doc.like_count 冗余计数。
 * @param {number} docId
 * @param {number} userId
 * @returns {Promise<{liked:boolean, likeCount:number}>}
 */
export async function likeKnowledge(docId, userId) {
  if (!docId || !userId) throw new Error('参数不完整');
  const doc = await one(`SELECT id FROM knowledge_doc WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');

  const existed = await one(
    `SELECT id FROM knowledge_like WHERE doc_id = $1 AND user_id = $2`,
    [docId, userId]
  );
  let liked;
  if (existed) {
    await query(`DELETE FROM knowledge_like WHERE id = $1`, [existed.id]);
    await query(`UPDATE knowledge_doc SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, [docId]);
    liked = false;
  } else {
    await query(
      `INSERT INTO knowledge_like (doc_id, user_id) VALUES ($1,$2) ON CONFLICT (doc_id, user_id) DO NOTHING`,
      [docId, userId]
    );
    await query(`UPDATE knowledge_doc SET like_count = like_count + 1 WHERE id = $1`, [docId]);
    liked = true;
  }
  const c = await one(`SELECT like_count FROM knowledge_doc WHERE id = $1`, [docId]);
  return { liked, likeCount: c?.like_count || 0 };
}

/**
 * 收藏切换（toggle）。维护 knowledge_doc.favorite_count。
 * @param {number} docId
 * @param {number} userId
 * @returns {Promise<{favorited:boolean, favoriteCount:number}>}
 */
export async function favoriteKnowledge(docId, userId) {
  if (!docId || !userId) throw new Error('参数不完整');
  const doc = await one(`SELECT id FROM knowledge_doc WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');

  const existed = await one(
    `SELECT id FROM knowledge_favorite WHERE doc_id = $1 AND user_id = $2`,
    [docId, userId]
  );
  let favorited;
  if (existed) {
    await query(`DELETE FROM knowledge_favorite WHERE id = $1`, [existed.id]);
    await query(`UPDATE knowledge_doc SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = $1`, [docId]);
    favorited = false;
  } else {
    await query(
      `INSERT INTO knowledge_favorite (doc_id, user_id) VALUES ($1,$2) ON CONFLICT (doc_id, user_id) DO NOTHING`,
      [docId, userId]
    );
    await query(`UPDATE knowledge_doc SET favorite_count = favorite_count + 1 WHERE id = $1`, [docId]);
    favorited = true;
  }
  const c = await one(`SELECT favorite_count FROM knowledge_doc WHERE id = $1`, [docId]);
  return { favorited, favoriteCount: c?.favorite_count || 0 };
}

/**
 * 我的收藏列表（分页）。
 * @param {number} userId
 * @param {{page?:number,pageSize?:number}} opts
 */
export async function listFavorites(userId, { page, pageSize } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM knowledge_favorite WHERE user_id = $1`, [userId]);
  const list = await many(
    `SELECT k.*, f.created_at AS favorited_at, u.real_name AS uploader_name,
            TRUE AS favorited,
            EXISTS (SELECT 1 FROM knowledge_like kl
                     WHERE kl.doc_id = k.id AND kl.user_id = $1) AS liked
       FROM knowledge_favorite f
       JOIN knowledge_doc k ON k.id = f.doc_id
       LEFT JOIN org_user u ON u.id = k.uploader_id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
      LIMIT ${size} OFFSET ${(p - 1) * size}`,
    [userId]
  );
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 我的点赞列表（分页）。
 * @param {number} userId
 * @param {{page?:number,pageSize?:number}} opts
 */
export async function listMyLikes(userId, { page, pageSize } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM knowledge_like WHERE user_id = $1`, [userId]);
  const list = await many(
    `SELECT k.*, l.created_at AS liked_at, u.real_name AS uploader_name,
            TRUE AS liked,
            EXISTS (SELECT 1 FROM knowledge_favorite kf
                     WHERE kf.doc_id = k.id AND kf.user_id = $1) AS favorited
       FROM knowledge_like l
       JOIN knowledge_doc k ON k.id = l.doc_id
       LEFT JOIN org_user u ON u.id = k.uploader_id
      WHERE l.user_id = $1
      ORDER BY l.created_at DESC
      LIMIT ${size} OFFSET ${(p - 1) * size}`,
    [userId]
  );
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 知识库全文检索（title + description）。
 * 采用 ILIKE 与 to_tsvector 全文 OR 组合，兼容中文（simple 分词下中文走 ILIKE 兜底）。
 * 仅返回已开放（approved）的文档（与共享语义一致）；ing 状态过滤保留 status 入参。
 * @param {{keyword?:string, category?:string, status?:string, page?:number, pageSize?:number}} opts
 */
export async function searchKnowledge({ keyword, category, status, page, pageSize, userId } = {}) {
  const params = [];
  // 与主列表口径一致：默认只搜当前生效版本，历史版本不进检索结果。
  let where = 'k.is_current = TRUE';
  if (status) { params.push(status); where += ` AND k.status = $${params.length}`; }
  if (category) { params.push(category); where += ` AND k.category = $${params.length}`; }
  if (keyword) {
    const kw = String(keyword).trim();
    params.push(`%${kw}%`);                       // ILIKE 兜底（中文分词弱）
    const likeIdx = params.length;
    params.push(kw || 'zzzznomatch');             // F-04：websearch 容忍特殊字符，不再 500
    const tsIdx = params.length;
    where += ` AND (k.title ILIKE $${likeIdx}
                    OR COALESCE(k.description,'') ILIKE $${likeIdx}
                    OR to_tsvector('simple', k.title || ' ' || COALESCE(k.description,''))
                       @@ websearch_to_tsquery('simple', $${tsIdx}))`;
  }

  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM knowledge_doc k WHERE ${where}`, params);
  // 当前用户维度：是否已点赞/已收藏（count 之后再追加参数，避免污染 count）
  const uid = userId ?? null;
  const likeIdx = params.push(uid);
  const favIdx = params.push(uid);
  const list = await many(
    `SELECT k.*, u.real_name AS uploader_name, a.real_name AS approver_name,
            EXISTS (SELECT 1 FROM knowledge_like kl
                     WHERE kl.doc_id = k.id AND kl.user_id = $${likeIdx}) AS liked,
            EXISTS (SELECT 1 FROM knowledge_favorite kf
                     WHERE kf.doc_id = k.id AND kf.user_id = $${favIdx}) AS favorited
       FROM knowledge_doc k
       LEFT JOIN org_user u ON u.id = k.uploader_id
       LEFT JOIN org_user a ON a.id = k.approver_id
      WHERE ${where} ORDER BY k.created_at DESC
      LIMIT ${size} OFFSET ${(p - 1) * size}`,
    params
  );
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}

/* ============ 设备履历时间线（S3 补：读 equipment_history） ============ */
/**
 * 设备履历时间线。按 event_date 倒序，join 字典拿中越文事件名。
 * @param {number} equipmentId
 * @param {{eventType?:string, page?:number, pageSize?:number}} [opts]
 * @returns {Promise<{list:object[], total:number, page:number, pageSize:number}>}
 */
export async function listEquipmentHistory(equipmentId, { eventType, page, pageSize } = {}) {
  if (!equipmentId) throw new Error('缺少设备 id');
  const eq = await one(`SELECT id, code, name FROM equipment WHERE id = $1`, [equipmentId]);
  if (!eq) throw new Error('设备不存在');

  const params = [equipmentId];
  let where = 'h.equipment_id = $1';
  if (eventType) { params.push(eventType); where += ` AND h.event_type = $${params.length}`; }

  const selectSql =
    `SELECT h.id, h.equipment_id, h.event_type, h.event_date,
            h.title, h.content, h.cost, h.downtime_hours,
            h.source_instance_id, h.ref_task_id, h.ref_record_id, h.created_at,
            u.real_name AS operator_name,
            d.name_zh AS event_type_name_zh, d.name_vi AS event_type_name_vi
       FROM equipment_history h
       LEFT JOIN org_user u ON u.id = h.operator_id
       LEFT JOIN sys_i18n_dict d
              ON d.dict_type = 'equip_event_type' AND d.code = h.event_type
      WHERE ${where} ORDER BY h.event_date DESC, h.id DESC`;

  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 50);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM equipment_history h WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { equipment: eq, list, total: cnt?.n || 0, page: p, pageSize: size };
}

/**
 * 停用/报废设备扫码留痕（设计 P-402）：仅异常状态设备需留痕，正常设备扫码为常规点检、不写。
 * 幂等无关（每次扫码都是一次独立行为，如实记录）。
 * @param {number} equipmentId
 * @param {number} userId
 * @param {{scene?:string}} [opts]
 * @returns {Promise<{logged:true}>}
 */
export async function logEquipmentScan(equipmentId, userId, { scene } = {}) {
  // 预留字段（契约 §4.3 S13），暂不参与逻辑
  const eq = await one(`SELECT id, status FROM equipment WHERE id = $1`, [equipmentId]);
  if (!eq) { const e = new Error('设备不存在'); e.statusCode = 404; throw e; }
  if (!['suspended', 'scrapped'].includes(eq.status)) {
    const e = new Error('设备当前状态无需留痕'); e.statusCode = 400; throw e;
  }
  await query(
    `INSERT INTO equipment_history (equipment_id, event_type, title, content, operator_id)
     VALUES ($1, 'scan_abnormal', '设备停用/报废扫码', $2, $3)`,
    [equipmentId, `来源：扫码点检；设备状态：${eq.status}`, userId]
  );
  return { logged: true };
}

/* ============ 外校分级预警发送日志（S3 补：读 equipment_alert_log） ============ */
/**
 * 预警发送日志列表。支持 equipmentId / tierDays(days_left) / 日期区间筛选。
 * 时区安全：未传区间时不做时间过滤；区间筛选一律 ::date，默认不推导 current_date 以免漏历史。
 * @param {{equipmentId?:number, daysLeft?:number|string, tierDays?:number|string, start?:string, end?:string, page?:number, pageSize?:number}} [q]
 */
export async function listEquipmentAlerts({ equipmentId, daysLeft, tierDays, start, end, page, pageSize } = {}) {
  const params = [];
  let where = '1=1';
  if (equipmentId) { params.push(equipmentId); where += ` AND l.equipment_id = $${params.length}`; }
  const tier = tierDays ?? daysLeft;
  if (tier !== undefined && tier !== null && tier !== '') {
    params.push(Number(tier)); where += ` AND l.days_left = $${params.length}`;
  }
  // 日期区间：按 sent_at 过滤，显式 ::date 避免时区错位
  if (start) { params.push(start); where += ` AND l.sent_at::date >= $${params.length}::date`; }
  if (end) { params.push(end); where += ` AND l.sent_at::date <= $${params.length}::date`; }

  const selectSql =
    `SELECT l.id, l.equipment_id, l.alert_type, l.days_left, l.target_role,
            l.sent_to, l.sent_at,
            e.code AS equipment_code, e.name AS equipment_name,
            e.next_external_date
       FROM equipment_alert_log l
       JOIN equipment e ON e.id = l.equipment_id
      WHERE ${where} ORDER BY l.sent_at DESC, l.id DESC`;

  const p = Math.max(1, Number(page) || 1);
  const size = Math.max(1, Number(pageSize) || 20);
  const cnt = await one(`SELECT COUNT(*)::int AS n FROM equipment_alert_log l WHERE ${where}`, params);
  const list = await many(`${selectSql} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return { list, total: cnt?.n || 0, page: p, pageSize: size };
}
