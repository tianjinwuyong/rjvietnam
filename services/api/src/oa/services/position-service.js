// ============================================================
// 岗位字典服务（sys_i18n_dict dict_type='position'）
// ------------------------------------------------------------
// 需求（权威规格 docs/岗位字典自定义与工段分类-实施方案.md §3.2）：
//   岗位字典原先纯只读，管理员需要能 新增 / 编辑 / 停用 / 删除 岗位。
//
// 关键纪律：
//   · 与 org-import-service.js 的 listPositionDict() 是**两条独立通路**，
//     后者继续供「导入校验 + 各处下拉」使用，签名/返回结构**保持不变**；
//     本服务的 listPositionDictAll() 是给「岗位管理视图」用的，含停用项 + 引用计数。
//   · 删除策略：**已被引用的岗位禁止物理删除**（返回 400 提示引用数），只能「停用」。
//     停用 = active=false：不再出现在 /api/org/positions（下拉），但历史记录仍能取到中文名。
//   · code 被流程引擎 / 内置流程定义 / 权限判定 / 设备告警引用（规格 §1.7），
//     故 **code 创建后不可编辑**，编辑仅开放 name_zh / name_vi / sort_order / active。
//   · 业务错误一律 new Error(msg) + err.statusCode，交由统一错误出口透传文案，绝不回显 SQL。
// ============================================================
import { many, one, query } from '../db/index.js';

/** 岗位字典类型常量（全项目同一真值） */
const POSITION_DICT_TYPE = 'position';

/**
 * 岗位 code 规则：小写字母开头，后跟小写字母/数字/下划线，总长 2-50。
 * 与规格 §3.2 完全一致，避免与现有 code 风格（gm / dept_mgr / sys_eng）冲突。
 */
const POSITION_CODE_RE = /^[a-z][a-z0-9_]{1,49}$/;

/**
 * 构造业务错误（4xx + 中文提示）。统一错误出口原样透传 isBiz/statusCode 的文案。
 * @param {string} msg 用户可读提示
 * @param {number} [statusCode=400]
 * @returns {Error}
 */
function bizError(msg, statusCode = 400) {
  const e = new Error(msg);
  e.statusCode = statusCode;
  e.isBiz = true;
  return e;
}

/**
 * 把任意可空值归一为「去掉首尾空格的字符串」，空则返回 null。
 * @param {*} v
 * @returns {string|null}
 */
function normText(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * 归一 sort_order：合法整数取整，否则回退默认值。
 * @param {*} v
 * @param {number} [def=0]
 * @returns {number}
 */
function normSort(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

/**
 * 统计某岗位 code 的被引用次数（删除前必查）。
 *
 * 三处引用（规格 §1.7 / §3.2）：
 *   1) org_user.position_code            —— 在职/离职员工归属（不限 active，历史也要保护）
 *   2) training_plan.position_code       —— 培训计划适用岗位
 *   3) flow_definition.flow_nodes(JSONB) —— 流程定义中的岗位指派表达式
 *
 * flow_nodes 是 jsonb 数组，节点字段形如：
 *   { "assign": "position_self:dept_sup" }              单个表达式
 *   { "assign": "position:PD:dept_mgr" }                指定部门的岗位
 *   { "assign": ["position:PD:shift_lead", "role:..."] } 数组混合
 *   { "assign": "gm" } / { "assign": "vp" }             直接用 code（仅 gm/vp）
 * 采用 OR 组合的文本匹配：
 *   (a) 节点文本含 "position_self:<code>"  或 "position:" 后段等于 <code>
 *   (b) 存在字符串元素恰好等于 <code>（覆盖 gm/vp 这种裸 code 写法）
 * 注：flow-engine.js 的 resolveByRoleLike 还有 "role code 不存在时回退岗位" 的兼容，
 *     过度计数会把常用角色码（engineer 等）也算进来；此处按**显式岗位引用**计数，符合规格列出的三处。
 *
 * @param {string} code 岗位编码
 * @returns {Promise<{total:number, orgUser:number, trainingPlan:number, flowDef:number}>}
 */
export async function positionRefCount(code) {
  const c = normText(code);
  if (!c) return { total: 0, orgUser: 0, trainingPlan: 0, flowDef: 0 };

  const userRow = await one(
    `SELECT COUNT(*)::int AS n FROM org_user WHERE position_code = $1`,
    [c]
  );
  const planRow = await one(
    `SELECT COUNT(*)::int AS n FROM training_plan WHERE position_code = $1`,
    [c]
  );
  const flowRow = await one(
    `SELECT COUNT(*)::int AS n
       FROM flow_definition fd
      WHERE fd.flow_nodes IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM jsonb_path_query(
                   fd.flow_nodes,
                   '$.** ? (@.type() == "string")'
                 ) AS s(val)
           WHERE (s.val #>> '{}') LIKE 'position_self:' || $1
              OR (s.val #>> '{}') LIKE 'position:%:' || $1
              OR (s.val #>> '{}') = $1
        )`,
    [c]
  );

  const orgUser = userRow?.n || 0;
  const trainingPlan = planRow?.n || 0;
  const flowDef = flowRow?.n || 0;
  return { total: orgUser + trainingPlan + flowDef, orgUser, trainingPlan, flowDef };
}

/**
 * 岗位管理视图：含**已停用**项 + 引用计数（供前端表格「引用数 / 删除禁用」展示）。
 * 与 listPositionDict() 的区别：后者只返回 active 项（下拉用），本函数不过滤 active。
 * @returns {Promise<Array<object>>} 每项含 code/name_zh/name_vi/name_en/sort_order/active/updated_at/ref_count
 */
export async function listPositionDictAll() {
  const rows = await many(
    `SELECT id, code, name_zh, name_vi, name_en, sort_order, active, created_at, updated_at
       FROM sys_i18n_dict
      WHERE dict_type = $1
      ORDER BY sort_order, code`,
    [POSITION_DICT_TYPE]
  );

  // 引用计数逐条查询（字典量级极小，通常 < 30 条，无需批量化）
  const list = [];
  for (const row of rows) {
    const refs = await positionRefCount(row.code);
    list.push({
      id: Number(row.id),
      code: row.code,
      name_zh: row.name_zh,
      name_vi: row.name_vi,
      name_en: row.name_en,
      sort_order: row.sort_order,
      active: row.active === true,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ref_count: refs.total,
      ref_org_user: refs.orgUser,
      ref_training_plan: refs.trainingPlan,
      ref_flow_definition: refs.flowDef,
    });
  }
  return list;
}

/**
 * 新增岗位（第 42 轮：编码改为**系统自动生成**，管理员只需填名称）。
 *
 * 背景：用户反馈「岗位字典里新增岗位也可以不要岗位编码，我有岗位名称就可以了」。
 * code 在底层仍被三处依赖（流程按岗位找人 / 部门导入校验 / 权限判定），**不能删**，
 * 但它对管理员是无意义的技术标识 ⇒ 界面不再暴露，由本函数自动生成。
 *
 * 生成规则（按用户选择「用中文名称自动转写」）：
 *   · 可直接用 ascii 的名称（如 "QA"）→ 小写化后取字母数字部分，如 `qa`
 *   · 中文名称 → 生成 `pos_<hash>`（无拼音依赖的内置转写，保证确定性 + 唯一性）
 *   · 兜底：`pos_` + 时间戳 base36 + 随机后缀
 * 唯一性：生成后查重，冲突则追加数字后缀；仍依赖 UNIQUE(dict_type, code) 兜底并发。
 *
 * @param {{code?:string, name_zh?:string, name_vi?:string, name_en?:string, sort_order?:number, active?:boolean}} data
 *          code 仍接受显式传入（接口兼容 / 导入场景），未传则自动生成。
 *          name_en 为**非必填**（T2 三语改造）：不传/空 → 存 NULL，前端 en 环境回退中文。
 * @returns {Promise<object>} 新建后的完整行（含 ref_count=0）
 */
export async function createPosition(data = {}) {
  let code = normText(data.code);

  const nameZh = normText(data.name_zh);
  const nameVi = normText(data.name_vi);
  const nameEn = normText(data.name_en);
  if (!nameZh) throw bizError('请填写岗位中文名称（name_zh）');
  if (!nameVi) throw bizError('请填写岗位越文名称（name_vi）');

  // 未显式传 code ⇒ 自动生成（界面已不再要求管理员填写）
  if (!code) code = await genPositionCode(nameZh);

  if (!POSITION_CODE_RE.test(code)) {
    throw bizError('岗位编码格式不正确：需以小写字母开头，只能包含小写字母/数字/下划线，长度 2-50');
  }

  const sortOrder = normSort(data.sort_order, 0);
  const active = data.active === undefined ? true : data.active === true || data.active === 'true';

  // 先做一次显式查重，给出可读文案（唯一约束仍兜底并发场景 → 23505 → 409）
  const dup = await one(
    `SELECT 1 FROM sys_i18n_dict WHERE dict_type = $1 AND code = $2 LIMIT 1`,
    [POSITION_DICT_TYPE, code]
  );
  if (dup) throw bizError(`岗位编码「${code}」已存在，请更换`, 409);

  const r = await one(
    `INSERT INTO sys_i18n_dict (dict_type, code, name_zh, name_vi, name_en, sort_order, active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     RETURNING id, code, name_zh, name_vi, name_en, sort_order, active, created_at, updated_at`,
    [POSITION_DICT_TYPE, code, nameZh, nameVi, nameEn, sortOrder, active]
  );

  return {
    id: Number(r.id),
    code: r.code,
    name_zh: r.name_zh,
    name_vi: r.name_vi,
    name_en: r.name_en,
    sort_order: r.sort_order,
    active: r.active === true,
    created_at: r.created_at,
    updated_at: r.updated_at,
    ref_count: 0,
    ref_org_user: 0,
    ref_training_plan: 0,
    ref_flow_definition: 0,
  };
}

/**
 * 由岗位中文名称自动转写为稳定 code（第 42 轮）。
 *
 * 规则：
 *   1) 名称含 ascii 字母/数字 ⇒ 抽出来小写化，如 "QA组长" → `qa`，纯 "Engineer" → `engineer`
 *   2) 名称纯中文 ⇒ `pos_` + 名称的稳定哈希（确定性：同名 → 同 code，第二次会命中查重）
 *   3) 追加数字后缀解决同名冲突
 *
 * @param {string} nameZh 岗位中文名称
 * @returns {Promise<string>} 未被占用的 code
 */
async function genPositionCode(nameZh) {
  const ascii = String(nameZh).toLowerCase().replace(/[^a-z0-9]/g, '');
  let base;
  if (ascii && /^[a-z]/.test(ascii) && ascii.length >= 2) {
    base = ascii.slice(0, 40);
  } else if (ascii) {
    base = 'pos_' + ascii.slice(0, 40);
  } else {
    base = 'pos_' + hash36(String(nameZh));
  }

  // 逐个尝试：base、base2、base3 …（最多 200 次）
  for (let i = 0; i < 200; i += 1) {
    const cand = i === 0 ? base : `${base}${i + 1}`;
    if (!POSITION_CODE_RE.test(cand)) continue;
    const hit = await one(
      `SELECT 1 FROM sys_i18n_dict WHERE dict_type = $1 AND code = $2 LIMIT 1`,
      [POSITION_DICT_TYPE, cand]
    );
    if (!hit) return cand;
  }
  // 极端兜底：时间戳 + 随机
  return 'pos_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * 稳定哈希（djb2 变体）→ base36 小写字符串。用于中文名称 → code 的确定性转写。
 * @param {string} s
 * @returns {string}
 */
function hash36(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // 保持 32 位无符号
  }
  return h.toString(36);
}

/**
 * 编辑岗位（**code 不可编辑**）。
 * 仅开放：name_zh / name_vi / sort_order / active —— 未传字段保持原值。
 * 编辑名称后，所有引用该 code 的员工/培训计划 JOIN 即显示新名称（无需数据回填）。
 *
 * @param {number} id 岗位主键
 * @param {{name_zh?:string, name_vi?:string, name_en?:string, sort_order?:number, active?:boolean}} data
 *        未传字段保持原值；name_en 传空串 → 置 NULL（等价于"清空英文名"，en 环境回退中文）。
 * @returns {Promise<object>} 更新后的完整行（含引用计数）
 */
export async function updatePosition(id, data = {}) {
  const cur = await one(
    `SELECT id, code, name_zh, name_vi, name_en, sort_order, active
       FROM sys_i18n_dict WHERE id = $1 AND dict_type = $2`,
    [id, POSITION_DICT_TYPE]
  );
  if (!cur) throw bizError('岗位不存在', 404);

  const nameZh = data.name_zh === undefined ? cur.name_zh : normText(data.name_zh);
  const nameVi = data.name_vi === undefined ? cur.name_vi : normText(data.name_vi);
  const nameEn = data.name_en === undefined ? cur.name_en : normText(data.name_en);
  if (!nameZh) throw bizError('请填写岗位中文名称（name_zh）');
  if (!nameVi) throw bizError('请填写岗位越文名称（name_vi）');

  const sortOrder = data.sort_order === undefined ? cur.sort_order : normSort(data.sort_order, cur.sort_order);
  const active = data.active === undefined
    ? cur.active
    : (data.active === true || data.active === 'true');

  const r = await one(
    `UPDATE sys_i18n_dict
        SET name_zh = $2, name_vi = $3, name_en = $4, sort_order = $5, active = $6, updated_at = now()
      WHERE id = $1 AND dict_type = $7
      RETURNING id, code, name_zh, name_vi, name_en, sort_order, active, created_at, updated_at`,
    [id, nameZh, nameVi, nameEn, sortOrder, active, POSITION_DICT_TYPE]
  );

  const refs = await positionRefCount(r.code);
  return {
    id: Number(r.id),
    code: r.code,
    name_zh: r.name_zh,
    name_vi: r.name_vi,
    name_en: r.name_en,
    sort_order: r.sort_order,
    active: r.active === true,
    created_at: r.created_at,
    updated_at: r.updated_at,
    ref_count: refs.total,
    ref_org_user: refs.orgUser,
    ref_training_plan: refs.trainingPlan,
    ref_flow_definition: refs.flowDef,
  };
}

/**
 * 删除岗位（**仅当引用数 = 0 才允许物理删除**）。
 * 被引用时抛 400，提示「已被 N 处引用，请改用停用」，岗位保持可用。
 *
 * @param {number} id 岗位主键
 * @returns {Promise<{id:number, code:string}>}
 */
export async function deletePosition(id) {
  const cur = await one(
    `SELECT id, code FROM sys_i18n_dict WHERE id = $1 AND dict_type = $2`,
    [id, POSITION_DICT_TYPE]
  );
  if (!cur) throw bizError('岗位不存在', 404);

  const refs = await positionRefCount(cur.code);
  if (refs.total > 0) {
    const parts = [];
    if (refs.orgUser > 0) parts.push(`员工 ${refs.orgUser}`);
    if (refs.trainingPlan > 0) parts.push(`培训计划 ${refs.trainingPlan}`);
    if (refs.flowDef > 0) parts.push(`流程定义 ${refs.flowDef}`);
    throw bizError(
      `岗位「${cur.code}」已被 ${refs.total} 处引用（${parts.join('、')}），不能删除，请改用停用`,
      400
    );
  }

  await query(`DELETE FROM sys_i18n_dict WHERE id = $1 AND dict_type = $2`, [id, POSITION_DICT_TYPE]);
  return { id: Number(cur.id), code: cur.code };
}

/**
 * 按 code 取**启用中**的岗位字典项（供用户建/改时校验 positionCode 合法性）。
 *
 * 语义（规格 §1.7）：position_code 一旦写入即被流程引擎/权限判定/设备告警引用，
 * 故**只允许写入字典中真实存在且 active=TRUE 的 code**，避免产生悬空引用。
 *
 * @param {string} code 岗位编码
 * @returns {Promise<{id:number, code:string, name_zh:string, name_vi:string|null, name_en:string|null}|null>}
 *          命中返回精简项（含 name_zh 供 position 自由文本同步）；未命中/停用/空值返回 null
 */
export async function getActivePositionByCode(code) {
  const c = normText(code);
  if (!c) return null;
  const row = await one(
    `SELECT id, code, name_zh, name_vi, name_en
       FROM sys_i18n_dict
      WHERE dict_type = $1 AND code = $2 AND active = TRUE
      LIMIT 1`,
    [POSITION_DICT_TYPE, c]
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code,
    name_zh: row.name_zh,
    name_vi: row.name_vi,
    name_en: row.name_en,
  };
}

/**
 * 工段下拉数据源：返回指定父部门（默认 code='PD' 生产部）下的所有子部门。
 * 供前端「按工段」多选下拉使用（工段=部门，复用部门树）。
 *
 * 缺口2 约定：本函数是前端取工段的**唯一稳定来源**（前端不得硬编码 `SEC_` 前缀）。
 * 非法/不存在的 parentCode → 返回空数组（不抛错），由路由保证 200 语义。
 *
 * @param {{parentCode?:string}} [opts]
 * @returns {Promise<Array<{id:number, code:string, name:string, name_vi:string|null, name_en:string|null, parent_id:number|null}>>}
 */
export async function listSectionDepartments({ parentCode = 'PD' } = {}) {
  const parent = await one(
    `SELECT id FROM org_department WHERE code = $1 LIMIT 1`,
    [parentCode]
  );
  if (!parent) return [];
  const rows = await many(
    `SELECT id, code, name, name_vi, name_en, parent_id
       FROM org_department
      WHERE parent_id = $1 AND active = TRUE
      ORDER BY sort_order, id`,
    [parent.id]
  );
  return rows.map(r => ({
    id: Number(r.id),
    code: r.code,
    name: r.name,
    name_vi: r.name_vi,
    name_en: r.name_en,
    parent_id: r.parent_id === null || r.parent_id === undefined ? null : Number(r.parent_id),
  }));
}
