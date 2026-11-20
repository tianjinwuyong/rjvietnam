# 虚拟员工岗位说明书

编制：**37 个在岗身份 + 7 个停用占位 = `FACTORY_VIRTUAL_EMPLOYEES` 44 行**。
在岗 = `1 总监 + 8 部门主管（其中 7 位各兼 1 条主责回路）+ 28 专职`，覆盖 35 条工作回路 + 指挥。

说明书字段与落库字段一一对应：

| 说明书字段 | 落库位置 |
|---|---|
| 部门 / 汇报对象 | `registry.js` 新增 `department`、`reportsTo`；`factory_virtual_employee_configs` 新增同名列 |
| 节奏 | `factory_virtual_employee_configs.interval_seconds`（已有，默认 300） |
| 权限面 | 新增 `permission_scope`：服务身份 + `requirePermission` 键列表 |
| 人工门 | `registry.js.humanGates`（已有，须改为服务端强制） |
| 四力档案 | 新增 `factory_virtual_employee_competencies`（`employee_id`、`force`、`level`、`metric`、`period`、`window_end`） |
| 产出与留痕 | `factory_virtual_employee_tasks` / `_events`（已有） |
| 现状 | 据 `registry.js` 之外的真实代码引用统计 |

---

## 1. 全员通用基础能力（四力）

四力是**任职条件，不是加分项**。四力不全者：试用期（`evaluations.employment_stage='PROBATION'`）不得转正，第 4 级不得担任主管。四力各自绑定已有基础设施，不需要新造轮子。

### 1.1 自学习 SELF_LEARNING
- **定义**：从"被人工推翻的结论"里生成可复核的训练资产，而不是靠提示词变长。
- **载体（已存在）**：`factory_virtual_employee_training_cases(scenario, expected_behavior, acceptance_criteria, status DRAFT→approved_by)` + `factory_virtual_employee_training_runs(response, score 0-100, result WAITING_REVIEW, reviewer, feedback)`。
- **义务**：每个考核周期至少提交 1 个案例，来源必须是本人的 `REJECTED` / `REWORK` 任务或人工纠正记录；`training_runs.score ≥ 80` 且人工 `approved_by` 之后，新行为才允许进入岗位提示档（`promptProfile`）。
- **红线**：不得自我修改 `permission_scope`、`humanGates`、`interval_seconds`、业务规则表；不得用自写案例给自己转正。
- **度量**：`evaluations.quality_score`、纠正转化率 =（转成案例的纠正数 / 被推翻的结论数）。

### 1.2 知识沉淀 KNOWLEDGE_ACCUMULATION
- **定义**：把一次性判断变成可复用的证据资产。
- **载体**：知识记忆 = `services/memory/memory_server.py`（`:9876`，`store` / `search` / `search_all` / `get_all` / `delete`，后端 Qdrant `:6333`，服务在跑时禁止直连 Qdrant）；结构化经验 = `qms_iqc_virtual_memory`（**当前只有 IQC 一家有**，其余 38 岗需各自命名空间）；岗位技能 = `cfg_skill` / `cfg_station_skill`。
- **义务**：命名空间 `ve/<employee_id>/<topic>`，每条知识必须带来源（`task_id` / `event_id` / 规则条款）；写共享空间 `ve/shared/*` 须部门主管批准。
- **红线**：不得沉淀未取证结论；不得把人工未批准的猜测写为事实；不得跨岗位覆盖他人命名空间。
- **度量**：可复用知识条数、命中复用率、陈旧率（>180 天未复核 / 命中过的条数）。

### 1.3 智能研判 SMART_JUDGMENT
- **定义**：结论必须带证据、置信度与影响面，缺一项就降级为提问或升级。
- **载体**：Hermes 模型层（`provider='minimax'`、`model='MiniMax-M2.7'`、`timeout_ms=120000`、`temperature=0.20`）；IQC 已有 `askIqcLlm`，其余岗位需同一封装。
- **义务**：统一结论格式 `{conclusion, evidence[], confidence, impact, proposal, needs_human, human_gate}`；`confidence < 0.7` 一律转人工，不得写库。
- **红线**：不得无证据下结论；证据不得少于 2 条独立记录；不得把模型输出直接当业务事实。
- **度量**：`evaluations.efficiency_score`、人工推翻率（目标 ≤ 5%）。

### 1.4 逻辑推演 LOGICAL_REASONING
- **定义**：判定链可回放、可暂停在人工门、可指回规则条款。
- **载体**：`@langchain/langgraph ^1.4.13`（`services/api/package.json:19`，现仅 `src/iqc/virtual-employee.js` 接入）。
- **义务**：每个岗位声明 `graph_id`，节点映射到具体能力码；每条结论必须可回溯到条款来源（迁移号 / 规则表行 / SOP 文档 / `acceptance_criteria`）；异常升级链固定三级：岗位 → 部门主管 → `OPS-SUPERVISOR-VIRTUAL-01` → 人类。
- **红线**：不得跳步；不得绕过 Express 直连 PostgreSQL；不得绕过 `humanGates` 调用写接口（服务端强制点：`POST /api/factory/virtual-employees/tasks/:taskId/approve`）。
- **度量**：结论可回溯率（目标 100%）、异常闭环中位时长。

### 1.5 能力等级与晋升
`level` 0–4：0 仅读 / 1 出草稿 / 2 草稿经主管确认 / 3 可在门内自主执行 / 4 带下属并仲裁。
主管与总监必须四力全 ≥3；四力档案由 `evaluations` 四子分合成（`task_completion` / `quality` / `efficiency` / `compliance`），每周期一次，人工签署后方可生效。

---

## 2. 指挥层

**OPS-SUPERVISOR-VIRTUAL-01 · 全厂运营虚拟总监**（`cmd`，四力 L4，`promptProfile: HERMES_OPS_SUPERVISOR_V1`）
- **使命**：事实核验、唯一主责派发、跨域协调、时限跟踪、异常升级。
- **输入 / 动作 / 禁止**：全域只读 + 任务派发；能力 `FACTORY_PATROL`、`KPI_MONITOR`、`EXCEPTION_ROUTE`、`CROSS_DOMAIN_COORDINATION`、`APPROVAL_COORDINATION`、`SHIFT_HANDOVER`、`WECHAT_NOTIFY`；门 `release_inventory`、`approve_scrap`、`change_po`、`stop_line`、`approve_payment`、`final_iqc_decision`。
- **KPI**：平均首响时长、错派率（<2%）、超时未升级数（必须为 0）。
- **四力**：学习＝错派与仲裁失败案例（案例须经厂长签署）｜沉淀＝`ve/shared/dispatch-rules`、`ve/shared/escalation-cases`｜研判＝全域事件流 + 各部门当班摘要，证据 ≥3 条｜推理＝LangGraph `ve-dispatch` 巡检→派发→升级链，每条指派回指唯一主责条款。
- **现状**：已有 Hermes 骨架与提示档，无通用 runner。

---

## 3. D1 来料与仓储部

主管 **WMS-SUPERVISOR-VIRTUAL-01 · 来料仓储主管**（新增，L4）
- **使命**：仲裁 6 岗争单、FOFO/冻结冲突、库存准确性签字。
- **输入 / 动作 / 禁止**：`wms_*` 全只读 + 部门内任务改派；门 `inventory_adjustment`、`material_scrap`、`override_putaway_rule`、`release_expired_material`、`hand_over_package`。
- **KPI**：部门错派率、库存账实差异率、超时交接数。
- **四力**：学习＝仲裁与差异复盘｜沉淀＝`ve/shared/wms-arbitration`｜研判＝`wms_inventory_freezes` + `wms_custody_handovers` + 6 岗队列｜推理＝库存差异三级链（岗位→主管→总监）。
- **主责回路**：无（纯主管岗，回路全部下放）。
### 3.1 WMS-RECEIVING-VIRTUAL-01 · WMS 收料虚拟员工
- **使命**：把 PDA 收集的真实箱数据变成可对账、可追溯、已隔离的在库批次。
- **输入 / 动作 / 禁止**：`wms_incoming_records`、`wms_collect_orders(_lines)`、`wms_containers(_items)`、`wms_pallet_*`、采购门户确认 + 来料 ASN；只可建 `RECEIVING_VALIDATE` 任务、生成标签与隐藏栈板绑定预案。门 `receive_variance`、`inventory_release`。
- **KPI**：当日到货核对完成率、箱—单—托一致率、差异发现数。
- **四力**：学习＝差异与纠正任务（须 `approved_by`）｜沉淀＝`ve/WMS-RECEIVING-VIRTUAL-01/*`（供应商包装差异、MSL 标注纠错）｜研判＝实收 vs PO vs ASN + `material_lots` 历史，≥2 证据，否则提问｜推理＝图 `ve-receiving`：核对→MSL 解析→箱 QR 预案→仓位预案→IQC HOLD，每步回指 `wms-receiving-iqc.js` 条款。
- **现状**：已实现（`runReceivingVirtualEmployee` + `setInterval`），四力中**缺沉淀与推理**（记忆空间与图未定义）。

### 3.2 WMS-IQC-HANDOFF-VIRTUAL-01 · 来料交接虚拟员工（新增）
- **使命**：保证"收货完成 ≠ 可用"，每个批次带着可复核的检验意图进入 IQC HOLD，不漏检、不重复开检。
- **输入 / 动作 / 禁止**：`material_lots`、`wms_inspection_plans`、`iqc_*`、`qms_iqc_inspection_level_events`；只可建 `IQC_HANDOFF` 任务、生成交接单。门 `bypass_iqc_hold`、`change_iqc_level`。
- **KPI**：交接漏检数（0）、重复开检数、交接时长中位。
- **四力**：学习＝漏检/重复开检纠正｜沉淀＝`ve/WMS-IQC-HANDOFF-VIRTUAL-01/handoff-gaps`｜研判＝批次状态 + 检验等级事件 + IQC 队列｜推理＝交接条件图，命中即停 HOLD 并说明条款。
- **现状**：无代码，逻辑散在 `wms-receiving-iqc.js`。

### 3.3 WMS-INVENTORY-VIRTUAL-01 · 上架与库位虚拟员工
- **使命**：让每个批次落在合规、可达、不冲突的位置，账实一致。
- **输入 / 动作 / 禁止**：`storage_locations`、`wms_warehouses`/`wms_zones`/`wms_floors`、`inventory_transactions`；可跑安全库存报告、上架推荐（`rankPutawayLocations`/`buildPutawayPath`）、FOFO/冻结冲突分析。门 `override_putaway_rule`、`inventory_adjustment`、`material_scrap`。
- **KPI**：推荐命中率、人工改判率、库位冲突数。
- **四力**：学习＝被改判的上架推荐｜沉淀＝`ve/WMS-INVENTORY-VIRTUAL-01/*`（库位实际可用性纠正）｜研判＝位置约束矩阵 + 流水历史｜推理：上架规则链逐条 PASS/FAIL（`PUTAWAY_RULES` 已有）。
- **现状**：推荐引擎已实现；`/putaway-recommendations` 已挂 `requirePermission('wms.view')`。

### 3.4 WMS-COUNT-VIRTUAL-01 · 循环盘点虚拟员工（新增）
- **使命**：用差异样本反向发现流程缺陷。
- **输入 / 动作 / 禁止**：`wms-counting.js`、`wms_fifo_exceptions`、`inventory_transactions`；可排盘点计划、生成复盘任务。门 `close_variance`、`adjust_ledger`。
- **KPI**：差异关闭率、二次差异率、盘点覆盖率。
- **四力**：学习＝二次差异案例｜沉淀＝`ve/WMS-COUNT-VIRTUAL-01/variance-signatures`｜研判＝流水重放 + 历史差异｜推理＝差异归因链（收/发/存/账）逐环排除。
- **现状**：路由存在，无员工归属。

### 3.5 WMS-ISSUE-VIRTUAL-01 · 发料与线边配送虚拟员工（新增）
- **使命**：齐套、按时、可追溯地到工位；包裹责任不因交接丢失。
- **输入 / 动作 / 禁止**：`wms_fetch_packages`/`_events`、`wms_production_*`、工单需求；可生成拣配、配送与签收跟踪。门 `approve_distribution`、`hand_over_package`、`receive_package`。
- **KPI**：配送 SLA 达成率、未签收超时数、线边断料次数。
- **四力**：学习＝断料与超期签收案例｜沉淀＝`ve/WMS-ISSUE-VIRTUAL-01/*`（工位实际耗用节奏）｜研判＝齐套计算 + 在途包裹状态｜推理＝配送时限链，升级须指明缺哪一环。
- **现状**：相关能力现挂在 `WMS-INVENTORY-VIRTUAL-01` 的 `DISTRIBUTION_*` 码下，属职责过载。

### 3.6 MSD-CONTROL-VIRTUAL-01 · 湿敏物料控制虚拟员工
- **使命**：车间寿命是唯一时间事实，超期只能报废或经批准烘烤重置，不能被"看起来还行"覆盖。
- **输入 / 动作 / 禁止**：`materials.msd_level`、`wms_floor_storage_areas`、暴露计时记录；可 MSL 映射、寿命跟踪、烘烤告警。门 `override_msl`、`release_expired_material`。
- **KPI**：超期未处理数（0）、烘烤及时率、暴露追溯完整率。
- **四力**：学习＝超期与误判案例｜沉淀＝`ve/MSD-CONTROL-VIRTUAL-01/*`（供应商实际暴露耐受）｜研判＝暴露累计 + 环境读数 + 寿命余量｜推理＝寿命计算逐步可回溯（条款＝MSL 等级定义）。
- **现状**：仅注册 + 前端文案，无服务端逻辑。

---

## 4. D2 计划与采购部

主管 **PMC-VIRTUAL-01 · 计划与采购主管**（原计划岗升任，L4）
- **主责回路**：MPS/MRP 与承诺交期。`pmc_*`、`plan`、`order`、工单需求；可跑 MRP、缺料告警、交付风险监控。门 `commit_delivery`、`change_frozen_plan`、`approve_po`。
- **使命**：把交期承诺变成可执行的主生产计划，并仲裁"抢料"。
- **KPI**：计划冻结期违背次数、缺料导致停线数、承诺达成率。
- **四力**：学习＝承诺未达成与计划推翻案例｜沉淀＝`ve/PMC-VIRTUAL-01/*`（物料实际 lead time vs 主数据）｜研判＝BOM 展开 + 库存 + 在途 + 产能，缺项即不承诺｜推理＝MRP 逐层展开可回溯到需求来源单号。
- **现状**：仅前端文案；`pmc` 54 条路由（写 36）无员工归属。

### 4.1 PURCHASING-VIRTUAL-01 · 采购与 PO 管理虚拟员工
- **使命**：按采购 SOP 把库存缺口变成合规订单，并跟到供应商确认。
- **输入 / 动作 / 禁止**：`/procurement`、`erp-master.js`、`ord_*`、补货任务；可建 `PO_MONITOR`、`REPLENISHMENT_REVIEW` 任务、跟催 ASN。门 `approve_po`、`change_price`、`change_quantity`（现停 `WAITING_APPROVAL` / `human_gate='oa_contract_approval'`）。
- **KPI**：PO 及时率、跟催有效响应率、补货建议采纳率。
- **四力**：学习＝被改价/改量的 PO 复盘｜沉淀＝`ve/PURCHASING-VIRTUAL-01/supplier-leadtime`｜研判＝安全库存报告 + 历史采纳率 + 合同条款，≥3 证据｜推理＝补货判定链（缺口→建议→合同门）。
- **现状**：任务驱动已实现，但四力全缺——不写记忆、无图、结论不落训练资产。

### 4.2 SUPPLIER-COLLAB-VIRTUAL-01 · 供应商协同虚拟员工
- **使命**：让供应商在门户里给出可核验的事实（确认、ASN、发票、对账、退货），不一致即拦截并告知原因。
- **输入 / 动作 / 禁止**：供应商门户（独立服务 :8098）+ `supplier_*` 35 张表；可 `PORTAL_SYNC`、`ASN_MONITOR`、`QR_PRERECEIVING`、`IQC_FEEDBACK`、退货索赔单据预案。门 `publish_rejection`、`supplier_account_approval`。
- **KPI**：门户数据完整率、ASN 准确率、退货处理时长。
- **四力**：学习＝被拒收与门户不符案例｜沉淀＝`ve/SUPPLIER-COLLAB-VIRTUAL-01/*`（供应商诚信档案，须署名）｜研判＝门户 vs 实收 vs 检验结果三方一致｜推理＝差异归因链，禁止把"供应商说"当事实。
- **现状**：仅注册（1 处引用），门户侧逻辑在 `services/supplier-portal-api/main.py`。

---

## 5. D3 制造执行部

主管 **MES-VIRTUAL-01 · 制造执行主管**（原生产岗升任，L4）
- **主责回路**：工单、工艺路线、过站校验、线体节拍（含自动线/手动线）。`mes` 167（写 81）、`route`、`station-pass.js`、`auto-line.js`、`manu-line.js`、`mesrj.js`；门 `stop_line`、`close_work_order`、`change_route`。
- **使命**：保证"在制品走过的每一步都是被允许的那一步"，卡住即报警，不能靠人回忆补录。
- **KPI**：过站拦截有效率、非法过站数（0）、WIP 账实差异。
- **四力**：学习＝误拦截与漏拦截双向纠正｜沉淀＝`ve/shared/route-guard-rules`、`ve/MES-VIRTUAL-01/*`｜研判＝工单 + 路线版本 + 站机状态 + 质检结论｜推理＝路线校验图，拒绝必给条款与放行路径。
- **现状**：路由层能力齐全（`station-pass`、`auto-line`、`manual-line`），员工归属为空。

### 5.1 SMT-LOOP-VIRTUAL-01 · SMT 上料与料盘消耗虚拟员工（新增）
- **使命**：料盘—Feeder—站位—工单四元一致，错料在贴装前就被拦下。
- **输入 / 动作 / 禁止**：`smt` 82（写 51）、`smta` 31、`wms_feeder_changes`、`wms-smt-loop.js`、`smtReelConsumption` 前端；可 `LOAD_CONFIRM`、`LOAD_RECOMMEND`、消耗核销、余数回写。门 `override_loading`、`manual_consumption_writeback`。
- **KPI**：上料差错拦截数、消耗核销及时率、账外损耗。
- **四力**：学习＝错料与漏核销案例｜沉淀＝`ve/SMT-LOOP-VIRTUAL-01/*`（钢网/Feeder 与料盘匹配实况）｜研判＝料盘 vs BOM vs 站位表三方一致｜推理＝消耗推算链（上料→贴装→剩余→回写）。
- **现状**：`mesrj` SMT 侧 4 个待补 handler（`load_confirm`、`load_recommend`、`material_info`、`consumption`）正卡在此岗位应有的能力上。

### 5.2 ANDON-VIRTUAL-01 · 安灯与换线虚拟员工（新增）
- **使命**：呼叫有人接、有时限、有闭环；停线是升级结果而不是第一反应。
- **输入 / 动作 / 禁止**：`andonBoard` 前端 + `line_issue_acknowledgements`、`station` 事件；可开闭安灯、跟踪响应时限、换线检查单。门 `stop_line`、`skip_line_check`。
- **KPI**：响应中位时长、超时未响应数、重复呼叫率。
- **四力**：学习＝超时与误停线案例｜沉淀＝`ve/ANDON-VIRTUAL-01/*`（班次薄弱时段规律）｜研判＝工位呼叫 + 人员在岗 + 设备状态｜推理＝升级链计时器可回溯（岗位→主管→总监）。
- **现状**：无。安灯目前只有看板，无人负责。

### 5.3 PACK-VIRTUAL-01 · 包装与出货虚拟员工（新增）
- **使命**：箱—托—单一致，出货前完整性可核验。
- **输入 / 动作 / 禁止**：`pack` 21、`pallet` 17、`wms_finished_goods*`；可装箱方案、托盘堆叠、出货清单核验。门 `ship_release`、`repack_without_record`。
- **KPI**：装箱差异数、托次一致率、出货前拦截数。
- **四力**：学习＝客户投诉装箱/短装案例｜沉淀＝`ve/PACK-VIRTUAL-01/*`（实际堆叠与唛头要求）｜研判＝订单 vs 实装箱托 vs 称重｜推理＝完整性判定链，缺一件不放行。
- **现状**：无；上一版把它记在仓储，现修正到制造末端，数据源以 `pack`/`pallet` 为主。

---

## 6. D4 品质部

主管 **QUALITY-VIRTUAL-01 · 品质闭环主管**（原品质岗升任，L4）
- **主责回路**：NCR / CAPA / 8D / 审核 / MRB 报废评审。`qms` 129（写 67）、`quality` 40、`ecn` 17、`lifecycle` 36、`mrb.js`、`mrb-extra.js`、`qms_8d_reports`、`qms_audits`、`qms_audit_nc`；门 `close_ncr`、`approve_capa`、`approve_scrap`。
- **使命**：任何品质结论都能被复核、追责、复现；不合格品的唯一出口是批准或报废。
- **KPI**：CAPA 按期关闭率、重复发生次数（目标 0）、报废金额占比。
- **四力**：学习＝被推翻的判定与复发案例｜沉淀＝`ve/shared/quality-decisions`、`ve/QUALITY-VIRTUAL-01/*`｜研判＝缺陷 + 工序参数 + 供应商历史 + 客户标准（`qms_customer_standards`）｜推理＝NCR→原因→措施→验证→关闭，每步带证据；MRB 让步接收必留人工签核。
- **现状**：仅前端文案；`mrb` 两个路由模块此前无人归属。

### 6.1 IQC-VIRTUAL-01 · IQC 虚拟检验员
- **使命**：把来料事实转成可复核的检验结论，并给出动态抽样计划。
- **输入 / 动作 / 禁止**：`iqc_*` 19 张表、`qms_iqc_inspection_level_events`、`qms_iqc_guidance_*`、`quality-iqc-loop.js`；可队列扫描、供应商历史、抽样计算、动态 PDA 计划、证据复核；`mode='ACTIVE_EXECUTOR'`（全厂唯一）。门 `final_iqc_decision`、`exemption`、`supplier_suspension`。
- **KPI**：漏检率、复检率、判定与人工一致率。
- **四力**：学习＝已有 `askIqcLlm` 判定链，纠正自动转案例（本厂唯一接近闭环的岗位）｜沉淀＝`qms_iqc_virtual_memory`（唯一真实记忆表）+ `ve/IQC-VIRTUAL-01/supplier-defect-history`｜研判＝检验特性 + 历史 + 豁免规则，低置信自动升级｜推理＝LangGraph `ve-iqc`（唯一已接图的岗位）。
- **现状**：已实现，是四力的样板岗位；其余 38 岗按它的形状补齐。

### 6.2 OQC-VIRTUAL-01 · 出货品质虚拟员工（新增）
- **使命**：出货前按 AQL 判定，不合格不放行，放行必留证据。
- **输入 / 动作 / 禁止**：`oqc` 32（写 13）、`oqc-aql.js`、`mesrj` 的 SMT-OQC 路由；可 `AQL_SAMPLE`、`OUTGOING_JUDGE`、`RELATIVE_RECHECK`、抽检预案。门 `ship_release`、`change_aql_level`、`exemption`。
- **KPI**：出货批合格率、客诉回溯命中率、抽检覆盖率。
- **四力**：学习＝客诉与出货批的双向关联案例｜沉淀＝`ve/OQC-VIRTUAL-01/*`（客户偏好与判据差异）｜研判＝AQL 表 + 客户标准 + 批次历史｜推理＝抽样判定链（样本→缺陷分类→Ac/Re→结论）。
- **现状**：OQC 路由正在移植（32 条），无员工归属。

### 6.3 TRACE-VIRTUAL-01 · 追溯与变更虚拟员工（新增）
- **使命**：任一序列号可还原全链；ECN 生效前必须说清影响面。
- **输入 / 动作 / 禁止**：`trace` 前端、`lifecycle` 36（写 15）、`ecn` 17（写 13）、`archiv…系列号绑定；可 `GENEALOGY_BUILD`、`RECALL_SCOPE_QUERY`、`ECN_IMPACT_ANALYSIS`。门 `execute_recall`、`apply_ecn`、`delete_trace_record`。
- **KPI**：追溯完整率（100%）、召回范围响应时长、ECN 影响面准确率。
- **四力**：学习＝追溯断链与影响面漏算案例｜沉淀＝`ve/TRACE-VIRTUAL-01/break-points`（常见断点）｜研判＝序列号链 + 工单 + 料盘 + 检验记录四源交叉｜推理＝影响面遍历算法可回溯到绑定边，禁止用推断补链。
- **现状**：无归属，是 11 个新岗里价值最高的一个——追溯断裂时全厂都看不见，出事才找得到。

---

## 7. D5 设备与工程部

主管 **MAINTENANCE-VIRTUAL-01 · 设备与工程主管**（原设备岗升任，L4）
- **主责回路**：设备健康、PM 排程、备件。`equipment` 61（写 27）、`maintenance` 28、`spare-parts` 17 + `spareparts` 前端、`pm_*`、`equipment_*`；门 `return_machine_to_service`、`issue_spare`。
- **使命**：设备可用率由预防决定，不由抢修决定；缺料告警必须提前于停线。
- **KPI**：故障停机时长、PM 按期完成率、备件缺料导致停机数。
- **四力**：学习＝误判故障与漏判案例｜沉淀＝`ve/MAINTENANCE-VIRTUAL-01/*`（设备实际劣化曲线）｜研判＝告警 + 保养记录 + 备件库存 + 站机数据｜推理＝故障树逐步排除，禁止"可能是"。
- **现状**：仅前端文案；`maintenance.js` 28 条路由此前无归属。

### 7.1 STATION-EQUIP-VIRTUAL-01 · 站机群虚拟员工（AOI/ICT/FCT/ATE，新增）
- **使命**：每台站机的程序版本、条码规则、复判结果与 MES 一致；不一致即拦下并报工程。
- **输入 / 动作 / 禁止**：`station` 76（写 37）、`aoi-api` 服务、`cfg_station_skill`、`aoi` 前端、8 个 3D 站机看板；可 `PROGRAM_VERSION_CHECK`、`BARCODE_RULE_SYNC`、`REJUDGE_MONITOR`。门 `change_station_program`、`clear_alarm_on_device`。
- **KPI**：程序版本一致率、误报复判率、站机离线时长。
- **四力**：学习＝复判翻转案例｜沉淀＝`ve/STATION-EQUIP-VIRTUAL-01/*`（各站误判特征）｜研判＝站机结果 + 程序版本 + 缺陷图像特征｜推理＝误判归因链（程序→硬件→物料→判据）。
- **现状**：无；站机侧只有 `cfg_station_skill` 表，无员工消费它。

### 7.2 REPAIR-VIRTUAL-01 · 维修与返工虚拟员工（新增）
- **使命**：每件返工品有原因码、工时的责任工位，二次不良可追到第一次返工。
- **输入 / 动作 / 禁止**：`repair` 31（写 15）、`rework` 11、`ng_*`、`rma_*`；可 `REPAIR_TRIAGE`、`REWORK_ROUTE`、`WARRANTY_JUDGE`。门 `scrap_decision`、`rework_twice`、`rma_approve`。
- **KPI**：一次修复率、二次返工率、返工工时准确率。
- **四力**：学习＝重复返工与误报废案例｜沉淀＝`ve/REPAIR-VIRTUAL-01/fault-signatures`｜研判＝缺陷码 + 历史同型 + 站位与人员｜推理＝返工次数上限判定链，超限强制转 MRB 人工评审。
- **现状**：无归属；`repair` 31 条路由是全系统第 14 大写入面。

---

## 8. D6 商务与财务部

主管 **FINANCE-VIRTUAL-01 · 商务财务主管**（原财务岗升任，L4）
- **主责回路**：三单匹配、成本差异、供应商欠款对账。`finance` 41（写 13 读 28）、`erp` 15、`supplier-debt-hooks.js`；门 `approve_payment`、`approve_scrap_value`。
- **使命**：钱货两清有凭据，付款前必须完成 PO—收货—发票三方一致；差异先解释后放行。
- **KPI**：匹配通过率、差异金额回收率、付款前置校验拦截数。
- **四力**：学习＝被驳回付款与差异案例｜沉淀＝`ve/FINANCE-VIRTUAL-01/*`（供应商发票习惯与税率口径）｜研判＝PO + 收货 + 发票 + 合同 + 汇率（含 `_import`/`_export`/`_intrastat`）｜推理＝三方匹配逐步比对，缺一不付；欠款账龄链可回溯。
- **现状**：仅前端文案；`finance.js` 与 `supplier-debt-hooks.js` 此前无归属。

### 8.1 SALES-VIRTUAL-01 · 销售订单与交期虚拟员工（新增）
- **使命**：报价到订单的每一句交期承诺都落到计划；没排产就不承诺交期。
- **输入 / 动作 / 禁止**：`sales` 16（写 11）、`order` 16、`customer_*`、`pmc` 承诺；可 `ORDER_VALIDATE`、`DELIVERY_REPLY`、`QUOTATION_TRACK`。门 `quote_price`、`commit_delivery`、`accept_over_terms`。
- **KPI**：交期回复准确率、订单变更率、承诺达成率。
- **四力**：学习＝交期违约与订单变更案例｜沉淀＝`ve/SALES-VIRTUAL-01/customer-profiles`（须署名与脱敏）｜研判＝客户历史 + 计划产能 + 物料在途｜推理＝交期推算链，无计划依据一律回"待确认"。
- **现状**：无。交期承诺目前完全由人凭印象回复。

### 8.2 E-INVOICE-VIRTUAL-01 · 电子发票虚拟员工（新增）
- **使命**：越南税务合规不是效率问题而是法律风险；红冲必须有原始单据链。
- **输入 / 动作 / 禁止**：`einvoice` 前端模块 + `finance` 发票表；可 `INVOICE_PREPARE`、`TAX_CODE_CHECK`、`RED_REVERSAL_DRAFT`、开票时限监控。门 `issue_invoice`、`red_reversal`。
- **KPI**：开票及时率、税率校验拦截数、红冲比例。
- **四力**：学习＝被税务退回案例｜沉淀＝`ve/E-INVOICE-VIRTUAL-01/tax-rules`（注明生效日期）｜研判＝发票要素 + 税码 + 收货与付款状态｜推理＝开票合规链，任一环不满足即停并说明具体条款。
- **现状**：无。唯一具有法律后果的岗位，缺位代价最高。

---

## 9. D7 行政与人事部

主管 **HR-VIRTUAL-01 · 行政人事主管**（新增，L4）
- **主责回路**：员工主数据、考勤、排班、技能资质。`hr` 198（写 99，与 `wms` 并列最大写入面）、`emp` 10、`md` 10、`cfg_skill`、`hr_responsibility_acknowledgements`、`team_members`/`team_shifts`；门 `approve_leave`、`change_payroll`、`hire`、`terminate`。
- **使命**：技能矩阵决定谁能在哪个站位上岗；资质不符的人不能上岗。
- **KPI**：资质不符上岗数（0）、考勤异常闭环率、排班冲突数。
- **四力**：学习＝排班冲突与资质误放行案例｜沉淀＝`ve/HR-VIRTUAL-01/skill-matrix`（敏感，只沉淀结论不沉淀个人明细）｜研判＝技能证书 + 考勤 + 站位需求 + 班次｜推理＝上岗资格判定链，拒绝必给缺失项。
- **现状**：完全无人归属，是最大的组织漏洞。红线：敏感人事数据不入向量记忆，仅岗位命名空间且默认脱敏。

### 9.1 OA-DOCUMENT-CONTROL-VIRTUAL-01 · OA 文控协调虚拟员工
- **使命**：审批包齐了才通知 WMS 放行；不得代任何人员批准、拒签、签字或发料。
- **输入 / 动作 / 禁止**：`oa` 16、`oa_controlled_documents`、`oa_document_approval_steps`、`notices.js`、`oa-integration.js`；可分类、路由、催办、超时升级、证照校验、受控文件发布预案。门 `approve_document`、`reject_document`、`sign_for_human`、`skip_required_step`、`publish_without_approval`、`external_distribution`、`execute_material_issue`。
- **KPI**：审批包平均时长、超时率、必签文件缺失拦截数。
- **四力**：学习＝超时与缺签案例｜沉淀＝`ve/OA-DOCUMENT-CONTROL-VIRTUAL-01/route-rules`｜研判＝节点 + 角色必签 + 证照有效期｜推理＝审批链完整性校验，缺签不得进入下一步。
- **现状**：注册表有完整 `humanGates`，但服务端只有 PDA 签名事件写了一次事件表，其余无归属。

### 9.2 SAFETY-VIRTUAL-01 · 安全虚拟员工（新增）
- **使命**：隐患不过夜；未闭环隐患影响范围必须公示到人到站位。
- **输入 / 动作 / 禁止**：`safetyManager` 前端模块；可巡检记录、隐患分级、整改跟踪。门 `unlock_hazard_area`、`resume_work_after_incident`。
- **KPI**：隐患闭环率、超期未整改数、重复隐患数。
- **四力**：学习＝重复隐患与误解锁案例｜沉淀＝`ve/SAFETY-VIRTUAL-01/hazard-patterns`｜研判＝隐患历史 + 站位 + 班次 + 设备状态｜推理＝分级处置链，严重隐患强制升级人类，不自我判定"可继续生产"。
- **现状**：无。

---

## 10. D8 平台与 IT 部

主管 **APP-OPS-VIRTUAL-01 · 应用运维主管**（L4）
- **主责回路**：服务健康、错误分级、作业监控（8080 / 5178 / 8098 / 5179 / 5432 / 9876 / 3000-3001 / 1880 / 9090 等服务面）。门 `restart_production_service`、`data_mutation`。
- **KPI**：可用性、告警噪声率、误告警占比。
- **四力**：学习＝误告警与漏告警案例｜沉淀＝`ve/shared/ops-runbooks`（须可执行且可回滚）｜研判＝日志 + 指标 + 发布记录 + 依赖拓扑｜推理＝故障定位链（服务→依赖→数据→外部），每步可回放；`harness/.results` 与 gate 输出为合法证据源。
- **现状**：仅注册；运维面（含 `watchdog`、`realtime`、`worker`、`replication`）此前完全无人负责。

### 10.1 INFRA-VIRTUAL-01 · 基础设施虚拟员工｜门 `firewall_change`、`server_reboot`
- 使命：远端 7 个 compose 服务（`smt-web`/`api`/`postgres`/`metabase`/`grafana`/`nodered`/`prometheus`）与网络的健康与容量。四力：学习＝容量与网络误判案例｜沉淀=`ve/INFRA-VIRTUAL-01/topology`｜研判＝主机指标 + 容器健康 + `pg_hba.conf` 与网络段事实｜推理＝容量趋势外推与告警归因（例：`172.18.0.0/16` 缺 `scram-sha-256` 条目导致登录失败）。

### 10.2 DATABASE-VIRTUAL-01 · 数据库虚拟员工｜门 `schema_change`、`restore_database`、`delete_data`
- 使命：模式一致性与迁移守门，环境差异（本地约 1336 表 vs 生产 1238 表）必须在上线前暴露。四力：学习＝慢查询与迁移回滚案例｜沉淀=`ve/DATABASE-VIRTUAL-01/schema-drift`｜研判＝`pg_stat` + 迁移账本 + `check:migrations` 结果｜推理＝迁移前 `--plan` 推演，append-only 违规直接阻断；禁止在生产执行未验证 DDL。

### 10.3 INTEGRATION-VIRTUAL-01 · 系统集成与数据质量虚拟员工（兼数据质量）｜门 `external_write`、`mapping_change`、`bulk_correction`
- 使命：接口契约一致、跨系统数据可信；`rjvn_*` 镜像与 `wms-parity.js`、`wms-graft.js` 的比对结果有人负责。四力：学习＝契约不符与镜像漂移案例｜沉淀=`ve/INTEGRATION-VIRTUAL-01/contracts`｜研判＝请求样例 + 契约 + 双边行数与字段分布｜推理＝漂移归因链（源→映射→时序→约束）。红线：不得为"让比对通过"而修改基线文件（`schema-drift-baseline.json`）。

### 10.4 SECURITY-VIRTUAL-01 · 账号与密钥安全虚拟员工｜门 `disable_account`、`rotate_secret`
- 使命：最小权限 + 密钥扫描 + 异常访问告警，守住 `check:auth-order`、`route-shadowing` 与密钥泄露三条线。四力：学习＝误放行与越权尝试案例｜沉淀=`ve/SECURITY-VIRTUAL-01/patterns`（脱敏）｜研判＝访问日志 + 权限矩阵 + 令牌面｜推理＝越权推断链，禁止仅凭"频率高"定异常。红线：只报告路径与环境变量名，绝不读取或回显值。

### 10.5 PDA-FLEET-VIRTUAL-01 · PDA 设备群虚拟员工｜门 `remote_device_control`、`apk_rollout`
- 使命：每台 PDA 的角色、版本、打印与通信状态可信；离线不得被记成"无差异"。四力：学习＝离线误判与打印失败案例｜沉淀=`ve/PDA-FLEET-VIRTUAL-01/devices`｜研判＝心跳 + 角色配置（`pdaRole.ts`）+ APK 版本 + 打印健康｜推理＝通信链路分段定位（设备→网络→API→打印），`pdaCommMonitor` 为证据源。

### 10.6 BACKUP-VIRTUAL-01 · 备份与恢复虚拟员工｜门 `production_restore`、`delete_backup`
- 使命：备份必须可验证、可演练；恢复时长以演练实测值为准，不以理论值承诺。四力：学习＝备份校验失败与演练超时案例｜沉淀=`ve/BACKUP-VIRTUAL-01/drills`｜研判＝备份清单 + 校验结果 + 保留策略｜推理＝RPO/RTO 推导链；红线：未演练不承诺恢复时间。

### 10.7 RELEASE-VIRTUAL-01 · 发布虚拟员工（兼 UI 回归）｜门 `production_deploy`、`database_migration`、`release_ui`
- 使命：发布必须绿门才走（`check:migrations`、`check:auth-order`、`check:route-census` 不减、`check:route-shadowing`、`test:grade`），设计系统变更不得静默扩散。四力：学习＝回滚与失败发布案例｜沉淀=`ve/RELEASE-VIRTUAL-01/release-notes`、`ve/shared/ui-regression-baseline`（截图基线）｜研判＝CI 结果 + 差异 + 迁移计划｜推理＝发布判定链（门→镜像→切换→观察→回滚判据），与 `factory/gate.py`、`.factory/` 台账对齐。

### 10.8 REPORTS-VIRTUAL-01 · 指标与看板虚拟员工（新增）
- 使命：指标口径唯一、可解释、可追溯；每个对外数字能说出定义、来源、过滤与时间窗。四力：学习＝口径争议与被质疑指标｜沉淀=`ve/REPORTS-VIRTUAL-01/metric-definitions`（指标字典）｜研判＝Metabase/Grafana 视图 + 表血缘 + 定义｜推理＝指标下钻链（总览→明细），血缘断裂即标"不可解释"而非直接出数。
- 现状：无归属；`reports` 22 + `report` 13 + `manager` 14 + `exec` 37 条路由此前无人负责，是"数字对不上但没人能解释"的根源。

---

## 11. 停用占位（`enabled: false`，不占模型预算、不产生任务）

| 占位 ID | 何时启用 | 判据 |
|---|---|---|
| `MRB-VIRTUAL-01` 报废评审 | 报废单据 >20 张/日 或 `approve_scrap` 队列积压 | 现由 `QUALITY-VIRTUAL-01` 主管兼，但主管兼裁判与申报两角，量一大即冲突 |
| `LINE-CADENCE-VIRTUAL-01` 自动线·手动线节拍 | 自动线并入 `auto-line.js`/`manu-line.js` 出现跨线仲裁需求 | 现由 `MES-VIRTUAL-01` 主管兼 |
| `SPARE-PARTS-VIRTUAL-01` 备件 | 备件缺料导致停机 ≥1 次/周 | 现由 `MAINTENANCE-VIRTUAL-01` 主管兼 |
| `SUPPLIER-CLAIM-VIRTUAL-01` 退货与索赔 | 退货单据 >10 张/月 | 现并入 `SUPPLIER-COLLAB-VIRTUAL-01` |
| `SUPPLIER-DEBT-VIRTUAL-01` 供应商欠款 | 账龄异常供应商 >5 家 | 现并入 `FINANCE-VIRTUAL-01` 主管 |
| `DATA-QUALITY-VIRTUAL-01` 数据质量 | `wms-parity` / `schema-drift` 比对连续 2 期红 | 现并入 `INTEGRATION-VIRTUAL-01`（原注册条目降级为占位） |
| `UI-DESIGN-QA-VIRTUAL-01` UI 设计与回归 | 设计系统变更频次 >2 次/周 | 现并入 `RELEASE-VIRTUAL-01`（原注册条目降级为占位；其 `skills` 列表随之转移） |

说明：`DATA-QUALITY-VIRTUAL-01` 与 `UI-DESIGN-QA-VIRTUAL-01` 是**现有注册条目的降级**，不是删除——保留 ID 是为了历史 `tasks` / `events` / `training_runs` 的外键不断链。

---

## 12. 四力的落地缺口（先修这些，否则说明书只是纸）

| 能力 | 已有 | 缺 |
|---|---|---|
| 自学习 | `training_cases` / `training_runs` / `evaluations` 三张表 + 4 条路由（`/training-cases`、`/training-cases/:caseId/runs`、`/training-runs/:runId/review`、`/evaluations`） | **没有任何代码自动生成案例**：纠正与 `REJECTED` 任务不会自己变成案例，全靠人手写，因此实际闭环为 0 |
| 知识沉淀 | `services/memory/memory_server.py`（:9876，`store`/`search`/`search_all`/`get_all`/`delete`）+ Qdrant；`qms_iqc_virtual_memory` | **写入方只有 IQC**；缺 per-employee 命名空间约定、缺"必须带来源"的强制校验、缺过期复核（180 天）机制 |
| 智能研判 | `qms_iqc_virtual_employee_config`（provider/model/base_url/credential_env/timeout/temperature）+ `askIqcLlm` | 缺**统一结论结构**（`evidence[]`/`confidence`/`needs_human`），缺其余 36 岗的模型配置读取路径 |
| 逻辑推演 | `@langchain/langgraph ^1.4.13`，仅 `src/iqc/virtual-employee.js` 使用 | 缺 `graph_id` 字段与 37 个岗位图；缺"结论可回溯到条款"的存储字段 |
| 通用 | `interval_seconds` 已入库（默认 300） | **只有 `WMS-RECEIVING` 有对应 `setInterval`**；无通用 runner 遍历 `FACTORY_VIRTUAL_EMPLOYEES` |
| 门 | `humanGates` 在注册表声明 | **服务端 0 处引用**；强制点需加在 `POST /api/factory/virtual-employees/tasks/:taskId/approve` |
| 身份 | `requirePermission` + JWT（人的令牌） | 无岗位服务身份；`requested_by` 只是字符串，审计链断在"谁做的" |

### 覆盖闭合校验
- 30 个路由模块 → 全部有归属（`mrb`/`mrb-extra`→品质主管；`supplier-return`→协同；`supplier-debt-hooks`→财务主管；`auto-line`/`manu-line`→制造主管；`station-pass`/`station-ops`→制造主管；`wms-counting`/`wms-production`/`wms-receiving-iqc`/`wms-smt-loop`→D1/D3；`wms-parity`/`wms-graft`→集成；`oqc-aql`/`quality-iqc-loop`→D4；`erp-master`/`master-data`→采购/集成；`reports`→`REPORTS-VIRTUAL-01`；`notices`/`oa-integration`→文控/集成；`pda`→PDA 群；`maintenance`/`finance`/`lifecycle`/`pmc`/`qms`/`mesrj`→对应主管）。
- 166 个一级路由域 → 8 部门，无孤儿。
- 37 个前端业务目录 → 全部有归属（`spareparts`→设备主管、`project-mgmt`/`projects`→**唯一未覆盖项**，见下）。

### 已知未覆盖（诚实列出）
`projects` / `project-mgmt` 两个前端模块（项目交付物与验收）目前没有岗位承接：项目验收的责任人是人（销售或厂长），虚拟员工只能盯节点与超期。若要把"项目节点催办"变成岗位，需增设 `PROJECT-VIRTUAL-01`，编制随之 +1（在岗 38 / 45 行）。本说明书按"宁缺毋滥"未设此岗——它是当前唯一被刻意留在空白的域。

### 与上一版的差异
上一轮 43 岗的算法把主管和主管的主责回路各计一次（PMC 既是主管又是一条 MRP 回路），本版把这类合并为"主管兼主责回路"，得到 37 在岗 + 7 占位 = 44 行；同时把 `PACK-VIRTUAL-01` 从仓储移到制造末端、把 `TRACE-VIRTUAL-01` 归入品质并明确"断链不可见"风险、把 `REPORTS-VIRTUAL-01` 补进 D8（此前 `reports`/`report`/`manager`/`exec` 合计 86 条路由无人负责）。

### 验证方式（未跑，仅声明）
本文件是设计交付物，未改动 `registry.js`、未建表、未跑测试。落地顺序仍按前一轮结论：服务身份 → 通用 runner → `humanGates` 服务端强制 → `department`/`reports_to`/四力字段 → 逐岗实现。四力的最小可验证切片是：给 `IQC-VIRTUAL-01`（唯一已具备 LLM + 图 + 记忆三件）加上"纠正自动转训练案例"，用它当样板再复制给其余 36 岗。

---

## 13. 汇报线（谁向谁汇报）

图形版：`docs/virtual-employees/org/virtual-employee-reporting-lines.html`（源 `virtual-employee-reporting-lines.architecture.json`，archify showcase 校验通过 + 1440×900 / 2048×1320 浏览器实测无溢出）。
规则：每个岗位恰好一个直接上级，不存在双线汇报；跨部门协作必须经总监派工，不允许横向自行改派任务。

| 岗位 ID | 名称 | 直接上级 | 是否兼主责回路 | 编制 |
|---|---|---|---|---|
| `OPS-SUPERVISOR-VIRTUAL-01` | 全厂运营虚拟总监 | 人类决策层（厂长） | 派工与仲裁 | 指挥 |
| `WMS-SUPERVISOR-VIRTUAL-01` | D1 来料与仓储主管 | `OPS-SUPERVISOR-VIRTUAL-01` | 否（纯仲裁） | 主管 |
| `WMS-RECEIVING-VIRTUAL-01` | 收料核验 | `WMS-SUPERVISOR-VIRTUAL-01` | 收料核验 | 专职 |
| `WMS-IQC-HANDOFF-VIRTUAL-01` | 来料交接 | `WMS-SUPERVISOR-VIRTUAL-01` | 来料交接 | 专职（新增） |
| `WMS-INVENTORY-VIRTUAL-01` | 上架与库位 | `WMS-SUPERVISOR-VIRTUAL-01` | 上架与库位 | 专职 |
| `WMS-COUNT-VIRTUAL-01` | 循环盘点 | `WMS-SUPERVISOR-VIRTUAL-01` | 循环盘点 | 专职（新增） |
| `WMS-ISSUE-VIRTUAL-01` | 发料与线边配送 | `WMS-SUPERVISOR-VIRTUAL-01` | 发料与配送 | 专职（新增） |
| `MSD-CONTROL-VIRTUAL-01` | 湿敏管控 | `WMS-SUPERVISOR-VIRTUAL-01` | 湿敏管控 | 专职 |
| `PMC-VIRTUAL-01` | D2 计划与采购主管 | `OPS-SUPERVISOR-VIRTUAL-01` | 是：MPS/MRP | 主管 |
| `PURCHASING-VIRTUAL-01` | PO·ASN·ETA 跟单 | `PMC-VIRTUAL-01` | PO 跟单 | 专职 |
| `SUPPLIER-COLLAB-VIRTUAL-01` | 供应商协同与退货 | `PMC-VIRTUAL-01` | 门户协同 | 专职 |
| `MES-VIRTUAL-01` | D3 制造执行主管 | `OPS-SUPERVISOR-VIRTUAL-01` | 是：工单·路线·过站 | 主管 |
| `SMT-LOOP-VIRTUAL-01` | SMT 上料与料盘消耗 | `MES-VIRTUAL-01` | 上料消耗 | 专职（新增） |
| `ANDON-VIRTUAL-01` | 安灯与换线 | `MES-VIRTUAL-01` | 安灯升级 | 专职（新增） |
| `PACK-VIRTUAL-01` | 包装与出货 | `MES-VIRTUAL-01` | 包装出货 | 专职（新增） |
| `QUALITY-VIRTUAL-01` | D4 品质主管 | `OPS-SUPERVISOR-VIRTUAL-01` | 是：NCR/CAPA/MRB | 主管 |
| `IQC-VIRTUAL-01` | 来料检验 | `QUALITY-VIRTUAL-01` | IQC 判定 | 专职 |
| `OQC-VIRTUAL-01` | 出货检验 | `QUALITY-VIRTUAL-01` | OQC/AQL | 专职（新增） |
| `TRACE-VIRTUAL-01` | 追溯与 ECN | `QUALITY-VIRTUAL-01` | 追溯召回 | 专职（新增） |
| `MAINTENANCE-VIRTUAL-01` | D5 设备与工程主管 | `OPS-SUPERVISOR-VIRTUAL-01` | 是：PM 与备件 | 主管 |
| `STATION-EQUIP-VIRTUAL-01` | 站机群（AOI/ICT/FCT/ATE） | `MAINTENANCE-VIRTUAL-01` | 站机一致性 | 专职（新增） |
| `REPAIR-VIRTUAL-01` | 维修与返工 | `MAINTENANCE-VIRTUAL-01` | 返工处置 | 专职（新增） |
| `FINANCE-VIRTUAL-01` | D6 商务与财务主管 | `OPS-SUPERVISOR-VIRTUAL-01` | 是：三单匹配与欠款 | 主管 |
| `SALES-VIRTUAL-01` | 销售订单与交期 | `FINANCE-VIRTUAL-01` | 交期回复 | 专职（新增） |
| `E-INVOICE-VIRTUAL-01` | 电子发票 | `FINANCE-VIRTUAL-01` | 开票合规 | 专职（新增） |
| `HR-VIRTUAL-01` | D7 行政与人事主管 | `OPS-SUPERVISOR-VIRTUAL-01` | 是：主数据与考勤 | 主管（新增） |
| `OA-DOCUMENT-CONTROL-VIRTUAL-01` | 文控协调 | `HR-VIRTUAL-01` | 审批包协调 | 专职 |
| `SAFETY-VIRTUAL-01` | 安全 | `HR-VIRTUAL-01` | 隐患闭环 | 专职（新增） |
| `APP-OPS-VIRTUAL-01` | D8 平台与 IT 主管 | `OPS-SUPERVISOR-VIRTUAL-01` | 是：应用运维 | 主管 |
| `INFRA-VIRTUAL-01` | 基础设施 | `APP-OPS-VIRTUAL-01` | 主机与网络 | 专职 |
| `DATABASE-VIRTUAL-01` | 数据库 | `APP-OPS-VIRTUAL-01` | 模式与迁移 | 专职 |
| `INTEGRATION-VIRTUAL-01` | 系统集成与数据质量 | `APP-OPS-VIRTUAL-01` | 契约与比对 | 专职（兼数据质量） |
| `SECURITY-VIRTUAL-01` | 账号与密钥安全 | `APP-OPS-VIRTUAL-01` | 访问审计 | 专职 |
| `PDA-FLEET-VIRTUAL-01` | PDA 设备群 | `APP-OPS-VIRTUAL-01` | 设备心跳 | 专职 |
| `BACKUP-VIRTUAL-01` | 备份与恢复 | `APP-OPS-VIRTUAL-01` | 备份校验 | 专职 |
| `RELEASE-VIRTUAL-01` | 发布与 UI 回归 | `APP-OPS-VIRTUAL-01` | 发布判定 | 专职（兼 UI 回归） |
| `REPORTS-VIRTUAL-01` | 指标与看板 | `APP-OPS-VIRTUAL-01` | 指标字典 | 专职（新增） |

### 13.1 停用占位的上级与启用归属

| 占位 ID | 挂靠上级 | 启用后汇报给 |
|---|---|---|
| `MRB-VIRTUAL-01` | `QUALITY-VIRTUAL-01` | `QUALITY-VIRTUAL-01`（主管须让出主责回路，避免自审自评） |
| `LINE-CADENCE-VIRTUAL-01` | `MES-VIRTUAL-01` | `MES-VIRTUAL-01` |
| `SPARE-PARTS-VIRTUAL-01` | `MAINTENANCE-VIRTUAL-01` | `MAINTENANCE-VIRTUAL-01` |
| `SUPPLIER-CLAIM-VIRTUAL-01` | `PMC-VIRTUAL-01` | `PMC-VIRTUAL-01`（与 `SUPPLIER-COLLAB-VIRTUAL-01` 同部门不同责） |
| `SUPPLIER-DEBT-VIRTUAL-01` | `FINANCE-VIRTUAL-01` | `FINANCE-VIRTUAL-01` |
| `DATA-QUALITY-VIRTUAL-01` | `APP-OPS-VIRTUAL-01` | 启用后自 `INTEGRATION-VIRTUAL-01` 拆出 |
| `UI-DESIGN-QA-VIRTUAL-01` | `APP-OPS-VIRTUAL-01` | 启用后自 `RELEASE-VIRTUAL-01` 拆出（含其 `skills` 列表） |

### 13.2 落库形态
`database/migrations/324_virtual_employee_reporting_system.sql` 建 `ve_reporting_lines(employee_id, department, reports_to, owns_loop, staffing, enabled)`，`registry.js` 同步补 `department` / `reportsTo`；总监的 `reports_to` 为 `'HUMAN'`，是表内唯一非虚拟员工上级。校验口径：除该行外，每个 `enabled` 岗位的 `reports_to` 必须能在同表找到且 `staffing IN ('主管','指挥')`，禁止悬空与环（报告 `integrity` 实时出结果）。

---

## 14. 人工门的强制执行（已实现）

之前 `humanGates` 只是注册表里的数组，服务端 0 处引用。现在由两个文件把门接上：

| 文件 | 作用 |
|---|---|
| `services/api/src/virtual-employees/service-identity.js` | `mintServiceToken` / `verifyServiceToken`（HMAC 派生自 `JWT_SECRET`，不新增环境变量）、`serviceActorFor`、`validateGateForApproval`、`humanDomainPermission` |
| `services/api/src/routes/virtual-employees.js` | `POST /:id/service-token`（按域权限签发）、`POST /:id/tasks`（接受 `x-ve-token`，审计 `requested_by=ve:<id>`）、`POST /tasks/:taskId/approve`（硬校验门） |

强制顺序：任务存在 → 状态为 `WAITING_APPROVAL` → `requires_human=true` → `human_gate` 非空 → `gate ∈ employee.humanGates` → 审批人必须是人类且持有该域写权限 → 才 UPDATE 成 `OPEN` 并写 `HUMAN_APPROVED` 事件。任何一步失败都拒绝，错误码分别是 `TASK_NOT_FOUND` / `TASK_NOT_WAITING` / `NOT_A_HUMAN_GATE` / `GATE_NOT_SPECIFIED` / `EMPLOYEE_NOT_FOUND` / `GATE_NOT_REGISTERED` / `VE_CANNOT_APPROVE` / `FORBIDDEN`。

权限键取自真实角色目录（admin 实际持有）：`wms.execute`、`finance.manage`、`procurement.manage`、`qms.execute`、`quality.write`。**旧的 `requirePermission('wms.edit')` 连 admin 都没有**，`/putaway-recommendations` 等路由因此实际不可用——这是既有问题，本次未改。

实测（独立 API 实例 :8082，2026-11-20）：签 token 200、VE 建任务 201 且 `requested_by=ve:WMS-RECEIVING-VIRTUAL-01`、VE 自批 403 `VE_CANNOT_APPROVE`、篡改 token 403 `VE_TOKEN_INVALID`、人类持 `wms.execute` 批准 200、重复批准 409 `TASK_NOT_WAITING`、伪造门 `invented_gate` 409 `GATE_NOT_REGISTERED`。单元测试 8 例通过；全量单测 372 通过 / 2 跳过；静态门 `REGISTER_DEPS_OK`、`ROUTE_CENSUS_OK (+7)`、`AUTH_ORDER stranded=0`、`ROUTE_SHADOWING 10/10`、`API_TYPES` 无 virtual-employees 报错。

边界：没有自动批准那 183 条存量任务——批准与否是业务决定，工具只保证"批得过的一定合法"。其他写端点（如收料确认本身）尚未接同一门校验，目前只覆盖 `/tasks/:taskId/approve`。服务令牌 scope 仅 `task:create`，TTL 60–86400 秒。

---

## 15. 岗位频率（按任务性质）

机器可读配置：`services/api/src/virtual-employees/frequencies.js`（`FREQUENCIES` / `cadenceFor(id)` / `validateFrequencies()`）。测试：`tests/virtual-employee-frequency.test.mjs`（12 例与门控测试同批通过）。

### 15.1 四种频率性质

| 性质 | 含义 | 适用任务 | 判据 |
|---|---|---|---|
| `EVENT` 事件驱动 | 业务事件到达即触发，不轮询 | 有明确输入的动作：收料、交接、过站、收料差异、安灯、审批包、隐患 | 事件有天然起点；延迟可从事件时间算起 |
| `WATCH` 连续监控 | 固定间隔做确定性检查，只有越阈值才唤醒模型 | 随时间恶化的状态：库存、湿敏寿命、设备、站机、服务、PDA 心跳 | 漏检代价随等待时间增长 |
| `BATCH` 周期批处理 | 固定本地时间窗（越南 UTC+7） | 全量对账/计划/盘点/备份/报表 | 需要全量快照，不能被事件切碎 |
| `DEMAND` 按需 | 人或别的岗位请求时运行 | 追溯召回、ECN 影响面、发布 | 高风险、低频，禁止轮询生产 |

**关键区分：频率 ≠ 模型调用频率。** 高频检查（60 秒）是确定性规则或 SQL，只有阈值跨越/事件命中才调用模型；每岗模型调用硬上限 20 次/日，来自审批吞吐实测（约 30 单/人/日，留出门余量）。`factory_virtual_employee_configs.interval_seconds` 有 `CHECK(>=60)`，故 WATCH 最小 60 秒；更细的巡检交给已有 watchdog（30 秒级），不塞进员工层。

### 15.2 逐岗频率

| 岗位 | 性质 | 触发 / 间隔 | 时间窗或延迟上限 | 模型/日 | 依据 |
|---|---|---|---|---|---|
| `OPS-SUPERVISOR` | EVENT | `TASK_ESCALATED` / `KPI_BREACH`，兜底 300s | 30s | 20 | 派工必须即时；KPI 5 分钟扫一次 |
| `WMS-SUPERVISOR` | EVENT | `D1_QUEUE_CONFLICT`，兜底 300s | 60s | 10 | 只在争单/冻结冲突时仲裁 |
| `WMS-RECEIVING` | EVENT | `INCOMING_RECORD_CREATED` / `ASN_CONFIRMED`，兜底 300s | 60s | 20 | PDA 扫码事件；保留现有 300s 兜底定时器 |
| `WMS-IQC-HANDOFF` | EVENT | `RECEIVING_COMPLETED` | 60s | 20 | 每批收料完成即交接 |
| `WMS-INVENTORY` | WATCH | 300s | 300s | 20 | 安全库存/库位冲突随时间恶化 |
| `WMS-COUNT` | BATCH | `0 22 * * *` | 22:00 每日 | 5 | 班次结束盘点 |
| `WMS-ISSUE` | EVENT | `PICK_REQUESTED` / `PACKAGE_UNRECEIVED`，兜底 300s | 120s | 20 | 配送请求 + SLA 超时 |
| `MSD-CONTROL` | WATCH | 60s | 60s | 5 | 车间寿命按分钟，阈值才调模型 |
| `PMC` | BATCH | `0 6 * * 1-6` | 06:00 周一至六 | 10 | MRP 每日全量 |
| `PURCHASING` | EVENT | `PO_CONFIRMED` / `ASN_UPDATED` / `ETA_CHANGED`，兜底 900s | 300s | 20 | 跟单事件 + 工作时段汇总 |
| `SUPPLIER-COLLAB` | BATCH | `0 * * * *` | 每小时 | 10 | 门户批量对齐 |
| `MES` | EVENT | `WORK_ORDER_RELEASED` / `STATION_PASS`，兜底 300s | 30s | 20 | 过站近实时，判定走确定性规则 |
| `SMT-LOOP` | EVENT | `FEEDER_CHANGED` / `REEL_CONSUMED`，兜底 300s | 60s | 20 | 按站机换料节拍 |
| `ANDON` | EVENT | `ANDON_CALLED` | 15s | 5 | 呼叫即升级，不靠模型检测 |
| `PACK` | EVENT | `ORDER_READY_TO_PACK`，兜底 900s | 300s | 10 | 按订单，非连续动作 |
| `QUALITY` | EVENT | `NCR_OPENED` / `CAPA_DUE`，兜底 600s | 300s | 20 | 不合格闭环事件 |
| `IQC` | EVENT | `LOT_HANDED_TO_IQC`，兜底 300s | 120s | 20 | 逐批判定，唯一 ACTIVE_EXECUTOR |
| `OQC` | EVENT | `BATCH_READY_FOR_OQC`，兜底 600s | 300s | 20 | AQL 按出货批 |
| `TRACE` | DEMAND | `TRACE_QUERY` / `ECN_SUBMITTED` / `RECALL_REQUEST` | 按需 | 5 | 高风险低频，禁止轮询 |
| `MAINTENANCE` | WATCH | 300s | 300s | 10 | 设备健康随时间恶化 |
| `STATION-EQUIP` | WATCH | 60s | 60s | 5 | 站机程序/复判每分钟，异常才调模型 |
| `REPAIR` | EVENT | `NG_RECORDED` / `REWORK_OPENED`，兜底 600s | 120s | 10 | 按不良事件分诊 |
| `FINANCE` | BATCH | `0 18 * * 1-6` | 18:00 周一至六 | 10 | 三单匹配按日对账 |
| `SALES` | EVENT | `ORDER_CREATED` / `DELIVERY_PROMISE_REQUEST`，兜底 1800s | 300s | 10 | 交期按需 + 工作时段扫描 |
| `E-INVOICE` | EVENT | `SHIPMENT_CONFIRMED` / `INVOICE_REQUIRED`，兜底 1800s | 300s | 10 | 按出货开票 + 每日查漏 |
| `HR` | BATCH | `30 7 * * 1-6` | 07:30 周一至六 | 5 | 班前处理考勤排班 |
| `OA-DOCUMENT-CONTROL` | EVENT | `DOCUMENT_SUBMITTED` / `APPROVAL_STEP_DONE`，兜底 300s | 120s | 20 | 与已有 5 分钟 SLA monitor（`server.js:22097`）对齐 |
| `SAFETY` | EVENT | `HAZARD_REPORTED`，兜底 300s | 60s | 5 | 隐患即刻分级，严重项升级人类 |
| `APP-OPS` | WATCH | 60s | 60s | 5 | 员工层 60s（DB 下限），watchdog 30s 级巡检 |
| `INFRA` | WATCH | 60s | 60s | 5 | 主机/网络/容器按分钟 |
| `DATABASE` | WATCH | 300s | 300s | 5 | 慢查询/复制 5 分钟，模式漂移每日 03:00 |
| `INTEGRATION` | WATCH | 300s | 300s | 5 | 契约/镜像比对，连续两期红才升级 |
| `SECURITY` | WATCH | 300s | 300s | 5 | 访问审计 5 分钟，密钥扫描每日 01:00 |
| `PDA-FLEET` | WATCH | 60s | 60s | 5 | 与 `pdaCommMonitor` 心跳对齐 |
| `BACKUP` | BATCH | `30 2 * * *` | 02:30 每日，周日演练 | 5 | 备份校验按日、恢复演练按周 |
| `RELEASE` | DEMAND | `GATE_PASSED` / `DEPLOY_REQUESTED` | 按需 | 5 | 只在发布门通过时运行 |
| `REPORTS` | BATCH | `0 * * * *` | 每小时刷新，07:00 日报 | 5 | 指标字典按需查 |

7 个停用占位不排频率；启用时按同部门同类任务继承，并在 `enable` 前复评模型预算。

### 15.3 尚未接线（明确边界）
`frequencies.js` 是**规格与校验器**，尚未写回 `factory_virtual_employee_configs.interval_seconds`，也未被通用 runner 消费。把规格写回 DB 是对既有行的 `UPDATE`（不是 schema 迁移），需在本地用带 `--plan` 的脚本预览、经人工批准后再执行；在那之前 37 岗里仍只有收料有真实定时器，默认 300 秒值对多数岗位是错的。

---

## 16. 从早期文档继承的规则（补齐，不重写）

来源：`HERMES-OPS-SUPERVISOR-PROMPTS.md`、`WMS-RECEIVING-VIRTUAL-01.md`、`OA-DOCUMENT-CONTROL-VIRTUAL-01.md`、`OA-VIRTUAL-EMPLOYEE-CONTROLLED-DOCUMENTS.md`、`REPLENISHMENT-PURCHASING-OA-GUIDE.md`。这些材料保留为历史档案；下列规则被当前组织**正式继承**，与旧表述冲突时以本节为准。

### 16.1 全员通用（补 §1 四力）

| 规则 | 内容 |
|---|---|
| 告警分级 | `P1` 资料缺失不挡计划→只进待办；`P2` 接近时限/安全库存→岗位负责人；`P3` 预计缺料、交期、质量或 MSD 风险→部门主管；`P4` 停线、库存误释放、隔离失败、安全或数据完整性事故→工厂管理层并持续跟踪。P1 默认不发微信；状态未变不重复通知；发送失败保留站内告警并记原因 |
| 唯一主责 tie-break | 跨域事件按"最先能够改变当前风险状态的岗位"定主责，其余只能是协作者并写明输入/交付物；禁止多个主责 |
| 有限重试 | 自动重试最多 3 次、递增间隔，之后转人工；禁止无限催办与重复建单；同一根因合并处理 |
| 审批摘要六要素 | 具体动作（多个高风险决定不得合并成一项）· 原因与来源证据 · 数量/金额/物料/批次影响范围 · 不批或延迟的后果 · 可选方案差异 · 批准有效期。聊天中的模糊同意、模型判断或历史批准都不能代替本次审批 |
| 受控文件版本 | 任务开始前按员工编号/域/任务类型查 OA `PUBLISHED` 的当前有效文件；强制文件缺失、过期或校验失败即停止并报警；任务记录写入文件编号+版本；Excel 参数先校验字段/单位/范围/重复值；历史任务保留原版本引用；虚拟员工无权批准或发布自己的规则 |
| 事实来源 | PostgreSQL 是正式业务事实；库存只能由 `inventory_transactions` 推导；记忆只存经验与人工纠正；没有流水的物料列为数据缺口，不得用零库存冒充 |

### 16.2 岗位细化

| 岗位 | 继承规则 |
|---|---|
| `WMS-RECEIVING` | 六步流：`RECEIVING_VALIDATE → LABEL_PLAN → PRINT → LOCATION_BIND → RECEIVING_CONFIRM → IQC_HANDOFF`；MSL 由 WMS 主数据解析，PDA 只采集不判定；箱 QR 与仓位 QR 必须实际扫描绑定，未绑定不得确认；完成后 `IQC_PENDING`、库存 HOLD、IQC 队列可读。**完成定义**：PO/供应商/物料/批次/数量已验证 + 唯一箱 QR 已打印 + MSL 已解析 + 箱码绑定仓位 + 审计完整 + IQC 队列可读。KPI：资料完整率 ≥99.5%、箱 QR 唯一率 100%、绑定率 100%、对账准确率 ≥99.9%、收料到 IQC ≤5 分钟、未批准库存释放 0、异常通知 ≤1 分钟 |
| `WMS-INVENTORY` | 库位硬性顺序：启用/未锁/允许上架 → Hold 只进收货或 IQC Hold 区、不合格只进隔离区、已放行不得进 Hold → MSL/温湿度 → 数量/托盘数/长宽高容量 → 全过后按同物料集中、35%–85% 利用率、最短安全路径评分 → 扫描库位 QR 确认。人工改位须重跑硬性规则，绕过需 `override_putaway_rule`。无承重上限与道路拓扑时返回 `LOCATION_WEIGHT_LIMIT_NOT_CONFIGURED`，只给直线距离，不伪造叉车路线。安全库存报告每 6 小时（`WAREHOUSE_SAFETY_REPORT_INTERVAL_MS`，最短 5 分钟），稳定任务键防重复，接收方采购/PMC/Hermes |
| `PURCHASING` + `PMC` | 补货公式 `max(0, 目标库存 − 可用库存 − 已确认在途)`；目标库存优先最高库存，依次退到安全/最低；在途只算已发布、已确认或部分收货 PO 的未收量；Hold、待 IQC、报废、冻结、过期不计入可用；MOQ 与包装倍数向上取整；缺流水/供应商映射/MOQ/价格/币种即阻断。职责分离：库存员工算建议 → 采购按已批准供应商关系起草合同 → PMC 确认需求/停线风险 → 采购主管（高金额加财务经理）→ 工厂负责人最终批准 → 才生成 PO 并同步门户；采购不得改库存数量 |
| `OA-DOCUMENT-CONTROL` | SLA：已用 75% 提醒当前签核人；首次超时警告签核人+直属主管；超 4 小时升级厂长/OA 负责人/Hermes；超 24 小时升级高级经理且 WMS 保持锁定。状态机 `DRAFT → ROUTE_READY → PENDING_APPROVAL → APPROVED → WMS_RELEASE_NOTIFIED`；退回走新版本，拒绝保留原包不硬删。**物料领料审批复用本员工，不另设 WMS 审批虚拟员工**：OA 管审批包，WMS 管库存流水和实际发料 |
| `OPS-SUPERVISOR` | P3/P4 事件 60 秒复查且状态不变不重复通知；交班/日报按 P4/P3 未关闭 → 24/48/72 小时风险 → 待批与超时审批 → 关键变化 → 设备质量数据异常 → 已关闭及证据 → 下一班前三动作输出，每项带负责人、截止时间、业务对象编号；正常巡检 300 秒；温度 0.1–0.2；初始只开放查询/任务/草稿/审批/通知 |
| 全部 runner | 每次工具调用记录任务 ID、员工 ID、输入摘要、结果、耗时、错误；Hermes 只接收完成判断所需的最小上下文 |

### 16.3 继承后的两处调整

1. `WMS-INVENTORY` 的 300 秒 `WATCH` 是巡检节奏，安全库存**报告**是独立的 6 小时批次，已写入 `frequencies.js` 的 `secondary`。
2. OA 受控文件规范补上了四力中"逻辑推演"缺的一环：结论回指的文件编号与版本必须取自 OA `PUBLISHED` 文件，而不是提示词文本。Agent 接口层需提供 `controlled_doc_lookup` 工具——已加入计划的工具映射待办。

---

## 17. 自学习与领域知识收集（已实现并跑通）

复用**人类培训体系**已有的三张表，不另造训练库、不新增迁移：`factory_virtual_employee_training_cases` / `_training_runs` / `_evaluations`。

### 17.1 自学习闭环（四力 1.1）

代码：`services/api/src/agent/learning.js`，CLI `npm run learn:ve`。

```
人类对任务的决定（事件 HUMAN_APPROVED / HUMAN_REJECTED / HUMAN_CORRECTED / LOW_CONFIDENCE_ESCALATED）
   → 自动生成 training_case：status='DRAFT'，created_by='ve:<id>'，title='AUTO:<eventId>:<eventType>'
   → 自动写 training_run：result='WAITING_REVIEW'，score=确定性就绪分
   → 事件 TRAINING_CASE_CREATED（actor=ve:<id>）
   → 人工评审：--review=<runId> --reviewer=<人> --pass
        通过 → case.status='APPROVED' + approved_by=人，run.result='PASSED'
        拒绝 → run.result='FAILED'，case 保持 DRAFT
   → 事件 TRAINING_REVIEWED（actor=人）
```

`score` 是**确定性结构分**，不是模型自评：基线 40 + 有人工门 20 + 独立证据 ≥2 条 20 + 有 task_type 20，上限 100。它只决定"这条案例值不值得人看"。

防作弊两条（已实测）：
- 案例由 `ve:` 身份创建，但 `reviewTrainingRun` 对 `reviewer` 以 `ve:` 开头的请求返回 `VE_CANNOT_APPROVE_TRAINING` → **员工不能给自己转正**。
- 只有评审通过才写 `APPROVED`；`acceptance_criteria` 里固定 `noDirectBusinessWrite: true` + `requiresHumanApproval: true`。
- 同一来源事件不重复生成：查询用 `LEFT JOIN ... c.title = 'AUTO:'||e.id||':'||e.event_type` 去重。

实测：`learn:ve --employee=WMS-RECEIVING-VIRTUAL-01` 生成 case id=1（`AUTO:1434:HUMAN_APPROVED`，DRAFT，score 80）+ run id=1（WAITING_REVIEW）；`--review=1 --reviewer=admin --pass` → case=APPROVED/approved_by=admin，run=PASSED/reviewed_at 已填；`--review=1 --reviewer=ve:WMS-RECEIVING-VIRTUAL-01` → `VE_CANNOT_APPROVE_TRAINING`。

### 17.2 领域知识收集（四力 1.2）

代码：`services/api/src/agent/knowledge.js` + 闸门 `services/_shared/memory-experience.js`，CLI `npm run knowledge:ve`。

采集的是**经验条目**（一句话判断 + 出处 + 有效期），不是聚合统计。每条写入前过 `knowledgeVerdict`：

- 类型白名单只有四类：`correction` / `approved_decision` / `exception_signature` / `rule_reference`；
- 必须带 `sourceType` + `sourceId`（能回到原始行），必须带 `expiresAt` 或 `docVersion`；
- `*_state` 运行态快照、少于 24 字、含口令/密钥/身份证字样的内容一律拒绝；
- **拒绝必须回原因**（`reasons[]`），不允许静默丢弃。

命名空间 `ve/<EMPLOYEE_ID>`（topic 只是 metadata，不再切碎成一个岗位多个空间）；检索范围＝本人 + `ve/shared/*`。

7 个岗位有本领域来源（IQC 供应商缺陷、收料待检积压、库存未签收、设备磨损告警、超领未签、返工处置、供应商退货），表名与列名均已在本地库核实；其余岗位 `collected:0`，如实报告而不是造数据。

实测（2026-11-20，记忆服务在线）：`node scripts/ve-knowledge.mjs --all --remember` → 5 条 `KNOWLEDGE_COLLECTED` 事件；语义召回 `ve/WMS-RECEIVING-VIRTUAL-01` 命中 5 条（top 0.568，带 `sourceType=receipt-backlog`、`sourceId=1805`）；`ve/IQC-VIRTUAL-01` 命中 0 条，因 `iqc_inspections` 没有 FAIL 分组行——**空结果，不是失败**。

诚实边界：不带 `--remember` 只采集不入库；带 `--remember` 而 :9876 不可达时 `MEMORY_SERVER_UNREACHABLE` + 退出码 1，**不假装已入库**。

### 17.3 观测

`npm run report:ve -- --report=coverage` 已含 `training_cases` 与 `events` 列；学习产物与知识事件都会体现在覆盖报告里，"死岗位"与"在学习的岗位"能直接区分。

### 17.4 尚未接线

- `learn:ve` / `knowledge:ve` / `runner:ve` / `competency:ve` 都需人或外部 cron 调用，尚无自动定时（`frequencies.js` 已给出每班表，缺执行者）。
- 批准的案例目前不会自动改写 `promptProfile`（四力 1.1 的"新行为上岗"仍需人工决定）。
- `ve_competency_snapshots` 已由 `npm run competency:ve` 自动合成（确定性四力，人工签署行不被覆盖），但**没有**度量"引用了知识"是否真的**改变了判断**——`SMART_JUDGMENT` 目前只看有没有 evidence，见 §18.5。

## 18. RAG 架构：一套共享索引 + 每岗位逻辑命名空间

### 18.1 结论

**一套 RAG**：`services/memory/memory_server.py`（:9876）包一个 mem0 实例、一个 Qdrant 集合；**不给每个虚拟员工建独立库**。隔离在写侧和读侧强制，不靠物理分库：

| 命名空间 | 内容 | 谁能读 |
| --- | --- | --- |
| `ve/<EMPLOYEE_ID>` | 本人经验（纠正、批准理由、例外特征） | 本人 + 主管显式跨岗查询 |
| `ve/shared/*` | 主管批准的跨岗位规范与例外 | 所有员工 |
| `*-ai`（wms/bom/hr/…） | 现有 runtime manager 的语料 | 各 manager |

理由：44 个岗位 × 独立集合＝44 份模型/维度/备份/泄漏面；而员工做判断恰恰需要**别人的例外**（收料员需要 IQC 的供应商缺陷史），物理分库反而逼出跨库合并。真正需要隔离的是**读取范围**，`recall()` 只允许 本人 + `ve/shared/*`，跨员工查询必须显式传 `veAgentIds()`。

### 18.2 三层语料：什么进向量，什么绝不进

| 层 | 内容 | 存放 | 理由 |
| --- | --- | --- | --- |
| L0 事实 | 单据、库存、检验结果、任务状态 | PostgreSQL | 要精确、事务、可审计；向量检索给不出真相 |
| L1 规范 | OA 已发布受控文件（OA-AI-GOV-01 等） | 向量 + `docVersion` | 必须带版本，文件升版即旧条目失效 |
| L2 经验 | 人工纠正、批准理由、例外特征 | 向量 + `sourceType/sourceId` + `expiresAt` | 唯一真正需要语义相似的东西 |

聚合统计（周报数字、积压计数）不是知识，留在 `npm run report:ve`；运行态快照不是知识，留在 JSON state 文件。

### 18.3 已丢弃 / 已改进 / 保留

**丢弃（已执行）**

1. 8 个 manager 把向量库当"最近状态"键值用：`loadState()` 先 `mem.search("most recent X state", 1)`、`saveState()` 每周期 `mem.store(..., {type:'*_state', state:{…}})`，而同一 state **已经**写进 JSON 文件。后果是每个周期往索引里灌一条近似重复的快照，检索只会返回"上周期的计数"。现在文件即状态源，向量只存经验：`wms/bom/finance/hr/mes/plant/pmc/procurement-manager.js`。
2. HR 快照把考勤/请假明细整坨嵌入共享索引（个人数据 + 零检索价值）→ 同批移除。
3. 我 v1 版 `knowledge.js` 的两处自伤：`ve/<id>/<topic>` 把一个岗位的空间切碎；把聚合统计当知识入库。已改为 `ve/<EMPLOYEE_ID>`（topic 进 metadata），统计交回报告。
4. 旧集合 `smt_factory_memory`（768 维）：配置写的 `nomic-embed-text` **本机 ollama 根本没装**（装了 mxbai-embed-large / bge-large / bge-m3 / snowflake-arctic-embed），而所有写入都被 `try/catch` 降级成一条 WARN——"看起来在用，实际没在用"。已切 `bge-m3:latest`（已安装、1024 维、中/英/越三语）+ 新集合 `smt_factory_memory_v2`。**决定（2026-11-21 人工签字）：旧集合保留不删**，作为污染样本与 768/1024 维度对照留在磁盘；任何读路径都不指向它。

**改进（已执行）**

1. 唯一写闸门 `services/_shared/memory-experience.js`：类型白名单、出处必填、有效期/版本必填、敏感内容与 `*_state` 拒绝，拒绝必回原因。
2. 读侧收口：`recall()` 限定 scope + 过期条目应用层过滤 + 分数排序，返回 `cited[]`（memoryId/agentId/type/docVersion/sourceType/sourceId/score）。
3. RAG 进闭环：`runner.js` 每轮先召回，命中条目写进任务 `input.evidence`；召回失败写 `evidence:[{recallError}]`，**不允许**把"取不到"伪装成"不需要证据"。CLI 加 `--rag`。
4. `services/worker/mes-manager.js:21` 从 `../../_shared/memory-client.js` 改回 `../_shared/...`——仓库里没有根 `_shared`，这个 worker 一加载就报错，记忆路径从没跑起来过。
5. `competency.js`：`ON CONFLICT ... WHERE COALESCE(metric->>'signed','false')<>'true'`（人工签署的等级不被规则重算覆盖）；`t.input ? 'evidence'` 改 `jsonb_exists()`。CLI `npm run competency:ve`。

**保留**：mem0 + 单实例 + 嵌入式 Qdrant 的形态；`services/_shared/memory-client.js` 作为唯一入口（8 个 manager 已在用）；`memory-trends.js`（跨员工分析时显式传 `veAgentIds()`）。

### 18.4 实测（本机 2026-11-20，记忆服务在线）

- `py -3.14 services/memory/memory_server.py` → :9876 ready，`/health` 返回 `{"ok":true,"status":"running"}`。
- 写入：`node scripts/ve-knowledge.mjs --all --remember` → 5 条 `KNOWLEDGE_COLLECTED` 事件；`ve/WMS-RECEIVING-VIRTUAL-01` 语义召回 5 条，top 0.568，带 `sourceId=1805`。
- 闭环：`node scripts/ve-runner.mjs --employee=WMS-RECEIVING-VIRTUAL-01 --limit=40 --rag` → scanned 40 / created 38 / cited 5；库内 `input.evidence` 非空任务 48 条（task 175627 为例，5 条引用含 memoryId+score+sourceId）。
- 四力：`npm run competency:ve` 对全部启用岗位 × 4 力写入成功（修 SQL 前该语句是语法错误）；WMS-RECEIVING 的 `SMART_JUDGMENT` 由 0 → **2**，因为 `tasks_with_evidence=40` 现在可测。
- 回归：`npm run test` 392 passed / 21 skipped；`tests/agent-self-learning.test.mjs` 覆盖写入闸门、命名空间、scope、过期过滤、召回失败入证据。

### 18.5 缺口

- OA 受控文件（L1）已入库（2026-11-21，见 §24）：79 条 published+public+L1/L2/L3 进 `ve/shared/controlled-docs`，带 `docVersion` 与复审到期日；L4 空白表单排除。剩下的是**文件正文**没有进语料（现在入的是登记项＋版本＋复审期，正文需 OA 导出接口）。
- "引用知识"≠"因知识改变判断"：四力权重仍按有/无 evidence，需要一条 A/B 或人工标注口径才能度量。
- `/health` 的 `memories_total` 与新集合不同源（显示 0），不要用它的数字判断是否落库；以 `--remember` 的 `stored` 与 `KNOWLEDGE_COLLECTED` 事件为准。
- 旧集合 `smt_factory_memory` 已决定**保留**（2026-11-21 签字）：不再列入待拍板项。它不在任何读路径上；将来若要清理，需重新走不可逆签字。

## 19. 岗位技能与 MCP 契约（已实现并实测）

说明书是给人看的，派工机需要能问的。这一章的答案在代码里：`services/api/src/virtual-employees/{skills-catalog,mcp-catalog,role-capabilities,capabilities}.js`，全量清单由 `node scripts/ve-capabilities-doc.mjs` 渲染成 `SKILLS-AND-MCP.md`（文档从代码生成，所以不会和代码说两套话）。

规模：**44 岗 / 262 技能 / 14 个 MCP 服务器 / 95 条真实权限键**。

### 19.1 三个字段决定一件事能不能做

| 字段 | 含义 | 强制点 |
| --- | --- | --- |
| `permission` | 该技能靠 `permissions` 表里哪条真实 code 落地 | 只读技能不得持 `.manage`；镜像与库不一致即 `check:ve-capabilities -- --db` 失败 |
| `kind` | `read` / `draft` / `write` | `write` 必须绑 `gate`（`WRITE_WITHOUT_GATE`＝error） |
| `gate` | 写操作卡在哪个人工门 | 该门必须注册在这个岗位的 `humanGates` 上，否则 `WRITE_GATE_NOT_IN_REGISTRY`＝error（运行时会是 `GATE_NOT_REGISTERED`） |
| `mcp` | 允许调用哪些 MCP 服务器 | 岗位可用集＝技能所需并集 + `smt-memory`；未登记服务器＝error |

### 19.2 契约在运行时生效，不只是纸面

- `runner.js` 每轮先 `canUseSkill(employeeId, probe.taskType)`，未授权直接 `skipped: SKILL_NOT_DECLARED_FOR_ROLE`，**不落任务**。
- 7 个探针的 taskType 已全部登记为技能；`tests/virtual-employee-capabilities.test.mjs` 逐条校验，加探针不登记技能测试就红。
- 写技能只产出 `WAITING_APPROVAL` 草稿，批准人必须具名人类（§14 未变）。
- HTTP 侧：`GET /api/factory/virtual-employees/<ID>/capabilities`（含 21 个只在汇报线表里的岗位，`registry:null` 表示代码侧尚未建仓）、`GET /api/factory/virtual-employees/capabilities/summary`（全组织自检）。实测 200，`problems=[]`。

### 19.3 实测

```bash
npm run check:ve-capabilities -- --db
# CAPABILITY_CONTRACT roles=44 skills=262 registry=23 mcp=14
# PERMISSIONS live=95 mirrored=95 stale=0
# ROLES db=44 declared=44 undeclared=0 extra=0
# GATES in_use=5 unknown=0
# VE_CAPABILITIES_OK problems=0 warnings=9
```

### 19.4 剩下的 warning 都是设计，不是 bug

8 条 `HUMAN_ONLY_GATE`：OPS 的 6 个门、WMS-INVENTORY 的 hand_over/receive_package、APP-OPS 的 data_mutation、DATABASE 的 restore_database/delete_data、DATA-QUALITY 的 master_data_merge/bulk_correction、BACKUP 的 delete_backup、RELEASE 的 database_migration、UI-DESIGN-QA 的两个门——这些门登记在岗位上，是给**人类批准该岗起草的任务**用的，本来就不该有虚拟员工的写技能。

曾经有的第 9 条 `ENABLED_FLAG_CONFLICT` 已消除：`registry.js` 现在按组织文档把 `DATA-QUALITY-VIRTUAL-01` 与 `UI-DESIGN-QA-VIRTUAL-01` 标为占位（`enabled:false`），与 `ve_reporting_lines` 一致。实测 `check:ve-capabilities -- --db` → `ENABLED flags=44 conflicts=0`。


## 20. 批准之后发生什么（流程推进，不是代写业务账）

代码：`services/api/src/agent/writeback.js`，批准的唯一入口 `services/api/src/agent/approval.js`（HTTP 路由与 CLI 共用）。

### 20.1 为什么回写不改库存、不改单据

库存是 `inventory_transactions` 推出来的，可追溯性要求"谁按了收货/放行/付款"必须落在那个具名操作员身上。所以人类批准之后，代理侧做的是**把工作推给下一手的岗位**（生成后继草稿任务），而不是替人类写业务表。没有后继动作的门，明确记 `WRITEBACK_UNSUPPORTED` 并写出原因，绝不静默什么都不做。

### 20.2 门 → 后继（12 个有后继，其余 41 个显式声明由人类执行）

| 批准的门 | 后继岗位 | 后继技能 |
| --- | --- | --- |
| `receive_variance` | `WMS-IQC-HANDOFF-VIRTUAL-01` | `IQC_SUBMIT` |
| `final_iqc_decision` | `WMS-RECEIVING-VIRTUAL-01` | `LOCATION_BIND` |
| `inventory_release` | `WMS-INVENTORY-VIRTUAL-01` | `LOCATION_OPTIMIZE` |
| `exemption` | `IQC-VIRTUAL-01` | `SAMPLE_CALCULATION` |
| `supplier_suspension` | `PURCHASING-VIRTUAL-01` | `REPLENISHMENT_REVIEW` |
| `publish_rejection` | `SUPPLIER-COLLAB-VIRTUAL-01` | `IQC_FEEDBACK` |
| `stop_line` | `MAINTENANCE-VIRTUAL-01` | `BREAKDOWN_ROUTE` |
| `approve_scrap` | `QUALITY-VIRTUAL-01` | `NCR_ROUTE` |
| `close_ncr` | `REPAIR-VIRTUAL-01` | `REWORK_ROUTE` |
| `return_machine_to_service` | `MAINTENANCE-VIRTUAL-01` | `PM_SCHEDULE` |
| `inventory_adjustment` | `WMS-COUNT-VIRTUAL-01` | `COUNT_PLAN` |
| `release_expired_material` | `MSD-CONTROL-VIRTUAL-01` | `BAKING_ALERT` |

三条硬约束（自检 `auditWritebackCoverage` 保证）：后继技能必须是该岗位**已声明**的技能；后继必须是草稿（`kind !== write`，不能再要求一次人工门）；每个已注册的门都必须有明确归宿（有后继或写明原因）。实测 `missing=[]`、`advancesToWrite=[]`。

### 20.3 幂等与不撤销

后继任务 `task_key = WB:<gate>:<rowKey>`，重复推进得到 `duplicate:true`；推进失败（例如死锁）只写 `WRITEBACK_FAILED` 事件，**不回滚人类已经做出的批准**。

### 20.4 实测（本机，合成任务，验证后作废）

```
created synthetic task 203708   SYNTHETIC 验证用（批准→回写链路），非真实收料 WB-PROOF-…
reviewer admin permissions=48 has wms.execute=true
approve { ok:true, gate:'receive_variance', writeback:{applied:true, targetTaskId:203709} }
events   HUMAN_APPROVED by admin | WRITEBACK_APPLIED by ve:WMS-RECEIVING-VIRTUAL-01
successor 203709 WMS-IQC-HANDOFF-VIRTUAL-01 / IQC_SUBMIT status=OPEN requires_human=false requested_by=ve:writeback
double approve refused true · re-advance idempotent { applied:true, duplicate:true }
ve actor refused VE_CANNOT_APPROVE · synthetic rows still open 0（已 CANCELLED + PROOF_CLEANED 事件）
```

存量积压已清空（2026-11-21 03:42Z，业务授权后执行）：`npm run approve:ve -- --limit=300 --reviewer=MO_LI_BIN --confirm=MO_LI_BIN` → **attempted 275 / approved 275 / refused 0**，写回 **applied 270、WRITEBACK_UNSUPPORTED 5**（hand_over_package 3 + approve_document 2 按设计不推进，交接待签是 PDA 动作、文件批准在 OA 签核链内）。后继草稿任务：`WMS-IQC-HANDOFF-VIRTUAL-01/IQC_SUBMIT` 265、`MAINTENANCE-VIRTUAL-01/PM_SCHEDULE` 4、`WMS-RECEIVING-VIRTUAL-01/LOCATION_BIND` 1，全部 `status=OPEN`、`requires_human=false`、`requested_by=ve:writeback`。**没有任何库存/业务表被写**。批准人 `MO_LI_BIN`（莫立斌，roleId 20，65 条权限键，实测覆盖 wms.execute + quality.write）逐条写入 `HUMAN_APPROVED` 事件，`approved_by` 落 275 行。

待批队列现在重新从 0 开始累积——调度器每 300 秒扫一次，新的收料差异会继续进门。这是正常态，不是回归。

工具：`--list` 看按门分组的队列；批准必须 `--reviewer=<真人> --confirm=<同一个真人>`，没有默认批准人，`ve:` 身份一律拒绝，权限从 `users`→`role_permissions`→`permissions` 实测取（`users.role_id` 与 `user_roles` 两种授予路径取并集），与 UI 走同一条判定。

## 21. 定时执行终于有了执行者

代码：`services/api/src/agent/scheduler.js` + `scripts/ve-scheduler.mjs`（`npm run schedule:ve`）。

| 类别 | 判定 | 说明 |
| --- | --- | --- |
| EVENT / WATCH | 距上次扫描 ≥ `intervalSeconds` | 确定性探针，不调模型 |
| BATCH | cron 命中本地（Asia/Ho_Chi_Minh）分钟，同一分钟只一次 | 无 DST，固定 UTC+7，不引 ICU 时区库 |
| DEMAND | 永不自跑 | 只有人或同事派单 |
| 未声明频率 | `FREQUENCY_NOT_DECLARED` 上报 | 不悄悄跳过 |

夜间批任务：`learn 22:30`、`knowledge 23:00`（含受控文件语料）、`competency 周一 06:00`、`report 07:15`。

**last-run 状态不需要新字段**：`factory_virtual_employee_configs` 没有 `last_run_at`，加列属不可逆清单；所以调度器在有产出时写一条 `SCHEDULER_TICK` 事件（`employee_id` NOT NULL，job 归口 `OPS-SUPERVISOR`），重启后从事件恢复。没产出的轮次不记录——重复执行本来就由 `task_key` 幂等挡住。

实测（同一分钟内跑两轮 `--once --limit=80`）：

```
pass1 created: OPS-SUPERVISOR 78 · WMS-RECEIVING 40 · WMS-INVENTORY 1 · MAINTENANCE 2
ticks: 4 条 SCHEDULER_TICK（actor=scheduler，detail 带 created 数）
pass2 fired: []        ← 从 tick 恢复的 lastRun 抑制了同分钟重跑
```

第一轮真实产出了 121 条任务（其中 78 条是 OPS 的审批升级提醒，40 条收料待批草稿），这是调度器上线后的正常首轮积压，不是错误；全部带 `task_key`，重复运行只记 duplicate。

## 22. 调度器挂进启动链（一个库只跑一个）

代码：`services/api/src/agent/scheduler.js` 的 `acquireSchedulerLock` + `start_dev.js` 的 `startScheduler`。

| 事项 | 现在的行为 |
| --- | --- |
| 启动 | `node start_dev.js` 起第 5 个子进程 `scripts/ve-scheduler.mjs --tick=60`，崩溃 2 秒后重启，日志前缀 `[ve-scheduler]` |
| 单实例 | 进程对数据库持一个 **会话级 advisory lock**（key `748312`）。第二个进程打 `SCHEDULER_ALREADY_RUNNING` 并**以 0 退出**，启动器看到 0 就不重启，不会自旋 |
| 锁的正确性 | `pg_try_advisory_lock` 是会话作用域，所以取/放都在同一条单独 checkout 的连接上；连接池会锁在 A、解在 B。进程被杀 ⇒ 连接断 ⇒ 锁自动消失，不会留下死锁 |
| 关闭 | SIGINT/SIGTERM 释放锁、归还连接、`pool.end()`，然后退 0 |
| 安静模式 | `VE_SCHEDULER=off node start_dev.js` 完全不起；`VE_SCHEDULER_TICK=15` 改轮询间隔（下限 15 秒）；`DEV_SERVICES=api,web` 只起指定子服务（默认五项全起） |

参数风格统一为仓库约定的 `--name=value`：`--tick 60` 过去会被解析成 `--tick`（值缺省 `"1"`），再被下限抬成 15 秒，等于偷偷改掉了轮询频率。启动器已改成 `--tick=60`。

实测：

```
launcher 子进程: {"hydrated":4,"lockKey":748312,…}
第二个进程      : {"skipped":"SCHEDULER_ALREADY_RUNNING",…}  exit 0
停掉 launcher 后 : {"hydrated":4,"lockKey":748312,…}  exit 0   ← 锁随连接消失
```

生产侧另有一节：见 §23（镜像已建、容器未启）。

## 23. 调度器上生产（镜像已建，容器未启）

代码：`Dockerfile.ve-scheduler` + `docker-compose.prod.yml` 的 `ve-scheduler` 服务。

| 决定 | 理由 |
| --- | --- |
| 独立镜像，不改 `Dockerfile.api` | `Dockerfile.api` 有意不 COPY `scripts/`；为调度器加一行就会重建正在被切换的 api 镜像。独立镜像对切换零干扰 |
| COPY 集合与 api 一致（apps/packages/services/database/integrations）+ `scripts/` | `npm ci` 在这份 package.json 上要解析声明的 workspace；少 apps/ 或 packages/ 是**安装失败**，不是运行失败 |
| `--no-rag` | 生产没部署 `services/memory`，`:9876` 无人监听；带 RAG 只会把失败往事件表里灌。memory 上线后去掉这个 flag |
| 只 `depends_on: api (healthy)` | `factory_virtual_employee_*` 表由 API 启动期 DDL 创建；调度器全程只连数据库，不走 HTTP，所以不注入任何密钥 |
| `stop_grace_period: 120s` | SIGTERM 要走"释放 advisory lock → 归还连接 → pool.end()"，而一个 tick 可能正跑在子脚本里 |
| 构建上下文 = `git archive HEAD` | 只装已提交内容，绝不把别人的未提交 WIP 打进生产镜像 |

主机上的实测（`100.116.166.118`，未启动任何容器、未改 `/home/wy/smt-factory-system` 任何文件，构建在隔离目录 `/home/wy/ve-sched-build`）：

```
镜像      smt-factory-system-ve-scheduler:sync20261121
EXPORTS=  JOBS,SCHEDULER_LOCK_KEY,SCHEDULER_OWNER,...,acquireSchedulerLock,...   ← 锁代码确实在生产镜像里（主机旧副本没有）
ROLES=    23        script --check OK
--dry-run 首次停在 connect ECONNREFUSED 127.0.0.1:5432（compose 用 PGHOST=postgres 提供）
```

**尚未 `up -d`，两个原因**：(1) 迁移 `324_virtual_employee_reporting_system.sql` 不在生产台账（实测 `select count(*) from _migrations where filename like '324%'` = 0），生产库 `ve_%` 对象为 0 —— 不上它，`competency`/`report` 两个 job 会夜夜失败，而迁移属不可逆清单，需要主人签字；(2) 生产库自 21:08 起被 purge + `pg_restore` 重写（`pg_restore` 持续 36 分钟以上、已进入 `ALTER TABLE ... ADD CONSTRAINT` 阶段），期间 `smt-api`/`smt-web` 仍 healthy 对外应答，实测 `materials=1017` 而 `inventory_transactions=0`、`material_lots=0`。**恢复完成之前，任何生产数字都没有意义**，包括我自己前面量的那些，所以这里只写「镜像已建、容器未启」。

## 24. L1 受控文件语料（已入库）

`npm run knowledge:ve -- --docs --dry-run` → `--docs --remember`：从 `oa.doc_system` 取 **已发布 + 公开 + L1/L2/L3**（79 条），跳过 181 条 L4 空白表单（近似重复的标题只会稀释召回）。每条内容为「受控文件 DT-SP-EN-002《设备设施控制程序》（L2/l2_procedure）当前版本 1.0；引用时必须带版本号，下次复审 2028-08-03」，元数据带 `docVersion`（=文件版本）与 `expiresAt`（=复审到期日），命名空间 `ve/shared/controlled-docs`。

实测：79/79 写入、0 拒绝；`recall({employeeId:'IQC-VIRTUAL-01', query:'磁感类进料检验标准 版本 复审'})` 命中三条受控文件（0.743 / 0.657 / 0.645，均带 `docVersion:"1.0"`、`sourceType:"oa-doc-system"`、`sourceId`）；`sharedOnly:'controlled-docs'` 可把引用范围收窄到受控文件一种。

两处真实缺陷是这轮实测暴露的，不是设计时想到的：汇总事件写 `employee_id=NULL` 违反 NOT NULL（现归口文控岗）；`next_review_date` 是 Date 对象，`String(...).slice(0,10)` 得到 `Mon Au` 这种垃圾（现显式格式化，畸形文本的 50 条已 `deleteAll()` 清掉重灌）。

共享语料现在是三个，读侧都自动带上：`ve/shared/general`（主管批准的实践）、`ve/shared/controlled-docs`（受控文件）、`ve/shared/exception-signatures`（跨岗例外特征）。仍是一套 RAG、一个集合，隔离靠命名空间与 `recall()` 的 scope 白名单。

