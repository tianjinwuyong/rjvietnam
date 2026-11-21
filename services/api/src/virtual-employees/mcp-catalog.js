// Permission and MCP catalogues backing the virtual-employee capability
// contract (see capabilities.js).
//
// PERMISSION_CODES is a mirror of the live `permissions` table (95 rows,
// read from the local DB on 2026-11-20). `npm run check:ve-capabilities -- --db`
// re-reads the table and fails on drift, so this mirror cannot rot silently.

export const PERMISSION_CODES = Object.freeze([
  "admin.audit", "admin.audit.read", "admin.audit.write", "admin.roles", "admin.system", "admin.users", "admin.view",
  "ai.chat", "ai.query", "ai.report", "auth.login", "auth.logout",
  "bom.edit", "bom.view", "einvoice.admin", "einvoice.manage", "einvoice.view",
  "finance.ap.read", "finance.ap.write", "finance.ar.read", "finance.ar.write",
  "finance.billing.read", "finance.billing.write", "finance.cost.read", "finance.cost.write",
  "finance.gl.read", "finance.gl.write", "finance.manage", "finance.posting.read", "finance.posting.write",
  "hr.admin", "hr.attendance", "hr.department", "hr.edit", "hr.grievance.investigate", "hr.grievance.respond",
  "hr.grievance.submit", "hr.hiring_request.create", "hr.hiring_request.sign", "hr.leave", "hr.position", "hr.salary", "hr.view",
  "lifecycle.approve", "lifecycle.edit", "lifecycle.view",
  "maintenance.execute", "maintenance.manage", "maintenance.read", "maintenance.write",
  "management.communication.ack", "management.communication.send", "management.communication.view",
  "management.exception.authorize", "master_data.read",
  "mes.admin", "mes.bind", "mes.execute", "mes.line_assignment.manage", "mes.read", "mes.route.approve",
  "mes.route.configure", "mes.route.publish", "mes.view", "org.edit", "org.view",
  "pda.manage", "pda.view", "pmc.create", "pmc.edit", "pmc.execute", "pmc.view",
  "procurement.manage", "procurement.view", "qms.execute", "qms.read",
  "quality.execute", "quality.inspect", "quality.read", "quality.view", "quality.write",
  "sales.manage", "sales.view", "smt.loading.approve", "traceability.query",
  "wms.edit", "wms.execute", "wms.iqc", "wms.issue", "wms.pick", "wms.receive", "wms.return",
  "wms.sync.manage", "wms.view", "wms.write",
]);

// The MCP surface an employee may reach. Agent-version rule: interface only —
// no employee gets a UI, and none gets a write path that skips smt-api.
// `endpoint` values follow app_rules/runtime-ports.md and the compose stack on
// the rjms host; `write:true` means the server can change business state and
// therefore every tool behind it inherits the human-gate rule.
export const MCP_SERVERS = Object.freeze({
  "smt-api": {
    endpoint: "http://127.0.0.1:8080/api/agent/tools", transport: "json-rpc (stdio bridge scripts/agent-tool.mjs)",
    write: true, purpose: "唯一业务写路径：所有草稿、提交、放行动作都经过这里并带 x-ve-token",
  },
  "smt-db-readonly": {
    endpoint: "postgres://127.0.0.1:5432/smt_factory", transport: "mcp-postgres (readonly role)",
    write: false, purpose: "事实只读：行级核对、统计、数据体检；禁止任何 DML/DDL",
  },
  "smt-realtime": {
    endpoint: "ws://127.0.0.1:8081", transport: "websocket",
    write: false, purpose: "过站、安灯、设备事件流（services/realtime）",
  },
  "smt-aoi": {
    endpoint: "http://127.0.0.1:6309", transport: "http",
    write: false, purpose: "AOI/SPI 检测结果与图像（services/aoi-api）",
  },
  "smt-memory": {
    endpoint: "http://127.0.0.1:9876", transport: "http (mem0)",
    write: true, purpose: "经验记忆读写，命名空间 ve/<EMPLOYEE_ID>；闸门 services/_shared/memory-experience.js",
  },
  "smt-supplier-portal": {
    endpoint: "http://127.0.0.1:8098", transport: "http (FastAPI)",
    write: true, purpose: "供应商门户：ASN、确认、退货与索赔数据",
  },
  "smt-plc-bridge": {
    endpoint: "http://127.0.0.1:1880", transport: "nodered",
    write: false, purpose: "Node-RED：PLC / Modbus / OPC-UA 与安灯硬件桥，遥测只读",
  },
  "smt-notify": {
    endpoint: "LINE notify-api / 企业微信 webhook", transport: "http",
    write: false, purpose: "催办、告警与升级通知，受频率表（frequencies.js）与 SLA 约束",
  },
  "smt-bi": {
    endpoint: "http://127.0.0.1:3000", transport: "http (Metabase)",
    write: false, purpose: "指标与看板只读查询",
  },
  "smt-observability": {
    endpoint: "http://127.0.0.1:9090 + http://127.0.0.1:3001", transport: "promql + http (Grafana)",
    write: false, purpose: "服务与主机指标、告警规则只读",
  },
  "smt-llm": {
    endpoint: "http://127.0.0.1:11434", transport: "ollama api",
    write: false, purpose: "本地模型（判定辅助与嵌入），仅阈值触发时调用，预算 ≤20 次/日",
  },
  "factory-mailbox": {
    endpoint: "redis mailbox (mcp factory-mailbox)", transport: "mcp",
    write: false, purpose: "虚拟员工之间与人类值班员的信箱；主管派工与升级的唯一通道",
  },
  "graft": {
    endpoint: "mcp graft (context graph)", transport: "mcp",
    write: false, purpose: "代码图谱：仅 IT 岗位排障用，产线岗位不得访问源码",
  },
  "smt-pda": {
    endpoint: "http://127.0.0.1:5174 + station-agent :5179", transport: "http",
    write: true, purpose: "PDA/站端配置与打印任务下发（远程设备动作属高风险，必须人工门）",
  },
});

export const WRITE_MCP_IDS = Object.freeze(Object.keys(MCP_SERVERS).filter(k => MCP_SERVERS[k].write));
