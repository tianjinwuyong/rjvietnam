// ============================================================
// 体系文件受控发行：文件类型 → 审批路由
// 职责：把「文件级别 + 分类 + 是否产品类」换算成一个路由码，
//       供 doc_controlled_issue 流程的节点条件（condition.field = 'issue_route'）分流使用。
//
// 为什么要这一层：
//   流程引擎的条件运算只支持「单字段 vs 单值/多值」，而按类型分流的规则里存在
//   「二级 或 三级非产品类」这种跨级别组合。先把规则收敛成一个单值路由码，
//   节点条件就退化成「路由 in [a, b]」，配置直观、预览与实跑同源。
//
// 依据（不得随意更改，改前先改体系文件）：
//   《文件控制程序》DT-SP-QA-001
//     · 4 职责：总经理批准/发布《管理手册》；管理者代表审批程序文件
//     · 5.5：核格式 → 相关部门负责人+体系工程师评审 → 所属部门负责人审核 → 管理者代表批准
//     · 5.5 末：产品类三级文件及四级表单不必跨部门评审，由所属部门主管或经理批准即可
//   《记录控制程序》DT-SP-QA-002
//     · 记录表单由使用部门创建 → 使用部门经理确认 → 管理者代表授权人员（体系负责人）审批
// ============================================================

/** 路由定义：顺序即「文件级别」从高到低的展示顺序 */
export const ISSUE_ROUTES = [
  { code: 'l1_manual', zh: '一级（管理手册）', vi: 'Cấp 1 (Sổ tay quản lý)', en: 'L1 manual' },
  { code: 'l2_procedure', zh: '二级（程序文件）', vi: 'Cấp 2 (Tài liệu quy trình)', en: 'L2 procedure' },
  { code: 'l3_system', zh: '三级（体系类）', vi: 'Cấp 3 (tài liệu hệ thống)', en: 'L3 system' },
  { code: 'l3_product', zh: '三级（产品类）', vi: 'Cấp 3 (tài liệu sản phẩm)', en: 'L3 product' },
  { code: 'l4_form', zh: '四级（记录表单）', vi: 'Cấp 4 (biểu mẫu hồ sơ)', en: 'L4 record form' },
];

const ROUTE_MAP = new Map(ISSUE_ROUTES.map(r => [r.code, r]));

/**
 * 安全布尔：兼容 'true' / '1' / true / 1，其余为 false。
 * 表单与 DB 里这个值有三种形态，直接 !!v 会把字符串 'false' 判成 true。
 */
function truthy(v) {
  return v === true || v === 1 || String(v) === 'true' || String(v) === '1';
}

/**
 * 计算审批路由码。
 *
 * 判定顺序（先定级别，再在三级内分产品类）：
 *   category 优先于 level —— 分类是业务真值，level 可能是历史遗留的粗粒度值。
 *   例：category='l1_manual' 但 level=3（数据脏）仍按一级手册走。
 *
 * @param {{level?: number|string, category?: string, productScope?: any}} p
 * @returns {'l1_manual'|'l2_procedure'|'l3_system'|'l3_product'|'l4_form'}
 */
export function resolveIssueRoute({ level, category, productScope } = {}) {
  const cat = String(category || '').trim();
  const lv = Number(level);

  if (cat === 'l1_manual' || lv === 1) return 'l1_manual';
  if (cat === 'l4_form' || cat === 'record_form' || lv === 4) return 'l4_form';
  if (cat === 'l2_procedure' || lv === 2) return 'l2_procedure';

  // 三级（含未分类/脏数据）：按是否产品类二分
  return truthy(productScope) ? 'l3_product' : 'l3_system';
}

/**
 * 路由码 → 三语标签；未知值原样返回，避免前端出现 undefined。
 * @param {string} code
 * @returns {{zh:string, vi:string, en:string}}
 */
export function routeLabel(code) {
  const r = ROUTE_MAP.get(String(code));
  if (r) return { zh: r.zh, vi: r.vi, en: r.en };
  return { zh: String(code || '—'), vi: String(code || '—'), en: String(code || '—') };
}

/** 把路由码列表拼成「一级（管理手册）/二级（程序文件）」这样的短句 */
export function routeListLabel(codes) {
  const list = (Array.isArray(codes) ? codes : [codes]).map(String);
  return {
    zh: list.map(c => routeLabel(c).zh).join('、') || '—',
    vi: list.map(c => routeLabel(c).vi).join('、') || '—',
    en: list.map(c => routeLabel(c).en).join(', ') || '—',
  };
}

export default { ISSUE_ROUTES, resolveIssueRoute, routeLabel, routeListLabel };
