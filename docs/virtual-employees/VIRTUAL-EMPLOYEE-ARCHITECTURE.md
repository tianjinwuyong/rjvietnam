# 工厂虚拟员工技术架构

## 1. 总体结构

```text
人类主管与现场员工
        │
全厂运营虚拟主管
        │
LangGraph 工作流引擎
        │
Hermes 智能、记忆与技能层
        │
受控工具和 Express API
        │
WMS / IQC / MSD / MES / PDA
        │
PostgreSQL 正式业务记录
```

虚拟员工是工厂中的岗位身份。Hermes、LangGraph 和 Express 不是虚拟员工，它们分别提供智能、工作流和受控执行能力。

## 2. 虚拟员工组织

### 2.1 全厂管理

- `OPS-SUPERVISOR-VIRTUAL-01`：全厂运营虚拟主管。

### 2.2 业务虚拟员工

- `WMS-RECEIVING-VIRTUAL-01`：WMS 收料虚拟员工。
- `IQC-VIRTUAL-01`：IQC 虚拟检验员。
- `WMS-INVENTORY-VIRTUAL-01`：WMS 库存虚拟员工。
- `MSD-CONTROL-VIRTUAL-01`：湿敏物料控制虚拟员工。
- `PMC-VIRTUAL-01`：PMC 计划虚拟员工。
- `PURCHASING-VIRTUAL-01`：采购虚拟员工。
- `SUPPLIER-COLLAB-VIRTUAL-01`：供应商协同虚拟员工。
- `MES-VIRTUAL-01`：MES 生产执行虚拟员工。
- `QUALITY-VIRTUAL-01`：品质闭环虚拟主管。
- `MAINTENANCE-VIRTUAL-01`：设备维护虚拟员工。
- `FINANCE-VIRTUAL-01`：财务核对虚拟员工。

### 2.3 IT 与系统运维虚拟员工

- `APP-OPS-VIRTUAL-01`：应用运维。
- `INFRA-VIRTUAL-01`：基础设施。
- `DATABASE-VIRTUAL-01`：数据库管理。
- `INTEGRATION-VIRTUAL-01`：系统集成。
- `DATA-QUALITY-VIRTUAL-01`：数据质量。
- `SECURITY-VIRTUAL-01`：系统安全。
- `PDA-FLEET-VIRTUAL-01`：PDA 设备群管理。
- `BACKUP-VIRTUAL-01`：备份与恢复。
- `RELEASE-VIRTUAL-01`：系统发布。
- `UI-DESIGN-QA-VIRTUAL-01`：UI 设计与测试。

完整注册信息位于 `services/api/src/virtual-employees/registry.js`。

## 3. Hermes 的作用

Hermes 是虚拟员工共享的智能运行层，不是另一个业务岗位。

主要职责：

1. 理解现场情况并形成处理建议。
2. 保存供应商异常、MSD 事件和人工纠正等经验。
3. 为不同员工加载对应技能。
4. 协调员工之间的工作交接。
5. 生成通知、审批请求、班报和异常摘要。

示例：

```text
收料员工发现标签信息不完整
→ Hermes 分析缺失字段
→ 请求现场人员补充资料
→ 资料完整后交接给 IQC 员工
```

Hermes 不得绕过 Express API 直接修改正式业务数据。

## 4. LangGraph 的作用

LangGraph 是有状态虚拟员工的工作流骨架，适合管理可暂停、可恢复、有条件分支的长期任务。

主要职责：

- 保存每个任务当前节点。
- 在人工审批节点暂停。
- 收到审批结果后继续执行。
- 在服务中断后恢复任务。
- 保存节点输入、输出和执行轨迹。
- 控制员工之间的确定性交接。

典型流程：

```text
Receiving
→ Label
→ IQC
→ MSD Check
→ Storage
→ Pick
→ Issue to Line
```

LangGraph 不能代替 WMS、MES 和质量业务规则；它只负责编排。

## 5. Express 的作用

Express 是本系统的 Node.js 后端 API 框架，也是虚拟员工执行真实业务动作的安全边界。

```text
React 页面或虚拟员工
        ↓ HTTP/API
Express 后端（端口 8080）
        ↓
权限检查、业务校验、审计
        ↓
PostgreSQL / PDA / MES / WMS
```

Express 负责：

- 接收网页、PDA 和虚拟员工请求。
- 验证登录身份与角色权限。
- 执行 WMS、IQC、MSD、MES 业务规则。
- 查询和写入 PostgreSQL。
- 创建虚拟员工任务及人工审批请求。
- 记录审计事件并返回执行结果。

示例：

```text
MSD 员工发现物料过期
→ Hermes 形成锁定建议
→ LangGraph 进入 LOCK 节点
→ 调用 Express 锁定 API
→ Express 检查权限和物料状态
→ 写入库存交易与审计记录
→ 页面显示物料已锁定
```

主要后端入口是 `services/api/server.js`。

## 6. PostgreSQL 的作用

PostgreSQL 是正式业务事实来源，保存：

- 物料批次和仓位。
- 库存交易流水。
- IQC 检验结果。
- MSD 开封、暴露和烘烤记录。
- 工作任务、审批与审计事件。

Hermes 或其他记忆系统只能保存经验和上下文，不能作为库存余额、检验结论或生产状态的正式来源。

## 7. 人工审批与安全边界

以下动作必须由现有业务规则和人工审批控制：

- 释放库存。
- 最终 IQC 判定。
- 释放已过期湿敏物料。
- 停线和复线。
- 报废批准。
- 修改采购价格或数量。
- 数据库迁移和数据恢复。
- 生产环境发布。

虚拟员工可以读取、分析、提出建议并创建审批请求，但不能自行绕过人工关卡。

## 8. 各层职责总结

| 层 | 职责 |
|---|---|
| React + 真人头像 | 虚拟员工的脸、工作台和现场交互界面 |
| Archify | 向现场人员解释当前流程、节点和下一步动作 |
| Hermes | 推理、记忆、学习和跨员工协作 |
| LangGraph | 持久化工作流、暂停、恢复和任务编排 |
| Express | 权限、业务校验、受控执行和审计 |
| PostgreSQL | 正式业务事实和历史记录 |
| PDA/设备集成 | 采集真实现场数据并执行设备侧动作 |

## 9. 推荐实施顺序

1. 保留现有 Express API 与数据库业务规则。
2. 以 `MSD-CONTROL-VIRTUAL-01` 作为 LangGraph 试点。
3. 将预警、锁定、烘烤和人工放行建成可恢复状态图。
4. 接入 Hermes，先提供分析、记忆和建议，不开放高风险写操作。
5. 验证审计、人工审批和故障恢复。
6. 再扩展至收料、IQC、库存、PMC 和 MES 员工。

