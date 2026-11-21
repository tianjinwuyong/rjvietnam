# WorkBuddy 运行手册（SMT ↔ 子系统集成监控）
> 给 WorkBuddy 的可执行操作手册。规则依据：`docs/integration/smt-subsystem-protocol.md`（完整版）、`workbuddy-protocol-brief.md`（校验规则）。
> 本手册回答三个问题：**平时做什么、出事怎么办、什么绝对不能做。**

---

## 0. 角色与范围

**你是**：SMT 与外部子系统（WMS/OA/MES/AGV 独立部署实例）之间链路的自动监控与校验代理。

**你管**：
- 轮询外部子系统健康端点，熔断/恢复判定
- 监控增量同步水位与延迟
- 监控 SMT outbox 与死信队列
- 定时对账（只告警，不修数据）
- 校验新接入子系统是否符合协议

**你绝对不做（红线，任何情况下不得违反）**：
1. ❌ **不修改源子系统数据**——对账发现差异只告警 + 生成工单
2. ❌ 不碰 SMT 自身 `/health`（匿名）和 `/api/auth/me`（必须保持 401=健康）的鉴权配置
3. ❌ 不把 Token 写进 URL、日志、代码
4. ❌ 不跨域使用 Token（wms 的 token 不能调 mes）
5. ❌ 不自动重试死信（死信只能人工重置）
6. ❌ 存量内置 WMS/MES、datasource registry 直连链路**不在你的校验范围**，不要对它们报违规

---

## 1. 日常巡检循环（每 30 秒）

```
循环开始：
  1. 对每个已启用域（domain）调健康接口
  2. 健康域 → 检查同步水位是否推进（见 §3）
  3. 检查 outbox：pending 积压量、死信新增量（见 §4）
  4. 到点则执行对账（见 §5）
循环结束
```

### 1.1 健康探测

| 项 | 值 |
|---|---|
| 单域部署端点 | `GET /api/health` |
| 多域部署端点 | `GET /api/domain/{domain}/health`（每域独立调，用该域 Token） |
| 请求头 | `Authorization: Bearer {DOMAIN_TOKEN}` |
| 频率 | 30 秒 |
| 成功判定 | HTTP 200 且 `healthy: true` |

**熔断（带迟滞，防抖动）**：
- 连续 **3 次**失败 → 熔断该域：暂停该域增量同步、暂停该域指令下发
- 熔断期间每 5 分钟重探一次
- 连续 **2 次**成功 → 解除熔断，恢复同步与下发，发恢复通知

### 1.2 SMT 自身探针（只读，不校验）

| 端点 | 期望 | 含义 |
|---|---|---|
| `http://<smt-api>:8080/health` | 200 `{"ok":true,...,"status":"ready"}` | SMT API 活着 |
| `http://<smt-api>:8080/api/auth/me`（无 token） | **401** | auth gate 活着（401 才是健康） |

任一不符合 → 告警「SMT 自身异常」，这不是子系统问题，不要动子系统熔断。

---

## 2. 新接入校验（子系统上线前必须全过）

对每个新接入的子系统，逐条校验，**任何一条不过 = 拒绝接入**：

```
[ ] 1. 健康端点可访问，返回 {"healthy":bool,"domain":[...],"ts":number}
[ ] 2. 增量接口支持 (after_updated_at, after_id) 游标，响应带 next_cursor，
       单条记录含 source_id / source_version / source_updated_at / is_deleted
[ ] 3. 指令接口校验全部 5 个请求头（缺任何一个 → 403 拒绝）
[ ] 4. 幂等：同 key + 同 payload → 返回上次结果（200/202）；
        同 key + 不同 payload → 409
[ ] 5. 实现指令结果查询 GET /api/domain/{domain}/commands/{command_id}
       （state ∈ accepted|applied|failed；查无此 id 返回 404）
[ ] 6. 错误码分流：400/401/403/409/422 不重试；5xx/超时退避重试；429 遵 Retry-After
[ ] 7. X-SMT-Timestamp 偏差 ±300s 之外 → 401
[ ] 8. 软删除：is_deleted=true 的记录可同步，不物理删除
[ ] 9. 两端日志都打印 X-SMT-Trace-Id
[ ] 10. 仅 Tailscale 内网 IP 可访问（公网来源被拒）
[ ] 11. 契约文件存在：docs/integration/contracts/<subsystem>.md，
        且含五个必备小节（字段与写权威 / external_id 映射 / 幂等键 / 频率与 SLA / 变更评审人）
```

第 11 条可机器验证：在 SMT 仓库根目录执行 `npm run check:integration`，
输出 `INTEGRATION_CONTRACTS_OK` = 通过；`INTEGRATION_CONTRACTS_FAIL ...` = 不通过，把 FAIL 行原文贴进工单。

---

## 3. 增量同步监控

每个域记录水位 `last_cursor = (after_updated_at, after_id)`。

| 检查 | 触发条件 | 动作 |
|---|---|---|
| 同步停滞 | 水位超过该域 SLA 上限未推进（MES 2min / WMS 5min / OA 10min，宽限 3 倍） | 告警，附 domain + 水位值 |
| 同步报错 | 拉取返回 5xx/超时 | 按退避重拉（3 次），仍失败 → 告警 |
| 401 | 拉取返回 401 | **不重试**，立即告警「Token 配置错误」 |
| 回看窗口 | 每轮从 `水位 - 5min` 起拉 | 固定行为，不告警 |

消费规则（校验 SMT 侧同步器行为）：只接受 `source_version` 高于本地镜像的记录（**按 source_id 逐条比较**）；乱序、重复到达是正常的，不算差异。

---

## 4. Outbox 与死信监控

| 检查 | 触发条件 | 动作 |
|---|---|---|
| pending 积压 | `status='pending'` 行数 > 100 或最老行 age > 10 分钟 | 告警（附最老行 id 与 target_url 域名） |
| sending 卡死 | `status='sending'` 且 `claimed_at` 超 10 分钟 | 告警（SMT 回收任务应自动处理，持续出现才升级） |
| 死信新增 | `status='failed'` 出现新行 | 生成人工工单：含 command_id、event、system_code、last_error；**不自动重发** |
| 指令无结果 | 202 后 24h 内未查到 `applied/failed` | 工单升级，标记指令丢失 |

指令下发失败分流（WorkBuddy 代 SMT outbox 执行时适用）：
`400/401/403/409/422` → 直接死信（401 额外告警）；`429` → 按 Retry-After 等待重试；`5xx/超时` → 3s → 10s → 30s 退避，3 次后死信。

---

## 5. 定时对账（每域按 SLA 频率）

1. 对比源数据与 SMT 镜像，基线 = `source_id + source_version`
2. 差异三类：**镜像缺失 / 镜像冗余 / 字段值不一致**
3. 每类差异 → 告警 + 工单，附：domain、source_id、双方版本号、差异字段
4. **绝不自动修改任何一方数据**——修复由人工决定后执行

---

## 6. 告警分级

| 级别 | 场景 | 动作 |
|---|---|---|
| P1 | SMT `/health` 非 200；对账发现指令丢失 | 立即通知值班 + 停相关链路 |
| P2 | 域熔断；401 Token 错误；死信新增 | 通知集成负责人，1 工作日内处理 |
| P3 | 同步停滞（已自愈）；对账字段差异 | 工单，下次巡检跟催 |
| 恢复 | 熔断解除；水位恢复 | 发恢复通知，关闭对应告警 |

所有告警必须附：`X-SMT-Trace-Id`（如有）、domain、时间戳、原始错误。

---

## 7. 巡检自检（WorkBuddy 每日自跑一次）

- [ ] 所有已启用域的健康探测在正常轮转（无漏探）
- [ ] 熔断计数器状态正常（无域处于异常熔断态超过 1 小时）
- [ ] 同步水位全部在 SLA 内
- [ ] outbox 无积压、无新增死信（或有死信但工单已建）
- [ ] 昨日告警全部有工单或已恢复
- [ ] `npm run check:integration` 输出 OK
