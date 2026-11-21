# Agent 协作规则与工作流 · SMT Factory System

**版本**：1.1 · 2026-11-17
**协议对齐**：`D:\rj\rjvn\agent-mailbox\COMMUNICATION-RULES.md` v1.3（canonical）—— 本文件复用其信封、租约、频道与节奏规则，只替换传输层（Redis mailbox / T3 线程），不另立标准。
**适用**：在本仓库并发工作的任何 agent（T3 Code 线程、OpenCode 子代理、Hermes、人工）
**优先级**：`FACTORY_RULES.md` > `MISSION.md` > 本文件 > `app_rules/<lane>.md`

---

## 0. 角色与权威

```
User（唯一权威：范围 / 破坏性变更 / 规则变更）
  └─ Leader（本线程：计划、分派、门禁、裁决）
       ├─ Executor  lanes: repo · auth · ui · runtime · api
       ├─ Validator lane:  validation（只读 + 测试）
       └─ Reviewer / Evaluator（只读，独立于实现者）
```

**没有人给自己的作业打分**：执行者证明"做了什么"，Reviewer 判断"对不对"，Evaluator 度量"有没有变好"，Leader 决定"是否放行"。

---

## 1. 信封（v1.2 兼容 / v1.3 语义）

Redis mailbox 的 `send_message` body 内必须带同样字段；文件型频道（`.factory/mailbox/`）用同构 YAML 头。

```yaml
---
from: <agent>
to: <agent 或 *>
type: task | status | result | alert | dispute | decision
correlation_id: <稳定 id>
reply_to: <被回复的 correlation_id>
idempotency_key: <每个逻辑动作唯一；接收方必须去重>
protocol_version: "1.2"
timestamp: 2026-11-17T12:00:00Z      # 系统 UTC，必须带 Z；本地时间视为缺陷
priority: normal | high | critical
requires_ack: true | false
status: working | blocked | input-required | completed | failed | canceled
---
```

硬规则（来自 v1.3）：

| 规则 | 原因 |
|---|---|
| 时间戳必须是 UTC `Z` | 曾出现未来时间信封被当成"事件已发生"的证据 |
| 未来时间信封只读内容、不作证据 | 同上 |
| 简报只有 Leader **点名撤销**才失效 | 曾出现已撤回计划被执行 |
| 频道 **只追加**；截断写入视为事故 | Leader 频道被覆盖三次 |
| 交付按**结果**验收，不按步骤 | 路径可以不同，终态必须一致 |
| 心跳必须带 **% 完成 + 下一步 + 阻塞** | "working" 无下一步 = 隐藏停摆 |
| 阻塞在**一个心跳周期内**升级 | "waiting" 不是状态 |

---

## 2. 频道与传输

| 层 | 本仓库实现 |
|---|---|
| 点对点消息 | `factory-mailbox` MCP：`send_message(to, type, subject, body, refs, meta)` |
| 收件 | `check_inbox(types=[...])`；长任务用 `mailbox_wait` |
| 广播 | `send_message(to="*")` / `check_broadcast` |
| 文件型归档 | `.factory/mailbox/INBOX-<sender>-<recipient>.md`（只追加） |
| 权威状态面 | `docs/AGENT-WORKFLOW.md` §10 + `.factory/STATEBOARD.md` |
| 已验证事实面 | `.factory/FACTS.md`（只写"命令 + 输出 + 证据路径"） |

命名：`INBOX-<sender>-<recipient>.md`；Leader 收件统一 `.factory/mailbox/INBOX-*-team-lead.md`。

---

## 3. 节奏

| 时刻 | 义务 |
|---|---|
| 收到简报 | **ACK ≤ 10 分钟** |
| 工作中 | **心跳 30 分钟**：`status: working` + `% 完成` + `下一步` + `阻塞` |
| 完成 | `result`：产物路径 + 验收证据；`status: input-required` |
| 阻塞 | 立即升级，点明阻塞 ID 与其 owner |
| 矛盾 | 先提出，不许"默默调整"后继续 |

---

## 4. 认领（租约）

文件锁：`.factory/locks/CLAIM-<artifact>-<agent>.md`

```yaml
agent: <agent>
artifact: <文件或目录>
scope: <禁止触碰的范围>
wave: W0 | W1 | W2 | W3 | W4
started_at: 2026-11-17T12:00:00Z
expires_at: 2026-11-17T14:00:00Z
heartbeat: 2026-11-17T12:30:00Z
```

- **一个产物一个写者**；需要别人的产物 → 找 Leader，不许读改。
- 过期（`expires_at` 超时且无心跳）→ 广播后**显式回收**，不许静默接管。
- 任务结束 → 删除自己的 CLAIM。

---

## 5. 波次与门禁

| 波次 | 内容 | 进入条件 | 退出条件（Gate） |
|---|---|---|---|
| **W0** | Git 基线 | 无 | `git status` 可解释、`.gitignore` 覆盖日志/临时/截图、基线提交存在 |
| **W1** | Security / TypeFix / Restore（并行） | W0 完成 | 见 5.1 |
| **W2** | 拆分 `server.js` | **W1-Security 合入** | 路由声明仍为 1,482；冒烟通过；无新增未鉴权路由 |
| **W3** | 端到端验收 | W1 全部 + W2 | typecheck 0 错、test 全绿、Playwright 主流程通过 |
| **W4** | Review + Evaluate（只读并行） | W1 产物可读 | APPROVE / REQUEST CHANGES + GO / NO-GO + 健康分 |

### 5.1 W1 Gate

| Lane | Gate（必须粘贴实测输出） |
|---|---|
| Security | `node --check services/api/server.js`；未鉴权 `api` 路由 = 0；`POST /api/sql` 404；`x-pda-test-mode` 不再提权；密码来自 DB 哈希 |
| TypeFix | `npm run typecheck` 无输出；`npm run test` ≥ 380 通过 |
| Restore | 3 个 `apps/pdas/*/dist` 存在且非空；`npm run build` 成功；启动日志无 `dist not found` |

**Gate 未过 = 任务未完成**，不得进入下一波。

---

## 6. 交接模板（HANDOFF）

```
LANE: <lane>
STATUS: done | partial | blocked
CHANGED: <文件:行范围>（逐条）
COMMANDS: <实际执行的命令>
VERIFY: <粘贴关键输出，不转述>
NOT DONE: <明确列出；无则 none>
RISKS: <对其他人的影响；无则 none>
NEXT: <建议下一步 + 归属>
EVIDENCE: <产物路径 / commit / 日志>
```

禁止："已完成"但无输出；"应该没问题"；把未完成项藏在正文。

---

## 7. 升级与事故

1. **30 分钟规则**：同一问题卡 30 分钟 → `alert` 升级。
2. **跨 lane 影响**：先 `decision`/`alert` 广播，等 Owner ack 再动手。
3. **需要人决策**：`type: alert` + `requires_ack: true`，停在安全状态（不留半成品 SQL、不删数据、不重启服务）。
4. **急停**：`.factory/STOP` 出现 → 全体停写，只允许读与汇报。
5. **事故记录格式**：发生了什么 · UTC 时间 · 如何发现 · 影响面 · **数据影响（直说）** · 证据路径 · 状态 · owner · **防止规则**。追流程，不追人。

---

## 8. 数据库纪律（本仓库）

1. 默认只读；`catalog` 查询永远允许。
2. 写操作必须持有**命名了具体 database + schema** 的租约；破坏性操作需用户批准 ID。
3. `pg_dump` / `pg_restore` 目标必须显式（`-d <db>`），**绝不依赖 `search_path`**。
4. **禁止 `TRUNCATE`** 目的表。
5. 每个影响 DB 的脚本：**一个人写、另一个人审、第三个人执行**。
6. 本仓库特例：`services/api/server.js` 会在**运行时建表**，迁移不是唯一真源——改 schema 前先确认该表是否已被运行时 DDL 创建。

---

## 9. 分支、提交与 DoD

| 场景 | 做法 |
|---|---|
| 单人 lane、无并发 | 当前 checkout 工作 |
| 多 lane 并行且同文件族 | worktree（`t3_thread_launch` 的 `workspaceStrategy.type="worktree"`），合入前 rebase |
| 提交信息 | `<type>(<lane>): <一句话>` |
| 禁止 | `git add -A`（根目录 400+ 临时文件）、`--force` push、改写历史、提交 `.env` |
| 推送 | 仅 Leader 或人工；agent 只提交不推送 |

**DoD**：Gate 实测通过（贴输出）· 改动只在自有 lane · CLAIM 已释放 · HANDOFF 已发 · 无新增 `@ts-ignore`/`any` 兜底/注释代码 · 无遗留 `_*_tmp.*` 与硬编码凭据。

---

## 10. 当前编排状态（2026-11-17）

| 波次 | 线程 | Lane | 状态 |
|---|---|---|---|
| W0 | `W0 · Git 基线` | repo | 进行中 |
| W1 | `W1 · Security (4 CRITICAL)` | auth | 进行中 |
| W1 | `W1 · TypeFix (113 类型错误)` | ui | 进行中 |
| W1 | `W1 · Restore PDA 应用 + dist` | runtime | 进行中 |
| W4 | `W4 · Code Reviewer` | review | 只读，进行中 |
| W4 | `W4 · Evaluator` | review | 只读，进行中 |
| W2 | 未创建 | api | 等 W1-Security |
| W3 | 未创建 | validation | 等 W2 |

---

## 11. 启动 prompt 前置块

```
Repo: C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system
先读 AGENTS.md 和 docs/AGENT-WORKFLOW.md（对齐 COMMUNICATION-RULES v1.3）。
你的 lane: <lane>；独占范围: <paths>。
不得修改 MISSION.md / FACTORY.md / FACTORY_RULES.md / harness/ / .factory/locks / .factory/holdout。
不得重启或杀死正在运行的 :8080 / :5178 服务。
不得对线上库执行 DROP / ALTER / 删数据；迁移只允许新增文件。
开工前写 .factory/locks/CLAIM-<artifact>-<lane>.md（含 expires_at）。
收到简报 10 分钟内 ACK；每 30 分钟心跳（% 完成 + 下一步 + 阻塞）；卡住 30 分钟升级。
结束时按 HANDOFF 模板汇报，必须粘贴 Gate 实测输出。
```
