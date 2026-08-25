# 手动线 3D 实时同步契约

## 工站身份

每个手动线 Agent 的心跳和事件都必须携带：

| 字段 | 来源 | 3D 用途 |
| --- | --- | --- |
| `stationCode` | Agent 固定工站代码 | 匹配 3D 工站节点 |
| `machineQr` | 机器标签 QR；由 `STATION_MACHINE_QR` 配置 | 显示并追溯物理机器 |
| `machineQrSource` | `configured` 或 `derived_station_code` | 标出是否已经注册实物 QR |
| `lineCode` / `lineDomain` | MES/公共 Agent | 防止自动线与手动线串线 |
| `hostIp` / `sourceIp` | Agent 身份 | 诊断和定位 |
| `agentVersion` / `configVersion` | Agent 身份 | 版本一致性 |
| `receivedAt` / `occurredAt` | MES 事件时间 | 3D 时间线和在线判定 |

## 3D 数据来源

1. `/api/mes/manual-line/station-data/:stationCode`：每 2 秒读取工站事实、当前 SN、PASS/NG 统计。
2. `/api/pda/heartbeats`：每 5 秒读取在线状态、当前 SN、`machineQr`。
3. `/api/pda/events` SSE：接收新扫描、测试结果、NG、重复 SN、告警和心跳，不回放历史告警。
4. `/api/station/bucket-snapshots`、`/api/station/pallets`、`/api/station/ng-guard`：读取箱、托盘和 NG 隔离状态。

## 机器 QR 注册规则

- 生产站点设置 `STATION_MACHINE_QR` 为机器标签的真实内容，MES 注册后心跳显示 `machineQrSource= configured`。
- 未配置时只使用可追溯的 `RJ-MACHINE:<stationCode>` 显示占位，并标记为 `derived_station_code`；它不能替代生产机器标签注册。
- 3D 页面永远显示 MQR，不以 IP 代替 QR；IP 只用于诊断。
- 机器 QR 变更必须由 MES 授权并记录配置版本，不能由 Agent 本地改写路线或质量状态。
