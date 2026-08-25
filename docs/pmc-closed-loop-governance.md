# PMC 全过程闭环治理

## 部门定位

PMC（生产计划与物料控制部）是独立业务部门，隶属制造运营体系。PMC 负责把需求转换为可执行计划，但不能替代质量、仓储、生产、财务的专业批准。

## 唯一闭环

需求来源 → PMC 主计划 → 产能/物料/BOM/质量/成本/交期评审 → 审批 → 工单绑定 → 齐套 → MES 发布 → 生产执行 → WMS 成品入库 → 成本结算 → 六项关单核对 → 需求、计划、工单共同关闭。

预测只用于计划，不得直接生成可执行工单。已发布 MES 的工单不得直接修改，必须走正式变更申请。

## 强制门禁

- 关键 BOM 未 100% 齐套：允许建立计划工单，不允许发布执行。
- 质量冻结优先于 PMC 排产，任何人不得绕过。
- 插单必须先计算交期、在制品、换线、材料和成本影响，再按影响动态审批。
- 转线必须有转线单、交出确认和接收扫码；工单原始编号及原生产线历史不得篡改。
- 关单必须同时通过数量平衡、物料核销、质量关闭、交接关闭、成品入库、成本结算。

## 插单审批

基础审批人为 PMC 经理和生产经理。按影响自动增加：

- 影响客户交期：销售经理
- BOM 或替代料变化：工程与质量
- 需要加班：人事
- 成本增加超过 5%：财务
- P0 紧急等级：质量负责人和厂长

物料不齐禁止插单，不允许自动批准。

## 数据权责

- PMC 是需求、计划、优先级、计划版本和排程影响的权威来源。
- MES 是生产执行、工序履历、数量和工单状态的权威来源。
- WMS 是库存、齐套、发料、退料和成品收货的权威来源。
- QUALITY 是冻结、放行和质量关闭的权威来源。
- FINANCE 是成本结算与差异确认的权威来源。

所有状态变化写入 `pmc_governance_audit`，保留操作者、时间、对象和变更内容。

## PMC API

- `/pmc/demands`：需求登记
- `/pmc/plans`：主计划
- `/pmc/plans/:id/reviews`：六项评审
- `/pmc/plans/:id/decision`：计划审批
- `/pmc/plans/:id/bind-work-order`：绑定工单与齐套状态
- `/pmc/plans/:id/release-to-mes`：正式发布 MES
- `/pmc/expedites`：插单影响分析
- `/pmc/expedites/:id/decision`：动态审批
- `/pmc/work-orders/:code/change-requests`：已发布工单正式变更
- `/pmc/work-order-changes/:id/decision`：变更审批
- `/pmc/work-order-changes/:id/apply`：执行已批准变更
- `/pmc/work-orders/:code/transfers`：转线申请
- `/pmc/transfers/:id/decision`：转线审批
- `/pmc/transfers/:id/handover`：交出确认
- `/pmc/transfers/:id/receive`：接收扫码
- `/pmc/work-orders/:code/closure-check`：六项关单核对
- `/pmc/work-orders/:code/close-controlled`：受控关单

