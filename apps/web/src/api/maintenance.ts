import { apiClient, type ListEnvelope } from "./client";

const apiGet = <T = unknown>(path: string, params?: Record<string, unknown>) => apiClient.get<T>(path, params);
const apiPost = <T = unknown>(path: string, body?: unknown) => apiClient.post<T>(path, body);
const apiPatch = <T = unknown>(path: string, body?: unknown) => apiClient.patch<T>(path, body);
const api = {
  get: async <T = unknown>(path: string, config?: { params?: Record<string, unknown> }) => ({ data: await apiClient.get<T>(path, config?.params) }),
  post: async <T = unknown>(path: string, body?: unknown) => ({ data: await apiClient.post<T>(path, body) }),
  patch: async <T = unknown>(path: string, body?: unknown) => ({ data: await apiClient.patch<T>(path, body) }),
};
import {
  equipmentList as _demoEquipment,
  maintenanceRecords as _demoRecords,
  _demoInspectionTemplates,
  _demoInspectionAssignments,
  _demoInspectionRecords,
  _demoInspectionAbnormals,
  _demoMachineOeeLogs,
  _demoMachineStatusSnapshots,
  _demoPmTemplates,
  _demoPmScheduleAssignments,
  _demoPmExecutionLogs,
} from "../data";
import type {
  Equipment,
  MaintenanceRecord,
  InspectionTemplate,
  InspectionTemplateItem,
  InspectionAssignment,
  InspectionRecord,
  InspectionRecordItem,
  InspectionAbnormal,
  MachineOeeLog,
  MachineStatusSnapshot,
  PmFrequency,
  PmTemplate,
  PmTemplateTask,
  PmScheduleAssignment,
  PmExecutionLog,
  ChecklistTemplate,
  CheckingRecord,
  CheckingRecordDetail,
  ChecklistSchedule,
  ComplianceSummary,
  ComplianceByEquipment,
  ComplianceByInspector,
} from "../../../../packages/shared-types/src/factory";

export type {
  Equipment,
  MaintenanceRecord,
  InspectionTemplate,
  InspectionTemplateItem,
  InspectionAssignment,
  InspectionRecord,
  InspectionRecordItem,
  InspectionAbnormal,
  MachineOeeLog,
  MachineStatusSnapshot,
  PmFrequency,
  PmTemplate,
  PmTemplateTask,
  PmScheduleAssignment,
  PmExecutionLog,
};

export interface MaintenanceDashboardSummary {
  totalEquipment: number;
  online: number;
  fault: number;
  inMaintenance: number;
  offline: number;
  pendingMaintenance: number;
  overdueMaintenance: number;
  pendingInspections: number;
  completedInspectionsToday: number;
  openAbnormals: number;
  overduePmSchedules: number;
}



// ═══ P2: Consumables + Fixtures Types (Migration 197) ═══

export interface Consumable {
  id: number;
  item_code: string;
  name_zh: string;
  name_en?: string;
  name_vi?: string;
  category: string;
  tracking_mode: 'count' | 'time' | 'dual';
  equipment_type?: string;
  equipment_asset_id?: string;
  specification?: string;
  material?: string;
  manufacturer?: string;
  model_no?: string;
  unit: string;
  unit_cost: number;
  current_stock: number;
  min_stock: number;
  location_code?: string;
  expected_life_count?: number;
  expected_life_hours?: number;
  current_usage_count: number;
  current_usage_hours: number;
  life_percentage: number;
  life_status: string;
  installed_at?: string;
  replaced_at?: string;
  storage_temp_min?: number;
  storage_temp_max?: number;
  opened_at?: string;
  expiry_after_open_hours?: number;
  batch_no?: string;
  tension_value?: number;
  tension_min?: number;
  tension_max?: number;
  last_tension_check?: string;
  vn_lead_time_days?: number;
  customs_clearance_days?: number;
  supplier?: string;
  status: string;
  notes?: string;
}

export interface ConsumableUsageLog {
  id: number;
  consumable_id: number;
  usage_type: string;
  usage_count: number;
  usage_hours: number;
  source: string;
  equipment_asset_id?: string;
  work_order_no?: string;
  operator_name?: string;
  notes?: string;
  logged_at: string;
}

export interface Fixture {
  id: number;
  fixture_code: string;
  name_zh: string;
  name_en?: string;
  name_vi?: string;
  fixture_type: string;
  product_code?: string;
  product_name?: string;
  equipment_type?: string;
  equipment_asset_id?: string;
  manufacturer?: string;
  model_no?: string;
  serial_no?: string;
  max_usage_count?: number;
  current_usage_count: number;
  usage_percentage: number;
  usage_status: string;
  storage_location?: string;
  storage_zone?: string;
  current_location?: string;
  cleaning_interval_uses?: number;
  uses_since_cleaning: number;
  last_cleaned_at?: string;
  cleaning_method?: string;
  calibration_interval_days?: number;
  last_calibration_date?: string;
  next_calibration_date?: string;
  calibration_status: string;
  status: string;
  purchase_date?: string;
  purchase_price?: number;
  warranty_expiry?: string;
  vn_lead_time_days?: number;
  customs_clearance_days?: number;
  import_customs_no?: string;
  supplier?: string;
  notes?: string;
}

export interface FixtureUsageLog {
  id: number;
  fixture_id: number;
  action: string;
  usage_count: number;
  product_code?: string;
  work_order_no?: string;
  line_code?: string;
  operator_name?: string;
  from_location?: string;
  to_location?: string;
  condition_before?: string;
  condition_after?: string;
  notes?: string;
  logged_at: string;
}

export interface FixtureCleaningRecord {
  id: number;
  fixture_id: number;
  cleaning_type: string;
  cleaned_by?: string;
  cleaning_method?: string;
  cleaning_agent?: string;
  result: string;
  usage_count_at_cleaning: number;
  notes?: string;
  cleaned_at: string;
}

export interface SparePartEnhanced {
  id: string;
  part_no: string;
  name_zh?: string;
  name_en?: string;
  name_vi?: string;
  equipment_model?: string;
  equipment_type?: string;
  current_stock: number;
  min_stock: number;
  max_stock?: number;
  reorder_point?: number;
  abc_class: 'A' | 'B' | 'C';
  unit: string;
  location_code?: string;
  supplier?: string;
  unit_cost: number;
  lead_time_days?: number;
  vn_lead_time_days?: number;
  customs_clearance_days?: number;
  safety_stock_days?: number;
  is_obsolete?: boolean;
  obsolete_date?: string;
  annual_consumption?: number;
  stock_value?: number;
  status: string;
}

// ═══ Equipment Management Enhanced Types (Migration 196) ═══

export interface EquipmentAsset {
  id: string;
  asset_code: string;
  name_zh: string;
  name_en?: string;
  name_vi?: string;
  category_id?: string;
  category_zh?: string;
  category_code?: string;
  model_id?: string;
  vendor_name?: string;
  model_name?: string;
  machine_id?: string;
  line_id?: string;
  line_code?: string;
  station_id?: string;
  station_code?: string;
  location_id?: string;
  location_name?: string;
  serial_no?: string;
  criticality: 'A' | 'B' | 'C';
  status: string;
  purchase_date?: string;
  purchase_price?: number;
  currency?: string;
  depreciation_years?: number;
  current_value?: number;
  install_date?: string;
  commissioned_date?: string;
  warranty_expiry?: string;
  manufacturer?: string;
  manufacture_date?: string;
  rated_power_kw?: number;
  rated_voltage?: string;
  rated_speed?: string;
  dimensions?: string;
  weight_kg?: number;
  software_version?: string;
  firmware_version?: string;
  parent_asset_id?: string;
  qr_code?: string;
  responsible_engineer_id?: string;
  responsible_engineer_name?: string;
  cumulative_runtime_hours?: number;
  cumulative_output_count?: number;
  total_repair_count?: number;
  total_repair_cost?: number;
  total_pm_count?: number;
  import_customs_no?: string;
  origin_certificate_no?: string;
  vn_inspection_cert_no?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EquipmentTimelineEvent {
  event_type: 'repair' | 'pm' | 'calibration' | 'status_change' | 'event';
  ref_no: string;
  description: string;
  occurred_at: string;
  status: string;
  priority: string;
}

export interface EquipmentDocument {
  id: string;
  asset_id: string;
  doc_type: string;
  doc_name: string;
  file_url: string;
  file_size?: number;
  mime_type?: string;
  doc_no?: string;
  valid_until?: string;
  uploaded_by?: string;
  notes?: string;
  created_at?: string;
}

export interface EquipmentComponent {
  id: string;
  asset_id: string;
  parent_component_id?: string;
  component_code: string;
  name_zh: string;
  name_en?: string;
  name_vi?: string;
  component_type?: string;
  serial_no?: string;
  manufacturer?: string;
  model?: string;
  install_date?: string;
  expected_life_hours?: number;
  actual_life_hours?: number;
  status?: string;
  notes?: string;
}

export interface MeterReading {
  id: string;
  asset_id: string;
  reading_type: string;
  reading_value: number;
  reading_unit?: string;
  source: string;
  operator_id?: string;
  notes?: string;
  read_at: string;
}

export interface WorkOrder {
  id: string;
  wo_no: string;
  equipment_id?: string;
  equipment_code?: string;
  equipment_name?: string;
  equipment_name_zh?: string;
  line_id?: string;
  line_name?: string;
  issue_person?: string;
  issue_phone?: string;
  fault_description: string;
  fault_category?: string;
  priority: string;
  urgency_level: string;
  wo_type: string;
  fault_code_id?: string;
  fault_code?: string;
  fault_code_name?: string;
  fault_code_path?: string;
  fault_subcategory?: string;
  fault_category_name?: string;
  typical_cause?: string;
  typical_fix?: string;
  assigned_technician?: string;
  assigned_at?: string;
  status: string;
  response_deadline?: string;
  started_at?: string;
  completed_at?: string;
  real_cause?: string;
  resolution_notes?: string;
  root_cause_category?: string;
  parts_used?: Array<{ partId: string; partName: string; qty: number; cost: number }>;
  downtime_minutes?: number;
  repair_cost_labor?: number;
  repair_cost_parts?: number;
  repair_cost_external?: number;
  repair_cost_total?: number;
  is_external_repair?: boolean;
  external_vendor?: string;
  external_wo_no?: string;
  external_cost?: number;
  trial_pieces?: number;
  verification_result?: string;
  verified_by?: string;
  verified_at?: string;
  first_article_result?: string;
  escalation_level?: number;
  escalated_at?: string;
  escalated_to?: string;
  sla_breached?: boolean;
  photo_urls?: string[];
  criticality?: string;
  issue_time?: string;
  created_at?: string;
  updated_at?: string;
}

export interface WorkOrderStats {
  total_completed: number;
  total_open: number;
  avg_downtime: number;
  total_cost: number;
  avg_cost_per_repair: number;
  line_down_count: number;
  sla_breached_count: number;
}

export interface MtbfMttrRow {
  asset_code: string;
  name_zh: string;
  repair_count: number;
  mttr_minutes: number;
  total_cost: number;
  cumulative_runtime_hours: number;
  mtbf_hours: number | null;
}

export interface FaultParetoRow {
  category: string;
  cnt: number;
}

export interface FaultCodeCategory {
  id: string;
  code: string;
  name: string;
  children: Array<{
    id: string;
    code: string;
    name: string;
    items: Array<{
      id: string;
      code: string;
      name_zh: string;
      name_en?: string;
      name_vi?: string;
      typical_cause?: string;
      typical_fix?: string;
      root_cause_category?: string;
      applicable_equipment_types?: string[];
      severity?: string;
    }>;
  }>;
}

export interface PmTemplateEnhanced {
  id: string;
  template_code: string;
  template_name_zh: string;
  template_name_en?: string;
  template_name_vi?: string;
  pm_level: string;
  equipment_category_id?: string;
  category_name?: string;
  category_code?: string;
  trigger_type: string;
  calendar_interval_days?: number;
  runtime_interval_hours?: number;
  runtime_interval_count?: number;
  estimated_minutes?: number;
  required_role?: string;
  requires_first_article?: boolean;
  description?: string;
  task_count?: number;
  status?: string;
  created_at?: string;
}

export interface PmTemplateTaskEnhanced {
  id: string;
  template_id: string;
  task_no: number;
  task_name_zh: string;
  task_name_en?: string;
  task_name_vi?: string;
  instruction?: string;
  standard_value?: string;
  measurement_method?: string;
  requires_photo?: boolean;
  requires_measurement?: boolean;
  is_critical?: boolean;
  status?: string;
}

export interface PmExecution {
  id: string;
  execution_no: string;
  template_id?: string;
  asset_id: string;
  equipment_name?: string;
  asset_code?: string;
  pm_level: string;
  trigger_type: string;
  scheduled_date: string;
  actual_start?: string;
  actual_end?: string;
  executor_id?: string;
  executor_name?: string;
  result: string;
  first_article_result?: string;
  abnormal_description?: string;
  notes?: string;
  template_name_zh?: string;
  created_at?: string;
}

export interface EquipmentCategory {
  id: string;
  code: string;
  name_zh: string;
  name_en?: string;
  name_vi?: string;
  parent_id?: string;
  sort_order?: number;
  status?: string;
}

export interface EquipmentModel {
  id: string;
  category_id: string;
  category_code?: string;
  vendor_name: string;
  model_name: string;
  description?: string;
  status?: string;
}

export interface NotificationRule {
  id: string;
  event_type: string;
  event_name_zh?: string;
  channels: string[];
  target_roles: string[];
  delay_minutes: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export const maintenanceApi = {
  // ── Equipment ──────────────────────────────────────────────────────────────

  /** GET /maintenance/equipment — list equipment (falls back to demo data) */
  getEquipment(params?: { status?: string; q?: string; search?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.q || params?.search) qs.set("q", params.q ?? params.search ?? "");
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient
      .get<any>(`/maintenance/equipment${query ? `?${query}` : ""}`)
      .catch(() => {
        let items = _demoEquipment.map((e) => ({ ...e }));
        if (params?.status && params.status !== "all") items = items.filter((e) => e.status === params.status);
        if (params?.q || params?.search) {
          const q = (params.q ?? params.search ?? "").toLowerCase();
          items = items.filter((e) => (e.equipmentNo ?? "").toLowerCase().includes(q) || (e.name_zh ?? "").includes(q));
        }
        const limit = params?.limit ?? 100;
        return { items: items.slice(0, limit), total: items.length };
      });
  },

  /** GET /maintenance/equipment/:id — single equipment detail */
  getEquipmentById(id: string) {
    return apiClient
      .get<Equipment>(`/maintenance/equipment/${id}`)
      .catch(() => {
        const item = _demoEquipment.find((e) => e.id === id);
        if (!item) throw new Error("Equipment not found");
        return item;
      });
  },

  // ── Maintenance Records ───────────────────────────────────────────────────

  /** GET /maintenance/records — list maintenance records (falls back to demo data) */
  getRecords(params?: { status?: string; type?: string; equipmentNo?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.type) qs.set("type", params.type);
    if (params?.equipmentNo) qs.set("equipmentNo", params.equipmentNo);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return apiClient
      .get<ListEnvelope<MaintenanceRecord>>(`/maintenance/records${query ? `?${query}` : ""}`)
      .catch(() => {
        let items = _demoRecords.map((r) => ({ ...r }));
        if (params?.status && params.status !== "all") items = items.filter((r) => r.status === params.status);
        if (params?.type && params.type !== "all") items = items.filter((r) => r.type === params.type);
        if (params?.equipmentNo) items = items.filter((r) => r.equipmentNo === params.equipmentNo);
        const limit = params?.limit ?? 100;
        return { items: items.slice(0, limit), total: items.length };
      });
  },

  /** POST /maintenance/records — create a maintenance record */
  createRecord(payload: {
    equipmentNo: string;
    type: string;
    priority: string;
    description: string;
    scheduledDate: string;
    operator: string;
  }) {
    return apiClient.post<MaintenanceRecord>("/maintenance/records", payload);
  },

  /** PATCH /maintenance/records/:id — update status/result */
  updateRecord(id: string, payload: Partial<{
    status: string;
    result: string;
    cost: number;
    completedDate: string;
    operator: string;
  }>) {
    return apiClient.patch<MaintenanceRecord>(`/maintenance/records/${id}`, payload);
  },

  // ── Inspection Templates ──────────────────────────────────────────────────

  /** GET /maintenance/inspection/templates */
  getInspectionTemplates(params?: { machineType?: string; frequencyType?: string; q?: string }) {
    return apiClient.get<ListEnvelope<InspectionTemplate>>("/maintenance/inspection/templates").catch(() => {
      let items = _demoInspectionTemplates.map((t) => ({ ...t }));
      if (params?.machineType && params.machineType !== "all") items = items.filter((t) => t.machineType === params.machineType);
      if (params?.frequencyType && params.frequencyType !== "all") items = items.filter((t) => t.frequencyType === params.frequencyType);
      if (params?.q) {
        const q = params.q.toLowerCase();
        items = items.filter((t) => t.templateCode.toLowerCase().includes(q) || t.templateName.toLowerCase().includes(q));
      }
      return { items, total: items.length };
    });
  },

  /** GET /maintenance/inspection/templates/:id */
  getInspectionTemplateById(id: string) {
    return apiClient.get<InspectionTemplate>(`/maintenance/inspection/templates/${id}`).catch(() => {
      const item = _demoInspectionTemplates.find((t) => t.id === id);
      if (!item) throw new Error("Template not found");
      return item;
    });
  },

  // ── Inspection Assignments ─────────────────────────────────────────────────

  /** GET /maintenance/inspection/assignments */
  getInspectionAssignments(params?: {
    machineId?: string;
    shiftDate?: string;
    status?: string;
    limit?: number;
  }) {
    return apiClient.get<ListEnvelope<InspectionAssignment>>("/maintenance/inspection/assignments").catch(() => {
      let items = _demoInspectionAssignments.map((a) => ({ ...a }));
      if (params?.machineId) items = items.filter((a) => a.machineId === params.machineId);
      if (params?.shiftDate) items = items.filter((a) => a.shiftDate === params.shiftDate);
      if (params?.status && params.status !== "all") items = items.filter((a) => a.status === params.status);
      const limit = params?.limit ?? 100;
      return { items: items.slice(0, limit), total: items.length };
    });
  },

  /** POST /maintenance/inspection/assignments */
  createInspectionAssignment(payload: {
    machineId: string;
    templateId: string;
    shiftDate: string;
    shiftType: string;
    assignedTo: string;
  }) {
    return apiClient.post<InspectionAssignment>("/maintenance/inspection/assignments", payload);
  },

  /** PATCH /maintenance/inspection/assignments/:id */
  updateInspectionAssignment(id: string, payload: Partial<{ status: string }>) {
    return apiClient.patch<InspectionAssignment>(`/maintenance/inspection/assignments/${id}`, payload);
  },

  // ── Inspection Records ────────────────────────────────────────────────────

  /** GET /maintenance/inspection/records */
  getInspectionRecords(params?: {
    machineId?: string;
    shiftDate?: string;
    result?: string;
    limit?: number;
  }) {
    return apiClient.get<ListEnvelope<InspectionRecord>>("/maintenance/inspection/records").catch(() => {
      let items = _demoInspectionRecords.map((r) => ({ ...r }));
      if (params?.machineId) items = items.filter((r) => r.machineId === params.machineId);
      if (params?.shiftDate) items = items.filter((r) => r.shiftDate === params.shiftDate);
      if (params?.result && params.result !== "all") items = items.filter((r) => r.overallResult === params.result);
      const limit = params?.limit ?? 100;
      return { items: items.slice(0, limit), total: items.length };
    });
  },

  // ── Inspection Abnormalities ─────────────────────────────────────────────

  /** GET /maintenance/inspection/abnormals */
  getInspectionAbnormals(params?: { status?: string; severity?: string; limit?: number }) {
    return apiClient.get<ListEnvelope<InspectionAbnormal>>("/maintenance/inspection/abnormals").catch(() => {
      let items = _demoInspectionAbnormals.map((a) => ({ ...a }));
      if (params?.status && params.status !== "all") items = items.filter((a) => a.status === params.status);
      if (params?.severity && params.severity !== "all") items = items.filter((a) => a.severity === params.severity);
      const limit = params?.limit ?? 100;
      return { items: items.slice(0, limit), total: items.length };
    });
  },

  // ── Machine OEE & Status ──────────────────────────────────────────────────

  /** GET /maintenance/oee */
  getMachineOeeLogs(params?: { machineId?: string; logDate?: string; limit?: number }) {
    return apiClient.get<ListEnvelope<MachineOeeLog>>("/maintenance/oee").catch(() => {
      let items = _demoMachineOeeLogs.map((o) => ({ ...o }));
      if (params?.machineId) items = items.filter((o) => o.machineId === params.machineId);
      if (params?.logDate) items = items.filter((o) => o.logDate === params.logDate);
      const limit = params?.limit ?? 100;
      return { items: items.slice(0, limit), total: items.length };
    });
  },

  /** GET /maintenance/machine-status */
  getMachineStatusSnapshots(params?: { machineId?: string }) {
    return apiClient.get<ListEnvelope<MachineStatusSnapshot>>("/maintenance/machine-status").catch(() => {
      let items = _demoMachineStatusSnapshots.map((s) => ({ ...s }));
      if (params?.machineId) items = items.filter((s) => s.machineId === params.machineId);
      return { items, total: items.length };
    });
  },

  // ── PM Templates ──────────────────────────────────────────────────────────

  /** GET /maintenance/pm/templates */
  getPmTemplates(params?: { machineType?: string; frequencyCode?: string }) {
    return apiClient.get<ListEnvelope<PmTemplate>>("/maintenance/pm/templates").catch(() => {
      let items = _demoPmTemplates.map((t) => ({ ...t }));
      if (params?.machineType && params.machineType !== "all") items = items.filter((t) => t.machineType === params.machineType);
      if (params?.frequencyCode && params.frequencyCode !== "all") items = items.filter((t) => t.frequencyCode === params.frequencyCode);
      return { items, total: items.length };
    });
  },

  // ── PM Schedule Assignments ─────────────────────────────────────────────────

  /** GET /maintenance/pm/schedule */
  getPmScheduleAssignments(params?: { assetId?: string; status?: string; overdue?: boolean }) {
    return apiClient.get<ListEnvelope<PmScheduleAssignment>>("/maintenance/pm/schedule").catch(() => {
      let items = _demoPmScheduleAssignments.map((a) => ({ ...a }));
      if (params?.assetId) items = items.filter((a) => a.assetId === params.assetId);
      if (params?.status === "active") items = items.filter((a) => a.isActive);
      if (params?.overdue) items = items.filter((a) => a.nextDueDate < new Date().toISOString().slice(0, 10));
      return { items, total: items.length };
    });
  },

  /** POST /maintenance/pm/schedule */
  createPmScheduleAssignment(payload: {
    assetId: string;
    templateId: string;
    frequencyCode: string;
    nextDueDate: string;
    assignedTeam: string;
  }) {
    return apiClient.post<PmScheduleAssignment>("/maintenance/pm/schedule", payload);
  },

  // ── PM Execution Logs ─────────────────────────────────────────────────────

  /** GET /maintenance/pm/execution-logs */
  getPmExecutionLogs(params?: { assetId?: string; result?: string; limit?: number }) {
    return apiClient.get<ListEnvelope<PmExecutionLog>>("/maintenance/pm/execution-logs").catch(() => {
      let items = _demoPmExecutionLogs.map((l) => ({ ...l }));
      if (params?.assetId) items = items.filter((l) => l.assetId === params.assetId);
      if (params?.result && params.result !== "all") items = items.filter((l) => l.result === params.result);
      const limit = params?.limit ?? 100;
      return { items: items.slice(0, limit), total: items.length };
    });
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────

  /** GET /maintenance/dashboard — summary stats */
  getDashboardSummary() {
    return apiClient
      .get<MaintenanceDashboardSummary>("/maintenance/dashboard")
      .catch(() => {
        const today = new Date().toISOString().slice(0, 10);
        return {
          totalEquipment: _demoEquipment.length,
          online: _demoEquipment.filter((e) => e.status === "online").length,
          fault: _demoEquipment.filter((e) => e.status === "fault").length,
          inMaintenance: _demoEquipment.filter((e) => e.status === "maintenance").length,
          offline: _demoEquipment.filter((e) => e.status === "offline").length,
          pendingMaintenance: _demoRecords.filter((r) => r.status === "pending" || r.status === "in_progress").length,
          overdueMaintenance: _demoRecords.filter((r) => r.status === "overdue").length,
          pendingInspections: _demoInspectionAssignments.filter((a) => a.shiftDate === today && a.status === "pending").length,
          completedInspectionsToday: _demoInspectionRecords.filter((r) => r.shiftDate === today).length,
          openAbnormals: _demoInspectionAbnormals.filter((a) => a.status === "reported" || a.status === "acknowledged").length,
          overduePmSchedules: _demoPmScheduleAssignments.filter((a) => a.isActive && a.nextDueDate < today).length,
        };
      });
  },

  // ── Checklist Templates ────────────────────────────────────────────────────

  /** GET /maintenance/checklists/templates */
  getChecklistTemplates(params?: { equipmentType?: string; frequency?: string }) {
    return apiClient.get<ListEnvelope<ChecklistTemplate>>("/maintenance/checklists/templates").catch(() => {
      return { items: [], total: 0 };
    });
  },

  /** GET /maintenance/checklists/templates/:id */
  getChecklistTemplateById(id: string) {
    return apiClient.get<ChecklistTemplate>(`/maintenance/checklists/templates/${id}`).catch(() => {
      throw new Error("Template not found");
    });
  },

  // ── Checking Records ───────────────────────────────────────────────────────

  /** GET /maintenance/checklists/records */
  getCheckingRecords(params?: { equipmentId?: string; checkDate?: string; limit?: number }) {
    return apiClient.get<ListEnvelope<CheckingRecord>>("/maintenance/checklists/records").catch(() => {
      return { items: [], total: 0 };
    });
  },

  /** GET /maintenance/checklists/records/:id */
  getCheckingRecordById(id: string) {
    return apiClient.get<CheckingRecord>(`/maintenance/checklists/records/${id}`).catch(() => {
      throw new Error("Record not found");
    });
  },

  /** POST /maintenance/checklists/records */
  createCheckingRecord(payload: {
    templateId: string;
    equipmentId: string;
    shiftType: string;
    checkDate: string;
    inspectorName: string;
  }) {
    return apiClient.post<CheckingRecord>("/maintenance/checklists/records", payload);
  },

  /** PATCH /maintenance/checklists/records/:id/items */
  updateCheckingRecordItem(recordId: string, payload: { itemId: string; result: string; numericValue?: number; notes?: string }) {
    return apiClient.patch<CheckingRecordDetail>(`/maintenance/checklists/records/${recordId}/items`, payload);
  },

  /** PATCH /maintenance/checklists/records/:id/complete */
  completeCheckingRecord(recordId: string, payload?: { notes?: string }) {
    return apiClient.patch<CheckingRecord>(`/maintenance/checklists/records/${recordId}/complete`, payload ?? {});
  },

  // ── Schedule ───────────────────────────────────────────────────────────────

  /** GET /maintenance/checklists/schedule */
  getChecklistSchedule(params?: { date?: string; equipmentId?: string }) {
    return apiClient.get<ListEnvelope<ChecklistSchedule>>("/maintenance/checklists/schedule").catch(() => {
      return { items: [], total: 0 };
    });
  },

  // ── Compliance ─────────────────────────────────────────────────────────────

  /** GET /maintenance/checklists/compliance/daily */
  getDailyCompliance() {
    return apiClient.get<ComplianceSummary>("/maintenance/checklists/compliance/daily").catch(() => {
      return { totalScheduled: 0, completed: 0, missed: 0, overridden: 0, complianceRate: 0, onTimeRate: 0, skipRate: 0, verificationRate: 0, period: { from: "", to: "" } };
    });
  },

  /** GET /maintenance/checklists/compliance/by-equipment */
  getComplianceByEquipment(params?: { from?: string; to?: string }) {
    return apiClient.get<ListEnvelope<ComplianceByEquipment>>("/maintenance/checklists/compliance/by-equipment").catch(() => {
      return { items: [], total: 0 };
    });
  },

  // ═══ Equipment Management Enhanced (Migration 196, Grill Q1-Q20) ═══

  // ── Equipment Archives (Q4-D) ─────────────────────────────────────────────

  /** GET /equipment/assets — list with filters */
  getAssets(params?: { status?: string; criticality?: string; category?: string; line?: string; search?: string; page?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.criticality) qs.set("criticality", params.criticality);
    if (params?.category) qs.set("category", params.category);
    if (params?.line) qs.set("line", params.line);
    if (params?.search) qs.set("search", params.search);
    if (params?.page != null) qs.set("page", String(params.page));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiClient.get<{ success: boolean; data: EquipmentAsset[]; total: number; page: number; limit: number }>(`/equipment/assets${query ? `?${query}` : ""}`);
  },

  /** GET /equipment/assets/:id — full archive detail */
  getAssetById(id: string) {
    return apiClient.get<{ success: boolean; data: EquipmentAsset }>(`/equipment/assets/${id}`);
  },

  /** POST /equipment/assets — create */
  createAsset(payload: Partial<EquipmentAsset>) {
    return apiClient.post<{ success: boolean; data: EquipmentAsset }>("/equipment/assets", payload);
  },

  /** PATCH /equipment/assets/:id — update */
  updateAsset(id: string, payload: Partial<EquipmentAsset>) {
    return apiClient.patch<{ success: boolean; data: EquipmentAsset }>(`/equipment/assets/${id}`, payload);
  },

  /** GET /equipment/assets/:id/timeline — all events */
  getAssetTimeline(id: string) {
    return apiClient.get<{ success: boolean; data: EquipmentTimelineEvent[] }>(`/equipment/assets/${id}/timeline`);
  },

  /** GET /equipment/assets/:id/documents */
  getAssetDocuments(id: string) {
    return apiClient.get<{ success: boolean; data: EquipmentDocument[] }>(`/equipment/assets/${id}/documents`);
  },

  /** POST /equipment/assets/:id/documents */
  createAssetDocument(id: string, payload: { docType: string; docName: string; fileUrl: string; fileSize?: number; mimeType?: string; docNo?: string; validUntil?: string; notes?: string }) {
    return apiClient.post<{ success: boolean; data: EquipmentDocument }>(`/equipment/assets/${id}/documents`, payload);
  },

  /** GET /equipment/assets/:id/components — sub-components */
  getAssetComponents(id: string) {
    return apiClient.get<{ success: boolean; data: EquipmentComponent[] }>(`/equipment/assets/${id}/components`);
  },

  /** POST /equipment/assets/:id/components */
  createAssetComponent(id: string, payload: { componentCode: string; nameZh: string; nameEn?: string; nameVi?: string; componentType?: string; serialNo?: string; manufacturer?: string; model?: string; installDate?: string; expectedLifeHours?: number; parentComponentId?: string; notes?: string }) {
    return apiClient.post<{ success: boolean; data: EquipmentComponent }>(`/equipment/assets/${id}/components`, payload);
  },

  /** GET /equipment/assets/:id/readings — meter readings */
  getAssetReadings(id: string, params?: { type?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.type) qs.set("type", params.type);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiClient.get<{ success: boolean; data: MeterReading[] }>(`/equipment/assets/${id}/readings${query ? `?${query}` : ""}`);
  },

  /** POST /equipment/assets/:id/readings */
  createAssetReading(id: string, payload: { readingType: string; readingValue: number; readingUnit?: string; source?: string; notes?: string }) {
    return apiClient.post<{ success: boolean; data: MeterReading }>(`/equipment/assets/${id}/readings`, payload);
  },

  // ── Work Orders (Q2-D) ────────────────────────────────────────────────────

  /** GET /equipment/work-orders — list with filters */
  getWorkOrders(params?: { status?: string; priority?: string; urgency?: string; woType?: string; equipmentId?: string; technician?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.priority) qs.set("priority", params.priority);
    if (params?.urgency) qs.set("urgency", params.urgency);
    if (params?.woType) qs.set("woType", params.woType);
    if (params?.equipmentId) qs.set("equipmentId", params.equipmentId);
    if (params?.technician) qs.set("technician", params.technician);
    if (params?.dateFrom) qs.set("dateFrom", params.dateFrom);
    if (params?.dateTo) qs.set("dateTo", params.dateTo);
    if (params?.page != null) qs.set("page", String(params.page));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiClient.get<{ success: boolean; data: WorkOrder[]; total: number; page: number; limit: number }>(`/equipment/work-orders${query ? `?${query}` : ""}`);
  },

  /** GET /equipment/work-orders/:id — detail with fault code path */
  getWorkOrderById(id: string) {
    return apiClient.get<{ success: boolean; data: WorkOrder }>(`/equipment/work-orders/${id}`);
  },

  /** POST /equipment/work-orders — report fault / create WO */
  createWorkOrder(payload: {
    equipmentId?: string; equipmentCode?: string; equipmentNameZh?: string;
    lineId?: string; lineName?: string;
    faultDescription?: string; fault_description?: string; faultCategory?: string;
    priority?: string; urgencyLevel?: string; woType?: string;
    faultCodeId?: string; issuePerson?: string; issuePhone?: string;
    photoUrls?: string[]; equipment_id?: string; source?: string; fault_code?: string; urgency_level?: string;
  }) {
    return apiClient.post<{ success: boolean; data: WorkOrder }>("/equipment/work-orders", payload);
  },

  /** PATCH /equipment/work-orders/:id/assign */
  assignWorkOrder(id: string, technician: string) {
    return apiClient.patch<{ success: boolean; data: WorkOrder }>(`/equipment/work-orders/${id}/assign`, { technician });
  },

  /** PATCH /equipment/work-orders/:id/start */
  startWorkOrder(id: string) {
    return apiClient.patch<{ success: boolean; data: WorkOrder }>(`/equipment/work-orders/${id}/start`, {});
  },

  /** PATCH /equipment/work-orders/:id/complete */
  completeWorkOrder(id: string, payload: {
    realCause?: string; resolutionNotes?: string; rootCauseCategory?: string;
    partsUsed?: Array<{ partId: string; partName: string; qty: number; cost: number }>;
    downtimeMinutes?: number;
    repairCostLabor?: number; repairCostParts?: number; repairCostExternal?: number;
    isExternalRepair?: boolean; externalVendor?: string; externalWoNo?: string; externalCost?: number;
    trialPieces?: number;
  }) {
    return apiClient.patch<{ success: boolean; data: WorkOrder }>(`/equipment/work-orders/${id}/complete`, payload);
  },

  /** PATCH /equipment/work-orders/:id/verify */
  verifyWorkOrder(id: string, payload: { verificationResult?: string; verifiedBy?: string; firstArticleResult?: string }) {
    return apiClient.patch<{ success: boolean; data: WorkOrder }>(`/equipment/work-orders/${id}/verify`, payload);
  },

  /** PATCH /equipment/work-orders/:id/escalate */
  escalateWorkOrder(id: string, escalatedTo: string) {
    return apiClient.patch<{ success: boolean; data: WorkOrder }>(`/equipment/work-orders/${id}/escalate`, { escalatedTo });
  },

  /** GET /equipment/work-orders/stats — MTBF/MTTR/cost/pareto */
  getWorkOrderStats(params?: { days?: number }) {
    const qs = new URLSearchParams();
    if (params?.days != null) qs.set("days", String(params.days));
    const query = qs.toString();
    return apiClient.get<{ success: boolean; summary: WorkOrderStats; mtbf_mttr: MtbfMttrRow[]; fault_pareto: FaultParetoRow[] }>(`/equipment/work-orders/stats${query ? `?${query}` : ""}`);
  },

  // ── Fault Codes (Q16-B) ───────────────────────────────────────────────────

  /** GET /equipment/fault-codes — 3-level tree */
  getFaultCodes() {
    return apiClient.get<{ success: boolean; data: FaultCodeCategory[] }>("/equipment/fault-codes");
  },

  // ── PM Templates (Q3-D) ───────────────────────────────────────────────────

  /** GET /equipment/pm-templates */
  getEquipmentPmTemplates(params?: { level?: string; category?: string }) {
    const qs = new URLSearchParams();
    if (params?.level) qs.set("level", params.level);
    if (params?.category) qs.set("category", params.category);
    const query = qs.toString();
    return apiClient.get<{ success: boolean; data: PmTemplateEnhanced[] }>(`/equipment/pm-templates${query ? `?${query}` : ""}`);
  },

  /** GET /equipment/pm-templates/:id — with tasks */
  getEquipmentPmTemplateById(id: string) {
    return apiClient.get<{ success: boolean; data: PmTemplateEnhanced & { tasks: PmTemplateTaskEnhanced[] } }>(`/equipment/pm-templates/${id}`);
  },

  /** POST /equipment/pm-templates — create with tasks */
  createEquipmentPmTemplate(payload: {
    templateCode: string; templateNameZh: string; templateNameEn?: string; templateNameVi?: string;
    pmLevel: string; equipmentCategoryId?: string;
    triggerType?: string; calendarIntervalDays?: number; runtimeIntervalHours?: number; runtimeIntervalCount?: number;
    estimatedMinutes?: number; requiredRole?: string; requiresFirstArticle?: boolean; description?: string;
    tasks?: Array<{ taskNameZh: string; taskNameEn?: string; taskNameVi?: string; instruction?: string; standardValue?: string; measurementMethod?: string; requiresPhoto?: boolean; requiresMeasurement?: boolean; isCritical?: boolean }>;
  }) {
    return apiClient.post<{ success: boolean; data: PmTemplateEnhanced }>("/equipment/pm-templates", payload);
  },

  // ── PM Execution (Q3-D) ───────────────────────────────────────────────────

  /** GET /equipment/pm-executions */
  getPmExecutions(params?: { assetId?: string; level?: string; result?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.assetId) qs.set("assetId", params.assetId);
    if (params?.level) qs.set("level", params.level);
    if (params?.result) qs.set("result", params.result);
    if (params?.dateFrom) qs.set("dateFrom", params.dateFrom);
    if (params?.dateTo) qs.set("dateTo", params.dateTo);
    if (params?.page != null) qs.set("page", String(params.page));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiClient.get<{ success: boolean; data: PmExecution[]; total: number }>(`/equipment/pm-executions${query ? `?${query}` : ""}`);
  },

  /** POST /equipment/pm-executions — start execution */
  createPmExecution(payload: { templateId: string; assetId: string; pmLevel: string; triggerType?: string; scheduledDate?: string }) {
    return apiClient.post<{ success: boolean; data: PmExecution }>("/equipment/pm-executions", payload);
  },

  /** Compatibility aliases used by the PDA maintenance screen. */
  getPmExecutionRecords(params?: { scheduled_date?: string }) {
    return apiClient.get<any>("/equipment/pm-executions", params);
  },
  updatePmExecutionRecord(id: string, payload: Record<string, unknown>) {
    return apiClient.patch<any>(`/equipment/pm-executions/${id}/complete`, payload);
  },

  /** PATCH /equipment/pm-executions/:id/complete — with checklist results */
  completePmExecution(id: string, payload: {
    items?: Array<{ taskNo: number; result: string; measuredValue?: string; notes?: string; photoUrls?: string[] }>;
    firstArticleResult?: string; abnormalDescription?: string; notes?: string;
  }) {
    return apiClient.patch<{ success: boolean; data: PmExecution }>(`/equipment/pm-executions/${id}/complete`, payload);
  },

  // ── Dashboard KPI (Q8-D) ──────────────────────────────────────────────────

  /** GET /equipment/dashboard — KPI summary */
  getEquipmentDashboard() {
    return apiClient.get<{
      success: boolean;
      equipment_by_status: Array<{ status: string; cnt: number }>;
      equipment_by_criticality: Array<{ criticality: string; cnt: number }>;
      work_orders_by_status: Array<{ status: string; cnt: number }>;
      pm_stats_30d: Array<{ result: string; cnt: number }>;
      pm_overdue_count: number;
      recent_work_orders: WorkOrder[];
      cost_trend: Array<{ month: string; total_cost: number; wo_count: number }>;
    }>("/equipment/dashboard");
  },

  // ── Reference Data ────────────────────────────────────────────────────────

  /** GET /equipment/categories */
  getEquipmentCategories() {
    return apiClient.get<{ success: boolean; data: EquipmentCategory[] }>("/equipment/categories");
  },

  /** GET /equipment/models */
  getEquipmentModels(params?: { category?: string }) {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    const query = qs.toString();
    return apiClient.get<{ success: boolean; data: EquipmentModel[] }>(`/equipment/models${query ? `?${query}` : ""}`);
  },

  // ── Notification Rules (Q12-D) ────────────────────────────────────────────

  /** GET /equipment/notification-rules */
  getNotificationRules() {
    return apiClient.get<{ success: boolean; data: NotificationRule[] }>("/equipment/notification-rules");
  },

  /** PATCH /equipment/notification-rules/:id */
  updateNotificationRule(id: string, payload: { channels?: string[]; targetRoles?: string[]; delayMinutes?: number; isActive?: boolean }) {
    return apiClient.patch<{ success: boolean; data: NotificationRule }>(`/equipment/notification-rules/${id}`, payload);
  },


  // ═══ P2: Consumables (Q6-D) ═══

  getConsumables(params?: { category?: string; equipmentType?: string; lifeStatus?: string; search?: string; page?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.equipmentType) qs.set("equipmentType", params.equipmentType);
    if (params?.lifeStatus) qs.set("lifeStatus", params.lifeStatus);
    if (params?.search) qs.set("search", params.search);
    if (params?.page != null) qs.set("page", String(params.page));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiClient.get<{ success: boolean; data: Consumable[]; total: number }>(`/equipment/consumables${query ? `?${query}` : ""}`);
  },

  getConsumableById(id: number) {
    return apiClient.get<{ success: boolean; data: Consumable }>(`/equipment/consumables/${id}`);
  },

  createConsumable(payload: Partial<Consumable>) {
    return apiClient.post<{ success: boolean; data: Consumable }>("/equipment/consumables", payload);
  },

  updateConsumable(id: number, payload: Partial<Consumable>) {
    return apiClient.patch<{ success: boolean; data: Consumable }>(`/equipment/consumables/${id}`, payload);
  },

  recordConsumableUsage(id: number, payload: { usageType?: string; usageCount?: number; usageHours?: number; source?: string; equipmentAssetId?: string; workOrderNo?: string; operatorName?: string; notes?: string }) {
    return apiClient.post<{ success: boolean; data: ConsumableUsageLog }>(`/equipment/consumables/${id}/usage`, payload);
  },

  getConsumableUsageLogs(id: number) {
    return apiClient.get<{ success: boolean; data: ConsumableUsageLog[] }>(`/equipment/consumables/${id}/usage-logs`);
  },

  // ═══ P2: Fixtures (Q7-D) ═══

  getFixtures(params?: { fixtureType?: string; productCode?: string; status?: string; usageStatus?: string; search?: string; page?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.fixtureType) qs.set("fixtureType", params.fixtureType);
    if (params?.productCode) qs.set("productCode", params.productCode);
    if (params?.status) qs.set("status", params.status);
    if (params?.usageStatus) qs.set("usageStatus", params.usageStatus);
    if (params?.search) qs.set("search", params.search);
    if (params?.page != null) qs.set("page", String(params.page));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiClient.get<{ success: boolean; data: Fixture[]; total: number }>(`/equipment/fixtures${query ? `?${query}` : ""}`);
  },

  getFixtureById(id: number) {
    return apiClient.get<{ success: boolean; data: Fixture }>(`/equipment/fixtures/${id}`);
  },

  createFixture(payload: Partial<Fixture>) {
    return apiClient.post<{ success: boolean; data: Fixture }>("/equipment/fixtures", payload);
  },

  updateFixture(id: number, payload: Partial<Fixture>) {
    return apiClient.patch<{ success: boolean; data: Fixture }>(`/equipment/fixtures/${id}`, payload);
  },

  fixtureAction(id: number, payload: { action: string; usageCount?: number; productCode?: string; workOrderNo?: string; lineCode?: string; operatorName?: string; fromLocation?: string; toLocation?: string; conditionBefore?: string; conditionAfter?: string; notes?: string }) {
    return apiClient.post<{ success: boolean; data: FixtureUsageLog }>(`/equipment/fixtures/${id}/action`, payload);
  },

  cleanFixture(id: number, payload: { cleaningType?: string; cleanedBy?: string; cleaningMethod?: string; cleaningAgent?: string; result?: string; notes?: string }) {
    return apiClient.post<{ success: boolean; data: FixtureCleaningRecord }>(`/equipment/fixtures/${id}/clean`, payload);
  },

  getFixtureLogs(id: number) {
    return apiClient.get<{ success: boolean; data: FixtureUsageLog[] }>(`/equipment/fixtures/${id}/logs`);
  },

  getFixtureCleaningRecords(id: number) {
    return apiClient.get<{ success: boolean; data: FixtureCleaningRecord[] }>(`/equipment/fixtures/${id}/cleaning-records`);
  },

  // ═══ P2: Spare Parts Enhanced (Q5-D) ═══

  getSparePartsEnhanced(params?: { abcClass?: string; status?: string; search?: string; lowStock?: boolean; page?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.abcClass) qs.set("abcClass", params.abcClass);
    if (params?.status) qs.set("status", params.status);
    if (params?.search) qs.set("search", params.search);
    if (params?.lowStock) qs.set("lowStock", "true");
    if (params?.page != null) qs.set("page", String(params.page));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return apiClient.get<{ success: boolean; data: SparePartEnhanced[]; total: number }>(`/equipment/spare-parts${query ? `?${query}` : ""}`);
  },

  updateSparePart(id: string, payload: Partial<SparePartEnhanced>) {
    return apiClient.patch<{ success: boolean; data: SparePartEnhanced }>(`/equipment/spare-parts/${id}`, payload);
  },


  // ═══ P3: Health + Andon + Notifications ═══
  getHealth: (params?: any) => apiGet<any>('/equipment/health', params),
  getAndon: (params?: any) => apiGet<any>('/equipment/andon', params),
  getNotifications: (params?: any) => apiGet('/equipment/notifications', params),
  sendNotification: (data: any) => apiPost('/equipment/notifications/send', data),
  markNotificationRead: (id: number) => apiPatch(`/equipment/notifications/${id}/read`),
  // ═══ P4: Excel Import + Permissions ═══
  getImportTemplate: (type: string) => apiGet<any>(`/equipment/import/template/${type}`),
  bulkImport: (type: string, data: { rows: any[] }) => apiPost<any>(`/equipment/import/${type}`, data),
  getPermissionMatrix: () => apiGet('/equipment/permissions/matrix'),
  checkPermission: (permission: string) => apiGet('/equipment/permissions/check', { permission }),
  // ═══ P5: MES + Reports ═══
  mesIngest: (data: any) => apiPost('/equipment/mes/ingest', data),
  getMesConfig: () => apiGet('/equipment/mes/config'),
  getMonthlyReport: (params?: any) => apiGet<any>('/equipment/reports/monthly', params),
  getOeeReport: (params?: any) => apiGet<any>('/equipment/reports/oee', params),



  // Emergency Management
  getEmergencyEvents(params?: any): Promise<any> {
    return api.get('/emergency/events', { params }).then(r => r.data);
  },
  createEmergencyEvent(data: any): Promise<any> {
    return api.post('/emergency/events', data).then(r => r.data);
  },
  updateEmergencyEvent(id: number, data: any): Promise<any> {
    return api.patch(`/emergency/events/${id}`, data).then(r => r.data);
  },
  getEmergencyEvent(id: number): Promise<any> {
    return api.get(`/emergency/events/${id}`).then(r => r.data);
  },
  getEmergencySOP(params?: any): Promise<any> {
    return api.get('/emergency/sop', { params }).then(r => r.data);
  },
  ackEmergencyNotification(id: number): Promise<any> {
    return api.patch(`/emergency/notifications/${id}/ack`).then(r => r.data);
  },
  getEmergencyDashboard(): Promise<any> {
    return api.get('/emergency/dashboard').then(r => r.data);
  },


  // ═══ Maintenance Card (Q1-Q20 Grill 2026-07-25) ═══

  getMaintenanceCard(equipmentId: number, level?: string) {
    const params: Record<string, string> = {};
    if (level) params.level = level;
    const qs = new URLSearchParams(params).toString();
    return apiClient.get<{
      equipment: any;
      template: any;
      tasks: any[];
      recentExecutions: any[];
      card: any;
    }>(`/maintenance/card/${equipmentId}${qs ? `?${qs}` : ""}`);
  },

  executeMaintenanceCard(equipmentId: number, data: {
    template_id?: number;
    pm_level: string;
    trigger_type?: string;
    scheduled_date?: string;
    task_results: Array<{
      task_no: number;
      template_task_id?: number;
      task_name?: string;
      result: string;
      measured_value?: string;
      standard_value?: string;
      photo_urls?: string[];
      notes?: string;
    }>;
    abnormal_description?: string;
    notes?: string;
    first_article_result?: string;
    trial_pieces?: number;
    executor_id?: number;
    leader_id?: number;
    engineer_id?: number;
  }): Promise<any> {
    return apiClient.post(`/maintenance/card/${equipmentId}/execute`, data);
  },

  printMaintenanceCard(equipmentId: number, data: {
    card_version?: number;
    print_format?: string;
  }): Promise<any> {
    return apiClient.post(`/maintenance/card/${equipmentId}/print`, data);
  },

  getMaintenanceCardHistory(equipmentId: number, limit = 20): Promise<any[]> {
    return apiClient.get(`/maintenance/card/${equipmentId}/history`, {
      params: { limit: String(limit) }
    });
  },

};
