# 维修站功能与工作流（管理系统）

这是管理系统中手动线 NG 维修闭环的中文入口。完整的功能、状态、接口、数据表、权限、断线策略和验收清单见[维修站中文规范](../../docs/manual-line-repair-station-functions-workflow.zh-CN.md)。

```mermaid
flowchart LR
  NG[来源工站 NG] --> MES[MES：路径、工单、SLA、复测上限]
  MES --> RS[维修站：接收、维修、证据]
  RS --> WMS[WMS：物料]
  RS --> PDA[PDA：领取/接收确认]
  RS --> QMS[QMS：审批/处置]
  RS --> MES
  MES --> RETEST[来源工站复测]
  RETEST --> MES
  MES --> CLOSE[关闭/重复/升级/报废/替换]
  RS -. 断线 .-> OUTBOX[追加式 Outbox]
  OUTBOX -. 回放 .-> MES
```

管理页面必须支持：按域/工站/优先级/SLA 查看工单；配置 NG 路径和复测策略；查看 SN、NG、桶、数量、物料、操作者、审批、报警的完整时间线；PDA 领取与返回看板；Andon 升级；Outbox 回放和冲突；Excel/PDF 证据导出。

Mermaid 源文件：[manual-line-repair-station-workflow.zh-CN.mmd](../../docs/manual-line-repair-station-workflow.zh-CN.mmd)。
