# OA × WMS 对接交付说明（OA 侧已完成）

**日期**：2026-10-25
**场景**：全流程交付（集成配置中心 → 电子流 → 服务账号/密钥 → 端到端验证）
**参与成员**：主理人（工程实施）+ 安全审查要点自检

---

## 📌 TL;DR（执行摘要）

- 整体结论：🟢 **OA 侧已具备承接 WMS 的完整条件**，端到端链路在本机验证 **19/19 通过**。
- 阻塞项数量：**1 个**（需管理员重启 OA 服务一次，加载新代码）。
- 下一步：重启 → 打开 `/integration-console.html` 核对 → 改 WMS 一行 `.env`（`OA_API_KEY`）→ 真机提交一张领料单。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟢 Go（OA 侧就绪） |
| 严重度分布 | 🔴 0 / 🟠 1（待重启）/ 🟡 2（表单字段空白、WMS 数据库端口未开放） / 🟢 6 |
| 关键行动项 | 5 条 |
| 建议负责人 | OA 管理员（重启）、WMS 管理员（改 Key / 验证回调） |

---

## 1. 本次完成事项

| # | 事项 | 状态 |
|---|------|------|
| 1 | 服务账号 `wms_bot`（非管理员，显示名「WMS 系统」） | ✅ 已建（#3162） |
| 2 | API Key「WMS 对接」（`flow:submit`，绑定 wms_bot） | ✅ 已建（#7，active） |
| 3 | 「登记已有密钥」接口 + 控制台入口（对方不用改配置） | ✅ 已实现并验证（幂等） |
| 4 | 「新建服务账号」接口 + 控制台入口（新装 OA 可自助） | ✅ 已实现并验证 |
| 5 | 9 个 WMS 流程审批人修正为可解析角色 | ✅ 已修正 + seed 同步 |
| 6 | 6 条业务配置（bizType → 流程） | ✅ 已配置 |
| 7 | WMS 回调地址 + HMAC 密钥 | ✅ 已配置 |
| 8 | 端到端验证（提交→待办→审批→回调入队） | ✅ 19/19 |
| 9 | 安全修复：`/api/auth/profile` 泄露 `password_hash` | ✅ 已修复并验证 |

---

## 2. 关键发现（会直接影响上线）

### 🔴 发现 1：`role:admin` 不能作为审批人（已修复）
流程引擎解析审批人时**排除申请人本人**（`u.id <> applicant_id`），而 `admin` 角色只有 1 个成员。
WMS 提交时 `applicantUserId` 常回退为 1（admin）→ 解析结果为空 → 单据**静默挂起**（`flow_log.action='no_assignee'`，仅通知管理员）。

**处置**：9 个流程改为业务角色——领料/超领/超耗/盘点 → `role:warehouse`（2 人）；IQC/MRB → `role:quality`（2 人）。seed SQL 已同步，新部署不再踩坑。

### 🟠 发现 2：`/api/auth/profile` 回传 `password_hash`（已修复）
原实现 `{ ...req.user }` 直接展开整行用户数据，把 bcrypt 散列返回给客户端。已改为剔除该字段，临时实例验证返回中不含 `password_hash`。

### 🟡 发现 3：表单字段为空
`flow_nodes` 可用，但 `form_schema` 为空、`form_data` 为自由 JSON（引擎不校验）。审批人在页面上**看得到原始字段但不美观**。等拿到 WMS 实际提交的字段清单后补 `form_schema` 即可（不影响流转）。

### 🟡 发现 4：WMS 数据库端口未对 OA 开放
`192.168.6.160:3000`（应用）可达，`5432` 及常见库端口全部不可达 → 品质总览仍显示"未连接到 WMS"。这是网络/暴露问题，不是 OA 配置问题。

---

## 3. 验证结果（真实执行，非纸面）

```
✓ 管理员登录
✓ 服务账号 wms_bot 存在且为非管理员
✓ 服务账号列表可用（33 个候选）
✓ 生成 API Key（绑定 wms_bot）
✓ 登记已有密钥（幂等命中同一条，不产生重复）
✓ 密钥表无重复记录
✓ 无密钥提交被拒（HTTP 401）
✓ API Key 提交单据成功（instanceId 创建）
✓ 实例状态 running
✓ 业务字段落库（biz_system/biz_type/biz_key）
✓ 生成待办任务（2 个，仓储角色）
✓ 审批通过（finished / completed）
✓ 审批后实例已完成
✓ 回调事件入队（2 条：running、completed）
✓ 事件归属 WMS
✓ 回调地址正确（/api/integration/oa/callback）
✓ 回调载荷含 bizKey / bizStatus
✓ 测试单据已清理
结果：19 通过 / 0 失败
```

补充验证：
- 用该 Key 在**线上 8080** 调 `/api/auth/profile` 返回 `wms_bot`（错误 Key 返回 401）。
- 控制台脚本语法 OK；`integration-console.html` / `integration-setup.html` / `oa-acl-grant-patch.js` 静态托管均 **HTTP 200**。
- seed SQL 在事务内执行通过（9 条命中）并回滚，未污染数据。

---

## 4. 交付物清单

| 类型 | 路径 |
|---|---|
| 接口 | `src/routes/integration.js`（+ keys/import、service-accounts） |
| 安全 | `src/routes/auth.js`（profile 剔除 password_hash） |
| 种子 | `sql/87_wms_eflow_seed.sql`（审批人改为 warehouse/quality） |
| 控制台 | `app/web/dist/integration-console.html`（登记密钥 / 新建服务账号） |
| 测试脚本 | `tools/test-wms-e2e.mjs`（19 项断言，可重复执行） |

数据库现状：
- `sys_api_key`：1 条（#7，`flow:submit`，绑定 #3162）
- `org_user`：+1 条（`wms_bot`，非管理员）
- `sys_integration_biz`：6 条（picking_flow→35、over_supplement→36、over_consume→37、stock_take→38、iqc_report→39、mrb→40）
- `sys_integration_system`：WMS（base + webhook）、MES（占位）
- `flow_definition`：30/31/34–40 共 9 条，审批人已按业务分配

---

## ✅ 行动清单

| # | 行动 | 负责方 | 紧急度 |
|---|------|--------|--------|
| 1 | 管理员重启 OA：`net stop "OA" && net start "OA"`（或 `tools\04-重启服务.bat` 右键以管理员运行） | OA 管理员 | **P0** |
| 2 | 决定密钥策略：① 把新 Key 写进 WMS `.env` 的 `OA_API_KEY`；**或**② 打开控制台「登记已有密钥」，粘贴 WMS 现用的完整 Key（WMS 不用改） | WMS 管理员 | **P0** |
| 3 | 打开 `http://<OA>:8080/integration-console.html`，核对「系统连接 / 业务配置 / API 密钥 / 事件」四页 | OA 管理员 | P1 |
| 4 | WMS 提交一张真实领料单，确认 OA 生成待办、审批后 WMS 收到回调 | 双方 | P1 |
| 5 | 补 `form_schema`（拿到 WMS 实际 formData 后），让审批页展示业务明细 | OA 侧 | P2 |

---

## ⚠️ 待完善 / 已知局限

1. **回调未真实投递验证**：为避免向 WMS 生产库写入测试数据，本次只验证到"事件入队 + 地址/载荷正确"。真实投递需在重启后由一张真实单据触发。
2. **对账兜底仍在 WMS 侧**：OA 已提供 `GET /api/instances/:id`、`/api/open/v1/flow/changes`（增量）与 outbox 失败重放，但"定时对账"需在 WMS 侧实现（其代码在目标服务器，本机无新版源码）。
3. **WMS 数据库端口未开放**：品质总览仍是"未连接"。需 WMS 侧放行 5432 + `pg_hba`，或提供只读 API。
4. **密钥保管**：API Key 明文只在首次生成时返回；本次已通过对话交付，未写入任何文件。`server/data/integration.key` 是配置解密密钥，**须与数据库一同备份**。

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
