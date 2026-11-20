// What happens *after* a human approves a gated task.
//
// The rule that shapes this file: a virtual employee never performs the
// business write. Stock is derived from `inventory_transactions`, and
// traceability requires that the person who pressed "收货/放行/付款" in the PDA
// or ERP screen is the named operator on that row. So writeback advances the
// *workflow inside the agent plane*: it creates the successor draft task for
// the role whose turn is next, records what was done, and says plainly when a
// gate has no agent-plane successor instead of silently doing nothing.
//
// Every successor is validated against the capability contract
// (`canUseSkill`): an advance that would hand a role work it is not declared
// for is a bug in this table, and it is reported as one.

import { canUseSkill } from "../virtual-employees/capabilities.js";
import { getFactoryVirtualEmployee } from "../virtual-employees/registry.js";

// gate -> successor draft. `taskType` must be a declared skill of
// `employeeId`; kind must not be `write` (that would demand a second human
// approval for work that is only coordination).
export const GATE_EFFECTS = Object.freeze({
  receive_variance: {
    advance: { employeeId: "WMS-IQC-HANDOFF-VIRTUAL-01", taskType: "IQC_SUBMIT",
      title: (task, row) => `收料差异已批准，交接检验：${row}` },
    note: "人类确认收料差异后，下一手是来料交接岗提交检验单",
  },
  final_iqc_decision: {
    advance: { employeeId: "WMS-RECEIVING-VIRTUAL-01", taskType: "LOCATION_BIND",
      title: (task, row) => `IQC 判定完成，绑定仓位：${row}` },
    note: "判定合格后的上架绑定仍是草稿，仓位规则突破另有门",
  },
  inventory_release: {
    advance: { employeeId: "WMS-INVENTORY-VIRTUAL-01", taskType: "LOCATION_OPTIMIZE",
      title: (task, row) => `库存放行，复核库位：${row}` },
  },
  exemption: {
    advance: { employeeId: "IQC-VIRTUAL-01", taskType: "SAMPLE_CALCULATION",
      title: (task, row) => `免检批准，重算抽样方案：${row}` },
  },
  supplier_suspension: {
    advance: { employeeId: "PURCHASING-VIRTUAL-01", taskType: "REPLENISHMENT_REVIEW",
      title: (task, row) => `供应商暂停，复核补货来源：${row}` },
  },
  publish_rejection: {
    advance: { employeeId: "SUPPLIER-COLLAB-VIRTUAL-01", taskType: "IQC_FEEDBACK",
      title: (task, row) => `拒收已发布，回馈供应商：${row}` },
  },
  stop_line: {
    advance: { employeeId: "MAINTENANCE-VIRTUAL-01", taskType: "BREAKDOWN_ROUTE",
      title: (task, row) => `停线批准，故障路由：${row}` },
  },
  approve_scrap: {
    advance: { employeeId: "QUALITY-VIRTUAL-01", taskType: "NCR_ROUTE",
      title: (task, row) => `报废批准，不合格品路由：${row}` },
  },
  close_ncr: {
    advance: { employeeId: "REPAIR-VIRTUAL-01", taskType: "REWORK_ROUTE",
      title: (task, row) => `NCR 关闭，安排返工处置：${row}` },
  },
  return_machine_to_service: {
    advance: { employeeId: "MAINTENANCE-VIRTUAL-01", taskType: "PM_SCHEDULE",
      title: (task, row) => `设备复机，补保养计划：${row}` },
  },
  inventory_adjustment: {
    advance: { employeeId: "WMS-COUNT-VIRTUAL-01", taskType: "COUNT_PLAN",
      title: (task, row) => `库存调整批准，安排下次盘点：${row}` },
  },
  release_expired_material: {
    advance: { employeeId: "MSD-CONTROL-VIRTUAL-01", taskType: "BAKING_ALERT",
      title: (task, row) => `超期物料放行，登记烘烤：${row}` },
  },
  // Gates whose only correct outcome is a human business write elsewhere.
  change_po: { unsupported: "PO 变更由采购员在 PO 界面落库，虚拟员工不写采购单" },
  change_price: { unsupported: "价格变更是 ERP 人类动作" },
  change_quantity: { unsupported: "数量变更是 ERP 人类动作" },
  approve_po: { unsupported: "PO 批准本身即业务写入，执行人是采购主管" },
  approve_payment: { unsupported: "付款写入属财务总账，执行人必须具名" },
  approve_scrap_value: { unsupported: "金额认定属财务，无代理侧后续动作" },
  commit_delivery: { unsupported: "交期承诺写入计划冻结区，由计划员执行" },
  change_frozen_plan: { unsupported: "冻结计划变更由计划员执行" },
  production_deploy: { unsupported: "部署由人走发布流程，代理不得触生产" },
  database_migration: { unsupported: "迁移是不可逆清单" },
  schema_change: { unsupported: "模式变更是不可逆清单" },
  restore_database: { unsupported: "恢复是不可逆清单" },
  delete_data: { unsupported: "禁止硬删" },
  production_restore: { unsupported: "恢复是不可逆清单" },
  delete_backup: { unsupported: "删除备份是不可逆清单" },
  bulk_correction: { unsupported: "批量改数由 DBA 执行" },
  master_data_merge: { unsupported: "主数据合并由主数据员执行" },
  external_write: { unsupported: "外部系统写入需具名操作员" },
  mapping_change: { unsupported: "映射变更由集成负责人执行" },
  disable_account: { unsupported: "账号停用由管理员在账号界面执行" },
  rotate_secret: { unsupported: "密钥轮换由管理员执行" },
  firewall_change: { unsupported: "网络变更由基础设施工程师执行" },
  server_reboot: { unsupported: "重启主机由基础设施工程师执行" },
  restart_production_service: { unsupported: "重启服务由应用运维执行" },
  data_mutation: { unsupported: "生产数据修改由应用运维执行" },
  remote_device_control: { unsupported: "远程设备控制由 PDA 管理员执行" },
  apk_rollout: { unsupported: "APK 下发由 PDA 管理员执行" },
  override_putaway_rule: { unsupported: "绕过上架规则是现场人类决定" },
  override_msl: { unsupported: "突破湿敏规则是现场人类决定" },
  hand_over_package: { unsupported: "交接签收是 PDA 操作员动作" },
  receive_package: { unsupported: "线边签收是 PDA 操作员动作" },
  approve_distribution: { unsupported: "配送批准由仓储主管在系统内执行" },
  material_scrap: { unsupported: "报废单落库由操作员执行" },
  close_work_order: { unsupported: "工单关闭由产线执行" },
  approve_capa: { unsupported: "CAPA 关闭由品质主管执行" },
  approve_document: { unsupported: "文件批准在 OA 签核链内完成" },
  reject_document: { unsupported: "文件退回在 OA 签核链内完成" },
  sign_for_human: { unsupported: "代签不存在，签名必须是本人" },
  skip_required_step: { unsupported: "跳过必经步骤违反受控文件规则" },
  publish_without_approval: { unsupported: "未签全发布违反 OA-AI-GOV-01" },
  external_distribution: { unsupported: "对外分发由文控与法务执行" },
  execute_material_issue: { unsupported: "发料执行在 WMS/PDA 内由操作员完成" },
  release_inventory: { unsupported: "库存放行由现场操作员执行" },
  supplier_account_approval: { unsupported: "供应商账号开通由采购与 IT 双人执行" },
  change_design_system: { unsupported: "设计系统变更由 UI 与前端负责人共同签署" },
  release_ui: { unsupported: "界面发布随前端发布流程走，不由代理触发" },
});

export function effectFor(gate) {
  return GATE_EFFECTS[String(gate || "").trim()] || null;
}

// Pure decision so the table can be tested without a database.
export function planWriteback({ gate, rowKey }) {
  const effect = effectFor(gate);
  if (!effect) return { code: "WRITEBACK_NO_SUCH_GATE", gate: gate || null };
  if (effect.unsupported) return { code: "WRITEBACK_UNSUPPORTED", gate, reason: effect.unsupported };
  const target = effect.advance;
  const verdict = canUseSkill(target.employeeId, target.taskType);
  if (!verdict.ok) return { code: "WRITEBACK_SKILL_NOT_DECLARED", gate, target, reason: verdict.code };
  if (verdict.skill.kind === "write") {
    return { code: "WRITEBACK_TARGET_IS_WRITE_SKILL", gate, target, note: "后续动作只能是草稿，不能再次要求人工门" };
  }
  return {
    code: null, gate, target,
    taskKey: `WB:${gate}:${rowKey}`,
    title: target.title({ }, rowKey),
    mode: verdict.mode,
  };
}

export async function applyWriteback({ query, task, employee, reviewer, now = Date.now() }) {
  const gate = String(task.human_gate || task.input?.action || "").trim();
  const rowKey = task.input?.row_key ?? task.id;
  const plan = planWriteback({ gate, rowKey });
  const actor = `ve:${employee?.id || "UNKNOWN"}`;
  const detail = { gate, rowKey: String(rowKey), fromTaskId: task.id, reviewer, code: plan.code,
    reason: plan.reason || plan.note || null,
    target: plan.target || null, taskKey: plan.taskKey || null, decidedAt: new Date(now).toISOString() };

  if (plan.code) {
    await query(
      `INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor)
       VALUES ($1,$2,'WRITEBACK_DECIDED',$3::jsonb,$4)`,
      [employee?.id || null, task.id, JSON.stringify(detail), "rule:writeback-v1"],
    );
    return { applied: false, code: plan.code, reason: plan.reason || plan.unsupported || null, gate };
  }

  const successor = getFactoryVirtualEmployee(plan.target.employeeId) || {};
  const inserted = await query(
    `INSERT INTO factory_virtual_employee_tasks
       (employee_id, task_type, title, domain, status, priority, input, requires_human, human_gate, requested_by, task_key)
     VALUES ($1,$2,$3,$4,'OPEN','NORMAL',$5::jsonb,FALSE,NULL,$6,$7)
     ON CONFLICT DO NOTHING RETURNING id`,
    [plan.target.employeeId, plan.target.taskType, plan.title,
      successor.domain || employee?.domain || "general",
      JSON.stringify({ originTaskId: task.id, gate, rowKey, writeback: true, evidence: task.input?.evidence || [] }),
      `ve:writeback`, plan.taskKey],
  );
  detail.createdTaskId = inserted.rows[0]?.id ?? null;
  detail.duplicate = !inserted.rowCount;
  await query(
    `INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor)
     VALUES ($1,$2,'WRITEBACK_APPLIED',$3::jsonb,$4)`,
    [plan.target.employeeId, detail.createdTaskId || task.id, JSON.stringify(detail), actor],
  );
  return { applied: true, code: null, gate, targetTaskId: detail.createdTaskId,
    duplicate: detail.duplicate, taskKey: plan.taskKey };
}

// Every gate that exists anywhere in the org must appear in GATE_EFFECTS: a
// missing entry means an approval would silently advance nothing. `knownGates`
// is the union of registry humanGates and every gate named by a skill.
export function auditWritebackCoverage(knownGates) {
  const missing = [...new Set(knownGates)].filter(g => !GATE_EFFECTS[g]).sort();
  const advancesToWrite = Object.entries(GATE_EFFECTS).flatMap(([gate, effect]) => {
    if (!effect.advance) return [];
    const verdict = canUseSkill(effect.advance.employeeId, effect.advance.taskType);
    if (!verdict.ok) return [{ gate, code: verdict.code, target: effect.advance }];
    if (verdict.skill.kind === "write") return [{ gate, code: "TARGET_IS_WRITE_SKILL", target: effect.advance }];
    return [];
  });
  const advances = Object.values(GATE_EFFECTS).filter(e => e.advance).length;
  const unsupported = Object.values(GATE_EFFECTS).filter(e => e.unsupported).length;
  return { missing, advancesToWrite, advances, unsupported, gates: Object.keys(GATE_EFFECTS).length };
}
