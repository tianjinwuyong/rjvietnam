export { apiClient, authStorage, API_BASE } from "./client";
export type { ApiError, Envelope, ListEnvelope, MutateEnvelope, ApiClientError } from "./client";

export { authApi } from "./auth";
export type { LoginResult, SessionResult } from "./auth";

export { wmsApi } from "./wms";
export type {
  MaterialLot,
  StorageLocation,
  StockRow,
  InventoryTransaction,
  WmsDashboardSummary,
  ReceivingLot,
  PdaInspectionRecord,
} from "./wms";

export { pmcApi } from "./pmc";
export { bomApi } from "./bom";
export type {
  WorkOrder, Schedule, CustomerPo, PmcDashboardSummary,
  PmcClosedLoopDashboard, PmcClosedLoopPlan, PmcPlanReviewType, PmcPlanReviewResult,
} from "./pmc";

export { mesApi } from "./mes";
export { stationQueryApi } from "./stationQuery";
export { qualityApi } from "./quality";
export { hrApi } from "./hr";
export type {
  Department,
  OrgChartNode,
  Employee,
  EmployeeDetail,
  Position,
  LeaveRequest,
  AttendanceRecord,
  HrDashboardSummary,
  PerformanceReview,
  PerformanceKpi,
  PerformanceReviewItem,
  TrainingCourse,
  TrainingPlan,
  TrainingSession,
  TrainingRecord,
  TrainingVideo,
  TrainingVideoQuery,
  CreateTrainingVideoPayload,
  OnboardingTemplate,
  OnboardingEmployee,
  OnboardingTaskInstance,
  OffboardingEmployee,
  OffboardingTaskInstance,
  AttendanceMonthlyStat,
  AttendanceClockDetail,
  AttendanceRule,
  PerfKpiTemplate,
  PerfKpiTemplateItem,
  EmpKpiResult,
  PerfScoreSummary,
  RewardCategory,
  EmployeeReward,
  PeriodicBonus,
  SwapRequest, SwapRecord,
  OtPayRule, OtRecord,
  SkillCategory, SkillLevel, SkillItem, EmployeeSkillRating, SkillRatingDetail,
  TeamworkMetric, EmployeeTeamworkRating,
  RewardProgram, RewardNomination, PeerRecognition,
  // Training 174
  CertType, EmployeeCertification, CertificationExam, ExamEnrollment,
  ExamQuestion, CertApproval, ApprovalStep,
  TrainingPlanDetail, TrainingAttendance, TrainingTracking,
} from "./hr";
export type {
  ProductionLine,
  LineDetail,
  Station,
  StationWithEvents,
  ProcessRoute,
  ProcessRouteStep,
  ProcessRouteDetail,
  MesRun,
  MesRunDetail,
  OeeComponents,
  FeederBinding,
  PcbSerial,
  PcbSerialDetail,
  StationEvent,
  Downtime,
  PcbTrace,
} from "./mes";

export { projectsApi } from "./projects";
export type { AppEntry, ProjectFormData } from "../projects/index";

export { getAiHealth, postAiChat } from "./ai";
export type { AiHealth, AiChatRequest, AiChatResponse } from "./ai";

export { maintenanceApi } from "./maintenance";
export type { MaintenanceDashboardSummary } from "./maintenance";

export { reportsApi } from "./reports";
export type { ReportKey, ReportDefinition, ReportData, ReportColumn, ReportMeta } from "./reports";

export { sparePartsApi } from "./spareparts";
export type { SparePart, PartsWearSchedule, PartsConsumptionLog, PartsWearAlert } from "./spareparts";

export { financeApi } from "./finance";
export type {
  ArInvoice, ApInvoice, PaymentRecord, GlAccount, GlJournalEntry,
  WoCostSummary, DashboardSummary, AgingBucket,
} from "./finance";

export { procurementApi } from "./procurement";
export type {
  ProcurementContract, PurchaseOrderHeader, SupplierScorecard,
  ProcurementDashboardSummary, ContractApprovalTask, ContractApprovalHistory,
} from "./procurement";

export { salesApi } from "./sales";
export type {
  SalesOrder, SalesQuote, SalesQuoteLine, SalesOrderLine,
  SalesDashboardSummary, QuoteToWorkOrderLink,
} from "./sales";

export { einvoiceApi } from "./einvoice";
export type {
  EinvoiceInvoice, EinvoiceConfig, EinvoiceApiLog, EinvoiceDashboardSummary,
} from "./einvoice";

export { pdaApi } from "./pda";
export type {
  PdaDevice, PdaDeviceStatus, PdaAssignment, PdaAssignmentAction,
  PdaRepair, PdaRepairCategory, PdaRepairSeverity, PdaRepairStatus,
  PdaSoftwareVersion, PdaAuditEntry, PdaAuditEventType,
  PdaHeartbeat, PdaDashboardSummary,
} from "./pda";

export { qmsApi } from "./qms";
export type {
  QmsOqcBatch, QmsOqcItem, QmsEightD, QmsNgCase, QmsKpiSummary, QmsCustomerStandard,
} from "./qms";

export { repairStationApi } from "./repairStation";
export type { RepairStationContextResponse } from "./repairStation";
