#!/usr/bin/env node
// Renders docs/virtual-employees/SKILLS-AND-MCP.md from the capability
// contract itself, so the document cannot drift from the code it describes.
//   node scripts/ve-capabilities-doc.mjs
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKILLS, SKILL_BY_ID, ROLE_CAPABILITIES, MCP_SERVERS, PERMISSION_CODES,
  capabilitiesFor, auditCapabilities,
} from "../services/api/src/virtual-employees/capabilities.js";
import { FACTORY_VIRTUAL_EMPLOYEES } from "../services/api/src/virtual-employees/registry.js";
import { PROBES } from "../services/api/src/agent/runner.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "virtual-employees", "SKILLS-AND-MCP.md");
const lines = [];
const p = s => lines.push(s);

const ROLE_DEPT = Object.fromEntries(Object.entries(ROLE_CAPABILITIES).map(([id]) => [id, capabilitiesFor(id)]));
const DEPTS = { CMD: "指挥", D1: "来料与仓储", D2: "计划与采购", D3: "制造执行", D4: "品质", D5: "设备与工程", D6: "商务与财务", D7: "行政人事与文控", D8: "平台与 IT" };
const deptOf = id => id === "OPS-SUPERVISOR-VIRTUAL-01" ? "CMD" : id.split("-")[0] === "WMS" || id.startsWith("MSD") ? "D1"
  : ["PMC", "PURCHASING", "SUPPLIER-COLLAB", "SUPPLIER-CLAIM"].some(x => id.startsWith(x)) ? "D2"
  : ["MES", "ANDON", "LINE-CADENCE", "PACK", "SMT-LOOP"].some(x => id.startsWith(x)) ? "D3"
  : ["IQC", "OQC", "QUALITY", "MRB", "TRACE"].some(x => id.startsWith(x) && x !== "MSD") ? "D4"
  : ["MAINTENANCE", "REPAIR", "SPARE", "STATION"].some(x => id.startsWith(x)) ? "D5"
  : ["FINANCE", "E-INVOICE", "SALES", "SUPPLIER-DEBT"].some(x => id.startsWith(x)) ? "D6"
  : ["HR", "OA", "SAFETY"].some(x => id.startsWith(x)) ? "D7" : "D8";

const audit = auditCapabilities({ registryEntries: FACTORY_VIRTUAL_EMPLOYEES });

p("# 虚拟员工技能与 MCP 契约（SKILLS & MCP）");
p("");
p("机器可读的岗位能力契约：**每个虚拟员工需要哪些技能、每个技能靠哪条真实权限、写操作卡在哪个人工门、允许调用哪些 MCP 服务器**。");
p("");
p("代码是唯一真相，本文件由 `node scripts/ve-capabilities-doc.mjs` 从代码渲染：");
p("");
p("| 文件 | 内容 |");
p("| --- | --- |");
p("| `services/api/src/virtual-employees/skills-catalog.js` | 技能目录（权限键 / 读写类型 / 人工门 / 所需 MCP） |");
p("| `services/api/src/virtual-employees/mcp-catalog.js` | 权限键镜像 + MCP 服务器目录 |");
p("| `services/api/src/virtual-employees/role-capabilities.js` | 44 岗 × 技能矩阵 |");
p("| `services/api/src/virtual-employees/capabilities.js` | 查询与自检 API（`capabilitiesFor` / `canUseSkill` / `auditCapabilities`） |");
p("");
p(`规模：**${Object.keys(ROLE_DEPT).length} 个岗位、${SKILLS.length} 个技能、${Object.keys(MCP_SERVERS).length} 个 MCP 服务器、${PERMISSION_CODES.length} 条真实权限键**。自检结果：problems=${audit.problems.length}，warnings=${audit.warnings.length}。`);
p("");
p("## 1. 三条硬规则");
p("");
p("1. **写技能必须绑人工门。** `kind:\"write\"` 的技能一律带 `gate`；自检里 `WRITE_WITHOUT_GATE` 是失败项。写技能运行时只产出 `WAITING_APPROVAL` 草稿任务，批准人必须是具名人类（`ve:` 身份被 `VE_CANNOT_APPROVE` 拒绝）。");
p("2. **门必须注册在干活的那个岗位上。** `canUseSkill()` 只承认该岗位已声明的技能；`runner.js` 每轮先问契约，未声明就返回 `skipped: SKILL_NOT_DECLARED_FOR_ROLE`，不落任务。反向检查 `WRITE_GATE_NOT_IN_REGISTRY` 抓的是「契约答应了运行时给不出来的东西」。");
p("3. **权限键必须真实存在。** 每条技能绑定 `permissions` 表里的一条 code（`PERMISSION_CODES` 是它的镜像，`check:ve-capabilities --db` 会重读表并比对）；只读技能不得持有 `.manage` 级权限。");
p("");
p("## 2. MCP 服务器目录");
p("");
p("| MCP | 端点 | 可写 | 用途 |");
p("| --- | --- | --- | --- |");
for (const [id, m] of Object.entries(MCP_SERVERS)) p(`| \`${id}\` | ${m.endpoint} | ${m.write ? "是" : "否"} | ${m.purpose} |`);
p("");
p("岗位能用的 MCP = 它所有技能所需 MCP 的并集 **+ `smt-memory`**（每个员工都要能回忆与沉淀自己的经验，见 `JOB-DESCRIPTIONS.md` §18）。");
p("");
p("## 3. 岗位矩阵");
p("");
for (const [dept, label] of Object.entries(DEPTS)) {
  const ids = Object.keys(ROLE_CAPABILITIES).filter(id => deptOf(id) === dept).sort();
  if (!ids.length) continue;
  p(`### ${dept} ${label}`);
  p("");
  p("| 岗位 | 技能数 | 读 | 草稿 | 写(带门) | 自有门 | MCP |");
  p("| --- | --- | --- | --- | --- | --- | --- |");
  for (const id of ids) {
    const c = capabilitiesFor(id);
    p(`| ${id} | ${c.skillIds.length} | ${c.counts.read} | ${c.counts.draft} | ${c.counts.write} | ${c.gates.join("、") || "—"} | ${c.mcpServers.length} |`);
  }
  p("");
}
p("## 4. 逐岗技能清单");
p("");
for (const id of Object.keys(ROLE_CAPABILITIES).sort()) {
  const c = capabilitiesFor(id);
  p(`### ${id}`);
  p("");
  p("| 技能 | 名称 | 权限 | 类型 | 人工门 | MCP |");
  p("| --- | --- | --- | --- | --- | --- |");
  for (const s of c.skills) {
    p(`| \`${s.id}\` | ${s.name_zh} | \`${s.permission}\` | ${s.kind} | ${s.gate || "—"} | ${s.mcp.join(" ")} |`);
  }
  p("");
}
p("## 5. 与调度器的关系（探针即技能）");
p("");
p("`services/api/src/agent/runner.js` 的每个探针 `taskType` 都必须是该岗位已声明的技能，测试 `tests/virtual-employee-capabilities.test.mjs` 会逐条验证；新增探针而没登记技能，测试直接红。");
p("");
p("| 岗位 | 探针 taskType | 技能类型 | 权限 | 门 |");
p("| --- | --- | --- | --- | --- |");
for (const [id, probe] of Object.entries(PROBES)) {
  const s = SKILL_BY_ID.get(probe.taskType);
  p(`| ${id} | \`${probe.taskType}\` | ${s?.kind} | \`${s?.permission}\` | ${s?.gate || "—"} |`);
}
p("");
p("## 6. 待决事项（自检当前报为 warning，不报 error）");
p("");
p("- **只有人类能签的门**：OPS（release_inventory / approve_scrap / change_po / stop_line / approve_payment / final_iqc_decision）、WMS-INVENTORY（hand_over_package、receive_package，实际属发料岗）、APP-OPS（data_mutation）、DATABASE（restore_database、delete_data）、DATA-QUALITY（master_data_merge、bulk_correction）、BACKUP（delete_backup）、RELEASE（database_migration）、UI-DESIGN-QA（change_design_system、release_ui）。这些门登记在岗位上是为了让人类批准该岗起草的任务，而不是虚拟员工自己的动作，所以没有对应的写技能。");
p("- **两个岗位的双重身份**：`DATA-QUALITY-VIRTUAL-01` 与 `UI-DESIGN-QA-VIRTUAL-01` 在 `ve_reporting_lines` 里是占位（enabled=false），在 `registry.js` 里仍是 enabled=true。`check:ve-capabilities --db` 会报 `ENABLED_FLAG_CONFLICT`，需要人拍板：要么承认它们已上岗，要么在 registry 里停用。");
p("");
p("## 7. 查询方式");
p("");
p("```");
p("GET /api/factory/virtual-employees/<EMPLOYEE_ID>/capabilities   # 单岗技能+MCP+门");
p("GET /api/factory/virtual-employees/capabilities/summary          # 全组织自检（problems 必须为 0）");
p("npm run check:ve-capabilities            # 静态契约自检");
p("npm run check:ve-capabilities -- --db    # 外加权限表/岗位表/在用门的实测比对");
p("```");
p("未登记岗位返回 404 `ROLE_NOT_DECLARED`；21 个只存在于汇报线表里的岗位在这里有完整答案，`registry` 字段为 null 表示代码侧尚未建仓。");
p("");

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`WROTE ${OUT} lines=${lines.length} skills=${SKILLS.length} roles=${Object.keys(ROLE_DEPT).length} problems=${audit.problems.length}`);
