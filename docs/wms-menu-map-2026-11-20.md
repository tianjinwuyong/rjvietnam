# 原 WMS 菜单 → SMT 系统落点对照（62 项全量，2026-11-20）

数据来源：运行中的 WMS 登录接口返回的 `menuPermissions`（62 项，实测 `GET /api/system/login`）。
SMT 侧落点以 `apps/web/src/wms/index.ts` 的 `wmsMenuGroups`（刚重排）+ `App.tsx` 的 tab 渲染为准。

图例：**独立页** = 有专门页面；**复用页** = 同一页面覆盖该菜单（原系统本身也是同一张表的不同筛选）；**新增** = 本次补的页/接口；**模块入口** = 不在 WMS 内，属 SMT 其它一级模块。

## 一、按业务流重排后的 SMT 菜单（wmsMenuGroups）

| 分组 | 中文名 | 包含的 tab |
|---|---|---|
| overview | 首页 | 仓库看板、闭环控制中心、原系统导航、原系统数据、仓库档案、消息通知 |
| receivingManagement | 收料管理 | 物料收料、收料管理、生产退料接收、PDA 收料(/移动)、入库单、PO 采购到货、上架、二维码绑定、上料管理、同步健康 |
| iqcManagement | IQC 检验 | IQC 检验、检验执行、检验等级与人工判定、物料闭环、不良品闭环、IQC 报告、IQC 标准、**IQC 检验模板库（新增）**、合格结果维护、不良品档案、复检档案、PDA IQC、待检清单、质量趋势 |
| warehouse | 仓库管理 | 库存、库存管控、库存查询、盘点、移库/调拨、**有效期管控（接上数据）**、生命周期、FIFO 监控/模拟、不良品移库、库存事务、批次管理、库位管理 |
| issuingManagement | 领料与发料 | 备料、发料、领料单、发料单、物料配送、工单交接、出库单、退料单、补料、超领、PDA 消耗、原系统备料、原系统单据流、生产入库/出库、物料消耗看板、SMT/非 SMT/非 IQC 闭环 |
| returnsRework | 退货 · 返工 · MRB | 退供应商、退货出库单、销售退货、产线退料、返工、返工回仓、MRB、MRB 评审、MRB 返工回仓、委外退货、报废财务审批、供应商欠料 |
| specialMaterials | 辅料与特殊物料 | 锡膏、辅料、MSD、PDA MSD |
| traceability | 追溯管理 | 追溯、物料追溯、3D 流转 |
| basicData | 基础数据 | 物料主数据、条码闭环、**物料替代关系（新增）**、供应商管理、供应商 KPI、基础资料、来料 |
| quality | 质量管理 | 质量看板、OQC、不良品管理、8D |
| devices | 料架与协同 | 智能料架、料架作业、料架仿真、料架工作流、PDA 盘点、PDA 历史、协同 |

## 二、62 个原菜单逐项对照

| # | 原 WMS 菜单 | 归属分类（SMT） | SMT 页面 / tab | 状态 |
|---|---|---|---|---|
| 1 | `/` 首页看板 | 首页 | `dashboard` 仓库看板 | 独立页 |
| 2 | `/warehouse` 仓库组 | 基础数据 | `locationManagement` 库位管理 | 复用页 |
| 3 | `/warehouse/list` 仓库档案 | 首页 | `rjvnCanonical` 仓库档案 | 独立页 |
| 4 | `/warehouse/location` 库位 | 基础数据 | `locationManagement` | 独立页 |
| 5 | `/material` 物料组 | 基础数据 | `materialMaster` 物料主数据 | 独立页 |
| 6 | `/material/list` 物料列表 | 基础数据 | `rjvnData` 原系统数据 | 复用页 |
| 7 | `/material/supplier` 供应商 | 基础数据 | `supplierManagement` | 独立页 |
| 8 | `/material/substitution` 替代料 | 基础数据 | **`substitution` 物料替代关系** | **新增**（`GET /wms/material-substitutions`） |
| 9 | `/receipt` 收货组 | 收料管理 | `receiving` 收料管理 | 独立页 |
| 10 | `/receipt/scan` 扫码收货 | 收料管理 | `pdaReceiving` PDA 收料 | 独立页 |
| 11 | `/receipt/list` 收料单列表 | 收料管理 | `rjvnReceipt` / `inboundOrders` | 复用页 |
| 12 | `/receipt/production-return` 生产退料 | 退货 · 返工 | `returnReceive` 生产退料接收 | 独立页 |
| 13 | `/iqc` IQC 组 | IQC 检验 | `iqc` / `iqcInspect` | 独立页 |
| 14 | `/iqc/pending` 待检清单 | IQC 检验 | `rjvnIqc` 待检清单 | 独立页 |
| 15 | `/iqc/record` 检验记录 | IQC 检验 | `iqcReport` | 独立页 |
| 16 | `/iqc/report` 检验报告 | IQC 检验 | `iqcReport` | 独立页 |
| 17 | `/iqc/template` 检验模板 | IQC 检验 | **`iqcTemplates` 检验模板库** | **新增**（`GET /wms/iqc-templates`，24 套启用模板 / 107 检验项） |
| 18 | `/iqc/standard-library` 标准库 | IQC 检验 | `iqcStandards` | 独立页 |
| 19 | `/iqc/stats` 检验统计 | IQC 检验 | `qualityTrend` 质量趋势 | 复用页 |
| 20 | `/iqc/strictness` 检验严格度 | IQC 检验 | `iqcInspectionLevels` 检验等级 | 独立页 |
| 21 | `/iqc/production-return-pending` 退料待检 | 退货 · 返工 | `lineReturn` 产线退料 | 复用页 |
| 22 | `/iqc/supplier-debt` 供应商欠料 | 退货 · 返工 | `supplierDebt` | 独立页 |
| 23 | `/inventory` 库存组 | 仓库管理 | `inventory` 库存 | 独立页 |
| 24 | `/inventory/query` 库存查询 | 仓库管理 | `rjvnInventory` | 独立页 |
| 25 | `/inventory/intra-transfer` 库内移库 | 仓库管理 | `transferAdjust` 移库调拨 | 独立页 |
| 26 | `/inventory/transfer` 仓库间调拨 | 仓库管理 | `transferAdjust` | 复用页 |
| 27 | `/inventory/defective-transfer` 不良品转移 | 仓库管理 | `defectiveMove` | 独立页 |
| 28 | `/inventory/defective-move` 不良品移库 | 仓库管理 | `defectiveMove` | 独立页 |
| 29 | `/inventory/expiry` 有效期 | 仓库管理 | **`expiryControl` 有效期管控** | **接数据**（`GET /wms/inventory-expiry`：500 批次 / 45 已过期 / 2 ≤7d / 10 ≤30d） |
| 30 | `/inventory/stock-take` 盘点 | 仓库管理 | `cycleCount` | 独立页 |
| 31 | `/bom` BOM 组 | 模块入口 | 顶部 `BOM 清单` 模块 | 模块入口 |
| 32 | `/bom/list` BOM 清单 | 模块入口 | 顶部 `BOM 清单` 模块 | 模块入口 |
| 33 | `/workorder` 工单组 | 领料与发料 | `requisitions` 领料单 | 复用页 |
| 34 | `/workorder/list` 工单列表 | 领料与发料 | `requisitions` | 复用页 |
| 35 | `/workorder/requirement` 工单需求 | 领料与发料 | `requisitions` + BOM 需求评审 | 复用页 |
| 36 | `/workorder/picking` 领料 | 领料与发料 | `rjvnPicking` / `picking` | 独立页 |
| 37 | `/workorder/picking-approval` 领料审批 | 领料与发料 | `picking` 备料审批 | 复用页 |
| 38 | `/workorder/supplement` 补料 | 领料与发料 | `replenishments` 补料单 | 独立页 |
| 39 | `/workorder/supplement-record` 补料记录 | 领料与发料 | `slips` 发料单 | 复用页 |
| 40 | `/production` 生产组 | 领料与发料 | `materialLoading` 上料管理 | 复用页 |
| 41 | `/production/production-return` 生产退料 | 退货 · 返工 | `lineReturn` | 独立页 |
| 42 | `/production/picking-approval` 领料审批 | 领料与发料 | `picking` | 复用页 |
| 43 | `/production/picking-receive` 领料接收 | 领料与发料 | `issue` 发料 | 复用页 |
| 44 | `/production/reel-settlement` 料盘结算 | 领料与发料 | `materialConsumption` 物料消耗看板 | 复用页 |
| 45 | `/production/over-picking` 超领 | 领料与发料 | `overPicking` | 独立页 |
| 46 | `/production/supplement` 补料 | 领料与发料 | `replenishments` | 独立页 |
| 47 | `/production/supplement-record` 补料记录 | 领料与发料 | `slips` | 复用页 |
| 48 | `/production/over-supplement-report` 超补领料单 | 领料与发料 | `rjvnDocFlow` | 独立页 |
| 49 | `/issuing` 发料组 | 领料与发料 | `issue` | 独立页 |
| 50 | `/issuing/list` 发料单 | 领料与发料 | `outboundOrders` 出库单 | 复用页 |
| 51 | `/issuing/records` 发料记录 | 仓库管理 | `transactions` 库存事务 | 复用页 |
| 52 | `/mrb` MRB 组 | 退货 · 返工 | `mrb` | 独立页 |
| 53 | `/mrb/list` MRB 清单 | 退货 · 返工 | `mrb` / `mrbApproval` | 独立页 |
| 54 | `/mrb/task` MRB 任务 | 退货 · 返工 | `mrb` | 复用页 |
| 55 | `/rework` 返工组 | 退货 · 返工 | `rework` | 独立页 |
| 56 | `/rework/list` 返工单 | 退货 · 返工 | `reworkComplete` 返工回仓 | 独立页 |
| 57 | `/supplier-return` 退供应商组 | 退货 · 返工 | `supplierReturn` | 独立页 |
| 58 | `/supplier-return/list` 退货单 | 退货 · 返工 | `supplierReturnOrder` | 独立页 |
| 59 | `/system` 系统组 | 模块入口 | 顶部「管理」模块（用户/角色/参数） | 模块入口 |
| 60 | `/system/param` 参数 | 模块入口 | 管理 → 系统参数 | 模块入口 |
| 61 | `/system/role` 角色 | 模块入口 | 管理 → 角色权限 | 模块入口 |
| 62 | `/system/account` 账号 | 模块入口 | 管理 → 用户账号 | 模块入口 |

## 三、结论

- **菜单覆盖 62/62**：55 项在 WMS 板块内有页面（其中 3 项为本次新增/接数据），4 项属顶部模块（BOM 清单、管理后台），3 项为原系统同表的筛选视图（复用页）。
- 本次补齐的 3 个「有菜单没落地」项：IQC 检验模板库（48 套 / 107 项检验明细，此前只有镜像表无人读）、物料替代关系、有效期管控（此前页面是空壳 `useState<[]>()`）。
- 顺带修正 4 处错误映射：MRB 评审/任务不再挂到「超补领料单」，返工回仓不再挂到「不良品管理」，工单列表不再挂到「PO 采购到货」，检验模板不再挂到「IQC 标准」。
- 仍属原系统专有、SMT 用别的方式实现：`/system/*` 的系统参数/角色/账号在顶部「管理」模块；`/bom/*` 在顶部「BOM 清单」模块（WMS 侧给物料主数据入口）。
