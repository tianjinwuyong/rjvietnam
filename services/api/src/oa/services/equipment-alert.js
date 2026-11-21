// ============================================================
// 设备外校分级预警（S3-T03，需求 6.2）
// ------------------------------------------------------------
// 需求书第 6 章：外校（外部校准）到期按剩余天数「30/15/7」三档「递进升级」推送，
// 仅外校适用，点检不适用。档位与接收层级：
//   剩余 <= 30 天 → 该设备所属部门的 dept_leader（部门负责人，先知晓、早安排）
//   剩余 <= 15 天 → 工程部（code=EN）的 dept_leader（设备/外校主责部门升级介入）
//   剩余 <=  7 天 → 副总（role:vp，临近到期升级到分管领导）
//   已逾期(<0)   → 走最严档位 7 逻辑，文案标注「已逾期 N 天」，并触发超期自动停用
// 备注：原 30/10/7/3 四档与需求书 30/15/7 不一致，已对齐为三档；
//       原 equip_mgr(10) 与 gm(3) 两档分别并入 15 与 7，语义不变（仍是递进升级）。
// 防重复：equipment_alert_log 的 UNIQUE(equipment_id, alert_type, days_left)
//  + 原子占位（INSERT ... ON CONFLICT DO NOTHING RETURNING id），
//  仅占位成功才发送，避免并发/重复推送。
// 容错：任一档位解析不到收件人 → 降级通知 admin 角色用户，并 console.warn。
// ============================================================
import { many, query } from '../db/index.js';
import { notifyMany } from './notify.js';

const ALERT_TYPE = 'external';

// 档位定义（从严到宽，取第一个命中）：days 为剩余天数阈值，role 为日志记录的接收层级标识
// 三档对齐需求书 6.2「30/15/7」：30→部门负责人 / 15→工程部负责人(设备主管) / 7→副总
const TIERS = [
  { days: 7,  role: 'vp' },
  { days: 15, role: 'equip_mgr' },
  { days: 30, role: 'dept_leader' },
];

/**
 * 计算某设备剩余天数应命中的档位。
 * @param {number} daysLeft 剩余天数（可负，表示已逾期）
 * @returns {{tierDays:number, role:string}} 命中档位；daysLeft>30 时返回 tierDays=0 表示不推送
 */
export function resolveTier(daysLeft) {
  for (const t of TIERS) {
    if (daysLeft <= t.days) return { tierDays: t.days, role: t.role };
  }
  return { tierDays: 0, role: null };
}

/**
 * 解析部门负责人（dept_leader）用户 id 列表。
 * 优先取 org_department.leader_id；若为空再退回「该部门中拥有 dept_leader 角色」的用户。
 * @param {number|null} departmentId
 * @returns {Promise<number[]>}
 */
async function resolveDeptLeaders(departmentId) {
  if (!departmentId) return [];
  // 1) 部门表直接登记的 leader
  const dept = (await many(
    `SELECT leader_id FROM org_department WHERE id = $1 AND leader_id IS NOT NULL`,
    [departmentId]
  ))[0];
  if (dept?.leader_id) return [dept.leader_id];

  // 2) 退回：该部门中拥有 dept_leader 角色的在职用户
  const rows = await many(
    `SELECT u.id FROM org_user u
       JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      WHERE r.code = 'dept_leader' AND u.department_id = $1 AND u.active = TRUE`,
    [departmentId]
  );
  return rows.map(r => r.id);
}

/**
 * 按角色 code 解析在职用户 id 列表；可选限定部门（通过 code 或 id）。
 * @param {string} roleCode
 * @param {{deptCode?:string, deptId?:number}} [opts]
 * @returns {Promise<number[]>}
 */
async function resolveRoleUsers(roleCode, opts = {}) {
  const params = [roleCode];
  let where = `r.code = $1 AND u.active = TRUE`;
  if (opts.deptId) {
    params.push(opts.deptId);
    where += ` AND u.department_id = $${params.length}`;
  } else if (opts.deptCode) {
    params.push(opts.deptCode);
    where += ` AND u.department_id = (SELECT id FROM org_department WHERE code = $${params.length})`;
  }
  const rows = await many(
    `SELECT u.id FROM org_user u
       JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      WHERE ${where}`,
    params
  );
  return rows.map(r => r.id);
}

/**
 * 解析 admin 角色用户（降级兜底收件人）。
 * @returns {Promise<number[]>}
 */
async function resolveAdmins() {
  const rows = await many(
    `SELECT u.id FROM org_user u
       JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      WHERE r.code = 'admin' AND u.active = TRUE LIMIT 10`
  );
  return rows.map(r => r.id);
}

/**
 * 依档位解析收件人。
 * @param {string} role 档位接收层级标识
 * @param {object} eq 设备行（含 department_id）
 * @returns {Promise<{ids:number[], degraded:boolean}>}
 */
async function resolveRecipients(role, eq) {
  let ids = [];
  if (role === 'gm') {
    ids = await resolveRoleUsers('gm');
  } else if (role === 'vp') {
    ids = await resolveRoleUsers('vp');
  } else if (role === 'equip_mgr') {
    ids = await resolveRoleUsers('dept_leader', { deptCode: 'EN' });
  } else if (role === 'dept_leader') {
    ids = await resolveDeptLeaders(eq.department_id);
  }

  if (ids.length === 0) {
    console.warn(
      `[equip-alert] 设备 ${eq.code} 档位 ${role} 未解析到收件人，降级通知 admin`
    );
    const admins = await resolveAdmins();
    return { ids: admins, degraded: true };
  }
  return { ids, degraded: false };
}

/**
 * 外校超期 → 自动停用设备（需求 6.2「超期自动标记停用」）。
 * - 仅对「在用」状态（当前非 suspended / scrapped）生效；
 *   维修中(maintenance)也会被停用（超期设备本就不应继续投入校准有效场景）。
 * - 幂等：UPDATE 带 `AND status NOT IN ('suspended','scrapped')` 守卫，
 *   仅当确有 1 行被改（rowCount>0）才写履历与通知；重复扫描不会重复写/重复推。
 * - 留痕：写 equipment_history(status_change)（source_instance_id 留空，避免与流程履历
 *   的部分唯一索引冲突），并向部门负责人推送通知说明停用原因。
 * - 恢复：本函数只负责「停用」。重新校准通过后由 modules-service.updateCalibration
 *   在实校回写时把设备置回 running 并重算下次到期日（见该函数 becameDone 分支），
 *   构成「超期→停用→重新校准→恢复」闭环。
 * @param {number} equipmentId
 * @param {{today?:string}} [opts]
 * @returns {Promise<boolean>} 是否本次真正执行了停用
 */
async function enforceCalibrationSuspension(equipmentId, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);

  // 原子停用：条件写法保证并发/重复扫描下至多停用一次
  const res = await query(
    `UPDATE equipment
        SET status = 'suspended', status_since = now(), updated_at = now()
      WHERE id = $1 AND status NOT IN ('suspended', 'scrapped')
      RETURNING id, code, name, department_id, next_external_date, status`,
    [equipmentId]
  );
  const eq = res.rows[0];
  if (!eq) return false; // 已停用/已报废：幂等跳过，不写履历、不通知

  const overdueDays = Math.abs(Math.floor(
    (new Date(eq.next_external_date + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000
  ));

  // 履历留痕
  await query(
    `INSERT INTO equipment_history (equipment_id, event_type, event_date, title, content)
     VALUES ($1, 'status_change', $2, $3, $4)`,
    [eq.id, today, '外校超期自动停用',
     `设备「${eq.name}」（编号 ${eq.code}）外部校准已于 ${eq.next_external_date} 到期（逾期 ${overdueDays} 天），` +
     `系统自动将其状态置为「停用」。请尽快安排外校，校准合格后设备将自动恢复为运行中。`]
  );

  // 通知部门负责人（解析不到则降级 admin）
  const { ids } = await resolveRecipients('dept_leader', eq);
  await notifyMany(ids, {
    title: `【设备停用】${eq.name} 外校超期已自动停用`,
    content:
      `设备「${eq.name}」（编号 ${eq.code}）外部校准已于 ${eq.next_external_date} 到期，` +
      `逾期 ${overdueDays} 天，系统已自动停用该设备（状态：停用）。请尽快安排外校，` +
      `重新校准合格后将自动恢复为运行中。`,
    link: '/equipment',
    category: 'reminder',
  });
  console.warn(`[equip-alert] 设备 ${eq.code} 外校超期 ${overdueDays} 天，已自动停用`);
  return true;
}

/**
 * 扫描外校到期分级预警。
 * 返回本次实际发送的设备条数（去重后按设备计）。
 * @param {{ today?: string }} [opts] 便于测试注入「今天」，格式 YYYY-MM-DD
 * @returns {Promise<number>}
 */
export async function scanCalibrationAlerts(opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);

  // 预警候选：在用状态（running 运行中 / maintenance 维护中）——与「自动停用」的在用判定一致，
  // 保证维护中的设备也会收到预警与超期停用处理，而非被静默漏掉。
  const rows = await many(
    `SELECT e.id, e.code, e.name, e.department_id, e.next_external_date,
            d.name AS dept_name, d.name_en AS dept_name_en
       FROM equipment e
       LEFT JOIN org_department d ON d.id = e.department_id
      WHERE e.status IN ('running','maintenance')
        AND e.next_external_date IS NOT NULL`
  );

  let sent = 0;
  for (const eq of rows) {
    // 剩余天数：以「今天」为基准（>=0 表示未到期，<0 表示已逾期）
    const daysLeft = Math.floor(
      (new Date(eq.next_external_date + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000
    );

    // ---- 超期自动停用（需求 6.2：外校超期自动标记停用）----
    // 幂等：调用 enforceCalibrationSuspension，内部 WHERE status NOT IN ('suspended','scrapped')
    //       保证只对「在用」设备生效、已是 suspended 的重复扫描不重复写/不重复通知。
    if (daysLeft < 0) {
      try {
        await enforceCalibrationSuspension(eq.id, opts);
      } catch (err) {
        console.warn(`[equip-alert] 设备 ${eq.code} 超期自动停用失败：`, err.message);
      }
    }

    const { tierDays, role } = resolveTier(daysLeft);
    if (!tierDays) continue; // > 30 天，不推送

    // 原子占位：占位成功才发；已存在（同日同档已发）则跳过
    const placeholder = (await query(
      `INSERT INTO equipment_alert_log (equipment_id, alert_type, days_left, target_role, sent_to)
       VALUES ($1, $2, $3, $4, '{}')
       ON CONFLICT (equipment_id, alert_type, days_left) DO NOTHING
       RETURNING id`,
      [eq.id, ALERT_TYPE, tierDays, role]
    )).rows[0];
    if (!placeholder) continue; // 已发过，防重复

    const { ids, degraded } = await resolveRecipients(role, eq);

    const overdue = daysLeft < 0;
    const dayText = overdue ? `已逾期 ${Math.abs(daysLeft)} 天` : `剩 ${daysLeft} 天`;
    const title = `【外校预警】${eq.name} ${dayText}`;
    const tierLabel = {
      dept_leader: '执行者/部门负责人',
      equip_mgr: '工程部经理',
      vp: '副总',
    }[role] || role;
    const content =
      `设备「${eq.name}」（编号 ${eq.code}）外部校准${overdue ? '已逾期' : '即将到期'}：` +
      `${dayText}（校准到期日 ${eq.next_external_date}）。` +
      `当前提醒层级：${tierLabel}${degraded ? '（原层级无人，已降级通知管理员）' : ''}。请及时安排外校。`;

    await notifyMany(ids, {
      title,
      content,
      link: '/equipment',
      category: 'reminder',
    });

    // 回写实际收件人
    await query(
      `UPDATE equipment_alert_log SET sent_to = $2 WHERE id = $1`,
      [placeholder.id, ids]
    );
    sent++;
  }
  return sent;
}
