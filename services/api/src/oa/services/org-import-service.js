/**
 * S6 - 组织架构 Excel 批量导入服务（人员信息模板）
 *
 * ⚠️ 第 34 轮回退说明：
 *   第 33 轮曾在此文件加入「部门信息 / 岗位信息 / 审批流配置」三张表的重设计
 *   （见《组织架构导入模板（OA审批适配）.xlsx》），因用户决定不做组织架构与
 *   审批流重设计，该部分已**整体移除**（含 flow_routing_rule 矩阵、部门/岗位
 *   扩展列导入）。
 *
 *   本文件现仅保留经长期验证的旧接口（人员信息导入/导出），行为与第 31 轮前一致。
 *
 * 关键纪律：
 *   工号 nextEmployeeNo() 无并发保护 → 导入必须【串行】逐行调用，
 *   否则会撞 org_user.username 唯一索引（23505）。
 */
import { query, many, one } from '../db/index.js';
import { config } from '../config/index.js';
import { recordTransfer } from './org-transfer-service.js';

/** 状态列取值 → active 布尔（中越双语 + 常见英文） */
const INACTIVE_TOKENS = new Set([
  '离职', '停用', '禁用', '辞退', '退休', 'inactive', 'disabled', 'left', 'resigned', 'nghỉ việc',
]);
const ACTIVE_TOKENS = new Set([
  '在职', '启用', '正常', 'active', 'enabled', 'on', 'đang làm việc',
]);

/**
 * 解析状态列 → active 布尔。
 * 默认 TRUE（未填写视为在职/启用）。
 * @param {*} raw 原始状态值
 * @returns {boolean}
 */
function parseActive(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  const v = String(raw).trim().toLowerCase();
  if (INACTIVE_TOKENS.has(v)) return false;
  if (ACTIVE_TOKENS.has(v)) return true;
  if (v === 'false' || v === '0' || v === '否') return false;
  if (v === 'true' || v === '1' || v === '是') return true;
  return true;
}

/** 简单邮箱格式校验 */
function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/**
 * 读取岗位字典（sys_i18n_dict dict_type='position'），供导入校验岗位码。
 *
 * T2 三语改造：返回值新增 name_en（**纯增量**，老调用方读 name_zh/name_vi 不受影响）。
 * name_en 可能为 null → 前端 en 环境下由 utils/label.js 回退中文。
 *
 * @returns {Promise<Array<{code:string,name_zh:string,name_vi:string,name_en:string|null}>>}
 */
export async function listPositionDict() {
  return many(
    `SELECT code, name_zh, name_vi, name_en, sort_order
       FROM sys_i18n_dict
      WHERE dict_type = 'position' AND active = TRUE
      ORDER BY sort_order, code`
  );
}

/**
 * 组织导入模板列定义（中越双语表头）—— 人员信息。
 * @returns {{columns:Array<{key:string,label:string,label_vi:string}>}}
 */
export function orgImportTemplate() {
  return {
    columns: [
      { key: 'employee_no', label: '工号', label_vi: 'Mã nhân viên' },
      { key: 'real_name', label: '姓名', label_vi: 'Họ tên' },
      { key: 'dept_code', label: '部门编码', label_vi: 'Mã bộ phận' },
      { key: 'dept_name', label: '部门名称', label_vi: 'Tên bộ phận' },
      { key: 'dept_name_vi', label: '部门名称(越)', label_vi: 'Tên bộ phận (Việt)' },
      { key: 'parent_code', label: '上级部门编码', label_vi: 'Mã bộ phận cấp trên' },
      { key: 'position_code', label: '岗位编码', label_vi: 'Mã vị trí' },
      { key: 'email', label: '邮箱', label_vi: 'Email' },
      { key: 'phone', label: '手机', label_vi: 'Điện thoại' },
      { key: 'status', label: '状态', label_vi: 'Trạng thái' },
    ],
  };
}

/** 按 code 建/找部门，返回部门 id。 */
async function upsertDepartment(raw, counters) {
  const code = raw.dept_code ? String(raw.dept_code).trim() : '';
  const name = raw.dept_name ? String(raw.dept_name).trim() : '';
  if (!code && !name) return null;

  let parentId = null;
  const parentCode = raw.parent_code ? String(raw.parent_code).trim() : '';
  if (parentCode) {
    const p = await one(`SELECT id FROM org_department WHERE code = $1 LIMIT 1`, [parentCode]);
    if (p) parentId = p.id;
    else if (parentCode !== code) {
      const created = await one(
        `INSERT INTO org_department (name, code, organization) VALUES ($1,$2,$3)
         ON CONFLICT (code) WHERE code IS NOT NULL DO NOTHING RETURNING id`,
        [parentCode, parentCode, '本公司']
      );
      if (created) { parentId = created.id; counters.deptInserted++; }
      else {
        const again = await one(`SELECT id FROM org_department WHERE code = $1 LIMIT 1`, [parentCode]);
        parentId = again?.id || null;
      }
    }
  }

  const nameVi = raw.dept_name_vi ? String(raw.dept_name_vi).trim() : null;

  // BUG-QAV-04①：按 code 的部门必须原子 upsert。
  // 原实现「SELECT 再 INSERT」在并发导入同一新部门时，后到者会撞 uk_dept_code，
  // 该行被外层 catch 整行跳过 → 用户丢失（10×100 只剩 999）。
  // 改为 INSERT ... ON CONFLICT (code) DO NOTHING，未插入则回查并更新；
  // 计数语义保持：本次真正插入 → deptInserted，命中既有 → deptUpdated。
  if (code) {
    const ins = await one(
      `INSERT INTO org_department (name, name_vi, code, parent_id, organization)
       VALUES ($1,$2,$3,$4,'本公司')
       ON CONFLICT (code) WHERE code IS NOT NULL DO NOTHING
       RETURNING id`,
      [name || code, nameVi, code, parentId]
    );
    if (ins) { counters.deptInserted++; return ins.id; }

    const exist = await one(`SELECT id FROM org_department WHERE code = $1 LIMIT 1`, [code]);
    if (!exist) throw new Error(`部门写入冲突，请重试：${code}`);
    await query(
      `UPDATE org_department
          SET name = COALESCE($2, name),
              name_vi = COALESCE($3, name_vi),
              parent_id = COALESCE($4, parent_id),
              updated_at = now()
        WHERE id = $1`,
      [exist.id, name || null, nameVi, parentId]
    );
    counters.deptUpdated++;
    return exist.id;
  }

  // 无 code 的部门：保持既有「按名称匹配」语义（无唯一约束，不涉及本次并发冲突）
  if (!name) return null;
  const exist = await one(`SELECT id FROM org_department WHERE name = $1 LIMIT 1`, [name]);
  if (exist) {
    await query(
      `UPDATE org_department
          SET name_vi = COALESCE($2, name_vi),
              parent_id = COALESCE($3, parent_id),
              updated_at = now()
        WHERE id = $1`,
      [exist.id, nameVi, parentId]
    );
    counters.deptUpdated++;
    return exist.id;
  }
  const ins = await one(
    `INSERT INTO org_department (name, name_vi, code, parent_id, organization)
     VALUES ($1,$2,NULL,$3,'本公司') RETURNING id`,
    [name, nameVi, parentId]
  );
  counters.deptInserted++;
  return ins.id;
}

/**
 * 批量导入组织（部门 + 用户），【串行】逐行处理以避免工号并发冲突。
 * @param {object[]} rows 行数据数组
 * @param {number} userId 操作人 id
 * @returns {Promise<{deptInserted:number,deptUpdated:number,userInserted:number,userUpdated:number,failed:number,errors:Array}>}
 */
export async function importOrg(rows, userId) {
  const counters = { deptInserted: 0, deptUpdated: 0 };
  const errors = [];
  let userInserted = 0, userUpdated = 0, failed = 0;
  let matchedByFallback = 0;

  let posCodes = new Set();
  // 岗位名称 → 编码（中文/越文/英文均可，大小写与首尾空格不敏感）。
  // 现场诉求：模板里让用户填「岗位编码」，但界面上岗位编码是系统内部生成的、根本看不到，
  // 用户只能凭猜。这里放宽为「填岗位名称也认」，填编码仍照旧兼容。
  const posByName = new Map();
  try {
    const dict = await listPositionDict();
    posCodes = new Set(dict.map(d => d.code));
    for (const p of dict) {
      for (const nm of [p.name_zh, p.name_vi, p.name_en]) {
        const k = String(nm || '').trim().toLowerCase();
        if (k && !posByName.has(k)) posByName.set(k, p.code);
      }
    }
  } catch { /* 忽略：字典不可用时跳过岗位校验 */ }

  const { hashPassword, nextEmployeeNo } = await import('./auth.js');
  const initialPassword = config.security.initialPassword;

  const list = Array.isArray(rows) ? rows : [];
  for (let idx = 0; idx < list.length; idx++) {
    const raw = list[idx] || {};
    const rowNo = idx + 2;

    const realName = raw.real_name ? String(raw.real_name).trim() : '';
    if (!realName) { errors.push({ row: rowNo, field: 'real_name', msg: '姓名必填' }); failed++; continue; }

    const email = raw.email ? String(raw.email).trim() : '';
    if (email && !isEmail(email)) { errors.push({ row: rowNo, field: 'email', msg: `邮箱格式无效：${email}` }); failed++; continue; }

    let positionCode = raw.position_code ? String(raw.position_code).trim() : '';
    // 兼容「填岗位名称」：先按编码认，认不到再按 中文/越文/英文名称 反查编码
    if (positionCode && posCodes.size > 0 && !posCodes.has(positionCode)) {
      const byName = posByName.get(positionCode.toLowerCase());
      if (byName) positionCode = byName;
    }
    if (positionCode && posCodes.size > 0 && !posCodes.has(positionCode)) {
      const sample = [...posByName.keys()].slice(0, 5).join(' / ');
      errors.push({ row: rowNo, field: 'position_code', msg: `岗位「${positionCode}」不存在，可填岗位名称或编码（如：${sample}）` });
      failed++;
      continue;
    }

    try {
      const departmentId = await upsertDepartment(raw, counters);
      const employeeNoRaw = raw.employee_no ? String(raw.employee_no).trim() : '';
      // N13：状态列缺省不写 active，避免「未列状态」把离职人员重新启用
      const statusProvided = raw.status !== undefined && raw.status !== null && String(raw.status).trim() !== '';
      const active = parseActive(raw.status);
      const phone = raw.phone ? String(raw.phone).trim() : null;

      let exist = null;
      let byFallback = false;
      if (employeeNoRaw) {
        exist = await one(
          `SELECT id, email, phone, department_id, position_code FROM org_user WHERE employee_no = $1 LIMIT 1`,
          [employeeNoRaw]
        );
      } else {
        // B3：无工号行不能只按 employee_no 判重（恒 null → 重传必新建人）。
        // 用「姓名 + 部门 + 岗位」兜底匹配（schema 无 hire_date 列，岗位是最接近的稳定区分项）。
        // 存在同名同部门同岗位的多个用户时取 id 最小者，并由 matchedByFallback 计数 + 前端提示，
        // 提示管理员核对，避免静默误合并。
        exist = await one(
          `SELECT id, email, phone, department_id, position_code FROM org_user
            WHERE real_name = $1
              AND department_id IS NOT DISTINCT FROM $2
              AND COALESCE(position_code, '') = COALESCE($3, '')
            ORDER BY id LIMIT 1`,
          [realName, departmentId, positionCode || null]
        );
        byFallback = !!exist;
      }

      if (exist) {
        if (byFallback) {
          // B4：兜底命中只补空、不覆盖；来行 email/phone 与既有值冲突 → 判为同名不同人，整行不写
          const conflict = (incoming, current, field) => {
            if (!incoming || !current) return false;
            const same = field === 'email'
              ? String(incoming).toLowerCase() === String(current).toLowerCase()
              : String(incoming) === String(current);
            return !same;
          };
          if (conflict(email, exist.email, 'email') || conflict(phone, exist.phone, 'phone')) {
            errors.push({ row: rowNo, field: 'employee_no', msg: '疑似同名不同人，请补工号' });
            failed++;
            continue;
          }
          await query(
            `UPDATE org_user
                SET email = CASE WHEN COALESCE(email, '') = '' THEN $2 ELSE email END,
                    phone = CASE WHEN COALESCE(phone, '') = '' THEN $3 ELSE phone END,
                    active = CASE WHEN $4::boolean IS NULL THEN active ELSE $4 END,
                    updated_at = now()
              WHERE id = $1`,
            [exist.id, email || null, phone, statusProvided ? active : null]
          );
          matchedByFallback++;
        } else {
          await query(
            `UPDATE org_user
                SET real_name = $2,
                    department_id = COALESCE($3, department_id),
                    position_code = COALESCE($4, position_code),
                    email = COALESCE($5, email),
                    phone = COALESCE($6, phone),
                    active = COALESCE($7::boolean, active),
                    updated_at = now()
              WHERE id = $1`,
            [exist.id, realName, departmentId, positionCode || null, email || null, phone,
             statusProvided ? active : null]
          );
          // 批量调岗留痕：按工号匹配到的老员工，若部门/岗位变了就记一条（source=import）。
          // 失败不影响本行导入结果（留痕是旁路）。
          try {
            await recordTransfer({
              userId: exist.id,
              before: { deptId: exist.department_id, positionCode: exist.position_code },
              after: { deptId: departmentId, positionCode: positionCode || null },
              operatorId: userId,
              source: 'import',
            });
          } catch { /* 忽略：留痕失败不阻断导入 */ }
        }
        userUpdated++;
      } else {
        const employeeNo = employeeNoRaw || await nextEmployeeNo();
        const username = employeeNo;
        const hash = await hashPassword(initialPassword);

        await query(
          `INSERT INTO org_user
             (username, employee_no, password_hash, real_name, email, phone,
              department_id, position_code, organization, active, must_change_pwd)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'本公司',$9,TRUE)`,
          [username, employeeNo, hash, realName, email || null, phone,
           departmentId, positionCode || null, active]
        );
        userInserted++;
      }
    } catch (err) {
      errors.push({ row: rowNo, field: '', msg: err.message });
      failed++;
    }
  }

  return { deptInserted: counters.deptInserted, deptUpdated: counters.deptUpdated,
           userInserted, userUpdated, matchedByFallback, failed, errors };
}

/**
 * 导出全组织（部门 + 人员）。中越双语表头。
 * @returns {Promise<{columns:Array,rows:Array}>}
 */
export async function exportOrg() {
  const columns = [
    { key: 'dept_code', label: '部门编码', label_vi: 'Mã bộ phận' },
    { key: 'dept_name', label: '部门名称', label_vi: 'Tên bộ phận' },
    { key: 'parent_code', label: '上级部门编码', label_vi: 'Mã bộ phận cấp trên' },
    { key: 'employee_no', label: '工号', label_vi: 'Mã nhân viên' },
    { key: 'real_name', label: '姓名', label_vi: 'Họ tên' },
    { key: 'position_code', label: '岗位编码', label_vi: 'Mã vị trí' },
    { key: 'position_name', label: '岗位名称', label_vi: 'Tên vị trí' },
    { key: 'email', label: '邮箱', label_vi: 'Email' },
    { key: 'phone', label: '手机', label_vi: 'Điện thoại' },
    { key: 'status', label: '状态', label_vi: 'Trạng thái' },
  ];

  const rows = await many(
    `SELECT d.code AS dept_code, d.name AS dept_name, d.name_en AS dept_name_en, pd.code AS parent_code,
            u.employee_no, u.real_name, u.position_code,
            dict.name_zh AS position_name_zh, dict.name_vi AS position_name_vi,
            u.email, u.phone, u.active
       FROM org_user u
       LEFT JOIN org_department d ON d.id = u.department_id
       LEFT JOIN org_department pd ON pd.id = d.parent_id
       LEFT JOIN sys_i18n_dict dict
              ON dict.dict_type = 'position' AND dict.code = u.position_code
      ORDER BY d.code NULLS LAST, u.employee_no`
  );

  const out = rows.map(r => ({
    dept_code: r.dept_code || '',
    dept_name: r.dept_name || '',
    parent_code: r.parent_code || '',
    employee_no: r.employee_no || '',
    real_name: r.real_name || '',
    position_code: r.position_code || '',
    position_name: r.position_name_zh || r.position_name_vi || '',
    email: r.email || '',
    phone: r.phone || '',
    status: r.active ? '在职' : '离职',
  }));

  return { columns, rows: out };
}
