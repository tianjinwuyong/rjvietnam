// 模块注册表 —— 阶段4步1 从 App.tsx 整段搬迁（refactor-plan-2026-11-21）。
// 侧边栏键(ModuleKey) + 模块清单(modules) + 全量授权(FULL_MODULES) + 角色白名单
// (roleModuleAccess)。声明逐字未改;App.tsx 只留 import。moduleGroups/permissionModuleMap
// 等派生结构仍留在 App.tsx(它们消费这里的导出)。
import type { TranslationKey } from "../i18n";
import { Activity, Bot, Boxes, Briefcase, CalendarClock, ClipboardCheck, ClipboardList, Factory, FileText, FolderTree, Gauge, Headphones, LayoutDashboard, LineChart, Monitor, PackageCheck, Palette, Receipt, Rocket, Search, Settings, Shield, ShieldCheck, Sparkles, TrendingUp, User, Users, Wallet, Wrench, Zap } from "lucide-react";

// Sidebar keys (the `modules` array below) plus hash-only surfaces: mobile/PDA
// apps and 3D station agents are reached by URL hash or factory:navigate, never
// from the desktop sidebar. Keep both kinds in one union — the content map is
// keyed by it — but a key absent from `modules` is hash-only by declaration.
export type ModuleKey = "smtLine3d" | "mobile" | "smtReelConsumption" | "groupLeaderPda" | "pdaUiDesigner" | "managementUiDesigner" | "dashboard" | "pmc" | "wms" | "mes" | "quality" | "trace" | "reports" | "admin" | "hr" | "maintenance" | "ai" | "finance" | "sales" | "service" | "bom" | "andonBoard" | "projects" | "projectMgmt" | "agents" | "employee" | "managerDashboard" | "safetyManager" | "pdaCommMonitor" | "ambassadorDashboard" | "effectivenessAmbassador" | "efficiencyAmbassador" | "swiftnessAmbassador" | "collaborationAmbassador" | "procurement" | "einvoice" | "workflow" | "oa" | "manualLine3d" | "pdaAgent3d" | "aoiAgent3d" | "ictAgent3d" | "fctAgent3d" | "assemblyAteAgent3d" | "supersonicAgent3d" | "agingCabAgent3d" | "highVoltAteAgent3d" | "packingAteAgent3d" | "outerBoxBindingAgent3d" | "depanelAgent3d" | "qrbindingAgent2d" | "qrbindingAgent3d" | "mesManagerConsole" | "team" | "mobileleave" | "qms";

export const modules: Array<{ key: ModuleKey; label: TranslationKey; icon: typeof Gauge }> = [
  { key: "dashboard", label: "nav.dashboard", icon: Gauge },
  { key: "pmc", label: "nav.pmc", icon: CalendarClock },
  { key: "wms", label: "nav.wms", icon: Boxes },
  { key: "bom", label: "nav.bom", icon: ClipboardList },
  { key: "mes", label: "nav.mes", icon: Factory },
  { key: "smtReelConsumption", label: "nav.smtReelConsumption", icon: Activity },
  { key: "pdaUiDesigner", label: "nav.pdaUiDesigner", icon: LayoutDashboard },
  { key: "managementUiDesigner", label: "nav.managementUiDesigner", icon: Palette },
  { key: "andonBoard", label: "nav.andon", icon: Activity },
  // Quality domain: QMS is the sidebar main entry (nav.qms). `quality` (line
  // quality board) stays registered for roles whose whitelist lists it and for
  // deep links, but moduleGroups does not show it as a second sidebar entry.
  { key: "quality", label: "nav.quality", icon: ShieldCheck },
  { key: "qms", label: "nav.qms", icon: ClipboardCheck },
  { key: "trace", label: "nav.trace", icon: Search },
  { key: "reports", label: "nav.reports", icon: LineChart },
  { key: "sales", label: "nav.sales", icon: Briefcase },
  { key: "service", label: "nav.service", icon: Headphones },
  { key: "finance", label: "nav.finance", icon: Wallet },
  { key: "procurement", label: "nav.procurement", icon: FileText },
  { key: "einvoice", label: "nav.einvoice", icon: Receipt },
  { key: "admin", label: "nav.admin", icon: Settings },
  { key: "hr", label: "nav.hr", icon: Users },
  { key: "maintenance", label: "nav.maintenance", icon: Wrench },
  { key: "projects", label: "nav.projects", icon: PackageCheck },
  { key: "projectMgmt", label: "nav.projectMgmt", icon: FolderTree },
  { key: "ai", label: "nav.ai", icon: Sparkles },
  { key: "agents", label: "nav.agents", icon: Bot },
  { key: "employee", label: "nav.employee", icon: User },
  { key: "managerDashboard", label: "nav.managerDashboard", icon: Monitor },
  { key: "workflow", label: "nav.workflow", icon: Activity },
  { key: "oa", label: "nav.oa", icon: ClipboardCheck },
  { key: "safetyManager", label: "nav.safetyManager", icon: Shield },
  { key: "pdaCommMonitor", label: "nav.pdaCommMonitor", icon: Activity },
  { key: "ambassadorDashboard", label: "nav.ambassadorDashboard", icon: LayoutDashboard },
  { key: "effectivenessAmbassador", label: "nav.effectivenessAmbassador", icon: TrendingUp },
  { key: "efficiencyAmbassador", label: "nav.efficiencyAmbassador", icon: Zap },
  { key: "swiftnessAmbassador", label: "nav.swiftnessAmbassador", icon: Rocket },
  { key: "collaborationAmbassador", label: "nav.collaborationAmbassador", icon: Users },
];

/**
 * Module nav access per role — aligned with ROLE_PERMISSION_MATRIX (services/api/src/auth/index.ts).
 * - "trace" maps to traceability.view
 * - "hr" / "maintenance" are UI-only modules (no backend permission)
 * - "erp" is defined in MODULE_ACCESS_PERMISSION but has no UI tab
 */
/**
 * Modules that make up the full workspace — used by roles that own the whole
 * system (admin, plant_manager) so the sidebar never depends on a per-role list.
 */
export const FULL_MODULES: ModuleKey[] = [
  "dashboard", "pmc", "wms", "bom", "mes", "smtReelConsumption", "qms", "trace",
  "reports", "admin", "hr", "maintenance", "finance", "sales", "service",
  "procurement", "einvoice", "projects", "ai", "projectMgmt", "agents", "employee",
  "managerDashboard", "workflow", "oa", "andonBoard",
  "pdaUiDesigner", "managementUiDesigner", "safetyManager", "pdaCommMonitor",
  // Ambassador oversight pages: the sidebar group exists and the components
  // are live, so they must be in the grant list — previously no role listed
  // them and the whole group rendered empty for every user.
  "ambassadorDashboard", "effectivenessAmbassador", "efficiencyAmbassador",
  "swiftnessAmbassador", "collaborationAmbassador",
  // Hash-only surfaces (mobile check-in, manual-line 3D): granted to full-workspace
  // roles for deep links; intentionally absent from the desktop sidebar.
  "mobile", "manualLine3d",
];

export const roleModuleAccess: Record<string, ModuleKey[]> = {
  admin: FULL_MODULES,
  plant_manager: FULL_MODULES,
  management: ["dashboard", "reports", "trace", "finance", "sales", "service", "procurement", "einvoice", "hr", "ai", "managerDashboard", "workflow", "oa", "manualLine3d"],
  pmc: ["dashboard", "pmc", "bom", "trace", "mobile", "reports"],
  warehouse: ["dashboard", "wms", "trace", "mobile", "manualLine3d"],
  material_receiver: ["dashboard", "wms", "quality", "trace", "mobile"],
  iqc: ["dashboard", "wms", "quality", "qms", "mobile", "manualLine3d"],
  oqc: ["dashboard", "quality", "qms", "trace", "mes", "mobile", "manualLine3d"],
  scanner: ["dashboard", "mes", "mobile"],
  employee: ["dashboard", "employee", "mobile"],
  smt_operator: ["dashboard", "mes", "wms", "mobile", "team", "mobileleave", "manualLine3d"],
  quality: ["dashboard", "quality", "qms", "trace", "mobile", "manualLine3d"],
  rework: ["dashboard", "mes", "quality", "qms", "manualLine3d"],
  engineering: ["dashboard", "mes", "quality", "qms", "trace", "maintenance", "mobile"],
  line_manager_smt: ["dashboard", "mes", "quality", "qms", "trace", "reports", "maintenance", "mobile", "manualLine3d"],
  line_manager_manual: ["dashboard", "mes", "quality", "qms", "trace", "reports", "maintenance", "mobile", "manualLine3d"],
  line_manager_auto: ["dashboard", "mes", "quality", "qms", "trace", "reports", "maintenance", "mobile", "manualLine3d"],
  production_transport: ["dashboard", "wms", "mes", "mobile"],
  finance: ["dashboard", "finance", "einvoice", "procurement", "reports", "trace"],
  purchasing: ["dashboard", "procurement", "wms", "reports", "trace"],
  customer_service: ["dashboard", "sales", "service", "reports"],
  hr_manager: ["dashboard", "hr", "employee", "reports", "workflow", "oa"],
  reports_admin: ["dashboard", "reports", "trace", "managerDashboard"],
  reports_viewer: ["dashboard", "reports"],
};
