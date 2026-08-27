import { lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, Suspense } from "react";

// Three.js components — isolated via React.lazy to prevent react-three-fiber
// React instance mismatch from corrupting the main app bundle
const LazyHrOrgChart = lazy(() => import("./hr/HrOrgChart").then(m => ({ default: m.HrOrgChart })));
const LazyFactory3D = lazy(() => import("./maintenance/Factory3D").then(m => ({ default: m.default })));
const LazyIctStationMonitor = lazy(() => import("./mes/IctStationMonitor").then(m => ({ default: m.IctStationMonitor })));
const LazyFctStationMonitor = lazy(() => import("./mes/FctStationMonitor").then(m => ({ default: m.FctStationMonitor })));
const LazyDepanelStationMonitor = lazy(() => import("./mes/DepanelStationMonitor").then(m => ({ default: m.DepanelStationMonitor })));
const LazyPdaStationMonitor = lazy(() => import("./mes/PdaStationMonitor").then(m => ({ default: m.PdaStationMonitor })));
const LazyQrBindingStationMonitor = lazy(() => import("./mes/QrBindingStationMonitor").then(m => ({ default: m.QrBindingStationMonitor })));
const LazyAgingCabStationMonitor = lazy(() => import("./mes/AgingCabStationMonitor").then(m => ({ default: m.AgingCabStationMonitor })));
const LazyOuterBoxBindingStationMonitor = lazy(() => import("./mes/OuterBoxBindingStationMonitor").then(m => ({ default: m.OuterBoxBindingStationMonitor })));
const LazySupersonicStationMonitor = lazy(() => import("./mes/SupersonicStationMonitor").then(m => ({ default: m.SupersonicStationMonitor })));
const LazyManualLineDashboard = lazy(() => import("./mes/ManualLineDashboard").then(m => ({ default: m.ManualLineDashboard })));
const LazySmtLineDashboard = lazy(() => import("./mes/SmtStationAgents3d").then(m => ({ default: m.SmtStationAgents3d })));
const LazyWarehouseScene3d = lazy(() => import("./mes/WarehouseScene3d").then(m => ({ default: m.WarehouseScene3d })));
const LazyProductWarehouseScene3d = lazy(() => import("./mes/ProductWarehouseScene3d").then(m => ({ default: m.ProductWarehouseScene3d })));
const LazyAoiStationMonitor = lazy(() => import("./mes/AoiStationMonitor").then(m => ({ default: m.AoiStationMonitor })));
const LazyAssemblyAteStationMonitor = lazy(() => import("./mes/AssemblyAteStationMonitor").then(m => ({ default: m.AssemblyAteStationMonitor })));
const LazyHighVoltAteStationMonitor = lazy(() => import("./mes/HighVoltAteStationMonitor").then(m => ({ default: m.HighVoltAteStationMonitor })));
const LazyPackingAteStationMonitor = lazy(() => import("./mes/PackingAteStationMonitor").then(m => ({ default: m.PackingAteStationMonitor })));
const LazyWarehouseStoragePage = lazy(() => import("./mes/MesWarehouseStoragePage").then(m => ({ default: m.MesWarehouseStoragePage })));
const LazyFactoryLinesTree = lazy(() => import("./mes/FactoryLinesTree").then(m => ({ default: m.FactoryLinesTree })));
import { AoiStation } from "./aoi/AoiStation";
import { FctStation } from "./quality/stations/FctStation";
import { AutoLineStation } from "./quality/stations/AutoLineStation";
import { authApi, authStorage, wmsApi, pmcApi, bomApi, mesApi, qualityApi } from "./api";
import {
  PanelLeft,
  PanelLeftClose,
  ArrowRight,
  Barcode,
  Bell,
  Box,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Factory,
  Gauge,
  Languages,
  LineChart,
  PackageCheck,
  ScanBarcode,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Wallet,
  Wrench,
  Briefcase,
  Activity,
  Headphones,
  FolderTree,
  Bot,
  Monitor,
  TrendingUp,
  Zap,
  Rocket,
  LayoutDashboard,
  FileText,
  Receipt,
  Palette,
} from "lucide-react";
import type { CustomerPo, FactoryLine, InspectionRecord, Locale, MaterialLot, StatusTone, TraceEvent, WorkOrder } from "../../../packages/shared-types/src/factory";

import type { TranslationKey } from "./i18n";
import { AuthSignIn, type SignInResult } from "./auth/AuthSignIn";
import { localeLabels, locales, t, text } from "./i18n";
import { customerPos, demoDirectory, feederBindings, lines, materialLots, metrics, roleMatrix, traceEvents, workOrders, supplementaryMaterials, financeInvoices, payments, costSummaries, salesQuotes, salesOrders, quoteConversions, serviceTickets, rmaRequests, rmaRepairRecords } from "./data";
import { AdminLineManagement } from "./admin/AdminLineManagement";
import { UserAuthorizationManager } from "./admin/UserAuthorizationManager";
import { PdaAccessConfiguration } from "./admin/PdaAccessConfiguration";
import { StationDatabaseManagement } from "./admin/StationDatabaseManagement";
import type { WmsTabKey } from "./wms";
import { QmsApp } from "./qms";
import { WmsNonIqcClosedLoop } from "./wms/WmsNonIqcClosedLoop";
import { MobileCheckin } from "./MobileCheckin";
import MobileLeave from "./MobileLeave";
import { default as EmergencyManagement } from './maintenance/EmergencyManagement';
import { TeamLeaderApp } from "./TeamLeaderApp";
import { GroupLeaderPda } from "./GroupLeaderPda";
import { PdaUiDesigner } from "./PdaUiDesigner";
import { ManagementUiDesigner } from "./ManagementUiDesigner";
import { SmtReelConsumptionPage } from "./mes/SmtReelConsumptionPage";
import { wmsMenuGroups, wmsTabTranslationKeys, WmsDashboard, WmsMenuPage, WmsIncoming, WmsMaterialReceiving, WmsMaterialLoading, WmsSmtClosedLoop, WmsNonSmtClosedLoop, WmsFinishedGoods, WmsReceiving, WmsReturnReceiving, WmsSupplierReturn, WmsSalesReturn, WmsIqc, WmsIqcClosedLoop, WmsIqcDefectLoop, WmsIqcInspection, WmsIqcReport, WmsIqcStandards, WmsSupplierKpi, WmsQualityTrend, WmsPutAway, WmsInventory, WmsPicking, WmsIssue, WmsTransactions, WmsSmartShelfTester, WmsShelfApiTester, WmsShelfSimulator, WmsShelfOperations, WmsSqlConsole, WmsRackSimulator, WmsSmartRackManager, SmartRackWorkflow, WmsMaterialMaster, WmsLocationManagement, WmsBatchManagement, WmsBasicData, WmsCycleCount, WmsTransferAdjust, WmsExpiryControl, WmsFifoMonitor, WmsTraceability, WmsMsd, WmsSolderPaste, WmsAuxiliary, WmsCollaborationDashboard, WmsClosureDashboard, WmsLifecycleDashboard, WmsFifoSimulation, WmsPdaReceiving, WmsPdaReceivingMobile, WmsPdaConsumption, WmsPdaCycleCount, WmsPdaIqc, WmsPdaHistory, WmsInboundOrders, WmsOutboundOrders, WmsRequisitions, WmsReturnSlips, WmsReplenishments, WmsSyncHealth, WmsProductionInbound, WmsProductionOutbound } from "./wms";
import { WmsMaterialBarcodeLoop } from "./wms/WmsMaterialBarcodeLoop";
import { WmsIqcFlowPages } from "./wms/WmsIqcFlowPages";
import { QmsDashboard, QmsOqcBatches, QmsNgCases, QmsEightD } from "./qms";
import type { PmcTabKey } from "./pmc";
import { pmcTabKeys, pmcTabTranslationKeys, PmcDashboard, PmcWorkOrderList, PmcWorkOrderDetail, PmcCreateWorkOrder,
  PmcProductionReporting, PmcMaterialIssue, PmcWipTracking, PmcAlertDashboard,
  PmcGanttView, PmcAndonBoard, PmcStationCheckin, PmcWoFreeze, PmcWoQualityReport,
  PmcAlertHistory,
  PmcNgReview,
  PmcCompensationApproval,
  PmcPoList, PmcCustomerProductMaster, PmcMaterialStatus, PmcSupplementaryMaterial, BomList, BomHistory, BomPatrol, BomAlerts, BomAiChat, BomChangeControl, bomTabKeys, bomTabTranslationKeys, type BomTabKey,
  PmcPatrolDashboard, PmcDeliveryWatch, PmcClosedLoop } from "./pmc";
import type { HrTabKey } from "./hr";
import { hrTabKeys, hrTabTranslationKeys, HrDashboard, HrGovernance, HrPayroll, HrEmployeeList, HrProfileUpdates, HrAttendance, HrLeave, HrPerformance, HrPromotionAppraisals, HrSalary, HrTraining, HrLifecycle, HrAttendanceStats, HrSwap, HrOtPay, HrSkillRating, HrTeamwork, HrRewardPrograms, HrGrievanceCases, HrPdaDomains } from "./hr";
import type { MaintenanceTabKey } from "./maintenance";
import { maintenanceTabKeys, maintenanceTabTranslationKeys, MaintenanceDashboard, MaintenanceEquipmentList, MaintenanceEquipmentDetail, MaintenancePlan, MaintenanceHistory, MaintenanceCard, InspectionPlan, InspectionRecords, PmSchedule, PmExecution, FaultReportList, SparePartsWarehouse, SupplierComms, EquipmentChecklists, MaintenanceWorkOrders, ConsumablesManagement, FixtureManagement } from "./maintenance";
import AndonBoard from './maintenance/AndonBoard';
import EquipmentHealth from './maintenance/EquipmentHealth';
import PdaEquipment from './maintenance/PdaEquipment';
import ExcelImport from './maintenance/ExcelImport';
import EquipmentReports from './maintenance/EquipmentReports';
import EquipmentBom from './maintenance/EquipmentBom';
import DashboardCarousel from './maintenance/DashboardCarousel';
import { ReportsDashboard } from "./reports";
import type { MesTabKey } from "./mes";
import { mesThemes } from "./mes";
import { getMesContribution } from "./mes";
import { mesGroups, mesTabKeys, mesTabTranslationKeys, ProcessFlow, StationWorkflow, ProcessDocumentation, ProcessManagement, FoolProofRules, FeederPreparationMapping, FirstArticleInspectionPage, MaterialVerificationPage, RetestRules, StagnationTracking, ScrapRegistration, TraceabilitySearch, StationOperator, TimeControl, MaterialLoadingDashboard, MaterialLoadingWorkflow, MaterialDispatchBoard, StationTypeList, StationMaster, RepairWorkflow, ProductionLineDashboard, AutoLineDashboard, ReworkDashboard, NgRevivalManagement, NgRealtimeTracking, NgRouteConfigurator, NgManagementPage, NgClosedLoopBoard, PassShortageManagement, PackagingBoxManagement, QrWorkOrderManagement, PdaLoadDashboard, MesManagerConsole, MesOverview, JourneySearch, BomReconciliation, PdaDeviceManagement, PdaUnifiedScanning, PdaOnlineMonitor, MaterialRollQrGenerator, SmtLoading3dSimulator, SmtMaterialBindingTable } from "./mes";
import { AiChat } from "./ai/AiChat";
import { SmtMaterialExemptions } from "./mes/SmtMaterialExemptions";
import { SmtMaterialLoadingPage } from "./mes/SmtMaterialLoadingPage";
import { AiPatrolChat } from "./ai/AiPatrolChat";
import { qualityPatrol, maintenancePatrol, mesPatrol, hrPatrol } from "./ai/patrol";
import { Projects } from "./projects/Projects";
import { ProjectMgmt } from "./project-mgmt";
import { AgentsModule } from "./agents/AgentsModule";
import { EmployeePanel } from "./employee/EmployeePanel";
import { ManagerDashboard } from "./manager-dashboard/ManagerDashboard";
import { WorkflowDashboard } from "./workflow/WorkflowDashboard";
import { ProcurementDashboard, ProcurementContractList, ProcurementContractDetail, ProcurementPoList, ProcurementRequisitionList, ProcurementRfqList } from "./procurement";
import { EinvoiceDashboard, EinvoiceInvoiceList, EinvoiceInvoiceDetail, EinvoiceConfigPanel } from "./einvoice";
import { SafetyManager } from "./manager-dashboard/SafetyManager";
import { PdaCommMonitor } from "./manager-dashboard/PdaCommMonitor";
import { AmbassadorDashboard } from "./manager-dashboard/AmbassadorDashboard";
import { EffectivenessAmbassador } from "./manager-dashboard/EffectivenessAmbassador";
import { EfficiencyAmbassador } from "./manager-dashboard/EfficiencyAmbassador";
import { SwiftnessAmbassador } from "./manager-dashboard/SwiftnessAmbassador";
import { CollaborationAmbassador } from "./manager-dashboard/CollaborationAmbassador";
import { OaModule } from "./oa";
import { User } from "lucide-react";

type ModuleKey = "smtLine3d" | "mobile" | "smtReelConsumption" | "groupLeaderPda" | "pdaUiDesigner" | "managementUiDesigner" | "dashboard" | "pmc" | "wms" | "mes" | "quality" | "trace" | "reports" | "admin" | "hr" | "maintenance" | "ai" | "finance" | "sales" | "service" | "bom" | "andonBoard" | "projects" | "projectMgmt" | "agents" | "employee" | "managerDashboard" | "safetyManager" | "pdaCommMonitor" | "ambassadorDashboard" | "effectivenessAmbassador" | "efficiencyAmbassador" | "swiftnessAmbassador" | "collaborationAmbassador" | "procurement" | "einvoice" | "workflow" | "oa" | "manualLine3d" | "pdaAgent3d" | "aoiAgent3d" | "ictAgent3d" | "fctAgent3d" | "assemblyAteAgent3d" | "supersonicAgent3d" | "agingCabAgent3d" | "highVoltAteAgent3d" | "packingAteAgent3d" | "outerBoxBindingAgent3d" | "depanelAgent3d" | "qrbindingAgent2d" | "qrbindingAgent3d" | "mesManagerConsole" | "team" | "mobileleave" | "dashboard" | "qms";

const modules: Array<{ key: ModuleKey; label: TranslationKey; icon: typeof Gauge }> = [
  { key: "dashboard", label: "nav.dashboard", icon: Gauge },
  { key: "pmc", label: "nav.pmc", icon: CalendarClock },
  { key: "wms", label: "nav.wms", icon: Boxes },
  { key: "bom", label: "nav.bom", icon: ClipboardList },
  { key: "mes", label: "nav.mes", icon: Factory },
  { key: "smtReelConsumption", label: "nav.mes", icon: Activity },
  { key: "pdaUiDesigner", label: "nav.pdaUiDesigner", icon: LayoutDashboard },
  { key: "managementUiDesigner", label: "nav.managementUiDesigner", icon: Palette },
  { key: "andonBoard", label: "nav.andon", icon: Activity },
  { key: "quality", label: "nav.quality", icon: ClipboardCheck },
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

const moduleGroups: Array<{ label: TranslationKey; items: ModuleKey[] }> = [
  { label: "nav.group.operations", items: ["dashboard", "pmc", "wms", "bom", "managerDashboard", "workflow", "safetyManager", "pdaCommMonitor", "ambassadorDashboard", "effectivenessAmbassador", "efficiencyAmbassador", "swiftnessAmbassador", "collaborationAmbassador"] },
  { label: "nav.group.execution", items: ["mes", "smtReelConsumption", "pdaUiDesigner", "managementUiDesigner", "andonBoard", "quality", "qms", "trace"] },
  { label: "nav.group.control", items: ["reports", "sales", "service", "finance", "procurement", "einvoice", "admin", "hr", "maintenance", "projects", "ai", "agents", "oa"] },
  { label: "nav.group.projects", items: ["projectMgmt"] },
  { label: "nav.group.employee", items: ["employee"] },
];

const moduleSubtitleKeys: Partial<Record<ModuleKey, TranslationKey>> = {
  dashboard: "page.dashboard",
  pmc: "page.pmc",
  wms: "page.wms",
  bom: "page.bom",
  employee: "page.employee",
  mes: "page.mes",
  quality: "page.quality",
  trace: "page.trace",
  reports: "page.reports",
  sales: "page.sales",
  service: "page.service",
  finance: "page.finance",
  procurement: "page.procurement",
  einvoice: "page.einvoice",
  admin: "page.admin",
  hr: "page.hr",
  maintenance: "page.maintenance",
  ai: "page.ai",
  projects: "page.projects",
  projectMgmt: "page.projectMgmt",
  andonBoard: "page.andon",
  agents: "page.agents",
  managerDashboard: "page.managerDashboard",
  workflow: "page.workflow",
  safetyManager: "page.safetyManager",
  pdaCommMonitor: "page.pdaCommMonitor",
  ambassadorDashboard: "page.ambassadorDashboard",
  effectivenessAmbassador: "page.effectivenessAmbassador",
  efficiencyAmbassador: "page.efficiencyAmbassador",
  swiftnessAmbassador: "page.swiftnessAmbassador",
  collaborationAmbassador: "page.collaborationAmbassador",
  oa: "page.oa",
};

const flowSteps: Array<{ key: TranslationKey; icon: typeof Gauge; tone: StatusTone }> = [
  { key: "buttons.receive", icon: Truck, tone: "info" },
  { key: "buttons.iqc", icon: ShieldCheck, tone: "warning" },
  { key: "buttons.putAway", icon: Box, tone: "ok" },
  { key: "buttons.pick", icon: Boxes, tone: "info" },
  { key: "buttons.issue", icon: ArrowRight, tone: "ok" },
  { key: "buttons.bind", icon: Barcode, tone: "info" },
  { key: "buttons.output", icon: Factory, tone: "ok" },
  { key: "buttons.repair", icon: Wrench, tone: "warning" },
  { key: "nav.trace", icon: Search, tone: "ok" },
];

const lineStatusLabelMap: Record<FactoryLine["status"], TranslationKey> = {
  running: "status.running",
  changeover: "status.changeover",
  down: "status.down",
  idle: "status.idle",
};

const workOrderStatusLabelMap: Record<NonNullable<WorkOrder["status"]>, TranslationKey> = {
  draft: "status.draft",
  released: "status.released",
  running: "status.running",
  hold: "status.hold",
  closed: "status.closed",
  voided: "status.voided",
};

const iqcStatusLabelMap: Record<MaterialLot["iqcStatus"], TranslationKey> = {
  pending: "iqc.pending",
  hold: "iqc.hold",
  released: "iqc.released",
  rejected: "iqc.rejected",
};

const inspectionResultLabelMap: Record<NonNullable<InspectionRecord["result"]>, TranslationKey> = {
  PASS: "status.pass",
  FAIL: "status.fail",
  REPAIRING: "status.repairing",
  CLOSED: "status.closed",
};

const traceTypeLabelMap: Record<NonNullable<TraceEvent["type"]>, TranslationKey> = {
  po: "trace.type.po",
  work_order: "trace.type.workOrder",
  receiving: "trace.type.receiving",
  iqc: "trace.type.iqc",
  storage: "trace.type.storage",
  picking: "trace.type.picking",
  line_issue: "trace.type.lineIssue",
  feeder_binding: "trace.type.feederBinding",
  station: "trace.type.station",
  inspection: "trace.type.inspection",
  repair: "trace.type.repair",
  finished_goods: "trace.type.finishedGoods",
  shipment: "trace.type.shipment",
};

const traceStatusLabelMap: Record<string, TranslationKey> = {
  confirmed: "status.confirmed",
  released: "status.released",
  received: "status.received",
  stored: "status.stored",
  picked: "status.picked",
  issued: "status.issued",
  bound: "status.bound",
  mounted: "status.mounted",
  packed: "status.packed",
  shipped: "status.shipped",
  fail: "status.fail",
  closed: "status.closed",
};

const riskLabelMap: Record<NonNullable<CustomerPo["risk"]>, TranslationKey> = {
  low: "risk.low",
  medium: "risk.medium",
  high: "risk.high",
};

function toneForStatus(status: string): StatusTone {
  if (
    status === "running" ||
    status === "released" ||
    status === "PASS" ||
    status === "CLOSED" ||
    status === "confirmed" ||
    status === "received" ||
    status === "stored" ||
    status === "picked" ||
    status === "issued" ||
    status === "bound" ||
    status === "mounted" ||
    status === "packed" ||
    status === "shipped" ||
    status === "approved"
  ) {
    return "ok";
  }
  if (status === "changeover" || status === "pending" || status === "hold" || status === "REPAIRING" || status === "draft") {
    return "warning";
  }
  if (status === "down" || status === "FAIL" || status === "rejected" || status === "fail" || status === "blocked") {
    return "danger";
  }
  return "info";
}

function toneForRisk(risk: CustomerPo["risk"]): StatusTone {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "ok";
}

function Badge({ tone, children, title }: { tone: StatusTone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title ?? (typeof children === "string" ? children : undefined)}>
      {children}
    </span>
  );
}

function Progress({ value, title }: { value: number; title?: string }) {
  return (
    <div className="progress" aria-label={title ?? `${Math.round(value)}%`} title={title ?? `${Math.round(value)}%`}>
      <span style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  trend,
  tone,
}: {
  label: string;
  value: string;
  trend: string;
  tone: StatusTone;
}) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <Badge tone={tone}>{trend}</Badge>
    </article>
  );
}

function SurfacePanel({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <section className="surface-panel" style={style}>{children}</section>;
}

function TableShell({ children }: { children: ReactNode }) {
  return <div className="table-shell">{children}</div>;
}

/**
 * Module nav access per role — aligned with ROLE_PERMISSION_MATRIX (services/api/src/auth/index.ts).
 * - "trace" maps to traceability.view
 * - "hr" / "maintenance" are UI-only modules (no backend permission)
 * - "erp" is defined in MODULE_ACCESS_PERMISSION but has no UI tab
 */
const roleModuleAccess: Record<string, ModuleKey[]> = {
  pmc: ["dashboard", "pmc", "bom", "trace", "mobile"],
  warehouse: ["dashboard", "wms", "trace", "mobile", "manualLine3d"],
  iqc: ["dashboard", "wms", "quality", "qms", "mobile", "manualLine3d"],
  scanner: ["dashboard", "mes", "mobile"],
  employee: ["dashboard", "employee", "mobile"],
  smt_operator: ["dashboard", "mes", "wms", "mobile", "team", "mobileleave", "manualLine3d"],
  quality: ["dashboard", "quality", "qms", "trace", "mobile", "manualLine3d"],
  engineering: ["dashboard", "mes", "quality", "qms", "trace", "maintenance", "mobile"],
  admin: ["dashboard", "pmc", "wms", "bom", "mes", "quality", "qms", "trace", "reports", "admin", "hr", "mobile", "maintenance", "finance", "sales", "service", "procurement", "einvoice", "projects", "ai", "projectMgmt", "agents", "employee", "managerDashboard", "workflow", "oa", "manualLine3d"],
  management: ["dashboard", "reports", "trace", "finance", "sales", "service", "procurement", "einvoice", "hr", "ai", "managerDashboard", "workflow", "oa", "manualLine3d"],
};

// ── Heartbeat / System Health ─────────────────────────────────────

function Heartbeat() {
  const [status, setStatus] = useState<"ok" | "down" | "checking">("checking");
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    try {
      const res = await fetch("http://127.0.0.1:8080/health");
      const data = await res.json();
      if (mountedRef.current) setStatus(data.ok ? "ok" : "down");
    } catch {
      if (mountedRef.current) setStatus("down");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    check();
    const interval = setInterval(check, 30_000);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [check]);

  const dotColor = status === "ok" ? "var(--ok)" : status === "down" ? "var(--danger)" : "var(--warn)";
  const label = status === "ok" ? "API OK" : status === "down" ? "API Down" : "Checking...";

  return (
    <span className="heartbeat" title={label}>
      <span className="heartbeat-dot" style={{ backgroundColor: dotColor }} />
      <span className="heartbeat-label">{label}</span>
    </span>
  );
}

function Shell({
  active,
  setActive,
  locale,
  setLocale,
  currentUser,
  onSignOut,
  children,
}: {
  active: ModuleKey;
  setActive: (module: ModuleKey) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  currentUser: SignInResult;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const allowedModules = roleModuleAccess[currentUser.roleKey] ?? ["dashboard"];
  const visibleGroups = moduleGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((key) => allowedModules.includes(key)),
    }))
    .filter((g) => g.items.length > 0);

  // If current active module is not allowed, reset to dashboard
  if (!allowedModules.includes(active)) {
    setActive("dashboard");
  }

  const activeModule = modules.find((module) => module.key === active) ?? modules[0];
  const ActiveIcon = activeModule.icon;

  return (
    <div className={`app-shell${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      {sidebarOpen && (
      <aside className="sidebar">
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="icon-button"
            title={t("ui.sidebar.hide", locale)}
            onClick={() => setSidebarOpen(false)}
            style={{ color: "#eef8fa" }}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
        <div className="brand">
          <Factory size={30} />
          <div>
            <strong>{t("app.title", locale)}</strong>
            <span>{t("app.subtitle", locale)}</span>
          </div>
        </div>

        <div className="sidebar-status">
          <div>
            <span>{t("app.plant", locale)}</span>
            <strong>VN-01</strong>
          </div>
          <div>
            <span>{t("app.shift", locale)}</span>
            <strong>Day / A</strong>
          </div>
          <div>
            <span>{t("app.sync", locale)}</span>
            <strong>06:14</strong>
          </div>
        </div>

        <div className="nav-groups">
          {visibleGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{t(group.label, locale)}</span>
              <div className="module-nav">
                {group.items.map((key) => {
                  const meta = modules.find((module) => module.key === key)!;
                  const Icon = meta.icon;
                  const isActive = active === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={isActive ? "active" : ""}
                      title={`${t(meta.label, locale)} - ${t("ui.moduleSwitch", locale)}`}
                      onClick={() => setActive(key)}
                    >
                      <Icon size={17} />
                      <span>{t(meta.label, locale)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-status" style={{ marginTop: "auto", borderTop: "1px solid rgba(238,248,250,0.15)", paddingTop: 12 }}>
          <div>
            <span style={{ fontSize: 11, opacity: 0.6 }}>{currentUser.roleKey.toUpperCase()}</span>
            <strong style={{ fontSize: 13 }}>{currentUser.displayName}</strong>
          </div>
        </div>
      </aside>
      )}

      <main className="workspace">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              className="icon-button"
              title={sidebarOpen ? t("ui.sidebar.hide", locale) : t("ui.sidebar.show", locale)}
              onClick={() => setSidebarOpen((v) => !v)}
            >
              {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
            </button>
            <div>
              <h1>{t(activeModule.label, locale)}</h1>
              <p>{t(moduleSubtitleKeys[activeModule.key] ?? "page.dashboard", locale)}</p>
            </div>
          </div>
          <div className="page-tools">
            <Badge tone="info" title={t("ui.moduleSwitch", locale)}>
              <ActiveIcon size={14} />
              <span>{t(activeModule.label, locale)}</span>
            </Badge>
            <Badge tone="ok" title={t("app.liveData", locale)}>{t("app.liveData", locale)}</Badge>
            <Heartbeat />
            <label className="locale-switch">
              <Languages size={16} />
              <select value={locale} title={t("ui.languageSwitch", locale)} onChange={(event) => setLocale(event.target.value as Locale)}>
                {locales.map((item) => (
                  <option value={item} key={item}>
                    {localeLabels[item]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="icon-button" onClick={onSignOut} title={t("auth.signOut", locale)}>
              {t("auth.signOut", locale)}
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function Dashboard({ locale, setActive }: { locale: Locale; setActive: (module: ModuleKey) => void }) {
  const [summary, setSummary] = useState<{
    workOrders: { status: string; cnt: number }[];
    lines: { status: string; cnt: number }[];
    materialLots: { iqc_status: string; cnt: number }[];
    inspections: { result: string; cnt: number }[];
  } | null>(null);
  const [workOrders, setWorkOrders] = useState<{
    id: number; code: string; status: string; lineCode: string;
    productCode: string; poNumber: string | null; plannedQty: number; completedQty: number;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      wmsApi.getDashboardSummary(),
      pmcApi.getWorkOrders({ limit: 20 }),
    ]).then(([sumRes, woRes]) => {
      setSummary(sumRes);
      setWorkOrders(woRes.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="metric-grid">
          {[1, 2, 3, 4, 5].map((i) => (
            <article className="stat-card" key={i}>
              <span className="skeleton-text" style={{ width: "60%", height: 14, display: "block", borderRadius: 4, background: "var(--nav)", animation: "pulse 1.5s infinite" }} />
              <strong style={{ fontSize: 28, marginTop: 8, display: "block" }}>—</strong>
            </article>
          ))}
        </section>
      </div>
    );
  }

  const woByStatus = Object.fromEntries((summary?.workOrders ?? []).map((r) => [r.status, r.cnt]));
  const lineByStatus = Object.fromEntries((summary?.lines ?? []).map((r) => [r.status, r.cnt]));
  const lotByIqc = Object.fromEntries((summary?.materialLots ?? []).map((r) => [r.iqc_status, r.cnt]));
  const inspByResult = Object.fromEntries((summary?.inspections ?? []).map((r) => [r.result, r.cnt]));
  const activeLines = (lineByStatus["running"] ?? 0) + (lineByStatus["released"] ?? 0);
  const totalLines = Object.values(lineByStatus).reduce((s, v) => s + v, 0);
  const openLots = (lotByIqc["pending"] ?? 0) + (lotByIqc["hold"] ?? 0);
  const failInspections = (inspByResult["FAIL"] ?? 0) + (inspByResult["REPAIRING"] ?? 0);

  return (
    <div className="screen-stack">
      <section className="metric-grid">
        <StatCard label={t("dashboard.workOrderActive", locale) ?? "Active WOs"} value={String(woByStatus["running"] ?? 0)} trend={t("common.open", locale)} tone="info" />
        <StatCard label={t("dashboard.lineHealth", locale)} value={`${activeLines}/${totalLines}`} trend={t("common.open", locale)} tone={activeLines < totalLines ? "warning" : "ok"} />
        <StatCard label={t("dashboard.materials", locale)} value={String((lotByIqc["pending"] ?? 0) + (lotByIqc["hold"] ?? 0))} trend={t("section.queue", locale)} tone={openLots > 0 ? "warning" : "ok"} />
        <StatCard label={t("dashboard.qcOpen", locale)} value={String(failInspections)} trend={t("common.watch", locale)} tone={failInspections > 0 ? "danger" : "ok"} />
        <StatCard label={t("dashboard.totalLots", locale) ?? "Total Lots"} value={String(summary?.materialLots?.reduce((s, r) => s + r.cnt, 0) ?? 0)} trend={t("common.active", locale)} tone="info" />
      </section>

      <div className="content-grid two">
        <SurfacePanel>
          <SectionHeader title={t("dashboard.workOrders", locale)} subtitle={t("page.pmc", locale)} />
          <TableShell>
            <table>
              <thead>
                <tr>
                  <th>{t("common.workOrder", locale)}</th>
                  <th>{t("table.po", locale)}</th>
                  <th>{t("common.line", locale)}</th>
                  <th>{t("common.product", locale)}</th>
                  <th>{t("common.status", locale)}</th>
                  <th>{t("table.ready", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <strong>{order.code}</strong>
                    </td>
                    <td>{order.poNumber ?? "—"}</td>
                    <td>{order.lineCode}</td>
                    <td>{order.productCode}</td>
                    <td>
                      <Badge tone={toneForStatus(order.status)} title={t("ui.statusIndicator", locale)}>{t(workOrderStatusLabelMap[order.status as keyof typeof workOrderStatusLabelMap] ?? "status.draft", locale)}</Badge>
                    </td>
                    <td>
                      <Progress value={order.plannedQty > 0 ? (order.completedQty / order.plannedQty) * 100 : 0} title={t("ui.progress", locale)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </SurfacePanel>

        <SurfacePanel>
          <SectionHeader title={t("dashboard.urgentActions", locale)} subtitle={t("section.risk", locale)} />
          <div className="quick-action-grid">
            {[
              { key: "buttons.receive", icon: Truck, module: "wms" as ModuleKey },
              { key: "buttons.issue", icon: Boxes, module: "wms" as ModuleKey },
              { key: "buttons.bind", icon: Barcode, module: "mes" as ModuleKey },
              { key: "buttons.output", icon: Factory, module: "mes" as ModuleKey },
              { key: "buttons.inspect", icon: ShieldCheck, module: "quality" as ModuleKey },
              { key: "buttons.search", icon: Search, module: "trace" as ModuleKey },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button key={action.key} type="button" className="action-card" title={`${t(action.key as TranslationKey, locale)} - ${t("ui.quickAction", locale)}`} onClick={() => setActive(action.module)}>
                  <Icon size={18} />
                  <span>{t(action.key as TranslationKey, locale)}</span>
                  <ArrowRight size={16} />
                </button>
              );
            })}
          </div>
          <div className="status-stack">
            <div className="status-row">
              <span>{t("dashboard.materials", locale)}</span>
              <strong>{openLots}</strong>
              <Badge tone={openLots > 0 ? "warning" : "ok"} title={t("ui.statusIndicator", locale)}>{t("section.queue", locale)}</Badge>
            </div>
            <div className="status-row">
              <span>{t("dashboard.qcOpen", locale)}</span>
              <strong>{failInspections}</strong>
              <Badge tone={failInspections > 0 ? "danger" : "ok"} title={t("ui.statusIndicator", locale)}>{t("nav.quality", locale)}</Badge>
            </div>
          </div>
        </SurfacePanel>
      </div>

      <div className="content-grid two">
        <SurfacePanel>
          <SectionHeader title={t("section.live", locale)} subtitle={t("page.dashboard", locale)} />
          <div className="status-stack">
            {Object.entries(lineByStatus).map(([status, cnt]) => (
              <div className="status-row" key={status}>
                <span>{status}</span>
                <strong>{cnt}</strong>
                <Badge tone={toneForStatus(status)}>{status}</Badge>
              </div>
            ))}
          </div>
        </SurfacePanel>

        <SurfacePanel>
          <SectionHeader title={t("section.timeline", locale)} subtitle={t("trace.subtitle", locale)} />
          <div className="status-stack">
            <div className="status-row">
              <span>{t("wms.pendingReceive", locale)}</span>
              <strong>{lotByIqc["pending"] ?? 0}</strong>
              <Badge tone="info">{t("iqc.pending", locale)}</Badge>
            </div>
            <div className="status-row">
              <span>{t("iqc.hold", locale)}</span>
              <strong>{lotByIqc["hold"] ?? 0}</strong>
              <Badge tone="warning">{t("iqc.hold", locale)}</Badge>
            </div>
            <div className="status-row">
              <span>{t("iqc.released", locale)}</span>
              <strong>{lotByIqc["released"] ?? 0}</strong>
              <Badge tone="ok">{t("iqc.released", locale)}</Badge>
            </div>
            <div className="status-row">
              <span>{t("iqc.rejected", locale)}</span>
              <strong>{lotByIqc["rejected"] ?? 0}</strong>
              <Badge tone="danger">{t("iqc.rejected", locale)}</Badge>
            </div>
          </div>
        </SurfacePanel>
      </div>

      <SurfacePanel>
        <SectionHeader title={t("section.flow", locale)} subtitle={t("page.dashboard", locale)} />
        <div className="flow">
          {flowSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <article className="flow-step" key={step.key}>
                <div className="flow-step-top">
                  <Icon size={18} />
                  <Badge tone={step.tone}>{index + 1}</Badge>
                </div>
                <strong>{t(step.key, locale)}</strong>
                <span>{index < flowSteps.length - 1 ? t(flowSteps[index + 1].key, locale) : t("trace.chain", locale)}</span>
              </article>
            );
          })}
        </div>
      </SurfacePanel>
    </div>
  );
}

function Pmc({ locale, permissions }: { locale: Locale; permissions: string[] }) {
  const [activeTab, setActiveTab] = useState<PmcTabKey>("dashboard");
  // Rule 6.1: Only roles with pmc.manage or pmc.create permission can create work orders
  const canCreate = permissions.includes("pmc.manage") || permissions.includes("pmc.create");
  const visibleTabs = pmcTabKeys.filter((k) => k !== "createWorkOrder" || canCreate);

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard": return <PmcDashboard locale={locale} />;
      case "workOrders": return <PmcWorkOrderList locale={locale} />;
      case "workOrderDetail": return <PmcWorkOrderDetail locale={locale} />;
      case "createWorkOrder": return <PmcCreateWorkOrder locale={locale} />;
      case "productionReporting": return <PmcProductionReporting locale={locale} />;
      case "materialIssue": return <PmcMaterialIssue locale={locale} />;
      case "wipTracking": return <PmcWipTracking locale={locale} />;
      case "alertDashboard": return <PmcAlertDashboard locale={locale} />;
      case "alertHistory": return <PmcAlertHistory locale={locale} />;
      case "ngReview": return <PmcNgReview locale={locale} />;
      case "compensationApproval": return <PmcCompensationApproval locale={locale} />;
      case "ganttView": return <PmcGanttView locale={locale} />;
      case "andonBoard": return <PmcAndonBoard locale={locale} />;
      case "stationCheckin": return <PmcStationCheckin locale={locale} />;
      case "woFreeze": return <PmcWoFreeze locale={locale} />;
      case "woQualityReport": return <PmcWoQualityReport locale={locale} />;
      case "poList": return <PmcPoList locale={locale} />;
      case "masterData": return <PmcCustomerProductMaster locale={locale} />;
      case "materialStatus": return <PmcMaterialStatus locale={locale} />;
      case "supplementaryMaterial": return <PmcSupplementaryMaterial locale={locale} />;
      case "bom": return <BomList locale={locale} />;
      case "patrolDashboard": return <PmcPatrolDashboard locale={locale} />;
      case "deliveryWatch": return <PmcDeliveryWatch locale={locale} />;
      case "closedLoop": return <PmcClosedLoop locale={locale} />;
      case "mobile": return <MobileCheckin locale={locale} />;
    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.pmc", locale)} subtitle={t("page.pmc", locale)} />
        <div className="toolbar">
          {visibleTabs.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={activeTab === tabKey ? "active" : ""}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(pmcTabTranslationKeys[tabKey], locale)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {renderActiveView()}
    </div>
  );
}

function Hr({ locale }: { locale: Locale }) {
  const requestedHrTab = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("hrTab") as HrTabKey | null
    : null;
  const [activeTab, setActiveTab] = useState<HrTabKey>(
    requestedHrTab && hrTabKeys.includes(requestedHrTab) ? requestedHrTab : "dashboard"
  );

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard": return <HrDashboard locale={locale} />;
      case "governance": return <HrGovernance locale={locale} />;
      case "payroll": return <HrPayroll locale={locale} />;
      case "employees": return <HrEmployeeList locale={locale} />;
      case "profileUpdates": return <HrProfileUpdates locale={locale} />;
      case "orgChart": return <LazyHrOrgChart locale={locale} />;
      case "attendance": return <HrAttendance locale={locale} />;
      case "leave": return <HrLeave locale={locale} />;
      case "performance": return <HrPerformance locale={locale} />;
      case "promotionAppraisals": return <HrPromotionAppraisals locale={locale} />;
      case "salary": return <HrSalary locale={locale} />;
      case "training": return <HrTraining locale={locale} />;
      case "lifecycle": return <HrLifecycle locale={locale} />;
      case "attStats": return <HrAttendanceStats locale={locale} />;
      case "swap": return <HrSwap locale={locale} />;
      case "otPay": return <HrOtPay locale={locale} />;
      case "skillRating": return <HrSkillRating locale={locale} />;
      case "teamwork": return <HrTeamwork locale={locale} />;
      case "rewardPrograms": return <HrRewardPrograms locale={locale} />;
      case "grievances": return <HrGrievanceCases locale={locale} />;
      case "pdaDomains": return <HrPdaDomains locale={locale} />;
    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.hr", locale)} subtitle={t("page.hr", locale)} />
        <div className="toolbar">
          {hrTabKeys.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={activeTab === tabKey ? "active" : ""}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(hrTabTranslationKeys[tabKey], locale)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {renderActiveView()}
    </div>
  );
}

// ── Finance MVP module ─────────────────────────────────────────────
import { FinanceMaterialEvents } from "./finance/FinanceMaterialEvents";
import { FinanceDashboard } from "./finance/FinanceDashboard";
import { FinanceInvoiceList } from "./finance/FinanceInvoiceList";
import { FinancePaymentList } from "./finance/FinancePaymentList";
import { FinanceCostReport } from "./finance/FinanceCostReport";
import { FinanceAgingReport } from "./finance/FinanceAgingReport";

type FinanceTabKey = "dashboard" | "invoices" | "payments" | "costReport" | "agingReport" | "materialEvents";

const financeTabKeys: FinanceTabKey[] = ["dashboard", "invoices", "payments", "costReport", "agingReport", "materialEvents"];
const financeTabTranslationKeys: Record<FinanceTabKey, TranslationKey> = {
  dashboard: "finance.dashboard",
  invoices: "finance.invoices",
  payments: "finance.payments",
  costReport: "finance.costReport",
  agingReport: "finance.agingReport",
  materialEvents: "finance.materialEvents",
};

function Finance({ locale, permissions }: { locale: Locale; permissions: string[] }) {
  const [activeTab, setActiveTab] = useState<FinanceTabKey>("dashboard");
  const canManage = permissions.includes("finance.manage");

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard":
        return <FinanceDashboard locale={locale} />;
      case "invoices":
        return <FinanceInvoiceList locale={locale} canManage={canManage} />;
      case "payments":
        return <FinancePaymentList locale={locale} />;
      case "costReport":
        return <FinanceCostReport locale={locale} canManage={canManage} />;
      case "agingReport":
        return <FinanceAgingReport locale={locale} />;
      case "materialEvents":
        return <FinanceMaterialEvents locale={locale} />;
    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader
          title={t("nav.finance", locale)}
          subtitle={t("page.finance", locale)}
          action={canManage ? <button className="action-button" type="button">{t("button.newPayment", locale)}</button> : null}
        />
        <div className="toolbar">
          {financeTabKeys.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={activeTab === tabKey ? "active" : ""}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(financeTabTranslationKeys[tabKey], locale)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {renderActiveView()}
    </div>
  );
}

function fmtCurrency(amount: number, currency: string): string {
  const formatted = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency}`;
}

// ── Procurement module ──────────────────────────────────────────────
type ProcurementTabKey = "dashboard" | "requisitions" | "rfqs" | "contracts" | "pos";
const procurementTabKeys: ProcurementTabKey[] = ["dashboard", "requisitions", "rfqs", "contracts", "pos"];
const procurementTabTranslationKeys: Record<ProcurementTabKey, TranslationKey> = {
  dashboard: "procurement.dashboard",
  requisitions: "procurement.purchaseOrders",
  rfqs: "procurement.purchaseOrders",
  contracts: "procurement.contracts",
  pos: "procurement.purchaseOrders",
};

function Procurement({ locale, permissions }: { locale: Locale; permissions: string[] }) {
  const [activeTab, setActiveTab] = useState<ProcurementTabKey>("dashboard");
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
  const canManage = permissions.includes("procurement.manage");
  const procurementTabLabel = (tabKey: ProcurementTabKey) => {
    if (tabKey === "requisitions") return locale === "zh-CN" ? "采购申请" : locale === "vi-VN" ? "Yêu cầu mua hàng" : "Purchase Requisitions";
    if (tabKey === "rfqs") return locale === "zh-CN" ? "询价与比价" : locale === "vi-VN" ? "Yêu cầu báo giá" : "RFQ & Quotes";
    if (tabKey === "pos") return locale === "zh-CN" ? "采购订单" : locale === "vi-VN" ? "Đơn mua hàng" : "Purchase Orders";
    return t(procurementTabTranslationKeys[tabKey], locale);
  };

  const renderView = () => {
    if (activeTab === "contracts" && selectedContractId !== null) {
      return <ProcurementContractDetail locale={locale} canManage={canManage} contractId={selectedContractId} onBack={() => setSelectedContractId(null)} />;
    }
    switch (activeTab) {
      case "dashboard":
        return <ProcurementDashboard locale={locale} />;
      case "contracts":
        return <ProcurementContractList locale={locale} canManage={canManage} onSelect={id => setSelectedContractId(id)} />;
      case "requisitions":
        return <ProcurementRequisitionList locale={locale} canManage={canManage} />;
      case "rfqs":
        return <ProcurementRfqList locale={locale} canManage={canManage} />;
      case "pos":
        return <ProcurementPoList locale={locale} canManage={canManage} />;
    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.procurement", locale)} subtitle={t("page.procurement", locale)} />
        <div className="toolbar">
          {procurementTabKeys.map(tabKey => (
            <button key={tabKey} type="button" className={activeTab === tabKey ? "active" : ""} onClick={() => { setActiveTab(tabKey); setSelectedContractId(null); }}>
              {procurementTabLabel(tabKey)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {renderView()}
    </div>
  );
}

// ── E-Invoice module ─────────────────────────────────────────────────
type EinvoiceTabKey = "dashboard" | "invoices" | "config";
const einvoiceTabKeys: EinvoiceTabKey[] = ["dashboard", "invoices", "config"];
const einvoiceTabTranslationKeys: Record<EinvoiceTabKey, TranslationKey> = {
  dashboard: "einvoice.dashboard",
  invoices: "einvoice.invoices",
  config: "einvoice.config",
};

function EInvoice({ locale, permissions }: { locale: Locale; permissions: string[] }) {
  const [activeTab, setActiveTab] = useState<EinvoiceTabKey>("dashboard");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const canManage = permissions.includes("einvoice.manage") || permissions.includes("einvoice.admin");

  const renderView = () => {
    if (activeTab === "invoices" && selectedInvoiceId !== null) {
      return <EinvoiceInvoiceDetail locale={locale} canManage={canManage} invoiceId={selectedInvoiceId} onBack={() => setSelectedInvoiceId(null)} />;
    }
    switch (activeTab) {
      case "dashboard":
        return <EinvoiceDashboard locale={locale} />;
      case "invoices":
        return <EinvoiceInvoiceList locale={locale} onSelect={id => setSelectedInvoiceId(id)} />;
      case "config":
        return <EinvoiceConfigPanel locale={locale} canManage={canManage} />;
    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.einvoice", locale)} subtitle={t("page.einvoice", locale)} />
        <div className="toolbar">
          {einvoiceTabKeys.map(tabKey => (
            <button key={tabKey} type="button" className={activeTab === tabKey ? "active" : ""} onClick={() => { setActiveTab(tabKey); setSelectedInvoiceId(null); }}>
              {t(einvoiceTabTranslationKeys[tabKey], locale)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {renderView()}
    </div>
  );
}

// ── Sales module ──────────────────────────────────────────────────
import { calculateFulfilledPercent } from "../../../packages/business-rules/src/sales";
import { salesApi, type SalesDashboardSummary, type SalesQuote, type SalesOrder, type SalesOrderLine, type QuoteToWorkOrderLink, type SalesOrderStatusHistory, type SalesOrderAction } from "./api/sales";

type SalesTabKey = "dashboard" | "quotes" | "orders" | "conversion" | "campaigns";
const salesTabKeys: SalesTabKey[] = ["dashboard", "quotes", "orders", "conversion", "campaigns"];
const salesTabTranslationKeys: Record<SalesTabKey, TranslationKey> = {
  dashboard: "sales.dashboard",
  quotes: "sales.quotes",
  orders: "sales.orders",
  conversion: "sales.conversion",
  campaigns: "sales.campaigns",
};

function Sales({ locale, permissions }: { locale: Locale; permissions: string[] }) {
  const [activeTab, setActiveTab] = useState<SalesTabKey>("dashboard");
  const [dashSummary, setDashSummary] = useState<SalesDashboardSummary | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const canManage = permissions.includes("sales.manage");

  useEffect(() => {
    if (activeTab === "dashboard") {
      salesApi.getDashboardSummary()
        .then(r => setDashSummary(r))
        .catch(() => {});
    }
  }, [activeTab]);

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard":
        return (
          <SurfacePanel>
            <SectionHeader title={t("sales.dashboard", locale)} subtitle={t("page.sales", locale)} />
            {dashSummary ? (
              <section className="metric-grid">
                <StatCard label={t("sales.openOrders", locale) ?? "Open Orders"} value={String(dashSummary.openSOs)} trend={t("common.count", locale) ?? "count"} tone="info" />
                <StatCard label={t("sales.openOrderValue", locale) ?? "Open Order Value"} value={fmtCurrency(dashSummary.openSOValue, "USD")} trend={t("section.queue", locale)} tone="info" />
                <StatCard label={t("sales.pendingQuotes", locale) ?? "Pending Quotes"} value={String(dashSummary.pendingQuotes)} trend={t("section.queue", locale)} tone="warning" />
                <StatCard label={t("sales.revenueThisMonth", locale) ?? "Revenue (Month)"} value={fmtCurrency(dashSummary.monthlyRevenue, "USD")} trend={t("common.active", locale)} tone="ok" />
              </section>
            ) : (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Loading...</div>
            )}
          </SurfacePanel>
        );
      case "quotes":
        return <SalesQuoteList locale={locale} canManage={canManage} />;
      case "orders":
        return selectedId != null
          ? <SalesOrderDetail id={selectedId} locale={locale} canManage={canManage} onBack={() => setSelectedId(null)} />
          : <SalesOrderList locale={locale} canManage={canManage} onSelect={setSelectedId} />;
      case "conversion":
        return <SalesConversionReport locale={locale} />;
      case "campaigns":
        return <SalesCampaignsPlaceholder locale={locale} />;
    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader
          title={t("nav.sales", locale)}
          subtitle={t("page.sales", locale)}
          action={canManage ? <button className="action-button" type="button">{t("button.newQuote", locale)}</button> : null}
        />
        <div className="toolbar">
          {salesTabKeys.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={activeTab === tabKey ? "active" : ""}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(salesTabTranslationKeys[tabKey], locale)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {renderActiveView()}
    </div>
  );
}

function SalesQuoteList({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const [items, setItems] = useState<SalesQuote[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    salesApi.listQuotes({ limit: 200 })
      .then(r => { setItems(r.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <SurfacePanel>
      <SectionHeader
        title={t("sales.quotes", locale)}
        subtitle={t("page.sales", locale)}
        action={canManage ? <button className="action-button" type="button">{t("button.newQuote", locale)}</button> : null}
      />
      {loading ? (
        <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>暂无数据</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("sales.quoteNo", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.party", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.amount", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("sales.validUntil", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("common.status", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 12px" }}><strong>{q.quoteNo}</strong></td>
                <td style={{ padding: "8px 12px" }}>{q.customerCode} · {q.customerNameZh}</td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}><strong>{fmtCurrency(q.totalAmount, q.currency)}</strong></td>
                <td style={{ padding: "8px 12px" }}>{q.validUntil}</td>
                <td style={{ padding: "8px 12px" }}><span className={"badge tone-" + toneForStatus(q.status)}>{q.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SurfacePanel>
  );
}

function SalesOrderList({ locale, canManage, onSelect }: { locale: Locale; canManage: boolean; onSelect: (id: number) => void }) {
  const [items, setItems] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    salesApi.listOrders({ limit: 200 })
      .then(r => { setItems(r.items ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <SurfacePanel>
      <SectionHeader
        title={t("sales.orders", locale)}
        subtitle={t("page.sales", locale)}
        action={canManage ? <button className="action-button" type="button">{t("button.newOrder", locale)}</button> : null}
      />
      {loading ? (
        <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>暂无数据</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("sales.soNo", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.party", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("table.amount", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("sales.fulfilledPercent", locale)}</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{t("common.status", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => {
              const fulfilledPct = o.status === "fulfilled" ? 100 : o.status === "open" ? 0 : 50;
              return (
                <tr key={o.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => onSelect(o.id)}>
                  <td style={{ padding: "8px 12px" }}><strong>{o.soNo}</strong></td>
                  <td style={{ padding: "8px 12px" }}>{o.customerCode} · {o.customerNameZh}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}><strong>{fmtCurrency(o.totalAmount, o.currency)}</strong></td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>
                    <span title={`${fulfilledPct}%`}>{fulfilledPct}%</span>
                  </td>
                  <td style={{ padding: "8px 12px" }}><span className={"badge tone-" + toneForStatus(o.status)}>{o.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SurfacePanel>
  );
}

function SalesOrderDetail({ id, locale, canManage, onBack }: { id: number; locale: Locale; canManage: boolean; onBack: () => void }) {
  const L = (zh: string, en: string, vi: string) =>
    locale === "zh-CN" ? zh : locale === "vi-VN" ? vi : en;

  const [so, setSo] = useState<SalesOrder & { lines: SalesOrderLine[]; woLinks: QuoteToWorkOrderLink[] } | null>(null);
  const [history, setHistory] = useState<SalesOrderStatusHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<SalesOrderAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([salesApi.getOrder(id), salesApi.getHistory(id)])
      .then(([o, h]) => { setSo(o); setHistory(h.history ?? []); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  };

  useEffect(() => { load(); }, [id]);

  const nextActions = (status: string): SalesOrderAction[] => {
    switch (status) {
      case "open": return ["confirm", "cancel"];
      case "confirmed": return ["release", "cancel"];
      case "released":
      case "in_production":
      case "ready_to_ship": return ["ship"];
      case "shipped": return ["deliver"];
      case "delivered": return ["invoice"];
      case "invoiced": return ["pay"];
      case "paid": return ["close"];
      default: return [];
    }
  };

  const runAction = async (action: SalesOrderAction) => {
    if (!so) return;
    if (action === "cancel") {
      const reason = window.prompt(L("取消原因（必填）", "Cancel reason (required)", "Lý do hủy (bắt buộc)"));
      if (!reason) return;
      setBusy("cancel");
      try { await salesApi.cancel(so.id, reason); load(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setBusy(null); }
      return;
    }
    setBusy(action);
    try {
      if (action === "confirm") await salesApi.confirm(so.id);
      else if (action === "release") await salesApi.release(so.id);
      else if (action === "ship") await salesApi.ship(so.id);
      else if (action === "deliver") await salesApi.deliver(so.id);
      else if (action === "invoice") await salesApi.invoice(so.id);
      else if (action === "pay") await salesApi.pay(so.id);
      else if (action === "close") await salesApi.close(so.id);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const actionLabel: Record<SalesOrderAction, string> = {
    confirm: L("确认", "Confirm", "Xác nhận"),
    release: L("释放", "Release", "Phát hành"),
    ship: L("发货", "Ship", "Giao hàng"),
    deliver: L("送达", "Deliver", "Đã giao"),
    invoice: L("开票", "Invoice", "Xuất hóa đơn"),
    pay: L("收款", "Pay", "Thanh toán"),
    cancel: L("取消", "Cancel", "Hủy"),
    close: L("关闭", "Close", "Đóng"),
  };

  if (loading) {
    return <SurfacePanel><div style={{ padding: 32, textAlign: "center" }}>Loading...</div></SurfacePanel>;
  }
  if (!so) {
    return <SurfacePanel><div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>{error ?? L("未找到订单", "Order not found", "Không tìm thấy đơn hàng")}</div></SurfacePanel>;
  }

  const actions = nextActions(so.status);
  const labelStyle: { fontSize: number; color: string; marginBottom: number } = { fontSize: 12, color: "var(--muted)", marginBottom: 2 };

  return (
    <SurfacePanel>
      <SectionHeader
        title={`#${so.soNo}`}
        subtitle={so.customerNameZh}
        action={<button className="action-button" type="button" onClick={onBack}>{L("返回", "Back", "Quay lại")}</button>}
      />
      <div style={{ padding: "16px 20px", display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div><div style={labelStyle}>{L("状态", "Status", "Trạng thái")}</div><span className={"badge tone-" + toneForStatus(so.status)}>{so.status}</span></div>
        <div><div style={labelStyle}>{L("金额", "Amount", "Số tiền")}</div><strong>{fmtCurrency(so.totalAmount, so.currency)}</strong></div>
        <div><div style={labelStyle}>{L("客户", "Customer", "Khách hàng")}</div>{so.customerCode} · {so.customerNameZh}</div>
      </div>

      {error && (
        <div style={{ margin: "0 20px 12px", padding: "8px 12px", color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 8 }}>{error}</div>
      )}

      <div className="toolbar" style={{ padding: "0 20px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {actions.map((a) => (
          <button key={a} className="action-button" type="button" disabled={!canManage || busy !== null} onClick={() => runAction(a)}>
            {busy === a ? "…" : actionLabel[a]}
          </button>
        ))}
        {actions.length === 0 && (
          <span style={{ color: "var(--muted)", alignSelf: "center" }}>{L("该订单已到达终态（闭环完成）", "Order reached terminal state (closed loop complete)", "Đơn hàng đã ở trạng thái cuối (vòng kín hoàn tất)")}</span>
        )}
      </div>

      <SectionHeader title={L("订单行", "Order Lines", "Dòng đơn hàng")} subtitle="" />
      <TableShell>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{L("产品", "Product", "Sản phẩm")}</th>
              <th style={{ textAlign: "right" }}>{L("数量", "Qty", "Số lượng")}</th>
              <th style={{ textAlign: "right" }}>{L("单价", "Unit Price", "Đơn giá")}</th>
              <th style={{ textAlign: "right" }}>{L("小计", "Subtotal", "Thành tiền")}</th>
            </tr>
          </thead>
          <tbody>
            {(so.lines ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.lineNo}</td>
                <td>{l.productCode} · {l.productNameZh}</td>
                <td style={{ textAlign: "right" }}>{l.qty}</td>
                <td style={{ textAlign: "right" }}>{fmtCurrency(l.unitPrice, so.currency)}</td>
                <td style={{ textAlign: "right" }}>{fmtCurrency(l.unitPrice * l.qty, so.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      {so.woLinks && so.woLinks.length > 0 && (
        <>
          <SectionHeader title={L("关联工单", "Linked Work Orders", "Lệnh sản xuất liên kết")} subtitle="" />
          <TableShell>
            <table>
              <thead>
                <tr><th>{L("工单号", "Work Order", "Lệnh SX")}</th><th>{L("客户PO", "Customer PO", "PO khách")}</th></tr>
              </thead>
              <tbody>
                {so.woLinks.map((w, i) => (
                  <tr key={i}><td>{w.workOrderCode ?? "—"}</td><td>{w.customerPoId != null ? String(w.customerPoId) : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </>
      )}

      <SectionHeader title={L("状态历史", "Status History", "Lịch sử trạng thái")} subtitle="" />
      <ol style={{ padding: "0 36px 24px" }}>
        {history.map((h) => (
          <li key={h.id} style={{ padding: "4px 0" }}>
            <strong>{h.fromStatus}</strong> → <strong>{h.toStatus}</strong>{" "}
            <span style={{ color: "var(--muted)" }}>{(h.actor ?? "") + (h.note ? " · " + h.note : "")}</span>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{h.createdAt}</div>
          </li>
        ))}
      </ol>
    </SurfacePanel>
  );
}

function SalesConversionReport({ locale }: { locale: Locale }) {
  return (
    <SurfacePanel>
      <SectionHeader title={t("sales.conversion", locale)} subtitle={t("page.sales", locale)} />
      <TableShell>
        <table>
          <thead>
            <tr>
              <th>{t("sales.quoteNo", locale)}</th>
              <th>{t("table.party", locale)}</th>
              <th>{t("sales.soNo", locale)}</th>
              <th>{t("sales.workOrders", locale)}</th>
              <th>{t("common.status", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {quoteConversions.map((row) => (
              <tr key={row.quoteNo}>
                <td><strong>{row.quoteNo}</strong></td>
                <td>{row.customerCode}</td>
                <td>{row.soNo ?? "—"}</td>
                <td>{(row.workOrderCodes?.length ?? 0) > 0 ? row.workOrderCodes!.join(", ") : "—"}</td>
                <td><Badge tone={toneForStatus(row.status ?? "pending")}>{t(("sales.conversionStatus." + (row.status ?? "pending")) as TranslationKey, locale)}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </SurfacePanel>
  );
}

function SalesCampaignsPlaceholder({ locale }: { locale: Locale }) {
  return (
    <SurfacePanel>
      <SectionHeader title={t("sales.campaigns", locale)} subtitle={t("page.sales", locale)} />
      <div className="placeholder-view">
        <p>营销活动数据从 database/migrations/004_enterprise_support_schema.sql 的 marketing_campaigns 表读取（MVP 占位，后续接入 API 后展示）。</p>
      </div>
    </SurfacePanel>
  );
}

// ── Customer Service MVP module ────────────────────────────────────
import { averageResolutionHours, computeSlaStatus } from "../../../packages/business-rules/src/service";
import { ServiceTicketRegistration } from "./service/ServiceTicketRegistration";
import { ServiceRmaRegistration } from "./service/ServiceRmaRegistration";

type ServiceTabKey = "dashboard" | "tickets" | "rma" | "qualityLinks" | "registerTicket" | "registerRma";

const serviceTabKeys: ServiceTabKey[] = ["dashboard", "tickets", "rma", "qualityLinks"];
const serviceTabTranslationKeys: Record<ServiceTabKey, TranslationKey> = {
  dashboard: "service.dashboard",
  tickets: "service.tickets",
  rma: "service.rma",
  qualityLinks: "service.qualityLinks",
  registerTicket: "service.ticket.form.title",
  registerRma: "service.rma.form.title",
};

function Service({ locale, permissions }: { locale: Locale; permissions: string[] }) {
  const [activeTab, setActiveTab] = useState<ServiceTabKey>("dashboard");
  const canManage = permissions.includes("service.manage");

  const openTickets = serviceTickets.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const overdueTickets = serviceTickets.filter((t) => {
    if (t.status === "resolved" || t.status === "closed") return false;
    return computeSlaStatus({ priority: t.priority ?? "normal", openedAt: t.slaDueAt ?? "" }, "2026-06-19") === "breached";
  }).length;
  const rmaPending = rmaRequests.filter((r) => r.status === "submitted" || r.status === "inspecting" || r.status === "received").length;
  const avgResolution = averageResolutionHours(
    serviceTickets.map((t) => ({ openedAt: t.slaDueAt ?? "", resolvedAt: t.status === "resolved" ? (t.slaDueAt ?? "") : undefined })),
  );

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard":
        return (
          <SurfacePanel>
            <SectionHeader title={t("service.dashboard", locale)} subtitle={t("page.service", locale)} />
            <section className="metric-grid">
              <StatCard label={t("service.tickets", locale)} value={String(openTickets)} trend={t("section.queue", locale)} tone={openTickets > 0 ? "warning" : "ok"} />
              <StatCard label={t("service.slaDue", locale) + " breached"} value={String(overdueTickets)} trend={t("section.risk", locale)} tone={overdueTickets > 0 ? "danger" : "ok"} />
              <StatCard label={t("service.rma", locale)} value={String(rmaPending)} trend={t("section.queue", locale)} tone="info" />
              <StatCard label="Avg resolution (h)" value={`${avgResolution.toFixed(1)}`} trend={t("common.active", locale)} tone="info" />
            </section>
          </SurfacePanel>
        );
      case "tickets":
        return <ServiceTicketList locale={locale} canManage={canManage} onNew={() => setActiveTab("registerTicket")} />;
      case "rma":
        return <ServiceRmaList locale={locale} canManage={canManage} onNew={() => setActiveTab("registerRma")} />;
      case "qualityLinks":
        return <ServiceQualityLinks locale={locale} />;
      case "registerTicket":
        return <ServiceTicketRegistration locale={locale} onSaved={() => setActiveTab("tickets")} onCancel={() => setActiveTab("tickets")} />;
      case "registerRma":
        return <ServiceRmaRegistration locale={locale} onSaved={() => setActiveTab("rma")} onCancel={() => setActiveTab("rma")} />;
    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader
          title={t("nav.service", locale)}
          subtitle={t("page.service", locale)}
          action={canManage ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="action-button" type="button" onClick={() => setActiveTab("registerTicket")}>{t("button.newTicket", locale)}</button>
              <button className="action-button" type="button" onClick={() => setActiveTab("registerRma")}>{t("button.newRma", locale)}</button>
            </div>
          ) : null}
        />
        <div className="toolbar">
          {serviceTabKeys.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={activeTab === tabKey ? "active" : ""}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(serviceTabTranslationKeys[tabKey], locale)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {renderActiveView()}
    </div>
  );
}

function ServiceTicketList({ locale, canManage, onNew }: { locale: Locale; canManage: boolean; onNew: () => void }) {
  return (
    <SurfacePanel>
      <SectionHeader
        title={t("service.tickets", locale)}
        subtitle={t("page.service", locale)}
        action={canManage ? <button className="action-button" type="button" onClick={onNew}>{t("button.newTicket", locale)}</button> : null}
      />
      <TableShell>
        <table>
          <thead>
            <tr>
              <th>{t("service.ticketNo", locale)}</th>
              <th>{t("table.party", locale)}</th>
              <th>{t("service.subject", locale)}</th>
              <th>{t("service.assignee", locale)}</th>
              <th>{t("service.slaDue", locale)}</th>
              <th>{t("common.status", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {serviceTickets.map((tk) => {
              const sla = computeSlaStatus({ priority: tk.priority ?? "normal", openedAt: tk.slaDueAt ?? "", resolvedAt: tk.status === "resolved" ? (tk.slaDueAt ?? "") : undefined }, "2026-06-19");
              const slaTone = sla === "breached" ? "danger" : sla === "warning" ? "warning" : "ok";
              return (
                <tr key={tk.id}>
                  <td><strong>{tk.ticketNo}</strong></td>
                  <td>{tk.customerCode}</td>
                  <td>{tk.subject}</td>
                  <td>{tk.assignee ?? "—"}</td>
                  <td><Badge tone={slaTone}>{sla}</Badge></td>
                  <td><Badge tone={toneForStatus(tk.status ?? "open")}>{t(("service.status." + (tk.status ?? "open")) as TranslationKey, locale)}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>
    </SurfacePanel>
  );
}

function ServiceRmaList({ locale, canManage, onNew }: { locale: Locale; canManage: boolean; onNew: () => void }) {
  return (
    <SurfacePanel>
      <SectionHeader
        title={t("service.rma", locale)}
        subtitle={t("page.service", locale)}
        action={canManage ? <button className="action-button" type="button" onClick={onNew}>{t("button.newRma", locale)}</button> : null}
      />
      <TableShell>
        <table>
          <thead>
            <tr>
              <th>{t("service.ticketNo", locale)}</th>
              <th>{t("table.party", locale)}</th>
              <th>{t("common.product", locale)}</th>
              <th>{t("service.serialNo", locale)}</th>
              <th>{t("service.disposition", locale)}</th>
              <th>{t("common.status", locale)}</th>
            </tr>
          </thead>
          <tbody>
            {rmaRequests.map((r) => (
              <tr key={r.id}>
                <td><strong>{String(r.rmaNumber ?? "—")}</strong></td>
                <td>{String(r.customerCode ?? "—")}</td>
                <td>{String(r.productCode ?? "—")}</td>
                <td>{String(r.serialNo ?? "—")}</td>
                <td>{r.disposition ? t(("service.disposition." + r.disposition) as TranslationKey, locale) : "—"}</td>
                <td><Badge tone={toneForStatus(r.status ?? "submitted")}>{t(("service.rmaStatus." + (r.status ?? "submitted")) as TranslationKey, locale)}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </SurfacePanel>
  );
}

function ServiceQualityLinks({ locale }: { locale: Locale }) {
  return (
    <SurfacePanel>
      <SectionHeader title={t("service.qualityLinks", locale)} subtitle={t("page.service", locale)} />
      <div className="placeholder-view">
        <p>投诉 ↔ 质量数据交叉视图（来自 database/migrations/012_service_rma_and_quality_link.sql 的 complaint_quality_links 表）。MVP 展示结构，后续接入 API 后展示实际关联。</p>
      </div>
    </SurfacePanel>
  );
}

function Maintenance({ locale }: { locale: Locale }) {
  const [activeTab, setActiveTab] = useState<MaintenanceTabKey>("dashboard");
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard": return <MaintenanceDashboard locale={locale} />;
      case "equipment": return <MaintenanceEquipmentList locale={locale} onSelect={(id) => { setSelectedEquipmentId(id); setActiveTab("equipmentDetail"); }} />;
      case "equipmentDetail": return <MaintenanceEquipmentDetail locale={locale} equipmentId={selectedEquipmentId ?? ""} onBack={() => setActiveTab("equipment")} />;
      case "plan": return <MaintenancePlan locale={locale} />;
      case "history": return <MaintenanceHistory locale={locale} />;
      case "inspection": return <InspectionPlan locale={locale} />;
      case "inspectionRecords": return <InspectionRecords locale={locale} />;
      case "pmSchedule": return <PmSchedule locale={locale} />;
      case "pmExecution": return <PmExecution locale={locale} />;
      case "faultReport": return <FaultReportList locale={locale} />;
      case "spareParts": return <SparePartsWarehouse locale={locale} />;
      case "supplierComms": return <SupplierComms locale={locale} />;
      case "checklists": return <EquipmentChecklists locale={locale} />;
      case "workOrders": return <MaintenanceWorkOrders locale={locale} />;
      case "consumables": return <ConsumablesManagement locale={locale} />;
      case "fixtures": return <FixtureManagement locale={locale} />;
      case "maintenanceCard": return <MaintenanceCard locale={locale} />;
            case "andon":
        return <AndonBoard />;
      case "health":
        return <EquipmentHealth />;
      case "pda":
        return <PdaEquipment />;
      case "import":
        return <ExcelImport />;
      case "reports":
        return <EquipmentReports />;
      case "factory3d":
        return <LazyFactory3D />;
      case "carousel":
        return <DashboardCarousel views={[
          { key: 'andon', label: 'Andon', icon: '🚨', component: <AndonBoard /> },
          { key: 'health', label: '健康度', icon: '🏥', component: <EquipmentHealth /> },
          { key: 'factory3d', label: '3D工厂', icon: '🏭', component: <LazyFactory3D /> },
          { key: 'reports', label: '报表', icon: '📊', component: <EquipmentReports /> },
        ]} />;
      case "bom":
        return <EquipmentBom />;
    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.maintenance", locale)} subtitle={t("page.maintenance", locale)} />
        <div className="toolbar">
          {maintenanceTabKeys.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={activeTab === tabKey ? "active" : ""}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(maintenanceTabTranslationKeys[tabKey], locale)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {renderActiveView()}
    </div>
  );
}

function Wms({ locale, permissions }: { locale: Locale; permissions: string[] }) {
  const [activeTab, setActiveTab] = useState<WmsTabKey>(() => {
    const requested = new URLSearchParams(window.location.search).get("wmsTab") as WmsTabKey | null;
    return requested && Object.prototype.hasOwnProperty.call(wmsTabTranslationKeys, requested)
      ? requested
      : "dashboard";
  });

  useEffect(() => {
    const onFactoryNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string; wmsTab?: string }>).detail;
      if (detail?.view === "wms" && detail.wmsTab && Object.prototype.hasOwnProperty.call(wmsTabTranslationKeys, detail.wmsTab)) {
        setActiveTab(detail.wmsTab as WmsTabKey);
      }
    };
    window.addEventListener("factory:navigate", onFactoryNavigate);
    return () => window.removeEventListener("factory:navigate", onFactoryNavigate);
  }, []);

  const navigateWms = (tab: WmsTabKey) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "wms");
    url.searchParams.set("wmsTab", tab);
    window.history.replaceState({}, "", url);
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard": return <WmsDashboard locale={locale} />;
      case "receiving": return <WmsReceiving locale={locale} />;
      case "returnReceive": return <WmsReturnReceiving locale={locale} />;
      case "supplierReturn": return <WmsSupplierReturn locale={locale} />;
      case "salesReturn": return <WmsSalesReturn locale={locale} />;
      case "iqc": return <WmsIqc locale={locale} />;
      case "iqcClosedLoop": return <WmsIqcClosedLoop locale={locale} />;
      case "iqcDefectLoop": return <WmsIqcDefectLoop locale={locale} />;
      case "poReceipt": return <WmsIqcFlowPages page="poReceipt" locale={locale} />;
      case "lineReturn": return <WmsIqcFlowPages page="lineReturn" locale={locale} />;
      case "subcontractReturn": return <WmsIqcFlowPages page="subcontractReturn" locale={locale} />;
      case "mrbReworkReturn": return <WmsIqcFlowPages page="mrbReworkReturn" locale={locale} />;
      case "qrBinding": return <WmsIqcFlowPages page="qrBinding" locale={locale} />;
      case "iqcPassMaintenance": return <WmsIqcFlowPages page="iqcPassMaintenance" locale={locale} />;
      case "defectArchive": return <WmsIqcFlowPages page="defectArchive" locale={locale} />;
      case "mrbApproval": return <WmsIqcFlowPages page="mrbApproval" locale={locale} />;
      case "reworkComplete": return <WmsIqcFlowPages page="reworkComplete" locale={locale} />;
      case "iqcReinspection": return <WmsIqcFlowPages page="iqcReinspection" locale={locale} />;
      case "iqcInspect": return <WmsIqcInspection locale={locale} />;
      case "iqcReport": return <WmsIqcReport locale={locale} />;
      case "iqcStandards": return <WmsIqcStandards locale={locale} />;
      case "supplierKpi": return <WmsSupplierKpi locale={locale} />;
      case "qualityTrend": return <WmsQualityTrend locale={locale} />;
      case "putaway": return <WmsPutAway locale={locale} />;
      case "inventory": return <WmsInventory locale={locale} />;
      case "picking": return <WmsPicking locale={locale} />;
      case "issue": return <WmsIssue locale={locale} />;
      case "cycleCount": return <WmsCycleCount locale={locale} />;
      case "transferAdjust": return <WmsTransferAdjust locale={locale} />;
      case "expiryControl": return <WmsExpiryControl locale={locale} />;
      case "fifoMonitor": return <WmsFifoMonitor locale={locale} />;
      case "transactions": return <WmsTransactions locale={locale} />;
      case "traceability": return <WmsTraceability locale={locale} />;
      case "msd": return <WmsMsd locale={locale} />;
      case "solderPaste": return <WmsSolderPaste locale={locale} />;
      case "auxiliary": return <WmsAuxiliary locale={locale} />;
      case "collaboration": return <WmsCollaborationDashboard locale={locale} />;
      case "closure": return <WmsClosureDashboard locale={locale} />;
      case "smartShelf": return <WmsSmartShelfTester locale={locale} />;
      case "shelfApi": return <WmsShelfApiTester locale={locale} />;
      case "shelfSim": return <WmsShelfSimulator locale={locale} />;
      case "shelfSim3d": return <div className="surface-panel"><div className="placeholder-view"><p>🏭 3D 货架模拟器 — 入口：主厂房 → 视图 → 原材料仓库</p><p style={{fontSize:12,color:"#64748b",marginTop:8}}>Smart shelf 3D view is integrated in the Manual Line 3D dashboard (主厂房 → 视图 → 原材料仓库)</p></div></div>;
      case "shelfOps": return <WmsShelfOperations />;
      case "sqlConsole": return <WmsSqlConsole />;
      case "rackSim": return <WmsRackSimulator />;
      case "smartRack": return <WmsSmartRackManager locale={locale} />;
      case "smartRackWorkflow": return <SmartRackWorkflow locale={locale} />;
      case "lifecycle": return <WmsLifecycleDashboard permissions={permissions} locale={locale} />;
      case "fifoSimulation": return <WmsFifoSimulation locale={locale} />;
      case "materialMaster": return <WmsMaterialMaster locale={locale} />;
      case "materialBarcodeLoop": return <WmsMaterialBarcodeLoop locale={locale} />;
      case "locationManagement": return <WmsLocationManagement locale={locale} />;
      case "basicData": return <WmsBasicData locale={locale} onNavigate={setActiveTab} />;
      case "batchManagement": return <WmsBatchManagement locale={locale} />;
      // PDA receiving intentionally uses the same full receiving workspace as
      // the management system. This keeps QR/label printing, material-code
      // mapping, pallet/box binding, OA and IQC state on one API-backed flow.
      case "pdaReceiving": return <WmsMaterialReceiving locale={locale} />;
      case "pdaReceivingMobile": return <WmsPdaReceivingMobile locale={locale} />;
      case "pdaConsumption": return <WmsPdaConsumption locale={locale} />;
      case "pdaMsd": return <WmsMsd locale={locale} initialTab="pdaSync" />;
      case "pdaCycleCount": return <WmsPdaCycleCount locale={locale} />;
      case "pdaIqc": return <WmsPdaIqc locale={locale} />;
      case "pdaHistory": return <WmsPdaHistory locale={locale} />;
      case "inboundOrders": return <WmsInboundOrders />;
      case "outboundOrders": return <WmsOutboundOrders />;
      case "requisitions": return <WmsRequisitions />;
      case "returnSlips": return <WmsReturnSlips />;
      case "replenishments": return <WmsReplenishments locale={locale} />;
      case "syncHealth": return <WmsSyncHealth locale={locale} />;
      case "incoming": return <WmsIncoming locale={locale} />;
      case "materialReceiving": return <WmsMaterialReceiving locale={locale} />;
      case "materialLoading": return <WmsMaterialLoading locale={locale} />;
      case "smtClosedLoop": return <WmsSmtClosedLoop locale={locale} />;
      case "nonSmtClosedLoop": return <WmsNonSmtClosedLoop locale={locale} />;
      case "nonIqcClosedLoop": return <WmsNonIqcClosedLoop locale={locale} />;
      case "finishedGoods": return <WmsFinishedGoods locale={locale} />;
      case "productionInbound": return <WmsProductionInbound locale={locale} />;
      case "productionOutbound": return <WmsProductionOutbound locale={locale} />;
      case "qualityDashboard": return <QmsDashboard locale={locale} />;
      case "oqc": return <QmsOqcBatches locale={locale} />;
      case "ngManagement": return <QmsNgCases locale={locale} />;
      case "eightD": return <QmsEightD locale={locale} />;
      default:
        return (
          <SurfacePanel>
            <div className="placeholder-view">
              {t("common.open", locale)}
            </div>
          </SurfacePanel>
        );
    }
  };

  const activeGroup = wmsMenuGroups.find((group) => group.tabs.includes(activeTab)) ?? wmsMenuGroups[0];

  const isMenuPage = activeTab === "dashboard";

  return (
    <div className="screen-stack">
      {isMenuPage ? (
        <WmsMenuPage locale={locale} onNavigate={navigateWms} />
      ) : (
        <>
          <SurfacePanel>
            <SectionHeader title={t("nav.wms", locale)} subtitle={t("page.wms", locale)} />
            <div className="toolbar" style={{ flexWrap: "wrap", overflowX: "visible" }}>
              <button
                className="action-button"
                type="button"
                title={t("wms.backToMenu", locale)}
                style={{ background: "var(--nav)", marginRight: 8 }}
                onClick={() => navigateWms("dashboard")}
              >
                ← {t("wms.menuPage", locale)}
              </button>
              {wmsMenuGroups.map((group) => (
                <button
                  className="action-button"
                  key={group.key}
                  type="button"
                  title={t(group.translationKey as TranslationKey, locale)}
                  style={{ background: activeGroup.key === group.key ? "var(--info)" : "var(--nav)" }}
                  onClick={() => navigateWms(group.tabs[0])}
                >
                  {t(group.translationKey as TranslationKey, locale)}
                </button>
              ))}
            </div>
          </SurfacePanel>

          <SurfacePanel>
            <div className="toolbar" style={{ flexWrap: "wrap", overflowX: "visible" }}>
              {activeGroup.tabs.map((subKey) => (
                <button
                  key={subKey}
                  type="button"
                  className={activeTab === subKey ? "active" : ""}
                  onClick={() => navigateWms(subKey)}
                >
                  {t(wmsTabTranslationKeys[subKey] as TranslationKey, locale)}
                </button>
              ))}
            </div>
          </SurfacePanel>
        </>
      )}

      {!isMenuPage && renderActiveView()}
    </div>
  );
}

function Mes({ locale }: { locale: Locale }) {
  const [activeTab, setActiveTab] = useState<MesTabKey>(() => {
    const requested = new URLSearchParams(window.location.search).get("mesTab") as MesTabKey | null;
    return requested && mesTabKeys.includes(requested) ? requested : "overview";
  });

  const activeGroup = mesGroups.find((group) => group.tabs.includes(activeTab)) ?? mesGroups[0];
  const activeTheme = activeGroup.theme;
  const activeThemeGroups = mesGroups.filter((group) => group.theme === activeTheme);

  const openMesTab = (tab: MesTabKey) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "mes");
    url.searchParams.set("mesTab", tab);
    window.history.replaceState({}, "", url);
  };

  useEffect(() => {
    const autoOpen = () => openMesTab("smtMaterialBindings");
    window.addEventListener("mes:auto-open-smt-loading", autoOpen);
    return () => window.removeEventListener("mes:auto-open-smt-loading", autoOpen);
  }, []);

  const renderActiveView = () => {
    switch (activeTab) {
      case "overview":
        return <MesOverview locale={locale} onOpen={openMesTab} />;
      case "managerConsole":
        return <MesManagerConsole locale={locale} />;
      case "dashboard":
        return <MesDashboard locale={locale} />;
      case "processFlow":
        return <LazyFactoryLinesTree locale={locale} />;
      case "stationWorkflow":
        return <StationWorkflow locale={locale} />;
      case "stationType":
        return <StationTypeList locale={locale} />;
      case "stationMaster":
        return <StationMaster locale={locale} />;
      case "processDoc":
        return <ProcessDocumentation locale={locale} />;
      case "processManagement":
        return <ProcessManagement locale={locale} />;
      case "foolProof":
        return <FeederPreparationMapping />;
      case "firstArticle":
        return <FirstArticleInspectionPage locale={locale} />;
      case "materialVerify":
        return <MaterialVerificationPage locale={locale} />;
      case "materialLoad":
        return <MaterialLoadingPage locale={locale} />;
      case "materialRollQr":
        return <MaterialRollQrGenerator locale={locale} />;
      case "smtMaterialBindings":
        return <SmtMaterialBindingTable />;
      case "smtLoading3d":
        return <SmtLoading3dSimulator />;
      case "tooljetSmtLoading":
        return <iframe title="ToolJet SMT 实时上料控制台" src="/tooljet-smt-loading-demo.html" style={{ width: "100%", height: "calc(100vh - 120px)", minHeight: 760, border: 0, borderRadius: 12, display: "block", background: "#f6f9fa" }} />;
      case "smtExemptions":
        return <SmtMaterialExemptions locale={locale} />;
      case "smtLoader":
        return <SmtMaterialLoadingPage locale={locale} />;
      case "dispatchBoard":
        return <MaterialDispatchBoard locale={locale} />;
      case "stagnation":
        return <StagnationTracking locale={locale} />;
      case "scrap":
        return <ScrapRegistration locale={locale} />;
      case "trace":
        return <TraceabilitySearch locale={locale} />;
      case "journey":
        return <JourneySearch locale={locale} />;
      case "stationOperator":
        return <StationOperator locale={locale} />;
      case "repair":
        return <RepairWorkflow locale={locale} />;
      case "retestRules":
        return <RetestRules locale={locale} />;
      case "timeControl":
        return <TimeControl locale={locale} />;
      case "ictMonitor":
        return <LazyIctStationMonitor locale={locale} />;
      case "productionLine":
        return <ProductionLineDashboard locale={locale} />;
      case "manualLine":
        return <LazyManualLineDashboard />;
      case "manualLine3d":
        return <iframe title="手动线实时3D" src="/manual-line-video-3d.html?ngTrace=20260818" style={{ width: "100%", height: "calc(100vh - 120px)", minHeight: 680, border: 0, borderRadius: 12, display: "block" }} />;
      case "autoLine":
        return <AutoLineDashboard locale={locale} />;
      case "autoLine3d":
        return <iframe title="自动线实时3D" src="/auto-line-video-3d.html" style={{ width: "100%", height: "calc(100vh - 120px)", minHeight: 680, border: 0, borderRadius: 12, display: "block" }} />;
      case "warehouseStorage":
        return <LazyWarehouseStoragePage locale={locale} />;
      case "rework":
        return <ReworkDashboard locale={locale} />;
      case "ngRevival":
        return <NgRevivalManagement locale={locale} />;
      case "ngTracking":
        return <NgRealtimeTracking locale={locale} />;
      case "ngManagement":
        return <NgManagementPage locale={locale} />;
      case "ngClosedLoop":
        return <NgClosedLoopBoard locale={locale} />;
      case "ngRouting":
        return <NgRouteConfigurator locale={locale} />;
      case "passShortage":
        return <PassShortageManagement />;
      case "packagingBoxes":
        return <PackagingBoxManagement />;
      case "qrWorkOrders":
        return <QrWorkOrderManagement />;
      case "pdaLoad":
        return <PdaLoadDashboard locale={locale} />;
      case "pdaDevice":
        return <PdaDeviceManagement locale={locale} />;
      case "pdaScan":
        return <PdaUnifiedScanning locale={locale} />;
      case "pdaOnline":
        return <PdaOnlineMonitor locale={locale} />;
      case "bomReconciliation":
        return <BomReconciliation locale={locale} />;

    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader
          title={t("nav.mes", locale)}
          subtitle={t("page.mes", locale)}
          action={
            <div className="toolbar" aria-label="3D production line views">
              <button
                type="button"
                className={activeTab === "manualLine3d" ? "active" : ""}
                aria-label="Manual Line 3D"
                data-line-domain="MANUAL_LINE"
                title="Manual production line domain · MANUAL_LINE"
                onClick={() => openMesTab("manualLine3d")}
              >
                Manual Line 3D
              </button>
              <button
                type="button"
                className={activeTab === "autoLine3d" ? "active" : ""}
                aria-label="Auto Line 3D"
                data-line-domain="AUTO_LINE"
                title="Automatic production line domain · AUTO_LINE"
                onClick={() => openMesTab("autoLine3d")}
              >
                Auto Line 3D
              </button>
            </div>
          }
        />
        <div className="mes-unified-nav" role="tablist" aria-label={t("mes.navigation.themes", locale)}>
          {mesThemes.map((theme) => (
            <button
              key={theme.key}
              type="button"
              className={`mes-theme-tab ${activeTheme === theme.key ? "active" : ""}`}
              title={t(`${theme.labelKey}.tip` as TranslationKey, locale)}
              onClick={() => openMesTab(mesGroups.find((group) => group.theme === theme.key)!.tabs[0])}
            >
              {t(theme.labelKey as TranslationKey, locale)}
            </button>
          ))}
          <span className="mes-nav-divider" aria-hidden="true" />
          {activeThemeGroups.map((group) => (
            <button
              key={group.key}
              type="button"
              className={`mes-group-tab ${activeGroup.key === group.key ? "active" : ""}`}
              title={t(`${group.labelKey}.tip` as TranslationKey, locale)}
              onClick={() => openMesTab(group.tabs[0])}
            >
              {t(group.labelKey as TranslationKey, locale)}
            </button>
          ))}
        </div>
        <div className="mes-page-nav" role="tablist" aria-label={t("mes.navigation.pages", locale)}>
          {activeGroup.tabs.map((tabKey) => {
            const contribution = getMesContribution(tabKey);
            const activeScore = activeTheme === "product" ? contribution.product : contribution.ng;
            return (
            <button
              key={tabKey}
              type="button"
              className={`${activeTab === tabKey ? "active" : ""} ${activeScore >= 4 ? "mes-page-primary" : "mes-page-support"}`}
              title={`${t("mes.navigation.openPage", locale)}：${t(mesTabTranslationKeys[tabKey] as TranslationKey, locale)}。${t(contribution.rationaleKey, locale)}`}
              onClick={() => openMesTab(tabKey)}
            >
              {tabKey === "manualLine3d"
                ? locale === "zh-CN" ? "手动线 3D" : locale === "vi-VN" ? "3D dây chuyền thủ công" : "Manual Line 3D"
                : tabKey === "autoLine3d"
                  ? locale === "zh-CN" ? "自动线 3D" : locale === "vi-VN" ? "3D dây chuyền tự động" : "Auto Line 3D"
                  : tabKey === "warehouseStorage"
                    ? locale === "zh-CN" ? "仓库与线边存储 3D" : locale === "vi-VN" ? "Kho và lưu trữ sàn 3D" : "Warehouse & Floor Storage 3D"
                  : t(mesTabTranslationKeys[tabKey] as TranslationKey, locale)}
              <small className="mes-contribution-badge">P{contribution.product} · NG{contribution.ng}</small>
            </button>
          )})}
        </div>
      </SurfacePanel>
      {renderActiveView()}
    </div>
  );
}

function MaterialLoadingPage({ locale }: { locale: Locale }) {
  const [view, setView] = useState<"dashboard" | "workflow">("dashboard");
  const [selectedLine, setSelectedLine] = useState<string>("");

  const handleStartLoading = useCallback((lineCode: string) => {
    setSelectedLine(lineCode);
    setView("workflow");
  }, []);

  const handleBack = useCallback(() => {
    setView("dashboard");
    setSelectedLine("");
  }, []);

  if (view === "workflow" && selectedLine) {
    return (
      <MaterialLoadingWorkflow
        locale={locale}
        lineCode={selectedLine}
        onBack={handleBack}
      />
    );
  }

  return (
    <MaterialLoadingDashboard
      locale={locale}
      onStartLoading={handleStartLoading}
    />
  );
}

function MesDashboard({ locale }: { locale: Locale }) {
  const [scan, setScan] = useState("PCB2606160100084172");
  const [apiLines, setApiLines] = useState<import("./api/mes").ProductionLine[]>([]);
  const [apiBindings, setApiBindings] = useState<import("./api/mes").FeederBinding[]>([]);
  const [loadingLines, setLoadingLines] = useState(true);
  const [loadingBindings, setLoadingBindings] = useState(true);

  const detected = scan.startsWith("PCB")
    ? t("scan.detectedPcb", locale)
    : scan.startsWith("REEL")
      ? t("scan.detectedReel", locale)
      : scan.startsWith("260")
        ? t("scan.detectedWorkOrder", locale)
        : t("scan.detectedUnknown", locale);

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      mesApi.getLines({ limit: 50 }).then(r => { if (!disposed) { setApiLines(r.items); setLoadingLines(false); } }).catch(() => setLoadingLines(false));
      mesApi.getFeederBindings({ limit: 100 }).then(r => { if (!disposed) { setApiBindings(r.items); setLoadingBindings(false); } }).catch(() => setLoadingBindings(false));
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    const onBinding = () => refresh();
    window.addEventListener("mes:feeder-binding-created", onBinding);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("mes:feeder-binding-created", onBinding);
    };
  }, []);

  const lineName = (line: import("./api/mes").ProductionLine) =>
    locale === "zh-CN" ? line.nameZh : locale === "en-US" ? line.nameEn : line.nameVi;

  return (
    <>
      <div className="content-grid two">
        <SurfacePanel>
          <SectionHeader title={t("mes.scanReady", locale)} subtitle={t("mes.subtitle", locale)} />
          <div className="scanner">
            <ScanBarcode size={28} />
            <input
              value={scan}
              onChange={(event) => setScan(event.target.value)}
              placeholder={t("scan.placeholder", locale)}
              title={t("ui.scanInput", locale)}
            />
            <div className="scanner-result">
              <span>{t("scan.result", locale)}</span>
              <strong title={detected}>{detected}</strong>
            </div>
          </div>
          <div className="toolbar">
            {[
              { key: "buttons.start", icon: Factory },
              { key: "buttons.bind", icon: Barcode },
              { key: "buttons.output", icon: ClipboardCheck },
              { key: "buttons.stop", icon: Wrench },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <button className="action-button" key={action.key} type="button" title={`${t(action.key as TranslationKey, locale)} - ${t("ui.quickAction", locale)}`}>
                  <Icon size={16} />
                  {t(action.key as TranslationKey, locale)}
                </button>
              );
            })}
          </div>
        </SurfacePanel>

        <SurfacePanel>
          <SectionHeader title={t("mes.lineBoard", locale)} subtitle={t("section.live", locale)} />
          <div className="line-list">
            {loadingLines ? (
              <div className="placeholder-view">{t("common.loading", locale)}</div>
            ) : apiLines.length === 0 ? (
              <div className="placeholder-view"><Factory size={32} /><p>{t("common.noData", locale)}</p></div>
            ) : apiLines.map((line) => {
              return (
                <article className="line-row" key={line.id}>
                  <div className="line-title">
                    <strong>{lineName(line)}</strong>
                    <span>{line.currentWorkOrderCode ?? "—"}</span>
                  </div>
                  <div className="line-measures">
                    <Badge tone={toneForStatus(line.status)} title={t("ui.statusIndicator", locale)}>{t(lineStatusLabelMap[line.status], locale)}</Badge>
                    <span>{line.activeRuns ?? 0} runs</span>
                    <span>{line.stationCount ?? 0} stations</span>
                  </div>
                </article>
              );
            })}
          </div>
        </SurfacePanel>
      </div>

      <SurfacePanel>
        <SectionHeader title={t("mes.bindingBoard", locale)} subtitle={t("common.machine", locale)} />
        <TableShell>
          <table>
            <thead>
              <tr>
                <th>{t("common.workOrder", locale)}</th>
                <th>{t("common.line", locale)}</th>
                <th>{t("common.machine", locale)}</th>
                <th>{t("common.feeder", locale)}</th>
                <th>{t("common.material", locale)}</th>
                <th>{t("common.operator", locale)}</th>
                <th>{t("common.time", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {loadingBindings ? (
                <tr><td colSpan={7} style={{ textAlign: "center" }}>{t("common.loading", locale)}</td></tr>
              ) : apiBindings.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center" }}>{t("common.noData", locale)}</td></tr>
              ) : apiBindings.map((binding) => (
                <tr key={binding.id}>
                  <td>{binding.workOrderCode}</td>
                  <td>{binding.lineCode}</td>
                  <td>{binding.machineCode}</td>
                  <td>{binding.feederNo}</td>
                  <td>{binding.materialCode}</td>
                  <td>{binding.operator}</td>
                  <td>{binding.boundAt ? new Date(binding.boundAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </SurfacePanel>

      <AiPatrolChat patrol={mesPatrol(locale)} locale={locale} />
    </>
  );
}

function Quality({ locale }: { locale: Locale }) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "aoi" | "fct" | "autoLine">("dashboard");
  const isActiveTab = (tab: "dashboard" | "aoi" | "fct" | "autoLine") => activeTab === tab;
  const [records, setRecords] = useState<import("./quality/types").QualityRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    qualityApi.getRecords({ limit: 100 }).then((r) => {
      setRecords(r.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const passCount = records.filter((r) => r.result === "PASS").length;
  const failCount = records.filter((r) => r.result === "FAIL").length;
  const closedCount = records.filter((r) => r.result === "CLOSED").length;

  if (activeTab === "aoi") {
    return (
      <div className="screen-stack">
        <SurfacePanel>
          <SectionHeader title={t("nav.quality", locale)} subtitle={t("page.quality", locale)} />
          <div className="toolbar">
            <button
              type="button"
              className="action-button"
              style={{ background: isActiveTab("dashboard") ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("dashboard")}
            >
              {t("quality.dashboard", locale)}
            </button>
            <button
              type="button"
              className="action-button"
              style={{ background: isActiveTab("aoi") ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("aoi")}
            >
              {t("aoi.title", locale)}
            </button>
          </div>
        </SurfacePanel>
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>{t("common.loading", locale)}...</div>}>
          <AoiStation locale={locale} />
        </Suspense>
        <AiPatrolChat patrol={qualityPatrol(locale)} locale={locale} />
      </div>
    );
  }

  if (activeTab === "fct") {
    return (
      <div className="screen-stack">
        <SurfacePanel>
          <SectionHeader title={t("nav.quality", locale)} subtitle={t("page.quality", locale)} />
          <div className="toolbar">
            <button
              type="button"
              className="action-button"
              style={{ background: isActiveTab("dashboard") ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("dashboard")}
            >
              {t("quality.dashboard", locale)}
            </button>
            <button
              type="button"
              className="action-button"
              style={{ background: isActiveTab("aoi") ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("aoi")}
            >
              {t("aoi.title", locale)}
            </button>
            <button
              type="button"
              className="action-button"
              style={{ background: isActiveTab("fct") ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("fct")}
            >
              {t("fct.title", locale)}
            </button>
            <button
              type="button"
              className="action-button"
              style={{ background: isActiveTab("autoLine") ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("autoLine")}
            >
              {t("quality.autoLine", locale)}
            </button>
          </div>
        </SurfacePanel>
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>{t("common.loading", locale)}...</div>}>
          <FctStation locale={locale} />
        </Suspense>
        <AiPatrolChat patrol={qualityPatrol(locale)} locale={locale} />
      </div>
    );
  }

  if (activeTab === "autoLine") {
    return (
      <div className="screen-stack">
        <SurfacePanel>
          <SectionHeader title={t("nav.quality", locale)} subtitle={t("page.quality", locale)} />
          <div className="toolbar">
            <button
              type="button"
              className="action-button"
              style={{ background: isActiveTab("dashboard") ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("dashboard")}
            >
              {t("quality.dashboard", locale)}
            </button>
            <button
              type="button"
              className="action-button"
              style={{ background: isActiveTab("aoi") ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("aoi")}
            >
              {t("aoi.title", locale)}
            </button>
            <button
              type="button"
              className="action-button"
              style={{ background: isActiveTab("fct") ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("fct")}
            >
              {t("fct.title", locale)}
            </button>
            <button
              type="button"
              className="action-button"
              style={{ background: activeTab === "autoLine" ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab("autoLine")}
            >
              {t("quality.autoLine", locale)}
            </button>
          </div>
        </SurfacePanel>
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>{t("common.loading", locale)}...</div>}>
          <AutoLineStation locale={locale} />
        </Suspense>
        <AiPatrolChat patrol={qualityPatrol(locale)} locale={locale} />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.quality", locale)} subtitle={t("page.quality", locale)} />
        <div className="toolbar">
          <button
            type="button"
            className="action-button"
            style={{ background: isActiveTab("dashboard") ? "var(--info)" : "var(--nav)" }}
            onClick={() => setActiveTab("dashboard")}
          >
            {t("quality.dashboard", locale)}
          </button>
          <button
            type="button"
            className="action-button"
            style={{ background: isActiveTab("aoi") ? "var(--info)" : "var(--nav)" }}
            onClick={() => setActiveTab("aoi")}
          >
            {t("aoi.title", locale)}
          </button>
          <button
            type="button"
            className="action-button"
            style={{ background: isActiveTab("fct") ? "var(--info)" : "var(--nav)" }}
            onClick={() => setActiveTab("fct")}
          >
            {t("fct.title", locale)}
          </button>
        </div>
      </SurfacePanel>

      <section className="metric-grid">
        <StatCard label={t("quality.queue", locale)} value={String(records.length)} trend={t("common.open", locale)} tone="info" />
        <StatCard label={t("quality.defect", locale)} value={String(failCount)} trend={t("common.watch", locale)} tone="danger" />
        <StatCard label={t("quality.closure", locale)} value={String(closedCount)} trend={t("status.closed", locale)} tone="ok" />
        <StatCard label={t("quality.yield", locale)} value={records.length > 0 ? `${Math.round((passCount / records.length) * 100)}%` : "—"} trend={t("status.pass", locale)} tone="ok" />
      </section>

      <div className="content-grid two">
        <SurfacePanel>
          <SectionHeader title={t("quality.queue", locale)} subtitle={t("quality.subtitle", locale)} />
          <TableShell>
            <table>
              <thead>
                <tr>
                  <th>{t("common.station", locale)}</th>
                  <th>{t("common.workOrder", locale)}</th>
                  <th>{t("common.serial", locale)}</th>
                  <th>{t("table.result", locale)}</th>
                  <th>{t("table.defect", locale)}</th>
                  <th>{t("common.operator", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ textAlign: "center" }}>{t("common.loading", locale)}</td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: "center" }}>{t("common.noData", locale)}</td></tr>
                ) : records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.station}</td>
                    <td>{r.workOrderCode}</td>
                    <td>{r.pcbSerial ?? "—"}</td>
                    <td>
                      <Badge tone={toneForStatus(r.result ?? "PASS")}>{t(inspectionResultLabelMap[(r.result ?? "PASS") as keyof typeof inspectionResultLabelMap], locale)}</Badge>
                    </td>
                    <td>{r.defectCode ? <strong>{r.defectCode}</strong> : <span>—</span>}</td>
                    <td>{r.operator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </SurfacePanel>

        <SurfacePanel>
          <SectionHeader title={t("quality.closure", locale)} subtitle={t("section.timeline", locale)} />
          <div className="timeline">
            {records.map((r, index) => (
              <article className="timeline-item" key={r.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{r.station}</strong>
                  <p>
                    {r.workOrderCode} · {r.occurredAt ? new Date(r.occurredAt).toLocaleString() : "—"}
                  </p>
                </div>
                <Badge tone={toneForStatus(r.result ?? "PASS")}>{t(inspectionResultLabelMap[(r.result ?? "PASS") as keyof typeof inspectionResultLabelMap], locale)}</Badge>
                <small>{r.operator}</small>
              </article>
            ))}
          </div>
        </SurfacePanel>
      </div>

      <AiPatrolChat patrol={qualityPatrol(locale)} locale={locale} />
    </div>
  );
}

function Trace({ locale }: { locale: Locale }) {
  const [query, setQuery] = useState("PCB2606160100084172");

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("trace.lookup", locale)} subtitle={t("trace.subtitle", locale)} />
        <label className="scan-input">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("scan.placeholder", locale)} />
          <button type="button" className="icon-button">
            <Bell size={16} />
          </button>
        </label>
      </SurfacePanel>

      <div className="content-grid two">
        <SurfacePanel>
          <SectionHeader title={t("trace.chain", locale)} subtitle={query} />
          <div className="timeline">
            {traceEvents.map((event) => (
              <article key={event.id} className="timeline-item">
                <span>{event.sequence}</span>
                <div>
                  <strong>{event.ref}</strong>
                  <p>
                    {t(traceTypeLabelMap[event.type ?? ""], locale)} · {event.details}
                  </p>
                </div>
                <Badge tone={toneForStatus(event.status ?? "closed")}>{t(traceStatusLabelMap[event.status ?? "closed"] ?? "status.closed", locale)}</Badge>
                <small>{event.actor}</small>
              </article>
            ))}
          </div>
        </SurfacePanel>

        <SurfacePanel>
          <SectionHeader title={t("section.queue", locale)} subtitle={t("dashboard.traceOpen", locale)} />
          <TableShell>
            <table>
              <thead>
                <tr>
                  <th>{t("common.sequence", locale)}</th>
                  <th>{t("common.type", locale)}</th>
                  <th>{t("common.code", locale)}</th>
                  <th>{t("table.status", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {traceEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{event.sequence}</td>
                    <td>{t(traceTypeLabelMap[event.type ?? ""], locale)}</td>
                    <td>{event.ref}</td>
                    <td>
                      <Badge tone={toneForStatus(event.status ?? "closed")}>{t(traceStatusLabelMap[event.status ?? "closed"] ?? "status.closed", locale)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </SurfacePanel>
      </div>
    </div>
  );
}

function Admin({ locale }: { locale: Locale }) {
  const [adminTab, setAdminTab] = useState<"overview" | "authorization" | "lines" | "services" | "databases">("overview");
  const dependencyItems = [
    { label: "admin.dep.auth", detail: "admin.dep.authDetail" },
    { label: "admin.dep.live", detail: "admin.dep.liveDetail" },
    { label: "admin.dep.history", detail: "admin.dep.historyDetail" },
  ];

  if (adminTab === "lines") {
    return (
      <div className="screen-stack">
        <SurfacePanel>
          <SectionHeader title={t("admin.lineManagement.title", locale)} subtitle={t("admin.lineManagement.subtitle", locale)} />
          <div className="toolbar">
            <button type="button" className="active">{t("admin.lineManagement.list", locale)}</button>
            <button type="button" onClick={() => setAdminTab("overview")}>{t("admin.roles", locale)}</button>
            <button type="button" onClick={() => setAdminTab("services")}>{t("admin.services.title", locale)}</button>
            <button type="button" onClick={() => setAdminTab("databases")}>{t("admin.databases.title", locale)}</button>
          </div>
        </SurfacePanel>
        <AdminLineManagement locale={locale} />
      </div>
    );
  }

  if (adminTab === "authorization") {
    return (
      <div className="screen-stack">
        <SurfacePanel>
          <SectionHeader title="用户授权管理" subtitle="分配系统角色并保留审计记录" />
          <div className="toolbar">
            <button type="button" onClick={() => setAdminTab("overview")}>{t("admin.roles", locale)}</button>
            <button type="button" className="active">用户授权</button>
            <button type="button" onClick={() => setAdminTab("lines")}>{t("admin.lineManagement.title", locale)}</button>
            <button type="button" onClick={() => setAdminTab("services")}>{t("admin.services.title", locale)}</button>
            <button type="button" onClick={() => setAdminTab("databases")}>{t("admin.databases.title", locale)}</button>
          </div>
        </SurfacePanel>
        <UserAuthorizationManager />
        <PdaAccessConfiguration />
      </div>
    );
  }

  if (adminTab === "services") {
    return (
      <div className="screen-stack">
        <SurfacePanel>
          <SectionHeader title={t("admin.services.title", locale)} subtitle={t("admin.services.subtitle", locale)} />
          <div className="toolbar">
            <button type="button" onClick={() => setAdminTab("overview")}>{t("admin.roles", locale)}</button>
            <button type="button" onClick={() => setAdminTab("lines")}>{t("admin.lineManagement.title", locale)}</button>
            <button type="button" className="active">{t("admin.services.title", locale)}</button>
            <button type="button" onClick={() => setAdminTab("databases")}>{t("admin.databases.title", locale)}</button>
          </div>
        </SurfacePanel>
        <SystemMonitor locale={locale} />
      </div>
    );
  }

  if (adminTab === "databases") {
    return (
      <div className="screen-stack">
        <SurfacePanel>
          <SectionHeader title={t("admin.databases.title", locale)} subtitle={t("admin.databases.subtitle", locale)} />
          <div className="toolbar">
            <button type="button" onClick={() => setAdminTab("overview")}>{t("admin.roles", locale)}</button>
            <button type="button" onClick={() => setAdminTab("lines")}>{t("admin.lineManagement.title", locale)}</button>
            <button type="button" onClick={() => setAdminTab("services")}>{t("admin.services.title", locale)}</button>
            <button type="button" className="active">{t("admin.databases.title", locale)}</button>
          </div>
        </SurfacePanel>
        <StationDatabaseManagement locale={locale} />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.admin", locale)} subtitle={t("page.admin", locale)} />
        <div className="toolbar">
          <button type="button" className="active" onClick={() => setAdminTab("overview")}>{t("admin.roles", locale)}</button>
          <button type="button" onClick={() => setAdminTab("authorization")}>用户授权</button>
          <button type="button" onClick={() => setAdminTab("lines")}>{t("admin.lineManagement.title", locale)}</button>
          <button type="button" onClick={() => setAdminTab("services")}>{t("admin.services.title", locale)}</button>
          <button type="button" onClick={() => setAdminTab("databases")}>{t("admin.databases.title", locale)}</button>
        </div>
      </SurfacePanel>

      <div className="content-grid two">
        <SurfacePanel>
          <SectionHeader title={t("section.roleMatrix", locale)} subtitle={t("admin.roles", locale)} />
          <div className="role-grid">
            {Object.entries(roleMatrix).map(([role, permissions]) => (
              <article className="role-card" key={role}>
                <div className="role-head">
                  <strong>{role}</strong>
                  <Badge tone="info">{permissions.length}</Badge>
                </div>
                <p>{permissions.join(" / ")}</p>
              </article>
            ))}
          </div>
        </SurfacePanel>

        <SurfacePanel>
          <SectionHeader title={t("section.menuAccess", locale)} subtitle={t("admin.subtitle", locale)} />
          <div className="menu-access">
            {modules.map((module) => {
              const Icon = module.icon;
              return (
                <div className="menu-access-row" key={module.key}>
                  <Icon size={16} />
                  <span>{t(module.label, locale)}</span>
                  <Badge tone="muted">{t(moduleSubtitleKeys[module.key] ?? "page.dashboard", locale)}</Badge>
                </div>
              );
            })}
          </div>
        </SurfacePanel>
      </div>

      <div className="content-grid two">
        <SurfacePanel>
          <SectionHeader title={t("section.audit", locale)} subtitle={t("admin.audit", locale)} />
          <div className="status-stack">
            <div className="status-row">
              <span>{t("admin.audit.noHardDelete", locale)}</span>
              <strong>{t("admin.audit.noHardDelete", locale)}</strong>
              <Badge tone="warning">DB</Badge>
            </div>
            <div className="status-row">
              <span>{t("admin.audit.transactionHistory", locale)}</span>
              <strong>{t("admin.audit.transactionHistory", locale)}</strong>
              <Badge tone="ok">WMS / MES</Badge>
            </div>
            <div className="status-row">
              <span>{t("admin.audit.roleScoped", locale)}</span>
              <strong>{t("admin.audit.roleScoped", locale)}</strong>
              <Badge tone="info">Auth</Badge>
            </div>
          </div>
        </SurfacePanel>

        <SurfacePanel>
          <SectionHeader title={t("section.dependencies", locale)} subtitle={t("admin.dependencies", locale)} />
          <div className="dependency-list">
            {dependencyItems.map((item) => (
              <div className="dependency-row" key={item.label}>
                <strong>{t(item.label as TranslationKey, locale)}</strong>
                <span>{t(item.detail as TranslationKey, locale)}</span>
              </div>
            ))}
          </div>
        </SurfacePanel>
      </div>
    </div>
  );
}

function Bom({ locale }: { locale: Locale }) {
  const [activeTab, setActiveTab] = useState<BomTabKey>("bomList");

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.bom", locale)} subtitle={t("page.bom", locale)} />
        <div className="toolbar">
          {bomTabKeys.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className="action-button"
              title={t(bomTabTranslationKeys[tabKey] as TranslationKey, locale)}
              style={{ background: activeTab === tabKey ? "var(--info)" : "var(--nav)" }}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(bomTabTranslationKeys[tabKey] as TranslationKey, locale)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {activeTab === "bomList" ? (
        <BomList locale={locale} />
      ) : activeTab === "bomChangeControl" ? (
        <BomChangeControl locale={locale} />
      ) : activeTab === "bomHistory" ? (
        <BomHistory locale={locale} />
      ) : activeTab === "bomPatrol" ? (
        <BomPatrol locale={locale} />
      ) : activeTab === "bomAlerts" ? (
        <BomAlerts locale={locale} />
      ) : (
        <BomAiChat locale={locale} />
      )}
    </div>
  );
}

export function App() {
  // Read hash at init so manual-line-3d loads directly, no flash
  const initHash = typeof window !== "undefined" ? (() => {
    const queryView = new URLSearchParams(window.location.search).get("view");
    const hashView = window.location.hash.replace("#", "");
    // material-warehouse is a sub-view of the manual-line 3D dashboard, not an App module.
    return queryView === "material-warehouse" ? hashView : (queryView || hashView);
  })() : "";
  const directView: ModuleKey = modules.some(module => module.key === initHash)
    ? initHash as ModuleKey
    : initHash === "mobile" || initHash === "/mobile" ? "mobile" : initHash === "smt-line-3d" ? "manualLine3d" : initHash === "qrbinding-agent-2d" ? "qrbindingAgent2d" : initHash === "manual-line-3d" ? "manualLine3d" : initHash === "pda-agent-3d" ? "pdaAgent3d" : initHash === "aoi-agent-3d" ? "aoiAgent3d" : initHash === "ict-agent-3d" ? "ictAgent3d" : initHash === "fct-agent-3d" ? "fctAgent3d" : initHash === "assembly-ate-agent-3d" ? "assemblyAteAgent3d" : initHash === "supersonic-agent-3d" ? "supersonicAgent3d" : initHash === "aging-cab-agent-3d" ? "agingCabAgent3d" : initHash === "hivolt-ate-agent-3d" ? "highVoltAteAgent3d" : initHash === "packing-ate-agent-3d" ? "packingAteAgent3d" : initHash === "outer-box-binding-agent-3d" ? "outerBoxBindingAgent3d" : initHash === "depanel-agent-3d" ? "depanelAgent3d" : initHash === "qrbinding-agent-3d" ? "qrbindingAgent3d" : initHash === "mes-manager-console" ? "mesManagerConsole" : initHash === "team" || initHash === "/team" ? "team" : initHash === "mobileleave" || initHash === "/mobileleave" ? "mobileleave" : "dashboard";
  const [active, setActive] = useState<ModuleKey>(directView);
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const [currentUser, setCurrentUser] = useState<SignInResult | null>(() => {
    // Restore demo user from sessionStorage on hard refresh
    // DEV BYPASS: direct read-only factory monitoring views.
    if (initHash === "smt-line-3d") {
      return { token: "", username: "VN_OP_001", displayName: "SMT Operator", roleKey: "smt_operator", locale: "vi-VN", permissions: ["mes.view", "mes.execute", "pda.view"] };
    }
    // DEV BYPASS: auto-login for manual-line-3d
    if (initHash === "qrbinding-agent-2d" || initHash === "manual-line-3d" || initHash === "pda-agent-3d" || initHash === "aoi-agent-3d" || initHash === "ict-agent-3d" || initHash === "fct-agent-3d" || initHash === "assembly-ate-agent-3d" || initHash === "supersonic-agent-3d" || initHash === "aging-cab-agent-3d" || initHash === "hivolt-ate-agent-3d" || initHash === "packing-ate-agent-3d" || initHash === "outer-box-binding-agent-3d" || initHash === "depanel-agent-3d" || initHash === "qrbinding-agent-3d" || initHash === "mes-manager-console") {
      return {
        token: "",
        username: "VN_OP_001",
        displayName: "Operator 01",
        roleKey: "smt_operator",
        locale: "vi-VN",
        permissions: ["mes.view", "mes.execute", "line_start", "feeder_scan", "pcb_scan", "output", "downtime"],
      };
    }
    try {
      const stored = sessionStorage.getItem("demo_user");
      if (!stored) return null;
      const parsed = JSON.parse(stored) as SignInResult;
      // Ensure all required SignInResult fields exist
      if (!parsed.roleKey || !parsed.permissions) return null;
      return parsed;
    } catch { return null; }
  });

  useEffect(() => {
    if (!currentUser) return;
    const stream = new EventSource("/api/pda/events?node=mes_auto_loading_router&replay=0&types=SMT_LOADING_PDA_ACTIVITY");
    stream.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        if (event.type !== "SMT_LOADING_PDA_ACTIVITY" || event.payload?.activityType !== "CYCLE_STARTED") return;
        const url = new URL(window.location.href);
        url.searchParams.set("view", "mes");
        url.searchParams.set("mesTab", "smtMaterialBindings");
        window.history.replaceState({}, "", url);
        setActive("mes");
        window.setTimeout(() => window.dispatchEvent(new Event("mes:auto-open-smt-loading")), 0);
      } catch { /* keep the current MES screen on malformed events */ }
    };
    return () => stream.close();
  }, [currentUser]);

  useEffect(() => {
    const onFactoryNavigate = (event: Event) => {
      const view = (event as CustomEvent<{ view?: string }>).detail?.view;
      if (view && modules.some(module => module.key === view)) setActive(view as ModuleKey);
    };
    window.addEventListener("factory:navigate", onFactoryNavigate);
    return () => window.removeEventListener("factory:navigate", onFactoryNavigate);
  }, []);

  useEffect(() => {
    const syncDirectHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (hash === "smt-line-3d") setActive("manualLine3d");
      else if (hash === "manual-line-3d") setActive("manualLine3d");
      else if (hash === "pda-agent-3d") setActive("pdaAgent3d");
      else if (hash === "aoi-agent-3d") setActive("aoiAgent3d");
      else if (hash === "ict-agent-3d") setActive("ictAgent3d");
      else if (hash === "fct-agent-3d") setActive("fctAgent3d");
      else if (hash === "assembly-ate-agent-3d") setActive("assemblyAteAgent3d");
      else if (hash === "supersonic-agent-3d") setActive("supersonicAgent3d");
      else if (hash === "aging-cab-agent-3d") setActive("agingCabAgent3d");
      else if (hash === "hivolt-ate-agent-3d") setActive("highVoltAteAgent3d");
      else if (hash === "packing-ate-agent-3d") setActive("packingAteAgent3d");
      else if (hash === "outer-box-binding-agent-3d") setActive("outerBoxBindingAgent3d");
      else if (hash === "depanel-agent-3d") setActive("depanelAgent3d");
      else if (hash === "qrbinding-agent-2d") setActive("qrbindingAgent2d");
      else if (hash === "qrbinding-agent-3d") setActive("qrbindingAgent3d");
      else if (hash === "mobile" || hash === "/mobile" || hash === "team" || hash === "/team") setActive("team");
      else if (hash === "group-leader-pda" || hash === "/group-leader-pda") setActive("groupLeaderPda");
      else if (hash === "mobileleave" || hash === "/mobileleave") setActive("mobileleave");
      else if (hash === "mes-manager-console") setActive("mesManagerConsole");
      else if (hash === "smt-reel-consumption") setActive("smtReelConsumption");
      else if (hash === "pda-ui-designer") setActive("pdaUiDesigner");
      else if (hash === "management-ui-designer") setActive("managementUiDesigner");
    };
    window.addEventListener("hashchange", syncDirectHash);
    return () => window.removeEventListener("hashchange", syncDirectHash);
  }, []);

  // Persist demo user + real JWT so API calls work in demo mode
  async function handleSignIn(result: SignInResult) {
    sessionStorage.setItem("demo_user", JSON.stringify(result));
    // AuthSignIn already authenticated and returned the JWT. Reuse it instead
    // of issuing a second identical /auth/login request.
    if (result.token) {
      authStorage.setToken(result.token);
      setCurrentUser(result);
      return;
    }
    if (initHash === "group-leader-pda") {
      return { token: "", username: "PLANT_MANAGER", displayName: "Plant Manager", roleKey: "LINE_MANAGER", locale: "en-US", permissions: ["mes.view", "mes.execute", "smt.loading.approve", "pmc.work_order.release"] };
    }
    // Map demo usernames to the backend login name (only "admin" exists in hr_employees)
    const backendLogin = result.username === "ADMIN_VN_01" ? "admin" : result.username;
    try {
      const backendPassword = result.username === "MENG_YING" ? "my" : "Factory@123";
      const loginResult = await authApi.login(backendLogin, backendPassword);
      if (loginResult.token) {
        // Merge API user data (roleKey + permissions) with demo session data
        const apiUser = loginResult.user;
        const mergedUser = { ...result, roleKey: apiUser.roleKey, permissions: apiUser.permissions ?? [] };
        sessionStorage.setItem("demo_user", JSON.stringify(mergedUser));
        setCurrentUser(mergedUser);
        return; // skip setCurrentUser below — already set with merged data
      }
    } catch (_) { /* non-fatal */ }
    setCurrentUser(result);
  }

  if (!currentUser) {
    return <AuthSignIn locale={locale} onSignIn={handleSignIn} onSetLocale={setLocale} />;
  }

  const content = {
    smtLine3d: <LazySmtLineDashboard />,
    dashboard: <Dashboard locale={locale} setActive={setActive} />,
    pmc: <Pmc locale={locale} permissions={currentUser.permissions} />,
    mobile: <MobileCheckin locale={locale} />,
    qms: <QmsApp locale={locale} />,
    wms: <Wms locale={locale} permissions={currentUser.permissions} />,
    bom: <Bom locale={locale} />,
    mes: <Mes locale={locale} />,
    quality: <Quality locale={locale} />,
    trace: <Trace locale={locale} />,
    reports: <ReportsDashboard locale={locale} />,
    admin: <Admin locale={locale} />,
    hr: <Hr locale={locale} />,
    maintenance: <LazyFactory3D />,
    finance: <Finance locale={locale} permissions={currentUser.permissions} />,
    procurement: <Procurement locale={locale} permissions={currentUser.permissions} />,
    einvoice: <EInvoice locale={locale} permissions={currentUser.permissions} />,
    sales: <Sales locale={locale} permissions={currentUser.permissions} />,
    service: <Service locale={locale} permissions={currentUser.permissions} />,
    ai: <AiChat locale={locale} />,
    projects: <Projects locale={locale} />,
    projectMgmt: <ProjectMgmt locale={locale} />,
    andonBoard: <PmcAndonBoard locale={locale} />,
    agents: <AgentsModule locale={locale} currentUser={currentUser} />,
    employee: <EmployeePanel locale={locale} employeeId={Number(currentUser.username.replace(/\D/g, "")) || 1} onSignOut={async () => { sessionStorage.removeItem("demo_user"); sessionStorage.removeItem("auth_token"); await authApi.logout(); setCurrentUser(null); }} />,
    managerDashboard: <ManagerDashboard locale={locale} />,
    workflow: <WorkflowDashboard locale={locale} />,
    oa: <OaModule locale={locale} />,
    manualLine3d: <LazyManualLineDashboard />,
    pdaAgent3d: <LazyPdaStationMonitor locale={locale} />,
    aoiAgent3d: <LazyAoiStationMonitor locale={locale} />,
    ictAgent3d: <LazyIctStationMonitor locale={locale} />,
    fctAgent3d: <LazyFctStationMonitor locale={locale} />,
    assemblyAteAgent3d: <LazyAssemblyAteStationMonitor locale={locale} />,
    supersonicAgent3d: <LazySupersonicStationMonitor locale={locale} />,
    agingCabAgent3d: <LazyAgingCabStationMonitor locale={locale} />,
    highVoltAteAgent3d: <LazyHighVoltAteStationMonitor locale={locale} />,
    packingAteAgent3d: <LazyPackingAteStationMonitor locale={locale} />,
    outerBoxBindingAgent3d: <LazyOuterBoxBindingStationMonitor locale={locale} />,
    depanelAgent3d: <LazyDepanelStationMonitor locale={locale} />,
    qrbindingAgent2d: <LazyQrBindingStationMonitor locale={locale} viewMode="2d" />,
    qrbindingAgent3d: <LazyQrBindingStationMonitor locale={locale} />,
    mesManagerConsole: <MesManagerConsole locale={locale} />,
    smtReelConsumption: <SmtReelConsumptionPage locale={locale} />,
    pdaUiDesigner: <PdaUiDesigner locale={locale} />,
    managementUiDesigner: <ManagementUiDesigner />,
    safetyManager: <SafetyManager locale={locale} />,
    pdaCommMonitor: <PdaCommMonitor locale={locale} />,
    ambassadorDashboard: <AmbassadorDashboard locale={locale} onNavigate={(dim) => {
      const map: Record<string, ModuleKey> = {
        safety: "safetyManager",
        effectiveness: "effectivenessAmbassador",
        efficiency: "efficiencyAmbassador",
        swiftness: "swiftnessAmbassador",
        collaboration: "collaborationAmbassador",
      };
      if (map[dim]) setActive(map[dim]);
    }} />,
    effectivenessAmbassador: <EffectivenessAmbassador locale={locale} />,
    efficiencyAmbassador: <EfficiencyAmbassador locale={locale} />,
    swiftnessAmbassador: <SwiftnessAmbassador locale={locale} />,
    collaborationAmbassador: <CollaborationAmbassador locale={locale} />,
    team: <TeamLeaderApp locale={locale === "zh-CN" ? "zh" : locale === "vi-VN" ? "vi" : "en"} />,
    groupLeaderPda: <GroupLeaderPda locale={locale} />,
    mobileleave: <MobileLeave />,
  }[active];

  // DEV: manual-line-3d renders without Shell — full screen 3D
  if (active === "smtLine3d") return <LazySmtLineDashboard />;
  if (active === "manualLine3d") {
    return <LazyManualLineDashboard />;
  }
  if (active === "pdaAgent3d") {
    return <LazyPdaStationMonitor locale={locale} />;
  }
  if (active === "aoiAgent3d") {
    return <LazyAoiStationMonitor locale={locale} />;
  }
  if (active === "ictAgent3d") {
    return <LazyIctStationMonitor locale={locale} />;
  }
  if (active === "fctAgent3d") {
    return <LazyFctStationMonitor locale={locale} />;
  }
  if (active === "assemblyAteAgent3d") {
    return <LazyAssemblyAteStationMonitor locale={locale} />;
  }
  if (active === "supersonicAgent3d") {
    return <LazySupersonicStationMonitor locale={locale} />;
  }
  if (active === "agingCabAgent3d") {
    return <LazyAgingCabStationMonitor locale={locale} />;
  }
  if (active === "highVoltAteAgent3d") {
    return <LazyHighVoltAteStationMonitor locale={locale} />;
  }
  if (active === "packingAteAgent3d") {
    return <LazyPackingAteStationMonitor locale={locale} />;
  }
  if (active === "outerBoxBindingAgent3d") {
    return <LazyOuterBoxBindingStationMonitor locale={locale} />;
  }
  if (active === "depanelAgent3d") {
    return <LazyDepanelStationMonitor locale={locale} />;
  }
  if (active === "qrbindingAgent2d") {
    return <LazyQrBindingStationMonitor locale={locale} viewMode="2d" />;
  }
  if (active === "qrbindingAgent3d") {
    return <LazyQrBindingStationMonitor locale={locale} />;
  }
  if (active === "smtReelConsumption") {
    return <SmtReelConsumptionPage locale={locale} />;
  }
  if (active === "mesManagerConsole") {
    return <MesManagerConsole locale={locale} />;
  }
  if (active === "mobile") {
    return <MobileCheckin locale={locale} />;
  }
  if (active === "team") {
    return <TeamLeaderApp locale={locale === "zh-CN" ? "zh" : locale === "vi-VN" ? "vi" : "en"} />;
  }
  if (active === "groupLeaderPda") {
    return <GroupLeaderPda locale={locale} />;
  }
  if (active === "mobileleave") {
    return <MobileLeave />;
  }

  return (
    <Shell active={active} setActive={setActive} locale={locale} setLocale={setLocale} currentUser={currentUser} onSignOut={async () => {
      sessionStorage.removeItem("demo_user");
      sessionStorage.removeItem("auth_token");
      try {
        await authApi.logout();
      } finally {
        setCurrentUser(null);
      }
    }}>
      {content}
    </Shell>
  );
}

// ── API Route Registry ─────────────────────────────────────────────────────────

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface ApiRoute {
  method: HttpMethod;
  path: string;
}

interface ApiRouteGroup {
  groupKey: string;
  labelKey: string;
  routes: ApiRoute[];
}

const API_ROUTE_GROUPS: ApiRouteGroup[] = [
  { groupKey: "dashboard", labelKey: "admin.services.routes.dashboard", routes: [
    { method: "GET",  path: "/dashboard/summary" },
  ]},
  { groupKey: "auth", labelKey: "admin.services.routes.auth", routes: [
    { method: "POST", path: "/auth/login" },
    { method: "GET",  path: "/auth/session" },
    { method: "POST", path: "/auth/logout" },
  ]},
  { groupKey: "pmc", labelKey: "admin.services.routes.pmc", routes: [
    { method: "GET",    path: "/pmc/work-orders" },
    { method: "POST",   path: "/pmc/work-orders" },
    { method: "PATCH",  path: "/pmc/work-orders/:code" },
    { method: "POST",   path: "/pmc/work-orders/:code/complete" },
    { method: "PATCH",  path: "/pmc/work-orders/:code/freeze" },
    { method: "GET",    path: "/pmc/schedules" },
    { method: "GET",    path: "/pmc/customer-pos" },
    { method: "GET",    path: "/pmc/work-order-alerts" },
    { method: "GET",    path: "/pmc/work-order-qc-report" },
    { method: "GET",    path: "/pmc/work-order-gantt" },
    { method: "GET",    path: "/pmc/alert-channels" },
    { method: "PATCH",  path: "/pmc/alert-channels/:id" },
    { method: "POST",   path: "/pmc/alerts/send" },
    { method: "GET",    path: "/pmc/alert-history" },
    { method: "GET",    path: "/pmc/ng-reviews" },
    { method: "POST",   path: "/pmc/ng-reviews" },
    { method: "PATCH",  path: "/pmc/ng-reviews/:id" },
    { method: "POST",   path: "/pmc/ng-reviews/auto-import" },
    { method: "GET",    path: "/pmc/ng-summary" },
  ]},
  { groupKey: "wms", labelKey: "admin.services.routes.wms", routes: [
    { method: "GET",  path: "/wms/material-lots" },
    { method: "GET",  path: "/wms/storage-locations" },
    { method: "GET",  path: "/wms/stock" },
    { method: "GET",  path: "/wms/inventory-transactions" },
    { method: "GET",  path: "/wms/pick-orders" },
    { method: "POST", path: "/wms/transactions" },
    { method: "POST", path: "/wms/issue-to-line" },
    { method: "POST", path: "/wms/return-from-line" },
    { method: "POST", path: "/wms/scrap" },
    { method: "GET",  path: "/wms/shelf/list" },
    { method: "GET",  path: "/wms/shelf/status" },
    { method: "POST", path: "/wms/shelf/shelf-in" },
    { method: "POST", path: "/wms/shelf/shelf-out" },
    { method: "POST", path: "/wms/shelf/light-on" },
    { method: "POST", path: "/wms/shelf/remove-label" },
  ]},
  { groupKey: "mes", labelKey: "admin.services.routes.mes", routes: [
    { method: "GET",  path: "/mes/lines" },
    { method: "GET",  path: "/mes/lines/:lineCode" },
    { method: "GET",  path: "/mes/stations" },
    { method: "GET",  path: "/mes/stations/:code" },
    { method: "GET",  path: "/mes/station-flow" },
    { method: "GET",  path: "/mes/events" },
    { method: "GET",  path: "/mes/events/upstream-check/:pcbSerial" },
    { method: "POST", path: "/mes/heartbeat/:stationCode" },
    { method: "GET",  path: "/mes/heartbeats" },
    { method: "GET",  path: "/mes/heartbeats/stream" },
    { method: "GET",  path: "/mes/runs" },
    { method: "GET",  path: "/mes/runs/:id" },
    { method: "POST", path: "/mes/runs/:id/close" },
    { method: "GET",  path: "/mes/process-routes" },
    { method: "GET",  path: "/mes/process-routes/:id" },
    { method: "GET",  path: "/mes/process-routes/:id/steps" },
    { method: "GET",  path: "/mes/feeder-bindings" },
    { method: "POST", path: "/mes/feeder-bindings/:id" },
    { method: "GET",  path: "/mes/first-article-inspections" },
    { method: "PATCH", path: "/mes/first-article-inspections/:id" },
    { method: "GET",  path: "/mes/material-verifications" },
    { method: "GET",  path: "/mes/fool-proof-rules" },
    { method: "GET",  path: "/mes/work-order-requirements" },
    { method: "GET",  path: "/mes/andon-board" },
    { method: "GET",  path: "/mes/trace/:serialNo" },
    { method: "GET",  path: "/mes/sn-duplicate-attempts" },
    { method: "GET",  path: "/mes/scrap-reason-codes" },
    { method: "GET",  path: "/mes/scraps" },
    { method: "GET",  path: "/mes/scraps/:id" },
    { method: "GET",  path: "/mes/downtimes" },
    { method: "PATCH", path: "/mes/downtimes/:id" },
    { method: "GET",  path: "/mes/stagnation" },
    { method: "PATCH", path: "/mes/stagnation/:id/resolve" },
    { method: "GET",  path: "/mes/stagnation/alerts" },
    { method: "GET",  path: "/mes/stagnation/thresholds" },
    // stations
    { method: "POST", path: "/mes/stations/scan" },
    { method: "POST", path: "/mes/stations/print" },
    { method: "POST", path: "/mes/stations/spi" },
    { method: "POST", path: "/mes/stations/smt-aoi" },
    { method: "POST", path: "/mes/stations/ict" },
    { method: "POST", path: "/mes/stations/fct" },
    { method: "POST", path: "/mes/stations/aoi" },
    { method: "POST", path: "/mes/stations/assy-ate" },
    { method: "POST", path: "/mes/stations/hipot" },
    { method: "POST", path: "/mes/stations/laser-mark" },
    { method: "POST", path: "/mes/stations/nxt-placer" },
    { method: "POST", path: "/mes/stations/depanel" },
    { method: "POST", path: "/mes/stations/pack" },
    { method: "POST", path: "/mes/stations/shell-bind" },
    { method: "POST", path: "/mes/stations/ultrasonic" },
    { method: "GET",  path: "/mes/stations/:code/events" },
    { method: "GET",  path: "/mes/stations/:code/ng-defects" },
    { method: "POST", path: "/mes/stations/ai-insert" },
    { method: "GET",  path: "/mes/ng-registry/check" },
    { method: "GET",  path: "/mes/pcb-serials" },
    { method: "GET",  path: "/mes/pcb-serials/:serialNo" },
  ]},
  { groupKey: "hr", labelKey: "admin.services.routes.hr", routes: [
    { method: "GET",  path: "/hr/employees" },
    { method: "GET",  path: "/hr/employees/:code" },
    { method: "GET",  path: "/hr/employees/:id/avatar" },
    { method: "GET",  path: "/hr/employees/:id/qr-image" },
    { method: "GET",  path: "/hr/employees/:id/qr-code" },
    { method: "GET",  path: "/hr/employees/:id/qr-code/audit" },
    { method: "GET",  path: "/hr/employees/qr-code/scan" },
    { method: "GET",  path: "/hr/employees/qr-code/batch" },
    { method: "GET",  path: "/hr/attendance" },
    { method: "POST", path: "/hr/attendance/clock-in" },
    { method: "POST", path: "/hr/attendance/clock-out" },
    { method: "GET",  path: "/hr/attendance/daily" },
    { method: "GET",  path: "/hr/attendance/monthly/:employeeId" },
    { method: "GET",  path: "/hr/attendance/shift-summary" },
    { method: "POST", path: "/hr/attendance/sync" },
    { method: "GET",  path: "/hr/leave-requests" },
    { method: "GET",  path: "/hr/leave-requests/:id" },
    { method: "GET",  path: "/hr/leave-balances/:employeeId" },
    { method: "GET",  path: "/hr/shifts" },
    { method: "GET",  path: "/hr/shift-schedules" },
    { method: "PATCH", path: "/hr/shift-schedules/:id" },
    { method: "GET",  path: "/hr/departments" },
    { method: "GET",  path: "/hr/positions" },
    { method: "GET",  path: "/hr/org-chart" },
    { method: "GET",  path: "/hr/dashboard" },
    { method: "GET",  path: "/hr/performance/reviews" },
    { method: "GET",  path: "/hr/performance/reviews/:id" },
    { method: "GET",  path: "/hr/performance/kpis" },
    { method: "GET",  path: "/hr/salary/records" },
    { method: "GET",  path: "/hr/salary/employees/:id/summary" },
  ]},
  { groupKey: "boms", labelKey: "admin.services.routes.boms", routes: [
    { method: "GET",    path: "/boms" },
    { method: "POST",   path: "/boms" },
    { method: "GET",    path: "/boms/:id" },
    { method: "PATCH",  path: "/boms/:id/status" },
    { method: "DELETE", path: "/boms/:id" },
    { method: "POST",   path: "/boms/import" },
    { method: "GET",    path: "/boms/:id/history" },
    { method: "POST",   path: "/boms/:id/history" },
    { method: "GET",    path: "/boms/product/:code" },
  ]},
  { groupKey: "quality", labelKey: "admin.services.routes.quality", routes: [
    { method: "GET", path: "/quality/records" },
    { method: "GET", path: "/quality/records/:id" },
    { method: "GET", path: "/quality/defect-pareto" },
  ]},
  { groupKey: "ai", labelKey: "admin.services.routes.ai", routes: [
    { method: "GET",  path: "/ai/health" },
    { method: "POST", path: "/ai/chat" },
    { method: "POST", path: "/ai/query/inventory" },
    { method: "POST", path: "/ai/query/traceability" },
    { method: "POST", path: "/ai/report" },
  ]},
  { groupKey: "lifecycle", labelKey: "admin.services.routes.lifecycle", routes: [
    { method: "GET",  path: "/lifecycle/lots" },
    { method: "GET",  path: "/lifecycle/materials" },
    { method: "GET",  path: "/lifecycle/alerts" },
    { method: "GET",  path: "/lifecycle/alert-status/:lotId" },
    { method: "GET",  path: "/lifecycle/alerts-with-actions" },
    { method: "GET",  path: "/lifecycle/scrapping" },
    { method: "PATCH", path: "/lifecycle/scrapping/:id" },
    { method: "GET",  path: "/lifecycle/reinspection" },
    { method: "GET",  path: "/lifecycle/stats" },
    { method: "GET",  path: "/lifecycle/summary" },
    { method: "GET",  path: "/lifecycle/pg" },
    { method: "GET",  path: "/lifecycle/openings" },
  ]},
  { groupKey: "shelf", labelKey: "admin.services.routes.shelf", routes: [
    { method: "GET",  path: "/shelf/racks" },
    { method: "GET",  path: "/shelf/cells" },
    { method: "GET",  path: "/shelf/cells/:shelfCode" },
    { method: "GET",  path: "/shelf/summary" },
    { method: "GET",  path: "/shelf/stream" },
    { method: "POST", path: "/shelf/ShelfInGY" },
    { method: "POST", path: "/shelf/ShelfOutGY" },
    { method: "POST", path: "/shelf/LightOnAllEmptyLocationGY" },
    { method: "POST", path: "/shelf/InventoryRemoveLableGY" },
    { method: "GET",  path: "/shelf/all-bins" },
    { method: "GET",  path: "/shelf/labels" },
    { method: "DELETE", path: "/shelf/labels/:id" },
  ]},
  { groupKey: "labels", labelKey: "admin.services.routes.labels", routes: [
    { method: "GET", path: "/labels/work-order/:code" },
    { method: "GET", path: "/labels/work-order/:code/bom" },
    { method: "GET", path: "/labels/print-data/:code" },
  ]},
  { groupKey: "trace", labelKey: "admin.services.routes.trace", routes: [
    { method: "GET", path: "/traceability/:traceKey" },
    { method: "GET", path: "/traceability/events" },
  ]},
  { groupKey: "admin", labelKey: "admin.services.routes.admin", routes: [
    { method: "GET", path: "/admin/users" },
    { method: "GET", path: "/admin/roles" },
    { method: "GET", path: "/admin/audit-logs" },
  ]},
  { groupKey: "meta", labelKey: "admin.services.routes.meta", routes: [
    { method: "GET", path: "/meta/bootstrap" },
    { method: "GET", path: "/meta/lookups" },
    { method: "GET", path: "/meta/i18n/:locale" },
  ]},
  { groupKey: "reports", labelKey: "admin.services.routes.reports", routes: [
    { method: "GET", path: "/reports" },
    { method: "GET", path: "/reports/:reportKey" },
  ]},
  { groupKey: "misc", labelKey: "admin.services.routes.misc", routes: [
    { method: "GET",  path: "/quick-search" },
    { method: "GET",  path: "/sql/tables" },
    { method: "POST", path: "/sql" },
    { method: "GET",  path: "/service/agents" },
    { method: "POST", path: "/service/chat/:agentId" },
    { method: "GET",  path: "/aging/ng_registry/check" },
    { method: "GET",  path: "/recipes/:productCode/:revision" },
    { method: "GET",  path: "/shifts/:lineCode/:date" },
    { method: "GET",  path: "/materials/:code/spec" },
  ]},
];

// ── SystemMonitor ─────────────────────────────────────────────────────────────────

type ServiceTier = "frontend" | "backend" | "database" | "ai";

interface ServiceDef {
  key: string;
  labelKey: string;
  url: string;
  port: number;
  method?: "http" | "tcp" | "api";
  tier: ServiceTier;
  timeout?: number;
}

interface ServiceState {
  key: string;
  labelKey: string;
  port: number;
  tier: ServiceTier;
  status: "up" | "down" | "warning" | "checking";
  responseMs: number | null;
  error?: string;
  lastCheck: Date | null;
}

const SERVICE_DEFS: ServiceDef[] = [
  { key: "api",        labelKey: "admin.services.flow.api",        url: "http://127.0.0.1:8080/health",            port: 8080, tier: "backend",  method: "api" },
  { key: "postgres",   labelKey: "admin.services.flow.postgres",   url: "http://127.0.0.1:8080/health",            port: 5432, tier: "database", method: "tcp" },
  { key: "web_prod",   labelKey: "admin.services.tier.frontend",   url: "http://127.0.0.1:5178/",                 port: 5178, tier: "frontend", method: "http" },
  { key: "web_dev",    labelKey: "admin.services.flow.viteDev",     url: "http://127.0.0.1:5173/",                 port: 5173, tier: "frontend", method: "http" },
  { key: "scanner_fe", labelKey: "admin.services.flow.scannerFe",  url: "http://127.0.0.1:5174/",                 port: 5174, tier: "frontend", method: "http" },
  { key: "scanner_be", labelKey: "admin.services.flow.scannerBe",  url: "http://127.0.0.1:5199/api/state",        port: 5199, tier: "backend",  method: "api" },
  { key: "ollama",     labelKey: "admin.services.flow.ollama",      url: "http://127.0.0.1:11434/",                port: 11434, tier: "ai",      method: "http" },
];

async function checkService(def: ServiceDef): Promise<Omit<ServiceState, "key" | "labelKey" | "port" | "tier">> {
  const start = Date.now();
  try {
    if (def.method === "tcp") {
      // TCP check via a lightweight HEAD/GET won't work for PG — use a dedicated endpoint
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), def.timeout ?? 3000);
      const res = await fetch("http://127.0.0.1:8080/health", { signal: controller.signal });
      clearTimeout(tid);
      if (res.ok) return { status: "up", responseMs: Date.now() - start, lastCheck: new Date() };
      return { status: "down", responseMs: Date.now() - start, error: `HTTP ${res.status}`, lastCheck: new Date() };
    }
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), def.timeout ?? 5000);
    const res = await fetch(def.url, { signal: controller.signal, method: def.method === "api" ? "GET" : "GET" });
    clearTimeout(tid);
    const ms = Date.now() - start;
    if (!res.ok) return { status: "down", responseMs: ms, error: `HTTP ${res.status}`, lastCheck: new Date() };
    // API health endpoint might return {ok:true} but with degraded state
    if (def.key === "ollama") {
      try {
        const body = await res.json();
        if (body?.data?.reachable === false || body?.modelAvailable === false)
          return { status: "warning", responseMs: ms, error: "model not loaded", lastCheck: new Date() };
      } catch { /* ok */ }
    }
    return { status: "up", responseMs: ms, lastCheck: new Date() };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("timeout") || msg.includes("Timeout");
    return { status: "down", responseMs: null, error: isTimeout ? "timeout" : msg, lastCheck: new Date() };
  }
}

function SystemMonitor({ locale }: { locale: Locale }) {
  const [services, setServices] = useState<ServiceState[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFullCheck, setLastFullCheck] = useState<Date | null>(null);
  const [reqCount, setReqCount] = useState(0);
  const [showArch, setShowArch] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["pmc", "mes", "hr", "wms"]));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const archRef = useRef<HTMLDivElement>(null);

  // Load & render Mermaid diagram once when toggled
  useEffect(() => {
    if (!showArch) return;
    const render = () => {
      if (archRef.current && (window as unknown as Record<string, unknown>).mermaid) {
        void (window as unknown as Record<string, unknown>).mermaid;
        const { mermaid } = window as unknown as Record<string, { run: (el: HTMLElement) => Promise<void> }>;
        if (mermaid?.run) {
          void mermaid.run(archRef.current);
        }
      }
    };
    const loadMermaid = () => {
      if ((window as unknown as Record<string, unknown>).mermaid) { render(); return; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
      s.onload = render;
      document.head.appendChild(s);
    };
    const tid = setTimeout(loadMermaid, 50);
    return () => clearTimeout(tid);
  }, [showArch]);

  const refreshAll = useCallback(async () => {
    setServices((prev) =>
      prev.length === 0
        ? SERVICE_DEFS.map((d) => ({ key: d.key, labelKey: d.labelKey, port: d.port, tier: d.tier, status: "checking", responseMs: null, lastCheck: null }))
        : prev.map((s) => ({ ...s, status: "checking" as const }))
    );
    setReqCount((c) => c + SERVICE_DEFS.length);
    const results = await Promise.allSettled(SERVICE_DEFS.map(async (def) => {
      const result = await checkService(def);
      return { key: def.key, labelKey: def.labelKey, port: def.port, tier: def.tier, ...result };
    }));
    const updated: ServiceState[] = results.map((r, i) => {
      if (r.status === "fulfilled") return r.value as ServiceState;
      return { key: SERVICE_DEFS[i].key, labelKey: SERVICE_DEFS[i].labelKey, port: SERVICE_DEFS[i].port, tier: SERVICE_DEFS[i].tier, status: "down", responseMs: null, error: String(r.reason), lastCheck: new Date() };
    });
    setServices(updated);
    setLastFullCheck(new Date());
  }, []);

  useEffect(() => {
    void refreshAll();
    if (autoRefresh) {
      intervalRef.current = setInterval(() => { void refreshAll(); }, 5000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, refreshAll]);

  const tierGroups: Record<ServiceTier, ServiceState[]> = {
    frontend: services.filter((s) => s.tier === "frontend"),
    backend:  services.filter((s) => s.tier === "backend"),
    database: services.filter((s) => s.tier === "database"),
    ai:       services.filter((s) => s.tier === "ai"),
  };

  const statusTone = (st: ServiceState["status"]) =>
    st === "up" ? "ok" : st === "down" ? "danger" : st === "warning" ? "warning" : "muted";

  const statusLabel = (st: ServiceState["status"]) =>
    st === "up" ? t("admin.services.up", locale) :
    st === "down" ? t("admin.services.down", locale) :
    st === "warning" ? t("admin.services.warning", locale) :
    "…";

  const tierLabel = (tier: ServiceTier) => t(`admin.services.tier.${tier}` as TranslationKey, locale);

  // Data flow arrows: Browser → [Web FE] → API → [PostgreSQL / Scanner BE]
  //                      Browser → [Scanner FE] → Scanner BE
  const flowUp   = services.some((s) => s.status === "up");
  const flowDb    = tierGroups.database.some((s) => s.status === "up");
  const flowAi    = tierGroups.ai.some((s) => s.status === "up");
  const flowScan  = tierGroups.backend.find((s) => s.key === "scanner_be")?.status === "up";

  return (
    <div style={{ padding: "0 1rem 1rem" }}>
      {/* Architecture diagram toggle */}
      <SurfacePanel style={{ marginBottom: "0.75rem" }}>
        <button
          type="button"
          className="action-button"
          style={{ marginBottom: showArch ? "0.75rem" : 0, fontSize: "0.8rem" }}
          onClick={() => setShowArch((v) => !v)}
        >
          {showArch ? "▲ " : "▼ "}{t("admin.services.arch", locale)}
        </button>
        {showArch && (
          <div className="mermaid" ref={archRef}>
{`graph LR
    Browser["🌐 Browser<br/>(Chrome/Edge)"]
    ViteFE["⚡ Vite Dev<br/>:5173 / Prod :5178"]
    APIGateway["🚀 API 网关<br/>:8080 Express"]
    PG["🐘 PostgreSQL<br/>:5432"]
    ScannerFE["🖥 扫描终端前端<br/>:5174 Vite"]
    ScannerBE["🐍 扫描终端后端<br/>:5199 Flask"]
    OllamaLLM["🤖 Ollama LLM<br/>:11434"]

    Browser --> ViteFE
    ViteFE --> APIGateway
    APIGateway --> PG
    Browser --> ScannerFE
    ScannerFE --> ScannerBE
    ScannerBE --> PG
    APIGateway -.-> OllamaLLM

    style Browser fill:#e3f2fd,stroke:#1565c0
    style ViteFE fill:#fff3e0,stroke:#e65100
    style APIGateway fill:#e8f5e9,stroke:#2e7d32
    style PG fill:#f3e5f5,stroke:#6a1b9a
    style ScannerFE fill:#fff3e0,stroke:#e65100
    style ScannerBE fill:#fce4ec,stroke:#c62828
    style OllamaLLM fill:#f1f8e9,stroke:#558b2f`}
          </div>
        )}
      </SurfacePanel>

      {/* Data flow bar */}
      <SurfacePanel>
        <SectionHeader title={t("admin.services.dataFlow", locale)} subtitle="" />
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.5rem 0" }}>
          <Badge tone={flowUp ? "ok" : "danger"}>
            {t("admin.services.flow.browser", locale)}
          </Badge>
          <span style={{ color: "var(--muted)", fontSize: "1.2rem" }}>→</span>
          <Badge tone={tierGroups.frontend.some((s) => s.status === "up") ? "ok" : "danger"}>
            {t("admin.services.tier.frontend", locale)}
          </Badge>
          <span style={{ color: "var(--muted)", fontSize: "1.2rem" }}>→</span>
          <Badge tone={tierGroups.backend.some((s) => s.status === "up") ? "ok" : "danger"}>
            {t("admin.services.flow.api", locale)}
          </Badge>
          <span style={{ color: "var(--muted)", fontSize: "1.2rem" }}>→</span>
          <Badge tone={flowDb ? "ok" : "danger"}>{t("admin.services.flow.postgres", locale)}</Badge>
          {flowScan && <>
            <span style={{ color: "var(--muted)", fontSize: "1.2rem" }}>  ·  </span>
            <Badge tone="warning">{t("admin.services.flow.scanner", locale)}</Badge>
          </>}
          {flowAi && <>
            <span style={{ color: "var(--muted)", fontSize: "1.2rem" }}>  ·  </span>
            <Badge tone={tierGroups.ai.some((s) => s.status === "warning") ? "warning" : "ok"}>
              {t("admin.services.flow.ollama", locale)}
            </Badge>
          </>}
        </div>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
          <span>{t("admin.services.requests", locale)}: <strong>{reqCount}</strong></span>
          <span>·</span>
          <span>{t("admin.services.lastCheck", locale)}: <strong>{lastFullCheck ? lastFullCheck.toLocaleTimeString() : "—"}</strong></span>
          <span>·</span>
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            {t("admin.services.autoRefresh", locale)} (5s)
          </label>
          <button type="button" className="action-button" style={{ marginLeft: "auto", padding: "0.2rem 0.8rem", fontSize: "0.8rem" }} onClick={() => { void refreshAll(); }}>
            {t("admin.services.refresh", locale)}
          </button>
        </div>
      </SurfacePanel>

      {/* Service tables by tier */}
      {(Object.keys(tierGroups) as ServiceTier[]).map((tier) => {
        const group = tierGroups[tier];
        if (group.length === 0) return null;
        return (
          <SurfacePanel key={tier} style={{ marginTop: "0.75rem" }}>
            <SectionHeader title={tierLabel(tier)} subtitle={`${group.filter((s) => s.status === "up").length}/${group.length} ${t("admin.services.up", locale)}`} />
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>{t("admin.services.serviceName", locale)}</th>
                  <th>{t("admin.services.port", locale)}</th>
                  <th>{t("admin.services.status", locale)}</th>
                  <th>{t("admin.services.responseTime", locale)}</th>
                  <th>{t("admin.services.lastCheck", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {group.map((s) => (
                  <tr key={s.key} style={{ opacity: s.status === "checking" ? 0.5 : 1 }}>
                    <td>
                      <strong>{t(s.labelKey as TranslationKey, locale)}</strong>
                      {s.error && <span style={{ color: "var(--danger)", fontSize: "0.75rem", marginLeft: "0.5rem" }}>{s.error}</span>}
                    </td>
                    <td><code>:{s.port}</code></td>
                    <td><Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge></td>
                    <td>
                      {s.responseMs != null
                        ? <span style={{ color: s.responseMs > 2000 ? "var(--warning)" : "inherit" }}>{s.responseMs}ms</span>
                        : "—"}
                    </td>
                    <td style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      {s.lastCheck ? s.lastCheck.toLocaleTimeString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SurfacePanel>
        );
      })}

      {/* API Routes registry */}
      <SurfacePanel style={{ marginTop: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0" }}>
          <button
            type="button"
            className="action-button"
            style={{ fontSize: "0.8rem", padding: "0.2rem 0.8rem" }}
            onClick={() => setShowRoutes((v) => !v)}
          >
            {showRoutes ? "▲ " : "▼ "}{t("admin.services.routes.title", locale)}
          </button>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            {API_ROUTE_GROUPS.reduce((acc, g) => acc + g.routes.length, 0)} endpoints · 16 modules
          </span>
        </div>

        {showRoutes && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.5rem" }}>
            {API_ROUTE_GROUPS.map((group) => {
              const isOpen = expandedGroups.has(group.groupKey);
              return (
                <div key={group.groupKey} style={{ border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedGroups((prev) => {
                        const next = new Set(prev);
                        next.has(group.groupKey) ? next.delete(group.groupKey) : next.add(group.groupKey);
                        return next;
                      });
                    }}
                    style={{
                      width: "100%", padding: "0.4rem 0.6rem", background: "var(--nav)", border: "none",
                      cursor: "pointer", textAlign: "left", color: "var(--fg)", fontSize: "0.8rem",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <span>
                      {isOpen ? "▼" : "▶"} <strong>{t(group.labelKey as TranslationKey, locale)}</strong>
                      <span style={{ marginLeft: "0.4rem", color: "var(--muted)", fontSize: "0.7rem" }}>
                        ({group.routes.length})
                      </span>
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: "0.3rem 0.5rem 0.5rem", background: "var(--surface)" }}>
                      {group.routes.map((route) => {
                        const methodColor =
                          route.method === "GET"    ? "#2e7d32" :
                          route.method === "POST"   ? "#1565c0" :
                          route.method === "PATCH"  ? "#e65100" :
                          route.method === "PUT"    ? "#6a1b9a" :
                          route.method === "DELETE" ? "#c62828" : "#555";
                        return (
                          <div key={route.path} style={{ display: "flex", gap: "0.4rem", padding: "0.15rem 0", alignItems: "baseline", fontSize: "0.72rem" }}>
                            <span style={{ color: methodColor, fontWeight: 700, minWidth: "3.5rem" }}>{route.method}</span>
                            <code style={{ color: "var(--text)", fontSize: "0.7rem", wordBreak: "break-all" }}>{route.path}</code>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SurfacePanel>
    </div>
  );
}
