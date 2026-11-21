# SMT ↔ 子系统集成协议（适配 WorkBuddy 自动校验｜含裁决修正）

> 文档路径：`docs/integration/smt-subsystem-protocol.md`
> 定位：**目标态集成规范，非全局强制宪法**
> 适用范围：新接入、独立部署的外部子系统（外移后的 mesrj/itf、AGV、外部 ERP 等）
> 豁免范围：现役主仓内置 WMS/MES、datasource registry 直连同步链路，走例外通道，不纳入本协议的 WorkBuddy 自动门禁校验

## 目录
1. 基础约定
2. 裁决说明（与现有仓库冲突点，优先阅读）
3. 网络、鉴权、通用头规范
4. 接口定义（健康探测 / 增量同步 / 指令下发 / 指令结果查询）
5. 幂等、状态码、重试 & 熔断规则
6. 数据版本、乱序、重复消费约束
7. 对账规则
8. WorkBuddy 自检清单
9. 链路流程图
10. 变更通知规则

---
## 1. 基础约定
1. 传输编码：UTF-8，JSON
2. 时间标准：全部 UTC，秒级 Unix 时间戳
3. 业务域前缀：`/api/domain/{domain}/`，domain 取值：`wms` / `oa` / `mes` / `agv`
4. 两条独立链路：
   - 增量拉取链路：SMT → 子系统，拉取主数据，生成只读镜像 `ext_* / rjvn_*`
   - 指令下发链路：SMT 发件箱 outbox → 子系统，下发业务动作请求，子系统自主更新主库
5. 同步频率参考（可配置）
    - MES工单、SN追溯：30s ~ 2min
    - WMS库存批次：1 ~ 5min
    - OA审批流：2 ~ 10min
6. 删除规则：使用 `is_deleted: true` 软标记，禁止物理硬删除，SMT镜像同步后标记删除

---
## 2. 裁决说明（关键，适配仓库现状）
> 下面 5 条是本协议和现有代码仓库冲突的裁决，WorkBuddy 校验逻辑必须识别这几条豁免规则。

1. **数据库直连豁免**
本协议默认优先 HTTP API 集成；但仓库已有的 `datasource registry`、migration 331 直连 PostgreSQL/MySQL 拉取 `ext_*` 表的能力保留，作为**存量多厂区同步的例外通道**，不触发本协议 API 门禁校验。新接入外部子系统，优先走 HTTP。

2. **数据源归属区分**
现役 WMS/MES 和主仓共库共事务，不属于本协议的外部独立子系统；本协议仅对**外移拆分出来的独立子系统**生效，现役链路不按这套规则校验。

3. **健康端点双轨制（非常重要）**
- SMT 自身健康端点：**只有 `/health`**，匿名无鉴权，实测返回 `{"ok":true,"service":"api","port":8080,"status":"ready"}`，供 docker compose、CI 探针使用，**不受本协议约束**。
  （实测 2026-11-21，prod：`/api/health` 带有效 token 也是 404 —— SMT 上不存在该路径，因此 `/api/health` 专属外部子系统，无冲突。）
- 外部子系统健康端点：`GET /api/health`（单域部署）或 `GET /api/domain/{domain}/health`（多域部署，见 §4.1），带 Bearer 鉴权，返回 `{"healthy":bool,"domain":[...],"ts":number}`，是 WorkBuddy 探测外部子系统的接口。

4. **幂等返回语义修正**
- 相同 `X-Idempotency-Key` + 相同 payload：直接返回上次成功结果（200 / 202），不返回 409
- 相同 `X-Idempotency-Key` + 不同 payload：返回 409 Conflict，代表业务意图冲突，需要人工介入

> 补充：409 不再用于单纯防重复执行，只用于"key 重复但报文不一致"的冲突场景。

5. **`/api/auth/me` 运行保护**
SMT 的 api 容器 healthcheck 为 `fetch('http://127.0.0.1:8080/api/auth/me')` 且**以 401 为健康**（探的是"auth gate 活着"）。任何改动不得把 `/api/auth/me` 改成公开或删除——否则容器被判不健康进入重启循环。

---
## 3. 网络、鉴权、通用请求头
1. 网络：仅允许 Tailscale 私有内网 IP 访问，拒绝公网来源
2. Token 策略：按业务域独立 Bearer Token，域之间隔离，不可跨域使用；Token 放在 Header，禁止 URL 传参、禁止硬编码
3. 指令接口强制请求头（增量同步接口只需要 Authorization）：
```
Authorization: Bearer {DOMAIN_TOKEN}
X-Idempotency-Key: {UUID}
X-SMT-Trace-Id: {UUID}
X-SMT-Source: smt-factory-system
X-SMT-Timestamp: {UTC秒级时间戳}
```
- `X-SMT-Trace-Id`：全链路追踪 ID，两端日志必须打印该字段，用于排查
- `X-SMT-Timestamp`：防重放。子系统必须校验与本地时间的偏差，**允许 ±300 秒**，超窗返回 401 并告警。需要更强保证时，沿用仓库既有 `MES_SIGNATURE_ENFORCEMENT` 的 HMAC-SHA256 模式对 `method + path + body + timestamp` 签名。

---
## 4. 接口定义
### 4.1 外部子系统健康接口（子系统实现，WorkBuddy 轮询）
- 单域部署：`GET /api/health`
- 多域部署（一个部署服务多个 domain）：**必须**按域暴露 `GET /api/domain/{domain}/health`，每域用该域自己的 Token 校验——解决"多域 health 用哪个 token"的归属问题。

请求头：`Authorization: Bearer {DOMAIN_TOKEN}`
请求体：无
返回示例（200）
```json
{
  "healthy": true,
  "domain": ["wms","mes"],
  "ts": 1763720000
}
```
探测频率：30s 一次；**熔断带迟滞：连续 3 次失败才熔断，恢复需连续 2 次成功**，避免抖动。熔断后暂停该域同步、暂停下发指令。

### 4.2 增量同步接口（SMT 拉取镜像）
路径：`GET /api/domain/{domain}/incremental`
查询参数：
- `after_updated_at` + `after_id`：**推荐游标**，keyset 分页元组 `(source_updated_at, source_id)`
- `after_version`：兼容参数，仅当子系统能保证**域内全局单调**版本序列时可用
- `page_size`：分页条数（可选）

返回示例
```json
{
  "list": [
    {
      "source_id": "子系统唯一业务主键",
      "source_version": 12345,
      "source_updated_at": 1763720000,
      "is_deleted": false,
      "data": {}
    }
  ],
  "next_cursor": {"after_updated_at": 1763720005, "after_id": "WO-2231"}
}
```
> 游标语义（裁决）：各表独立序列的 `source_version` **不能**做全域游标（多表序列交错会漏读）。分页一律按 `(source_updated_at, source_id)` keyset 推进，响应必须带 `next_cursor`；另设**回看窗口（默认 5 分钟）**，每轮从 `水位 - 5min` 起拉，实现漏读自愈。
> 消费规则：事件允许重复、乱序；`source_version` 的"只接受更高版本"比较**按 `source_id` 逐条进行**（不是全域比较），禁止依赖到达顺序驱动状态机。

### 4.3 指令接收接口（SMT outbox 下发动作，POST）
路径模板：`POST /api/domain/{domain}/{action}`
示例：`POST /api/domain/mes/station-complete`
请求体 JSON，每个业务域独立维护 Schema。示例报文：
```json
{
  "sn": "SN2611210001",
  "station_id": "SMT-01",
  "result": "pass",
  "operator": "U1001"
}
```
受理成功优先返回 202：
```json
{"ok":true,"command_id":"xxx"}
```

### 4.4 指令结果查询接口（202 的收敛手段，必实现）
202 只代表"已受理"，不代表业务成功。子系统必须实现：
```
GET /api/domain/{domain}/commands/{command_id}
→ 200 {"command_id":"xxx","state":"accepted|applied|failed","error_code":null,"ts":1763720000}
→ 200 {"command_id":"xxx","state":"failed","error_code":"INSUFFICIENT_STOCK","ts":...}
```
- `state` 取值：`accepted`（已受理未处理）/ `applied`（业务已生效）/ `failed`（业务失败，`error_code` 说明原因）
- 查询不到该 `command_id` → 404（SMT 侧视为 failed 处理并告警，防止指令凭空消失）
- SMT outbox 在 202 后轮询本接口（间隔 30s，最多 24h），`applied` 关闭指令，`failed` 进死信。

---
## 5. 状态码、重试、发件箱规则
> 发件箱最大重试：3 次，退避序列：3s → 10s → 30s
> outbox worker 按 provider 做并发限额、租约锁，防止重试风暴耗尽连接（本机 Postgres `max_connections=100`，单 API 实例约占 20–25）

| HTTP码 | 含义 | 重试策略 |
| ---- | ---- | ---- |
| 202 | 指令已接收，异步处理 | 不重试（转 §4.4 轮询结果） |
| 200 | 同步快速完成 | 不重试 |
| 400 | 参数格式错误 | ❌ 不重试，直接进死信 |
| 401 | Token 无效/过期/时间戳超窗 | ❌ 不重试，**立即告警**（配置错误，不是瞬时故障） |
| 403 | 权限不足 | ❌ 不重试，直接进死信 |
| 409 | 幂等 key 相同，但 payload 不一致 | ❌ 不重试，直接进死信 |
| 422 | 业务校验失败（库存不足、工单关闭） | ❌ 不重试，直接进死信 |
| 429 | 限流 | ✅ 读取 Retry-After，等待后重试 |
| 500~599 / 超时 | 服务临时故障 | ✅ 按退避策略重试 |

- 死信：重试耗尽进入死信队列，程序不再自动重试，人工排查后可重置 pending 重发或丢弃
- 超时：SMT 侧请求超时 8s；单条指令全生命周期（含重试与结果轮询）最坏 ≈ 67s + 轮询时长，容量规划按此估算

---
## 6. 字段规范
- `source_id`：子系统业务唯一 ID，字符串，镜像关联主键
- `source_version`：**单记录**单调递增版本号，用于消费端按 `source_id` 去重与排序
- `source_updated_at`：UTC 修改时间戳，同时是分页游标的第一排序键
- SMT 附加镜像字段：`_smt_synced_at`、`_smt_sync_job_id`，子系统无需感知

---
## 7. 对账规则
1. SMT Agent 定时对账，对比子系统源数据与 SMT 镜像数据
2. 差异类型：镜像缺失、镜像冗余、字段值不一致
3. 核心约束：**对账只告警、生成工单，绝不自动修改源子系统数据**
4. 对账基线：使用 `source_id + source_version` 做比对依据

---
## 8. WorkBuddy 自动自检清单
- [ ] 区分两套 health 端点：SMT 只有 `/health`（匿名）；外部子系统 `/api/health` 或 `/api/domain/{domain}/health`（Bearer）
- [ ] 外部子系统增量接口支持 `(after_updated_at, after_id)` keyset 游标 + `next_cursor`，单记录带 `source_version`
- [ ] 指令接口强制校验全套 5 个请求头
- [ ] 幂等逻辑：同 key 同 payload 返回历史结果；同 key 不同 payload 返回 409
- [ ] 实现指令结果查询 `GET /api/domain/{domain}/commands/{command_id}`
- [ ] 乱序处理：只消费更高版本（按 source_id 比较），不依赖到达顺序
- [ ] 错误码分流正确：400/401/403/422/409 不重试；5xx/超时自动退避重试；429 遵 Retry-After
- [ ] `X-SMT-Timestamp` 校验 ±300s 偏差
- [ ] 软删除标记 `is_deleted` 实现
- [ ] 日志打印 `X-SMT-Trace-Id`
- [ ] 访问来源校验：仅 Tailscale 内网 IP
- [ ] outbox worker 带并发限额、租约锁，熔断带迟滞防抖动

---
## 9. 流程图
```mermaid
flowchart LR
    SMT[SMT系统]
    SUB[外部独立子系统 WMS/OA/MES]
    REG[Datasource Registry 存量直连（豁免）]
    SMT -->|GET /incremental 拉取数据| SUB
    SUB -->|变更数据| SMT
    SMT -->|POST 指令（带幂等头）| SUB
    SUB -->|202 受理| SMT
    SMT -->|GET /commands/{id} 轮询结果| SUB
    note[存量同库链路：走 REG，不纳入本协议校验]
```

---
## 10. 变更通知规则
Schema、字段、接口语义变更，需要提前通知 SMT 集成负责人，同步更新契约文档（`docs/integration/contracts/<subsystem>.md`），避免同步中断。契约文件必备小节：字段与写权威、external_id 映射、幂等键、频率与 SLA、变更评审人——缺任一小节，`npm run check:integration` 报红。
