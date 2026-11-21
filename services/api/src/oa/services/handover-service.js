// ============================================================
// 工作交接服务（Handover）
// ------------------------------------------------------------
// 需求：离职人员与新入职人员（也可能老员工）工作交接。
// 详见 docs/工作交接-实施方案与验收标准.md（§0 用户决策冻结）。
//
// 职责：
//   1) collectHandoverItems  —— 汇总交方名下待交接事项（待办/抄送/资产/职责）
//   2) saveHandover          —— 落库交接单 + 明细（由流程发起时调用）
//   3) onHandoverClosed      —— 终态钩子：批量转交 + 后续流程替换 + 回写快照（幂等）
//   4) checkDisableBlockers  —— 停用前阻断校验（D4）
//
// 零副作用红线：tables 为空时，既有流程/停用行为逐位不变。
// ============================================================
import { query, one, many } from '../db/index.js';
import { notify } from './notify.js';

const toId = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function cfg(key, def) {
  const row = await one(`SELECT value FROM sys_config WHERE key = $1`, [key]).catch(() => null);
  if (!row) return def;
  const v = String(row.value ?? '').trim();
  if (v === '') return def;
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

// ============================================================
// 一、清单汇总
// ============================================================

/**
 * 汇总某人名下的待交接事项（只读，不做任何改动）。
 * @param {number} userId 交方
 * @returns {Promise<Array<{item_type,ref_table,ref_id,title,detail}>>}
 */
export async function collectHandoverItems(userId) {
  const uid = toId(userId);
  if (!uid) return [];
  const out = [];

  // 1) 在途待办：当前节点、assigned、且流程 running
  const todos = await many(
    `SELECT t.id AS task_id, t.node_name, i.id AS instance_id, i.instance_no, i.title,
            fd.name AS def_name, u.real_name AS applicant_name, i.created_at
       FROM flow_task t
       JOIN flow_instance i ON i.id = t.instance_id
       JOIN flow_definition fd ON fd.id = i.definition_id
       LEFT JOIN org_user u ON u.id = i.applicant_id
      WHERE t.assignee_id = $1 AND t.status = 'assigned'
        AND i.status = 'running' AND t.node_index = i.current_index
      ORDER BY i.created_at DESC
      LIMIT 500`,
    [uid]
  ).catch(() => []);
  for (const t of todos) {
    out.push({
      item_type: 'flow_todo',
      ref_table: 'flow_task',
      ref_id: Number(t.task_id),
      title: `${t.def_name}｜${t.instance_no}｜${t.node_name}`,
      detail: `单号 ${t.instance_no}　标题：${t.title}　发起人：${t.applicant_name || '-'}`,
    });
  }

  // 2) 抄送事项：抄送给他且单据仍 running
  const ccs = await many(
    `SELECT c.id AS cc_id, i.id AS instance_id, i.instance_no, i.title, fd.name AS def_name,
            u.real_name AS applicant_name
       FROM flow_cc c
       JOIN flow_instance i ON i.id = c.instance_id
       JOIN flow_definition fd ON fd.id = i.definition_id
       LEFT JOIN org_user u ON u.id = i.applicant_id
      WHERE c.user_id = $1 AND i.status = 'running'
      ORDER BY i.created_at DESC
      LIMIT 500`,
    [uid]
  ).catch(() => []);
  for (const c of ccs) {
    out.push({
      item_type: 'flow_cc',
      ref_table: 'flow_cc',
      ref_id: Number(c.cc_id),
      title: `抄送｜${c.def_name}｜${c.instance_no}`,
      detail: `单号 ${c.instance_no}　标题：${c.title}　发起人：${c.applicant_name || '-'}`,
    });
  }

  // 3) 资产与职责（受开关控制，默认开）
  const includeAssets = await cfg('handover_include_assets', true);
  if (includeAssets) {
    // 3.1 设备保养任务（未完成）
    const eqTasks = await many(
      `SELECT et.id, et.task_type, et.plan_date, et.status, e.name AS eq_name, e.code AS eq_code
         FROM equipment_task et
         LEFT JOIN equipment e ON e.id = et.equipment_id
        WHERE et.assignee_id = $1 AND et.status NOT IN ('done','completed','cancelled')
        ORDER BY et.plan_date
        LIMIT 300`,
      [uid]
    ).catch(() => []);
    for (const r of eqTasks) {
      out.push({
        item_type: 'equipment_task',
        ref_table: 'equipment_task',
        ref_id: Number(r.id),
        title: `设备任务｜${r.eq_name || r.eq_code || ''}｜${r.task_type || ''}`,
        detail: `计划日期 ${r.plan_date ? String(r.plan_date).slice(0, 10) : '-'}　状态：${r.status || '-'}`,
      });
    }

    // 3.2 体系文件（本人创建且仍生效）
    const docs = await many(
      `SELECT id, code, title, status FROM doc_system
        WHERE created_by = $1 AND status NOT IN ('obsolete','void')
        ORDER BY id DESC LIMIT 300`,
      [uid]
    ).catch(() => []);
    for (const r of docs) {
      out.push({
        item_type: 'doc_owner',
        ref_table: 'doc_system',
        ref_id: Number(r.id),
        title: `体系文件｜${r.code || ''}｜${r.title || ''}`,
        detail: `文件编号 ${r.code || '-'}　状态：${r.status || '-'}`,
      });
    }

    // 3.3 公共盘文件夹（本人为 owner，未删除）
    const folders = await many(
      `SELECT id, name FROM drive_folder
        WHERE owner_id = $1 AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 300`,
      [uid]
    ).catch(() => []);
    for (const r of folders) {
      out.push({
        item_type: 'drive_folder',
        ref_table: 'drive_folder',
        ref_id: Number(r.id),
        title: `公共盘文件夹｜${r.name || ''}`,
        detail: `文件夹「${r.name || '-'}」的负责人变更`,
      });
    }

    // 3.4 培训计划（本人创建且未结束）
    const plans = await many(
      `SELECT id, plan_no, title, status FROM training_plan
        WHERE created_by = $1 AND status NOT IN ('finished','closed','cancelled')
        ORDER BY id DESC LIMIT 300`,
      [uid]
    ).catch(() => []);
    for (const r of plans) {
      out.push({
        item_type: 'training_plan',
        ref_table: 'training_plan',
        ref_id: Number(r.id),
        title: `培训计划｜${r.plan_no || ''}｜${r.title || ''}`,
        detail: `计划编号 ${r.plan_no || '-'}　状态：${r.status || '-'}`,
      });
    }

    // 3.5 会议决议待办（本人负责且未完成）
    const actions = await many(
      `SELECT id, action_no, title, due_date, status FROM meeting_action
        WHERE owner_id = $1 AND deleted_at IS NULL AND status NOT IN ('done','closed','cancelled')
        ORDER BY due_date NULLS LAST LIMIT 300`,
      [uid]
    ).catch(() => []);
    for (const r of actions) {
      out.push({
        item_type: 'meeting_action',
        ref_table: 'meeting_action',
        ref_id: Number(r.id),
        title: `会议待办｜${r.action_no || ''}｜${r.title || ''}`,
        detail: `截止 ${r.due_date ? String(r.due_date).slice(0, 10) : '-'}　状态：${r.status || '-'}`,
      });
    }
  }

  return out;
}

// ============================================================
// 二、落库（交接单 + 明细）
// ============================================================

/**
 * 保存交接单与明细。由流程发起接口调用（先建 flow_instance，再调本函数绑定）。
 * @param {object} p { instanceId, handoverType, fromUserId, toUserId, deptId, effectiveDate,
 *                     migrateTodo, replaceRouting, remark, createdBy, items:[{item_type,ref_table,ref_id,title,detail,transfer}] }
 * @returns {Promise<number>} handoverId
 */
export async function saveHandover(p = {}) {
  const instId = toId(p.instanceId);
  const fromId = toId(p.fromUserId);
  const toUser = toId(p.toUserId);
  const items = Array.isArray(p.items) ? p.items : null;

  const row = await one(
    `INSERT INTO work_handover
       (instance_id, handover_type, from_user_id, to_user_id, dept_id, effective_date,
        status, migrate_todo, replace_routing, item_count, remark, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'running',$7,$8,COALESCE($9,0),$10,$11)
     ON CONFLICT (instance_id) DO UPDATE SET
       handover_type = EXCLUDED.handover_type, from_user_id = EXCLUDED.from_user_id,
       to_user_id = EXCLUDED.to_user_id, dept_id = EXCLUDED.dept_id,
       effective_date = EXCLUDED.effective_date, migrate_todo = EXCLUDED.migrate_todo,
       replace_routing = EXCLUDED.replace_routing,
       item_count = COALESCE(EXCLUDED.item_count, work_handover.item_count),
       remark = EXCLUDED.remark, status = 'running', updated_at = now()
     RETURNING id`,
    [
      instId,
      p.handoverType || 'resign',
      fromId,
      toUser,
      toId(p.deptId),
      p.effectiveDate || null,
      p.migrateTodo !== false,
      p.replaceRouting !== false,
      items ? items.length : null,
      p.remark || null,
      toId(p.createdBy),
    ]
  );
  const hid = Number(row.id);

  // 明细：仅在显式传入 items 数组时全量替换（幂等重试友好）；
  // 未传 items（undefined）→ 保留既有明细，避免"只更新主表"时误删清单。
  if (Array.isArray(p.items)) {
    await query(`DELETE FROM work_handover_item WHERE handover_id = $1`, [hid]);
    let sort = 0;
    for (const it of items) {
      await query(
        `INSERT INTO work_handover_item
           (handover_id, item_type, ref_table, ref_id, title, detail, transfer, transfer_status, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,
        [
          hid,
          String(it.item_type || 'manual').slice(0, 30),
          it.ref_table || null,
          toId(it.ref_id),
          String(it.title || '').slice(0, 255) || '（未命名事项）',
          it.detail || null,
          it.transfer !== false,
          sort++,
        ]
      );
    }
  }
  return hid;
}

/** 按流程实例取交接单（含明细） */
export async function getHandoverByInstance(instanceId) {
  const h = await one(`SELECT * FROM work_handover WHERE instance_id = $1`, [toId(instanceId)]);
  if (!h) return null;
  const items = await many(
    `SELECT * FROM work_handover_item WHERE handover_id = $1 ORDER BY sort_order, id`,
    [h.id]
  );
  return { ...h, items };
}

// ============================================================
// 三、终态钩子：批量转交 + 后续流程替换（幂等）
// ============================================================

/**
 * 批量转交：把交方名下"当前节点 assigned"的待办与 running 单据的抄送转给接方。
 * - 旧 flow_task 置 transferred；新任务带 transferred_from（沿用既有留痕字段）
 * - flow_cc 直接改 user_id（保留读态），并写 flow_log
 */
async function migrateTodos(h, targetUserId) {
  const hid = h.id;
  const fromId = Number(h.from_user_id);
  const toIdv = Number(targetUserId);
  let migrated = 0;

  // 明细中已勾选 transfer 的待办条目
  const items = await many(
    `SELECT * FROM work_handover_item
      WHERE handover_id = $1 AND transfer = TRUE AND transfer_status = 'pending'
        AND item_type IN ('flow_todo','flow_cc')
      ORDER BY sort_order, id`,
    [hid]
  );

  for (const it of items) {
    try {
      if (it.item_type === 'flow_todo') {
        const task = await one(
          `SELECT t.*, i.status AS inst_status, i.current_index, i.archive_locked, i.title, i.instance_no
             FROM flow_task t JOIN flow_instance i ON i.id = t.instance_id
            WHERE t.id = $1`,
          [it.ref_id]
        );
        if (!task || task.status !== 'assigned'
            || task.inst_status !== 'running'
            || Number(task.node_index) !== Number(task.current_index)
            || task.archive_locked) {
          await query(
            `UPDATE work_handover_item SET transfer_status='skipped', transfer_note=$2 WHERE id=$1`,
            [it.id, '任务已流转/失效，无需转交']
          );
          continue;
        }
        if (Number(task.assignee_id) === toIdv) {
          await query(
            `UPDATE work_handover_item SET transfer_status='skipped', transfer_note=$2 WHERE id=$1`,
            [it.id, '接收人即当前处理人，无需转交']
          );
          continue;
        }
        await query(
          `UPDATE flow_task SET status='transferred', comment=$2, finished_at=now() WHERE id=$1`,
          [it.ref_id, '工作交接自动转交']
        );
        await query(
          `INSERT INTO flow_task (instance_id, node_index, node_name, node_type, assignee_id, status, transferred_from)
           VALUES ($1,$2,$3,$4,$5,'assigned',$6)`,
          [task.instance_id, task.node_index, task.node_name, task.node_type || 'approval', toIdv, fromId]
        );
        await query(
          `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail)
           VALUES ($1,$2,'transfer',$3,$4)`,
          [task.instance_id, fromId, task.node_index, `工作交接：转交给接方（接收人 #${toIdv}）`]
        );
        await notify(toIdv, {
          title: `【交接转办】${task.title}`,
          content: `单据 ${task.instance_no} 的「${task.node_name}」已通过工作交接转交给您处理。`,
          link: `/flow/detail/${task.instance_id}`,
          category: 'todo',
        });
        await query(
          `UPDATE work_handover_item SET transfer_status='transferred', transfer_note=$2 WHERE id=$1`,
          [it.id, '已转交']
        );
        migrated++;
      } else if (it.item_type === 'flow_cc') {
        await query(`UPDATE flow_cc SET user_id = $2 WHERE id = $1 AND user_id = $3`, [it.ref_id, toIdv, fromId]);
        await query(
          `UPDATE work_handover_item SET transfer_status='transferred', transfer_note=$2 WHERE id=$1`,
          [it.id, '抄送已转交']
        );
        migrated++;
      }
    } catch (err) {
      await query(
        `UPDATE work_handover_item SET transfer_status='failed', transfer_note=$2 WHERE id=$1`,
        [it.id, String(err?.message || err).slice(0, 400)]
      ).catch(() => {});
    }
  }

  // 未勾选 transfer 的待办条目 → 标记仅登记
  await query(
    `UPDATE work_handover_item SET transfer_status='skipped', transfer_note='发起人未勾选自动转交'
      WHERE handover_id=$1 AND transfer = FALSE AND transfer_status = 'pending'`,
    [hid]
  );

  return migrated;
}

/**
 * 后续流程替换（D2b：「后续流程提起时直接按照新老员工对应替换」）。
 * A 档：改写 manager_id / org_department.leader_id（把指向交方的绑定改指接方）
 * C 档：改写 flow_definition.flow_nodes 里硬编码的 user:<交方id> → user:<接方id>
 * B 档（role:/position:）天然隔离，无需处理。
 * @returns {Promise<{managerRewrite, leaderRewrite, nodeRewrite}>}
 */
async function replaceRouting(h, targetUserId) {
  const fromId = Number(h.from_user_id);
  const toIdv = Number(targetUserId);
  const res = { managerRewrite: 0, leaderRewrite: 0, nodeRewrite: 0 };
  if (fromId === toIdv) return res;

  // A1：凡直属主管是交方的人 → 改指接方（仅在职人员）
  const r1 = await query(
    `UPDATE org_user SET manager_id = $2, updated_at = now()
      WHERE manager_id = $1 AND id <> $2 AND active = TRUE`,
    [fromId, toIdv]
  );
  res.managerRewrite = r1.rowCount || 0;

  // A2：交方是某部门负责人的 → 改指接方
  const r2 = await query(
    `UPDATE org_department SET leader_id = $2, updated_at = now() WHERE leader_id = $1`,
    [fromId, toIdv]
  );
  res.leaderRewrite = r2.rowCount || 0;

  // C：流程定义 flow_nodes JSONB 中硬编码的 user:<fromId> → user:<toId>
  //    用 jsonb 文本替换，精确匹配 "user:<id>"（含引号内形式）
  const fromTok = `user:${fromId}`;
  const toTok = `user:${toIdv}`;
  const defs = await many(
    `SELECT id, code, flow_nodes FROM flow_definition
      WHERE flow_nodes::text LIKE $1`,
    [`%${fromTok}%`]
  ).catch(() => []);
  for (const d of defs) {
    const txt = JSON.stringify(d.flow_nodes || []);
    if (!txt.includes(fromTok)) continue;
    const replaced = txt.split(`"${fromTok}"`).join(`"${toTok}"`);
    if (replaced === txt) continue;
    await query(
      `UPDATE flow_definition SET flow_nodes = $2::jsonb, updated_at = now() WHERE id = $1`,
      [d.id, replaced]
    );
    res.nodeRewrite++;
  }

  return res;
}

/**
 * 终态钩子：交接单审批完成（completed）时执行。
 * 幂等：applied_at 非空 → 直接返回，不重复转交。
 * @param {number} instanceId
 */
export async function onHandoverClosed(instanceId) {
  const h = await getHandoverByInstance(instanceId);
  if (!h) return { ok: true, skipped: true, reason: 'no-handover' };

  // 已执行 → 幂等跳过
  if (h.applied_at) return { ok: true, skipped: true, reason: 'already-applied' };

  const toUser = Number(h.to_user_id);
  if (!toUser) return { ok: true, skipped: true, reason: 'no-target' };

  let todoCount = 0;
  let ccCount = 0;
  let routing = { managerRewrite: 0, leaderRewrite: 0, nodeRewrite: 0 };

  if (h.migrate_todo !== false) {
    const items = await many(
      `SELECT item_type, count(*)::int c FROM work_handover_item
        WHERE handover_id = $1 AND transfer = TRUE AND transfer_status = 'transferred'
        GROUP BY item_type`,
      [h.id]
    ).catch(() => []);
    todoCount = await migrateTodos(h, toUser);
    const after = await many(
      `SELECT item_type, count(*)::int c FROM work_handover_item
        WHERE handover_id = $1 AND transfer_status = 'transferred' GROUP BY item_type`,
      [h.id]
    ).catch(() => []);
    ccCount = Number(after.find(x => x.item_type === 'flow_cc')?.c || 0);
    void items;
  }

  if (h.replace_routing !== false) {
    routing = await replaceRouting(h, toUser);
  }

  await query(
    `UPDATE work_handover SET status='completed', applied_at = now(),
            todo_count = $2, cc_count = $3, updated_at = now()
      WHERE id = $1`,
    [h.id, todoCount, ccCount]
  );

  // 审计日志：替换动作留痕（可回溯）
  if (routing.managerRewrite || routing.leaderRewrite || routing.nodeRewrite) {
    await query(
      `INSERT INTO flow_log (instance_id, actor_id, action, detail)
       VALUES ($1,$2,'handover_replace',$3)`,
      [
        instanceId,
        Number(h.from_user_id),
        `后续流程替换：直属关系 ${routing.managerRewrite} 条 / 部门负责人 ${routing.leaderRewrite} 条 / 流程定义硬编码 ${routing.nodeRewrite} 条 → 接方 #${toUser}`,
      ]
    ).catch(() => {});
  }

  // 通知接方与人事
  await notify(toUser, {
    title: '【工作交接完成】',
    content: `您已正式接手相关工作：待办转交 ${todoCount} 项，抄送 ${ccCount} 项，后续流程经办人已替换为您。`,
    link: `/handover/${h.id}`,
    category: 'system',
  }).catch(() => {});

  return { ok: true, todoCount, ccCount, routing };
}

// ============================================================
// 四、停用前阻断校验（D4）
// ============================================================

/**
 * 统计某人当前的在途交接事项（用于停用前阻断）。
 * @returns {Promise<{todo:number, handover:number, total:number}>}
 */
export async function checkDisableBlockers(userId) {
  const uid = toId(userId);
  if (!uid) return { todo: 0, handover: 0, total: 0 };

  const enabled = await cfg('handover_block_disable', true);
  if (!enabled) return { todo: 0, handover: 0, total: 0, disabled: true };

  const r = await one(
    `SELECT
       (SELECT count(*)::int FROM flow_task t JOIN flow_instance i ON i.id = t.instance_id
         WHERE t.assignee_id = $1 AND t.status = 'assigned'
           AND i.status = 'running' AND t.node_index = i.current_index) AS todo,
       (SELECT count(*)::int FROM work_handover
         WHERE from_user_id = $1 AND status IN ('draft','running')) AS handover`,
    [uid]
  ).catch(() => null);
  if (!r) return { todo: 0, handover: 0, total: 0 };
  const todo = Number(r.todo || 0);
  const handover = Number(r.handover || 0);
  return { todo, handover, total: todo + handover };
}

/** 列出某人的在途待交接事项摘要（停用提示用） */
export async function listDisableBlockers(userId) {
  const uid = toId(userId);
  if (!uid) return [];
  return many(
    `SELECT t.id, t.node_name, i.instance_no, i.title, fd.name AS def_name
       FROM flow_task t
       JOIN flow_instance i ON i.id = t.instance_id
       JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE t.assignee_id = $1 AND t.status = 'assigned'
        AND i.status = 'running' AND t.node_index = i.current_index
      ORDER BY i.created_at DESC LIMIT 50`,
    [uid]
  ).catch(() => []);
}

// ============================================================
// 五、查询接口支撑
// ============================================================

/** 交接单列表（分页 + 可见性过滤） */
export async function listHandovers({ user, tab = 'all', fromUserId, page = 1, size = 20 }) {
  const params = [];
  let where = '1=1';

  if (tab === 'mine') {
    params.push(user.id);
    where += ` AND w.from_user_id = $${params.length}`;
  } else if (tab === 'todo') {
    params.push(user.id);
    where += ` AND w.to_user_id = $${params.length} AND w.status = 'running'`;
  } else if (!user.isAdmin && !user.permissions?.includes('hr:handover')) {
    // 非人事/非管理员：仅见与自己相关
    params.push(user.id);
    const mp = params.length;
    where += ` AND (w.from_user_id = $${mp} OR w.to_user_id = $${mp})`;
  }
  if (fromUserId) {
    params.push(toId(fromUserId));
    where += ` AND w.from_user_id = $${params.length}`;
  }

  const offset = (page - 1) * size;
  return many(
    `SELECT w.*, fu.real_name AS from_name, tu.real_name AS to_name,
            d.name AS dept_name, d.name_en AS dept_name_en, i.instance_no, i.status AS inst_status
       FROM work_handover w
       LEFT JOIN org_user fu ON fu.id = w.from_user_id
       LEFT JOIN org_user tu ON tu.id = w.to_user_id
       LEFT JOIN org_department d ON d.id = w.dept_id
       LEFT JOIN flow_instance i ON i.id = w.instance_id
      WHERE ${where}
      ORDER BY w.created_at DESC, w.id DESC
      LIMIT ${Number(size)} OFFSET ${offset}`,
    params
  );
}

/** 交接单详情 */
export async function getHandoverDetail(id) {
  const h = await one(
    `SELECT w.*, fu.real_name AS from_name, tu.real_name AS to_name, d.name AS dept_name, d.name_en AS dept_name_en,
            i.instance_no, i.status AS inst_status
       FROM work_handover w
       LEFT JOIN org_user fu ON fu.id = w.from_user_id
       LEFT JOIN org_user tu ON tu.id = w.to_user_id
       LEFT JOIN org_department d ON d.id = w.dept_id
       LEFT JOIN flow_instance i ON i.id = w.instance_id
      WHERE w.id = $1`,
    [toId(id)]
  );
  if (!h) return null;
  const items = await many(
    `SELECT * FROM work_handover_item WHERE handover_id = $1 ORDER BY sort_order, id`,
    [h.id]
  );
  return { ...h, items };
}

export const __handoverInternals = { migrateTodos, replaceRouting };
