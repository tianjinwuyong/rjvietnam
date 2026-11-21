// ============================================================
// integration-biz —— 业务类型配置（bizType → OA 流程 + 字段/状态映射）
//
// 设计目标：新增业务 = 加一行配置，不改代码、不改 API。
//   · field_map：{ "OA表单字段": "外部报文路径" }，如 { "lot_no": "lotNo" }
//   · status_map：{ "OA状态": "外部状态" }，如 { "completed": "approved" }
// ============================================================
import { one, many, query } from '../db/index.js';

export async function listBiz() {
  return many(
    `SELECT b.*, d.name AS definition_name, d.code AS definition_code
       FROM sys_integration_biz b
       LEFT JOIN flow_definition d ON d.id = b.definition_id
      ORDER BY b.system_code, b.biz_type`
  );
}

export async function getBiz(bizType) {
  return one(
    `SELECT * FROM sys_integration_biz WHERE biz_type = $1`,
    [String(bizType || '').trim()]
  );
}

export async function saveBiz(patch = {}) {
  const bizType = String(patch.bizType || '').trim();
  if (!/^[a-z][a-z0-9_]{1,49}$/.test(bizType)) {
    throw new Error('业务编码需以小写字母开头，仅含小写字母/数字/下划线，长度 2–50');
  }
  const name = String(patch.name || '').trim();
  if (!name) throw new Error('请填写业务名称');
  const systemCode = String(patch.systemCode || '').trim().toUpperCase();
  if (!systemCode) throw new Error('请选择来源系统');

  const definitionId = patch.definitionId ? Number(patch.definitionId) : null;
  if (definitionId) {
    const def = await one(`SELECT id FROM flow_definition WHERE id=$1 AND active=TRUE`, [definitionId]);
    if (!def) throw new Error('绑定的流程定义不存在或已停用');
  }

  const fieldMap = patch.fieldMap && typeof patch.fieldMap === 'object' ? patch.fieldMap : {};
  const statusMap = patch.statusMap && typeof patch.statusMap === 'object' ? patch.statusMap : {};

  await query(
    `INSERT INTO sys_integration_biz
       (biz_type, name, system_code, direction, definition_id, field_map, status_map,
        callback_url, title_template, enabled, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (biz_type) DO UPDATE SET
       name=EXCLUDED.name, system_code=EXCLUDED.system_code, direction=EXCLUDED.direction,
       definition_id=EXCLUDED.definition_id, field_map=EXCLUDED.field_map,
       status_map=EXCLUDED.status_map, callback_url=EXCLUDED.callback_url,
       title_template=EXCLUDED.title_template, enabled=EXCLUDED.enabled, updated_at=now()`,
    [
      bizType, name, systemCode, patch.direction || 'IN', definitionId,
      JSON.stringify(fieldMap), JSON.stringify(statusMap),
      patch.callbackUrl || null, patch.titleTemplate || null,
      patch.enabled === undefined ? true : !!patch.enabled,
    ]
  );
  return getBiz(bizType);
}

export async function deleteBiz(bizType) {
  await query(`DELETE FROM sys_integration_biz WHERE biz_type=$1`, [String(bizType || '').trim()]);
  return true;
}

/** 按字段映射把外部报文转换成 OA 表单数据 */
export function applyFieldMap(formData, fieldMap) {
  const out = { ...(formData || {}) };
  if (!fieldMap || typeof fieldMap !== 'object') return out;
  for (const [targetKey, sourcePath] of Object.entries(fieldMap)) {
    const val = getPath(formData, sourcePath);
    if (val !== undefined) out[targetKey] = val;
  }
  return out;
}

/** 支持 a.b.c 路径取值 */
function getPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** OA 状态 → 外部系统状态 */
export function mapStatus(status, statusMap) {
  if (!statusMap) return status;
  return statusMap[status] || status;
}
