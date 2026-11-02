# WMS ↔ OA 电子流对接：接口契约与差异清单

**调研日期**：2026-10-21
**范围**：只做代码级调研，未改动任何代码。
**系统 A（OA）**：`D:/OA 协同管理平台/app`（Fastify + Postgres，源码 `app/server/src`）
**系统 B（WMS）**：`D:/WMS-20261019`（NestJS + Drizzle + Postgres）

结论标记：`【已具备】` / `【需改造】` / `【需新增】`

---

## 0. 一句话结论

OA 的流程引擎在**节点编排、审批人解析、会签、条件分支、留痕**上已经够用，9 个 WMS 审批点里 **6 个单级流程可以直接复用**（只需在 OA 建流程定义）；但 OA **完全没有对外集成面**——没有业务单号绑定字段、没有 webhook、没有 API Key/服务账号鉴权、没有批量审批接口。这三样是必须新增的硬门槛。MRB（10 态 + 库存占用 + 守恒校验）**不建议迁 OA**。

---

## 1. OA 流程实例的数据契约

### 1.1 POST /api/instances

- 路由：`app/server/src/routes/flow.js:377`
- 守卫：`{ preHandler: requirePermission('flow:submit') }`（`flow.js:377`）→ 调用方必须拥有 `flow:submit` 权限或为 admin
- 请求体（`flow.js:378` 解构，**只有这 6 个字段**）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `definitionId` | number | ✔ | `flow_definition.id`（不是 code） |
| `title` | string | ✔ | 缺失返回 400「请填写标题」（`flow.js:379`） |
| `formData` | object | ✘ | 任意 JSON，落 `flow_instance.form_data`(JSONB) |
| `submitNow` | bool | ✘ | true 时同步提交，返回 `{...inst, advance}`（`flow.js:394-398`） |
| `subjectUserId` | number | ✘ | **代提业务当事人**（被代提人） |
| `onBehalfOf` | number | ✘ | 同上，`subjectUserId` 的别名（`flow.js:382` 还兜底读 `formData.on_behalf_of`） |

- 返回：`ok(reply, inst, msg)` → `{ code: 0, msg: "草稿已保存"|"已提交", data: <flow_instance 行> }`（`flow.js:396/398`）
  行字段（`flow-engine.js:934-940` 为 `RETURNING *`）：
  `id, instance_no, definition_id, title, form_data, status, applicant_id, organization, current_index, submitted_at, finished_at, created_at, updated_at, closed_loop, closed_at, archived_at, archive_locked, returned_count, definition_version, subject_user_id`

**契约缺口（重要）**：
- ✘ 无 `bizType` / `bizId` / `bizNo` / `externalId` / `sourceSystem` —— 请求体里根本没有这些字段
- ✘ 不接受外部指定版本号：实例创建时由 OA **自动绑定** `flow_definition.active_version_id` → `flow_instance.definition_version`（`flow-engine.js:906-918`）
- ✘ 附件不在 create body 内（见 1.4）
- ✘ 抄送人不在 create body 内（见 1.4）

### 1.2 业务单据如何与实例关联

`【需新增】` —— **OA 目前没有任何"外部业务系统标识"字段**。

`flow_instance` 全字段见 `sql/01_schema.sql:114-131` + 增量 `sql/05_p2_flows.sql:27-32`、`sql/14_s6_org_flow_ver.sql:97`、`sql/31_org_routing_misscard.sql:183`。合起来是：

```
id, instance_no, definition_id, title, form_data, status, applicant_id, organization,
current_index, submitted_at, finished_at, created_at, updated_at,
closed_loop, closed_at, archived_at, archive_locked, returned_count,
definition_version, subject_user_id
```

- 唯一单号 `instance_no` 由 OA 生成：`<CODE>-YYYYMMDD-000123`（`flow-engine.js:338-350`，`flow_instance_seq` 原子取号，`sql/21_flow_instance_seq.sql`）
- WMS 单号目前只能塞进 `title` 或 `form_data`（字符串匹配，无法建索引/无法幂等）

OA 内部已有的关联做法是**「业务表加 FK 列 + 终态钩子」**，不是通用绑定：

| 业务表 | 列 | 定义位置 |
|---|---|---|
| `attendance_anomaly` | `remedy_instance_id` | `sql/31_org_routing_misscard.sql:211` |
| `comp_day` | `source_instance_id` | `sql/33_comp_day.sql:46` |
| `handover` | `instance_id` | `sql/34_handover.sql:39` |
| `equipment_stocktake` | `publish_instance_id` / `finish_instance_id` | `sql/40_equipment_stocktake.sql:13-14` |
| `salary_record` | `source_instance_id` | `sql/51_performance_flow.sql:17` |
| `attachment` | `biz_type` / `biz_id` | `sql/01_schema.sql:193-194`（**仅附件**，流程附件恒为 `biz_type='flow'`，见 `flow.js:369-371`） |

→ 对 WMS 必须新增 3 个列 + 1 个唯一索引，例如
`flow_instance.biz_system VARCHAR(30)` / `biz_type VARCHAR(50)` / `biz_id VARCHAR(100)` + `UNIQUE(biz_system, biz_type, biz_id)`（幂等键，见风险 R2）。

### 1.3 表单数据：动态 JSON

`【已具备】` 完全动态，不需要改表：

- `flow_definition.form_schema` JSONB 数组，元素结构 `{ key, label, label_vi, type, required, options[], columns[], placeholder, hint }`（`sql/01_schema.sql:102-104`；实例见 `sql/02_seed.sql:103-114`）
- 值存 `flow_instance.form_data` JSONB，键即 `form_schema[].key`（`sql/01_schema.sql:119-122`）
- 支持的 `type`（实测出现在种子中）：`text / textarea / number / date / datetime / select / table / file / user_multi / rich_text`（`sql/02_seed.sql:104-253`）
- 中间节点可追加字段：`POST /api/tasks/:id/approve` 的 `extraFields` 会 `form_data || $2::jsonb` 合并（`flow-engine.js:757-763`）
- 前端通过 `GET /api/flows/:id` 拿 `form_schema` + `flow_nodes` 动态渲染（`flow.js:141-153`）

→ WMS 无需为每个单据在 OA 建物理表，传 `form_data` 即可。

### 1.4 附件与抄送（都不在 create body 内）

- 附件 `【需改造】`：
  1. 先 `POST /api/upload` 以 **multipart** 上传（`routes/system.js:454-484`），返回 `tempRelPath` 落在 `uploads/.staging-tmp/`
  2. 再 `POST /api/instances/:id/attachments`，body `{ fileName, filePath, fileSize, mimeType }`（`flow.js:332-374`）
  3. `filePath` 必须是暂存目录相对路径（`assertStagedRel`，`flow.js:337` / `services/drive-service.js:181`），**不接受外部 URL**
  → WMS 附件必须下载后二次上传，OA 侧双份存储。
- 抄送 `【已具备】`：`POST /api/instances/:id/cc` body `{ userIds: [], deptCodes: [] }`（`flow.js:603-609`）

---

## 2. 审批结果如何回传 WMS

### 2.1 OA 是否有 webhook / 回调 / 事件推送

`【需新增】` —— **没有任何对外推送能力**。

- 全仓检索 `webhook|callback|notify_?url|subscribe|api_?key|client_?id|service_?account|hmac|signature`（`app/server/src` 全目录）→ **0 命中**
- 唯一的"回调"是**进程内**函数分发：`runTerminalHooks(inst, instanceId)`（`flow-engine.js:54-101`）

```
def_code → 动态 import 同仓模块
doc_controlled_issue → doc-issue.js
doc_obsolete         → doc-obsolete.js
equip_repair         → equipment-repair.js
leave / miss_card    → attendance-service.js
comp_day             → comp-service.js
handover             → handover-service.js
equipment_stocktake  → equipment-stocktake.js
monthly_performance  → salary-service.js
（其它 code 无分支，静默不做任何事）
```

**触发点只有 1 处**：`advance()` 正常结束时（`flow-engine.js:415-440`）。

**否决/终止/撤回/退回 全部无通用钩子**（这是对接最大的坑）：

| 动作 | 代码位置 | 是否触发钩子 |
|---|---|---|
| 全部通过（completed） | `flow-engine.js:415-440` | ✔ `runTerminalHooks` |
| 驳回（rejected） | `flow-engine.js:686-738` | ✘ 仅 `miss_card`/`comp_day`/`equipment_stocktake` 三个内联分支（709/719/729） |
| 退回发起人（→draft） | `flow-engine.js:959-992` | ✘ |
| 终止（terminated） | `flow-engine.js:1068-1093` | ✘ |
| 撤回（withdrawn） | `flow-engine.js:1100-1109` | ✘ |

→ 通用回调必须在 **5 个位置**都埋点，不是 1 个。

### 2.2 只能轮询？——OA 侧可轮询，WMS 侧缺调度器

`【已具备】`（OA 读接口）+ `【需新增】`（WMS 定时器）

| 用途 | 接口 | 位置 |
|---|---|---|
| 单实例全量详情（含 tasks/logs/executions/attachments） | `GET /api/instances/:id` | `flow.js:230-326` |
| 按流程台账（含 `form_data` 展开 + 筛选） | `GET /api/ledger/:code` | `flow.js:649-657`、`services/flow-ledger.js:28-126` |
| 列表（`tab=todo/mine/cc/done/flow`，支持 `keyword`/`status`/`definitionId`/分页） | `GET /api/instances` | `flow.js:157-227` |

`GET /api/instances/:id` 返回体（`flow.js:312-325`）：
`{...instance, tasks[], ccs[], logs[], attachments[], executions[], myTask, currentNode, canApprove, canWithdraw, canReturn, canUrge, canTerminate, canArchive, warnings[], canAssignNode}`

⚠️ 可见性限制：非 admin 只能看「本人发起 / 本人是 assignee / 本人被抄送」（`flow.js:250-260`）；`tab=todo` 按 `assignee_id = req.user.id` 过滤（`flow.js:171`）。服务账号若是 admin 则无此问题。

⚠️ WMS 侧 **没有定时任务能力**：`package.json` 依赖里无 `@nestjs/schedule`，全仓检索 `ScheduleModule|@Cron|Interval` → 0 命中。要做轮询必须新增调度器（或新增依赖）。

（OA 侧有自调度 cron：`services/cron.js:18-32`，可用于兜底推送重试。）

### 2.3 实例状态枚举与任务状态枚举

**实例 `flow_instance.status` —— 七态**（`flow.js:79-86` 的 `STATUS_SQL`/`normStatus`）：

| 状态 | 含义 | 进入点 |
|---|---|---|
| `draft` | 草稿 / 被退回重填 | `flow-engine.js:976` |
| `running` | 审批中 | `flow-engine.js:556` |
| `completed` | 全部通过 | `flow-engine.js:422` |
| `rejected` | 驳回（终态） | `flow-engine.js:694` |
| `withdrawn` | 发起人撤回 | `flow-engine.js:1105` |
| `terminated` | 终止 | `flow-engine.js:1078` |
| `archived` | 归档（`archive_locked=TRUE`） | `flow-engine.js:1136` |

- 读取层做**别名归一**：`approved → completed`、`canceled → withdrawn`（`flow.js:79-81`、`services/flow-ledger.js:9-10`）
- ⚠️ `sql/01_schema.sql:122` 的列注释仍写旧的五态（`draft/running/approved/rejected/canceled`），**已过期**，不要照它写契约

**任务 `flow_task.status` —— 五态**（`sql/01_schema.sql:149-150`）：

`assigned`（待处理）/ `approved` / `rejected` / `skipped`（节点流转后清理，见 `flow-engine.js:417-420`、`444-448`）/ `transferred`（`flow-engine.js:1012-1015`）

### 2.4 审批意见 / 审批人 / 时间 在哪张表

| 数据 | 表.列 | 位置 |
|---|---|---|
| 审批意见 | `flow_task.comment` | `sql/01_schema.sql:151`（写入：`flow-engine.js:751`、`688`） |
| 审批人 | `flow_task.assignee_id` → `org_user.real_name` | `sql/01_schema.sql:148`；`flow.js:264-269` 联查 |
| 到达/处理时间 | `flow_task.assigned_at` / `finished_at` | `sql/01_schema.sql:155-156` |
| 催办时间 | `flow_task.reminded_at` | `sql/01_schema.sql:157` |
| 节点附加字段 | `flow_instance.form_data`（合并写入） | `flow-engine.js:757-763` |
| 全量审计流 | `flow_log(instance_id, actor_id, action, node_index, detail, ip_address, created_at)` | `sql/01_schema.sql:176-185` |
| 执行回复（闭环） | `flow_execution.content` JSONB + `reply_by/verified_by/verified_at/status` | `sql/05_p2_flows.sql:48-60` |

`flow_log.action` 全部取值（代码实测）：
`create / submit / approve / reject / return / transfer / temp_add / urge / terminate / withdraw / archive / cc / execute / verify / no_assignee / timeout_remind / assign_node / delegate_create`

---

## 3. 身份与权限

### 3.1 OA 鉴权方式

`【已具备但不适用外部系统】`

- **不是 JWT**。是不透明随机串：`crypto.randomBytes(32).toString('hex')`，落 `sys_session` 表（`services/auth.js:72-80`），每次请求查库校验（`services/auth.js:183-192`）
- token 三种传法：`Authorization: Bearer <t>` / `x-token: <t>` / `?token=<t>`（`middleware/index.js:13-17`）
- 签发唯一入口：`POST /api/auth/login` `{ username, password }`（`routes/auth.js:12`）；`username` 可用 `username | email | employee_no` 任一（`services/auth.js:58-61`）
- Session 有效期：`config.security.sessionHours`，默认 **24h**（`src/config/index.js` security 段 / `.env` `SESSION_HOURS`）
- 有登录失败锁定：`auth_fail_counter`（`services/auth.js:14-40`，`sql/45_auth_fail_counter.sql`）

`【需新增】` 外部系统调用没有专用凭证：
- 无 API Key / 无 client_credentials / 无 mTLS / 无 IP 白名单中间件
- 结论：WMS **只能**用「一个 OA 真人/服务账号的用户名密码 → 登录取 token → 缓存 24h → 过期重登」。密码轮换、session 表膨胀、失败锁定（5 次锁 15 分钟）都会直接打断 WMS。

### 3.2 org_user ↔ sys_account 映射

| OA `org_user` | 说明 | 定义 |
|---|---|---|
| `id` BIGINT | 主键，流程里所有 actor/assignee 引用它 | `sql/01_schema.sql:30` |
| `username` VARCHAR(50) UNIQUE | **= 工号**（导入时 `username = employeeNo`，`services/org-import-service.js:277`） | `01_schema.sql:31` |
| `employee_no` VARCHAR(30) | 工号，格式 `DT%04d`（`services/auth.js:210-218`） | `sql/08_s2_account.sql:23` |
| `real_name` | 姓名 | `01_schema.sql:33` |
| `department_id` | 部门 FK | `01_schema.sql:36` |
| `position_code` | 岗位编码（对应 `sys_i18n_dict(position).code`） | `sql/05_p2_flows.sql:37` |
| `manager_id` | 直属上级（审批人解析用） | `01_schema.sql:39` |
| `organization` / `is_external` / `is_admin` / `active` | 主体/乙方/管理员/在职 | `01_schema.sql:41-44` |
| `feishu_open_id` / `feishu_user_id` | 飞书绑定 | `01_schema.sql:46-47` |

| WMS `sys_account` | 说明 | 定义 |
|---|---|---|
| `id` UUID | 主键；JWT 的 `userId` 就是它 | `server/database/schema.ts:306` |
| `account` VARCHAR(50) UNIQUE | 登录名 | `schema.ts:307` |
| `name` | 姓名 | `schema.ts:309` |
| `role_code` | 角色（`production_manager`/`wh_manager`/`iqc_manager`/`quality_manager`…） | `schema.ts:310` |
| `work_section` | 工段 `smt|dip|assembly|packing` | `schema.ts:311` |
| `status` | `active` 等 | `schema.ts:312` |
| `platform_user_id` VARCHAR(100) UNIQUE | **已被另一个平台占用**（19 位 ID） | `schema.ts:315` |

`【需改造】` 映射结论：
- 天然对齐键是 **OA `org_user.username`/`employee_no` ↔ WMS `sys_account.account`**（需业务确认 WMS 的 `account` 实际是不是工号）
- ⚠️ **`platform_user_id` 不能复用**：`system.service.ts:603-621` 把 19 位平台 ID 硬编码写入（`admin='1847292357012580'`、`wh_manager='1847292986161210'`、`quality_manager='1847286122258459'` …）。要用它存 OA `org_user.id` 会与现有平台身份冲突。
  → 需要新增 `sys_account.oa_user_id`（或独立映射表 `sys_account_oa_user`）
- WMS **没有工号列**，只有 `account`；若 account 不是工号，需要新增 `employee_no` 列

### 3.3 requirePermission 权限模型 / 外部服务账号怎么授权

`【已具备】`

```js
// middleware/index.js:27-34
export function requirePermission(permCode) {
  return async (req, reply) => {
    if (req.user.isAdmin) return;                       // admin 全放
    if (!req.user.permissions.includes(permCode)) 403;
  };
}
```

- `req.user.permissions` 由 `PROFILE_SELECT` 聚合（`services/auth.js:132-155`）：`admin` 角色 → `SELECT json_agg(code) FROM sys_permission`（**全量**）；否则按 `sys_user_role ⋈ sys_role_permission ⋈ sys_permission` 聚合
- 权限码全集（`sql/02_seed.sql:37-40`）：`flow:view` / `flow:submit` / `flow:approve` / `flow:config`
- 外部服务账号授权两条路：
  1. 给 `admin` 角色（最省事，`sql/02_seed.sql:84-88` 已有 `sys_user_role` 表可插）
  2. 建专用角色 + 授三个权限（范例：`sql/05_p2_flows.sql:115-119`，`finance/warehouse/...` 就是这样给的）

⚠️ `flow:submit` 只是入口门槛；`POST /api/instances` 里还有一层**代提授权校验** `assertDelegateAllowed`（`flow.js:38-76`）：

```
if (user.isAdmin) 放行
needGrant = sys_config.miss_card_delegate_need_grant（默认 false）
有 flow_delegate_grant 记录（scope 硬编码 = 'miss_card'！）→ 放行
!needGrant && permissions 含 'attend:remedy' → 放行
否则 403
```

→ 服务账号若**不是 admin**，替 WMS 真实用户提单会被 403 拦死；且 `flow_delegate_grant.scope='miss_card'` 是**硬编码的补卡专用授权**（`flow.js:60`、`sql/31_org_routing_misscard.sql:191`），无法表达"WMS 代提"。

`【需改造】`：`scope` 需要扩展为可配置（或服务账号走 admin + 新增 `biz_applicant` 字段）。

### 3.4 附带发现：WMS 侧审批角色校验实际失效（安全缺陷，必须在对接时一并处理）

- JWT 的 `userId = sys_account.id`（**UUID**）：`system.service.ts:701-707` → `jwt-auth.guard.ts:54-61`
- 但三个控制器用 **`platformUserId`** 反查角色：
  `over-picking.controller.ts:18-30`、`stock-take.controller.ts:17-30`、`workorder.controller.ts:33-56`
  → `where(eq(sysAccount.platformUserId, <UUID>))` → 查不到 → 返回 `roleCode = ''`
- service 侧校验是 `if (params.approverRole && !APPROVE_ROLES.includes(params.approverRole))`（`over-picking.service.ts:239-241`、`stock-take.service.ts:1485-1487`）
  → **空串短路，校验被跳过** → 任何登录用户都能审批
- `APPROVE_ROLES`：`over-picking.service.ts:15` = `['admin','production_manager']`；`stock-take.service.ts:22` = `['admin','wh_manager']`

→ 结论：现在"谁能审批"在 WMS 侧并不真正生效。把审批权收归 OA 后必须显式修掉（或至少不再依赖它）。

---

## 4. 组织与审批人

### 4.1 节点审批人如何解析

`【已具备】` 解析入口 `resolveAssignees`（`flow-engine.js:296-327`）→ `resolveByExpr`（`flow-engine.js:219-281`）。

支持的 `assign` 表达式（穷举自代码）：

| 表达式 | 语义 | 代码 |
|---|---|---|
| `dept_leader` | 申请人所属部门的 `dept_leader` 角色 | `flow-engine.js:244-246` |
| `dept_leader:<deptCode>` | 指定部门的 dept_leader | `247-250` |
| `manager` | `org_user.manager_id`（直属上级），缺失回退 dept_leader | `251-254` |
| `vp` / `gm` | 全局角色 `vp` / `gm` | `255-256` |
| `user:<id>` | 指定人（硬编码 id） | `257-259` |
| `position_self:<position_code>` | 本部门同岗位的人 | `260-263` |
| `position:<deptCode>:<position_code>` | 指定部门指定岗位 | `264-271` |
| `role:<roleCode或roleName>` | 按角色找人（先搜 `sys_role.code`/`name`，无果回退当岗位码） | `272-279` + `182-199` |
| `role:<deptCode>:<code>` | 指定部门指定角色 | `274-277` |
| `user_selected` | **发起人在表单里选的人**（取 `form_data[`${node.name}_user`]` 或 `node.sel_key`，可配 `fallback`） | `224-242` |
| `assign: [...]` 数组 | 多来源**合并去重 = 并行会签** | `314-325` |

**会签**：`node.min_approvals`（`flow-engine.js:822-833`），未达标停留本节点并返回 `{waiting:true, approved, required}`（`flow.js:550` 拼文案）。
**节点类型**：`type` ∈ `approval`（默认）/ `execute`（必须带 reply，`flow-engine.js:741-745`）/ `verify`（闭环验证，`776-791`）/ `cc`（抄送，`409`、`453-469`）。
**条件分支**：`node.condition = { field, op, value, value_ref }`，`op` ∈ `eq/ne/gt/gte/lt/lte`；`value_ref` 读 `sys_config` 阈值并 60s 缓存（`flow-engine.js:16-42`、`139-153`）。种子范例：`sql/05_p2_flows.sql:82-99`（`requisition_vp_threshold=5000` 等）。
**无审批人兜底**：解析为空 → 写 `flow_log('no_assignee')` + 通知全部 admin + `current_index` 停在挂起节点（`flow-engine.js:475-513`）；管理员用 `POST /api/instances/:id/assign-node`（`flow.js:576-585` → `flow-engine.js:1288-1342`）接管。
**节点 schema 完整键**：`{ name, type, assign, min_approvals, temp_addable, condition{...}, sel_key, fallback }`（实例见 `sql/02_seed.sql:138-141`、`116-119`）。
**版本冻结**：运行时节点取自实例绑定的版本快照（`flow-engine.js:380-389`），改配置不影响在途单。

### 4.2 WMS 的 work_section 能否对应 OA 部门

`【需新增】` —— **不能直接对应，是两套不同维度**。

- WMS `work_section` 取值：`'smt' | 'dip' | 'assembly' | 'packing'`（`shared/api.interface.ts:930`）→ 这是**产线工段**，不是组织部门
- WMS 的"岗位"实际是 `role_code`：`production_manager` / `wh_manager` / `wh_keeper` / `iqc_manager` / `iqc_inspector` / `sqe` / `quality_manager` / `mrb_reviewer` / `planner` / `production_material_smt|dip|assembly|packing`（`system.service.ts:604-621`）
- OA 部门是树：`org_department(id, parent_id, name, name_vi, code, organization, leader_id, path, dept_type, dept_level, ...)`（`sql/01_schema.sql:11-23` + `sql/31_org_routing_misscard.sql:44-51`）。**OA 没有"工段"概念**，只有部门 + 岗位（`position_code`，字典 `sys_i18n_dict(dict_type='position')`）

三条可选落地路径（按代价排序）：
1. **推荐**：在 OA 建 4 个"工段"部门（`dept_type='section'`，用现成的 `dept_type` 列），把 WMS 物料员按其 `work_section` 落 `org_user.department_id`；审批人用 `role:production_manager` / `role:wh_manager` 等**全局角色**，不用部门过滤 —— 单级审批够用
2. 在 OA 建 15 个 WMS 同名角色（`sys_role.code`），节点写 `role:<wms_role_code>`；缺点是角色爆炸
3. 新增一个 `assign` 表达式（如 `external_role:<code>`）读 WMS 映射表 —— `【需改造】`，改动 `resolveByExpr`（`flow-engine.js:219-281`）

不管走哪条，**OA 必须存在这些人**（否则 4.1 的挂起流程生效）。

---

## 5. 差异与风险

### 5.1 9 个审批点的状态机映射

| # | WMS 审批点 | 入口 | 现状状态机 | 副作用（不可丢） |
|---|---|---|---|---|
| 1 | 领料单审批（单张） | `workorder.controller.ts:413` → `workorder.service.ts:1691-1713` | `pending_approval → approved|rejected`，写 `approver_id/approval_time/approval_remark` | 无（`pick` 另行校验 `status='approved'`，`workorder.service.ts:1724`） |
| 2 | 领料单批量审批 | `workorder.controller.ts:379-397` | 循环调 #1 | 同 #1 |
| 3 | 补料需求单审批 | `workorder.controller.ts:319` → `workorder.service.ts:1276-1348` | `pending_approval → approved|rejected` | **通过时自动生成 `picking_order` + 明细**（`1306-1333`） |
| 4 | 工单超耗审批 | `workorder.controller.ts:490-502` → `workorder.service.ts:2347` | 布尔 `approved` | 按超耗比例触发（适合 OA `condition`） |
| 5 | 超领单审批 | `over-picking.controller.ts:99` → `over-picking.service.ts:230-320` | `pending_approval → approved|rejected` | **通过时生成 `isSupplement=true` 的 `picking_order` + 单号**（`291-315`） |
| 6 | 盘点单审批 | `stock-take.controller.ts:278` → `stock-take.service.ts:1476-1523` | `pending_approval → approved|rejected`，**CAS 更新**（`1495-1513`） | `refreshSummary` + 子单批后回刷主单 `refreshMainSummary`（`1492`、`1521`） |
| 7 | IQC 报告审批（批量） | `iqc.controller.ts:447` → `iqc.service.ts:2359-2401` | 逐条 `reviewReport` | 报告状态 `pending → reviewed` |
| 8 | MRB 预审 | `mrb.controller.ts:283` → `mrb.service.ts:2504-2578` | `pending_approval → pending_final`（complete）/ `→ pending_review`（incomplete）/ skip（仅 admin） | **incomplete 时 `clearReviewResults` 清空评审意见**（`2557`） |
| 9 | MRB 终审 | `mrb.controller.ts:318` → `mrb.service.ts:2682+` | `pending_final → approved|pending_execute|rejected` | **库存处置执行链**（报废冻结 / 退货占用 / 保留库位搬移）、守恒校验、`mrb_disposition` 落库 |

**MRB 状态机（10 态）**：`draft / pending_review / reviewing / pending_approval / pending_final / pending_execute / approved / closed / rejected / cancelled`（`server/modules/mrb/mrb.status.ts:20-31`），迁移表 `mrb.status.ts:85-99`。

### 5.2 OA 七态 ↔ WMS 状态映射表

| OA `flow_instance.status` | WMS 目标状态 | 结论 |
|---|---|---|
| `draft` | `draft` / `pending_review` | 一致 |
| `running` | `pending_approval`（单级） | 一致 |
| `running` | `pending_review` + `pending_approval` + `pending_final`（MRB 三态） | **❌ 不可映射**：OA 只有一个 `running` |
| `completed` | `approved` | 一致 |
| `rejected` | `rejected` | 一致 |
| `withdrawn` | 无对应 → WMS 应回 `draft` | **⚠️ 需新增处理**，否则单据永久卡 `pending_approval` |
| `terminated` | 无对应 → 需定义（建议 `cancelled`） | **⚠️ 需新增语义** |
| `archived` | 无对应，WMS 不关心 | 忽略 |

**根因**：OA 只暴露 `running + current_index`（节点下标）和 `currentNode`，**没有"业务中间态"语义**。要驱动 MRB 三态，只能拿 `currentNode.name` / `current_index` 反查（脆弱，文案一改就断）。

### 5.3 哪些能直接复用 OA、哪些要新增流程定义

**可直接复用 OA（OA 引擎能力够，只需新建 flow_definition 数据，不改代码）**：

| WMS 审批点 | 需要的 OA 节点 | 复用依据 |
|---|---|---|
| #1 领料单 | 1 个 `approval`，`assign:"role:production_manager"` | 单级 + 角色解析（`flow-engine.js:182-199`）|
| #2 批量领料 | 同 #1，但**OA 无批量审批接口** | 见下 |
| #3 补料需求 | 1~2 个 `approval`（主管→仓库） | 多级串行天然支持 |
| #5 超领单 | 1 个 `approval`，可加 `condition` 按数量分级 | `flow-engine.js:139-153` |
| #6 盘点单 | 1 个 `approval`，`assign:"role:wh_manager"` | 单级 |
| #7 IQC 报告（单份） | 1 个 `approval`，`assign:"role:iqc_manager"` | 单级 |
| #4 工单超耗 | 1 个 `approval` + `condition{field:'over_ratio',op:'gte',value_ref:'over_consume_threshold'}` | 条件路由现成 |

**需要 OA 侧新增流程定义**：以上 7 个 WMS 单据在 OA **一个都没有**。OA 现有 22 个 `flow_definition.code`（`sql/*.sql` 实测）：
`bom_change, comp_day, dispatch, doc_controlled_issue, doc_obsolete, ecn, equip_repair, equipment_stocktake, expense, handover, headcount, ipqc_issue, leave, miss_card, monthly_performance, mrb_review, near_miss, notice, requisition, scrap, seal_use, stock_clear`
→ 语义最近的 `mrb_review`（`sql/02_seed.sql:124-143`）**只是 2 节点简版**（并行评审 + 品质负责人批准），与 WMS MRB v3 的 10 态机 + 库存占用/守恒校验**完全不等价**，不能直接挂。

**必须 OA 改造（代码级）**：
1. `flow_instance` 加 `biz_system/biz_type/biz_id` + 唯一索引 → 幂等键（现在完全没有）
2. 通用终态/驳回/终止/撤回/退回 **出站回调**（5 个埋点，见 2.1）+ outbox + 重试 + 签名
3. 外部服务账号鉴权（API Key / mTLS），替代"密码登录拿 24h session"
4. `assertDelegateAllowed` 的 `scope='miss_card'` 硬编码（`flow.js:60`）放开为通用代提
5. 申请人显示：服务账号代提后 `applicant_name` 显示的是服务账号（`flow.js:218` 取 `u.real_name`），需要改为展示 `subject_user_id` 对应的人
6. 批量审批接口（`POST /api/instances/batch-approve`）—— OA 现在完全没有

**必须 WMS 改造**：
1. #1~#9 的 approve 接口下线或降级为「仅内部态」（否则双审批）
2. 新增调度器（`@nestjs/schedule` 未安装）或接 webhook；建议 webhook 为主 + 轮询兜底
3. `sys_account.oa_user_id` 映射（`platform_user_id` 已被占用）
4. 副作用迁移：`#3 自动生成 picking_order`、`#5 生成 supplement picking`、`#6 汇总回刷`、`#8 清空评审意见`、`#9 库存处置` —— 都必须在"收到 OA 结果"之后执行，且要可重入
5. 修 `getUserRole` 用 `platformUserId` 反查 UUID 的缺陷（3.4）

### 5.4 风险清单

| # | 风险 | 证据 | 处置建议 |
|---|---|---|---|
| **R1** | **双写 / 双审批** | OA `POST /api/tasks/:id/approve`（`flow.js:542`）与 WMS 9 个 approve 接口都能改状态 | OA 为唯一权威；WMS 侧接口改为 `403`/内部专用，状态由回调写入 |
| **R2** | **无幂等键，重复提单** | `flow_instance` 无业务唯一键；`buildInstanceNo` 只是流水号（`flow-engine.js:338-350`） | 必须加 `UNIQUE(biz_system,biz_type,biz_id)`；命中则返回既有实例（HTTP 200 + 同一 id） |
| **R3** | **回调丢失** | `runTerminalHooks` 是 in-process `try/catch` 吞异常（`flow-engine.js:95-100`）；改成 HTTP 后同样会失败 | OA 侧写 outbox 表（`flow_callback_outbox`），cron 重试（`services/cron.js:18-32` 可直接挂）；WMS 侧做幂等 + 轮询兜底 |
| **R4** | **用户不存在 → 流程挂起** | `resolveAssignees` 返回空 → 挂起 + 只通知 admin（`flow-engine.js:475-513`） | 上线前核对 OA `org_user` 是否有 `production_manager/wh_manager/iqc_manager/quality_manager` 对应人；加"提交前校验审批人存在"的预检接口 |
| **R5** | **权限 403** | `requirePermission('flow:submit')`（`flow.js:377`）+ `assertDelegateAllowed`（`flow.js:38-76`） | 服务账号给 admin 角色，或专用角色 + 放开 delegateGrant scope |
| **R6** | **附件双份存储** | OA 只收本地 multipart（`system.js:454-484`、`flow.js:337` `assertStagedRel`） | 一期可只传附件元信息（文件名+外部 URL 存 `form_data`），二期做代理上传 |
| **R7** | **状态粒度不足** | OA 只有 `running`，WMS MRB 有 3 个中间态（`mrb.status.ts:20-31`） | **MRB 两段（#8/#9）不迁 OA**，保留 WMS 状态机，OA 只做"通知+留痕"外围；或 OA 新增 `stage` 字段（`form_data.stage` 已有先例：`equipment_stocktake` 用 `form_data.stage`，`flow-engine.js:86-89`） |
| **R8** | **撤回导致单据永久卡死** | `withdrawInstance`（`flow-engine.js:1100-1109`）无钩子；WMS 无撤回入口 | 必须处理 `withdrawn`：WMS 收到后回 `draft` 或 `cancelled` |
| **R9** | **批量审批无接口** | OA 只能一个个 `POST /api/tasks/:id/approve` | 新增批量接口，或 WMS 侧循环（注意部分失败语义，参考 `iqc.service.ts:2359-2401` 的 `{success,failed,failedDetails}`） |
| **R10** | **版本漂移** | 改配置自动产新版本（`flow.js:709-799`）；在途实例绑旧版本（`flow-engine.js:380-389`） | 在途安全，但**新单会走新节点**；WMS 若依赖 `current_index` 会错位 → 只依赖 `status`，不依赖下标 |
| **R11** | **权限旁路（现存缺陷）** | `getUserRole` 用 `platformUserId` 反查 UUID → 空串 → 校验短路（3.4） | 对接时一并修 |
| **R12** | **服务账号 session 膨胀 / 锁定** | 24h session（`services/auth.js:72-80`）+ 5 次失败锁 15 分钟（`services/auth.js:14-40`） | 新增 API Key 鉴权，绕开登录 |

---

## 6. 建议的最小对接契约（供评审）

**WMS → OA 提交**
```
POST /api/instances
Authorization: Bearer <service-token>
{
  "definitionId": <wms_picking 对应 id>,
  "title": "领料单审批｜PK202610210001",
  "subjectUserId": <真实申请人的 OA org_user.id>,   // 代提，审批链按其上溯
  "formData": {
    "wms_biz_type": "picking_order",
    "wms_biz_id": "<uuid>",
    "wms_biz_no": "PK202610210001",
    "wms_url": "http://wms/…/picking/<uuid>",
    "items": [ … ],
    "total_qty": 120
  },
  "submitNow": true
}
→ { "code":0, "data": { "id": 8821, "instance_no": "PICKING-20261021-000123", "status": "running", … } }
```
（`wms_biz_*` 目前只能进 `form_data`；建议 R2 改造后提升为 `biz_system/biz_type/biz_id` 顶层列 + 唯一索引）

**OA → WMS 回调（需新增）**
```
POST https://<wms>/api/oa-flow/callback
X-OA-Signature: hmac-sha256(body, shared_secret)
{
  "event": "completed|rejected|withdrawn|terminated|returned",
  "instanceId": 8821,
  "instanceNo": "PICKING-20261021-000123",
  "definitionCode": "wms_picking",
  "bizSystem": "WMS", "bizType": "picking_order", "bizId": "<uuid>",
  "status": "completed",
  "finishedAt": "2026-10-21T10:22:33+07:00",
  "approvedBy": { "userId": 47, "realName": "阮文A" },
  "comment": "同意",
  "tasks": [ { "nodeName":"生产主管审批", "assigneeName":"阮文A", "action":"approve", "comment":"同意", "finishedAt":"…" } ]
}
→ WMS 幂等：按 (instanceId, event) 去重
```

---

## 7. 附：关键代码位置速查

| 主题 | 路径:行 |
|---|---|
| 创建实例 | `OA app/server/src/routes/flow.js:377-399` |
| 实例创建实现 | `OA app/server/src/services/flow-engine.js:906-940` |
| 单号生成 | `OA app/server/src/services/flow-engine.js:338-350` |
| 审批动作 | `OA app/server/src/routes/flow.js:542-553` → `flow-engine.js:655-836` |
| 推进/终态 | `OA app/server/src/services/flow-engine.js:392-540` |
| 终态钩子 | `OA app/server/src/services/flow-engine.js:54-101` |
| 审批人解析 | `OA app/server/src/services/flow-engine.js:219-327` |
| 挂起告警 | `OA app/server/src/services/flow-engine.js:475-513` |
| 鉴权中间件 | `OA app/server/src/middleware/index.js:13-34` |
| 登录/会话 | `OA app/server/src/services/auth.js:55-81, 183-192` |
| 流程表 DDL | `OA app/server/sql/01_schema.sql:95-201` |
| 实例扩展列 | `OA app/server/sql/05_p2_flows.sql:27-32` |
| 版本表 | `OA app/server/sql/14_s6_org_flow_ver.sql:76-98` |
| WMS 账号表 | `WMS server/database/schema.ts:305-329` |
| WMS JWT | `WMS server/common/auth/jwt-auth.guard.ts:7, 46-61, 74-76` |
| WMS 登录签发 | `WMS server/modules/system/system.service.ts:664-719` |
| WMS 角色误用 | `WMS server/modules/over-picking/over-picking.controller.ts:18-30` |
| MRB 状态机 | `WMS server/modules/mrb/mrb.status.ts:20-99` |
| 已有方案对比文档 | `WMS docs/流程电子化方案-20261021.md`（**未提及 OA**，其"方案 A 自研审批内核"与本方案互斥） |
