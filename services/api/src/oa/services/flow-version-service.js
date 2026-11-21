/**
 * S6 - 电子流版本管理服务
 *
 * 版本状态机：draft 草稿 → testing 测试 → released 发布 → archived 归档
 *   - 保存草稿版本：新建 flow_definition_version（version = max+1，status='draft'）
 *   - 发布：flow_definition.active_version_id = 该版本；旧 released 版本 → archived
 *   - 回滚：把历史版本重新设为 active_version（发布态），当前 released → archived
 *
 * 重要：发布/回滚【只改指针与版本状态】，不会原地修改 flow_definition.flow_nodes，
 *       因此不会漂移运行中的存量实例（advance 仍读 flow_definition 本表，
 *       新实例创建时按 active_version_id 取快照并写 definition_version）。
 */
import { many, one, query } from '../db/index.js';

/** 版本列表（按版本号倒序） */
export async function listVersions(definitionId) {
  return many(
    `SELECT v.*, u.real_name AS creator_name
       FROM flow_definition_version v
       LEFT JOIN org_user u ON u.id = v.created_by
      WHERE v.definition_id = $1
      ORDER BY v.version DESC`,
    [definitionId]
  );
}

/**
 * 保存草稿版本：基于当前 flow_definition 或显式传入的节点/表单，生成新版本。
 * @param {number} definitionId
 * @param {object} payload {name,nameVi,formSchema,flowNodes,ledgerColumns}
 * @param {number} userId
 */
export async function saveDraftVersion(definitionId, payload, userId) {
  const def = await one(`SELECT * FROM flow_definition WHERE id = $1`, [definitionId]);
  if (!def) throw new Error('流程定义不存在');

  const maxRow = await one(
    `SELECT COALESCE(MAX(version), 0) AS mx FROM flow_definition_version WHERE definition_id = $1`,
    [definitionId]
  );
  const version = Number(maxRow?.mx || 0) + 1;

  const formSchema = payload.formSchema !== undefined ? payload.formSchema : (def.form_schema || []);
  const flowNodes = payload.flowNodes !== undefined ? payload.flowNodes : (def.flow_nodes || []);
  const ledgerColumns = payload.ledgerColumns !== undefined ? payload.ledgerColumns : def.ledger_columns;

  const row = await one(
    `INSERT INTO flow_definition_version
       (definition_id, version, name, name_vi, form_schema, flow_nodes, ledger_columns, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8) RETURNING *`,
    [definitionId, version,
     payload.name || def.name, payload.nameVi || def.name_vi || null,
     JSON.stringify(formSchema || []), JSON.stringify(flowNodes || []),
     ledgerColumns ? JSON.stringify(ledgerColumns) : null, userId]
  );
  return row;
}

/**
 * 发布版本：设为 active_version。
 *   - 目标版本 status = 'released'，released_at = now()
 *   - 其余 released 版本 → archived
 *   - flow_definition.active_version_id 指向该版本
 *   - 同时把该版本快照同步到 flow_definition 本表（保证 /api/flows/:id 与
 *     前端配置器读取到最新发布内容；存量实例仍按其绑定版本运行）
 * @param {number} definitionId
 * @param {number} versionId
 */
export async function releaseVersion(definitionId, versionId) {
  const ver = await one(
    `SELECT * FROM flow_definition_version WHERE id = $1 AND definition_id = $2`,
    [versionId, definitionId]
  );
  if (!ver) throw new Error('版本不存在');

  // 归档同定义的其它 released 版本
  await query(
    `UPDATE flow_definition_version SET status = 'archived'
      WHERE definition_id = $1 AND status = 'released' AND id <> $2`,
    [definitionId, versionId]
  );
  await query(
    `UPDATE flow_definition_version SET status = 'released', released_at = now()
      WHERE id = $1`,
    [versionId]
  );

  // 指针 + 同步快照到定义本表（不漂移运行中实例：实例创建时快照 definition_version）
  await query(
    `UPDATE flow_definition SET
       active_version_id = $2,
       flow_nodes = $3::jsonb,
       form_schema = $4::jsonb,
       name = COALESCE($5, name),
       name_vi = COALESCE($6, name_vi),
       ledger_columns = COALESCE($7::jsonb, ledger_columns),
       updated_at = now()
     WHERE id = $1`,
    [definitionId, versionId, JSON.stringify(ver.flow_nodes || []),
     JSON.stringify(ver.form_schema || []), ver.name, ver.name_vi,
     ver.ledger_columns ? JSON.stringify(ver.ledger_columns) : null]
  );

  return { definitionId, versionId, version: ver.version };
}

/**
 * 回滚到指定历史版本：把该版本重新发布（active_version 指向它），
 * 当前 released 版本 → archived。
 * @param {number} definitionId
 * @param {number} versionId
 */
export async function rollbackVersion(definitionId, versionId) {
  const ver = await one(
    `SELECT * FROM flow_definition_version WHERE id = $1 AND definition_id = $2`,
    [versionId, definitionId]
  );
  if (!ver) throw new Error('版本不存在');
  // 复用发布逻辑：设为 active_version
  return releaseVersion(definitionId, versionId);
}
