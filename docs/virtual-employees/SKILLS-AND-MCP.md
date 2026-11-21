# 虚拟员工技能与 MCP 契约（SKILLS & MCP）

机器可读的岗位能力契约：**每个虚拟员工需要哪些技能、每个技能靠哪条真实权限、写操作卡在哪个人工门、允许调用哪些 MCP 服务器**。

代码是唯一真相，本文件由 `node scripts/ve-capabilities-doc.mjs` 从代码渲染：

| 文件 | 内容 |
| --- | --- |
| `services/api/src/virtual-employees/skills-catalog.js` | 技能目录（权限键 / 读写类型 / 人工门 / 所需 MCP） |
| `services/api/src/virtual-employees/mcp-catalog.js` | 权限键镜像 + MCP 服务器目录 |
| `services/api/src/virtual-employees/role-capabilities.js` | 44 岗 × 技能矩阵 |
| `services/api/src/virtual-employees/capabilities.js` | 查询与自检 API（`capabilitiesFor` / `canUseSkill` / `auditCapabilities`） |

规模：**44 个岗位、262 个技能、14 个 MCP 服务器、95 条真实权限键**。自检结果：problems=0，warnings=8。

## 1. 三条硬规则

1. **写技能必须绑人工门。** `kind:"write"` 的技能一律带 `gate`；自检里 `WRITE_WITHOUT_GATE` 是失败项。写技能运行时只产出 `WAITING_APPROVAL` 草稿任务，批准人必须是具名人类（`ve:` 身份被 `VE_CANNOT_APPROVE` 拒绝）。
2. **门必须注册在干活的那个岗位上。** `canUseSkill()` 只承认该岗位已声明的技能；`runner.js` 每轮先问契约，未声明就返回 `skipped: SKILL_NOT_DECLARED_FOR_ROLE`，不落任务。反向检查 `WRITE_GATE_NOT_IN_REGISTRY` 抓的是「契约答应了运行时给不出来的东西」。
3. **权限键必须真实存在。** 每条技能绑定 `permissions` 表里的一条 code（`PERMISSION_CODES` 是它的镜像，`check:ve-capabilities --db` 会重读表并比对）；只读技能不得持有 `.manage` 级权限。

## 2. MCP 服务器目录

| MCP | 端点 | 可写 | 用途 |
| --- | --- | --- | --- |
| `smt-api` | http://127.0.0.1:8080/api/agent/tools | 是 | 唯一业务写路径：所有草稿、提交、放行动作都经过这里并带 x-ve-token |
| `smt-db-readonly` | postgres://127.0.0.1:5432/smt_factory | 否 | 事实只读：行级核对、统计、数据体检；禁止任何 DML/DDL |
| `smt-realtime` | ws://127.0.0.1:8081 | 否 | 过站、安灯、设备事件流（services/realtime） |
| `smt-aoi` | http://127.0.0.1:6309 | 否 | AOI/SPI 检测结果与图像（services/aoi-api） |
| `smt-memory` | http://127.0.0.1:9876 | 是 | 经验记忆读写，命名空间 ve/<EMPLOYEE_ID>；闸门 services/_shared/memory-experience.js |
| `smt-supplier-portal` | http://127.0.0.1:8098 | 是 | 供应商门户：ASN、确认、退货与索赔数据 |
| `smt-plc-bridge` | http://127.0.0.1:1880 | 否 | Node-RED：PLC / Modbus / OPC-UA 与安灯硬件桥，遥测只读 |
| `smt-notify` | LINE notify-api / 企业微信 webhook | 否 | 催办、告警与升级通知，受频率表（frequencies.js）与 SLA 约束 |
| `smt-bi` | http://127.0.0.1:3000 | 否 | 指标与看板只读查询 |
| `smt-observability` | http://127.0.0.1:9090 + http://127.0.0.1:3001 | 否 | 服务与主机指标、告警规则只读 |
| `smt-llm` | http://127.0.0.1:11434 | 否 | 本地模型（判定辅助与嵌入），仅阈值触发时调用，预算 ≤20 次/日 |
| `factory-mailbox` | redis mailbox (mcp factory-mailbox) | 否 | 虚拟员工之间与人类值班员的信箱；主管派工与升级的唯一通道 |
| `graft` | mcp graft (context graph) | 否 | 代码图谱：仅 IT 岗位排障用，产线岗位不得访问源码 |
| `smt-pda` | http://127.0.0.1:5174 + station-agent :5179 | 是 | PDA/站端配置与打印任务下发（远程设备动作属高风险，必须人工门） |

岗位能用的 MCP = 它所有技能所需 MCP 的并集 **+ `smt-memory`**（每个员工都要能回忆与沉淀自己的经验，见 `JOB-DESCRIPTIONS.md` §18）。

## 3. 岗位矩阵

### CMD 指挥

| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-SUPERVISOR-VIRTUAL-01 | 9 | 2 | 7 | 0 | — | 8 |

### D1 来料与仓储

| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| MSD-CONTROL-VIRTUAL-01 | 6 | 3 | 1 | 2 | override_msl、release_expired_material | 6 |
| WMS-COUNT-VIRTUAL-01 | 5 | 1 | 2 | 2 | inventory_adjustment | 4 |
| WMS-INVENTORY-VIRTUAL-01 | 14 | 6 | 4 | 4 | override_putaway_rule、inventory_adjustment、material_scrap、approve_distribution | 7 |
| WMS-IQC-HANDOFF-VIRTUAL-01 | 5 | 2 | 1 | 2 | receive_variance、release_inventory | 3 |
| WMS-ISSUE-VIRTUAL-01 | 7 | 1 | 4 | 2 | hand_over_package、receive_package | 7 |
| WMS-RECEIVING-VIRTUAL-01 | 8 | 3 | 3 | 2 | receive_variance、inventory_release | 5 |
| WMS-SUPERVISOR-VIRTUAL-01 | 8 | 2 | 6 | 0 | — | 6 |

### D2 计划与采购

| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| PMC-VIRTUAL-01 | 12 | 4 | 6 | 2 | commit_delivery、change_frozen_plan | 7 |
| PURCHASING-VIRTUAL-01 | 13 | 6 | 4 | 3 | approve_po、change_price、change_quantity | 5 |
| SUPPLIER-CLAIM-VIRTUAL-01 | 4 | 2 | 2 | 0 | — | 6 |
| SUPPLIER-COLLAB-VIRTUAL-01 | 10 | 4 | 4 | 2 | publish_rejection、supplier_account_approval | 5 |

### D3 制造执行

| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| ANDON-VIRTUAL-01 | 5 | 1 | 4 | 0 | — | 6 |
| LINE-CADENCE-VIRTUAL-01 | 4 | 3 | 1 | 0 | — | 6 |
| MES-VIRTUAL-01 | 11 | 3 | 6 | 2 | close_work_order、stop_line | 7 |
| PACK-VIRTUAL-01 | 5 | 1 | 2 | 2 | release_inventory | 4 |
| SMT-LOOP-VIRTUAL-01 | 6 | 3 | 2 | 1 | inventory_adjustment | 5 |

### D4 品质

| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| IQC-VIRTUAL-01 | 10 | 3 | 4 | 3 | final_iqc_decision、exemption、supplier_suspension | 6 |
| MRB-VIRTUAL-01 | 4 | 2 | 2 | 0 | — | 5 |
| OQC-VIRTUAL-01 | 5 | 2 | 2 | 1 | release_inventory | 5 |
| QUALITY-VIRTUAL-01 | 11 | 4 | 5 | 2 | close_ncr、approve_capa | 6 |
| TRACE-VIRTUAL-01 | 6 | 3 | 3 | 0 | — | 4 |

### D5 设备与工程

| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| MAINTENANCE-VIRTUAL-01 | 10 | 3 | 6 | 1 | return_machine_to_service | 8 |
| REPAIR-VIRTUAL-01 | 5 | 1 | 3 | 1 | approve_scrap | 4 |
| SPARE-PARTS-VIRTUAL-01 | 4 | 3 | 1 | 0 | — | 3 |
| STATION-EQUIP-VIRTUAL-01 | 5 | 5 | 0 | 0 | — | 6 |

### D6 商务与财务

| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| E-INVOICE-VIRTUAL-01 | 5 | 1 | 2 | 2 | approve_payment | 3 |
| FINANCE-VIRTUAL-01 | 9 | 4 | 3 | 2 | approve_scrap_value、approve_payment | 5 |
| SALES-VIRTUAL-01 | 4 | 2 | 2 | 0 | — | 5 |
| SUPPLIER-DEBT-VIRTUAL-01 | 4 | 2 | 2 | 0 | — | 5 |

### D7 行政人事与文控

| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| HR-VIRTUAL-01 | 8 | 2 | 5 | 1 | master_data_merge | 5 |
| OA-DOCUMENT-CONTROL-VIRTUAL-01 | 20 | 7 | 6 | 7 | publish_without_approval、approve_document、reject_document、sign_for_human、external_distribution、execute_material_issue、skip_required_step | 6 |
| SAFETY-VIRTUAL-01 | 5 | 2 | 3 | 0 | — | 6 |

### D8 平台与 IT

| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| APP-OPS-VIRTUAL-01 | 8 | 3 | 4 | 1 | restart_production_service | 7 |
| BACKUP-VIRTUAL-01 | 3 | 2 | 0 | 1 | production_restore | 2 |
| DATA-QUALITY-VIRTUAL-01 | 5 | 5 | 0 | 0 | — | 3 |
| DATABASE-VIRTUAL-01 | 4 | 3 | 0 | 1 | schema_change | 4 |
| INFRA-VIRTUAL-01 | 5 | 3 | 0 | 2 | firewall_change、server_reboot | 2 |
| INTEGRATION-VIRTUAL-01 | 5 | 2 | 1 | 2 | external_write、mapping_change | 6 |
| PDA-FLEET-VIRTUAL-01 | 4 | 2 | 0 | 2 | remote_device_control、apk_rollout | 3 |
| RELEASE-VIRTUAL-01 | 5 | 3 | 1 | 1 | production_deploy | 5 |
| REPORTS-VIRTUAL-01 | 7 | 4 | 3 | 0 | — | 6 |
| SECURITY-VIRTUAL-01 | 5 | 3 | 0 | 2 | disable_account、rotate_secret | 5 |
| UI-DESIGN-QA-VIRTUAL-01 | 13 | 13 | 0 | 0 | — | 3 |

## 4. 逐岗技能清单

### ANDON-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `ANDON_INTAKE` | 安灯受理 | `mes.read` | read | — | smt-realtime smt-plc-bridge |
| `ESCALATION_TIMER` | 升级计时 | `management.communication.view` | draft | — | smt-notify factory-mailbox |
| `RESPONSE_ASSIGN` | 响应人指派 | `mes.line_assignment.manage` | draft | — | smt-api factory-mailbox |
| `ROOT_CAUSE_LOG` | 停线根因登记 | `quality.read` | draft | — | smt-api |
| `LINE_EXCEPTION` | 线体异常上报 | `mes.read` | draft | — | smt-realtime factory-mailbox smt-notify |

### APP-OPS-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `SERVICE_HEALTH` | 服务健康检查 | `admin.view` | read | — | smt-observability smt-db-readonly |
| `ERROR_TRIAGE` | 错误分诊 | `admin.view` | read | — | smt-observability graft |
| `JOB_MONITOR` | 定时任务监控 | `admin.view` | read | — | smt-observability |
| `ALERT_ROUTING` | 告警路由 | `management.communication.send` | draft | — | factory-mailbox smt-notify |
| `RESTART_PRODUCTION_SERVICE` | 重启生产服务 | `admin.system` | write | restart_production_service | smt-observability |
| `WORKLOAD_BALANCE` | 本域工作量分配 | `org.view` | draft | — | smt-db-readonly factory-mailbox |
| `GATE_PACKET_ASSEMBLE` | 本域人工门审批包整理 | `lifecycle.view` | draft | — | smt-api smt-notify |
| `EXCEPTION_ROUTE` | 异常路由与唯一主责 | `management.communication.send` | draft | — | factory-mailbox smt-db-readonly |

### BACKUP-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `BACKUP_VERIFY` | 备份校验 | `admin.view` | read | — | smt-db-readonly |
| `RETENTION_MONITOR` | 保留期监控 | `admin.view` | read | — | smt-db-readonly |
| `RESTORE_DRILL` | 恢复演练 | `admin.system` | write | production_restore | smt-db-readonly |

### DATA-QUALITY-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `DUPLICATE_DETECT` | 重复数据检测 | `master_data.read` | read | — | smt-db-readonly |
| `MISSING_FIELD` | 缺失字段检测 | `master_data.read` | read | — | smt-db-readonly |
| `CROSS_SYSTEM_RECONCILE` | 跨系统比对 | `wms.view` | read | — | smt-db-readonly |
| `DATA_LINEAGE` | 数据血缘核对 | `master_data.read` | read | — | smt-db-readonly graft |
| `ADHOC_QUERY` | 临时只读查询 | `ai.query` | read | — | smt-db-readonly |

### DATABASE-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `DB_HEALTH` | 数据库健康 | `admin.view` | read | — | smt-db-readonly smt-observability |
| `SLOW_QUERY` | 慢查询分析 | `admin.view` | read | — | smt-db-readonly |
| `REPLICATION_MONITOR` | 复制监控 | `admin.view` | read | — | smt-db-readonly smt-observability |
| `SCHEMA_CHANGE` | 模式变更 | `admin.system` | write | schema_change | smt-api |

### E-INVOICE-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `INVOICE_DRAFT` | 发票草稿 | `einvoice.view` | draft | — | smt-api |
| `TAX_CODE_CHECK` | 税目校验 | `einvoice.view` | read | — | smt-db-readonly |
| `INVOICE_ISSUE` | 开票动作 | `einvoice.manage` | write | approve_payment | smt-api |
| `CREDIT_NOTE` | 红冲与贷记 | `einvoice.manage` | write | approve_payment | smt-api |
| `INVOICE_ARCHIVE` | 发票归档 | `einvoice.view` | draft | — | smt-api |

### FINANCE-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `THREE_WAY_MATCH` | 三单匹配 | `finance.ap.read` | read | — | smt-db-readonly |
| `COST_VARIANCE` | 成本差异分析 | `finance.cost.read` | read | — | smt-db-readonly |
| `SCRAP_COST_REVIEW` | 报废金额复核 | `finance.cost.read` | write | approve_scrap_value | smt-db-readonly smt-api |
| `PAYMENT_PACKET_ASSEMBLE` | 付款包整理 | `finance.ap.read` | write | approve_payment | smt-api smt-notify |
| `AR_AGING` | 应收账龄 | `finance.ar.read` | read | — | smt-db-readonly |
| `DEBT_AGING` | 供应商欠款账龄 | `finance.ap.read` | read | — | smt-db-readonly |
| `WORKLOAD_BALANCE` | 本域工作量分配 | `org.view` | draft | — | smt-db-readonly factory-mailbox |
| `GATE_PACKET_ASSEMBLE` | 本域人工门审批包整理 | `lifecycle.view` | draft | — | smt-api smt-notify |
| `EXCEPTION_ROUTE` | 异常路由与唯一主责 | `management.communication.send` | draft | — | factory-mailbox smt-db-readonly |

### HR-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `EMPLOYEE_MASTER_DATA` | 员工主数据维护 | `hr.edit` | write | master_data_merge | smt-api smt-db-readonly |
| `ATTENDANCE_AUDIT` | 考勤稽核 | `hr.attendance` | read | — | smt-db-readonly |
| `SHIFT_ROSTER` | 排班 | `hr.department` | draft | — | smt-api |
| `CERT_EXPIRY` | 岗位证书到期预警 | `hr.view` | read | — | smt-db-readonly smt-notify |
| `GRIEVANCE_INTAKE` | 申诉受理 | `hr.view` | draft | — | smt-api |
| `TRAINING_ASSIGN` | 培训指派 | `hr.position` | draft | — | smt-api factory-mailbox |
| `WORKLOAD_BALANCE` | 本域工作量分配 | `org.view` | draft | — | smt-db-readonly factory-mailbox |
| `GATE_PACKET_ASSEMBLE` | 本域人工门审批包整理 | `lifecycle.view` | draft | — | smt-api smt-notify |

### INFRA-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `HOST_HEALTH` | 主机健康 | `admin.view` | read | — | smt-observability |
| `NETWORK_MONITOR` | 网络监控 | `admin.view` | read | — | smt-observability |
| `CAPACITY_ALERT` | 容量告警 | `admin.view` | read | — | smt-observability |
| `FIREWALL_CHANGE` | 防火墙变更 | `admin.system` | write | firewall_change | smt-observability |
| `SERVER_REBOOT` | 主机重启 | `admin.system` | write | server_reboot | smt-observability |

### INTEGRATION-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `API_MONITOR` | 接口监控 | `admin.view` | read | — | smt-observability |
| `SYNC_RETRY` | 同步重试 | `wms.sync.manage` | draft | — | smt-api |
| `CONTRACT_VALIDATE` | 契约校验 | `admin.view` | read | — | graft smt-db-readonly |
| `EXTERNAL_WRITE` | 外部系统写入 | `procurement.manage` | write | external_write | smt-supplier-portal |
| `MAPPING_CHANGE` | 映射关系变更 | `master_data.read` | write | mapping_change | smt-api |

### IQC-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `IQC_QUEUE_SCAN` | 待检队列扫描 | `qms.read` | read | — | smt-db-readonly |
| `SUPPLIER_HISTORY` | 供应商缺陷史 | `qms.read` | read | — | smt-db-readonly smt-memory |
| `SAMPLE_CALCULATION` | 抽样方案计算 | `quality.inspect` | draft | — | smt-db-readonly |
| `DYNAMIC_PDA_PLAN` | PDA 检验任务下发 | `pda.view` | draft | — | smt-api smt-pda |
| `EVIDENCE_REVIEW` | 检验证据复核 | `quality.read` | read | — | smt-aoi smt-db-readonly |
| `FINAL_IQC_DECISION` | 来料判定 | `qms.execute` | write | final_iqc_decision | smt-api |
| `DEFECT_CLASSIFY` | 缺陷分类 | `quality.read` | draft | — | smt-aoi smt-db-readonly |
| `IQC_EXEMPTION_PROPOSAL` | 免检提案 | `qms.execute` | write | exemption | smt-db-readonly smt-api |
| `SUPPLIER_SUSPENSION_PROPOSAL` | 供应商暂停提案 | `qms.execute` | write | supplier_suspension | smt-db-readonly smt-supplier-portal |
| `IQC_INSPECT` | 来料检验执行 | `qms.execute` | draft | final_iqc_decision | smt-api smt-db-readonly smt-aoi |

### LINE-CADENCE-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `CT_MEASURE` | 节拍测量 | `mes.read` | read | — | smt-realtime smt-plc-bridge |
| `BALANCE_ANALYSIS` | 工站平衡分析 | `mes.read` | read | — | smt-db-readonly |
| `CHANGEOVER_MONITOR` | 换线监控 | `mes.read` | read | — | smt-realtime |
| `CADENCE_ALERT` | 节拍偏离告警 | `mes.read` | draft | — | smt-notify factory-mailbox |

### MAINTENANCE-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `EQUIPMENT_HEALTH` | 设备健康度 | `maintenance.read` | read | — | smt-plc-bridge smt-observability |
| `PM_SCHEDULE` | 保养计划 | `maintenance.manage` | draft | — | smt-api smt-notify |
| `BREAKDOWN_ROUTE` | 停机路由 | `maintenance.execute` | draft | — | factory-mailbox smt-notify |
| `SPARE_ALERT` | 备件告警 | `maintenance.read` | read | — | smt-db-readonly |
| `RETURN_MACHINE_TO_SERVICE` | 设备复机放行 | `maintenance.execute` | write | return_machine_to_service | smt-api |
| `DOWNTIME_RECORD` | 停机记录 | `maintenance.read` | draft | — | smt-api smt-realtime |
| `WORKLOAD_BALANCE` | 本域工作量分配 | `org.view` | draft | — | smt-db-readonly factory-mailbox |
| `GATE_PACKET_ASSEMBLE` | 本域人工门审批包整理 | `lifecycle.view` | draft | — | smt-api smt-notify |
| `EXCEPTION_ROUTE` | 异常路由与唯一主责 | `management.communication.send` | draft | — | factory-mailbox smt-db-readonly |
| `WEAR_ALERT_TRIAGE` | 磨损告警分诊 | `maintenance.read` | read | — | smt-db-readonly smt-plc-bridge |

### MES-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `WORK_ORDER_MONITOR` | 工单监控 | `mes.read` | read | — | smt-db-readonly smt-realtime |
| `ROUTE_GUARD` | 工艺路线守卫 | `mes.view` | read | — | smt-db-readonly |
| `WIP_TRACE` | 在制品追溯 | `mes.read` | read | — | smt-db-readonly smt-realtime |
| `LINE_EXCEPTION` | 线体异常上报 | `mes.read` | draft | — | smt-realtime factory-mailbox smt-notify |
| `DISPATCH_SEQ` | 派工顺序建议 | `mes.execute` | draft | — | smt-api smt-db-readonly |
| `FIRST_ARTICLE_GATE` | 首件确认门 | `quality.inspect` | write | close_work_order | smt-api smt-aoi |
| `LINE_LOAD_BALANCE` | 线体负荷平衡 | `mes.read` | draft | — | smt-db-readonly smt-realtime |
| `WORKLOAD_BALANCE` | 本域工作量分配 | `org.view` | draft | — | smt-db-readonly factory-mailbox |
| `GATE_PACKET_ASSEMBLE` | 本域人工门审批包整理 | `lifecycle.view` | draft | — | smt-api smt-notify |
| `EXCEPTION_ROUTE` | 异常路由与唯一主责 | `management.communication.send` | draft | — | factory-mailbox smt-db-readonly |
| `LINE_STOP_REQUEST` | 停线请求 | `mes.execute` | write | stop_line | smt-realtime smt-api smt-notify |

### MRB-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `MRB_CONVENE` | 报废评审召集 | `quality.read` | draft | — | factory-mailbox smt-notify |
| `MRB_DISPOSITION_DRAFT` | 评审处置草案 | `quality.write` | draft | approve_scrap | smt-api |
| `COST_TAG` | 报废成本挂接 | `finance.cost.read` | read | — | smt-db-readonly |
| `REPEAT_DEFECT_FLAG` | 重复缺陷标记 | `quality.read` | read | — | smt-db-readonly smt-memory |

### MSD-CONTROL-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `MSL_MAP` | 湿敏等级映射 | `wms.view` | read | — | smt-db-readonly |
| `FLOOR_LIFE` | 车间寿命计时 | `wms.view` | read | — | smt-db-readonly smt-realtime |
| `BAKING_ALERT` | 烘烤告警 | `maintenance.read` | draft | — | smt-notify smt-plc-bridge |
| `EXPOSURE_TRACE` | 暴露时长追溯 | `traceability.query` | read | — | smt-db-readonly |
| `MSL_OVERRIDE_REQUEST` | 湿敏规则突破请求 | `wms.write` | write | override_msl | smt-db-readonly smt-api |
| `EXPIRED_MATERIAL_RELEASE_REQUEST` | 超期物料放行请求 | `wms.execute` | write | release_expired_material | smt-api |

### OA-DOCUMENT-CONTROL-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `DOCUMENT_CLASSIFY` | 文件分类 | `lifecycle.view` | read | — | smt-db-readonly |
| `ROUTE_ASSIGN` | 流程路由指派 | `lifecycle.edit` | draft | — | smt-api |
| `APPROVAL_TRACE` | 审批轨迹追踪 | `lifecycle.view` | read | — | smt-db-readonly |
| `SLA_MONITOR` | 审批 SLA 监控 | `lifecycle.view` | read | — | smt-db-readonly |
| `PRIORITY_QUEUE` | 紧急队列排序 | `lifecycle.view` | draft | — | smt-db-readonly |
| `REMINDER_SEND` | 催办发送 | `management.communication.send` | draft | — | smt-notify |
| `OVERDUE_ESCALATE` | 超时升级 | `management.communication.send` | draft | — | smt-notify factory-mailbox |
| `WECHAT_NOTIFY` | 通知与催办 | `management.communication.send` | draft | — | smt-notify |
| `LICENSE_CHECK` | 证照有效性核查 | `lifecycle.view` | read | — | smt-db-readonly |
| `CONTROLLED_PUBLISH` | 受控文件发布 | `lifecycle.edit` | write | publish_without_approval | smt-api |
| `MATERIAL_REQUISITION_PACKAGE_CHECK` | 领料包完整性核验 | `wms.view` | read | — | smt-db-readonly |
| `ROLE_DOCUMENT_SIGNATURE_CHECK` | 角色必签文件核验 | `lifecycle.view` | read | — | smt-db-readonly |
| `WMS_APPROVAL_RELEASE_NOTIFY` | 签齐后通知 WMS 放行 | `wms.execute` | draft | release_inventory | smt-api smt-notify |
| `DOCUMENT_APPROVAL_PACKET` | 文件审批包 | `lifecycle.edit` | write | approve_document | smt-api smt-notify |
| `DOCUMENT_REJECTION_PACKET` | 文件退重包 | `lifecycle.edit` | write | reject_document | smt-api |
| `SIGNATURE_ROUTING` | 签名路由（只产出人类签名任务） | `lifecycle.view` | write | sign_for_human | smt-api smt-notify |
| `EXTERNAL_DISTRIBUTION_REQUEST` | 对外分发请求 | `lifecycle.edit` | write | external_distribution | smt-api |
| `MATERIAL_ISSUE_REQUEST` | 领料执行请求 | `wms.issue` | write | execute_material_issue | smt-api smt-pda |
| `APPROVAL_SKIP_REQUEST` | 跳过必经步骤请求 | `lifecycle.edit` | write | skip_required_step | smt-api |
| `APPROVAL_PACKAGE_CHECK` | 审批包完整性核验 | `lifecycle.view` | read | — | smt-db-readonly |

### OPS-SUPERVISOR-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `FACTORY_PATROL` | 全厂巡线 | `mes.read` | read | — | smt-db-readonly smt-realtime smt-plc-bridge |
| `KPI_MONITOR` | 指标监控 | `ai.report` | read | — | smt-db-readonly smt-bi |
| `EXCEPTION_ROUTE` | 异常路由与唯一主责 | `management.communication.send` | draft | — | factory-mailbox smt-db-readonly |
| `CROSS_DOMAIN_COORDINATION` | 跨部门交接协调 | `management.communication.view` | draft | — | factory-mailbox |
| `APPROVAL_COORDINATION` | 审批包组装与催签 | `lifecycle.view` | draft | — | smt-api factory-mailbox |
| `SHIFT_HANDOVER` | 交接班记录 | `management.communication.send` | draft | — | smt-api smt-notify |
| `WECHAT_NOTIFY` | 通知与催办 | `management.communication.send` | draft | — | smt-notify |
| `DISPATCH_DECIDE` | 派工与仲裁 | `management.communication.view` | draft | — | factory-mailbox smt-db-readonly |
| `APPROVAL_ESCALATION` | 审批超时升级 | `management.communication.send` | draft | — | smt-db-readonly smt-notify factory-mailbox |

### OQC-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `OQC_AQL_PLAN` | 出货抽检方案 | `quality.inspect` | draft | — | smt-db-readonly |
| `SHIPMENT_SAMPLE` | 出货抽样执行 | `quality.execute` | read | — | smt-api smt-pda |
| `DEFECT_CLASSIFY` | 缺陷分类 | `quality.read` | draft | — | smt-aoi smt-db-readonly |
| `OQC_DISPOSITION` | 出货判定 | `quality.write` | write | release_inventory | smt-api |
| `PACKING_AUDIT` | 包装稽核 | `quality.read` | read | — | smt-db-readonly |

### PACK-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `PACK_LIST_VALIDATE` | 装箱单校验 | `wms.view` | read | — | smt-db-readonly |
| `CARTON_LABEL_PLAN` | 外箱标计划 | `wms.write` | draft | — | smt-api smt-pda |
| `OUTBOUND_SCAN` | 出货扫描核对 | `wms.execute` | write | release_inventory | smt-api smt-pda |
| `SHIPMENT_HOLD` | 出货拦截 | `wms.execute` | write | release_inventory | smt-api |
| `SERIAL_EXPORT_PACK` | 序列号导出打包 | `traceability.query` | draft | — | smt-db-readonly |

### PDA-FLEET-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `DEVICE_HEARTBEAT` | PDA 心跳 | `pda.view` | read | — | smt-observability |
| `ROLE_CONFIG` | 设备角色配置 | `pda.manage` | write | remote_device_control | smt-pda |
| `APK_VERSION` | APK 版本管理 | `pda.manage` | write | apk_rollout | smt-pda |
| `PRINT_HEALTH` | 打印服务健康 | `pda.view` | read | — | smt-observability smt-pda |

### PMC-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `MPS_PLAN` | 主生产计划 | `pmc.view` | read | — | smt-db-readonly smt-bi |
| `MRP_CALCULATE` | 物料需求运算 | `pmc.create` | draft | — | smt-api smt-db-readonly |
| `SHORTAGE_ALERT` | 缺料告警 | `pmc.view` | read | — | smt-db-readonly smt-notify |
| `DELIVERY_RISK` | 交期风险 | `pmc.view` | read | — | smt-db-readonly |
| `PLAN_FREEZE_PROPOSE` | 计划冻结建议 | `pmc.edit` | draft | — | smt-api factory-mailbox |
| `CROSS_CHECK_ALLOCATION` | 交叉核对分配量 | `pmc.view` | read | — | smt-db-readonly |
| `LINE_LOAD_BALANCE` | 线体负荷平衡 | `mes.read` | draft | — | smt-db-readonly smt-realtime |
| `WORKLOAD_BALANCE` | 本域工作量分配 | `org.view` | draft | — | smt-db-readonly factory-mailbox |
| `GATE_PACKET_ASSEMBLE` | 本域人工门审批包整理 | `lifecycle.view` | draft | — | smt-api smt-notify |
| `EXCEPTION_ROUTE` | 异常路由与唯一主责 | `management.communication.send` | draft | — | factory-mailbox smt-db-readonly |
| `DELIVERY_COMMITMENT` | 交期承诺 | `pmc.edit` | write | commit_delivery | smt-db-readonly smt-api |
| `FREEZE_OVERRIDE_REQUEST` | 冻结计划突破请求 | `pmc.edit` | write | change_frozen_plan | smt-db-readonly smt-api |

### PURCHASING-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `PO_MONITOR` | PO 执行监控 | `procurement.view` | read | — | smt-db-readonly |
| `REPLENISHMENT_REVIEW` | 补货建议复核 | `procurement.view` | draft | — | smt-db-readonly smt-api |
| `SUPPLIER_FOLLOWUP` | 供应商跟催 | `procurement.view` | draft | — | smt-supplier-portal smt-notify |
| `ASN_MONITOR` | ASN 监控 | `procurement.view` | read | — | smt-supplier-portal smt-db-readonly |
| `ETA_ATA_TRACKING` | ETA/ATA 跟踪 | `procurement.view` | read | — | smt-db-readonly |
| `PALLET_LOGISTICS` | 托盘物流跟踪 | `procurement.view` | read | — | smt-db-readonly |
| `QR_TRACE` | QR 全链追溯 | `traceability.query` | read | — | smt-db-readonly |
| `DELIVERY_EXCEPTION` | 交付异常登记 | `procurement.view` | draft | — | smt-api |
| `PO_ADJUSTMENT_DRAFT` | PO 变更草案 | `procurement.view` | draft | change_po | smt-api |
| `TERMS_CHECK` | 账期条款核对 | `procurement.view` | read | — | smt-db-readonly |
| `PO_RELEASE_PACKET` | PO 批准包 | `procurement.view` | write | approve_po | smt-api smt-supplier-portal |
| `PRICE_CHANGE_REQUEST` | 单价变更请求 | `procurement.view` | write | change_price | smt-db-readonly smt-api |
| `QTY_CHANGE_REQUEST` | 数量变更请求 | `procurement.view` | write | change_quantity | smt-db-readonly smt-api |

### QUALITY-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `QUALITY_TREND` | 品质趋势 | `quality.read` | read | — | smt-db-readonly smt-bi |
| `NCR_ROUTE` | 不合格品路由 | `quality.write` | draft | — | smt-api factory-mailbox |
| `CAPA_MONITOR` | CAPA 跟踪 | `quality.read` | read | — | smt-db-readonly smt-notify |
| `AUDIT_TRACE` | 审核追溯 | `admin.audit.read` | read | — | smt-db-readonly |
| `CLOSE_NCR` | 关闭不合格单 | `quality.write` | write | close_ncr | smt-api |
| `REPEAT_DEFECT_FLAG` | 重复缺陷标记 | `quality.read` | read | — | smt-db-readonly smt-memory |
| `MRB_CONVENE` | 报废评审召集 | `quality.read` | draft | — | factory-mailbox smt-notify |
| `WORKLOAD_BALANCE` | 本域工作量分配 | `org.view` | draft | — | smt-db-readonly factory-mailbox |
| `GATE_PACKET_ASSEMBLE` | 本域人工门审批包整理 | `lifecycle.view` | draft | — | smt-api smt-notify |
| `EXCEPTION_ROUTE` | 异常路由与唯一主责 | `management.communication.send` | draft | — | factory-mailbox smt-db-readonly |
| `CAPA_CLOSURE_REQUEST` | CAPA 关闭请求 | `quality.write` | write | approve_capa | smt-db-readonly smt-api |

### RELEASE-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `BUILD_VERIFY` | 构建校验 | `admin.view` | read | — | smt-observability |
| `MIGRATION_CHECK` | 迁移校验 | `admin.system` | read | — | graft smt-db-readonly |
| `ROLLOUT_MONITOR` | 灰度监控 | `admin.view` | read | — | smt-observability |
| `ROLLBACK_PLAN` | 回滚方案 | `admin.system` | draft | production_deploy | smt-api |
| `PRODUCTION_DEPLOY` | 生产部署 | `admin.system` | write | production_deploy | smt-api |

### REPAIR-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `REWORK_ROUTE` | 返工路由 | `quality.write` | draft | — | smt-api |
| `REWORK_LIMIT_CHECK` | 返工次数上限核查 | `quality.read` | read | — | smt-db-readonly smt-memory |
| `RETEST_PLAN` | 复检计划 | `quality.inspect` | draft | — | smt-api |
| `DISPOSITION_APPLY` | 处置执行 | `quality.execute` | write | approve_scrap | smt-api |
| `DOWNTIME_RECORD` | 停机记录 | `maintenance.read` | draft | — | smt-api smt-realtime |

### REPORTS-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `METRIC_DICT` | 指标字典维护 | `ai.report` | draft | — | smt-bi smt-db-readonly |
| `KPI_DEFINITION` | KPI 口径定义 | `ai.report` | draft | — | smt-db-readonly factory-mailbox |
| `DASHBOARD_AUDIT` | 看板一致性稽核 | `ai.report` | read | — | smt-bi |
| `DATA_LINEAGE` | 数据血缘核对 | `master_data.read` | read | — | smt-db-readonly graft |
| `ADHOC_QUERY` | 临时只读查询 | `ai.query` | read | — | smt-db-readonly |
| `KPI_MONITOR` | 指标监控 | `ai.report` | read | — | smt-db-readonly smt-bi |
| `REPORT_DISTRIBUTE` | 报表分发 | `management.communication.send` | draft | — | smt-notify |

### SAFETY-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `HAZARD_INTAKE` | 隐患登记 | `maintenance.read` | draft | — | smt-api |
| `SAFETY_ROUND` | 安全巡检 | `maintenance.read` | read | — | smt-pda smt-db-readonly |
| `INCIDENT_REPORT` | 事故报告 | `quality.read` | draft | — | smt-api factory-mailbox |
| `PPE_AUDIT` | 劳保穿戴稽核 | `maintenance.read` | read | — | smt-pda |
| `DRILL_SCHEDULE` | 演练计划 | `org.view` | draft | — | smt-api smt-notify |

### SALES-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `ORDER_INTAKE` | 销售订单受理 | `sales.view` | read | — | smt-db-readonly |
| `ATP_CHECK` | 可承诺量核算 | `sales.view` | read | — | smt-db-readonly |
| `DELIVERY_REPLY` | 交期回复 | `sales.manage` | draft | commit_delivery | smt-api smt-notify |
| `CHANGE_ORDER_NOTICE` | 订单变更通知 | `sales.view` | draft | — | factory-mailbox smt-notify |

### SECURITY-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `ACCESS_AUDIT` | 访问审计 | `admin.audit.read` | read | — | smt-db-readonly |
| `SECRET_SCAN` | 密钥扫描 | `admin.audit.read` | read | — | graft smt-observability |
| `ANOMALY_ALERT` | 异常行为告警 | `admin.view` | read | — | smt-observability |
| `DISABLE_ACCOUNT` | 停用账号 | `admin.users` | write | disable_account | smt-api |
| `ROTATE_SECRET` | 密钥轮换 | `admin.system` | write | rotate_secret | smt-api |

### SMT-LOOP-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `FEEDER_LOADING` | 上料校验 | `mes.execute` | read | — | smt-api smt-db-readonly |
| `REEL_CONSUME` | 料盘消耗记账 | `mes.execute` | write | inventory_adjustment | smt-api smt-db-readonly |
| `SPLICING_TRACE` | 接料追溯 | `traceability.query` | read | — | smt-db-readonly |
| `JOINT_VALIDATE` | 拼版/共料校验 | `mes.view` | read | — | smt-db-readonly |
| `MISSING_PART_ALERT` | 错漏件告警 | `mes.read` | draft | — | smt-notify factory-mailbox |
| `LOADING_PLAN_DRAFT` | 上料计划草案 | `mes.execute` | draft | commit_delivery | smt-api |

### SPARE-PARTS-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `PARITY_LEVEL` | 备件安全水位 | `maintenance.read` | read | — | smt-db-readonly |
| `CONSUME_FORECAST` | 耗用预测 | `maintenance.read` | read | — | smt-db-readonly |
| `STOCKOUT_ALERT` | 缺件告警 | `maintenance.read` | draft | — | smt-notify smt-db-readonly |
| `SPARE_LEAD_TRACK` | 备件交期跟踪 | `procurement.view` | read | — | smt-db-readonly |

### STATION-EQUIP-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `STATION_CONFIG_AUDIT` | 站端配置比对 | `mes.view` | read | — | smt-db-readonly smt-pda |
| `PROGRAM_VERSION_CHECK` | 程序版本核对 | `mes.route.publish` | read | — | smt-db-readonly |
| `EQUIP_INTERLOCK` | 设备互锁状态 | `maintenance.read` | read | — | smt-plc-bridge smt-realtime |
| `TORQUE_DATA_TRACE` | 扭力数据追溯 | `mes.read` | read | — | smt-realtime smt-db-readonly |
| `STATION_HEARTBEAT` | 站机心跳 | `pda.view` | read | — | smt-realtime smt-observability |

### SUPPLIER-CLAIM-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `CLAIM_DRAFT` | 索赔单草案 | `procurement.view` | draft | — | smt-api smt-db-readonly |
| `EVIDENCE_PACKAGE` | 索赔证据包 | `quality.read` | read | — | smt-db-readonly smt-aoi |
| `CREDIT_NOTE_TRACK` | 贷记单跟踪 | `finance.ar.read` | read | — | smt-db-readonly |
| `IQC_FEEDBACK` | 检验结果回馈供应商 | `qms.read` | draft | — | smt-supplier-portal smt-notify |

### SUPPLIER-COLLAB-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `PORTAL_SYNC` | 门户数据同步 | `procurement.view` | draft | — | smt-supplier-portal |
| `ASN_MONITOR` | ASN 监控 | `procurement.view` | read | — | smt-supplier-portal smt-db-readonly |
| `QR_PRERECEIVING` | 预收货 QR 校验 | `wms.receive` | read | — | smt-supplier-portal smt-api |
| `IQC_FEEDBACK` | 检验结果回馈供应商 | `qms.read` | draft | — | smt-supplier-portal smt-notify |
| `SUPPLIER_FOLLOWUP` | 供应商跟催 | `procurement.view` | draft | — | smt-supplier-portal smt-notify |
| `ETA_ATA_TRACKING` | ETA/ATA 跟踪 | `procurement.view` | read | — | smt-db-readonly |
| `DELIVERY_EXCEPTION` | 交付异常登记 | `procurement.view` | draft | — | smt-api |
| `REJECTION_PUBLISH` | 拒收发布 | `procurement.view` | write | publish_rejection | smt-supplier-portal smt-api |
| `SUPPLIER_ACCOUNT_PACKET` | 供应商账号开通包 | `procurement.view` | write | supplier_account_approval | smt-supplier-portal |
| `SUPPLIER_RETURN_WATCH` | 供应商退货监控 | `procurement.view` | read | — | smt-db-readonly smt-supplier-portal |

### SUPPLIER-DEBT-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `DEBT_AGING` | 供应商欠款账龄 | `finance.ap.read` | read | — | smt-db-readonly |
| `PAYMENT_PLAN_DRAFT` | 付款计划草案 | `finance.ap.read` | draft | approve_payment | smt-api |
| `OVERDUE_ESCALATE` | 超时升级 | `management.communication.send` | draft | — | smt-notify factory-mailbox |
| `TERMS_CHECK` | 账期条款核对 | `procurement.view` | read | — | smt-db-readonly |

### TRACE-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `SERIAL_TRACE` | 序列号追溯 | `traceability.query` | read | — | smt-db-readonly |
| `RECALL_SCOPE` | 召回范围界定 | `traceability.query` | draft | — | smt-db-readonly factory-mailbox |
| `ECN_TRACE` | ECN 影响追溯 | `lifecycle.view` | read | — | smt-db-readonly smt-api |
| `CUSTOMER_IMPACT_LIST` | 客户影响清单 | `sales.view` | draft | — | smt-db-readonly |
| `RETENTION_PURGE_PROPOSE` | 留存期限清理建议 | `lifecycle.view` | draft | delete_data | smt-db-readonly |
| `QR_TRACE` | QR 全链追溯 | `traceability.query` | read | — | smt-db-readonly |

### UI-DESIGN-QA-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `VISUAL_AUDIT` | 视觉走查 | `admin.view` | read | — | smt-api |
| `RESPONSIVE_TEST` | 多分辨率测试 | `admin.view` | read | — | smt-api |
| `ACCESSIBILITY_CHECK` | 无障碍检查 | `admin.view` | read | — | smt-api |
| `REGRESSION_TEST` | UI 回归 | `admin.view` | read | — | smt-api graft |
| `emil-design-eng` | 设计工程规范 | `admin.view` | read | — | smt-api graft |
| `prototype` | 原型构建 | `admin.view` | read | — | smt-api |
| `pick-ui-library` | 组件库选型 | `admin.view` | read | — | graft |
| `find-animation-opportunities` | 动效机会识别 | `admin.view` | read | — | smt-api |
| `animate` | 动效实现 | `admin.view` | read | — | smt-api |
| `review-animations` | 动效评审 | `admin.view` | read | — | smt-api |
| `improve-animations` | 动效改进 | `admin.view` | read | — | smt-api |
| `ask-sonner` | 通知组件咨询 | `admin.view` | read | — | smt-api |
| `animation-vocabulary` | 动效术语表 | `admin.view` | read | — | smt-api |

### WMS-COUNT-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `COUNT_PLAN` | 盘点计划 | `wms.view` | draft | — | smt-db-readonly |
| `COUNT_SHEET` | 盘点表下发 | `wms.execute` | draft | — | smt-api smt-pda |
| `CYCLE_COUNT` | 循环盘点执行 | `wms.execute` | write | inventory_adjustment | smt-api smt-pda |
| `VARIANCE_ANALYSIS` | 差异分析 | `wms.view` | read | — | smt-db-readonly |
| `RECOUNT_REQUEST` | 复盘请求 | `wms.execute` | write | inventory_adjustment | smt-api |

### WMS-INVENTORY-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `INVENTORY_RECONCILE` | 账实比对 | `wms.view` | read | — | smt-db-readonly |
| `FIFO_FEFO` | 先进先出/先到期先出 | `wms.view` | read | — | smt-db-readonly |
| `LOCATION_OPTIMIZE` | 库位优化建议 | `wms.write` | draft | — | smt-db-readonly smt-api |
| `PUTAWAY_RECOMMEND` | 上架推荐 | `wms.execute` | write | override_putaway_rule | smt-api |
| `CYCLE_COUNT` | 循环盘点执行 | `wms.execute` | write | inventory_adjustment | smt-api smt-pda |
| `SAFETY_STOCK_REPORT` | 安全库存报告 | `wms.view` | read | — | smt-db-readonly smt-notify |
| `DISTRIBUTION_SLA_MONITOR` | 配送时限监控 | `wms.issue` | read | — | smt-db-readonly |
| `DELIVERY_VARIANCE_ALERT` | 配送差异告警 | `wms.issue` | draft | — | smt-notify factory-mailbox |
| `UNRECEIVED_PACKAGE_ESCALATE` | 未签收包裹升级 | `wms.issue` | draft | — | smt-db-readonly smt-notify |
| `DISTRIBUTION_KANBAN_REFRESH` | 配送看板刷新 | `wms.view` | draft | — | smt-bi |
| `VARIANCE_ANALYSIS` | 差异分析 | `wms.view` | read | — | smt-db-readonly |
| `SCRAP_PROPOSAL` | 报废提案 | `wms.execute` | write | material_scrap | smt-api smt-db-readonly |
| `DISTRIBUTION_APPROVAL_PACKET` | 配送审批包 | `wms.issue` | write | approve_distribution | smt-api smt-notify |
| `PACKAGE_SIGNATURE_WATCH` | 包裹签收监控 | `wms.view` | read | — | smt-db-readonly |

### WMS-IQC-HANDOFF-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `IQC_SUBMIT` | 提交检验单 | `wms.iqc` | draft | — | smt-api |
| `IQC_HANDOFF` | 来料交检 | `wms.iqc` | write | receive_variance | smt-api smt-db-readonly |
| `HOLD_ENFORCE` | IQC HOLD 强制 | `wms.iqc` | write | release_inventory | smt-api smt-db-readonly |
| `HANDOFF_RECEIPT` | 交接回执 | `wms.view` | read | — | smt-db-readonly |
| `SAMPLE_WITNESS` | 抽样见证记录 | `quality.inspect` | read | — | smt-api |

### WMS-ISSUE-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `KIT_PICK` | 齐套拣配 | `wms.pick` | draft | — | smt-api smt-db-readonly |
| `FOFO_ALLOC` | FOFO 分配 | `wms.pick` | draft | — | smt-db-readonly |
| `LINE_FEED` | 线边配送 | `wms.issue` | write | hand_over_package | smt-api smt-pda |
| `ISSUE_CONFIRM` | 发料确认 | `wms.issue` | write | receive_package | smt-api |
| `SHORTAGE_ESCALATE` | 缺料升级 | `pmc.view` | draft | — | factory-mailbox smt-notify |
| `KANBAN_REFRESH` | 线边看板刷新 | `wms.view` | draft | — | smt-bi |
| `DISTRIBUTION_SLA_MONITOR` | 配送时限监控 | `wms.issue` | read | — | smt-db-readonly |

### WMS-RECEIVING-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `RECEIVING_VALIDATE` | 收货核对 | `wms.receive` | read | — | smt-api smt-db-readonly |
| `LABEL_PLAN` | 箱标计划与打印 | `wms.write` | draft | — | smt-api smt-pda |
| `HIDDEN_PALLET_BIND` | 隐藏托盘绑定 | `wms.write` | draft | — | smt-api |
| `LOCATION_BIND` | 仓位绑定 | `wms.write` | draft | — | smt-api |
| `IQC_HANDOFF` | 来料交检 | `wms.iqc` | write | receive_variance | smt-api smt-db-readonly |
| `HANDOFF_RECEIPT` | 交接回执 | `wms.view` | read | — | smt-db-readonly |
| `QR_PRERECEIVING` | 预收货 QR 校验 | `wms.receive` | read | — | smt-supplier-portal smt-api |
| `RECEIPT_RELEASE_REQUEST` | 收货放行请求 | `wms.receive` | write | inventory_release | smt-api |

### WMS-SUPERVISOR-VIRTUAL-01

| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |
| --- | --- | --- | --- | --- | --- |
| `SUPERVISE_INTAKE` | 来料主管复核 | `wms.view` | read | — | smt-db-readonly |
| `INBOUND_ARBITRATION` | 入库争议仲裁 | `wms.view` | draft | — | factory-mailbox smt-db-readonly |
| `WORKLOAD_BALANCE` | 本域工作量分配 | `org.view` | draft | — | smt-db-readonly factory-mailbox |
| `GATE_PACKET_ASSEMBLE` | 本域人工门审批包整理 | `lifecycle.view` | draft | — | smt-api smt-notify |
| `EXCEPTION_ROUTE` | 异常路由与唯一主责 | `management.communication.send` | draft | — | factory-mailbox smt-db-readonly |
| `KPI_MONITOR` | 指标监控 | `ai.report` | read | — | smt-db-readonly smt-bi |
| `SHIFT_HANDOVER` | 交接班记录 | `management.communication.send` | draft | — | smt-api smt-notify |
| `OVERDUE_ESCALATE` | 超时升级 | `management.communication.send` | draft | — | smt-notify factory-mailbox |

## 5. 与调度器的关系（探针即技能）

`services/api/src/agent/runner.js` 的每个探针 `taskType` 都必须是该岗位已声明的技能，测试 `tests/virtual-employee-capabilities.test.mjs` 会逐条验证；新增探针而没登记技能，测试直接红。

| 岗位 | 探针 taskType | 技能类型 | 权限 | 门 |
| --- | --- | --- | --- | --- |
| IQC-VIRTUAL-01 | `IQC_INSPECT` | draft | `qms.execute` | final_iqc_decision |
| WMS-RECEIVING-VIRTUAL-01 | `RECEIVING_VALIDATE` | read | `wms.receive` | — |
| WMS-INVENTORY-VIRTUAL-01 | `PACKAGE_SIGNATURE_WATCH` | read | `wms.view` | — |
| MAINTENANCE-VIRTUAL-01 | `WEAR_ALERT_TRIAGE` | read | `maintenance.read` | — |
| OA-DOCUMENT-CONTROL-VIRTUAL-01 | `APPROVAL_PACKAGE_CHECK` | read | `lifecycle.view` | — |
| SUPPLIER-COLLAB-VIRTUAL-01 | `SUPPLIER_RETURN_WATCH` | read | `procurement.view` | — |
| OPS-SUPERVISOR-VIRTUAL-01 | `APPROVAL_ESCALATION` | draft | `management.communication.send` | — |

## 6. 待决事项（自检当前报为 warning，不报 error）

- **只有人类能签的门**：OPS（release_inventory / approve_scrap / change_po / stop_line / approve_payment / final_iqc_decision）、WMS-INVENTORY（hand_over_package、receive_package，实际属发料岗）、APP-OPS（data_mutation）、DATABASE（restore_database、delete_data）、DATA-QUALITY（master_data_merge、bulk_correction）、BACKUP（delete_backup）、RELEASE（database_migration）、UI-DESIGN-QA（change_design_system、release_ui）。这些门登记在岗位上是为了让人类批准该岗起草的任务，而不是虚拟员工自己的动作，所以没有对应的写技能。
- **两个岗位的双重身份**：`DATA-QUALITY-VIRTUAL-01` 与 `UI-DESIGN-QA-VIRTUAL-01` 在 `ve_reporting_lines` 里是占位（enabled=false），在 `registry.js` 里仍是 enabled=true。`check:ve-capabilities --db` 会报 `ENABLED_FLAG_CONFLICT`，需要人拍板：要么承认它们已上岗，要么在 registry 里停用。

## 7. 查询方式

```
GET /api/factory/virtual-employees/<EMPLOYEE_ID>/capabilities   # 单岗技能+MCP+门
GET /api/factory/virtual-employees/capabilities/summary          # 全组织自检（problems 必须为 0）
npm run check:ve-capabilities            # 静态契约自检
npm run check:ve-capabilities -- --db    # 外加权限表/岗位表/在用门的实测比对
```
未登记岗位返回 404 `ROLE_NOT_DECLARED`；21 个只存在于汇报线表里的岗位在这里有完整答案，`registry` 字段为 null 表示代码侧尚未建仓。
