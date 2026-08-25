# API Domain 分类规范

每个 API 响应必须返回：

- `X-API-Domain`：所属业务域
- `X-API-Classification: canonical-v1`：当前分类标准版本

## 分类表

| Domain | 路径前缀 | 权威职责 | 默认方向 |
|---|---|---|---|
| PMC | `/pmc` | 需求、计划、排程、插单、计划变更 | PMC → MES |
| MES | `/mes` | 工单执行、SN 履历、工序状态 | 工站 → MES |
| WMS | `/wms` | 库存、齐套、收发退、盘点 | WMS ↔ MES |
| STATION | `/api/station` | 工站事件、心跳、扫码校验 | 工站 → MES |
| QUALITY | `/quality` | NG、冻结、放行、复活审批 | QUALITY → 全线 |
| MAINTENANCE | `/maintenance` | 维修工单、接收、维修、返回 | MES ↔ 维修站 |
| HR | `/hr` | 员工、岗位、考勤、绩效、工资资料 | HR → 业务系统 |
| FINANCE | `/finance` | 成本、结算、凭证、支付 | 业务系统 → 财务 |
| SALES | `/sales` | 客户需求、订单、交期 | SALES → PMC |
| ADMIN | `/admin` | 配置、权限、治理 | ADMIN → 系统 |
| INTEGRATION | `/api/integration` | 外部系统交换与重放 | 双向受控 |
| REPORTING | `/reports` | 查询、报表、导出 | 只读 |
| AUTH | `/api/auth` | 登录、会话、身份 | 身份服务 → 全系统 |
| CORE | `/api` 及未匹配路径 | 共享主数据和兼容接口 | 按资源权威方 |

分类规则保存在 PostgreSQL `api_domain_rules`。更具体的前缀优先；未匹配接口归入 CORE，不能成为无归属接口。3D 只读显示和报警，不得锁定或修改工站生产行为。

