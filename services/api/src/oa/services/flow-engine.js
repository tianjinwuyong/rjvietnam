// ============================================================
// 流程引擎核心
// 职责：节点解析（找审批人）、条件分支判断、任务创建、超时判定
// 不引入重型 BPMN 引擎，状态由 flow_instance.status + current_index 表达
// P2 扩展：
//   - resolveAssignees 支持 岗位/部门域/多来源会签（向后兼容旧取值）
//   - matchCondition 支持 value_ref（读 sys_config 阈值），带缓存
//   - 终态改为七态：completed / withdrawn / terminated / archived
//   - 新增 execute / verify 闭环节点处理
//   - 新增 returnToApplicant / transferTask / urgeInstance / terminateInstance / archiveInstance
// ============================================================
import { many, one, query } from '../db/index.js';
import { notify } from './notify.js';
import { enqueueWmsEvent } from './wms-webhook.js';
import { isAdminUser, listAdminUserIds } from '../utils/admin.js';
import { assertDocReviewed } from './doc-review-read.js';

/**
 * 把条件值归一成字符串数组：
 *   - 数组：逐项 toString
 *   - 字符串：按英文/中文逗号、顿号、分号、竖线切分（兼容配置器里手填 "a,b,c"）
 *   - 其它：单元素
 * 供 in / nin 使用。空值返回空数组（in 恒不成立、nin 恒成立）。
 */
function toValueList(v) {
  if (Array.isArray(v)) return v.filter(x => x !== null && x !== undefined).map(String);
  if (v === null || v === undefined) return [];
  return String(v).split(/[,，、;；|]/).map(s => s.trim()).filter(Boolean);
}

const CONDITION_OPS = {
  eq: (a, b) => String(a) === String(b),
  ne: (a, b) => String(a) !== String(b),
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  // 多值判定：一个节点可同时覆盖多个取值（如「一级/二级/三级体系类」共用同一会签节点），
  // 避免把同一节点复制成多份同名节点。
  in: (a, b) => toValueList(b).includes(String(a)),
  nin: (a, b) => !toValueList(b).includes(String(a)),
};

// 阈值缓存：sys_config 变更后 60 秒内自动失效，避免每次审批都查库
const CONFIG_TTL_MS = 60 * 1000;
const configCache = new Map(); // key -> { value, at }

async function getThreshold(key) {
  if (!key) return null;
  const hit = configCache.get(key);
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.value;
  const row = await one(`SELECT value FROM sys_config WHERE key = $1`, [key]);
  const value = row?.value ?? null;
  configCache.set(key, { value, at: Date.now() });
  return value;
}

/** 手动失效阈值缓存（管理员改配置后调用） */
export function invalidateThresholdCache() {
  configCache.clear();
}

// ============================================================
// 提交前置校验（可注册）
// ------------------------------------------------------------
// 与「终态钩子」相对：这里在单据提交时校验业务约束，不通过就直接拒绝提交
// （而不是等审批完/计薪时才告警）。失败必须抛出带 statusCode=4xx 的业务错误，
// 由路由层原样回显给申请人改单。
// 目前只有休假额度（年假按月累积、不可透支）；新增流程在此追加分支。
// ============================================================
async function runSubmitGuards(inst) {
  const code = inst?.def_code;
  try {
    if (code === 'leave') {
      const mod = await import('./leave-balance.js');
      await mod.assertLeaveQuota({
        userId: Number(inst.applicant_id),
        formData: inst.form_data || {},
        instanceId: Number(inst.id)
      });
    } else if (code === 'salary_adjust') {
      // 补发/扣发金额与归属月份在提交时就校验，别等审批完才发现扣发填了正数
      const mod = await import('./salary-adjust.js');
      mod.parseAdjustForm(inst.form_data || {});
    }
  } catch (err) {
    // 业务校验错误原样上抛（额度不足等），其它异常也阻断提交但附加流程上下文
    if (err && err.isBiz) throw err;
    const e = new Error('单据提交校验失败：' + (err?.message || String(err)));
    e.statusCode = 400;
    e.isBiz = true;
    throw e;
  }
}

// ============================================================
// 终态业务钩子分发（可注册）
// ------------------------------------------------------------
// 流程走到终态（completed）时，按流程 code 分发到对应业务模块的终态回调。
// 每个分支独立 try/catch：失败仅 warn，绝不阻断主流程。
// 动态 import 规避循环依赖（各业务模块顶层 import 了本模块）。
// 新增流程只需在此追加一个分支，避免 if 越堆越长。
// @param {object} inst flow_instance 行（含 def_code）
// @param {number} instanceId
// ============================================================
async function runTerminalHooks(inst, instanceId) {
  const code = inst?.def_code;
  try {
    if (code === 'doc_controlled_issue') {
      // S1 T03：体系文件受控发行闭环（幂等由 onIssueApproved 内部保证）
      const mod = await import('./doc-issue.js');
      await mod.onIssueApproved(instanceId);
    } else if (code === 'doc_obsolete') {
      // 体系文件废除流程闭环 → 落废除动作（幂等由 onObsoleteApproved 内部保证）
      const mod = await import('./doc-obsolete.js');
      await mod.onObsoleteApproved(instanceId);
    } else if (code === 'equip_repair') {
      // S3 T05：设备维修闭环终态入履历（幂等由 onRepairClosed 内部保证）
      const mod = await import('./equipment-repair.js');
      await mod.onRepairClosed(instanceId);
    } else if (code === 'leave') {
      // S5：休假审批完成 → 回写考勤汇总（幂等由 onLeaveClosed 内部保证）
      const mod = await import('./attendance-service.js');
      await mod.onLeaveClosed(instanceId);
    } else if (code === 'salary_adjust') {
      // 补发/扣发审批通过 → 落 salary_adjustment，计薪时税后加减并入当月工资
      // （幂等由 instance_id 唯一键 + ON CONFLICT 保证）
      const mod = await import('./salary-adjust.js');
      await mod.onSalaryAdjustClosed(instanceId);
    } else if (code === 'miss_card') {
      // S5：补卡审批完成 → 补录打卡原始并重算汇总（幂等由 onMissCardClosed 内部保证）
      const mod = await import('./attendance-service.js');
      await mod.onMissCardClosed(instanceId);
    } else if (code === 'comp_day') {
      // S5：调休/补班审批完成 → 登记日期覆盖 + 调排班 + 记账冲抵 + 重算（幂等由 onCompDayClosed 内部保证）
      const mod = await import('./comp-service.js');
      await mod.onCompDayClosed(instanceId);
    } else if (code === 'handover') {
      // 工作交接完成 → 批量转交在途待办 + 后续流程替换（幂等由 applied_at 保证）
      const mod = await import('./handover-service.js');
      await mod.onHandoverClosed(instanceId);
    } else if (code === 'equipment_stocktake') {
      // 设备盘点发布/结束审批通过 → 按 form_data.stage 回写盘点单状态
      // （幂等由 onStocktakeApproved 内部 WHERE status 守卫保证；失败仅 warn）
      const mod = await import('./equipment-stocktake.js');
      await mod.onStocktakeApproved(instanceId);
    } else if (code === 'monthly_performance') {
      // 月度绩效考核批准 → 解析表单逐行写 performance_record（幂等由唯一键保证；失败仅 warn）
      const mod = await import('./salary-service.js');
      await mod.onPerformanceClosed(instanceId);
    } else if (code === 'mrb_review' || code === 'wms_mrb') {
      // MRB 评审流程走完 → 回填 WMS（WMS 按自身状态机推进预审/终审并执行处置）
      // 幂等由 onMrbApproved 内部的 wms_decided 判断保证
      const mod = await import('./oa-mrb-service.js');
      await mod.onMrbApproved(instanceId);
    } else if (code === 'wms_iqc_report' || code === 'oa_iqc_report') {
      // IQC 检验报告审批通过 → 回填 WMS 落账（库存迁移/欠料/自动MRB/严格度全在 WMS 事务内）
      // 幂等由 onIqcApproved 内部的 wms_synced 判断保证
      const mod = await import('./oa-iqc-service.js');
      await mod.onIqcApproved(instanceId);
    } else if (code === 'schedule_plan') {
      // 排班计划审批通过 → 回写生效排班 attendance_schedule
      // 幂等由 applied_at 抢占保证；回写失败只 warn，plan 停在 approved + applied_at IS NULL，
      // 可由人事在计划页点「重试回写」补偿（POST /api/schedule-plan/:id/apply）
      const mod = await import('./schedule-plan-service.js');
      await mod.onSchedulePlanClosed(instanceId);
    }
  } catch (err) {
    console.warn(
      `[flow-engine] 终态钩子失败（已忽略，不影响主流程）def=${code} instance=${instanceId}:`,
      err?.message || err
    );
  }
}

/**
 * 授权校验：解析调用方对某实例的访问级别（与单据详情接口可见性保持一致）。
 *
 * 管理员 = 拥有 admin 角色（sys_user_role ⋈ sys_role.code='admin'）；
 * 参与人 = 发起人 ∪ 任一 flow_task.assignee_id ∪ flow_cc.user_id。
 *
 * 供 /cc、/temp-add、/urge 等"对单据操作"的服务函数做同源授权，
 * 避免无关账号通过自加抄送/自加签等方式绕过单据可见性隔离。
 *
 * @param {number} instanceId
 * @param {number} userId
 * @returns {Promise<{inst:(object|null), isAdmin:boolean, isApplicant:boolean, isInvolved:boolean, allowed:boolean}>}
 */
async function resolveInstanceAccess(instanceId, userId) {
  const inst = await one(`SELECT * FROM flow_instance WHERE id = $1`, [instanceId]);
  if (!inst) {
    return { inst: null, isAdmin: false, isApplicant: false, isInvolved: false, allowed: false };
  }
  const isAdmin = await isAdminUser(userId);
  const isApplicant = Number(inst.applicant_id) === Number(userId);
  let isInvolved = false;
  if (!isAdmin && !isApplicant) {
    isInvolved = (await one(
      `SELECT 1 AS ok
         WHERE EXISTS (SELECT 1 FROM flow_task WHERE instance_id = $1 AND assignee_id = $2)
            OR EXISTS (SELECT 1 FROM flow_cc  WHERE instance_id = $1 AND user_id    = $2)`,
      [instanceId, userId]
    )) != null;
  }
  return { inst, isAdmin, isApplicant, isInvolved, allowed: isAdmin || isApplicant || isInvolved };
}

/**
 * 判断某节点的条件是否满足；无 condition 视为满足。
 * 支持 condition.value_ref 指向 sys_config 的阈值键（金额/天数/数量均可）。
 */
async function matchCondition(condition, formData, extra = {}) {
  if (!condition) return true;
  const source = { ...formData, ...extra };
  const actual = source[condition.field];
  if (actual === undefined || actual === null || actual === '') return false;
  const op = CONDITION_OPS[condition.op];
  if (!op) return true;
  let expected = condition.value;
  if (condition.value_ref) {
    expected = await getThreshold(condition.value_ref);
    // 阈值未配置时不阻塞流程（视为条件成立，走该节点）
    if (expected === null || expected === undefined) return true;
  }
  return op(actual, expected);
}

// ------------------------------------------------------------
// 审批人解析
// ------------------------------------------------------------

// ------------------------------------------------------------
// 岗位职级（审批节点「提交人已高于该节点」时自动跳过）
// ------------------------------------------------------------
// 数据源：sys_i18n_dict(dict_type='position')，sort_order **越小职级越高**
//   gm=1 > vp=2 > gm_asst=3 > dept_mgr=4 > dept_sup=5 > engineer=6 > ... > shift_lead=9 > team_lead=10 > staff=12
// 60s 缓存，与 getThreshold 同节奏（管理员改字典后最多 1 分钟生效）。
let posRankCache = null; // { map: Map<code, number>, at: number }

async function getPositionRankMap() {
  const hit = posRankCache;
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.map;
  const rows = await many(
    `SELECT code, sort_order FROM sys_i18n_dict WHERE dict_type = 'position' AND active = TRUE`
  );
  const map = new Map();
  for (const r of rows) map.set(String(r.code), Number(r.sort_order));
  posRankCache = { map, at: Date.now() };
  return map;
}

/** 手动失效岗位职级缓存（管理员改岗位字典后调用） */
export function invalidatePositionRankCache() {
  posRankCache = null;
}

/**
 * 从节点 assign 表达式里抽出「本部门该节点要求的岗位编码」，用于职级比较。
 *
 * 只有 **position_self:<code>**（本部门某岗位）才可参与比较：
 *   · position:<dept>:<code> 明确指定了他部门的岗位（如 ECN 里 `position:PD:shift_lead`），
 *     该节点是「请生产部确认」，与提交人自己多高级无关 —— 一律不跳过；
 *   · role:/user:/user_selected/dept_leader 无法换算成岗位职级 —— 不参与；
 *   · 数组（多来源会签，如 ["position_self:shift_lead","role:warehouse"]）：
 *     只要有第二个来源，就说明该节点要求「多方才算完」，不允许被职级跳过。
 *
 * @param {*} assign 单个表达式或表达式数组
 * @returns {string|null} 仅当节点唯一要求「本部门某岗位」时返回该岗位 code
 */
function assignPositionCode(assign) {
  if (Array.isArray(assign)) return null;   // 会签/多来源：不参与职级跳过
  if (typeof assign !== 'string') return null;
  if (!assign.startsWith('position_self:')) return null;
  return assign.slice('position_self:'.length) || null;
}

/**
 * 判断某审批节点是否应因「提交人职级不低于该节点要求」而自动跳过。
 *
 * 规则（仅 approval 节点）：
 *   · 提交人岗位职级 rank(applicant) <= rank(节点要求岗位)  → 跳过
 *     （值越小越高；相等也跳过 —— 自己不能审自己，引擎本来也会把他排除掉，
 *      只排除不跳过的话节点会因「无可用审批人」而挂起）
 *   · execute / verify 节点不跳过：整改执行与闭环验证必须有人实际完成。
 *   · 提交人或目标岗位缺职级信息 → 不跳过（保守，宁可挂起也不越权放行）。
 *
 * @param {object} node 节点定义
 * @param {{positionCode:string|null, name:string}} applicant 上溯主体（被签卡人优先）
 * @returns {Promise<{skip:boolean, reason?:string}>}
 */
async function skipByApplicantLevel(node, applicant) {
  const type = node?.type || 'approval';
  if (type !== 'approval') return { skip: false };
  const targetCode = assignPositionCode(node.assign);
  if (!targetCode) return { skip: false };
  const ranks = await getPositionRankMap();
  const targetRank = ranks.get(targetCode);
  const selfRank = applicant?.positionCode ? ranks.get(applicant.positionCode) : undefined;
  if (targetRank === undefined || selfRank === undefined) return { skip: false };
  if (selfRank > targetRank) return { skip: false };   // 提交人比节点要求更低 → 正常走该节点
  return {
    skip: true,
    reason: `提交人岗位「${applicant.positionCode}」(职级 ${selfRank}) 不低于本节点要求「${targetCode}」(职级 ${targetRank})，自动跳过 ${node.name}`,
  };
}

/**
 * 判断审批节点是否应因「发起人本人就是本节点唯一的候选人」而自动跳过。
 *
 * 背景（2026-11-04 用户要求）：体系文件发行流程里，部门负责人自己发起文件时，
 * 「部门负责人审核」节点按规则把发起人排除掉（不能自己审自己），降级链又全部落空
 * （无 dept_mgr 职位 → dept_sup 就是本人被跳 → dept_leader 也是本人且不降级），
 * 结果是提交后静默挂起。正确语义是：**这个节点本来就没有第二个人可审，应该直接跳过**，
 * 而不是挂在自己手上等自己批。
 *
 * 判定（仅 approval 节点）：
 *   1. 正常解析（排除发起人）→ 有人：说明本节点能派给别人，不跳过；
 *   2. 为空 → 把发起人放回来再解析一次（含 fallback 链）：
 *        · 唯一候选人就是他本人 → 跳过，写 flow_log(auto_skip) 留痕；
 *        · 一个候选人都没有 → 不跳过（交给「无可用审批人」告警，需管理员指派）；
 *        · 候选人是别人 → 不跳过（不该因为我们排除了发起人就把节点吞掉）。
 * execute / verify 节点不参与：整改执行与闭环验证必须有人实际完成（发起人本人正是执行人）。
 *
 * @returns {Promise<{reason:string}|null>} 需要跳过时返回跳过原因
 */
async function skipWhenApplicantIsOnlyAssignee(node, instance) {
  const type = node?.type || 'approval';
  if (type !== 'approval') return null;

  // ① 正常口径（排除发起人）能派出去 → 不跳过
  const normal = await resolveAssignees(node, instance, {});
  if (normal.length) return null;

  // ② 含发起人再解析一次（走同一套 assign + fallback 链）
  const withSelf = await resolveAssignees(node, instance, {}, { includeApplicant: true });
  const ids = withSelf.map(p => Number(p.id)).filter(v => Number.isInteger(v) && v > 0);
  if (!ids.length) return null;

  const selfIds = new Set(
    [Number(instance.applicant_id), Number(instance.subject_user_id || 0)]
      .filter(v => Number.isInteger(v) && v > 0)
  );
  if (!ids.every(id => selfIds.has(id))) return null;

  return { reason: `发起人本人即本节点唯一审批人（${node.name}），自动跳过` };
}

/** 按岗位编码找人（本部门或指定部门） */async function resolveByPosition(posCode, departmentId, excludeId, node = {}) {
  if (!posCode) return [];
  const params = [posCode, excludeId || 0];
  let deptFilter = '';
  if (departmentId) {
    params.push(departmentId);
    deptFilter = `AND u.department_id = $${params.length}`;
  }
  const rows = await many(
    `SELECT u.id FROM org_user u
      WHERE u.position_code = $1 AND u.active = TRUE
        AND NOT COALESCE(u.is_system, FALSE) AND u.id <> $2 ${deptFilter}
      LIMIT 20`,
    params
  );
  return rows.map(r => ({ id: Number(r.id), tempAddable: !!node.temp_addable }));
}

/**
 * 取某部门的「负责人」—— 完全按组织架构推导，**不依赖角色数据**。
 *
 * 解析顺序（逐级兜底，命中即返回）：
 *   1) `org_department.leader_id` 指向的用户 —— 必须真实存在、在职、非系统账号
 *      （历史数据里 leader_id 可能指向已删除用户，必须校验，否则会返回幽灵 id）
 *   2) 该部门 **及其下属子部门** 在职人员中「岗位职级最高」者（sort_order 最小）
 *   3) 本部门无人 → 上溯父部门，重复 1/2（最多 5 层，带环路保护）
 *   4) 全无 → 返回 []，由调用方走 node.fallback 或标记挂起
 *
 * 说明：`excludeId`（通常是提交人）始终排除 —— 审批人不能审自己的单。
 * 因此「部门里只有一个人且他就是提交人」时本函数返回空，这正是期望行为
 * （应上溯到上级部门或走 fallback），而不是让他自审。
 *
 * @param {number|string} departmentId 部门 id
 * @param {number} excludeId 需排除的用户 id（提交人）
 * @param {object} node 节点定义（仅取 temp_addable）
 * @returns {Promise<Array<{id:number, tempAddable:boolean}>>}
 */
async function resolveDeptLeader(departmentId, excludeId, node = {}) {
  if (!departmentId) return [];
  const ranks = await getPositionRankMap();
  let cur = Number(departmentId);
  const seen = new Set();
  for (let depth = 0; depth < 5; depth++) {
    if (!cur || seen.has(cur)) break;
    seen.add(cur);
    const dept = await one(
      `SELECT id, leader_id, parent_id FROM org_department WHERE id = $1`,
      [cur]
    );
    if (!dept) break;

    // 1) 显式登记的负责人（须真实存在且在职）
    if (dept.leader_id && Number(dept.leader_id) !== Number(excludeId || 0)) {
      const lead = await one(
        `SELECT id FROM org_user
          WHERE id = $1 AND active = TRUE AND NOT COALESCE(is_system, FALSE)`,
        [dept.leader_id]
      );
      if (lead) return [{ id: Number(lead.id), tempAddable: !!node.temp_addable }];
    }

    // 2) 部门（含子部门）内职级最高者
    //    先算「含提交人在内」的最高职级，再在排除提交人后取同职级的人。
    //    若最高职级只有提交人一人（他就是本部门负责人），不降级去请下级审批，
    //    而是继续上溯父部门 —— 避免出现「技术员审主管」这种倒挂。
    const rows = await many(
      `WITH RECURSIVE sub AS (
         SELECT id FROM org_department WHERE id = $1
         UNION ALL
         SELECT d.id FROM org_department d JOIN sub ON d.parent_id = sub.id
       )
       SELECT u.id, u.position_code, (u.id = $2::bigint) AS is_self
         FROM org_user u
         JOIN sub ON sub.id = u.department_id
        WHERE u.active = TRUE AND NOT COALESCE(u.is_system, FALSE)`,
      [cur, excludeId || 0]
    );
    if (rows.length) {
      const rankOf = r => ranks.get(String(r.position_code || '')) ?? 999;
      let topRank = Infinity;
      for (const r of rows) topRank = Math.min(topRank, rankOf(r));
      const cands = rows.filter(r => !r.is_self && rankOf(r) === topRank);
      if (cands.length) {
        return [{ id: Number(cands[0].id), tempAddable: !!node.temp_addable }];
      }
      // 最高职级只有提交人本人 → 本部门无人可审，继续上溯
    }

    // 3) 上溯父部门
    cur = dept.parent_id ? Number(dept.parent_id) : null;
  }
  return [];
}

/**
 * 按角色找人。
 *
 * 设计原则（2026-10-28 用户定）：**「部门 + 职位」是唯一真值，角色只是权限**。
 * 线上角色表几乎是空的（员工不配角色），因此角色查不到人时必须能沿组织架构继续找，
 * 不能因为「没人配这个角色」就把流程挂起。
 *
 * 解析顺序：
 *   1) 角色 code / 角色名称（旧写法，配了就用）
 *   2) 岗位 code 直接匹配（role:pos_3kul5d 这类，或 role:EN:engineer 的 engineer 段）
 *   3) 岗位中文名 / 越文名（role:品质主管 这类自然语言写法）
 *   4) 部门 code / 部门名称 → 该部门负责人（role:finance → 财务部负责人）
 *   5) 都没有 → 返回 []，走 node.fallback
 */
async function resolveByRoleLike(code, departmentId, excludeId, node = {}) {
  if (!code) return [];

  // 0) `dept_leader` 是特殊关键字（部门负责人），不是岗位也不是角色
  //    兼容旧写法 role:QA:dept_leader —— 此时 departmentId 已由外层解析为 QA 的 id
  if (code === 'dept_leader') {
    return resolveDeptLeader(departmentId, excludeId, node);
  }

  const params = [code, excludeId || 0];
  let deptFilter = '';
  if (departmentId) {
    params.push(departmentId);
    deptFilter = `AND u.department_id = $${params.length}`;
  }
  const rows = await many(
    `SELECT DISTINCT u.id FROM sys_user_role ur
       JOIN sys_role r ON r.id = ur.role_id
       JOIN org_user u ON u.id = ur.user_id
      WHERE (r.code = $1 OR r.name = $1) AND u.active = TRUE
        AND NOT COALESCE(u.is_system, FALSE) AND u.id <> $2 ${deptFilter}
      LIMIT 20`,
    params
  );
  if (rows.length) return rows.map(r => ({ id: Number(r.id), tempAddable: !!node.temp_addable }));

  // 2) 当作岗位编码
  let hit = await resolveByPosition(code, departmentId, excludeId, node);
  if (hit.length) return hit;

  // 3) 当作岗位名称（中文/越文）→ 换算成岗位编码
  const byName = await one(
    `SELECT code FROM sys_i18n_dict
      WHERE dict_type = 'position' AND active = TRUE
        AND (code = $1 OR name_zh = $1 OR name_vi = $1)
      ORDER BY sort_order LIMIT 1`,
    [code]
  );
  if (byName?.code && byName.code !== code) {
    hit = await resolveByPosition(byName.code, departmentId, excludeId, node);
    if (hit.length) return hit;
  }

  // 4) 当作部门（code 或名称）→ 该部门负责人
  const dId = await deptIdByCode(code);
  if (dId) return resolveDeptLeader(dId, excludeId, node);

  return [];
}

/** 部门代码/名称 → 部门 id */
async function deptIdByCode(code) {
  if (!code) return null;
  const row = await one(
    `SELECT id FROM org_department WHERE code = $1 OR name = $1 ORDER BY id LIMIT 1`,
    [code]
  );
  return row?.id || null;
}

/** 部门 id → 部门 code */
async function deptCodeById(id) {
  if (!id) return null;
  const row = await one(`SELECT code FROM org_department WHERE id = $1`, [id]);
  return row?.code || null;
}

/** 解析单个指派表达式 */
async function resolveByExpr(expr, node, instance, extra, applicant, opts = {}) {
  if (!expr || typeof expr !== 'string') return [];
  const selfDept = applicant.department_id;

  // 「排除提交人」只对审批/验证节点生效：审批人不能审自己的单，
  // 验证人也不能自己验证自己；但 **执行类（execute）节点本身就是"谁提报谁负责整改"**，
  // 若同样排除提交人，会在"部门只有一个主管"的单位里解析为空 → 整条流程挂起
  // （2026-10-28 Near Miss 实测：工程部主管提报后，整改执行节点 0 人）。
  //
  // opts.includeApplicant：把提交人本人也纳入解析。只用于 advance() 里判断
  // 「这个节点唯一的候选人就是发起人自己吗」——是则整节点自动跳过，避免
  // 单据永远挂在自己手上等自己批（2026-11-04 用户要求）。
  //
  // node.allow_self_approval：节点级例外，允许「同一人换一个身份」继续签。
  // 用于体系文件发行的「管理者代表审核/批准」——管理者代表常常就是文件归口部门的
  // 负责人（李忠顺同时是质量管理部负责人与管理者代表），他提交本部门文件后，
  // 该节点若按常规排除他，会兜底落到体系工程师头上，等于把管理者代表的职权
  // 转给了别人。这里显式声明：此节点认人（角色），不认「是否发起人」。
  const excludeForNode = (opts?.includeApplicant || node?.allow_self_approval)
    ? 0
    : ((node?.type === 'execute') ? 0 : (applicant.id || 0));

  // 发起人/上一节点指定（如交接人、证明人、处置执行人）
  if (expr === 'user_selected') {
    const keys = [`${node.name}_user`, node.sel_key].filter(Boolean);
    let picked = extra?.selectedUserId;
    if (!picked) {
      for (const k of keys) {
        const v = instance.form_data?.[k];
        if (v !== undefined && v !== null && v !== '') { picked = v; break; }
      }
    }
    if (picked) {
      const ids = Array.isArray(picked) ? picked : [picked];
      return ids
        .filter(v => v !== null && v !== undefined && v !== '')
        .map(v => ({ id: Number(v), tempAddable: false }));
    }
    // 无指定人时的兜底来源（如报废处置默认由仓储执行）
    if (node.fallback) return resolveByExpr(node.fallback, node, instance, extra, applicant);
    return [];
  }

  if (expr === 'dept_leader') {
    // 按组织架构取部门负责人（leader_id → 部门内最高职级 → 上溯父部门），不依赖角色
    return resolveDeptLeader(selfDept, excludeForNode, node);
  }
  if (expr.startsWith('dept_leader:')) {
    const dId = await deptIdByCode(expr.slice('dept_leader:'.length));
    return resolveDeptLeader(dId, excludeForNode, node);
  }
  if (expr === 'manager') {
    if (applicant.manager_id) return [{ id: Number(applicant.manager_id), tempAddable: !!node.temp_addable }];
    return resolveDeptLeader(selfDept, excludeForNode, node);
  }
  if (expr === 'vp') return resolveByRoleLike('vp', null, excludeForNode, node);
  if (expr === 'gm') return resolveByRoleLike('gm', null, excludeForNode, node);
  if (expr.startsWith('user:')) {
    return [{ id: Number(expr.slice(5)), tempAddable: !!node.temp_addable }];
  }
  if (expr.startsWith('position_self:')) {
    const posCode = expr.slice('position_self:'.length);
    return resolveByPosition(posCode, selfDept, excludeForNode, node);
  }
  if (expr.startsWith('position:')) {
    const parts = expr.slice('position:'.length).split(':');
    if (parts.length >= 2) {
      const dId = await deptIdByCode(parts[0]);
      return resolveByPosition(parts[1], dId, excludeForNode, node);
    }
    return resolveByPosition(parts[0], null, excludeForNode, node);
  }
  if (expr.startsWith('role:')) {
    const parts = expr.slice(5).split(':');
    if (parts.length >= 2) {
      const dId = await deptIdByCode(parts[0]);
      return resolveByRoleLike(parts[1], dId, excludeForNode, node);
    }
    return resolveByRoleLike(parts[0], null, excludeForNode, node);
  }
  return [];
}

/**
 * 解析某个节点需要哪些人审批。
 * 支持：dept_leader / dept_leader:<dept> / manager / vp / gm /
 *       role:<code> / role:<dept>:<code> / position_self:<pos> / position:<dept>:<pos> /
 *       user:<id> / user_selected（含 sel_key / fallback） / assign 数组（多来源并行会签）
 *
 * 主体分流（subject）：签卡代提时以「被签卡人」为上溯主体，而非提交人（applicant）。
 *
 * @param {object} node 节点定义
 * @param {object} instance flow_instance 行（需含 applicant_id / subject_user_id / def_code 等）
 * @param {object} extra 额外上下文
 * @param {object} [opts] 选项（保留形参以兼容调用方）
 */
async function resolveAssignees(node, instance, extra = {}, opts = {}) {  const applicant = await one(
    `SELECT id, department_id, manager_id, real_name FROM org_user WHERE id = $1`,
    [instance.applicant_id]
  );
  if (!applicant) return [];

  // 主体分流：subject_user_id 非空 → 用被签卡人作为"上溯主体"（部门/直属主管/经理均按他解析）
  let subject = applicant;
  if (instance.subject_user_id && Number(instance.subject_user_id) !== Number(instance.applicant_id)) {
    const s = await one(
      `SELECT id, department_id, manager_id, real_name FROM org_user WHERE id = $1`,
      [instance.subject_user_id]
    );
    if (s) subject = s;
  }

  const resolved = await resolveAssigneesCore(node, instance, extra, subject, opts);
  if (resolved.length) return resolved;

  // 主来源解析为空 → 走节点级 fallback 链（字符串或数组，按顺序取第一个有人的）。
  // 场景：岗位/角色空缺（如公司未登记部门经理）时，把节点顺延到实际在任的上级，
  // 避免流程永久挂起在「无可用审批人」。fallback 写错/为空时行为与原来一致（挂起）。
  if (node.fallback) {
    const chain = Array.isArray(node.fallback) ? node.fallback : [node.fallback];
    for (const f of chain) {
      if (!f || typeof f !== 'string' || f === node.assign) continue;
      const got = await resolveByExpr(f, node, instance, extra, subject, opts);
      if (got.length) return got;
    }
  }
  return [];
}

/** resolveAssignees 的主体解析部分（不含 fallback 兜底，便于外层统一兜底） */
async function resolveAssigneesCore(node, instance, extra, subject, opts = {}) {
  const assign = node.assign;
  if (Array.isArray(assign)) {
    const merged = new Map();
    for (const a of assign) {
      const list = await resolveByExpr(a, node, instance, extra, subject, opts);
      for (const u of list) {
        if (u && u.id !== null && u.id !== undefined && !merged.has(Number(u.id))) {
          merged.set(Number(u.id), { ...u, id: Number(u.id) });
        }
      }
    }
    return [...merged.values()];
  }
  return resolveByExpr(assign, node, instance, extra, subject, opts);
}

/**
 * 单号前缀兜底推导（流程没配 no_prefix 时用）。
 * 例：`wms_over_consume` → `WOC`、`salary_adjust` → `SA`、`new_flow_x` → `NFX`。
 * 取每个下划线段的首字母，最多 4 位；`wms_` 段按 `W` 计，避免所有 WMS 流程都变 `W...`。
 */
function fallbackNoPrefix(code) {
  const parts = String(code || 'FLOW').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const letters = parts.map((p) => (p === 'wms' ? 'W' : p[0])).join('');
  return (letters || 'FLOW').toUpperCase().slice(0, 4);
}

/**
 * 生成单号，如 `DOC-260815-003`（2026-11-06 起的新规则）
 *
 * 格式：`<短前缀>-<YYMMDD>-<流水>`，流水按「前缀 + 日」独立计数，
 * 至少 3 位、超过 999 自然进位到 4 位（不截断）。
 *
 * 旧规则是 `<流程CODE大写>-<YYYYMMDD>-<6位流水>`（如 DOC_CONTROLLED_ISSUE-20260815-000003，
 * 38 字符），台账一列放不下要折 3 行，已由 tools/renumber-flow-instances.mjs 统一重编。
 *
 * 并发安全：原子取号（INSERT ... ON CONFLICT DO UPDATE ... RETURNING），
 * 单条语句内完成"读+自增+返回"，依赖行级锁保证并发下号码唯一。
 *
 * @param {{code:string, no_prefix?:string}} def 流程定义行（含短前缀）
 */
async function buildInstanceNo(def, client) {
  const code = typeof def === 'string' ? def : def?.code;
  const prefix = String((typeof def === 'object' && def?.no_prefix) || fallbackNoPrefix(code)).toUpperCase();
  const today = new Date();
  const ymd = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const scope = `${prefix}-${ymd}`;
  const q = client || { query };
  const res = await q.query(
    `INSERT INTO flow_instance_seq (scope, seq) VALUES ($1, 1)
     ON CONFLICT (scope) DO UPDATE SET seq = flow_instance_seq.seq + 1, updated_at = now()
     RETURNING seq`,
    [scope]
  );
  return `${scope}-${String(res.rows[0].seq).padStart(3, '0')}`;
}

/** 申请人所属部门代码（用于闭环责任部门留痕） */
async function applicantDeptCode(applicantId) {
  const row = await one(
    `SELECT d.code AS dept_code FROM org_user u
       LEFT JOIN org_department d ON d.id = u.department_id WHERE u.id = $1`,
    [applicantId]
  );
  return row?.dept_code || null;
}

/**
 * 解析实例运行时应使用的流程节点（S6 版本冻结修复）。
 *
 * 背景：flow_instance 记录 definition_version（创建时绑定的版本号）。
 *   发布/回滚会把快照 sync 回 flow_definition.flow_nodes，因此若运行时直接读
 *   flow_definition.flow_nodes，在途实例会被新版本"漂移"（改节点/提前终结）。
 *   本函数让运行时节点一律取自"实例绑定的版本快照"。
 *
 * 语义：
 *   - definition_version 为 NULL（存量实例，无绑定版本）→ 回退定义表，行为完全不变。
 *   - 有绑定版本 → 取 flow_definition_version(definition_id, version) 的 flow_nodes 快照。
 *   - 版本行被删/异常 → 回退定义表，保证流程可继续，不抛错。
 *
 * @param {object} inst 实例行（需含 definition_id / definition_version）
 * @param {any[]} defFlowNodes 定义表当前节点（回退用）
 * @param {{query:Function}} q 查询句柄（client 或 { query }）
 * @returns {Promise<any[]>} 运行时应使用的节点数组
 */
async function resolveNodes(inst, defFlowNodes, q) {
  // 实例级自定义（体系文件「提交前自由选择评审环节」，迁移 104）：
  // 发起人提交时把选定环节 + 审批人固化成快照写在 flow_instance.nodes_override。
  // 非空即以此为准 —— 优先级高于定义版本，且存量实例（该列为 NULL）行为完全不变。
  const ov = inst?.nodes_override;
  if (Array.isArray(ov) && ov.length) return ov;
  if (inst.definition_version == null) return defFlowNodes || [];
  const res = await q.query(
    `SELECT flow_nodes FROM flow_definition_version
      WHERE definition_id = $1 AND version = $2`,
    [inst.definition_id, inst.definition_version]
  );
  const ver = res.rows[0];
  return (ver && ver.flow_nodes) || defFlowNodes || [];
}

/** 推进到下一个满足条件的节点；无下一个则流程结束（终态 completed） */
async function advance(instanceId, client) {
  const q = client || { query };
  const inst = (await q.query(
    `SELECT fi.*, fd.flow_nodes, fd.name AS def_name, fd.code AS def_code
       FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
      WHERE fi.id = $1`,
    [instanceId]
  )).rows[0];
  if (!inst || inst.status !== 'running') return null;

  // S6：按实例绑定的版本快照取节点（存量实例回退定义表）
  const nodes = await resolveNodes(inst, inst.flow_nodes, q);
  let idx = (inst.current_index ?? -1) + 1;

  // 提交人（签卡代提时取被签卡人）岗位：用于「提交人职级已高于节点要求 → 自动跳过」判定
  const subjectRow = (await q.query(
    `SELECT id, position_code FROM org_user WHERE id = COALESCE($2::bigint, $1::bigint)`,
    [inst.applicant_id, inst.subject_user_id || null]
  )).rows[0] || null;
  const applicantPos = {
    id: subjectRow?.id ?? inst.applicant_id,
    positionCode: subjectRow?.position_code || null,
  };

  // 跳过抄送节点、条件不满足的节点、以及提交人职级已高于节点要求的审批节点
  while (idx < nodes.length) {
    const node = nodes[idx];
    if (node.type === 'cc') {
      // 抄送节点不阻塞流转，但**必须真的落下抄送**。
      // 历史缺陷：这里原本只 `idx++; continue;`，导致下面「node.type === 'cc'」分支永远不可达，
      //           定义里配了抄送节点也收不到任何抄送（报销流程「自动抄送总经理」就是被这个吞掉的）。
      // 幂等：advance 会因退回/重提被再次调用，同一 (实例,人,节点) 不重复插入、不重复通知。
      const ccUsers = await resolveAssignees(node, inst);
      for (const u of ccUsers) {
        const ins = await q.query(
          `INSERT INTO flow_cc (instance_id, user_id, node_index)
           SELECT $1,$2,$3
            WHERE NOT EXISTS (
              SELECT 1 FROM flow_cc
               WHERE instance_id=$1 AND user_id=$2 AND node_index=$3)`,
          [instanceId, u.id, idx]
        );
        if (ins.rowCount) {
          await notify(u.id, {
            title: `【抄送】${inst.title}`,
            content: `单据 ${inst.instance_no} 抄送给您（节点：${node.name || '抄送'}）。`,
            link: `/flow/detail/${instanceId}`,
            category: 'cc',
          });
        }
      }
      idx++;
      continue;
    }
    if (!(await matchCondition(node.condition, inst.form_data, { applicant_is_leader: false }))) {
      idx++;
      continue;
    }
    const lvl = await skipByApplicantLevel(node, applicantPos);
    if (lvl.skip) {
      // 自动跳过必须留痕：谁被跳过、为什么、按什么职级判断，事后可追
      await q.query(
        `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail)
         VALUES ($1, NULL, 'auto_skip', $2, $3)`,
        [instanceId, idx, lvl.reason]
      );
      idx++;
      continue;
    }

    // 发起人本人即本节点唯一审批人 → 跳过（部门负责人自己发起时，不该卡在「部门负责人审核」）
    const selfOnly = await skipWhenApplicantIsOnlyAssignee(node, inst);
    if (selfOnly) {
      await q.query(
        `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail)
         VALUES ($1, NULL, 'auto_skip', $2, $3)`,
        [instanceId, idx, selfOnly.reason]
      );
      idx++;
      continue;
    }
    break;
  }


  if (idx >= nodes.length) {
    // 正常结束 → 七态终态 completed；清理仍残留的待办，避免"幽灵待办"
    await q.query(
      `UPDATE flow_task SET status='skipped', finished_at=now() WHERE instance_id=$1 AND status='assigned'`,
      [instanceId]
    );
    await q.query(
      `UPDATE flow_instance SET status = 'completed', current_index = NULL, finished_at = now(), updated_at = now() WHERE id = $1`,
      [instanceId]
    );

    // 终态业务钩子分发（可注册，逐流程分支）。
    // - doc_controlled_issue：体系文件受控发行闭环（S1 T03，行为保持不变）
    // - equip_repair：设备维修闭环终态入履历（S3 T05）
    // - 幂等由各回调内部保证；失败不得阻断主流程：try/catch + 记 warn
    // - 动态 import 规避 flow-engine <-> 各业务模块 的循环依赖
    await runTerminalHooks(inst, instanceId);
    await enqueueWmsEvent({ query }, inst, 'completed', { status: 'completed' });

    await notify(inst.applicant_id, {
      title: `【办理完成】${inst.title}`,
      content: `您的单据 ${inst.instance_no} 已全部审批完成。`,
      link: `/flow/detail/${instanceId}`,
      category: 'todo',
    });
    return { finished: true, status: 'completed' };
  }

  // 清理上一节点（含会签节点）遗留的未处理任务，避免产生"幽灵待办"
  // 会签节点满足 min_approvals 后，同节点其余 assigned 任务在此统一置 skipped
  await q.query(
    `UPDATE flow_task SET status='skipped', finished_at=now()
      WHERE instance_id=$1 AND status='assigned' AND node_index < $2`,
    [instanceId, idx]
  );

  const node = nodes[idx];

  // 抄送节点：不阻塞流转，只记录（防御性保留，正常已在上面跳过）
  if (node.type === 'cc') {
    const ccUsers = await resolveAssignees({ ...node, assign: node.assign }, inst);
    for (const u of ccUsers) {
      await q.query(
        `INSERT INTO flow_cc (instance_id, user_id, node_index) VALUES ($1,$2,$3)`,
        [instanceId, u.id, idx]
      );
      await notify(u.id, {
        title: `【抄送】${inst.title}`,
        content: `单据 ${inst.instance_no} 抄送给您。`,
        link: `/flow/detail/${instanceId}`,
        category: 'cc',
      });
    }
    idx++;
    return advance(instanceId, client);
  }

  const assignees = await resolveAssignees(node, inst, {
    selectedUserId: inst.form_data?.[`${node.name}_user`],
  });

  if (assignees.length === 0) {
    // 找不到审批人：挂起并通知管理员，避免流程静默卡死。
    // 需求（P1 缺陷修复）：不再静默停留——必须写入明确告警日志（含
    // def_code / 节点名 / 节点序号 / assign 表达式），并保留 current_index
    // 指向该节点，使详情接口可回传告警、管理员可通过 assignNodeToCurrent
    // 指派审批人接管。若上一节点有处理人则给出回退建议。
    const assignExpr = Array.isArray(node.assign) ? node.assign.join(' + ') : String(node.assign ?? '');
    const prevAssignee = await q.query(
      `SELECT t.assignee_id, u.real_name
         FROM flow_task t LEFT JOIN org_user u ON u.id = t.assignee_id
        WHERE t.instance_id = $1 AND t.node_index < $2 AND t.assignee_id IS NOT NULL
        ORDER BY t.node_index DESC, t.finished_at DESC NULLS LAST LIMIT 1`,
      [instanceId, idx]
    );
    const prev = prevAssignee.rows[0] || null;
    const detail = `节点「${node.name}」未解析到可用审批人，流程已挂起待指派`
      + `（def_code=${inst.def_code}, node_index=${idx}, assign=${assignExpr}）`
      + (prev ? `；建议回退至上一节点处理人「${prev.real_name || prev.assignee_id}」` : '');
    await q.query(
      `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail)
       VALUES ($1, NULL, 'no_assignee', $2, $3)`,
      [instanceId, idx, detail]
    );
    const admins = await listAdminUserIds();
    for (const adminId of admins) {
      await notify(adminId, {
        title: `【流程挂起】${inst.instance_no}`,
        content: `节点「${node.name}」无可用审批人，请在单据详情中指派审批人后继续。`,
        link: `/flow/detail/${instanceId}`,
        category: 'system',
      });
    }
    // 保持 current_index 指向挂起节点，供详情接口回传告警与管理员指派入口
    await q.query(
      `UPDATE flow_instance SET current_index = $2, updated_at = now() WHERE id = $1`,
      [instanceId, idx]
    );
    return { finished: false, stuck: true, nodeIndex: idx, nodeName: node.name, assignExpr, fallbackPrev: prev?.assignee_id || null };
  }

  // 创建审批/执行/验证任务
  const nodeType = node.type || 'approval';
  for (const a of assignees) {
    await q.query(
      `INSERT INTO flow_task (instance_id, node_index, node_name, node_type, assignee_id, status)
       VALUES ($1,$2,$3,$4,$5,'assigned')`,
      [instanceId, idx, node.name, nodeType, a.id]
    );
    const typeHint = nodeType === 'execute' ? '（执行回复）'
      : nodeType === 'verify' ? '（验证闭环）'
      : (nodeType === 'approval' && (node.min_approvals || 1) > 1 ? `（会签，需 ${node.min_approvals} 人通过）` : '');
    await notify(a.id, {
      title: `【待处理】${inst.title}`,
      content: `${node.name} 等待您处理${typeHint}`,
      link: `/flow/detail/${instanceId}`,
      category: 'todo',
    });
  }

  await q.query(
    `UPDATE flow_instance SET current_index = $2, updated_at = now() WHERE id = $1`,
    [instanceId, idx]
  );

  // 节点通过通知：外部业务系统（WMS）按节点推进状态
  await enqueueWmsEvent(q, { ...inst, current_index: idx }, 'node_passed', {
    status: 'running', nodeIndex: idx, nodeName: node.name,
  });

  return { finished: false, nodeIndex: idx, nodeName: node.name, assigneeCount: assignees.length };
}

/** 提交单据：草稿 → 审批中（退回重填后再次提交同样走这里） */
export async function submitInstance({ instanceId, userId, comment }) {
  const inst = await one(
    `SELECT fi.*, fd.flow_nodes, fd.code AS def_code
       FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
      WHERE fi.id = $1 AND fi.applicant_id = $2`,
    [instanceId, userId]
  );
  if (!inst) throw new Error('单据不存在或无权操作');
  if (inst.archive_locked) throw new Error('单据已归档锁定，不可修改');
  if (inst.status !== 'draft') throw new Error('单据已提交，无法重复提交');

  // 原子抢占提交权：并发重复提交（双击 / 多标签页）时只有一个请求能改到行
  const claimed = await one(
    `UPDATE flow_instance SET status = 'running', submitted_at = now(), finished_at = NULL, updated_at = now()
      WHERE id = $1 AND status = 'draft' RETURNING id`,
    [instanceId]
  );
  if (!claimed) throw new Error('单据已提交，无法重复提交');

  // 业务前置校验（休假额度等）。放在抢占之后执行：并发的第二单能读到第一单
  // 已置 running 的占用，避免「同一天连提两单」绕过额度；校验不通过时把状态
  // 退回 draft，申请人改单后可再次提交。
  try {
    await runSubmitGuards(inst);
  } catch (err) {
    await query(
      `UPDATE flow_instance SET status = 'draft', submitted_at = NULL, updated_at = now()
        WHERE id = $1 AND status = 'running'`,
      [instanceId]
    );
    throw err;
  }

  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, detail) VALUES ($1,$2,'submit',$3)`,
    [instanceId, userId, comment || null]
  );

  // 提交后业务登记（休假台账置 pending：考勤能提前看到「下周要请假」，
  // 但 pending 不参与计薪）。失败仅 warn，不影响提交。
  await runSubmitHooks({ ...inst, status: 'running' });

  // 首节点从下标 -1 开始推进（走带互斥的推进入口，避免重复生成首个待办）
  await query(`UPDATE flow_instance SET current_index = -1 WHERE id = $1`, [instanceId]);
  return advanceSafely(instanceId, -1);
}

/**
 * 提交后业务登记（与 runSubmitGuards 相对：那个是「拦」，这个是「记」）。
 * 目前只有休假：登记 attendance_leave(pending)，让考勤侧能提前看到。
 */
async function runSubmitHooks(inst) {
  const code = inst?.def_code;
  try {
    if (code === 'leave') {
      const mod = await import('./attendance-service.js');
      await mod.onLeaveSubmitted(Number(inst.id));
    }
  } catch (err) {
    console.warn(
      `[flow-engine] 提交后钩子失败（已忽略）def=${code} instance=${inst?.id}:`,
      err?.message || err
    );
  }
}


/**
 * 审批动作：通过 / 驳回
 * 通过时：
 *   - approval 节点：常规通过（会签按 min_approvals 判定）
 *   - execute 节点：必须带 reply，落 flow_execution(reply_type=execute)
 *   - verify 节点：将最近一条 execute 记录置 verified 并置实例 closed_loop=TRUE
 */
/**
 * 实例级「进程内异步互斥」表：key = instanceId，value = 该实例的串行化链尾 Promise。
 *
 * 背景（P0 死锁修复）：旧实现用「独占连接 + 会话级 pg_advisory_lock」串行化同一单据的推进。
 *   问题是：取到独占连接后，advance() 内部仍走全局 query()/many()/one()，
 *   需要**再向同一个连接池申请连接**。当 ≥ pool.max(10) 个不同实例同时推进时，
 *   10 条连接全被「锁连接」持有且都在等待再取连接 → 池耗尽、永久互等（进程死锁）。
 *
 * 新做法：改为进程内 Promise 互斥，**等待互斥期间不持有任何数据库连接**，
 *   因此彻底消除「持连接再取连接」的自锁路径。
 */
const instanceLocks = new Map();

/**
 * 按实例串行执行 fn（同一 instanceId 的调用排队执行，不同实例互不阻塞）。
 *
 * 语义保证：
 *   - 同一 instanceId 的 fn 严格串行（前一个 settle 后下一个才开始）；
 *   - 等待互斥时不占用数据库连接（Promises 排队，非连接）；
 *   - fn 抛错时仍会放行后续排队者，且错误向上传播给该次调用的调用方。
 *
 * @template T
 * @param {number|string} instanceId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withInstanceLock(instanceId, fn) {
  const key = Number(instanceId);
  const prev = instanceLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(res => { release = res; });
  const chain = prev.then(() => gate);
  instanceLocks.set(key, chain);
  return prev.catch(() => {}).then(async () => {
    try {
      return await fn();
    } finally {
      release();
      // 仅当链尾仍是本次的 chain 时才清理，避免误删后加入者的节点
      if (instanceLocks.get(key) === chain) instanceLocks.delete(key);
    }
  });
}

/**
 * 在「实例级互斥」保护下推进流程。
 *
 * 背景：并发场景下多个请求可能同时满足推进条件 ——
 *   · 同一任务被重复提交（双击 / 多标签页 / 多终端）
 *   · 会签节点多人同时达标
 * 此时若各自调用 advance()，会出现重复推进：
 *   同一节点生成多份待办（"幽灵任务"），甚至跳过中间节点。
 *
 * 做法：用进程内 keyed mutex 把「同一单据的推进」串行化，并在互斥内复核
 *   「实例仍停留在该任务所在节点」。已被别人推进过则直接返回，不再推进。
 *   语义与旧实现完全一致，仅把串行化手段从「会话级咨询锁」换成「进程内互斥」。
 *
 * @param {number} instanceId
 * @param {number} fromNodeIndex 触发本次推进的任务所在节点
 */
async function advanceSafely(instanceId, fromNodeIndex) {
  return withInstanceLock(instanceId, async () => {
    const cur = await one(
      `SELECT current_index, status FROM flow_instance WHERE id = $1`,
      [instanceId]
    );
    if (!cur || cur.status !== 'running') return { skipped: true, reason: 'not-running' };
    if (Number(cur.current_index) !== Number(fromNodeIndex)) {
      // 本次推进的窗口已过（同一节点已被其他请求推进），避免重复生成待办
      return { skipped: true, reason: 'already-advanced' };
    }
    return advance(instanceId);
  });
}

export async function approveTask({ taskId, userId, action, comment, extraFields, reply }) {
  const task = await one(
    `SELECT * FROM flow_task WHERE id = $1 AND assignee_id = $2`,
    [taskId, userId]
  );
  if (!task) throw new Error('任务不存在或无权处理');
  if (task.status !== 'assigned') throw new Error('该任务已处理过');

  const inst = await one(
    // 驳回钩子按 def_code 分派（miss_card/comp_day/equipment_stocktake），必须取 fd.code；
    // 与 advance() 的写法一致，否则 inst.def_code 为 undefined，驳回钩子永不触发。
    `SELECT fi.*, fd.flow_nodes, fd.closure_required, fd.code AS def_code FROM flow_instance fi
       JOIN flow_definition fd ON fd.id = fi.definition_id WHERE fi.id = $1`,
    [task.instance_id]
  );
  if (!inst) throw new Error('单据不存在');
  if (inst.archive_locked) throw new Error('单据已归档锁定，不可变更');
  // S6：按实例绑定版本快照取当前节点（存量实例回退定义表）
  const approveNodes = await resolveNodes(inst, inst.flow_nodes, { query });
  const node = approveNodes[task.node_index] || {};
  const nodeType = node.type || 'approval';

  // 防"幽灵待办"：任务必须属于当前节点，否则视为已失效
  // （会签/多候选节点流转后，残留任务不得再推进流程，避免跳过中间/终态节点）
  if (inst.status !== 'running'
      || inst.current_index === null
      || Number(task.node_index) !== Number(inst.current_index)) {
    throw new Error('该任务已失效（流程已流转），请刷新后处理当前节点');
  }

  // 驳回：直接结束流程。先原子抢占任务，避免并发下重复驳回/重复通知
  if (action === 'reject') {
    if (!String(comment || '').trim()) {
      throw Object.assign(new Error('驳回必须填写意见'), { statusCode: 400, bizCode: 'REJECT_COMMENT_REQUIRED' });
    }
    const claimed = await one(
      `UPDATE flow_task SET status='rejected', comment=$2, finished_at=now()
        WHERE id=$1 AND status='assigned' RETURNING id`,
      [taskId, comment || null]
    );
    if (!claimed) throw new Error('该任务已处理过');
    await query(
      `UPDATE flow_instance SET status='rejected', current_index=NULL, finished_at=now(), updated_at=now() WHERE id=$1`,
      [inst.id]
    );
    await query(
      `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail) VALUES ($1,$2,'reject',$3,$4)`,
      [inst.id, userId, task.node_index, comment || null]
    );
    await enqueueWmsEvent({ query }, inst, 'rejected', {
      status: 'rejected', nodeIndex: task.node_index, comment,
    });
    await notify(inst.applicant_id, {
      title: `【已驳回】${inst.title}`,
      content: `${task.node_name} 被驳回${comment ? `：${comment}` : '。'}`,
      link: `/flow/detail/${inst.id}`,
      category: 'todo',
    });

    // 补卡驳回 → 卡点回退为「补卡被驳回」（供再次发起）。失败不影响驳回结果。
    if (inst.def_code === 'miss_card') {
      try {
        const mod = await import('./attendance-service.js');
        await mod.onMissCardRejected(inst.id);
      } catch (e) {
        console.warn('[flow-engine] 补卡驳回回退卡点失败（已忽略）：', e?.message || e);
      }
    }

    // 调休驳回 → 回滚本单产生的覆盖/排班/账（第 35 轮）。失败不影响驳回结果。
    if (inst.def_code === 'comp_day') {
      try {
        const mod = await import('./comp-service.js');
        await mod.onCompDayRejected(inst.id);
      } catch (e) {
        console.warn('[flow-engine] 调休驳回回滚失败（已忽略）：', e?.message || e);
      }
    }

    // 盘点驳回 → 发布回退「已驳回」、结束回退「进行中」（供改后重提）。失败不影响驳回结果。
    if (inst.def_code === 'equipment_stocktake') {
      try {
        const mod = await import('./equipment-stocktake.js');
        await mod.onStocktakeRejected(inst.id);
      } catch (e) {
        console.warn('[flow-engine] 盘点驳回回写失败（已忽略）：', e?.message || e);
      }
    }

    // 排班计划驳回 → 计划回到可编辑（保留内容供修改后重提），记录驳回意见。失败不影响驳回结果。
    if (inst.def_code === 'schedule_plan') {
      try {
        const mod = await import('./schedule-plan-service.js');
        await mod.onSchedulePlanRejected(inst.id);
      } catch (e) {
        console.warn('[flow-engine] 排班计划驳回回写失败（已忽略）：', e?.message || e);
      }
    }
    return { status: 'rejected' };
  }

  // ISO 9001 7.5.2：受控文件评审单，评审人必须先读到正文才能点「通过」。
  // 只拦 approval 类型节点 —— execute（发行执行回复）/ verify（发行确认）不是评审意见，
  // 逼执行人读整本手册没有意义；驳回不受限（看出文件不对不需要先读完整本）。
  // 闸门放在引擎里而不是路由里，是为了把批量审批（/tasks/batch-approve）一并覆盖。
  if (nodeType === 'approval') {
    await assertDocReviewed({ instanceId: inst.id, userId, formData: inst.form_data });
  }

  // 执行节点：必须带执行回复
  if (nodeType === 'execute') {
    if (!reply || typeof reply !== 'object' || !Object.keys(reply).length) {
      throw new Error('执行节点必须填写执行回复');
    }
  }

  // 通过：原子抢占本任务（compare-and-swap）。
  // 并发（双击 / 多标签页 / 多终端）下只有一个请求能改到这行，其余立即失败，
  // 避免"同一任务被多次审批 → 流程重复推进 → 产生重复待办"。
  const claimed = await one(
    `UPDATE flow_task SET status='approved', comment=$2, finished_at=now()
      WHERE id=$1 AND status='assigned' RETURNING id`,
    [taskId, comment || null]
  );
  if (!claimed) throw new Error('该任务已处理过');

  // 节点附加字段（如品质主管填写问题归属与处置意见）
  if (extraFields && Object.keys(extraFields).length) {
    await query(
      `UPDATE flow_instance SET form_data = form_data || $2::jsonb, updated_at=now() WHERE id=$1`,
      [inst.id, JSON.stringify(extraFields)]
    );
  }

  // 执行回复落库
  if (nodeType === 'execute') {
    const deptCode = await applicantDeptCode(inst.applicant_id);
    await query(
      `INSERT INTO flow_execution (instance_id, node_index, reply_type, dept_code, content, reply_by, status)
       VALUES ($1,$2,'execute',$3,$4::jsonb,$5,'replied')`,
      [inst.id, task.node_index, deptCode, JSON.stringify(reply), userId]
    );
  }

  // 验证闭环
  if (nodeType === 'verify') {
    const exec = await one(
      `SELECT id FROM flow_execution WHERE instance_id = $1 AND reply_type = 'execute' ORDER BY id DESC LIMIT 1`,
      [inst.id]
    );
    if (exec) {
      await query(
        `UPDATE flow_execution SET status='verified', verified_by=$2, verified_at=now() WHERE id=$1`,
        [exec.id, userId]
      );
    }
    await query(
      `UPDATE flow_instance SET closed_loop = TRUE, closed_at = now(), updated_at = now() WHERE id = $1`,
      [inst.id]
    );
  }

  const logAction = nodeType === 'execute' ? 'execute' : nodeType === 'verify' ? 'verify' : 'approve';
  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail) VALUES ($1,$2,$3,$4,$5)`,
    [inst.id, userId, logAction, task.node_index, comment || (nodeType === 'execute' ? '已提交执行回复' : null)]
  );

  // T03：闭环节点动作回调（发行执行 execute / 发行确认 verify）。
  // - 依据节点类型触发，与 07 种子节点 6/7 的 type 字段一致
  // - 幂等/失败不阻断由 onNodeAction 与此处 try/catch 共同保证
  // - 动态 import 规避循环依赖；仅 doc_controlled_issue 流程触发
  if ((nodeType === 'execute' || nodeType === 'verify')) {
    try {
      const def = await one(
        `SELECT fd.code AS def_code FROM flow_instance fi
           JOIN flow_definition fd ON fd.id = fi.definition_id WHERE fi.id = $1`,
        [inst.id]
      );
      if (def?.def_code === 'doc_controlled_issue' || def?.def_code === 'doc_obsolete') {
        const mod = def.def_code === 'doc_obsolete'
          ? await import('./doc-obsolete.js')
          : await import('./doc-issue.js');
        await mod.onNodeAction(inst.id, task.node_index, userId, nodeType);
      }
    } catch (err) {
      console.warn(`[flow-engine] onNodeAction 回调失败（已忽略，不影响主流程）instance=${inst.id} node=${task.node_index}:`, err?.message || err);
    }
  }

  // 「全员会签」节点（node.require_all_approvals）：
  // 适用于「本次由谁陪签，由节点审批人现场加签决定」的场景（2026-11-04 受控发行流程）。
  // 语义：本节点只要还有 assigned 待办（含 temp-add 加签进来的人）就停在本节点，
  //       避免「先批的人把后加签的人置为 skipped」，让加签变成真会签而不是知会。
  // 注意：必须在 min_approvals 之前判定——两者同时存在时以「全员」为准（更严格）。
  if (node.require_all_approvals) {
    const st = await one(
      `SELECT COUNT(*) FILTER (WHERE status='assigned')::int AS pending,
              COUNT(*) FILTER (WHERE status='approved')::int AS ok
         FROM flow_task WHERE instance_id=$1 AND node_index=$2`,
      [inst.id, task.node_index]
    );
    if (st.pending > 0) {
      return { status: 'running', waiting: true, approved: st.ok, required: st.ok + st.pending };
    }
  }

  // 会签：人数未达标则停留本节点
  const minApprovals = node.min_approvals || 1;
  if (minApprovals > 1) {
    const stat = await one(
      `SELECT COUNT(*) FILTER (WHERE status='approved')::int AS ok,
              COUNT(*) FILTER (WHERE status='assigned')::int AS pending
         FROM flow_task WHERE instance_id=$1 AND node_index=$2`,
      [inst.id, task.node_index]
    );
    if (stat.ok < minApprovals) {
      return { status: 'running', waiting: true, approved: stat.ok, required: minApprovals };
    }
  }

  return advanceSafely(inst.id, task.node_index);
}

/** 临时拉人确认：为当前节点追加审批人 */
export async function addTempApprover({ instanceId, userId, targetUserId, reason }) {
  const access = await resolveInstanceAccess(instanceId, userId);
  const inst = access.inst;
  if (!inst || inst.status !== 'running') throw new Error('流程不在审批中');
  // 授权（D8）：仅 发起人 / 参与人 / 管理员 可临时加签，杜绝无关账号自加签取得待办
  if (!access.allowed) {
    const err = new Error('无权为该单据临时加签');
    err.statusCode = 403;
    throw err;
  }
  if (inst.archive_locked) throw new Error('单据已归档锁定，不可变更');
  if (inst.current_index === null || inst.current_index < 0) throw new Error('当前无待办节点');

  // S6：按实例绑定版本快照取当前节点（存量实例回退定义表）
  const defNodes = (await one(`SELECT flow_nodes FROM flow_definition WHERE id=$1`, [inst.definition_id]))?.flow_nodes || [];
  const node = await resolveNodes(inst, defNodes, { query });
  const cur = node[inst.current_index];
  if (cur && cur.temp_addable === false) throw new Error('该节点不允许临时加签');

  // 不重复添加
  const dup = await one(
    `SELECT 1 FROM flow_task WHERE instance_id=$1 AND node_index=$2 AND assignee_id=$3 AND status='assigned'`,
    [instanceId, inst.current_index, targetUserId]
  );
  if (dup) throw new Error('该人员已在当前节点待办中');

  await query(
    `INSERT INTO flow_task (instance_id, node_index, node_name, node_type, assignee_id, status, is_temp_added)
     VALUES ($1,$2,$3,$4,$5,'assigned',TRUE)`,
    [instanceId, inst.current_index, cur?.name || '临时确认', cur?.type || 'approval', targetUserId]
  );
  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail)
     VALUES ($1,$2,'temp_add',$3,$4)`,
    [instanceId, userId, inst.current_index, reason || `临时拉人确认：${targetUserId}`]
  );
  const target = await one(`SELECT real_name FROM org_user WHERE id=$1`, [targetUserId]);
  await notify(targetUserId, {
    title: `【待确认】${inst.title}`,
    content: `${userId === targetUserId ? '您被临时加入确认' : '您被加入确认'}：${reason || '请协助确认'}`,
    link: `/flow/detail/${instanceId}`,
    category: 'todo',
  });
  return { ok: true, name: target?.real_name };
}

/**
 * 明细表合计字段重算：form_schema 里带 sum_from 的字段 = 该明细表某一列的和。
 *
 * 前端发起页也会实时算（syncSums），但只在浏览器里生效；集成中枢 / API Key 建单、
 * 退回后重提、老站遗留调用都可能绕过它。而流程条件（报废大额审批的 loss_amount、
 * 报销超 200 万加签总经理）读的正是合计值，所以落库前必须由服务端再算一遍，
 * 口径以「行的该列为空则记 0」为准，与前端 syncSums 保持一致。
 *
 * @param {object} formData   提交上来的表单值
 * @param {Array}  formSchema 生效版本的表单结构
 * @returns {object} 合计字段被改写后的新对象（不改原对象）
 */
function applySchemaSums(formData, formSchema) {
  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) return formData || {};
  if (!Array.isArray(formSchema) || !formSchema.length) return formData;
  const sumFields = formSchema.filter((f) => f && f.sum_from);
  if (!sumFields.length) return formData;
  const out = { ...formData };
  for (const f of sumFields) {
    const rows = Array.isArray(out[f.sum_from]) ? out[f.sum_from] : [];
    const col = f.sum_key || 'amount';
    let total = 0;
    for (const row of rows) {
      const raw = row && typeof row === 'object' ? row[col] : null;
      const n = Number(String(raw ?? '').replace(/,/g, '').trim());
      if (Number.isFinite(n)) total += n;
    }
    out[f.key] = Number(total.toFixed(2));
  }
  return out;
}

/**
 * 创建单据
 *
 * S6 版本绑定：实例创建时按 flow_definition.active_version_id 取"正式版本版本号"，
 * 并把该版本号写入 flow_instance.definition_version（实例绑定版本）。
 * 运行时节点一律由 resolveNodes() 按该版本号从 flow_definition_version 快照读取，
 * 因此后续发布/回滚不会漂移在途实例。
 * 若版本表无数据（存量流程 / 未发布过版本），回退使用 flow_definition 本表，
 * definition_version 置 NULL —— 保证存量流程（doc_controlled_issue / equip_repair /
 * leave 等）行为完全不变。
 */
/**
 * 创建流程实例（草稿）。
 *
 * 第33轮新增 subjectUserId（业务当事人）：
 *   签卡代提场景下，applicant=文员、subject=被签卡人；
 *   审批链（manager / 直属主管 / 部门）一律按 subject 上溯。
 *   subjectUserId 缺省/为空/等于 userId → 存 NULL（语义 = 本人，保持旧数据口径）。
 *
 * @param {{definitionId:number, userId:number, title:string, formData:object, subjectUserId?:number}} p
 */
export async function createInstance({ definitionId, userId, title, formData, subjectUserId, bizSystem, bizType, bizKey }) {
  const def = await one(`SELECT * FROM flow_definition WHERE id=$1 AND active=TRUE`, [definitionId]);
  if (!def) throw new Error('流程类型不存在或已停用');

  // 取正式版本版本号；运行时由 resolveNodes() 依此版本号取节点快照（不在本表读节点）。
  // 同时留一份表单结构：明细表合计字段（sum_from）落库前要按它重算。
  let definitionVersion = null;
  let schemaForSum = def.form_schema;
  if (def.active_version_id) {
    const ver = await one(
      `SELECT version, form_schema FROM flow_definition_version WHERE id = $1`,
      [def.active_version_id]
    );
    if (ver) {
      definitionVersion = ver.version;
      if (Array.isArray(ver.form_schema) && ver.form_schema.length) schemaForSum = ver.form_schema;
    }
  }

  // 合计字段（如报销合计金额、报废损失金额、维修停机时长）由明细表汇总得出。
  // 前端也在算，但集成/API/退回重提都可能绕过前端 —— 而流程条件（如报废大额审批）
  // 读的正是这个合计值，算漏了会直接走错审批链，所以在落库前统一重算一遍。
  formData = applySchemaSums(formData, schemaForSum);

  const user = await one(`SELECT * FROM org_user WHERE id=$1`, [userId]);
  const no = await buildInstanceNo(def);

  // 业务当事人：等于申请人时存 NULL（口径统一，避免"自我代提"产生噪音数据）
  let subjectId = null;
  if (subjectUserId !== undefined && subjectUserId !== null && subjectUserId !== '') {
    const sid = Number(subjectUserId);
    if (Number.isFinite(sid) && sid > 0 && sid !== Number(userId)) {
      const s = await one(`SELECT id FROM org_user WHERE id = $1 AND active = TRUE`, [sid]);
      if (!s) throw Object.assign(new Error('被签卡人不存在或已停用'), { statusCode: 400 });
      subjectId = sid;
    }
  }

  let inst;
  try {
    inst = await one(
      `INSERT INTO flow_instance
         (instance_no, definition_id, title, form_data, applicant_id, organization,
          definition_version, subject_user_id, biz_system, biz_type, biz_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [no, definitionId, title, JSON.stringify(formData || {}), userId,
       user?.organization || '本公司', definitionVersion, subjectId,
       bizSystem || null, bizType || null, bizKey || null]
    );
  } catch (e) {
    // 同一业务单据重复提交 → 唯一索引兜底，返回明确错误
    if (e?.code === '23505') {
      throw Object.assign(new Error('该业务单据已在审批中，请勿重复提交'), {
        statusCode: 409, bizCode: 'BIZ_DUPLICATE',
      });
    }
    throw e;
  }
  await query(`INSERT INTO flow_log (instance_id, actor_id, action) VALUES ($1,$2,'create')`, [inst.id, userId]);

  // 代提留痕：申请人 ≠ 业务当事人时，写一条明确日志（审计与责任划分依据）
  if (subjectId) {
    const s = await one(`SELECT real_name, employee_no FROM org_user WHERE id = $1`, [subjectId]);
    await query(
      `INSERT INTO flow_log (instance_id, actor_id, action, detail) VALUES ($1,$2,'delegate_create',$3)`,
      [inst.id, userId,
       `代提：提交人「${user?.real_name || userId}」替「${s?.real_name || subjectId}（${s?.employee_no || ''}）」提交，审批链按被提交人上溯`]
    );
  }
  return inst;
}

/**
 * 退回发起人重填：running → draft
 * 清除当前待办（置 skipped），returned_count+1，通知发起人
 */
export async function returnToApplicant({ instanceId, userId, comment }) {
  const inst = await one(`SELECT * FROM flow_instance WHERE id = $1`, [instanceId]);
  if (!inst) throw new Error('单据不存在');
  if (inst.archive_locked) throw new Error('单据已归档锁定，不可变更');
  if (inst.status !== 'running') throw new Error('仅审批中的单据可退回');

  // 权限：申请人本人 / 当前有在办任务的审批人 / 管理员
  const isAdmin = await isAdminUser(userId);
  const hasTask = (await one(
    `SELECT 1 FROM flow_task WHERE instance_id=$1 AND assignee_id=$2 AND status='assigned' LIMIT 1`,
    [instanceId, userId]
  )) != null;
  if (!isAdmin && inst.applicant_id !== userId && !hasTask) {
    throw new Error('无权退回该单据');
  }

  await query(
    `UPDATE flow_instance SET status='draft', current_index=NULL, finished_at=NULL,
            returned_count=COALESCE(returned_count,0)+1, updated_at=now() WHERE id=$1`,
    [instanceId]
  );
  await query(`UPDATE flow_task SET status='skipped', finished_at=now() WHERE instance_id=$1 AND status='assigned'`, [instanceId]);
  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, detail) VALUES ($1,$2,'return',$3)`,
    [instanceId, userId, comment || '退回发起人重填']
  );
  await notify(inst.applicant_id, {
    title: `【已退回】${inst.title}`,
    content: `单据 ${inst.instance_no} 被退回，请修改后重新提交${comment ? `：${comment}` : '。'}`,
    link: `/flow/detail/${instanceId}`,
    category: 'todo',
  });

  // IQC 检验报告被退回 → 记录置 returned、批次回到「检验中」，可改完重提
  if (inst.biz_type === 'mrb_record') {
    try {
      const mod = await import('./oa-mrb-service.js');
      await mod.onMrbReturned(instanceId, comment);
    } catch (e) {
      console.warn('[flow-engine] MRB 退回回调失败:', e?.message || e);
    }
  }

  if (inst.biz_type === 'iqc_record') {
    try {
      const mod = await import('./oa-iqc-service.js');
      await mod.onIqcReturned(instanceId, comment);
    } catch (e) {
      console.warn('[flow-engine] IQC 退回回调失败:', e?.message || e);
    }
  }
  return { ok: true };
}

/** 转交他人：旧任务置 transferred，生成新 assigned 任务并通知 */
export async function transferTask({ taskId, userId, toUserId, comment }) {
  const task = await one(`SELECT * FROM flow_task WHERE id = $1 AND assignee_id = $2`, [taskId, userId]);
  if (!task) throw new Error('任务不存在或无权转交');
  if (task.status !== 'assigned') throw new Error('该任务已处理，无法转交');
  if (Number(toUserId) === Number(userId)) throw new Error('不能转交给自己');

  const target = await one(`SELECT id, real_name FROM org_user WHERE id = $1 AND active = TRUE`, [toUserId]);
  if (!target) throw new Error('转交对象不存在');

  const inst = await one(`SELECT * FROM flow_instance WHERE id = $1`, [task.instance_id]);
  if (!inst || inst.archive_locked) throw new Error('单据已归档锁定，不可变更');
  // 防"幽灵待办"：仅允许转交当前节点的任务
  if (inst.status !== 'running' || inst.current_index === null
      || Number(task.node_index) !== Number(inst.current_index)) {
    throw new Error('该任务已失效（流程已流转），请刷新后处理当前节点');
  }

  await query(
    `UPDATE flow_task SET status='transferred', comment=$2, finished_at=now() WHERE id=$1`,
    [taskId, comment || '已转交']
  );
  await query(
    `INSERT INTO flow_task (instance_id, node_index, node_name, node_type, assignee_id, status, transferred_from)
     VALUES ($1,$2,$3,$4,$5,'assigned',$6)`,
    [task.instance_id, task.node_index, task.node_name, task.node_type || 'approval', toUserId, userId]
  );
  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail) VALUES ($1,$2,'transfer',$3,$4)`,
    [task.instance_id, userId, task.node_index, `转交给 ${target.real_name}${comment ? `：${comment}` : ''}`]
  );
  await notify(toUserId, {
    title: `【转交待办】${inst.title}`,
    content: `单据 ${inst.instance_no} 的「${task.node_name}」已转交给您处理。`,
    link: `/flow/detail/${inst.id}`,
    category: 'todo',
  });
  return { ok: true, name: target.real_name };
}

/** 催办提醒：通知当前所有待办人，落日志 */
export async function urgeInstance({ instanceId, userId }) {
  const access = await resolveInstanceAccess(instanceId, userId);
  const inst = access.inst;
  if (!inst) throw new Error('单据不存在');
  // 授权（D9）：仅 发起人 / 参与人 / 管理员 可催办（与详情页 canUrge 一致）
  if (!access.allowed) {
    const err = new Error('无权催办该单据');
    err.statusCode = 403;
    throw err;
  }
  if (inst.status !== 'running') throw new Error('仅审批中的单据可催办');

  const tasks = await many(
    `SELECT id, assignee_id, node_name FROM flow_task WHERE instance_id=$1 AND status='assigned'`,
    [instanceId]
  );
  for (const t of tasks) {
    await notify(t.assignee_id, {
      title: `【催办】${inst.title}`,
      content: `单据 ${inst.instance_no} 的「${t.node_name}」等待您尽快处理。`,
      link: `/flow/detail/${instanceId}`,
      category: 'reminder',
    });
    await query(`UPDATE flow_task SET reminded_at = now() WHERE id = $1`, [t.id]);
  }
  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, detail) VALUES ($1,$2,'urge',$3)`,
    [instanceId, userId, `已催办 ${tasks.length} 位待办人`]
  );
  return { ok: true, count: tasks.length };
}

/** 流程终止：管理员或发起人 */
export async function terminateInstance({ instanceId, userId, reason }) {
  const inst = await one(`SELECT * FROM flow_instance WHERE id = $1`, [instanceId]);
  if (!inst) throw new Error('单据不存在');
  if (inst.archive_locked) throw new Error('单据已归档锁定，不可变更');
  if (!['draft', 'running', 'rejected'].includes(inst.status)) throw new Error('当前状态不可终止');

  const isAdmin = await isAdminUser(userId);
  if (!isAdmin && inst.applicant_id !== userId) throw new Error('仅管理员或发起人可终止流程');

  await query(
    `UPDATE flow_instance SET status='terminated', current_index=NULL, finished_at=now(), updated_at=now() WHERE id=$1`,
    [instanceId]
  );
  await query(`UPDATE flow_task SET status='skipped', finished_at=now() WHERE instance_id=$1 AND status='assigned'`, [instanceId]);
  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, detail) VALUES ($1,$2,'terminate',$3)`,
    [instanceId, userId, reason || '流程已终止']
  );
  await notify(inst.applicant_id, {
    title: `【已终止】${inst.title}`,
    content: `单据 ${inst.instance_no} 已被终止${reason ? `：${reason}` : '。'}`,
    link: `/flow/detail/${instanceId}`,
    category: 'system',
  });
  await runRevokeHooks(instanceId);
  return { ok: true };
}

/**
 * 撤回（发起人撤销在途单据）：running → withdrawn，在途任务置 skipped，落 withdraw 日志。
 * 由 routes/flow.js 撤回端点与盘点服务共用，撤回语义单一实现（仅此一处 SQL）。
 * 盘点撤回后由盘点服务自行回退单据状态（pending→draft / closing→ongoing）。
 */
export async function withdrawInstance({ instanceId, userId }) {
  const inst = await one(`SELECT * FROM flow_instance WHERE id=$1 AND applicant_id=$2`, [instanceId, userId]);
  if (!inst) { const e = new Error('无权操作'); e.statusCode = 403; throw e; }
  if (inst.archive_locked) { const e = new Error('单据已归档锁定，不可变更'); e.statusCode = 400; throw e; }
  if (inst.status !== 'running') { const e = new Error('当前状态不可撤销'); e.statusCode = 400; throw e; }
  await query(`UPDATE flow_instance SET status='withdrawn', current_index=NULL, finished_at=now() WHERE id=$1`, [instanceId]);
  await query(`UPDATE flow_task SET status='skipped' WHERE instance_id=$1 AND status='assigned'`, [instanceId]);
  await query(`INSERT INTO flow_log (instance_id, actor_id, action, detail) VALUES ($1,$2,'withdraw','发起人撤销')`, [instanceId, userId]);
  await runRevokeHooks(instanceId);
  return null;
}

/**
 * 撤销 / 终止后的业务回收（与 runTerminalHooks 相对）。
 * 休假单撤销后必须把假从考勤里收回来，否则「单子黄了、考勤里还在请假」。
 * 失败仅 warn —— 撤销动作本身不能因为回收失败而回滚。
 */
async function runRevokeHooks(instanceId) {
  try {
    const inst = await one(
      `SELECT fi.id, fd.code AS def_code
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`,
      [instanceId]
    );
    if (inst && inst.def_code === 'leave') {
      const mod = await import('./attendance-service.js');
      await mod.onLeaveRevoked(instanceId);
    }
    if (inst && inst.def_code === 'schedule_plan') {
      // 排班计划撤销 → 释放同部门同月的「在途」占位，否则该部门本月无法再提报
      const mod = await import('./schedule-plan-service.js');
      await mod.onSchedulePlanRevoked(instanceId);
    }
  } catch (err) {
    console.warn(
      `[flow-engine] 撤销回收钩子失败（已忽略）instance=${instanceId}:`,
      err?.message || err
    );
  }
}

/**
 * 归档：校验闭环 + 锁定，可勾选抄送人/部门
 * closure_required 的流程必须 closed_loop=TRUE 方可归档
 */
export async function archiveInstance({ instanceId, userId, userIds = [], deptCodes = [] }) {
  const inst = await one(
    `SELECT fi.*, fd.closure_required FROM flow_instance fi
       JOIN flow_definition fd ON fd.id = fi.definition_id WHERE fi.id = $1`,
    [instanceId]
  );
  if (!inst) throw new Error('单据不存在');
  if (inst.archive_locked || inst.status === 'archived') throw new Error('单据已归档');

  const isAdmin = await isAdminUser(userId);
  if (!isAdmin && inst.applicant_id !== userId) throw new Error('仅管理员或发起人可归档');

  if (!['completed', 'approved'].includes(inst.status)) {
    throw new Error('仅办理完成的单据可归档');
  }
  // 闭环校验：异常/变更/维修/报废类必须完成执行回复+验证
  if (inst.closure_required && !inst.closed_loop) {
    throw new Error('需完成执行回复与验证后方可归档');
  }

  await query(
    `UPDATE flow_instance SET status='archived', archived_at=now(), archive_locked=TRUE, updated_at=now() WHERE id=$1`,
    [instanceId]
  );

  // 自定义抄送：指定人 + 指定部门全员
  const ccUserIds = new Set((userIds || []).filter(Boolean).map(Number));
  if (deptCodes && deptCodes.length) {
    const urows = await many(
      `SELECT u.id FROM org_user u JOIN org_department d ON d.id = u.department_id
        WHERE u.active = TRUE AND d.code = ANY($1::text[])`,
      [deptCodes]
    );
    for (const r of urows) ccUserIds.add(Number(r.id));
  }
  // 抄送给发起人之外的人
  ccUserIds.delete(Number(inst.applicant_id));
  for (const uid of ccUserIds) {
    await query(
      `INSERT INTO flow_cc (instance_id, user_id, node_index) VALUES ($1,$2,NULL)`,
      [instanceId, uid]
    );
    await notify(uid, {
      title: `【抄送/归档】${inst.title}`,
      content: `单据 ${inst.instance_no} 已办结归档，抄送给您。`,
      link: `/flow/detail/${instanceId}`,
      category: 'cc',
    });
  }

  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, detail) VALUES ($1,$2,'archive',$3)`,
    [instanceId, userId, ccUserIds.size ? `归档并抄送 ${ccUserIds.size} 人` : '归档']
  );
  return { ok: true, ccCount: ccUserIds.size };
}

/** 办结自定义抄送（不改变状态） */
export async function addCc({ instanceId, userId, userIds = [], deptCodes = [] }) {
  const access = await resolveInstanceAccess(instanceId, userId);
  const inst = access.inst;
  if (!inst) throw new Error('单据不存在');
  // 授权（D7）：仅 发起人 / 参与人 / 管理员 可自定义抄送，
  // 杜绝无关账号把自己（或他人）加入无权访问的单据从而绕过可见性隔离。
  if (!access.allowed) {
    const err = new Error('无权为该单据添加抄送');
    err.statusCode = 403;
    throw err;
  }
  const ccUserIds = new Set((userIds || []).filter(Boolean).map(Number));
  if (deptCodes && deptCodes.length) {
    const urows = await many(
      `SELECT u.id FROM org_user u JOIN org_department d ON d.id = u.department_id
        WHERE u.active = TRUE AND d.code = ANY($1::text[])`,
      [deptCodes]
    );
    for (const r of urows) ccUserIds.add(Number(r.id));
  }
  for (const uid of ccUserIds) {
    await query(`INSERT INTO flow_cc (instance_id, user_id, node_index) VALUES ($1,$2,NULL)`, [instanceId, uid]);
    await notify(uid, {
      title: `【抄送】${inst.title}`,
      content: `单据 ${inst.instance_no} 抄送给您。`,
      link: `/flow/detail/${instanceId}`,
      category: 'cc',
    });
  }
  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, detail) VALUES ($1,$2,'cc',$3)`,
    [instanceId, userId, `自定义抄送 ${ccUserIds.size} 人`]
  );
  return { ok: true, count: ccUserIds.size };
}

/**
 * 超时扫描：找出停滞超过阈值的节点，催办对应负责人。
 * 由定时任务周期性调用。
 */
export async function scanTimeout() {
  const cfg = await one(`SELECT value FROM sys_config WHERE key='flow_timeout_hours'`);
  const hours = Number(cfg?.value || 2);
  const remindInterval = await one(`SELECT value FROM sys_config WHERE key='flow_remind_interval_min'`);
  const intervalMin = Number(remindInterval?.value || 60);

  const stuck = await many(
    `SELECT t.id AS task_id, t.assignee_id, t.node_name, t.instance_id, t.assigned_at,
            i.instance_no, i.title, i.applicant_id
       FROM flow_task t
       JOIN flow_instance i ON i.id = t.instance_id
      WHERE t.status = 'assigned'
        AND i.status = 'running'
        AND t.assigned_at < now() - ($1 || ' hours')::interval
        AND (t.reminded_at IS NULL OR t.reminded_at < now() - ($2 || ' minutes')::interval)`,
    [hours, intervalMin]
  );

  for (const s of stuck) {
    const waitedMin = Math.floor((Date.now() - new Date(s.assigned_at).getTime()) / 60000);
    await notify(s.assignee_id, {
      title: `【超时催办】${s.title}`,
      content: `节点「${s.node_name}」已停滞 ${Math.floor(waitedMin / 60)} 小时 ${waitedMin % 60} 分钟（阈值 ${hours} 小时），请尽快处理。`,
      link: `/flow/detail/${s.instance_id}`,
      category: 'reminder',
    });
    await query(`UPDATE flow_task SET reminded_at = now() WHERE id = $1`, [s.task_id]);
    await query(
      `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail)
       VALUES ($1, NULL, 'timeout_remind', NULL, $2)`,
      [s.instance_id, `节点「${s.node_name}」停滞超时，已催办`]
    );
  }
  return stuck.length;
}

/**
 * 汇总实例当前的"无审批人"挂起告警（供详情接口回传，前端据此提示
 * "当前节点无可用审批人，请管理员指派"）。
 * 判定条件：实例 running，且当前节点不存在 assigned 任务。
 * @returns {Promise<Array<{action:string, nodeIndex:(number|null), detail:string}>>}
 */
export async function collectNoAssigneeWarnings(instanceId) {
  const inst = await one(
    `SELECT id, status, current_index FROM flow_instance WHERE id = $1`,
    [instanceId]
  );
  if (!inst || inst.status !== 'running' || inst.current_index === null) return [];

  const pending = await one(
    `SELECT COUNT(*)::int AS n FROM flow_task
      WHERE instance_id = $1 AND node_index = $2 AND status = 'assigned'`,
    [instanceId, inst.current_index]
  );
  if (Number(pending?.n || 0) > 0) return [];

  // 取最近一条 no_assignee 日志作为告警详情（若存在）
  const lastLog = await one(
    `SELECT action, node_index, detail FROM flow_log
      WHERE instance_id = $1 AND action = 'no_assignee' AND node_index = $2
      ORDER BY id DESC LIMIT 1`,
    [instanceId, inst.current_index]
  );
  return [{
    action: 'no_assignee',
    nodeIndex: Number(inst.current_index),
    detail: lastLog?.detail || `节点（序号 ${inst.current_index}）无可用审批人，请管理员指派`,
  }];
}

/**
 * 管理员为"挂起（无审批人）"实例的当前节点指派审批人并生成待办任务。
 * 幂等：若当前节点已存在 assigned 任务则不重复创建（保留既有分配）。
 * @param {{instanceId:number, userId:number, targetUserId:number, reason?:string}} args
 */
export async function assignNodeToCurrent({ instanceId, userId, targetUserId, reason }) {
  if (!targetUserId) throw new Error('请指定审批人');
  const access = await resolveInstanceAccess(instanceId, userId);
  const inst = access.inst;
  if (!inst) throw new Error('单据不存在');
  // 授权（D9）：指派审批人属于管理员接管操作，仅管理员可执行
  if (!access.isAdmin) {
    const err = new Error('仅管理员可指派审批人');
    err.statusCode = 403;
    throw err;
  }
  if (inst.status !== 'running') throw new Error('流程不在审批中');
  if (inst.archive_locked) throw new Error('单据已归档锁定，不可变更');
  if (inst.current_index === null || inst.current_index < 0) throw new Error('当前无待办节点');

  // S6：按实例绑定版本快照取当前节点（存量实例回退定义表）
  const def = await one(`SELECT flow_nodes FROM flow_definition WHERE id = $1`, [inst.definition_id]);
  const resolved = await resolveNodes(inst, def?.flow_nodes, { query });
  const node = resolved[inst.current_index] || {};
  const nodeType = node.type || 'approval';

  // 目标用户校验
  const target = await one(`SELECT id, real_name FROM org_user WHERE id = $1 AND active = TRUE`, [targetUserId]);
  if (!target) throw new Error('指定的审批人不存在或已停用');

  // 已存在当前节点待办则不重复创建（幂等）
  const existing = await one(
    `SELECT COUNT(*)::int AS n FROM flow_task
      WHERE instance_id = $1 AND node_index = $2 AND status = 'assigned'`,
    [instanceId, inst.current_index]
  );
  if (Number(existing?.n || 0) > 0) {
    return { ok: true, alreadyAssigned: true, nodeIndex: inst.current_index, nodeName: node.name || null };
  }

  await query(
    `INSERT INTO flow_task (instance_id, node_index, node_name, node_type, assignee_id, status, is_temp_added)
     VALUES ($1,$2,$3,$4,$5,'assigned',TRUE)`,
    [instanceId, inst.current_index, node.name || '指派审批', nodeType, targetUserId]
  );
  await query(
    `INSERT INTO flow_log (instance_id, actor_id, action, node_index, detail)
     VALUES ($1,$2,'assign_node',$3,$4)`,
    [instanceId, userId, inst.current_index, reason || `管理员指派审批人：${target.real_name || targetUserId}`]
  );
  const typeHint = nodeType === 'execute' ? '（执行回复）'
    : nodeType === 'verify' ? '（验证闭环）' : '（指派办理）';
  await notify(targetUserId, {
    title: `【待处理】${inst.title}`,
    content: `${node.name || '节点'} 等待您处理${typeHint}`,
    link: `/flow/detail/${instanceId}`,
    category: 'todo',
  });
  return { ok: true, alreadyAssigned: false, nodeIndex: inst.current_index, nodeName: node.name || null };
}

export {
  advance, resolveAssignees, matchCondition,
  resolveByPosition, resolveByRoleLike, deptIdByCode,
  // 只读判定：给 tools/verify-*.mjs 用来验证「发起人本人即唯一审批人 → 跳过」的口径，
  // 不写库、不推进流程，只返回 { reason } 或 null。
  skipWhenApplicantIsOnlyAssignee,
};
