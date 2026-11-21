// ============================================================
// 体系文件废除审批对接（doc-obsolete）
// 职责：把「体系文件废除」流程与 doc_system / sys_doc_version / doc_code_ledger /
//       doc_obsolete_record 等业务表对接。
// 说明：本文件【导出】 submitObsolete / getObsoleteStatus / onObsoleteApproved / onNodeAction
//       供 flow-engine 在 advance() 终态分支挂载。
// 流程定义 code：doc_obsolete（42_doc_obsolete.sql 落库，8 节点，链与受控发行同构）。
// 关键差异（故意为之）：
//   · 发起废除【不】改 doc_system.status —— 在途状态由流程实例表达，保持 published
//     使受控台账口径不变；仅终态 onObsoleteApproved 落废除动作。
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { createInstance, submitInstance } from './flow-engine.js';

const DEF_CODE = 'doc_obsolete';

/** 取流程定义 id */
async function definitionId() {
  const def = await one(`SELECT id FROM flow_definition WHERE code = $1 AND active = TRUE`, [DEF_CODE]);
  if (!def) throw new Error(`流程定义 ${DEF_CODE} 不存在`);
  return def.id;
}

/** 该文档最早的 running 废除实例 id（无则 null） */
async function findRunningObsoleteId(docId) {
  const r = await one(
    `SELECT i.id FROM flow_instance i JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE fd.code = $1 AND (i.form_data->>'doc_id') = $2 AND i.status = 'running'
      ORDER BY i.id ASC LIMIT 1`,
    [DEF_CODE, String(docId)]
  );
  return r ? Number(r.id) : null;
}

/** 删除一个实例的全部关联（task/log/cc/instance）——并发让位或提交失败时自清 */
async function cleanupInstance(instanceId) {
  await query(`DELETE FROM flow_task WHERE instance_id = $1`, [instanceId]);
  await query(`DELETE FROM flow_log  WHERE instance_id = $1`, [instanceId]);
  await query(`DELETE FROM flow_cc   WHERE instance_id = $1`, [instanceId]);
  await query(`DELETE FROM flow_instance WHERE id = $1`, [instanceId]);
}

// ── 并发防重（同文档串行化）──────────────────────────────────────────────
// 采用「进程内互斥」而非「持数据库连接的会话级咨询锁」：
//   后者需在临界区内再向同一连接池申请连接（createInstance/submitInstance 走全局 query），
//   高并发时会复现 P0「持连接再取连接」死锁（见 flow-engine.withInstanceLock 注释）。
//   本服务与流程引擎同为单进程部署，进程内互斥即可保证同文档串行；
//   再叠加「锁内权威 DB 复检 + 创建后补偿」，双保险确保任一时刻同文档至多 1 个 running。
const submitLocks = new Map(); // docId -> 串行链尾 Promise

function withSubmitLock(docId, fn) {
  const key = String(docId);
  const prev = submitLocks.get(key) || Promise.resolve();
  const run = prev.then(() => fn());          // 排在既有链尾之后（等待期间不占用任何 DB 连接）
  const tail = run.catch(() => {});           // 链尾吞错，保证后续排队者仍能执行
  submitLocks.set(key, tail);
  tail.then(() => { if (submitLocks.get(key) === tail) submitLocks.delete(key); });
  return run;
}

/**
 * 提交废除申请：发起 doc_obsolete 流程实例并提交。
 * 并发安全：同文档并发发起时，仅 1 个成功，其余抛「该文件已有在途废除申请」，无脏实例。
 * @param {object} p { docId, userId, reason, replacementCode }
 * @returns {Promise<{instanceId:number, instanceNo:string, title:string, currentIndex:(number|null)}>}
 */
export async function submitObsolete({ docId, userId, reason, replacementCode }) {
  const doc = await one(`SELECT * FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) throw new Error('文档不存在');
  if (doc.status !== 'published') throw new Error('仅已发行文件可申请废除');

  return withSubmitLock(docId, async () => {
    // 锁内权威复检：并发同文档只有一个能通过
    const exists = await findRunningObsoleteId(docId);
    if (exists) throw new Error('该文件已有在途废除申请');

    const ver = doc.current_version;

    // 双语齐备标记（镜像发行口径）
    const langs = await many(
      `SELECT lang FROM doc_version_lang WHERE doc_id = $1 AND version = $2`,
      [docId, ver]
    );
    const hasZh = langs.some(l => l.lang === 'zh');
    const hasVi = langs.some(l => l.lang === 'vi');

    const isManual = doc.category === 'l1_manual';
    const defId = await definitionId();
    const title = `体系文件废除: ${doc.code} V${ver}`;
    const formData = {
      doc_id: doc.id,
      version: ver,
      doc_code: doc.code || '',
      doc_name: doc.title || '',
      level: String(doc.level || ''),
      category: doc.category || '',
      security_level: doc.security_level || 'public',
      product_scope: doc.product_scope ? 'true' : 'false',
      is_manual: isManual ? 'true' : 'false',
      has_zh: hasZh ? 'true' : 'false',
      has_vi: hasVi ? 'true' : 'false',
      reason: reason || '',
      replacement_code: replacementCode || '',
    };

    const inst = await createInstance({ definitionId: defId, userId, title, formData });
    let s;
    try {
      s = await submitInstance({ instanceId: inst.id, userId });
    } catch (err) {
      // 提交失败：清掉半成品实例，不留脏数据
      await cleanupInstance(inst.id).catch(() => {});
      throw err;
    }

    // 双保险：若仍存在更早的 running（跨进程/异常路径），让位并自清
    const winner = await findRunningObsoleteId(docId);
    if (winner !== null && winner !== Number(inst.id)) {
      await cleanupInstance(inst.id).catch(() => {});
      throw new Error('该文件已有在途废除申请');
    }

    // ★ 关键差异：不修改 doc_system.status，保持 published（在途由流程实例表达）
    // currentIndex 取 submitInstance 返回的 nodeIndex（真实字段；旧代码误用 current_index 恒 null）
    return {
      instanceId: inst.id,
      instanceNo: inst.instance_no,
      title,
      currentIndex: s?.nodeIndex ?? null,
    };
  });
}

/**
 * 废除进度查询（供 /obsolete-status 接口）。
 * @returns {instanceId, status, currentIndex, currentNode, defCode} 或 null
 */
export async function getObsoleteStatus(docId) {
  const inst = await one(
    `SELECT i.id, i.instance_no, i.status, i.current_index, i.submitted_at, i.finished_at,
            fd.flow_nodes, fd.code AS def_code
       FROM flow_instance i JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE fd.code = $1 AND (i.form_data->>'doc_id') = $2
      ORDER BY i.id DESC LIMIT 1`,
    [DEF_CODE, String(docId)]
  );
  if (!inst) return null;
  const nodes = Array.isArray(inst.flow_nodes) ? inst.flow_nodes
    : (typeof inst.flow_nodes === 'string' ? JSON.parse(inst.flow_nodes) : []);
  const idx = inst.current_index === null ? null : Number(inst.current_index);
  const node = idx !== null && nodes[idx] ? nodes[idx] : null;
  return {
    instanceId: inst.id,
    instanceNo: inst.instance_no,
    status: inst.status,
    currentIndex: idx,
    currentNode: node ? { name: node.name, nameVi: node.name_vi, type: node.type } : null,
    submittedAt: inst.submitted_at,
    finishedAt: inst.finished_at,
    defCode: inst.def_code,
  };
}

/**
 * 废除审批完成回调（flow-engine 在 advance() 终态分支挂载）。
 * 步骤（与 doc-service.obsoleteDoc 同效）：
 *   1. 读 form_data.doc_id/reason
 *   2. doc_system.status='obsolete'、code_state='frozen'
 *   3. sys_doc_version published → obsolete
 *   4. doc_code_ledger.state='frozen'
 *   5. INSERT doc_obsolete_record(reason=申请原因||'未填写原因', version=doc.current_version)
 * 幂等：重复调用按 doc_id 收敛（已废除或已有废除记录则跳过）。
 * @returns {Promise<object>} 处理摘要
 */
export async function onObsoleteApproved(instanceId) {
  const inst = await one(
    `SELECT i.id, i.form_data FROM flow_instance i
       JOIN flow_definition fd ON fd.id = i.definition_id
      WHERE i.id = $1 AND fd.code = $2`,
    [instanceId, DEF_CODE]
  );
  if (!inst) return { skipped: true, reason: '非废除流程实例' };
  const form = inst.form_data || {};
  const docId = Number(form.doc_id);
  if (!docId) return { skipped: true, reason: '缺少 doc_id' };

  const doc = await one(`SELECT * FROM doc_system WHERE id = $1`, [docId]);
  if (!doc) return { skipped: true, reason: '文档不存在' };

  // 幂等：已废除 或 已有废除记录 → 跳过（重放不重复）
  if (doc.status === 'obsolete') return { skipped: true, reason: '文档已废除（幂等跳过）', docId };
  const rec = await one(`SELECT id FROM doc_obsolete_record WHERE doc_id = $1 LIMIT 1`, [docId]);
  if (rec) return { skipped: true, reason: '已有废除记录（幂等跳过）', docId };

  const reason = form.reason || '未填写原因';

  await transaction(async client => {
    await client.query(
      `UPDATE doc_system SET status='obsolete', code_state='frozen', updated_at=now() WHERE id=$1`,
      [docId]
    );
    await client.query(
      `UPDATE sys_doc_version SET status='obsolete' WHERE doc_id=$1 AND status='published'`,
      [docId]
    );
    await client.query(
      `UPDATE doc_code_ledger SET state='frozen' WHERE doc_id=$1`,
      [docId]
    );
    await client.query(
      `INSERT INTO doc_obsolete_record (doc_id, version, reason, obsolete_date)
       VALUES ($1,$2,$3,CURRENT_DATE)`,
      [docId, doc.current_version, reason]
    );
  });

  return { docId, version: doc.current_version, reason };
}

/**
 * 节点动作回调（可选，供 flow-engine 在各节点审批时触发内部动作；当前预留）。
 * 废除流程 execute/verify 节点动作与终态落库无耦合，暂为 no-op。
 */
export async function onNodeAction(instanceId, nodeIndex, userId, action) {
  return { instanceId, nodeIndex, userId, action, handled: false };
}

export default { submitObsolete, getObsoleteStatus, onObsoleteApproved, onNodeAction, DEF_CODE };
