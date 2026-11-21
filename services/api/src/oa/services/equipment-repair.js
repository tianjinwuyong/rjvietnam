// ============================================================
// 设备维修闭环终态钩子（S3-T05，需求 6.x 维修入履历）
// ------------------------------------------------------------
// 由 flow-engine 的「终态钩子分发」在 equip_repair 流程走到 completed 时调用
// onRepairClosed(instanceId)。职责：
//   1. 解出关联设备、故障描述、处理结果、实际完成时间；
//   2. 往 equipment_history 写一条「维修完成」履历（event_type='repair_done'）；
//   3. 幂等：同一 source_instance_id 只保留一条 —— 若点检异常建单时已写过
//      event_type='repair' 的那条，则在其上补写/更新终态字段，而不是插第二条
//      （equipment_history 有部分唯一索引 uk_eqhist_source_instance，
//       冲突需带谓词 WHERE source_instance_id IS NOT NULL）；
//   4. 设备状态回写：若设备当前处于维修类/维护中状态，回写为 running，并写 status_since。
//   5. 失败不得阻断主流程（由调用方 try/catch + 本函数内部 try 保证）。
// ============================================================
import { one, query } from '../db/index.js';

/**
 * 解析维修单涉及的设备（可多台）。
 * 表单改成「多项一起报修」后，设备编号在明细行 items[].equip_no 里；
 * 改造前的存量单据仍是表头 form_data.equip_no，两种都认。
 * equipment 里按编号逐个匹配不到时，退回 equipment_history 里该实例已挂的 equipment_id
 * （点检异常建单时写过一条，携带准确 equipment_id）。
 * @param {object} inst flow_instance 行
 * @returns {Promise<Array<{id:number, code:string, name:string, status:string}>>}
 */
async function resolveEquipments(inst) {
  const fd = inst?.form_data || {};
  const rows = Array.isArray(fd.items) ? fd.items : [];
  const codes = [...new Set(
    [...rows.map((r) => r?.equip_no), fd.equip_no]
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean)
  )];

  const list = [];
  for (const code of codes) {
    const eq = await one(
      `SELECT id, code, name, status FROM equipment WHERE code = $1 LIMIT 1`,
      [code]
    );
    if (eq) list.push(eq);
  }
  if (list.length) return list;

  const his = await one(
    `SELECT e.id, e.code, e.name, e.status
       FROM equipment_history h JOIN equipment e ON e.id = h.equipment_id
      WHERE h.source_instance_id = $1 LIMIT 1`,
    [inst.id]
  );
  return his ? [his] : [];
}

/**
 * 维修单终态回调（幂等）。
 * @param {number} instanceId
 * @returns {Promise<{ok:boolean, action:'updated'|'inserted'|'skipped', equipmentId?:number, historyId?:number, reason?:string}>}
 */
export async function onRepairClosed(instanceId) {
  try {
    const inst = await one(
      `SELECT fi.*, fd.code AS def_code, fd.name AS def_name
         FROM flow_instance fi JOIN flow_definition fd ON fd.id = fi.definition_id
        WHERE fi.id = $1`,
      [instanceId]
    );
    if (!inst) return { ok: false, action: 'skipped', reason: '实例不存在' };
    if (inst.def_code !== 'equip_repair') {
      return { ok: false, action: 'skipped', reason: `非 equip_repair 流程：${inst.def_code}` };
    }

    const equipments = await resolveEquipments(inst);
    if (!equipments.length) {
      console.warn(`[equipment-repair] 无法解析关联设备 instance=${instanceId}`);
      return { ok: false, action: 'skipped', reason: '无法解析关联设备' };
    }
    // 一张单可能报修多台设备；履历表对 source_instance_id 有唯一索引（一单一条），
    // 故履历挂在第一台解析到的设备上，标题/正文里写清全部设备，不静默丢信息。
    const eq = equipments[0];
    const fd = inst.form_data || {};
    const rows = Array.isArray(fd.items) ? fd.items : [];

    // 取最近一次执行回复（维修处理结果）
    const exec = await one(
      `SELECT content FROM flow_execution
        WHERE instance_id = $1 AND reply_type = 'execute'
        ORDER BY id DESC LIMIT 1`,
      [instanceId]
    );
    const reply = exec?.content || {};
    const repairResult = reply.repair_result || reply.result || null;
    const repairPlan = reply.repair_plan || null;
    const repairHours = reply.repair_hours != null ? Number(reply.repair_hours) : null;
    const partsReplaced = reply.parts_replaced || null;
    // 故障现象/停机时长同样已下沉到明细行，汇总成一句话写进履历
    const faultPhenomenon = rows.length
      ? rows.map((r) => [r?.equip_name || r?.equip_no, r?.fault_phenomenon].filter(Boolean).join('：'))
          .filter(Boolean).join('；')
      : (fd.fault_phenomenon || null);
    const downtime = fd.downtime_total != null
      ? Number(fd.downtime_total)
      : (rows.length
        ? rows.reduce((n, r) => n + (Number(r?.downtime_hours) || 0), 0)
        : (fd.downtime_hours != null ? Number(fd.downtime_hours) : null));

    const doneDate = new Date().toISOString().slice(0, 10);
    const title = equipments.length > 1
      ? `维修完成-${eq.name}(${eq.code}) 等 ${equipments.length} 台设备`
      : `维修完成-${eq.name}(${eq.code})`;
    const contentParts = [
      faultPhenomenon ? `故障：${faultPhenomenon}` : null,
      repairResult ? `处理结果：${repairResult}` : null,
      repairPlan ? `维修方案：${repairPlan}` : null,
      partsReplaced ? `更换部件：${partsReplaced}` : null,
      repairHours != null ? `工时：${repairHours}h` : null,
    ].filter(Boolean);
    const content = contentParts.join('；') || '维修单已验收闭环';

    // 幂等：同一 source_instance_id 只保留一条履历。
    // 若点检异常建单时已写过一条，则在其上更新为终态；否则插入新的 repair_done。
    const existing = await one(
      `SELECT id FROM equipment_history WHERE source_instance_id = $1 LIMIT 1`,
      [instanceId]
    );

    let action, historyId;
    if (existing) {
      await query(
        `UPDATE equipment_history
            SET event_type = 'repair_done',
                event_date = $2,
                title = $3,
                content = $4,
                downtime_hours = COALESCE($5, downtime_hours)
          WHERE id = $1`,
        [existing.id, doneDate, title, content, downtime]
      );
      action = 'updated';
      historyId = existing.id;
    } else {
      const row = await one(
        `INSERT INTO equipment_history
           (equipment_id, event_type, event_date, title, content, downtime_hours, source_instance_id)
         VALUES ($1, 'repair_done', $2, $3, $4, $5, $6)
         ON CONFLICT (source_instance_id) WHERE source_instance_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [eq.id, doneDate, title, content, downtime, instanceId]
      );
      // 并发下若被别的调用抢先插入，回查一次
      historyId = row?.id
        || (await one(`SELECT id FROM equipment_history WHERE source_instance_id = $1`, [instanceId]))?.id;
      action = 'inserted';
    }

    // 状态回写：设备若处于维修类/维护中状态，恢复为 running 并留痕（多台则逐台回写）
    for (const e of equipments) {
      if (!e.status || e.status === 'running' || e.status === 'scrapped') continue;
      await query(
        `UPDATE equipment SET status = 'running', status_since = now(), updated_at = now() WHERE id = $1`,
        [e.id]
      );
      await query(
        `INSERT INTO equipment_history (equipment_id, event_type, title, content, operator_id)
         VALUES ($1, 'status_change', $2, $3, $4)`,
        [e.id, `状态 ${e.status} → running`, `维修完成，设备恢复运行`, inst.applicant_id || null]
      );
    }

    return { ok: true, action, equipmentId: eq.id, equipmentIds: equipments.map((e) => e.id), historyId };
  } catch (err) {
    // 不阻断主流程：仅告警
    console.warn(`[equipment-repair] onRepairClosed 失败（已忽略）instance=${instanceId}:`, err?.message || err);
    return { ok: false, action: 'skipped', reason: err?.message || String(err) };
  }
}
