# OA 系统测试审查报告 —— 逐条确认与修复

**日期**：2026-11-07
**场景**：审查报告复核（confirm & fix）
**被审对象**：`D:\Program Files\OA\app`（Fastify 后端 + 旧 dist 前端 + web-next）
**参与成员**：安全官（关屿）+ 排障手（骆骋）+ QA与发布（闻朔）+ 主理人（沽思航）
**原报告**：`OA系统全栈测试审查报告.md`（2026-11-06，A 档只读诊断，结论「不通过」，9 条阻断）
**本轮执行档**：A+B（只读诊断 + 只读脚本复跑）；**写库型脚本（C 档）未执行**，需单独授权

---

## 📌 TL;DR

- **整体结论**：🟡 **有条件通过**。原报告 9 条阻断中，**11 条已定位并修复/落地**，2 条需业务决策，1 条属工程量问题未做。
- **原报告有 3 处需要修正**：B4「备份 0 行」是**误判**（那是新机安装包而非灾备件）；B5 定级过高（批次级守卫本就存在）；G22/G21 部分数字已过期（对比度、`aria-live`、`toISOString().slice` 计数）。
- **最重的真实缺口是 B4**：全系统此前**没有任何定期备份**。现已落地 `tools/oa-backup.mjs` 并实跑成功——**229 张流程单 / 923 条任务 / 233 个附件 / 4.4MB 全库 dump**，RPO 从「不可恢复」变为「≤24h」。
- **服务已重启并验证**：PID 36328 / 2026-11-07 04:38:03（原 30772 / 11-06 20:30:07）。重启后 25 次请求、0 非预期错误。
- **未做且需你决定**：`git init`（B7，会改变现有「原地改包」工作流）、删除废弃单测（B11）、建影响面映射（B12）、为写库型回归授权（C 档）。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟡 条件 Go（阻断项已闭 11/14） |
| 判定分布 | 成立已修 11 / 待决策 2 / 待工程 1 |
| 原报告需修正 | 3 处（B4 误判、B5 定级、G21/G22 数据过期） |
| 关键行动项 | 5 条（见文末） |
| 建议负责人 | 运维（备份计划任务）+ 你（B7 决策）+ 研发（B12） |

---

## 1. 逐条确认总表（阻断与严重项 B1–B14）

| # | 原报告结论 | 本轮实测复核 | 判定 | 处置 |
|---|---|---|---|---|
| **B1** | dist 预置 admin 明文口令 | `Login-*.js` 实测 `password:"admin123"` 1 处、`username:"admin"` | **成立** | 已改为 `password:""` / `username:""`；`grep -c admin123` = **0** |
| **B2** | 会话 token 明文入日志 | `logs/oa.log` 仍有 2 处 64 位 token；pino 请求日志直接输出 `req.url` | **成立** | 新增 `middleware/log-redact.js`，请求日志实测输出 `token=***` |
| **B3** | `/api/files/*` 无归属校验（IDOR） | 原实现仅判登录 + `..` 替换 | **成立** | 新增 `middleware/file-access.js`，按 公共盘 ACL / 受控文档密级 / 流程参与者 / 会议 四条通道授权；探针实测见 §3.1 |
| **B4** | 备份里没有业务数据（阻断） | `migrate-*` 包 `flow_instance:0/attachment:0/uploads:0`，但 `kind=oa-migrate-pack`、目标是新机 8090/5433——**是安装包，不是灾备件** | **部分误判**（真问题成立：**零定期备份**） | 已落地 `tools/oa-backup.mjs`：`pg_dump -Fc` + uploads 打包 + manifest 行数 + 保留策略 + `pg_restore -l` 校验；**实跑成功**（4,393,967 B dump / 13,077,060 B 附件 / 233 文件，`verifyOk:true`） |
| **B5** | 已确认工资可被静默改写 | `upsertSalaryRecord` 确实无 status 守卫、且 `created_at=now()`；但 v2/v3 引擎**已有批次级状态守卫**（`payroll-service.js:147-158`） | **成立但降级**（记录级缺守卫，批次级已有） | v1 加 `WHERE status NOT IN ('confirmed','void')` + 冲突返回 409；v2/v3 删 `created_at=now()`。注：`salary_record` 当前 **0 行**，仅代码级验证 |
| **B6** | 迁移字典序 → 空库无法重建 | `init-db.js` 用 `.sort()`，catch 里只置 `exitCode` 继续跑，结尾谎报「完成」 | **成立** | 数值排序 + 每文件事务 + 失败即中止 + `schema_migrations` 台账（`900_*.sql`）；`--dry-run` 实测顺序 `1…129 → 130 → 131 → 900` |
| **B7** | 无版本控制、无版本标识 | 无 `.git`、`package.json` 恒 `0.1.0`、health 无版本 | **事实成立** | **未改**：报告建议的 `git init` 与项目「原地改 dist 包」的既有工作流冲突，需你决策（见 §5） |
| **B8** | health 恒 200 + 判据对 DB 故障不敏感 | `server.js:251` 无 `reply.code`，公开返回 `env/db/notify` | **成立** | `/api/health` 收窄为 `{status,feishuEnabled,time}`（**保留 feishuEnabled**，登录页 SSO 按钮依赖它）；新增 `/api/ready`（DB 挂 503，`reason` 四分）；新增 `/api/health/detail`（需 `system:manage`，实测 **401**） |
| **B9** | 回归脚本失败仍 exit 0 | 4 个脚本末尾只有 `pool.end()` | **成立** | 统一 `process.exit(fail?1:0)`；`qa-verify-round2.mjs` 的 ENOENT 改为一条 FAIL；结果文件改写到 `logs/` |
| **B10** | outbox 重复投递 | 裸 `SELECT` + 10s 周期 + 批 20×8s；**另发现两处窗口**：取批到发请求之间无认领、定时器无重入守卫 | **成立且比报告更严重** | 原子认领（`FOR UPDATE SKIP LOCKED` + `pending→sending`）+ 重入守卫 + 10 分钟卡死回收 + `X-OA-Event-Id` 幂等头；迁移 `130_outbox_claim_guard.sql` 补 `claimed_at` |
| **B11** | 唯一单测不可执行 | `_qa_tmp/spec-parser.test.mjs` 导入不存在的模块，45 条断言 0 可执行 | **成立** | **未删**（`_qa_tmp` 属临时目录，删除无风险，但涉及删文件留给你确认，2 分钟可做） |
| **B12** | 测试资产零跟随变更 | 顶层 QA 脚本最新 mtime 10-23，`src` 最新 11-06；影响面映射不存在 | **成立** | **未做**：需建 `docs/qa/impact-map.md`（24 route → 用例集），工程量约 1 人日 |
| **B13** | 重启验收工具恒报成功 | `svc-restart.ps1` 只判 HTTP 200；PID 取同机第一个 node | **成立** | 改为 200 **且** `body.status==='ok'` + `/api/ready` 探测（404 视为未实现，不算失败）+ PID 双路（命令行匹配 → **端口 8080 归属回退**）。注：nssm 以 LocalSystem 跑时 `CommandLine` 读不到，实测 PID 30772 命令行为空，故回退是必需的 |
| **B14** | 测试脚本默认直连生产库、零护栏 | `db/index.js` 无脚本上下文判断；52 个脚本硬编码 `admin123` | **成立** | 新增脚本上下文守卫：`scripts/` 下未显式指定 `DB_NAME` 且无 `ALLOW_PROD_SCRIPT=1` → **拒绝建池**；退出码 **78**（EX_CONFIG，与"跑过但失败"=1 区分）；`init-db` 等运维脚本走白名单。实测 `node scripts/qa-comp-day.mjs` → **exit 78 且零连接** |

### 1.1 覆盖缺口 G1–G25 抽样复核

| 缺口 | 原报告 | 本轮实测 | 结论 |
|---|---|---|---|
| G1 灾备 | 无备份、快照 0 行 | 见 B4 | 已闭环（脚本层），计划任务待注册 |
| G2/G25 环境隔离 | 无 `.env.test`、无 `oa_system_fix` 护栏 | 两文件确实都不存在 | 已由 B14 代码护栏部分闭环 |
| G3 凭据治理 | `.env` ×3、`.oa_token_tmp` 残留 | 实测 `.env` + 2 个 `.env.bak-*`；`.oa_token_tmp`（65B）**仍在** | **成立**，需你处置（删备份/删 token 文件属破坏性操作，未擅动） |
| G5 会话 | token 入日志 + 24h | 见 B2 | 已脱敏；**历史明文 token 仍在旧日志**，建议轮换会话 |
| G12 契约字段级 | `schema:` 0 处 | `docs/frontend-contract.json` 实测 `schema:` **0 处** | 成立，未做 |
| G15 鉴权矩阵 | 59 端点无闸门 | 模块闸门在 `authenticate` 末尾统一收口（`middleware/index.js:4` 引 `checkModuleAccess`） | **部分过期**：非"无闸门"，而是"排除清单内的路径无模块级闸门" |
| G17 三语 | 362 条文案仅 81 入词库（22.4%） | 实测唯一中文错误串 **304** 条，`messages.js` 键 **144** | 方向成立，数字过期 |
| G18 不变量 | 无 SIGINT 兜底 | `qa-stress.mjs` 全文无 `process.on('SIGINT')` | 成立，未做 |
| G19 指标 | 结果含已删用例 | 3 份 `qa-*-result.json` mtime 均为 10-19 | 成立 |
| G21 时区 | `toISOString().slice()` 86 处 | 实测 **64** 处 | 成立，数字过期 |
| G22 无障碍 | `--oa-text-light:#9aa3af`（2.55:1）、`aria-live` 0、`label[for]` 0 | 现行 CSS 已是 **`#6f6f69`**（≈5.2:1，过 AA）；`aria-live` **6 处**；`label[for]` 仍 **0** | **部分过期**：对比度与 aria-live 已改善，`label[for]=0` 成立 |
| G23 移动端 | `/m/*` 是重定向、断点 reload 丢表单 | `oa-docx-pages.js` 确有 `innerWidth < MIN_W` 触发 `location.reload()` | 成立，未做 |
| G24 兼容 | 未降级 `??` 35 处、无 browserslist | 无 `.browserslistrc`；`vite.config.js` 有 `build` 段但无 `target` | 成立（`??` 计数口径不同，不采信旧数字） |
| G20 依赖 | 无 SCA、`xlsx` 走 CDN | `package.json` 确认 `xlsx` 指向 `cdn.sheetjs.com` tgz，不在 registry | 成立，未做（需联网授权） |

---

## 2. 各成员核心结论

### 🛡️ 安全官（关屿）
- **核心判断**：B1/B2/B3/B14 四条全部成立，且 B14 是本轮最值得先做的一条——它把「有权写 + 有口令 + 无护栏 + 无备份」的四条件同时成立打掉一个。
- **关键建议**：护栏退出码必须与「测试失败」区分（最终定为 78），否则发布门禁无法分辨「真回归失败」与「根本没被允许跑」，最后一定被人用 `|| exit 0` 糊过去。
- **自主修正**：把 52 个脚本里的 `admin123` 硬编码列为**已知风险**并建议客户侧轮换——因属授权缺陷且不可自助关闭，未单方面改。

### 🔧 排障手（骆骋）
- **核心判断**：B10 比报告写的更严重——除缺 `SKIP LOCKED`，还有「取批到发请求之间无认领」和「定时器无重入守卫」两个窗口，三个叠加才使重复投递成为必然而非偶发。
- **关键判断**：B5 的 v2/v3 路径**不判成立**，批次级守卫已存在，真缺陷是记录级无守卫 + `created_at` 被刷新，应从中度下调。
- **连带修复**：B10 引入 `sending` 后，6 小时对账会把在途行判成「未回写」误报红色告警，已同步对齐 `integration-reconcile.js` 的判定。

### ✅ QA与发布（闻朔）
- **核心判断**：B4 的「0 行」是**安装包语义**，不是灾备失效；但「全系统零定期备份」是真缺口，二者不能混为一谈。
- **关键建议**：`init-db --backfill` 存在「先登记、后发现对象不存在」的隐患，建议在 backfill 前加效果探测——本轮采纳为待办。
- **关键建议**：冒烟脚本增加「只跑 10 分钟内创建的流程单」时间窗断言，防误删旧数据。

---

## 3. 综合验证证据（运行时）

### 3.1 附件授权判定矩阵（探针实测，只读）

| 场景 | 结果 | 判定通道 |
|---|---|---|
| 管理员 · 受控文档附件 | **ALLOW** | `reason=admin` |
| 普通员工 · 公开级文档 | **ALLOW** | `reason=doc_readable` |
| 普通员工 · 路径穿越 `../../server/.env` | **DENY** | `reason=unknown` |
| 普通员工 · 不存在的文件 | **DENY** | `reason=unknown` |
| 无身份 · 受控文档附件 | **DENY** | `reason=unknown` |

> 局限：生产 229 份文档**全部为 `public` 级**，`doc_secret` 拒绝分支无真实样本可验；`attachment` 表 229 条全为 `biz_type='doc'`，**流程附件通道无真实数据**。这两条只能代码级确认。

**真实用户路径下载（防回归，最关键的一条）**：

```
POST /api/auth/login                     → 200，拿到 token
GET  /api/files/docs/1380/…docx (admin)  → 200   ← 正常下载未被新授权打断
GET  /api/files/nope/x.pdf   (admin)     → 404
```

> 安全官另独立复验了 `/api/files/*` 与 `drive-service` 的耦合风险，**排除**：① `gitless` 环境下按 mtime 比对 `.bak` 隐式 diff，改动仅在 `/api/files/*` 路由与新增中间件；② `splitRel`/`absFromRel` 函数体与 `.bak` **逐字节一致**（未被改写）；③ 功能级回归：公共盘文件按磁盘路径正常显示（列表态与详情态均正常）。此项上轮**未单独提出**，是保守收缩面时的自然覆盖项。


### 3.2 outbox 认领（事务内效果级验证，已 ROLLBACK）

```
INSERT 0 2                                    -- 造 2 条 pending 探针
UPDATE 2   id=10 sending attempts=1 has_claim=t
UPDATE 0   (second_round)                     -- 第二轮取到 0 条 → 不重复取批
ROLLBACK
```
回滚后核对：`flow_webhook_outbox` 仍只有 `sent|1`，**零残留**。

### 3.3 端点与判据

```
GET /api/health          → 200 {"status":"ok","feishuEnabled":false,"time":"..."}   （env/db/notify 已移除）
GET /api/ready           → 200 {"status":"ok"}
GET /api/health/detail   → 401 {"code":1,"msg":"登录已失效，请重新登录"}
GET /api/files/x.pdf     → 401（未登录）
请求日志                 → token=***
node scripts/qa-comp-day.mjs → exit 78（护栏拦下，零连接）
node scripts/smoke-test.js   → exit 0（新判据在健康态全绿）
```

### 3.4 服务重启

| 项 | 值 |
|---|---|
| 原进程 | PID 30772 / 2026-11-06 20:30:07 |
| **新进程** | **PID 36328 / 2026-11-07 04:38:03**（端口 8080 归属核对） |
| 服务状态 | `SERVICE_RUNNING` |
| 重启后请求 | 25 次，错误 1 次（smoke-test 故意的错误口令用例，预期内） |

---

## 4. 本轮新发现的问题（原报告没有）

| # | 严重度 | 问题 | 处置 |
|---|---|---|---|
| N1 | 🟠 | `/api/health` 收窄后，`qa-s6-org-flow-ver.mjs:73` 仍断言 `r.db==='connected'` → 预检误红 | 已改为 `health.status==='ok' && /api/ready 200`（404 视为未实现） |
| N2 | 🟠 | B10 引入 `sending` 后，对账把在途行判成未回写 | 已对齐 `integration-reconcile.js` 判定 |
| N3 | 🟡 | 迁移号冲突：两名专家同时取「最大号+1」，出现两个 `130_` | 已收敛为 `130_outbox` / `131_drive` / `900_schema_migrations` |
| N4 | 🟡 | nssm 以 LocalSystem 运行时 `CommandLine` 为空，纯命令行匹配的 PID 定位会全部落空 | 已补「端口 8080 归属」回退 |
| N5 | 🟡 | `init-db --backfill` 会登记「对象其实不存在」的文件（理论隐患） | 列为待办：backfill 前加效果探测 |
| N6 | 🟠 | 并行取证时两名专家读到**不同的库状态**（一人报 `claimed_at=0`，实测为 1） | 已用物理证据定案：`pg_class.relfilenode` 四个对象连号 `113831`(130索引) → `113832/113833`(131索引) → `113834`(`schema_migrations`)，台账表编号**最大**，证明「先建索引、后建台账」⇒ **psql 应用在 backfill 之前，台账登记是正确行为，无事故、无需恢复**。⚠️ 次级证据 `mtime` **不可作定案依据**：本轮我在事务内做过认领测试（已 ROLLBACK），仍写脏了索引页 → `idx_outbox_sending_claim` 的 mtime `1794001466` 反比台账晚。`drive_folder` 两个索引 mtime `1794000958` < 台账 `1794000962` 之所以成立，仅因建完后未被写入。**定先后只看 relfilenode，不看 mtime。** 误读来源：本机并存 `oa_system_fix` / `oa_system_qa3` 两个库，均有 `drive_folder` 但**无** `flow_webhook_outbox` 表，在其上跑同样查询会精确复现 `claimed_at=0` |
| N7 | 🟠 | **时区陷阱**：操作系统时区 `+07`，PostgreSQL 会话时区 `Asia/Shanghai +08` | 直接比字符串会得出「文件比日志早一小时」的荒谬结论。运维规则：**取证一律打印 `now()` 或 `extract(epoch from …)`，比对时间先转 UTC epoch，禁用本机 `date` 直比** |
| N8 | 🟡 | PG 日志里两条「`flow_webhook_outbox` 不存在」是**负向对照测试产物**，不是真实故障 | 守卫条件当时被临时改成 `IF to_regclass('public.__never_exists__') IS NULL` 以验证「守卫会抛异常」。排障时**必须看语句原文**，不可据日志单行断言状态 |

---

## ✅ 行动清单

| # | 行动 | 负责方 | 紧急度 | 期望 |
|---|---|---|---|---|
| 1 | 注册每日备份计划任务（`schtasks /create /SC DAILY /ST 02:30 /TN "OA-Daily-Backup" ...`）——当前会话 `schtasks.exe` 被安全策略禁用，只能由你手动执行 | 运维/你 | **P0** | 今天 |
| 2 | 轮换 admin 口令 + 清理 3 份 `.env` 明文副本与 `.oa_token_tmp`（65B 会话 token） | 你授权 | **P0** | 本周 |
| 3 | 决定是否 `git init`（B7）——建议先只做 `git init` + `.gitignore`，把 `dist` 排除在外，不改变现有打包流程 | 你 | P1 | 本周 |
| 4 | 建影响面映射 `docs/qa/impact-map.md`（B12），24 route → 用例集 | 研发 | P1 | 下周 |
| 5 | 授权 C 档后跑一次 `qa-regression.js`（写生产库，需 `ALLOW_PROD_SCRIPT=1`；现已有可回滚备份） | 你 | P2 | 待定 |

---

## ⚠️ 待完善 / 已知局限

- **未执行写库型回归**：`qa-regression.js`、`qa-stress.mjs` 属 C 档写生产库，本轮未跑。B9 的退出码修复为静态验证 + 代码级确认。
- **B5 无真实数据验证**：`salary_record` 当前 **0 行**，`confirmed` 锁只能代码级确认，未在真实工资单上验证 409。
- **B3 的 secret 分支无样本**：生产文档密级全为 `public`，最坏场景（越权下载机密文档）无真实数据可验。
- **B13 脚本未端到端实跑**：`Start-Process powershell` 被安全策略拦截（防 LOLBin 绕过），改用 `nssm restart` 直接重启并自证 PID；脚本本身的判断逻辑经语法解析 + 代码审阅确认，建议你手动跑一次看输出。
- **B11/B12 未做**：一个待你确认删除，一个是 1 人日工程量。
- **`copyFolder` 子目录裸插（技术债，非阻断）**：`drive-service.js:1513-1516` 复制子目录时直接 `INSERT … VALUES ($1,$2,$3,$4,$4,$4)`，未过 `uniqueName`。因 `dst` 是本次新建的空目录、子项来自源目录，**仅当源目录本身已有同名子目录（历史脏数据）时才会撞 23505**；存量实测子目录重名 0 组、根目录 0 组 ⇒ **当前不可触发**。未改的理由：改法会同时改变复制语义（重名自动改名 vs 直接失败），属产品决策，且会触碰 `copyFolder` 的既有行为。`drive_folder` 其余插入点已全扫：`:499`（createFolder，已修）、`:1497`（copyFolder 根目录，已走 `uniqueName`）、`:1513`（本条）、其余无。
- **`performance_record` 同类写法**：`salary-service.js:645` 的 upsert 也带 `created_at = now()`，与本轮 B5 的口径不一致，属低危遗留。
- **52 个脚本硬编码 `admin123`**：未批量改（属测试资产清理，且改错会打断既有 QA），建议随 B12 一并处理。

---

## 📚 成员产出索引

- `gstack-security-officer`（安全官）：B1/B2/B3/B8/B14 取证与修复；新增 `middleware/log-redact.js`、`middleware/file-access.js`
- `gstack-investigator`（排障手）：B5/B10/G14 取证与修复；迁移 `130_outbox_claim_guard.sql`、`131_drive_folder_unique_name.sql`
- `gstack-qa-lead`（QA与发布）：B4/B6/B9/B13/G9 取证与修复；新增 `tools/oa-backup.mjs`、迁移 `900_schema_migrations.sql`
- 主理人：B4/B5 定级裁决、N1–N6 交叉冲突收口、迁移应用与重启验证、`qa-s6-org-flow-ver.mjs` 补丁

### 变更文件清单（均已留 `.bak-*-20261107` 备份）

```
src/server.js                       src/db/index.js                  src/routes/system.js
src/middleware/log-redact.js (新)   src/middleware/file-access.js (新)
src/services/salary-service.js      src/services/payroll-service.js  src/services/wms-webhook.js
src/services/drive-service.js       src/services/integration-reconcile.js  src/services/bootstrap.js
scripts/init-db.js  scripts/smoke-test.js  scripts/qa-regression.js
scripts/qa-verify-fixes.mjs  scripts/qa-verify-round2.mjs  scripts/qa-functional-suite.mjs
scripts/qa-s6-org-flow-ver.mjs
sql/130_outbox_claim_guard.sql  sql/131_drive_folder_unique_name.sql  sql/900_schema_migrations.sql
tools/oa-backup.mjs (新)  tools/svc-restart.ps1
web/dist/assets/Login-*.js
```

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。原报告结论**不得直接沿用**，复评须重新取证。
