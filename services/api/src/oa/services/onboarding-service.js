// ============================================================
// onboarding-service —— 员工入职登记 + 确认入职自动建号
//
// 业务动线（现场确认）：
//   人事录入入职信息 →（可选）先存草稿核对 → 点「确认入职」→ 自动创建 org_user 账号
//   → 自动出现在「组织与人员」员工列表，并把工号/入职日期回写到登记记录。
//
// 关键设计：
//   1) **两步走**：存登记 ≠ 建号。确认前随时可改可作废，避免打错字就产生废账号。
//   2) **幂等/防重**：确认时对登记行 `FOR UPDATE` 加锁 + 校验 status，双击不会建出两个号。
//   3) **工号串行**：`nextEmployeeNo` 本身无并发保护，这里在事务内加 pg advisory lock，
//      保证并发确认时工号不撞唯一索引（与批量导入的串行口径一致）。
//   4) 建号失败**整单回滚**：绝不出现"账号建了但登记还是待入职"的半截状态。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { config } from '../config/index.js';
import { maskIdCard } from './sensitive-service.js';

const FIELD_MAP = {
  realName: 'real_name',
  gender: 'gender',
  birthDate: 'birth_date',
  idCardNo: 'id_card_no',
  phone: 'phone',
  email: 'email',
  education: 'education',
  deptId: 'dept_id',
  positionCode: 'position_code',
  hireDate: 'hire_date',
  probationDays: 'probation_days',
  emergencyContact: 'emergency_contact',
  emergencyPhone: 'emergency_phone',
  remark: 'remark',
  employeeNo: 'employee_no',
};

function bad(msg, statusCode = 400) {
  return Object.assign(new Error(msg), { statusCode, isBiz: true });
}

/**
 * 对外输出前统一脱敏：**身份证号明文永远不随列表/详情返回**。
 * 只给掩码 + hasIdCard 标记；要看明文必须走 /reveal 的二次认证。
 */
function maskOut(row) {
  if (!row) return row;
  const raw = row.id_card_no;
  const out = { ...row, id_card_masked: raw ? maskIdCard(raw) : '', has_id_card: !!raw };
  delete out.id_card_no;
  return out;
}

function norm(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 日期规范化（hire_date / birth_date 都是 PG `date` 列）。
 *
 * 现场问题（2026-10-27）：Excel 里「入职日期」是日期格式时，前端 SheetJS
 * `sheet_to_json` 不开 cellDates 会把它解析成 1900 序列号数字（如 46163），
 * 只做 trim 的 `norm()` 会把这个数字原样塞进 date 列，PG 直接抛
 * `invalid input syntax for type date`，整行导入失败。
 *
 * 口径：序列号 / 日-月-年 / 占位符 → `YYYY-MM-DD` 或 null；
 * 认不出来的**原样返回**让 PG 报错，绝不静默清空（避免把错值洗成空值更难查）。
 */
function normDate(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    // 20000~80000 覆盖 1954~2119 年，是 Excel 序列号的合理区间
    if (v >= 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }
    return String(v);
  }
  const s = String(v).trim();
  if (!s) return null;
  // 纯占位符（"." / "-" / "—" / "/"）：Excel 里"先画个记号"的格子，按空处理
  if (/^[.\-\u2014\/]+$/.test(s)) return null;
  let m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    // 越南习惯「日/月/年」；第二段 >12 说明实际是「月/日/年」（兼容美式文本）
    const swap = b > 12 && a <= 12;
    return `${m[3]}-${pad2(swap ? a : b)}-${pad2(swap ? b : a)}`;
  }
  return s;
}

/** 只允许白名单字段入库（绝不拼前端任意列名） */
function pickFields(body, { partial }) {
  const cols = [];
  const vals = [];
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    if (!(key in (body || {}))) {
      if (partial) continue;
      // 试用期直接写 NULL 会盖掉列默认值，这里显式给普通员工的 6 天
      cols.push(col); vals.push(key === 'probationDays' ? 6 : null);
      continue;
    }
    let v = body[key];
    // 试用期按天（越南劳动法第 25 条）：留空按普通员工默认 6 天，0 明确表示无试用期。
    // 注意 Number(null) === 0，必须先判空再转数字，否则"留空"会被错当成"无试用期"。
    if (key === 'probationDays') {
      if (v === null || v === undefined || v === '') v = 6;
      else {
        const n = Number(v);
        v = Number.isFinite(n) ? Math.trunc(n) : 6;
      }
    } else if (key === 'deptId') v = v === null || v === '' ? null : Number(v);
    else if (key === 'hireDate' || key === 'birthDate') v = normDate(v);
    else v = norm(v);
    cols.push(col); vals.push(v);
  }
  return { cols, vals };
}

/** 事务内取下一个工号（DT + 4 位序号），与 auth.nextEmployeeNo 同口径 */
async function nextEmployeeNoTx(client) {
  const r = await client.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_no, '[^0-9]', '', 'g'), '')::int), 0) AS max_no
       FROM org_user WHERE employee_no ~ '^DT[0-9]+$'`
  );
  const next = Number(r.rows[0]?.max_no || 0) + 1;
  return `DT${String(next).padStart(4, '0')}`;
}

/** 列表：默认按入职日期倒序，状态可筛 */
export async function listOnboardings({ status, keyword, page = 1, size = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(100, Math.max(1, Number(size) || 20));
  const params = [];
  const cond = [];
  if (status) { params.push(status); cond.push(`o.status = $${params.length}`); }
  if (keyword) {
    params.push(`%${keyword}%`);
    cond.push(`(o.real_name ILIKE $${params.length} OR o.phone ILIKE $${params.length} OR o.employee_no ILIKE $${params.length})`);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const total = Number((await one(
    `SELECT count(*)::int n FROM employee_onboarding o ${where}`, params
  ))?.n || 0);

  const list = await many(
    `SELECT o.*, d.name AS dept_name, u.username, u.active AS user_active,
            pos.name_zh AS position_name, cb.real_name AS created_by_name
       FROM employee_onboarding o
       LEFT JOIN org_department d ON d.id = o.dept_id
       LEFT JOIN org_user u ON u.id = o.user_id
       LEFT JOIN sys_i18n_dict pos ON pos.dict_type = 'position' AND pos.code = o.position_code
       LEFT JOIN org_user cb ON cb.id = o.created_by
       ${where}
      ORDER BY COALESCE(o.hire_date, o.created_at::date) DESC, o.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, s, (p - 1) * s]
  );
  return { list: list.map(maskOut), total, page: p, size: s };
}

export async function getOnboarding(id) {
  const row = await one(
    `SELECT o.*, d.name AS dept_name, u.username, pos.name_zh AS position_name
       FROM employee_onboarding o
       LEFT JOIN org_department d ON d.id = o.dept_id
       LEFT JOIN org_user u ON u.id = o.user_id
       LEFT JOIN sys_i18n_dict pos ON pos.dict_type = 'position' AND pos.code = o.position_code
      WHERE o.id = $1`,
    [id]
  );
  if (!row) throw bad('入职登记不存在', 404);
  return maskOut(row);
}

/**
 * 工号重复登记预检：同一工号在「未作废」的登记里只能有一条。
 *
 * 为什么必须有：确认入职时账号名 = 工号，一旦出现两条同工号登记，
 * 先确认的建号成功，后一条点「确认入职」就必然撞 org_user.username，
 * 报出来的还是"请修改工号"这种误导性提示（人本来就不该有第二个工号）。
 */
async function assertEmployeeNoFree(employeeNo, excludeId = null) {
  if (!employeeNo) return;
  const dup = await one(
    `SELECT id, status, real_name FROM employee_onboarding
      WHERE employee_no = $1 AND status <> 'cancelled'
        AND ($2::int IS NULL OR id <> $2::int)
      ORDER BY id LIMIT 1`,
    [employeeNo, excludeId]
  );
  if (!dup) return;
  // 两种情形分开说（也是给三语词库留可翻译的固定句式，别把状态词拼进句子中间）
  if (dup.status === 'active') {
    throw bad(`工号 ${employeeNo} 已被登记 #${dup.id}（${dup.real_name}）办理入职，不能重复登记`);
  }
  throw bad(`工号 ${employeeNo} 有未确认的登记 #${dup.id}（${dup.real_name}），不能重复登记；如确需重建请先作废原登记`);
}

/** 新建登记（不建号） */
export async function createOnboarding(body = {}, operatorId = null) {
  const realName = norm(body.realName);
  if (!realName) throw bad('请填写姓名');
  const { cols, vals } = pickFields({ ...body, realName }, { partial: false });

  // 身份证唯一性预检（给出可读提示，而不是抛唯一索引冲突）
  const idCard = norm(body.idCardNo);
  if (idCard) {
    const dup = await one(`SELECT id, real_name FROM employee_onboarding WHERE id_card_no = $1`, [idCard]);
    if (dup) throw bad(`身份证号已被「${dup.real_name}」的入职登记占用`);
  }

  // 工号唯一性预检（未作废记录内）：
  // 现场问题（2026-10-24）——同一份 Excel 导入两遍，同一工号留下两条登记，
  // 先确认的那条建了号，后一条永远卡在「确认入职报工号已存在」。
  // 必须在登记入口就拦住，而不是等到确认入职才发现。
  await assertEmployeeNoFree(norm(body.employeeNo));

  const res = await query(
    `INSERT INTO employee_onboarding (status, created_by, ${cols.join(',')})
     VALUES ('draft', $1, ${cols.map((_, i) => `$${i + 2}`).join(',')})
     RETURNING *`,
    [operatorId, ...vals]
  );
  return maskOut(res.rows[0]);
}

/** 修改登记（仅待入职可改） */
export async function updateOnboarding(id, body = {}) {
  const cur = await one(`SELECT * FROM employee_onboarding WHERE id = $1`, [id]);
  if (!cur) throw bad('入职登记不存在', 404);
  if (cur.status === 'active') throw bad('该员工已入职建号，请到「组织与人员」修改员工资料');
  if (cur.status === 'cancelled') throw bad('该登记已作废，不能修改');

  // 身份证明文不回显（列表/详情只给掩码），所以编辑时该字段通常为空。
  // 空的 idCardNo 一律视为"不修改"，否则每次改个手机号就会把身份证清空。
  // 真要清空必须显式传 clearIdCard=true（界面上不提供）。
  const body2 = { ...body };
  if (body2.idCardNo !== undefined && !norm(body2.idCardNo)) {
    if (body2.clearIdCard === true) body2.idCardNo = null;
    else delete body2.idCardNo;
  }

  const idCard = norm(body2.idCardNo);
  if (idCard && idCard !== cur.id_card_no) {
    const dup = await one(`SELECT id, real_name FROM employee_onboarding WHERE id_card_no = $1 AND id <> $2`, [idCard, id]);
    if (dup) throw bad(`身份证号已被「${dup.real_name}」的入职登记占用`);
  }
  if (body2.realName !== undefined && !norm(body2.realName)) throw bad('请填写姓名');

  // 改工号也要查重：否则可以把一条登记改成另一条的工号，重新制造出同工号双登记
  if (body2.employeeNo !== undefined) {
    const newNo = norm(body2.employeeNo);
    if (newNo && newNo !== cur.employee_no) await assertEmployeeNoFree(newNo, id);
  }

  const { cols, vals } = pickFields(body2, { partial: true });
  if (!cols.length) return maskOut(cur);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const res = await query(
    `UPDATE employee_onboarding SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...vals]
  );
  return maskOut(res.rows[0]);
}

/**
 * 批量导入入职登记（存量在职员工一次性录入）。
 *
 * 只建「待入职」登记，**不自动建号** —— 存量员工的部门/岗位/工号往往要人工核一遍，
 * 直接建号容易批量生成一堆错账号。导入后在列表里多选「批量确认入职」即可建号。
 *
 * 逐行串行处理（createOnboarding 内部会查重），单行失败不影响其它行，
 * 全部失败原因带行号返回给前端预览核对。
 */
export async function importOnboardings(rows, operatorId = null) {
  const list = Array.isArray(rows) ? rows : [];
  const errors = [];
  let created = 0;

  for (let i = 0; i < list.length; i++) {
    const raw = list[i] || {};
    const rowNo = i + 2;   // Excel 第 1 行是表头
    try {
      const realName = norm(raw.realName);
      if (!realName) throw bad('姓名必填');
      if (raw.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw.email).trim())) {
        throw bad(`邮箱格式不正确：${raw.email}`);
      }
      await createOnboarding({ ...raw, realName }, operatorId);
      created++;
    } catch (err) {
      errors.push({ row: rowNo, realName: norm(raw.realName) || '', msg: err.message || String(err) });
    }
  }
  return { created, failed: errors.length, errors };
}

/**
 * 批量确认入职（存量员工导入后一次性建号）。
 * 每条独立事务、独立失败：一条撞车不影响其它人；返回每人结果（工号/失败原因）。
 */
export async function batchConfirmOnboardings(ids, operatorId = null) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  const results = [];
  let ok = 0;
  let linked = 0;   // 账号已存在但没有登记 → 本条接管
  let merged = 0;   // 重复登记 → 已作废并指向真正的入职登记
  for (const id of list) {
    try {
      const r = await confirmOnboarding(id, operatorId);
      ok++;
      if (r.duplicate) merged++;
      else if (r.linked) linked++;
      results.push({
        id, ok: true, realName: r.user.real_name, employeeNo: r.employeeNo,
        linked: !!r.linked, duplicate: !!r.duplicate, mergedInto: r.mergedInto || null,
      });
    } catch (err) {
      results.push({ id, ok: false, msg: err.message || String(err) });
    }
  }
  return {
    total: list.length, success: ok, created: ok - linked - merged, linked, merged,
    failed: list.length - ok, results,
  };
}

/**
 * 确认入职：创建账号（工号 + 初始密码 + 首次登录强制改密），回写登记并置 active。
 * @returns {{ onboarding: object, user: object, employeeNo: string, initialPassword: string }}
 */
export async function confirmOnboarding(id, operatorId = null) {
  const { hashPassword } = await import('./auth.js');
  const initialPassword = config.security.initialPassword;

  const result = await transaction(async (client) => {
    // 行锁：双击/并发确认时，后到者拿到的 status 已不是 draft → 直接拒绝
    const cur = (await client.query(
      `SELECT * FROM employee_onboarding WHERE id = $1 FOR UPDATE`, [id]
    )).rows[0];
    if (!cur) throw bad('入职登记不存在', 404);
    if (cur.status === 'active') throw bad(`该员工已入职（工号 ${cur.employee_no || '—'}），无需重复确认`);
    if (cur.status === 'cancelled') throw bad('该登记已作废，不能确认入职');

    // 工号串行：并发确认时避免撞 org_user.username 唯一索引
    await client.query(`SELECT pg_advisory_xact_lock(65101)`);
    const employeeNo = cur.employee_no || await nextEmployeeNoTx(client);

    const username = employeeNo;

    // 账号已存在分两种情况：
    //  a) 同一人重复登记（同工号同姓名，多为同一份 Excel 导了两遍）
    //  b) 工号被**别人**占着 → 真撞车，必须改工号，报错要说清是谁占的
    const dupUser = (await client.query(
      `SELECT id, username, real_name, active FROM org_user
        WHERE username = $1 OR employee_no = $1 ORDER BY id LIMIT 1`, [username]
    )).rows[0];

    if (dupUser) {
      const samePerson = String(dupUser.real_name || '').trim() === String(cur.real_name || '').trim();
      if (!samePerson) {
        throw bad(`工号 ${username} 已被「${dupUser.real_name}」的账号占用，请修改本次登记里的工号后重试`);
      }

      // 同一人的重复登记，按"这个账号有没有登记记录"分两种收口
      // （uk_onboarding_user 限死：一个账号只能挂一条登记，两条同时挂会违反唯一索引）
      const bound = (await client.query(
        `SELECT id, employee_no FROM employee_onboarding WHERE user_id = $1 AND id <> $2 ORDER BY id LIMIT 1`,
        [dupUser.id, id]
      )).rows[0];

      if (bound) {
        // 账号已由另一条登记办理过入职 → 本条是多余记录：作废并留痕指向真正的那条，
        // 不删数据，状态可回滚；这样"确认入职"不会再报错，也不会把待入职列表越拖越长。
        const note = `重复登记：该员工已由登记 #${bound.id}（工号 ${bound.employee_no || username}）办理入职`;
        const cancelled = (await client.query(
          `UPDATE employee_onboarding
              SET status='cancelled', updated_at=now(),
                  remark = CASE WHEN COALESCE(remark,'') = '' THEN $2 ELSE remark || '；' || $2 END
            WHERE id=$1 RETURNING *`,
          [id, note]
        )).rows[0];
        return {
          onboarding: maskOut(cancelled),
          user: { id: dupUser.id, username: dupUser.username, real_name: dupUser.real_name, employee_no: bound.employee_no || username },
          employeeNo: bound.employee_no || username,
          initialPassword: null,
          duplicate: true,
          mergedInto: { id: bound.id, employeeNo: bound.employee_no || username },
        };
      }

      // 账号存在但没有登记记录（历史导入/建号留下的孤儿账号）→ 本条登记直接接管
      const adopted = (await client.query(
        `UPDATE employee_onboarding
            SET status='active', user_id=$2, employee_no=$3,
                hire_date=COALESCE(hire_date, CURRENT_DATE),
                confirmed_at=now(), confirmed_by=$4, updated_at=now()
          WHERE id=$1 RETURNING *`,
        [id, dupUser.id, username, operatorId]
      )).rows[0];
      return {
        onboarding: maskOut(adopted),
        user: { id: dupUser.id, username: dupUser.username, real_name: dupUser.real_name, employee_no: username },
        employeeNo: username,
        initialPassword: null,
        linked: true,
        accountActive: dupUser.active,
      };
    }

    // 岗位名同步（员工列表按 position 显示中文名）
    let positionName = null;
    if (cur.position_code) {
      const p = (await client.query(
        `SELECT name_zh FROM sys_i18n_dict WHERE dict_type='position' AND code = $1`, [cur.position_code]
      )).rows[0];
      if (!p) throw bad(`岗位编码「${cur.position_code}」不存在，请重新选择岗位`);
      positionName = p.name_zh;
    }

    const hash = await hashPassword(initialPassword);
    // hire_date 必须一起写：年假额度累积、首月递延判定都读 org_user.hire_date，
    // 漏写会让新入职员工额度恒为 0（2026-10-28 RJ127 等 5 人的问题）。
    // 迁移 110 起两侧由触发器双向同步，这里显式写入是为了建号行本身就有值。
    const user = (await client.query(
      `INSERT INTO org_user
         (username, employee_no, password_hash, real_name, email, phone,
          department_id, position, position_code, organization, active, must_change_pwd, hire_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'本公司',TRUE,TRUE,$10::date)
       RETURNING id, username, real_name, employee_no, department_id, position_code, active, hire_date`,
      [username, employeeNo, hash, cur.real_name, cur.email, cur.phone,
       cur.dept_id, positionName, cur.position_code,
       cur.hire_date ? String(cur.hire_date).slice(0, 10) : null]
    )).rows[0];

    // 默认角色：入职建号即授予 employee（flow:submit / flow:view），
    // 否则新员工登录后提不了休假单与 Near Miss（迁移 111 之前 35 个账号全中此坑）。
    await client.query(
      `INSERT INTO sys_user_role (user_id, role_id)
       SELECT $1, r.id FROM sys_role r WHERE r.code = 'employee'
       ON CONFLICT DO NOTHING`,
      [user.id]
    );

    const updated = (await client.query(
      `UPDATE employee_onboarding
          SET status='active', user_id=$2, employee_no=$3,
              hire_date=COALESCE(hire_date, CURRENT_DATE),
              confirmed_at=now(), confirmed_by=$4, updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [id, user.id, employeeNo, operatorId]
    )).rows[0];

    return { onboarding: maskOut(updated), user, employeeNo, initialPassword, linked: false };
  });

  return result;
}

/** 作废登记（仅待入职可作废；已建号请去停用员工账号） */
export async function cancelOnboarding(id) {
  const cur = await one(`SELECT id, status, employee_no FROM employee_onboarding WHERE id = $1`, [id]);
  if (!cur) throw bad('入职登记不存在', 404);
  if (cur.status === 'active') throw bad('该员工已入职建号，请到「组织与人员」停用账号，而不是作废登记');
  if (cur.status === 'cancelled') return { id, status: 'cancelled' };
  await query(`UPDATE employee_onboarding SET status='cancelled', updated_at=now() WHERE id=$1`, [id]);
  return { id, status: 'cancelled' };
}
