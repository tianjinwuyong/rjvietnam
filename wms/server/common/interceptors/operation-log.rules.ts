/**
 * 审计埋点路由映射表（task #117 / BUG-006）
 *
 * 背景：`operation_log` 表、读接口（GET /api/system/operation-log）、写服务
 * （SystemService.createOperationLog）都早已存在，但**没有任何业务流程调用写入**，
 * 审计功能整体空转。本文件是「全局拦截器 + 路由映射」方案的唯一配置源：
 * 拦截器按 `METHOD /规范化路径` 查表，命中即写一条审计记录。
 *
 * key 的规范化规则（由 operation-log.interceptor.ts 负责生成）：
 *   `${RequestMethod大写} /${controllerPath}/${handlerPath}`，去掉重复与首尾斜杠。
 *   例：@Controller('api/system') + @Post('account/:id/reset-password')
 *       → "POST /api/system/account/:id/reset-password"
 *
 * 埋点范围（与产品确认的口径一致）：
 *   ① 身份类        登录/登出、账号与角色增删改、重置密码
 *   ② 配置与库存类  系统参数、看板目标、仓库/库位/物料/供应商/BOM 主数据、
 *                   库存调整/移库/锁定/解锁/不良品移库/超期处置
 *   ③ 生产与质量类  工单下发与关闭、领料单生成/审批/拣货、需求单提交/审批、
 *                   超补领料、收料、IQC 判定与报告审批、IQC 配置
 *   ④ 异常处置类    盘点（建单/提交/审批/调整/取消）、退货出库、返工、生产退料
 *   ⑤ MRB 审批      MRB 发起/指派评审人/提交评审/终审
 *
 * 明确**不埋点**（避免噪声与存储浪费，均为「无副作用的读/校验/草稿」）：
 *   - 所有 GET 路由（列表、详情、统计、导出）
 *   - 纯校验类 POST：/receipt/verify-qr、/receipt/verify-location、
 *     /inventory/intra-transfer/verify-source、/inventory/intra-transfer/verify-target、
 *     /dashboard/verify-admin、/workorder/requirement/preview
 *   - 草稿类：/iqc/lot/:id/draft（PUT/DELETE）、/iqc/lot/:id/save-records
 *     （检验过程中高频自动保存，审计价值低）
 *   - 审计写接口自身：/system/operation-log（避免自我记录）
 *
 * 如需增删埋点，只改本表即可，拦截器无需改动。
 */

export interface OperationLogRule {
  /** 业务模块（对应 operation_log.biz_type，varchar(50)） */
  bizType: string;
  /** 动作（对应 operation_log.action，varchar(50)） */
  action: string;
  /**
   * 业务失败（抛异常/4xx/5xx）时是否也记一条审计。
   * 默认 false（只记成功）。仅对「失败本身有安全审计价值」的动作开启，
   * 例如登录失败（爆破/越权尝试排查）。失败记录的 action 会追加 `_failed`。
   */
  logFailure?: boolean;
}

export const OPERATION_LOG_RULES: Record<string, OperationLogRule> = {
  // ==================== ① 身份类 ====================
  'POST /api/system/login': { bizType: 'auth', action: 'login', logFailure: true },
  'POST /api/system/logout': { bizType: 'auth', action: 'logout' },
  'POST /api/system/account': { bizType: 'account', action: 'create' },
  // 批量导入账号属于高敏操作（一次性建号 + 决定 role_code），必须留痕
  'POST /api/system/account/import': { bizType: 'account', action: 'import' },
  'PUT /api/system/account/:id': { bizType: 'account', action: 'update' },
  'DELETE /api/system/account/:id': { bizType: 'account', action: 'delete' },
  'POST /api/system/account/:id/reset-password': { bizType: 'account', action: 'reset_password' },
  // 自助改密：账号本人主动修改密码，属身份类高敏操作，必须留痕
  'POST /api/system/change-password': { bizType: 'account', action: 'change_password' },
  // 系统初始化：不可逆地清空全库业务数据与账号，属最高危操作。
  // 开启 logFailure —— 短语/密码试错也要留痕（可据此发现越权尝试）。
  // 注意：初始化会把 operation_log 一并清空，本条记录是初始化之后才写入的，
  // 因此日志里恰好保留「谁在什么时候初始化过」这一条。
  'POST /api/system/initialize': { bizType: 'system', action: 'initialize', logFailure: true },
  'POST /api/system/role': { bizType: 'role', action: 'create' },
  'PUT /api/system/role/:id': { bizType: 'role', action: 'update' },
  'DELETE /api/system/role/:id': { bizType: 'role', action: 'delete' },

  // ==================== ② 配置与库存类 ====================
  // --- 系统配置 ---
  'POST /api/system/param': { bizType: 'sys_param', action: 'create' },
  'PUT /api/system/param/:id': { bizType: 'sys_param', action: 'update' },
  'DELETE /api/system/param/:id': { bizType: 'sys_param', action: 'delete' },
  'PUT /api/dashboard/target-config': { bizType: 'dashboard_config', action: 'update' },
  // --- 主数据 ---
  'POST /api/warehouse': { bizType: 'warehouse', action: 'create' },
  'PUT /api/warehouse/:id': { bizType: 'warehouse', action: 'update' },
  'DELETE /api/warehouse/:id': { bizType: 'warehouse', action: 'delete' },
  'POST /api/warehouse/location': { bizType: 'warehouse_location', action: 'create' },
  'PUT /api/warehouse/location/:id': { bizType: 'warehouse_location', action: 'update' },
  'DELETE /api/warehouse/location/:id': { bizType: 'warehouse_location', action: 'delete' },
  'POST /api/system/location/batch-create': { bizType: 'warehouse_location', action: 'batch_create' },
  // 主数据清空（仓库/地址码）：不可逆的物理删除，属最高危操作。开启 logFailure。
  'POST /api/warehouse/clear-warehouses': { bizType: 'warehouse', action: 'clear_all', logFailure: true },
  'POST /api/warehouse/clear-locations': { bizType: 'warehouse_location', action: 'clear_all', logFailure: true },
  'POST /api/material': { bizType: 'material', action: 'create' },
  'PUT /api/material/:id': { bizType: 'material', action: 'update' },
  'DELETE /api/material/:id': { bizType: 'material', action: 'delete' },
  'POST /api/material/import': { bizType: 'material', action: 'import' },
  'POST /api/material/substitution/import': { bizType: 'material', action: 'substitution_import' },
  'DELETE /api/material/substitution/:id': { bizType: 'material', action: 'substitution_delete' },
  'POST /api/material/supplier': { bizType: 'supplier', action: 'create' },
  'PUT /api/material/supplier/:id': { bizType: 'supplier', action: 'update' },
  'DELETE /api/material/supplier/:id': { bizType: 'supplier', action: 'delete' },
  'POST /api/material/supplier/import': { bizType: 'supplier', action: 'import' },
  // 主数据清空：不可逆的物理删除，属最高危操作。开启 logFailure —— 短语/密码试错也留痕。
  'POST /api/material/clear-materials': { bizType: 'material', action: 'clear_all', logFailure: true },
  'POST /api/material/clear-suppliers': { bizType: 'supplier', action: 'clear_all', logFailure: true },
  'POST /api/material/clear-substitutions': { bizType: 'material', action: 'clear_substitutions', logFailure: true },
  'POST /api/bom/list': { bizType: 'bom', action: 'create' },
  'PUT /api/bom/list/:id': { bizType: 'bom', action: 'update' },
  'DELETE /api/bom/list/:id': { bizType: 'bom', action: 'delete' },
  'PATCH /api/bom/list/:id/status': { bizType: 'bom', action: 'status_update' },
  // --- 库存操作 ---
  'POST /api/inventory/adjust': { bizType: 'inventory', action: 'adjust' },
  'POST /api/inventory/transfer': { bizType: 'inventory', action: 'transfer' },
  'POST /api/inventory/lock': { bizType: 'inventory', action: 'lock' },
  'POST /api/inventory/unlock': { bizType: 'inventory', action: 'unlock' },
  'POST /api/inventory/intra-transfer': { bizType: 'inventory', action: 'intra_transfer' },
  'POST /api/inventory/intra-transfer/batch': { bizType: 'inventory', action: 'intra_transfer_batch' },
  'POST /api/inventory/defective-transfer/scan': { bizType: 'inventory', action: 'defective_transfer_scan' },
  'POST /api/inventory/defective-transfer/confirm': { bizType: 'inventory', action: 'defective_transfer_confirm' },
  'POST /api/inventory/expiry/extend': { bizType: 'inventory', action: 'expiry_extend' },
  'POST /api/inventory/expiry/reinspect': { bizType: 'inventory', action: 'expiry_reinspect' },
  'POST /api/defective-move/:id/complete': { bizType: 'defective_move', action: 'complete' },

  // ==================== ③ 生产与质量类 ====================
  // --- 工单 ---
  'POST /api/workorder': { bizType: 'workorder', action: 'create' },
  'POST /api/workorder/list': { bizType: 'workorder', action: 'create' },
  'POST /api/workorder/issue': { bizType: 'workorder', action: 'issue' },
  'POST /api/workorder/close': { bizType: 'workorder', action: 'close' },
  'POST /api/workorder/cancel': { bizType: 'workorder', action: 'cancel' },
  'POST /api/workorder/recall': { bizType: 'workorder', action: 'recall' },
  // --- 领料 ---
  'POST /api/workorder/picking/generate': { bizType: 'picking', action: 'generate' },
  'POST /api/workorder/picking/:id/approve': { bizType: 'picking', action: 'approve' },
  'POST /api/workorder/picking/batch-approve': { bizType: 'picking', action: 'batch_approve' },
  'POST /api/workorder/picking/:id/pick': { bizType: 'picking', action: 'pick' },
  'POST /api/workorder/picking/:id/pick-with-substitution': { bizType: 'picking', action: 'pick_with_substitution' },
  // --- 物料需求 ---
  'POST /api/workorder/requirement/generate': { bizType: 'requirement', action: 'generate' },
  'POST /api/workorder/requirement/:id/submit': { bizType: 'requirement', action: 'submit' },
  'POST /api/workorder/requirement/:id/approve': { bizType: 'requirement', action: 'approve' },
  'POST /api/workorder/requirement/batch-submit': { bizType: 'requirement', action: 'batch_submit' },
  'POST /api/workorder/requirement/submit-by-workorder': { bizType: 'requirement', action: 'submit_by_workorder' },
  'POST /api/workorder/supplement/create': { bizType: 'supplement', action: 'create' },
  // --- 超补领料 ---
  'POST /api/over-picking': { bizType: 'over_picking', action: 'create' },
  'POST /api/over-picking/:id/approve': { bizType: 'over_picking', action: 'approve' },
  'POST /api/over-picking/:id/cancel': { bizType: 'over_picking', action: 'cancel' },
  // --- 收料 ---
  'POST /api/receipt/scan': { bizType: 'receipt', action: 'scan' },
  'POST /api/receipt/batch-receipt': { bizType: 'receipt', action: 'batch_receipt' },
  'POST /api/receipt/submit-iqc': { bizType: 'receipt', action: 'submit_iqc' },
  // --- IQC 判定与审批 ---
  'POST /api/iqc/inspect/:lotId': { bizType: 'iqc', action: 'inspect' },
  'POST /api/iqc/lot/:id/judge': { bizType: 'iqc', action: 'judge' },
  'POST /api/iqc/lot/:id/exempt-confirm': { bizType: 'iqc', action: 'exempt_confirm' },
  'POST /api/iqc/report/:id/review': { bizType: 'iqc', action: 'report_review' },
  'POST /api/iqc/report/:id/reject': { bizType: 'iqc', action: 'report_reject' },
  'POST /api/iqc/report/batch-approve': { bizType: 'iqc', action: 'report_batch_approve' },
  'POST /api/iqc/production-return/:id/inspect': { bizType: 'iqc', action: 'production_return_inspect' },
  // --- IQC 配置（检验模板 / 标准项 / 严格度） ---
  'POST /api/iqc/templates': { bizType: 'iqc_config', action: 'template_create' },
  'PATCH /api/iqc/templates/:id': { bizType: 'iqc_config', action: 'template_update' },
  'DELETE /api/iqc/templates/:id': { bizType: 'iqc_config', action: 'template_delete' },
  'PUT /api/iqc/templates/:id/items': { bizType: 'iqc_config', action: 'template_items_update' },
  'PUT /api/iqc/templates/:id/materials': { bizType: 'iqc_config', action: 'template_materials_update' },
  'POST /api/iqc/templates/:id/import-section': { bizType: 'iqc_config', action: 'template_import_section' },
  'POST /api/iqc/templates/import': { bizType: 'iqc_config', action: 'template_import' },
  'PUT /api/iqc/lot/:id/template': { bizType: 'iqc_config', action: 'lot_template_set' },
  'POST /api/iqc/standard-items': { bizType: 'iqc_config', action: 'standard_item_create' },
  'PUT /api/iqc/standard-items/:id': { bizType: 'iqc_config', action: 'standard_item_update' },
  'DELETE /api/iqc/standard-items/:id': { bizType: 'iqc_config', action: 'standard_item_delete' },
  'POST /api/iqc/strictness/configure': { bizType: 'iqc_config', action: 'strictness_configure' },
  'POST /api/iqc/strictness/manual-action': { bizType: 'iqc_config', action: 'strictness_manual_action' },

  // ==================== ④ 异常处置类 ====================
  'POST /api/stock-take': { bizType: 'stock_take', action: 'create' },
  'POST /api/stock-take/:id/submit': { bizType: 'stock_take', action: 'submit' },
  'POST /api/stock-take/:id/approve': { bizType: 'stock_take', action: 'approve' },
  'POST /api/stock-take/:id/cancel': { bizType: 'stock_take', action: 'cancel' },
  'POST /api/stock-take/:id/delete': { bizType: 'stock_take', action: 'delete' },
  'POST /api/stock-take/:id/unlock': { bizType: 'stock_take', action: 'unlock' },
  'POST /api/stock-take/:id/scan': { bizType: 'stock_take', action: 'scan' },
  'POST /api/stock-take/:id/item/:itemId/adjust': { bizType: 'stock_take', action: 'item_adjust' },
  'POST /api/stock-take/:id/item/:itemId/confirm': { bizType: 'stock_take', action: 'item_confirm' },
  'POST /api/supplier-return/outbound': { bizType: 'supplier_return', action: 'outbound' },
  'POST /api/supplier-return/cancel': { bizType: 'supplier_return', action: 'cancel' },
  'POST /api/rework/start': { bizType: 'rework', action: 'start' },
  'POST /api/rework/finish': { bizType: 'rework', action: 'finish' },
  'POST /api/rework/reinspect': { bizType: 'rework', action: 'reinspect' },
  'POST /api/workorder/production-return': { bizType: 'production_return', action: 'create' },
  'PUT /api/workorder/production-return/:id': { bizType: 'production_return', action: 'update' },
  'DELETE /api/workorder/production-return/:id': { bizType: 'production_return', action: 'delete' },
  'POST /api/workorder/production-return/:id/submit': { bizType: 'production_return', action: 'submit' },
  'POST /api/receipt/production-return/scan-inbound': { bizType: 'production_return', action: 'scan_inbound' },
  'POST /api/receipt/production-return/:id/generate-labels': { bizType: 'production_return', action: 'generate_labels' },

  // ==================== ⑤ MRB 审批 ====================
  'POST /api/mrb/initiate': { bizType: 'mrb', action: 'initiate' },
  'POST /api/mrb/assign-reviewers': { bizType: 'mrb', action: 'assign_reviewers' },
  'POST /api/mrb/submit-review': { bizType: 'mrb', action: 'submit_review' },
  'POST /api/mrb/final-approve': { bizType: 'mrb', action: 'final_approve' },
};
