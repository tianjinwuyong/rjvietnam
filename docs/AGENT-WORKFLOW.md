# Agent 协作规则与工作流 · SMT Factory System

**版本**：1.0 · 2026-11-17
**适用**：任何在本仓库并发工作的 agent（T3 Code 线程、OpenCode 子代理、Hermes、人工）
**优先级**：`FACTORY_RULES.md` > `MISSION.md` > 本文件 > `app_rules/<lane>.md`

---

## 1. 角色与文件所有权

**单一写者原则**：任一时刻，一个文件只能有一个 agent 在写。冲突不是靠"合并解决"，是靠**不重叠**避免。

| 角色 | Lane | 独占范围 | 禁止触碰 |
|---|---|---|---|
| **Orchestrator** | — | 线程创建、波次编排、验收 | 不写产品代码 |
| **Hygiene** | `repo` | `.gitignore`、git 索引、提交 | 任何 `src/` |
| **Security** | `auth` | `services/api/server.js`、`database/migrations/`（仅新增） | `apps/web/**` |
| **TypeFix** | `ui` | `apps/web/src/**` | `services/api/**`、`apps/pdas/**` |
| **Restore** | `runtime` | `apps/pdas/**`、`apps/web/dist/**` | `apps/web/src/**` |
| **Refactor** | `api` | `services/api/server.js`、`services/api/src/routes/**` | `apps/web/**` |
| **QA** | `validation` | `tests/**`（只新增）、只读其余 | 产品代码 |

**治理文件（任何 agent 都不可改）**：`MISSION.md`、`FACTORY.md`、`FACTORY_RULES.md`、`harness/**`、`.factory/locks/**`、`.factory/holdout/**`。

### 1.1 认领（claim）

开始写文件前，先认领：

```
写 .factory/locks/<lane>.lock  内容: <agent> <ISO时间> <文件或目录>
```

- 锁存在且不是自己 → **停下**，发 `query` 询问，或换任务
- 任务结束 → 删除自己的锁
- 锁超过 2 小时未更新 → 视为失效，可广播 `notice` 后接管

---

## 2. 消息协议（Redis mailbox）

工具：`send_message` / `check_inbox` / `check_broadcast` / `mailbox_wait`
接收方必须**每完成一个步骤就看一次 inbox**，不要等到最后。

### 2.1 消息类型

| 类型 | 何时用 | 必须包含 |
|---|---|---|
| `task` | 分配工作 | 目标、文件范围、验收命令、截止 |
| `query` | 需要决策/澄清 | 问题 + 已试过的方案 + 2 个以上选项 |
| `reply` | 回答 query | 结论 + 依据（file:line） |
| `result` | 阶段性产出 | 改动清单、命令、测试结果 |
| `notice` | 广播变更（接口/契约/schema） | 影响面 + 谁需要行动 |
| `error` | 阻塞或失败 | 失败命令、错误原文、已排除的原因 |

### 2.2 主题命名

```
W{波次}/{lane}/{动作}
例：W1/security/auth-middleware-move
    W1/ui/typecheck-zero
    W2/api/split-wms-routes
```

### 2.3 时限

| 事件 | 时限 |
|---|---|
| 收到 `query` 回复 | 10 分钟内 |
| 状态心跳（长任务） | 每 20 分钟一条 `result`（一句话 + 当前进度%） |
| 阻塞上报 | 立即（不要自己硬扛超过 30 分钟） |

---

## 3. 波次与门禁

**W 序列不可乱序**：后一波依赖前一波的产物或已释放的锁。

| 波次 | 内容 | 进入条件 | 退出条件（Gate） |
|---|---|---|---|
| **W0** | Git 基线 | 无 | `git status` 干净、`.gitignore` 覆盖日志/临时/截图、基线提交存在 |
| **W1** | Security / TypeFix / Restore（并行） | W0 完成 | 见下 3.1 各自 Gate |
| **W2** | 拆分 `server.js` | **W1-Security 合入** | 路由声明总数仍为 1,482；冒烟通过；无新增未鉴权路由 |
| **W3** | 端到端验收 | W1 全部 + W2 | typecheck 0 错、test 全绿、Playwright 主流程通过 |

### 3.1 W1 各自 Gate

| Lane | Gate（必须实测粘贴输出） |
|---|---|
| Security | `node --check services/api/server.js` 通过；未鉴权 `api` 路由数 = 0；`POST /api/sql` 404；`x-pda-test-mode` 不再提权；密码来自 DB 哈希 |
| TypeFix | `npm run typecheck` 无输出；`npm run test` ≥ 380 通过 |
| Restore | 3 个 `apps/pdas/*/dist` 存在且非空；`npm run build` 成功；API 启动日志不再有 `dist not found` |

**Gate 未过 = 任务未完成**，不得声称完成，不得进入下一波。

---

## 4. 交接模板（HANDOFF）

每个 agent 结束时必须发 `result`，格式固定：

```
LANE: <lane>
STATUS: done | partial | blocked
CHANGED: <文件:行范围>（逐条）
COMMANDS: <实际跑过的命令>
VERIFY: <粘贴关键输出，不要转述>
NOT DONE: <明确列出未完成项，没有就写 none>
RISKS: <可能影响其他人的点；没有就写 none>
NEXT: <建议下一步由谁做>
```

**禁止**："已完成"但没贴验证输出；"应该没问题"；把未完成项藏在正文里。

---

## 5. 升级与止损

1. **30 分钟规则**：同一问题卡住 30 分钟 → 发 `error`，不要静默硬扛。
2. **跨 lane 影响**：改动会触及别人文件 → 先 `notice` 广播，等对方 ack（`reply`）再动手。
3. **需要人决策**：发 `error` 类型 + 标记 `needs-human`，然后**停在安全状态**（不留半成品 SQL、不删数据、不重启服务）。
4. **全局急停**：仓库根出现 `.factory/STOP` 文件 → 所有 agent 立即停止写操作，只允许读和汇报。

---

## 6. 分支与提交

| 场景 | 做法 |
|---|---|
| 单人 lane、无并发 | 直接在当前 checkout 工作 |
| 多 lane 并行且都改同一文件族 | 用 worktree（`t3_thread_launch` 的 `workspaceStrategy.type = "worktree"`），合并前 rebase |
| 提交信息 | `<type>(<lane>): <一句话>`，例：`fix(auth): load password hashes from db` |
| 禁止 | `git add -A`（根目录有 400+ 临时文件）、`--force` push、改写历史、提交 `.env` |
| 推送 | 仅 Orchestrator 或人工执行；agent 只提交不推送 |

---

## 7. 完成定义（DoD）

一个 lane 完成 = **全部满足**：

1. Gate 命令实测通过（贴输出）
2. 改动只落在自己的 lane 内
3. 锁已释放
4. HANDOFF 已发
5. 没有新增 `@ts-ignore` / `any` 兜底 / 注释掉的代码
6. 没有遗留 `_*_tmp.*`、调试日志、硬编码凭据

---

## 8. 禁止事项（Anti-patterns）

- 改治理文件、改自己的验收标准
- 在别人的文件里"顺手修一下"
- 为了让测试变绿而放宽断言
- 用 `git add -A` 或把 400 个临时脚本一起提交
- 在共享 checkout 里起/杀 dev server（会打断其他人）
- 对线上库跑 `DROP` / `ALTER` / 删数据
- 不看 inbox 就长时间埋头改

---

## 9. 落地：启动 prompt 前置块

每次拉起 agent，把这段贴在最前面：

```
Repo: C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system
先读 AGENTS.md 和 docs/AGENT-WORKFLOW.md。
你的 lane: <lane>；独占范围: <paths>。
不得修改 MISSION.md / FACTORY.md / FACTORY_RULES.md / harness/ / .factory/locks / .factory/holdout。
不得重启或杀死正在运行的 :8080 / :5178 服务。
不得对线上库执行 DROP / ALTER / 删数据；迁移只允许新增文件。
开工前写 .factory/locks/<lane>.lock；结束删除。
每 20 分钟发一次 result 心跳；卡住 30 分钟发 error 升级。
结束时按 HANDOFF 模板汇报，必须粘贴 Gate 实测输出。
```

---

## 10. 当前编排状态（2026-11-17）

| 波次 | 线程 | Lane | 状态 |
|---|---|---|---|
| W0 | `W0 · Git 基线` | repo | 进行中 |
| W1 | `W1 · Security (4 CRITICAL)` | auth | 进行中 |
| W1 | `W1 · TypeFix (113 类型错误)` | ui | 进行中 |
| W1 | `W1 · Restore PDA 应用 + dist` | runtime | 进行中 |
| W2 | 未创建 | api | 等 W1-Security |
| W3 | 未创建 | validation | 等 W2 |
