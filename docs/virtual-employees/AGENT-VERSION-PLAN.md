# Agent 版 SMT 系统 · 实施计划（基于人类版）

## 1. 一句话

**不是再造一套 SMT 系统，而是在现有人类版之上加一层"代理平面"**：把人类在页面上点的按钮、扫的码、填的表，收敛成约 40 个有 schema、有权限、有人工门的工具；44 个虚拟岗位通过这层工具工作，所有动作仍落在同一套 Express + PostgreSQL 上，仍走已经实现的 `humanGates` 强制点。

## 2. 问题

| 人类版现状 | Agent 版必须解决 |
|---|---|
| 36 个前端模块、2,050 条路由、166 个一级域（`App.tsx` / 路由逐条统计） | Agent 不可能也没有必要调用 2,050 个端点；需要受控工具子集 |
| 写操作由人的 JWT + `requirePermission` 授权（`server.js:13505`） | 虚拟员工不是登录账号（`authenticateJWT` 会拒绝非 `accountStates` 里的 userId），必须用独立服务身份 |
| `humanGates` 过去只是数组，服务端零引用 | 已在 `POST /tasks/:taskId/approve` 接上强制校验（`service-identity.js` + `routes/virtual-employees.js`） |
| 183 条 `receive_variance` 任务待批、0 批准（`report:ve --report=throughput`） | 人工审批吞吐是瓶颈；Agent 版第一目标是"能产出可批的草稿"，不是提高自治等级 |
| 44 岗位里只有 1 个 `ACTIVE_EXECUTOR`（registry.js），36 个在岗岗位 tasks=0 | 需要一个通用 runner + 记忆 + 训练闭环，而不是逐岗复制代码 |
| 生产库 1238 表 vs 本地约 1336 表；迁移 append-only | 不复制数据库、不开新写入路径；新增观测表走迁移 |

## 3. 方案

```
人类版（保留，不重写）
  React 36 模块 ──► Express :8080 ──► PostgreSQL smt_factory
                        ▲
                        │ 同一 JWT / 权限 / 门 / 审计
                        │
Agent 平面（新增）
  ┌──────────────────────────────────────────────────────┐
  │  接口层：JSON-RPC / MCP 工具端点 + CLI（无 React 页面）          │
  │        │                                              │
  │  工具注册表（~40 tools，schema + 岗位 allowlist）      │
  │        │                                              │
  │  MCP / HTTP 网关：x-ve-token → 域权限 → 幂等键         │
  │        │                                              │
  │  LangGraph runner（每岗一个 graph_id）                 │
  │        ├─ memory namespace ve/<employee_id>/<topic>    │
  │        ├─ training_cases / training_runs（自学习）      │
  │        └─ 结论写 tasks.output（草稿），不直写业务表     │
  └──────────────────────────────────────────────────────┘
```

**三个不变式**：① 一岗一身份、一工具一 schema；② 代理只能写草稿，业务写入必须有人类 `HUMAN_APPROVED` 事件在前；③ 所有调用可被 `report:ve` 观测（新增 tool-call 报告）。

## 4. 功能映射（人类操作 → Agent 工具）

`模式`：R=只读，D=草稿，G=经人工门后写入。工具名是建议命名，落到 `TOOL_REGISTRY` 的 `id`。

### 4.1 跨部门 / 指挥

| 人类功能（现有 surface） | Agent 工具 | 主责岗位 | 模式 | 人工门 / 证据 |
|---|---|---|---|---|
| 首页看板、异常列表、班长交接（`dashboard`、`manager`、`shift handover`） | `dispatch_task`, `escalate`, `shift_handover_draft`, `kpi_summary` | `OPS-SUPERVISOR` | R/D | 派工不写业务数据；升级链三级 |
| 通知/企微（`notices.js`、`sendVirtualEmployeeWechat`） | `notify_human` | 总监 + 各主管 | D | 只出文案，发送需审核 |

### 4.2 D1 来料与仓储（wms 260，写 152）

| 人类功能 | Agent 工具 | 主责岗位 | 模式 | 人工门 / 证据 |
|---|---|---|---|---|
| PDA 到货扫码、箱单核对（`wms-receiving-iqc.js`、`wms_incoming_records`） | `po_reconcile`, `box_label_plan`, `hidden_pallet_bind` | `WMS-RECEIVING` | R/D | `receive_variance`；实收 vs PO vs ASN 三源 |
| 收货转 IQC 检验（`material_lots`、检验等级事件） | `iqc_handoff_prepare` | `WMS-IQC-HANDOFF` | D | `change_iqc_level`；漏检为 0 |
| 库位推荐、上架规则（`PUTAWAY_RULES`、`rankPutawayLocations`） | `putaway_recommend`, `putaway_path_plan` | `WMS-INVENTORY` | R/D | `override_putaway_rule` |
| 库存流水、冻结、循环盘点（`wms-counting.js`、`inventory_transactions`） | `inventory_reconcile`, `cycle_count_plan`, `fifo_exception_scan` | `WMS-INVENTORY` / `WMS-COUNT` | R/D | `inventory_adjustment` |
| 领料/退料/线边配送（`wms-production.js`、`wms_fetch_packages`） | `issue_plan`, `delivery_sla_watch`, `unreceived_escalate` | `WMS-ISSUE` | R/D | `approve_distribution`, `hand_over_package` |
| MSD 暴露与烘烤（`materials.msd_level`） | `msl_map`, `floor_life_check`, `bake_alert` | `MSD-CONTROL` | R/D | `override_msl`, `release_expired_material` |

### 4.3 D2 计划与采购 / D3 制造

| 人类功能 | Agent 工具 | 主责岗位 | 模式 | 人工门 / 证据 |
|---|---|---|---|---|
| MPS/MRP、缺料告警（`pmc.js` 54、plan 13） | `mrp_run`, `shortage_alert`, `delivery_risk_rank` | `PMC`（主管兼） | R/D | `commit_delivery`, `change_frozen_plan` |
| PO 跟单、ASN、ETA（`procurement` 28、erp 15） | `po_replenish_draft`, `asn_track`, `eta_ata_watch` | `PURCHASING` | D | `approve_po`, `change_price`, `change_quantity` |
| 供应商门户（`services/supplier-portal-api` :8098） | `portal_sync_check`, `supplier_claim_prepare` | `SUPPLIER-COLLAB` | R/D | `publish_rejection`, `supplier_account_approval` |
| 工单/工艺/过站（`mes` 167、`mesrj.js`、`station-pass.js`） | `work_order_progress`, `route_guard_check`, `station_pass_validate` | `MES`（主管兼） | R/D | `change_route`, `close_work_order` |
| SMT 上料与消耗（`smt` 82、smta 31、`wms-smt-loop.js`） | `loading_verify`, `consumption_reconcile`, `feeder_change_audit` | `SMT-LOOP` | R/D | `override_loading`, `manual_consumption_writeback` |
| 安灯、换线、节拍（`andonBoard`、`auto-line.js`） | `andon_open_draft`, `line_cadence_watch` | `ANDON` | D | `stop_line` |
| 包装/托盘/成品（`pack` 21、pallet 17） | `packing_plan`, `pallet_manifest_check` | `PACK` | D | `ship_release` |

### 4.4 D4 品质 / D5 设备

| 人类功能 | Agent 工具 | 主责岗位 | 模式 | 人工门 / 证据 |
|---|---|---|---|---|
| IQC 抽样与判定（`quality-iqc-loop.js`、19 张 `iqc_*` 表、`askIqcLlm`） | `iqc_sample_plan`, `iqc_judge_draft` | `IQC` | R/D | `final_iqc_decision`, `exemption`；**样板岗位** |
| OQC/AQL（`oqc-aql.js`、`oqc` 32） | `oql_aql_sample`, `outgoing_judge_draft` | `OQC` | R/D | `ship_release`, `change_aql_level` |
| NCR/CAPA/8D/MRB（`qms` 129、`mrb*.js`） | `ncr_route_draft`, `capa_verify`, `mrb_review_draft` | `QUALITY`（主管兼） | R/D | `close_ncr`, `approve_capa`, `approve_scrap` |
| ECN/生命周期/追溯（`ecn` 17、lifecycle 36、trace） | `ecn_impact_analysis`, `genealogy_query`, `recall_scope` | `TRACE` | R/D | `apply_ecn`, `execute_recall` |
| 设备健康/PM/备件（`equipment` 61、maintenance 28、spare 17） | `equipment_health`, `pm_plan`, `spare_alert` | `MAINTENANCE`（主管兼） | R/D | `return_machine_to_service` |
| 维修返工（`repair` 31、rework 11） | `repair_triage`, `rework_route_draft` | `REPAIR` | D | `scrap_decision`, `rework_twice` |

### 4.5 D6 商务财务 / D7 人事行政 / D8 平台

| 人类功能 | Agent 工具 | 主责岗位 | 模式 | 人工门 / 证据 |
|---|---|---|---|---|
| 订单与交期（`sales` 16、order 16） | `order_validate`, `delivery_promise_draft` | `SALES` | R/D | `commit_delivery`, `quote_price` |
| 对账/发票（`finance` 41、einvoice） | `three_way_match`, `tax_code_check`, `invoice_prepare` | `FINANCE`（主管兼）/ `E-INVOICE` | R/D | `approve_payment`, `issue_invoice`, `red_reversal` |
| HR 主数据/考勤/技能矩阵（`hr` 198、cfg_skill） | `skill_matrix_check`, `attendance_exception`, `roster_validate` | `HR`（主管兼） | R/D | `approve_leave`, `change_payroll`；记忆不得存个人明细 |
| 文控 OA（`oa` 16、approval steps、OA-AI-GOV-001 受控文件） | `doc_route_prepare`, `required_sign_check`, `sla_remind`, `controlled_doc_lookup` | `OA-DOCUMENT-CONTROL` | R/D | `approve_document`, `sign_for_human`, `skip_required_step`；执行前必须查 OA `PUBLISHED` 版本 |
| 安全（`safetyManager`） | `hazard_triage`, `overdue_escalate` | `SAFETY` | R/D | `unlock_hazard_area` |
| 服务健康/容量（9 个服务、22 个 `setInterval`） | `service_health`, `job_monitor` | `APP-OPS`（主管兼） | R | `restart_production_service`, `data_mutation` |
| 迁移/模式/漂移（339 迁移、check:migrations） | `schema_drift_check`, `migration_plan_check` | `DATABASE` | R | `schema_change`, `database_migration` |
| 契约/镜像比对（`wms-parity.js`、`rjvn_*`） | `contract_validate`, `parity_compare` | `INTEGRATION` | R | `external_write`, `mapping_change`；不得改基线文件 |
| 账号/密钥/Auth 顺序检查 | `access_audit`, `secret_scan`, `auth_order_check` | `SECURITY` | R | `disable_account`, `rotate_secret`；不回显密钥值 |
| PDA 群（`pda` 31、pdaCommMonitor） | `pda_fleet_health`, `apk_version_check` | `PDA-FLEET` | R | `remote_device_control`, `apk_rollout` |
| 备份/发布/报表（reports 22、report 13、manager 14、exec 37） | `backup_verify`, `release_gate_check`, `metric_definition_lookup` | `BACKUP` / `RELEASE` / `REPORTS` | R | `production_restore`, `production_deploy`；报告口径唯一 |

### 4.6 交互形态映射（不是一一复制 UI）

| 人类交互 | Agent 等价物 |
|---|---|
| 页面按钮 / 表单提交 | 工具调用（JSON Schema 校验，`task_key` 幂等） |
| 看板 / 报表 | 结构化摘要 + `evidence[]` + 置信度，不返回整页 HTML |
| PDA 扫码 | 事件订阅（`factory_virtual_employee_events` / 业务事件）作为工具输入 |
| 人工审批弹窗 | `POST /tasks/:taskId/approve`（已实现，服务端强制门） |
| 切模块 / 菜单导航 | 岗位身份决定可见工具集，不需要导航 |
| 多语言界面 | 结论文本按 `preferred_language`（zh-CN / en-US / vi-VN）输出，工具名保持英文 |

## 5. 非目标（out of scope）

- 不重写人类版 React 36 模块，不改 `App.tsx` 导航；Agent 版是独立小监督台。
- 不复制 DB、不开第二个 PostgreSQL、不做双写。
- 不把 2,050 条路由 1:1 暴露成工具；只做上表约 40 个。
- 不自动批准那 183 条存量任务；不提高任何 ratchet floor / 基线 / 故意缺陷。
- 不在本计划里实现 44 岗全部业务逻辑；先 D1 + IQC 样板，其余按部门滚动。
- 不换 LLM 供应商（沿用 `MiniMax-M2.7`）、不上生产环境、不改迁移基线。
- 不把 `harness/` 纳入改动（它是判定的定义，改它就等于自己给自己打分）。
- 不做 Agent 专用 UI：不新增 React 页面/按钮；人机交互仍用现有页面，Agent 只用接口。

## 6. 任务分解

### T0 · 基线与契约（先做，不写代码）
- **IMPLEMENT**：运行 `npm run report:ve -- --aggregate && npm run report:ve -- --report=all --out=docs/virtual-employees/reports`，把 7 份报告首行数字抄进本计划 §2 的验收表。
- **PATTERN**：`docs/virtual-employees/REPORT-SYSTEM.md` §4 已是基线模板。
- **GOTCHA**：数据库未起时报告命令会 `REPORT_FAILED` 并退出非 0；不要写降级假数据。
- **VALIDATE**：`npm run report:ve -- --report=integrity` 必须 37/37 全 OK。

### T1 · 工具注册表 + 代理网关
- **IMPLEMENT**：新增 `services/api/src/agent/tools.js`（上表约 40 个工具的 id / JSON Schema / domain / employee allowlist / mode / gate）与 `services/api/src/agent/gateway.js`（校验 `x-ve-token`、域权限、`task_key` 幂等、写 `AGENT_TOOL_CALL` 事件）。路由挂 `api` router，不要挂 app 级 `/api/*`（会被 router 影子挡住）。
- **PATTERN**：`services/api/src/routes/virtual-employees.js` 的 `serviceActorFor` + `humanDomainPermission` + `validateGateForApproval`；事件写入沿用 `factory_virtual_employee_events(actor)`。
- **GOTCHA**：`authenticateJWT` 会拒绝非 `accountStates` 的 userId，服务身份只能走已实现的 `x-ve-token`；`server.js` 有 47k 行且多 agent 在编辑，优先只改 `src/agent/*` 并在对应位置加一行注册调用。
- **VALIDATE**：`node --check` 两个新文件；`npm run check:register-deps`；`npm run check:route-census`（总数只增不减）；`npm run check:auth-order`（stranded=0）；`npm run check:route-shadowing`（10/10）。

### T2 · 观测（与 T1 同批交付）
- **IMPLEMENT**：工具调用写 `factory_virtual_employee_events(event_type='AGENT_TOOL_CALL', detail={toolId, taskKey, veActor, args, status, errorCode, latencyMs}, actor='ve:<id>')`；`scripts/ve-report.mjs` 的 `REPORTS` 增 `tools` 一项，SQL 直接从 `detail->>'toolId'` / `detail->>'status'` 聚合。**不新增迁移、不新增表**。
- **PATTERN**：`REPORT-SYSTEM.md` 的 coverage 报告（从既有任务/事件表派生）；`routes/virtual-employees.js` 的 `TASK_CREATED` 事件写入格式。
- **GOTCHA**：`detail` 是 JSONB，键名必须固定，否则聚合漏数；不写 `harness/`。
- **VALIDATE**：`npm run report:ve -- --report=tools` 首轮返回 0 行且不是报错；调用一次工具后必须有 `AGENT_TOOL_CALL` 事件且 `actor` 以 `ve:` 开头。

### T3 · Runner + 记忆 + 自学习（IQC 样板）
- **IMPLEMENT**：`services/api/src/agent/runner.js`：`graph_id` → LangGraph 图；`task_key` 幂等建任务；结论写 `tasks.output`；`confidence<0.7` 自动升级；人工推翻 → 自动生成 `training_cases`（DRAFT，待人工批准）。记忆走 `memory_server.py :9876` 的 `store/search`，命名空间 `ve/<employee_id>/<topic>`。
- **PATTERN**：`services/api/src/iqc/virtual-employee.js` 是唯一已接 LangGraph + LLM + 记忆的岗位；复制其形状而不是提示词文本。
- **GOTCHA**：服务运行时禁止直连 Qdrant :6333；训练案例不得自动 `approved_by`，否则等于自己给自己转正。
- **VALIDATE**：`npx vitest run tests/agent-runner.test.mjs --config vitest.unit.config.ts`；测试必须断言"低置信不写库"和"推翻自动生成 DRAFT 案例"。

### T4 · Agent 接口（无 UI，只有接口）
- **IMPLEMENT**：`services/api/src/agent/interface.js` —— 在 `api` router 上提供 JSON-RPC 2.0 端点 `/api/agent/tools`，方法 `tools/list`、`tools/schema`、`tools/call`；加 stdio 适配器供 MCP 类客户端直连（只用 JSON-RPC 帧，不引新依赖）；`scripts/agent-tool.mjs` 提供命令行 `--list` / `--call <toolId> --employee <id> --args '<json>'`。返回体固定 `{taskKey, status, evidence[], needsHuman, humanGate}`，机器可读错误带 `code`。
- **PATTERN**：身份沿用 `POST /api/factory/virtual-employees/:id/service-token`；命令形态照 `scripts/ve-report.mjs`；事件/任务写入照 `routes/virtual-employees.js`。
- **GOTCHA**：不写任何 React 组件、不碰 `App.tsx`；工具 id 一旦上线不再改名；接口只返回 JSON，不返回 HTML。审批仍走既有 `POST /tasks/:taskId/approve`。
- **VALIDATE**：`node --check services/api/src/agent/interface.js scripts/agent-tool.mjs`；`node scripts/agent-tool.mjs --list` 返回约 40 个工具；`--call iqc_sample_plan --employee IQC-VIRTUAL-01 --args '{}'` 返回带 `taskKey` 的 JSON。

### T5 · D1 试点（收料链 6 岗）
- **IMPLEMENT**：按 §4.2 实现 D1 的 6 个岗位工具集与图；用 T1 网关跑影子模式（只产出草稿）；每天把待批队列交给 `report:ve`。
- **PATTERN**：`WMS-RECEIVING` 已有 183 条任务和 324 条事件，是唯一有真实数据可回归的岗位。
- **GOTCHA**：不要把 183 条历史任务自动批准；先跑一条新任务走完"建任务 → VE 自批被拒 → 人类批准 → 放行"全链。
- **VALIDATE**：`npm run test:grade`；`npm run report:ve -- --report=throughput,coverage` 显示新增工具调用与草稿数；人类版 `/wms/receiving/*` 页面行为不变（用 `npm run test:e2e` 的相关 journey 验证）。

### T6 · 文档与交接
- **IMPLEMENT**：更新 `docs/virtual-employees/REPORT-SYSTEM.md`、`JOB-DESCRIPTIONS.md` §14、本计划 §7 验收表；写清哪些工具已上线、哪些岗位仍是空位。
- **VALIDATE**：`npm run typecheck:all && npm run test && npm run test:grade`。

## 7. 测试策略

| 层级 | 位置 | 必须覆盖 |
|---|---|---|
| 单元 | `tests/agent-tools.test.mjs`、`tests/agent-runner.test.mjs` | 工具 schema 校验、岗位 allowlist、越权拒绝、幂等键、低置信不写库、推翻转 DRAFT 案例 |
| 集成 | `tests/agent-gateway-live.test.ts`（live，不进 unit rung） | `x-ve-token` → 工具调用 → task 草稿 → 人类批准 → 事件；VE 自批必拒 |
| 回归 | 既有 `tests/` 目录，不写 `harness/` | 人类版 WMS/IQC 页面与路由行为不变 |
| 观测 | `report:ve --report=tools` | 每次工具调用都有 `ve:` actor、工具 id、状态码、延迟 |

## 8. 验收标准

1. 工具注册表上线 40 个工具，`employee allowlist` 与 `registry.js` 的 37 个在岗岗位一一对应；未登记的岗位调用任何工具都 403。
2. D1 六个岗位在影子模式下产出任务草稿，`tasks.requested_by` 100% 为 `ve:<employee_id>`，业务表零直写。
3. 任何写入都必须有前置 `HUMAN_APPROVED` 事件；随机抽查 10 条草稿，缺事件即为失败。
4. 工具调用按岗位/工具/日期可查：`factory_virtual_employee_events` 中 `event_type='AGENT_TOOL_CALL'`，`report:ve --report=tools` 可运行。
5. 人类版路由总数不减、auth stranded=0、shadowing 不增长、unit 与 grade 全绿。
6. 183 条存量任务数量不因本计划自动减少（未获业务授权不得批准）。

## 9. ASSUMPTIONS（产品值，非判定值）

```
agent_tool_count≈40      | WHY: 2,050 路由按 8 大回路与 37 岗收敛；1:1 暴露会让 allowlist 和 schema 无法维护。CHANGE IF: 试点中出现某回路无工具可调用或一工具跨多岗冲突。
agent_initial_mode=DRAFT | WHY: throughput 报告实测 183 待批/0 批准，审批吞吐是真实瓶颈，先提高草稿质量而非自治度。CHANGE IF: 人工批准耗时降到可忽略且误报率<5%。
one_database_no_fork     | WHY: 生产 1238 表 vs 本地 1336 表，双库双写无法在本次验证；AGENTS.md 明令无硬删除、库存由流水派生。CHANGE IF: 需要跨地域隔离且已有同步方案。
agent_interface_no_ui    | WHY: 明确不做花哨 UI，Agent 只需要接口；人类版页面已覆盖全部业务交互。CHANGE IF: 现场需要人类在代理界面直接改业务数据（那时应回到人类版页面，而不是给 Agent 加 UI）。
llm_keep_minimax         | WHY: factory_virtual_employee_configs 默认 provider=minimax / model=MiniMax-M2.7，换模型需重做评测。CHANGE IF: 该模型在低置信判定的误报率高于替代方案。
tool_budget_per_position=20/day | WHY: 审批吞吐上限约 30 单/人/日，20 是留出门余量的产品默认值，不是 ratchet。CHANGE IF: 实测单岗日均工具调用稳定超过 20 且人工批准跟得上。
```

## 10. 风险与停止条件

| 风险 | 证据 | 处置 |
|---|---|---|
| Auth 挂载顺序 | `AGENTS.md`：历史上 24 条路由因挂载顺序对有效 token 返回 401 | T1 必须跑 `check:auth-order`；新路由挂 `api` router |
| server.js 多 agent 并发编辑 | 47k 行、当前 114 个未提交文件、两个 claim | 只加一行注册调用；改完跑 `check:register-deps` + 启动 + 实测 |
| 分支落后 | HEAD 比 `origin/main` 落后 18 个提交且是不同谱系（WMS+OA 迁入） | 不在本计划内合并；合并是独立决定 |
| 生产 schema 差异 | 生产 1238 / 本地 1336 表 | 本计划不新增表/迁移，只写既有事件表；上线前仍需单独计划 |
| 评分拒绝红门 | `AGENTS.md`：gate 红时不跑 mutation | 每个任务带 VALIDATE 命令，先让门绿 |
| 人工门吞吐 | 183 待批 / 0 批准 | 不用"批量自动批准"解决；这是业务授权决定 |

**不在本计划内、需人类拍板**：审批权限委派（谁能批哪些门）、183 条存量任务的处置、是否接受跨谱系合并。这三项都不是产品默认值，不自行决定。

## 11. 信心

**8/10 一次通过**。确定性来自：human-gate、report 系统、registry 与 IQC 样板都真实可跑，且本版砍掉 UI 与新增迁移后不碰不可逆清单；不确定性只剩 2,050 路由的工具收敛边界与 `server.js` 并发编辑，T0/T1 的实测能把这两项降到可判。
