# 集成中枢三项补齐 · 交付与发布前检查报告

**日期**：2026-10-26
**场景**：全流程交付（实现 → 安全审计 → 发布前把关）
**参与成员**：主理人沽思航（实现与汇编）、安全官（Web 安全审计）、质量门神（QA 与发布把关）
**代码位置**：`D:\Program Files\OA`（生产），回滚副本 `D:\Program Files\OA\backup-20261026`

---

## 📌 TL;DR

- **整体结论**：🟡 **有条件通过**——功能已实现并跑通，两轮复核提出的 6 项必修已全部修完；剩 1 个动作：**等你重启服务**（重启前新接口返回 404，已实测）。
- **阻塞项数量**：1（重启服务）＋ 1（MES 侧尚未提供回调地址/密钥，属外部依赖，不阻塞上线）
- **下一步**：管理员执行 `D:\Program Files\OA\tools\04-重启服务.bat`，重启后按第 5 节清单逐条核对，尤其确认控制台「告警与对账」页签能打开、能跑出一轮对账。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟡 条件 Go（重启即可） |
| 严重度分布 | 🔴 0（全部已修） / 🟠 2（已修，需观察） / 🟡 5（接受或排期） / 🟢 7 |
| 关键行动项 | 4 条 |
| 建议负责人 | 管理员（重启）／IT（观察一周告警）／采购或 MES 厂商（给回调地址） |

**真实数据验证结果（不是模拟）**

| 项目 | 结果 |
|---|---|
| IQC 对账 | WMS 待检 219 批 / OA 镜像 219 批 / **差异 0** |
| 回写对账 | 近 72 小时外部单据 0 张（尚未有 WMS 流程单），无假差异 |
| 告警去重 | 同一异常重复扫描 → 只累加命中次数，不再新增、不重复通知 |
| 自动关闭 | 症状消失后自动关闭；**本轮漏检/结果截断时一律不关** |
| 自动补发上限 | 达 3 次后转 `retry_capped`，不再无限重试 |
| 停用保护 | 系统被停用时不补发、不探测（实测 `skipped_disabled`） |

---

## 1. 各成员核心结论

### 🔧 主理人（实现）
三项全部落地：告警（5 分钟扫描、去重、自动关闭、30 秒/类别通知节流）、对账（回写 + IQC 双向，自动补发有上限、并发闸门 409）、MES 连接器（签名 ping + 入站复用对外 API）。**关键判断：对账不再依赖 WMS 数据库**——原来那段对账走 `wmsQuery` 直连 PG，而这台机器只通 3000 端口，等于从来没跑起来过；改成走 HTTP 接口后才真正可用。

### 🛡️ 安全官（OWASP + STRIDE）
核心判断：「权限面收敛（全部管理员）、SQL 全参数化、密钥不出现明文、不泄露 `password_enc`，整体安全水位不低」。**但指出 4 条 P0**：对账告警自动关闭在检查被截断时会误关（造成漏警）、失败重发无上限（每 6 小时无界重发）、空密钥 ping 会给出假绿灯、SSRF 缺加固。另外 1 条经复核**属误报**（`/reconcile/runs/:id` 实际有 `adminOnly`，见第 2 节说明）。

### ✅ 质量门神（QA 与发布）
核心判断：「代码质量足够上线，新增 3 个缺陷（A/B/C）都是真的，但影响面可控」。**最尖锐的一条是一致性缺陷**：前端（dist 静态）已生效、后端（src）未生效，用户若在重启前打开控制台，会看到新页签一调用就 404——必须提前告知使用方。同时把「无代码备份」列为唯一阻塞项，已按建议补齐回滚副本。

---

## 2. 综合发现（去重后按严重度）

| # | 严重度 | 位置 | 问题 | 处置 |
|---|---|---|---|---|
| 1 | 🔴 | `integration-alert.js` `closeStaleAlerts` | 只按「本轮没再命中」关闭告警，若查询被 `LIMIT 50` 截断，第 51 条起的告警会被误判成「已恢复」而关闭 → **漏警** | ✅ 已修：改为「按本轮实际检查到的 key」关闭；结果被截断时整轮不关闭（`closeSkipped` 会显示原因） |
| 2 | 🔴 | `integration-reconcile.js` `reconcileOutbox` | failed 行被重置为 `attempts=0`，每 6 小时再重发 8 次，永远循环，永不升级到人工 | ✅ 已修：新增 `manual_retry_count`（迁移 91），上限 3 次后转 `retry_capped` |
| 3 | 🔴 | `reconcileIqc` + `TERMINAL` | ①WMS 不可达时返回空集合，会把 219 条镜像全判成「假待检」（假差异风暴）②`terminated/withdrawn` 单据历史上从不发 `completed` 事件，纳入对账会变成**永久红告警** | ✅ 已修：WMS 零结果+有错误 → 整轮 `skipped`；对账只认 `completed/archived`，且只查 `event='completed'` 的回写 |
| 4 | 🔴 | `mes-connector.js` `pingMes` | 未配密钥时用空字符串算签名，对端若「验签失败也回 200」会得到**假绿灯** | ✅ 已修：无密钥直接拒绝测试并说明原因 |
| 5 | 🟠 | `wms-webhook.js` `enqueueWmsEvent` | 没配回调地址时静默 `return`，对账却报「已补发」——**谎报**，问题被掩盖 | ✅ 已修：返回 boolean，对账据此区分 `resent` / `skipped_no_webhook` |
| 6 | 🟠 | `mes-connector.js` `pingMes` | URL 无协议白名单、自动跟随 302、回显对端响应体 | ✅ 已修：仅 http/https、`redirect:'error'`、只记状态码不回显正文 |
| 7 | 🟡 | `pingMes` / 补发 | 未判断系统 `enabled=false` | ✅ 已修：停用系统不探测、不补发 |
| 8 | 🟡 | 全链路 | 通知在极端情况下可能 50 条/秒级轰炸 | ✅ 已缓解：同一类别 30 秒内只推一条（站内信+邮件+飞书共用这道闸）；列表一条不少 |
| 9 | 🟡 | 对账接口 | 同时多次点「立即对账」会并发拉 WMS | ✅ 已修：进程内闸门，重复点击 409（实测 5 路并发 → 3 个 409） |
| 10 | 🟡 | `sys_integration_alert` | 长期只增不删 | ✅ 已修：每 6 小时清理 90 天前已关闭记录 |
| 11 | 🟡 | SSRF | 内网地址未禁（回环/私网） | ⚠️ **接受**：本项目是内网部署，合法目标本来就是 `192.168.6.160`（WMS）；一刀切禁私网会直接把功能打死。已做协议白名单 + 禁跳转 + 8 秒超时 + 不回显，风险由「管理员即系统所有者」这一前提覆盖 |
| 12 | 🟡 | `listAdminUserIds` | 未过滤 `active`，离职管理员仍收告警 | ⏳ 未改：该函数被流程引擎共用，改动会波及待办；建议单独立项 |
| 13 | 🟡 | `wms-webhook.js` 投递 | 整批串行、单条 8 秒超时，对端挂死时批时长 = 20×8 秒 | ⏳ 未改：现网 outbox 常态为 0，暂不构成问题；上量后需改 `Promise.allSettled` |
| 14 | 🟢 | `/api/integration/reconcile/runs/:id` | 安全官报「缺 adminOnly」 | ❌ **误报**：该路由第 4 行即 `if (!adminOnly(req, reply)) return;`，已现场贴码复核 |

---

## ✅ 行动清单

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|---|---|---|---|
| 1 | 以管理员身份跑 `D:\Program Files\OA\tools\04-重启服务.bat`，让后端生效 | 系统管理员 | **P0** | 立即 |
| 2 | 重启后按第 5 节清单逐条核对（尤其「告警与对账」页签 + 跑一轮对账） | 系统管理员 | **P0** | 重启后 10 分钟内 |
| 3 | 观察一周：告警是否只在真异常时出现；对账是否稳定 0 差异 | IT | P1 | 11-02 |
| 4 | 找 MES 厂商要「回调地址 + 回调密钥 + 业务类型清单」，填进系统连接 | 采购/IT | P1 | 与 IQC 接管（11-10）同步 |

---

## 3. 交付清单

**新增（服务端）**

| 文件 | 行数级 | 作用 |
|---|---|---|
| `sql/90_integration_alert.sql` | 建表 | `sys_integration_alert`（告警台账，partial unique index 保证同 key 只有一条未关闭）+ `sys_integration_reconcile_run`（对账运行记录） |
| `sql/91_outbox_manual_retry.sql` | 加列 | `flow_webhook_outbox.manual_retry_count`（补发记账） |
| `sql/92_alert_close_reason.sql` | 加列 | `closed_at` / `closed_reason`（关闭可追溯） |
| `services/integration-alert.js` | ~290 | 产生/去重/关闭/查询/确认告警；5 分钟扫描四类异常；通知节流；过期清理 |
| `services/integration-reconcile.js` | ~330 | 回写对账（补齐漏发、限次重试）+ IQC 三向对账（走 HTTP）+ 并发闸门 + 结果落库 |
| `services/mes-connector.js` | ~100 | MES 配置读取、签名 ping、验签参考实现 |

**修改**

| 文件 | 改动 |
|---|---|
| `routes/integration.js` | +7 个管理员接口：告警列表/确认/扫描、对账执行/历史/明细、MES 状态/ping |
| `services/cron.js` | +2 个定时任务：告警 5 分钟、对账 6 小时（各带包装函数，只在有事时打日志） |
| `services/wms-iqc-pull.js` | 导出 `apiGet` 供对账复用（只读） |
| `services/wms-webhook.js` | `enqueueWmsEvent` 返回 boolean（修谎报） |
| `web/dist/integration-console.html` | +「告警与对账」页签：告警表、立即对账、对账历史、MES 连接器卡片 |

**文档与工具**

- `deliverables/MES对接契约-v1.md`（给 MES 厂商的要约：入站 4 接口、出站事件与验签、需对方提供的 5 项）
- `tools/mes-mock.mjs`（本地 MES 模拟器，验证签名走通）
- `tools/make-rollback-20261026.mjs`（反向补丁，生成回滚副本）
- `D:\Program Files\OA\backup-20261026\`（4 个 `.pre` 回滚副本，均通过语法自检）

**测试覆盖**

- 告警：新告警 / 重复命中累加 / ack 后再命中退回 open / 症状消失自动关闭 / 截断不关闭
- 对账：真实 219/219 零差异；漏发自动补发 → 10 秒内投递成功 → 二次对账自愈；补发上限 3 次；停用不补发；并发 409
- MES：ping 签名验签 200；无密钥拒绝；无地址提示
- 数据卫生：测试后 `flow_instance` 回到 351 条、outbox/告警/对账记录归零、站内信计数回到 16639、MES 回调地址还原为 null

---

## 4. 回滚预案（最小回滚，只回滚本次）

```bash
# 0) 先停服务（管理员执行），避免边改边跑
#    tools\04-重启服务.bat 里的停止部分，或 services.msc 停止 OA

# 1) 还原 4 个文件（回滚副本已通过语法自检）
copy "D:\Program Files\OA\backup-20261026\routes-integration.js.pre"      "D:\Program Files\OA\app\server\src\routes\integration.js"
copy "D:\Program Files\OA\backup-20261026\services-cron.js.pre"           "D:\Program Files\OA\app\server\src\services\cron.js"
copy "D:\Program Files\OA\backup-20261026\services-wms-iqc-pull.js.pre"   "D:\Program Files\OA\app\server\src\services\wms-iqc-pull.js"
copy "D:\Program Files\OA\backup-20261026\integration-console.html.pre"   "D:\Program Files\OA\app\web\dist\integration-console.html"

# 2) 启动服务，验证老功能仍在
#    打开 http://192.168.1.61:8080/integration-console.html → 应只剩 4 个页签
```

- 3 个新 service 文件 404 不影响启动（没人引用它们即不会被加载）；确认稳定后可删。
- 3 张新表**不需要删**（纯增量，旧代码不认识它们，不会报错）。若要彻底清理：
  `DROP TABLE IF EXISTS sys_integration_alert, sys_integration_reconcile_run;`
  `ALTER TABLE flow_webhook_outbox DROP COLUMN IF EXISTS manual_retry_count;`
- `wms-webhook.js` 的返回值改动对旧调用方向后兼容（旧调用方忽略返回值），可不回滚。

---

## 5. 发布检查清单（重启后照做）

**重启前**
```bash
# ① 三张表/列已就位（应各返回 1 行）
psql -U postgres -d oa_system -c "SELECT 1 FROM information_schema.tables WHERE table_name='sys_integration_alert'"
psql -U postgres -d oa_system -c "SELECT 1 FROM information_schema.columns WHERE table_name='flow_webhook_outbox' AND column_name='manual_retry_count'"
```

**重启后**
1. 打开 `http://192.168.1.61:8080/integration-console.html`，用管理员登录 → 应看到 **5 个页签**，最后一个是「告警与对账」。
2. 点「立即扫描」→ 提示「扫描完成：新告警 0 条」（当前无异常，这是正确结果）。
3. 点「立即对账」→ 约 5–20 秒，出现「回写差异 0 / IQC 差异 0」，下面一行写「WMS 219 批 / OA 219 批」。
4. 看 MES 卡片 → 状态「未配置」，最近测试「还没测过」。等厂商给了地址再填。
5. 服务端确认定时任务在跑（这两条出现即成功）：
   ```bash
   findstr /C:"集成告警扫描" /C:"集成对账" "D:\Program Files\OA\app\server\logs\app-2026-10-26.log"
   ```
   或用界面证明：6 小时后「对账历史」里会自动多出一行「定时」。

**注意**：重启前不要点控制台新页签——后端新接口此时还不存在，会报 404。

---

## ⚠️ 待完善 / 已知局限

1. **MES 侧尚无契约**：连接器只完成「OA 这一半」，MES 不给回调地址就无法真正联调（`deliverables/MES对接契约-v1.md` 可直接发给厂商）。
2. **界面不能新增系统**：只能在 WMS / MES 两行上改参数；将来接 QMS 需要先在库里加一行。
3. **对账只覆盖「回写是否送达」**：拿不到对方「业务上是否真的落库」的确认，除非对方实现 `/flow/changes` 自查。
4. **通知节流可能少推**：同类别 30 秒内多条新告警只推第一条，其余只在列表里。
5. **离职管理员仍会收到告警**：见第 2 节 #12。
6. **对账/告警的定时任务依赖 `CRON_ENABLED`**：该开关为 false 时只能手动触发（当前为 true）。

---

## 📚 成员产出索引

- 安全官原始产出：13 条发现（F-01…F-17 编号体系），含可利用场景与修复建议；其中 F-04 经复核为误报，F-07 的具体建议（禁私网）与内网部署现实冲突，改为协议白名单 + 禁跳转。
- 质量门神原始产出：缺陷 A/B/C/D + 回归风险 R-1…R-6 + 三套上线核对命令 + 回滚预案 + 6 个我漏测的场景；其中 R-1（无代码备份）已用反向补丁补齐。
- 主理人：实现、加固（通知节流、并发闸门、补发上限、停用保护）、全部实测数据与清理。

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
