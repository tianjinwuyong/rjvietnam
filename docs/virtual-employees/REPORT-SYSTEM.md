# 虚拟员工报告系统

运行态测量层，回答四件事：**编制是否真实、汇报线是否合法、岗位是否在干活、人工门是否堵住**。全部派生自既有运行时表，不新增业务写入路径。

## 1. 组成

| 文件 | 用途 |
|---|---|
| `database/migrations/324_virtual_employee_reporting_system.sql` | `ve_reporting_lines`（44 行编制镜像）、`ve_kpi_daily`、`ve_competency_snapshots` + 7 个只读视图 + `ve_v_report_catalog`（报告目录） |
| `scripts/ve-report.mjs` | 报表生成器：`--aggregate` 计算日 KPI；`--report=<id>` 出报告；`--format=json`；`--out=<dir>` |
| `package.json` → `report:ve` | 命令入口 |
| `docs/virtual-employees/reports/ve-*.md` | 首次实测输出（2026-11-20） |

## 2. 报告目录

| ID | 报告 | 节奏 | 受众 | 源视图 |
|---|---|---|---|---|
| `roster` | 在岗花名册与汇报线 | 实时 | 厂长 / 主管 | `ve_v_roster` |
| `integrity` | 汇报线完整性（必须全 OK） | 实时 | 厂长 / 发布门 | `ve_v_line_integrity` |
| `load` | 部门负载（近 7 日任务） | 每日 | 总监 / 主管 | `ve_v_department_load` |
| `throughput` | 人工审批吞吐 | 每日 | 厂长 / 班组长 | `ve_v_approval_throughput` |
| `competency` | 四力档案矩阵 | 每周期 | 厂长 / 人事 | `ve_v_competency_matrix` |
| `coverage` | 岗位落地覆盖 | 每周 | 总监 / 平台主管 | `ve_v_coverage` |
| `kpi` | 岗位日指标 | 每日 | 主管 / 岗位本人 | `ve_v_kpi_latest` |

## 3. 使用

```bash
npm run report:ve -- --aggregate                       # 先算近 30 天日 KPI（幂等，可反复跑）
npm run report:ve -- --report=all                      # 全部报告，Markdown 到 stdout
npm run report:ve -- --report=integrity,load           # 指定报告
npm run report:ve -- --report=all --format=json        # 机器可读
npm run report:ve -- --report=all --out=docs/virtual-employees/reports
```

连接参数与 `scripts/migrate.mjs` 相同：读根目录 `.env` 的 `PG*` 键，禁止在 bash 里 `source`（CRLF 会让 `getaddrinfo` 失败）。

## 4. 首次实测基线（2026-11-20，真实库数据）

| 报告 | 实测 |
|---|---|
| `integrity` | **37/37 全部 OK**，无悬空父级、无自环、无非虚拟员工父级（`OPS-SUPERVISOR` → `HUMAN` 是唯一例外，符合设计）。 |
| `load` | 37 个在岗 + 7 个占位；仅 D1 有任务量：`183` 条/7 日。D2–D8 全部 `0`。 |
| `coverage` | 只有 `WMS-RECEIVING-VIRTUAL-01` 有真实痕迹：183 条任务 / 325 条事件；**其余 36 个在岗岗位 tasks=0、events=0**。`training_cases=0`、`evaluations=0` 覆盖全员。 |
| `throughput` | 2026-11-19：`WMS-RECEIVING` 的 `receive_variance` 门 **183 条待批、0 条批准、183 条阻塞**，等待时长无法计算（`completed_at` 全空）。这不是效率问题，是人工审批链根本没接上。 |
| `kpi` | 聚合后 37 行（近 30 天 × 在岗岗位）；`WMS-RECEIVING` 当日 `tasks_created=183 / awaiting_approval=183 / approval_granted=0`。 |
| `competency` | 37 行，`forces_assessed=0`（四力档案无人填，符合当前代码状态）。 |

结论：**汇报线设计是完整的，落地几乎为零**。唯一的执行器（收料）恰好也是唯一堵在人工门上的岗位——先修审批链，再谈扩编到 37 岗。

## 5. 数据契约与不变式

- `ve_reporting_lines` 是 `registry.js` 的关系镜像，`HUMAN` 是唯一非虚拟上级。
- `enabled=true` 的岗位，其 `reports_to` 必须在同表存在且 `staffing IN ('主管','指挥')`；`integrity` 报告实时检查。
- `ve_kpi_daily` 以 `(employee_id, day)` 唯一，`--aggregate` 用 `ON CONFLICT DO UPDATE`，可重复执行。
- `ve_competency_snapshots` 以 `(employee_id, period_start, period_end, force)` 唯一，四力取值受 CHECK 约束，等级 0–4，需要人工签署（`assessed_by`）后才算有效。
- `ve_v_report_catalog` 是报告自描述目录，新增报告只需在脚本的 `REPORTS` 与目录视图各加一行。

## 6. 尚未实现（明确边界）

- **没有 HTTP 接口与前端页面**：目前是 CLI + 库视图，没有 `/api/factory/virtual-employees/reports/*`，也没有 React 面板。
- `ve_competency_snapshots` 已由 `competency` job（周一 06:00，`npm run competency:ve`）自动填入：全员 `forces_assessed=4`；批量批准之后重算，**只有 `WMS-RECEIVING-VIRTUAL-01` 的 `min_level` 从 0 升到 1**（它的 `tasks_approved` 有值），其余 36 个在岗岗位仍全 0 —— 没有任何一力达到"主管与总监须 ≥3"的门槛。分数完全由数据量导出，缺"人工评估 → 签字存档"这一层：`factory_virtual_employee_training_cases` 至今只有 **1 条 `APPROVED`**（其余状态 0 条），够不到 `cases_approved >= 3` 的那一档。
- `--aggregate` 已进日报调度（`scheduler.js` 的 `report` job，越南时间 07:15，见 `JOB-DESCRIPTIONS.md` §21–§22），但**每人每日 ≤30 单这条口径没有强制**：`approve:ve` 批量批准不计数、不告警（2026-11-21 一次批了 275 单，见 §9）。要真正约束需一个批准计数闸门，属策略决定。
- 报告只读，不修改 `registry.js`；新增岗位仍需同时改 `registry.js` 与本迁移的数据行（两份真源，这是刻意的：注册表给运行时，关系表给报表与门）。

## 7. 验证记录

```
npm run check:migrations   → MIGRATIONS_OK files=340 prefixes=45 baseline=45
node scripts/migrate.mjs   → 324_virtual_employee_reporting_system.sql applied
npm run report:ve -- --aggregate → AGGREGATED rows=1110
npm run report:ve -- --report=all --out=... → 7 份报告写出，行数 44/37/9/1/37/44/37
```

---

## 8. 后续修复（2026-11-20）

`throughput` 报告里那 183 条 `receive_variance` 待批任务现在**可批**：`POST /api/factory/virtual-employees/tasks/:taskId/approve` 已接上 `humanGates` 服务端强制与人类审批人校验，详见 `JOB-DESCRIPTIONS.md` §14。存量任务**未被自动批准**——仍需业务负责人逐条或按授权批量决策。重跑 `npm run report:ve -- --aggregate && npm run report:ve -- --report=throughput` 即可看到批准数变化。

## 9. 积压清零之后的吞吐（2026-11-21 03:42Z）

业务授权后一次性批准全部待批：`approved_by=MO_LI_BIN` 275 行、`HUMAN_APPROVED` 事件 275 条、`WRITEBACK_APPLIED` 累计 272 条。`--aggregate` 重跑后 `rows=1110`，`throughput` 报告变成：

| day | human_gate | employee_id | gated_tasks | approved | blocked |
| --- | --- | --- | --- | --- | --- |
| 2026-11-20 | receive_variance | WMS-RECEIVING-VIRTUAL-01 | 41 | 41 | 0 |
| 2026-11-20 | return_machine_to_service | MAINTENANCE-VIRTUAL-01 | 2 | 2 | 0 |
| 2026-11-20 | hand_over_package | WMS-INVENTORY-VIRTUAL-01 | 1 | 1 | 0 |
| 2026-11-19 | receive_variance | WMS-RECEIVING-VIRTUAL-01 | 226 | 226 | 0 |
| 2026-11-19 | hand_over_package / approve_document / return_machine_to_service / final_iqc_decision | 各自岗位 | 2 / 2 / 2 / 1 | 全部相等 | 0 |

两点要如实说明：

1. **`blocked` 归零、`approved` 补上，但 `p50_wait_ms` / `p90_wait_ms` 仍为空**。批准把任务从 `WAITING_APPROVAL` 放到 `OPEN`，`completed_at` 依然为空——等待时长要等任务真正执行完才计算得出来。这不是批准漏了什么，是这条指标本来依赖执行侧闭环。
2. **每人每日 ≤30 单的口径这次被突破**：275 单在一次批处理里由同一人批准，报告不会自动告警（它按天聚合、按门分组，看不到单次批量）。批量批准是授权行为，但"一次 275 条"本身应当有约束，见 §6 尚未实现。

## 10. 生产积压清零与探针覆盖（2026-11-21 07:12Z）

生产库同一 CLI 以 `MO_LI_BIN` 批准 **200 条**（5 + 195，`refused=[]`）：`approved_by` 200 行、`HUMAN_APPROVED` 200 事件、`WRITEBACK_APPLIED` 197、`WRITEBACK_DECIDED` 3，`WAITING_APPROVAL=0`；后继 OPEN 草稿 `IQC_SUBMIT` 191 / `PM_SCHEDULE` 4 / `LOCATION_BIND` 2。这 200 条与 §9 的 275 条是**两个不同数据库**，不能相加报表。

探针补齐后 `PROBES=37`，覆盖全部频率岗位（此前 30 个岗位每跳 `skipped:"NO_PROBE"`）。`registry.js` 也从 23 条补到 44 条，与 `ve_reporting_lines` 一致。本地 37 岗 `dryRun` 实测 13 岗有真实待办、24 岗空队列、`skipped=0`；生产 schema 上 30 条新 SQL 全部实测可执行。`competency` 报表此前只出现一条 WMS-RECEIVING 提级（`min_level` 0→1），岗位基数扩大后该报表的分母会随真实任务增长，不应人工造训练案例凑数。
