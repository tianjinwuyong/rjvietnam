# 项目评估报告 · SMT Factory System

**评估日期**：2026-11-17
**评估对象**：`C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system`
**方法**：静态扫描 + 运行态探测 + PostgreSQL 目录普查 + 测试/类型检查实跑 + 独立安全审计（specialist 子代理）
**结论级别**：可演示，**不具备生产托管条件**

---

## 1. 执行摘要

业务覆盖面接近完整的工厂操作系统（ERP/PMC/WMS/MES/QMS/HR/Finance/Procurement/OA/AOI），但工程可交付性严重不足：

- **1,108 张表中 902 张为空（81%）** —— 系统结构完整、数据是空壳
- **843 条 API 路由挤在一个 45,195 行的文件里**，`services/api/routes/` 是空目录
- **`npm run typecheck` 113 个错误**，长期无人处理 → 类型检查从未作为门禁
- **无 CI**，最后一次提交 **2026-09-10**（68 天前），**526 个文件未纳入版本控制**
- **认证体系等价于无认证**：全系统共享源码中的明文密码 `Factory@123`
- 前端 `dist` 停留在 **2026-09-08**，与源码脱节

一句话：**这是一份高质量的业务蓝图 + 中低质量的工程实现**。

---

## 2. 综合评分

| 维度 | 分数 | 依据 |
|---|---|---|
| 业务覆盖 | 8 / 10 | 26 个前端模块、843 路由、12 条主干业务线 |
| 数据模型 | 7 / 10 | 1,101 个外键、60 个触发器、77 个视图，约束意识强 |
| 代码结构 | 3 / 10 | 单文件 45K 行；路由层拆分未完成 |
| 类型安全 | 3 / 10 | 113 个 TS 错误常驻 |
| 测试有效性 | 5 / 10 | 404 用例 / 380 通过，但含源码字符串断言式脆弱测试 |
| 数据就绪度 | 2 / 10 | 81% 表为空；工单 2 条、BOM 3 条、产品 7 条 |
| 安全 | 2 / 10 | 4 项 CRITICAL，见 §5 |
| 版本与协作 | 2 / 10 | 31 次提交、68 天无提交、526 未跟踪文件 |
| 运维可观测性 | 4 / 10 | 有 watchdog 与日志，无指标/告警/CI |
| 文档 | 8 / 10 | `docs/` 70+ 篇、`app_rules/` 9 条 lane、`graft/` 图谱 |

**加权总分：约 4.4 / 10**

---

## 3. 硬指标（实测）

| 项目 | 数值 |
|---|---|
| 前端 | 461 个 `.tsx`；`App.tsx` **3,606 行**；i18n 588 KB / 5,203 行（zh/en/vi） |
| 后端 | `server.js` **45,195 行**；**1,482 条路由声明**（`app.*` 843 + `api.*` 639），其中 **21 对 method+path 重复** |
| 数据库 | 1,108 表 · 1,101 FK · 3,248 索引 · 60 触发器 · 77 视图 |
| 迁移 | 279 个 SQL，**279 已应用**，0 待应用 |
| 数据 | 206 表有数据 / 902 空；最大业务表 `bom_lines` 282 行 |
| 运行时建表 | `server.js` 内 **150 条 `CREATE TABLE IF NOT EXISTS`**，与迁移重复建表的 **17 张** |
| 测试 | 76 文件 / 404 用例 → 380 通过、3 失败、21 跳过（5.3 s） |
| 类型检查 | 113 个错误 / 41 个文件，集中在 WMS/MES 页面 |
| 错误处理 | 991 个 `catch`、1,144 处 `res.status(500)` |
| 版本控制 | 31 commits / 1,024 跟踪文件 / 19.7 MB；5 改 + 526 未跟踪 |
| 构建 | `apps/web/dist` = 2026-09-08；API 托管此旧包 |
| CI | **无**（无 `.github/workflows`） |

### 3.1 核心业务数据量

| 表 | 行数 |
|---|---|
| `users` | 14 |
| `employees` | 57 |
| `material_lots` | 16 |
| `products` | 7 |
| `boms` | 3 |
| `work_orders` | **2** |

---

## 4. 架构现状

### 4.1 运行时拓扑

```
PDA(Kotlin) / Scanner / station-agent ──┐
                                        ├──> API :8080 ──> PostgreSQL :5432/smt_factory
web :5178 (Vite, /api → 8080) ──────────┘        │
                                                 └──> realtime WS ──> display-board
                                       Ollama :11434（AI 模块）
```

### 4.2 后端

- 单文件 Express：**1,482 条路由**（`app.*` 843 + `api.*` 639）、45,195 行，`services/api/routes/` **空目录**（拆分未落地，真正的抽取先例在 `services/api/src/routes/`：`manual-line.js` 390 行、`manu-line.js` 123 行、`auto-line.js` 104 行）
- 前缀分布：`api 304 · wms 176 · mes 108 · pmc 54 · quality 36 · maintenance 28 · qms 27 · hr 25 · reports 19 · erp 15 · pda 10 · boms 10`
- **两个并行注册面**：裸 `app`（`:892`）与 `express.Router()`（`:83`，在 `:9165` 挂为 `/api`）；后者的鉴权中间件直到 `:14025` 才附加 → **200 条 `/api` 路由永远不经过 `authenticateJWT`**
- 存在 **21 对重复的 method+path**（同路径多次注册，后者覆盖前者）
- `errorEnvelope`（`:15156`）返回 JSON **字符串**，再被 `res.json()` 二次编码 → 前端解析错误体时会拿到字符串套字符串
- `server.js` 在**运行时建表**（150 条内联 `CREATE TABLE IF NOT EXISTS`，与迁移重复建表的 17 张），导致"迁移集 ≠ 实际 schema"
- **号志级隐患**：`app.listen` 被粘贴进请求处理函数内部（`:30219-30225`，位于 `:30176` 的重复 SN 分支中）——一旦触发重复 SN 扫描就会二次监听触发 `EADDRINUSE`；真正的监听在 `:46133`
- 存在第二套认证实现 `services/api/src/auth/index.ts:86-91`，用 `"fake-sig-"` 拼签名（可伪造），且角色权限表与 DB 不一致

**可用的拆分接缝（按连续区间实测路由数）**

| 行区间 | 路由数 |
|---|---|
| 4357–7286 | 111 |
| 21327–22984（wms） | 39 |
| 16475–17702（pmc） | 38 |
| 23000–23926 | 36 |
| 24248–24893 | 32 |
| 44180–44859（maintenance） | 28 |
| 27936–29870（mes） | 26 |
| 7398–9025 | 25 |

### 4.3 前端

- `App.tsx` 承担模块路由、导航配置、权限过滤、全局壳（**3,606 行**）
- 分发是一条 **21 分支的 `if (active === ...)` 链**（`:3143-3205`），不是映射表
- 状态：**53 个 `useState`、0 reducer、0 context**；`locale` 与 `permissions` 逐层 prop 下传（`Wms` 1,809 行、`Mes` 2,001 行、`Quality` 2,384 行）
- `Shell` 在**渲染期间**调用 `setActive`（`:558-560`）——React 反模式，会触发额外渲染
- 导航是**前端硬编码权限表**：`roleModuleAccess`（原 10 个角色）→ 未登记角色直接退化成"只有总览"（本次已扩到 21 个角色 + 按 permissions 兜底）
- 超大组件：`ManualLineDashboard.tsx` **5,928 行**、`WmsLocationManagement.tsx` **5,813 行**、`manual-line-video-3d-entry.tsx` **4,621 行**、`supplier-label-main.tsx` 2,028 行（共 4 个 Vite 入口）
- 三个 PDA 应用（`employee-app` / `scanner-terminal` / `qc-pda`）在当前工作区**缺失**，API 静态托管报 `dist not found`

### 4.4 请求层与共享代码

- 全站 **318 处 `fetch(`**：`apps/web/src/api/` 内 **0 处**（27 个模块走 `client.ts:89`），而 **90 个组件文件里有 314 处原始 `fetch`**；35 个文件自行处理 token，29 处硬编码 `:8080`
- `packages/*` 被相对路径导入 **313 次**；`packages/ui-kit` 只有 1 个空文件，`packages/pda-components`（11 文件）对 Kotlin PDA（1,147 文件）**复用为零**
- i18n：**4,859 个键**、**4,534 处 `t()` 调用**，但 `export type TranslationKey = string`（`:5284`）→ **编译期零键安全**，缺键静默回退；另有 **1,063 处硬编码中文 JSX**、**7 个重复的 `text(zh,vi,en,locale)` 辅助函数**

### 4.5 数据库

| 库 | 表数 | 迁移状态 | 用途 |
|---|---|---|---|
| `smt_factory` | 1,108 | 279/279（`public._migrations`） | **线上** |
| `factory` | 256 | 128/279（`public.schema_migrations`） | 旁路/演练，已漂移 |
| `rjvn_mgmt` / `rjvn_verify` / `oa_*` / `wms` | 29 / — / — / 98 | — | 侧库 |

---

## 5. 安全审计

### 5.1 认证

| 项 | 现状 | 位置 |
|---|---|---|
| 密码存储 | **无**：`users` 表无密码列 | `information_schema` |
| 密码校验 | 源码字面量：`"Factory@123"`（例外 `MENG_YING→my`、`HWG→hwg`） | `server.js:15974-15978` |
| 浏览器暴露 | 快速登录列表明文渲染密码 | `AuthSignIn.tsx:18-26,135,144,153` |
| 免密登录 | `POST /auth/station-login` 仅凭用户名 + 工站码发 24h token | `server.js:14166-14220` |
| 登出 | 只写审计行，**无吊销**，token 有效到过期 | `server.js:16073-16095` |
| 限流 | **无**（`rateLimit` 零匹配） | — |
| JWT | 24h，密钥为 38 字符可读口令 | `server.js:16006`、`.env` |
| 存储 | 前端 `localStorage`（XSS 可窃取） | `api/client.ts:71` |

### 5.2 授权

- 权限来源：`users.role_id` ∪ `user_roles` → `role_permissions`（159 行）
- 权限在**签发时冻结进 token**，改角色最长 24h 才生效（`server.js:16004`）
- `requirePermission` 仅覆盖约 **53%** 的路由声明
- 前端权限过滤仅为 UI 层，**不是安全边界**

### 5.3 暴露面

- `app.use(cors())` 全开（`server.js:947`）
- 绑定 `0.0.0.0`（`:30219`、`:46133`）
- 公开：`/openapi.yaml`（全路由清单，`:14125`）、`/docs`（`:8893`）、`/uploads/employee-selfies`（PII，`:43448`）、`/health`、`/meta/bootstrap`
- JSON body 10 MB（`:950`）

### 5.4 风险清单

| 级别 | 问题 | 位置 | 修复 |
|---|---|---|---|
| 🔴 CRITICAL | `POST /api/sql` 以硬编码 `sa` 执行任意 SQL | `:38583`、`:38612` | 删除路由；凭据入 env；只读账号 |
| 🔴 CRITICAL | `x-pda-test-mode: 1` → `permissions:["*"]`，且 `NODE_ENV` 未设置 | `:13996-14004` | 显式 `PDA_TEST_MODE` + 生产禁用，然后删除 |
| 🔴 CRITICAL | 70 条 `api` 路由注册在 `authenticateJWT`（`:14025`）之前 | `:14025` | 中间件上移到 router 创建处 |
| 🔴 CRITICAL | 统一密码 `Factory@123` 硬编码 | `:15978` | 加 `password_hash`（argon2id），常量时间比较 |
| 🟠 HIGH | 免密 `station-login` | `:14166` | 设备证书/HMAC |
| 🟠 HIGH | 登出无吊销 | `:16073` | `jti` 黑名单 + `token_version` |
| 🟠 HIGH | CORS `*`、绑定 `0.0.0.0` | `:947`、`:30219` | 来源白名单；绑定内网地址 |
| 🟠 HIGH | 679 条 `app` 路由位于全局鉴权（`:33882`）之前 | `:33882` | 鉴权中间件前移 |
| 🟠 HIGH | `/openapi.yaml`、`/docs`、员工自拍公开 | `:14125`、`:8893`、`:43448` | 加 JWT + 权限 |
| 🟡 MEDIUM | 无登录限流 | — | 按 IP + 用户名节流 |
| 🟡 MEDIUM | token 存 localStorage | `client.ts:71` | HttpOnly + SameSite=Strict |
| 🟡 MEDIUM | `src/auth/index.ts` 伪造签名实现 | `:86-91` | 删除或接真实 `jwt.sign` |
| 🟡 MEDIUM | 10 MB JSON / 无限制头像上传 | `:950`、`:39235` | 限 256 KB / 2 MB + 类型白名单 |

---

## 6. 工程质量

### 6.1 类型检查（113 错 / 41 文件）

| 根因 | 数量 | 修复量级 |
|---|---|---|
| 参数个数错误 TS2554（`WmsWoHandover.tsx:36` 定义 `text(zh,vi,en,locale)`，20 处只传 3 个） | 29 | **2 小时**（机械替换） |
| 隐式 any TS7006 | 25 | **2 小时** |
| DTO 漂移 TS2339/2551/2345（UI 读 `lotNo`/`locationCode`，API 返回 `lot_no`/`location_code`，见 `WmsPdaReceiving.tsx:197-210`） | 37 | **1–2 天**（需先定 DTO 契约） |
| 缺模块/导出 TS2307/2724/2304（`bwip-js` 未安装、`Locale` 未从 i18n 重导出、`ReportDomain` 未定义） | 7 | 3 小时 |
| 赋值不兼容 TS2322 | 5 | 1 小时 |
| 重载/索引/未定义等 TS2769/2741/7053/18046/2353/2352 | 10 | 2 小时 |

合计约 **3 人日**。其中约 70% 是外观性问题，**37 个 DTO 错误才是真缺陷**。

按文件：`wms/WmsWoHandover.tsx` 20 · `supplier-label-main.tsx` 12 · `wms/WmsPdaReceiving.tsx` 12 · `mes/manual-line-video-3d-entry.tsx` 9 · `mes/MaterialRollQrGenerator.tsx` 7 · `MobileLeave.tsx` 6。

### 6.2 测试

- 76 文件 / 404 用例：**380 通过 · 3 失败 · 21 跳过**，耗时 5.3 s
- 失败：
  - `backend-validation.test.ts` — API 模块目录与 OpenAPI 路由清单不一致
  - `wms-3d-security-contract.test.ts` — 2 条**断言源码字符串**的契约测试（改代码即红，属脆弱测试设计）

### 6.3 版本控制

| 项 | 值 |
|---|---|
| 提交总数 | 31 |
| 最近提交 | 2026-09-10（68 天前）|
| 未跟踪文件 | 526（`_*_tmp.mjs`、`pw-*.cjs`、日志、截图） |
| 已修改未提交 | 5 |
| CI | 无 |

**8–11 月的绝大部分工作没有进 Git** —— 这是"内容丢失"事件的根因，与归档无关。

---

## 7. 风险登记（按修复顺序）

| # | 优先级 | 动作 | 预期收益 |
|---|---|---|---|
| 1 | **P0** | `git add` + 首次真实提交（先补 `.gitignore` 排除日志/临时脚本） | 杜绝永久丢失 |
| 2 | **P0** | 密码落库（argon2id）+ 删除 `POST /api/sql` + 关闭 `x-pda-test-mode` | 消除 3 个 CRITICAL |
| 3 | **P0** | `api.use(authenticateJWT)` 移到 `:14025` 之前；`app.use(authenticateJWT)` 前移 | 关闭 200 条 `/api` + 679 条 `app` 裸路由 |
| 4 | **P0** | 删除 `:30219-30230`（请求处理函数内的 `app.listen` 与定时器） | 消除 `EADDRINUSE` 级偶发崩溃 |
| 5 | **P1** | 修 113 个 typecheck 错，接入 CI（`typecheck && test`） | 变更可见 |
| 6 | **P1** | 恢复 3 个 PDA 应用（源码约 1 MB） | 消除功能缺口 |
| 7 | **P1** | 重新构建 `dist`，统一 :8080 与 :5178 | 消除版本错位 |
| 8 | **P2** | 按实测接缝拆分 `server.js`（先抽 wms 21327–22984、pmc 16475–17702，沿用 `src/routes/` 先例） | 降低改动成本 |
| 9 | **P2** | 让 `client.ts` 成为唯一请求入口（ESLint 禁止 `api/` 外使用 `fetch`） | 统一错误/鉴权/基址 |
| 10 | **P2** | `TranslationKey` 改为字典 `keyof typeof` | 缺键编译期报错 |
| 11 | **P2** | 补种子数据，跑通"工单→BOM→物料→工站"闭环 | 系统变为可验证 |
| 12 | **P3** | 淘汰 `factory` 等旁路库；删除运行时建表，统一 schema 来源 | 消除漂移 |

---

## 8. 30 / 60 / 90 天建议

**0–30 天（止血）**
- 建立 Git 基线，历史工作入库
- 关闭 4 个 CRITICAL 安全问题
- CI 接入 typecheck + test（允许红，但必须可见）
- 恢复 PDA 应用、重建 dist

**30–60 天（可维护）**
- 拆分 `server.js`，先抽 `wms`、`mes` 两个最大簇
- 清理 113 个类型错误，CI 转绿
- 崩溃 902 空表 → 明确"哪些表是设计保留、哪些是未实现"，写入文档

**60–90 天（可交付）**
- 种子数据 + 端到端闭环验收（Playwright）
- 补齐监控（请求耗时、错误率、慢查询）
- 数据库单一来源：迁移集 = 实际 schema，删除运行时建表

---

## 附录 A：复现命令

```powershell
# 类型检查
npm run typecheck

# 测试
npm run test

# 数据库普查
$env:PGPASSWORD='postgres'
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d smt_factory -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"

# 服务
node start_dev.js   # 注意：会额外拉起 supplier-portal / factory3d
```

## 附录 B：本次评估期间已做的改动（未提交）

| 文件 | 改动 |
|---|---|
| `apps/web/src/App.tsx` | 权限表 10 → 21 个角色，新增按 permissions 兜底推导菜单 |
| `apps/web/src/auth/AuthSignIn.tsx` | 快速登录首位新增 `wy` |
| `AGENTS.md` | 按实测校准（数据库、迁移、依赖版本、模块清单） |
| DB | 新增用户 `wy`（id 14，role = admin） |
