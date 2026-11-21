# 给 WorkBuddy 的精简校验规则
> 完整版见 `docs/integration/smt-subsystem-protocol.md`；本文件只保留可自动判定的规则。

1. 适用对象：仅新接入独立外部子系统；存量内置 WMS/MES、datasource registry 直连链路**豁免，不校验**
2. 端点区分：
   - SMT `/health`：匿名，`{"ok":true,...,"status":"ready"}`，不校验；SMT 上不存在 `/api/health`（实测 404）
   - SMT `/api/auth/me`：必须保持鉴权（容器 healthcheck 以 401 为健康），禁止改公开
   - 外部子系统 `/api/health`（单域）或 `/api/domain/{domain}/health`（多域）：Bearer 鉴权，返回 `healthy,domain,ts`
3. 增量同步：游标 = `(after_updated_at, after_id)` keyset + `next_cursor`；单记录带 `source_version`（按 source_id 比较）；5 分钟回看窗口；允许乱序重复，只消费更高版本
4. 指令 POST 强制头：`Authorization, X-Idempotency-Key, X-SMT-Trace-Id, X-SMT-Source, X-SMT-Timestamp`
5. 幂等：同 key 同 payload 返回历史结果；同 key 不同 payload 返回 409
6. 指令结果：202 后轮询 `GET /api/domain/{domain}/commands/{command_id}`，state ∈ accepted|applied|failed；查无此 id 视为 failed 并告警
7. 重试策略：最大 3 次，3s/10s/30s；400/401/403/409/422 不重试（401 另行告警）；5xx/超时重试；429 遵从 Retry-After
8. 时间戳：`X-SMT-Timestamp` 偏差 ±300s 内有效，超窗 401
9. 安全：仅 Tailscale 内网，Token 放 Header，按域隔离
10. 数据：`is_deleted` 软删；对账只告警，不修改源系统
11. 运行保护：outbox 带并发限额、租约锁；熔断带迟滞（连续 3 次失败熔断 / 连续 2 次成功恢复），防止抖动风暴
