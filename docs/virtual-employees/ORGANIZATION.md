# 虚拟员工组织总览（唯一索引）

把已经排好的组织结构、岗位说明、汇报线、频率、治理机制、报告系统和 Agent 版计划收在一处。**本文件是索引与快照，不放第二份真源。**

编制：**37 个在岗身份 + 7 个停用占位 = `FACTORY_VIRTUAL_EMPLOYEES` 44 行**。
在岗 = 1 总监 + 8 部门主管（7 位兼主责回路）+ 28 专职，覆盖 35 条工作回路。

## 1. 组织树

```
人类决策层（厂长 / 经理 / 班组长）  ← 唯一审批权
└── OPS-SUPERVISOR-VIRTUAL-01  全厂运营虚拟总监（派工 / 唯一主责 / 升级）
    ├── D1 来料与仓储 · WMS-SUPERVISOR-VIRTUAL-01（纯仲裁）
    │   ├── WMS-RECEIVING          收料核验
    │   ├── WMS-IQC-HANDOFF        来料交接
    │   ├── WMS-INVENTORY          上架与库位
    │   ├── WMS-COUNT              循环盘点
    │   ├── WMS-ISSUE              发料与线边配送
    │   └── MSD-CONTROL            湿敏管控
    ├── D2 计划与采购 · PMC-VIRTUAL-01（兼 MPS/MRP）
    │   ├── PURCHASING             PO·ASN·ETA
    │   └── SUPPLIER-COLLAB        供应商协同与退货
    ├── D3 制造执行 · MES-VIRTUAL-01（兼工单/路线/过站）
    │   ├── SMT-LOOP               SMT 上料与料盘消耗
    │   ├── ANDON                  安灯与换线
    │   └── PACK                   包装与出货
    ├── D4 品质 · QUALITY-VIRTUAL-01（兼 NCR/CAPA/MRB）
    │   ├── IQC                    来料检验（唯一 ACTIVE_EXECUTOR）
    │   ├── OQC                    出货检验
    │   └── TRACE                  追溯与 ECN
    ├── D5 设备与工程 · MAINTENANCE-VIRTUAL-01（兼 PM/备件）
    │   ├── STATION-EQUIP          站机群 AOI/ICT/FCT/ATE
    │   └── REPAIR                 维修与返工
    ├── D6 商务财务 · FINANCE-VIRTUAL-01（兼三单匹配/欠款）
    │   ├── SALES                  销售订单与交期
    │   └── E-INVOICE              电子发票
    ├── D7 行政人事 · HR-VIRTUAL-01（兼主数据/考勤）
    │   ├── OA-DOCUMENT-CONTROL    文控协调
    │   └── SAFETY                 安全
    └── D8 平台 IT · APP-OPS-VIRTUAL-01（兼应用运维）
        ├── INFRA  INFRA    基础设施
        ├── DATABASE      数据库
        ├── INTEGRATION   集成与数据质量
        ├── SECURITY      账号与密钥
        ├── PDA-FLEET     PDA 设备群
        ├── BACKUP        备份与恢复
        ├── RELEASE       发布与 UI 回归
        └── REPORTS       指标与看板
```

图形版（当前有效）：`org/virtual-employee-reporting-lines.html` — archify 校验 9/9，浏览器实测 1440×900 / 2048×1320 无溢出。
`org/virtual-employee-org.html` 是**早期 7 部门 34 岗版本，已被上面这份取代**，仅作历史记录。

## 2. 逐岗总表

`频率`取 `frequencies.js` 的 `kind`；`状态`按 `registry.js` 之外的真实代码引用统计。

| 岗位 ID（后缀省略 `-VIRTUAL-01`） | 部门 | 直接上级 | 一句话职责 | 频率 | 状态 |
|---|---|---|---|---|---|
| `OPS-SUPERVISOR` | CMD | 人类 | 派工、唯一主责、跨域升级 | EVENT | 已实现骨架 |
| `WMS-SUPERVISOR` | D1 | OPS | 仲裁争单与冻结冲突 | EVENT | 新增主管 |
| `WMS-RECEIVING` | D1 | WMS-SUPERVISOR | 箱单核对、QR 绑定、IQC HOLD | EVENT | **已实现** |
| `WMS-IQC-HANDOFF` | D1 | WMS-SUPERVISOR | 批次交接、不漏检 | EVENT | 新增 |
| `WMS-INVENTORY` | D1 | WMS-SUPERVISOR | 上架规则、库位、安全库存 | WATCH | **已实现** |
| `WMS-COUNT` | D1 | WMS-SUPERVISOR | 循环盘点与差异归因 | BATCH | 新增 |
| `WMS-ISSUE` | D1 | WMS-SUPERVISOR | 拣配、配送、签收跟踪 | EVENT | 新增 |
| `MSD-CONTROL` | D1 | WMS-SUPERVISOR | 湿敏寿命与烘烤告警 | WATCH | 仅注册 |
| `PMC` | D2 | OPS | MPS/MRP、缺料、交期风险 | BATCH | 文案→主管 |
| `PURCHASING` | D2 | PMC | PO/ASN/ETA、补货建议 | EVENT | 任务驱动 |
| `SUPPLIER-COLLAB` | D2 | PMC | 门户确认、ASN、退货索赔 | BATCH | 仅注册 |
| `MES` | D3 | OPS | 工单、路线守卫、过站 | EVENT | 文案→主管 |
| `SMT-LOOP` | D3 | MES | 上料校验与料盘消耗 | EVENT | 新增 |
| `ANDON` | D3 | MES | 安灯呼叫与换线 | EVENT | 新增 |
| `PACK` | D3 | MES | 装箱、托盘、出货清单 | EVENT | 新增 |
| `QUALITY` | D4 | OPS | NCR/CAPA/8D/MRB | EVENT | 文案→主管 |
| `IQC` | D4 | QUALITY | 抽样、判定、动态 PDA 计划 | EVENT | **已实现（唯一执行器）** |
| `OQC` | D4 | QUALITY | AQL 抽样与出货判定 | EVENT | 新增 |
| `TRACE` | D4 | QUALITY | 谱系、召回、ECN 影响面 | DEMAND | 新增 |
| `MAINTENANCE` | D5 | OPS | 设备健康、PM、备件 | WATCH | 文案→主管 |
| `STATION-EQUIP` | D5 | MAINTENANCE | 站机程序版本与复判 | WATCH | 新增 |
| `REPAIR` | D5 | MAINTENANCE | 不良分诊与返工路由 | EVENT | 新增 |
| `FINANCE` | D6 | OPS | 三单匹配、欠款账龄 | BATCH | 文案→主管 |
| `SALES` | D6 | FINANCE | 订单与交期承诺 | EVENT | 新增 |
| `E-INVOICE` | D6 | FINANCE | 越南电子发票合规 | EVENT | 新增 |
| `HR` | D7 | OPS | 主数据、考勤、技能矩阵 | BATCH | 新增主管 |
| `OA-DOCUMENT-CONTROL` | D7 | HR | 审批包齐套与催办 | EVENT | 仅注册 |
| `SAFETY` | D7 | HR | 隐患分级与升级 | EVENT | 新增 |
| `APP-OPS` | D8 | OPS | 服务健康、错误分级 | WATCH | 仅注册（主管） |
| `INFRA` | D8 | APP-OPS | 主机、网络、容器容量 | WATCH | 仅注册 |
| `DATABASE` | D8 | APP-OPS | 模式、迁移、慢查询 | WATCH | 仅注册 |
| `INTEGRATION` | D8 | APP-OPS | 契约、镜像、数据质量 | WATCH | 仅注册 |
| `SECURITY` | D8 | APP-OPS | 权限审计、密钥扫描 | WATCH | 仅注册 |
| `PDA-FLEET` | D8 | APP-OPS | PDA 心跳、版本、打印 | WATCH | 仅注册 |
| `BACKUP` | D8 | APP-OPS | 备份校验与恢复演练 | BATCH | 仅注册 |
| `RELEASE` | D8 | APP-OPS | 发布门与 UI 回归 | DEMAND | 仅注册 |
| `REPORTS` | D8 | APP-OPS | 指标字典与看板口径 | BATCH | 新增 |

### 2.1 停用占位（`enabled:false`，不占模型预算）

`MRB`（报废评审→品质）、`LINE-CADENCE`（线体节拍→制造）、`SPARE-PARTS`（备件→设备）、`SUPPLIER-CLAIM`（退货索赔→采购）、`SUPPLIER-DEBT`（欠款→财务）、`DATA-QUALITY`（并入集成的既有条目）、`UI-DESIGN-QA`（并入发布的既有条目）。启用判据见 `JOB-DESCRIPTIONS.md` §11。

## 3. 全员共同机制

| 机制 | 内容 | 位置 |
|---|---|---|
| 基础能力（四力） | 自学习 / 知识沉淀 / 智能研判 / 逻辑推演，等级 0–4；主管与总监须全 ≥3 | `JOB-DESCRIPTIONS.md` §1 |
| 身份 | `x-ve-token`，`actor=ve:<employee_id>`，scope 仅 `task:create` | `services/api/src/virtual-employees/service-identity.js` |
| 人工门 | 11 类 `humanGates`，服务端硬校验；VE 不可自批 | `services/api/src/routes/virtual-employees.js` |
| 节奏 | 37 岗频率配置 + 校验器，模型调用 ≤20 次/日/岗 | `services/api/src/virtual-employees/frequencies.js` |
| 观测 | 7 份报告（花名册/完整性/负载/审批吞吐/四力/覆盖/KPI） | `REPORT-SYSTEM.md`、`npm run report:ve` |
| 技能与 MCP 契约 | 44 岗 × 262 技能 × 14 MCP：写技能必绑人工门、权限键必须真实存在、runner 每轮先问契约 | `SKILLS-AND-MCP.md`、`npm run check:ve-capabilities` |
| 流程 | 派工→草稿→人工门→业务写入→事件审计 | `org/virtual-employee-dispatch.html` |

## 4. 当前真实状态（不要高估）

- 37 个在岗岗位现已全部有只读探针：30 条新增在 `probe-library.js`，逐条用真实 schema 验证；`dryRun` 实跑 13 岗有真实待办、24 岗空队列、`skipped=0`。
- 报告快照（03:42Z 重算）：7 个岗位有任务、8 个有事件。此后本地 275 条、生产 200 条积压已分别清零，队列重新累积；生产批准后回写 197 条后继 OPEN 草稿（详见 `JOB-DESCRIPTIONS.md` §25）。
- 频率配置的**消费方是调度器**（`dueNow()` / `dueJobs()` 直接读 `FREQUENCIES`，跑法 `npm run schedule:ve` 或 `start_dev.js` 子进程），但配置本身**未写回数据库**，DB 里仍是默认 300 秒；改频率目前只改代码。
- 三个真源必须同步：运行时 `registry.js`（**44 条**，其中 `DATA-QUALITY` / `UI-DESIGN-QA` / `LINE-CADENCE` / `MRB` / `SPARE-PARTS` / `SUPPLIER-CLAIM` / `SUPPLIER-DEBT` 共 7 个占位 `enabled=false`）、报表镜像 `ve_reporting_lines`（迁移 324 种子，44 条）、能力契约 `services/api/src/virtual-employees/{skills-catalog,role-capabilities}.js`（44 岗全覆盖）。`check:ve-capabilities` 实测 `problems=0 warnings=8`。

## 5. 产物索引

| 文件 | 用途 |
|---|---|
| `JOB-DESCRIPTIONS.md` | 逐岗说明书（使命/输入/禁止/KPI/四力/现状）、汇报线 §13、人工门 §14、频率 §15 |
| `ORGANIZATION.md`（本文件） | 唯一索引与快照 |
| `org/virtual-employee-reporting-lines.html` | 当前有效的汇报线图 |
| `org/virtual-employee-dispatch.html` | 派工与审批闭环图 |
| `REPORT-SYSTEM.md` | 报告目录、命令、实测基线 |
| `SKILLS-AND-MCP.md` | 岗位能力契约（技能/权限/门/MCP 全量清单），由 `node scripts/ve-capabilities-doc.mjs` 从代码渲染 |
| `AGENT-VERSION-PLAN.md` | Agent 版（接口层，无 UI）实施计划与功能映射 |
| `VIRTUAL-EMPLOYEE-ARCHITECTURE.md` | **旧文档**：Hermes/LangGraph/Express 技术栈仍有效，但组织章节是旧的三桶扁平结构，以本文件为准 |
| `reports/ve-*.md` | 生成物（gitignored），`npm run report:ve` 可重建 |

## 6. 变更规则

1. 新增/改名岗位：先改 `registry.js` 与迁移 324 的种子行（或新迁移，需人工批准），再改本表与频率表。
2. 改汇报关系：改 `ve_reporting_lines.reports_to` + 本表；跑 `npm run report:ve -- --report=integrity` 必须 37/37 OK。
3. 改频率：只改 `frequencies.js`，跑 `tests/virtual-employee-frequency.test.mjs`。
4. 改人工门：改 `humanGates` + `service-identity.js` 权限映射，跑 `tests/virtual-employee-gate.test.mjs` 与实测脚本。
5. 改技能或 MCP：改 `skills-catalog.js`（+ `role-capabilities.js` 分配），跑 `npm run check:ve-capabilities -- --db` 与 `tests/virtual-employee-capabilities.test.mjs`，然后 `node scripts/ve-capabilities-doc.mjs` 重渲染文档；`problems` 必须保持 0。
6. 任何改动都不得触碰 `.factory/locks/**`、`harness/**`、`FACTORY_RULES.md`、`MISSION.md`。

---

## 7. 历史档案（保留，不删）

以下材料是早期创建的，保留作决策记录；**不再作为当前编制与流程的依据**：

| 文件 | 状态 |
|---|---|
| `VIRTUAL-EMPLOYEE-ARCHITECTURE.md` | 早期技术架构说明。Hermes / LangGraph / Express 的栈描述仍有效；组织章节（1 主管 + 11 业务 + 10 IT 的扁平三桶）已被本文件取代 |
| `org/virtual-employee-org.html` 及同名 `.json` / 截图 | 早期 7 部门 34 岗组织图，已被 `org/virtual-employee-reporting-lines.html`（8 部门 37 岗）取代 |
| `HERMES-OPS-SUPERVISOR-PROMPTS.md` | 早期 Hermes 提示档，仍可参考 |
| `WMS-RECEIVING-VIRTUAL-01.md`、`OA-DOCUMENT-CONTROL-VIRTUAL-01.md`、`OA-VIRTUAL-EMPLOYEE-CONTROLLED-DOCUMENTS.md`、`REPLENISHMENT-PURCHASING-OA-GUIDE.md` | 早期单岗业务材料，保留；岗位定义以 `JOB-DESCRIPTIONS.md` 为准 |

不删除的原因：这些文件记录了当初为什么这样设计；删掉只会丢失历史，而当前真源已经由 `ORGANIZATION.md` 明确指向。冲突时以 §2 逐岗表和 `registry.js` / `ve_reporting_lines` 为准。

---

## 8. 已开始运行（2026-11-20）

最小调度器已落地：`services/api/src/agent/runner.js` + `scripts/ve-runner.mjs`（`npm run runner:ve`）。它把真实业务行变成**带门的草稿任务**，只读业务表，只写 `factory_virtual_employee_tasks` / `_events`，不自动批准。

| 探针 | 数据源 | 产出 | 门 |
|---|---|---|---|
| `IQC-VIRTUAL-01` | `iqc_inspections WHERE inspection_result IS NULL` | `IQC_INSPECT` 草稿 | `final_iqc_decision` |
| `WMS-RECEIVING-VIRTUAL-01` | `wms_receipt_orders` 待检行 | `RECEIVING_VALIDATE` 草稿 | `receive_variance` |
| `WMS-INVENTORY-VIRTUAL-01` / `MAINTENANCE-VIRTUAL-01` / `OA-DOCUMENT-CONTROL-VIRTUAL-01` / `SUPPLIER-COLLAB-VIRTUAL-01` | 未签收包裹 / 磨损告警 / 超领待签 / 退货未闭环 | `PACKAGE_SIGNATURE_WATCH`、`WEAR_ALERT_TRIAGE`、`APPROVAL_PACKAGE_CHECK`、`SUPPLIER_RETURN_WATCH` | 见技能目录 |
| `OPS-SUPERVISOR-VIRTUAL-01` | `WAITING_APPROVAL` 任务 | `APPROVAL_ESCALATION` 提醒（OPEN，无门） | 无 |

实测：

```bash
npm run runner:ve -- --dry-run --all --limit=3   # IQC 扫到 1 条，OPS 扫到 3 条
npm run runner:ve -- --employee=IQC-VIRTUAL-01    # 首跑 created=1
npm run runner:ve -- --employee=IQC-VIRTUAL-01    # 再跑 duplicate=1（task_key 幂等）
```

落库证据：任务 `163841` = `IQC-VIRTUAL-01 / IQC_INSPECT / WAITING_APPROVAL / ve:IQC-VIRTUAL-01 / task_key=IQC-VIRTUAL-01:IQC_INSPECT:ZZ-INSP`，并有对应 `AGENT_TOOL_CALL` 审计事件（`actor=ve:IQC-VIRTUAL-01`）。

边界：37 条探针的 taskType 全部是契约里已声明的技能，`tests/virtual-employee-capabilities.test.mjs` 逐条校验（含只读、row_key、LIMIT $1、闸门登记），漂移即红；`runner.js` 每轮先问 `canUseSkill()`，未授权不落任务；调度器已挂进 `start_dev.js` 与生产容器；批准后的业务回写由 `writeback.js` 处理（只推进流程，不写业务台账）。频率配置尚未写回 DB。

### 8.1 自学习与知识收集（同日）

```bash
npm run runner:ve -- --all --limit=5            # 37 条探针，草稿进人工门队列
npm run learn:ve -- --all                       # 人类决定 → DRAFT 案例 + WAITING_REVIEW
npm run learn:ve -- --review=1 --reviewer=admin --pass   # 只有人能批准（ve: 身份被拒）
npm run knowledge:ve -- --all --remember        # 7 岗采集本领域经验并写入 mem0 :9876
npm run knowledge:ve -- --employee=IQC-VIRTUAL-01 --dry-run   # 只采集不入库
npm run runner:ve -- --employee=WMS-RECEIVING-VIRTUAL-01 --rag --limit=40  # 召回知识写入 input.evidence
npm run competency:ve                            # 确定性四力合成（人工签署行不被覆盖）
npm run knowledge:ve -- --docs --remember                   # OA 受控文件 L1 语料（79 条）
npm run approve:ve -- --list                                # 待批队列（按门分组）
npm run approve:ve -- --gate=X --reviewer=<真人> --confirm=<同一个真人>   # 人批，之后自动推进
npm run schedule:ve -- --once --limit=80                     # 按频率表跑一轮（--dry-run 不写）
```

详见 `JOB-DESCRIPTIONS.md` §17–§18。实测（记忆服务在线、新集合 `smt_factory_memory_v2`）：case id=1 `AUTO:1434:HUMAN_APPROVED` DRAFT→APPROVED；`--all --remember` 写入 5 条 `KNOWLEDGE_COLLECTED`，`ve/WMS-RECEIVING-VIRTUAL-01` 语义召回 5 条（top 0.568，带 sourceId）；`--rag` 一轮 scanned 40 / created 38 / cited 5，库内 48 条任务 `input.evidence` 非空；`competency:ve` 后 WMS-RECEIVING 的 `SMART_JUDGMENT` 0→2。不带 `--remember` 只采集不入库；记忆服务不可达时报 `MEMORY_SERVER_UNREACHABLE` 且退出码 1，不假装落库。

## 9. 批准之后与定时执行（2026-11-21）

| 能力 | 代码 | 边界 |
| --- | --- | --- |
| 批准唯一入口 | `services/api/src/agent/approval.js`（HTTP 路由与 `npm run approve:ve` 共用） | 批准人必须具名人类、必须持该域权限键、门必须注册在该岗；条件 UPDATE 防重复批准 |
| 批准后推进 | `services/api/src/agent/writeback.js` | 12 个门有后继草稿任务，41 个门显式写明由人类执行；后继不得是写技能；推进失败不回滚人类的批准 |
| 定时执行 | `services/api/src/agent/scheduler.js` + `scripts/ve-scheduler.mjs`（`start_dev.js` 第 5 个子进程） | EVENT/WATCH 按 intervalSeconds，BATCH 按越南本地 cron，DEMAND 永不自跑；last-run 存 `SCHEDULER_TICK` 事件，不加字段；会话级 advisory lock 保证一个库只有一个调度进程 |
| 生产容器 | `Dockerfile.ve-scheduler` + `docker-compose.ve-scheduler.yml`（overlay，不覆盖主机那份手工 compose） | **已上线**：`smt-ve-scheduler` 每 60s 一跳、advisory lock 生效（第二实例 `SCHEDULER_ALREADY_RUNNING` 退 0）、其它容器未被牵连；`--tick=60 --no-rag`（生产无 memory server） |
| L1 语料 | `knowledge.js --docs` → `ve/shared/controlled-docs` | 只收 published+public+L1/L2/L3（79 条），L4 表单排除；带 `docVersion` 与复审到期日 |

实测：批准→推进→幂等→拒自批 全链跑通（合成任务 203708→后继 203709，验证后 CANCELLED 并留 `PROOF_CLEANED` 事件）；本地调度器同分钟两轮 `fired: []`；受控文件语义召回带版本号；生产上第一轮 `OPS-SUPERVISOR scanned:5 created:5`、报表 job `AGGREGATED rows=1110`、`oa.doc_system` 在生产有 L1 1/L2 30/L3 48/L4 181。详见 `JOB-DESCRIPTIONS.md` §20–§24。

**存量审批已处置（2026-11-21 03:42Z）**：业务授权后以 `MO_LI_BIN`（莫立斌）为批准人，一次清掉 275 条 `WAITING_APPROVAL`（attempted 275 / approved 275 / refused 0）；写回创建 270 条后继草稿（IQC_SUBMIT 265、PM_SCHEDULE 4、LOCATION_BIND 1），5 条按设计不推进。库存与业务表零写入。旧向量集合 `smt_factory_memory` 决定**保留不删**。

已做：**生产待批 200 条**用 `MO_LI_BIN` 清零（`approved_by` 200 行、`HUMAN_APPROVED` 200 事件、`WAITING_APPROVAL=0`）；30 个 `NO_PROBE` 岗位全部补齐探针并验证。跨谱系合并 `65e1743` 已落到当前分支（`180 ahead / 0 behind origin/main`），未 push；`harness/**`、locks、ratchet 基线未碰。待定：是否 push，以及生产调度器镜像是否更新到含新探针的版本。

