-- ============================================================
-- WMS 测试业务数据清理脚本
-- 生成时间：2026-10-16
-- 作用：清空测试业务数据，仅保留「物料管理」「系统设置」及系统必需表
-- 方式：TRUNCATE ... RESTART IDENTITY（只清数据，不删表结构）
-- 注意：必须是【单条】TRUNCATE。PostgreSQL 要求某表的所有外键引用方
--       都出现在同一条 TRUNCATE 命令内，拆成多条会报"无法删除关联"。
--       因此不使用 CASCADE——加 CASCADE 反而可能在清单不全时误删。
-- 范围：97 张表 / 4518 行；保留 10 张
-- 执行前必须先 pg_dump 全库备份
-- ============================================================

BEGIN;

TRUNCATE TABLE
  -- ---------- A. WMS 业务流水（37 张 / 1958 行） ----------
  inventory,                    -- 库存
  inventory_transaction,        -- 库存流水
  material_expiry_extension,    -- 有效期延长
  receipt_order,                -- 收料单
  iqc_lot,                      -- IQC 批次
  iqc_lot_receipt,              -- IQC 批次收料
  iqc_lot_strictness_count,     -- 批次严格度计数
  iqc_inspection_record,        -- 检验记录
  iqc_inspection_draft,         -- 检验草稿
  iqc_inspection_item,          -- 检验项
  iqc_report,                   -- 检验报告
  iqc_strictness_transfer_log,  -- 严格度转移日志
  mrb_review,                   -- MRB 评审
  mrb_reviewer,                 -- MRB 评审人
  mrb_disposition,              -- MRB 处置
  material_requirement,         -- 物料需求
  material_requirement_item,    -- 物料需求明细
  picking_order,                -- 领料单
  picking_order_item,           -- 领料单明细
  work_order,                   -- 工单
  over_picking_order,           -- 超补领料单
  over_picking_item,            -- 超补领料明细
  stock_transfer,               -- 库存调拨
  stock_take_order,             -- 盘点单
  stock_take_item,              -- 盘点明细
  stock_take_log,               -- 盘点日志
  stock_purge_order,            -- 库存清理单
  stock_purge_order_line,       -- 库存清理明细
  supplier_debt,                -- 供应商欠料台账
  supplier_debt_settlement,     -- 欠料核销
  supplier_return_order,        -- 供应商退货出库单
  supplier_return_item,         -- 供应商退货明细
  rework_order,                 -- 返工单
  production_return,            -- 产线退料
  production_return_iqc,        -- 退料 IQC
  production_return_label,      -- 退料标签
  defective_move_task,          -- 不良品调拨
  -- ---------- B. WMS 基础资料 / 配置（9 张 / 382 行） ----------
  warehouse,                    -- 仓库档案
  warehouse_location,           -- 仓库地址码档案
  bom,                          -- BOM 清单
  bom_item,                     -- BOM 明细
  iqc_template,                 -- IQC 检验模板
  iqc_template_item,            -- 模板检验项
  iqc_template_material,        -- 模板-物料绑定
  iqc_standard_item,            -- IQC 标准项
  iqc_inspection_strictness,    -- 检验严格度
  -- ---------- C. 遗留 ERP 业务数据（38 张 / 1960 行，代码零引用） ----------
  oa_todo,                      -- OA 待办
  oa_task,                      -- OA 任务
  oa_operation_log,             -- OA 操作日志
  oa_process_instance,          -- OA 流程实例
  oa_attachment,                -- OA 附件
  oa_expense_request,           -- OA 报销单
  oa_expense_item,              -- OA 报销明细
  oa_leave_request,             -- OA 请假单
  oa_seal_request,              -- OA 用印申请
  oa_notice,                    -- OA 公告
  oa_notice_read,               -- OA 公告已读
  oa_meeting,                   -- OA 会议
  oa_meeting_attendee,          -- OA 参会人
  oa_meeting_minutes,           -- OA 会议纪要
  oa_document,                  -- OA 文档
  qms_revision_log,             -- 质量文档修订日志
  qms_abolishment,              -- 质量文档废止
  qms_issuance,                 -- 质量文档发放
  qms_doc_no_revoked,           -- 文档号作废
  purchase_order,               -- 采购订单
  purchase_order_item,          -- 采购订单明细
  purchase_requisition,         -- 采购申请
  purchase_requisition_item,    -- 采购申请明细
  sales_order,                  -- 销售订单
  sales_order_item,             -- 销售订单明细
  delivery_note,                -- 送货单
  delivery_note_item,           -- 送货单明细
  finished_goods_shipment,      -- 成品出货
  payment,                      -- 收付款
  ap_item,                      -- 应付明细
  ar_item,                      -- 应收明细
  voucher,                      -- 凭证
  voucher_entry,                -- 凭证分录
  invoice,                      -- 发票
  production_cost,              -- 生产成本
  production_plan,              -- 生产计划
  mrp_result,                   -- MRP 运算结果
  oqc_inspection,               -- OQC 出货检验
  -- ---------- D. 遗留 ERP 基础资料 / 配置（13 张 / 218 行） ----------
  account,                      -- 会计科目
  accounting_template,          -- 会计模板
  currency,                     -- 币种
  customer,                     -- 客户档案
  department,                   -- 部门
  employee,                     -- 员工
  fiscal_period,                -- 会计期间
  tax_rate,                     -- 税率
  qms_document,                 -- 质量文档主数据
  qms_revision,                 -- 质量文档版本
  qms_file,                     -- 质量文档附件
  oa_workflow_def,              -- OA 流程定义
  oa_workflow_node              -- OA 流程节点
RESTART IDENTITY;

COMMIT;

-- ============================================================
-- 保留不动（10 张）
--   物料管理：material / supplier / supplier_material / material_substitution
--   系统设置：sys_param / sys_role / sys_account / role_user
--   操作日志：operation_log
--   迁移记录：_drizzle_migrations
-- ============================================================
