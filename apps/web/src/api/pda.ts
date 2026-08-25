import { apiClient, type ListEnvelope } from "./client";

// ── Types ──────────────────────────────────────────────────────────────

export interface PdaDevice {
  id: number;
  deviceCode: string;
  serialNo: string;
  deviceModel: string;
  manufacturer?: string;
  imei?: string;
  macAddress?: string;
  androidVersion?: string;
  appPackage?: string;
  appVersion?: string;
  firmwareVersion?: string;
  cpuArch?: string;
  ramMb?: number;
  storageGb?: number;
  batteryCapacityMah?: number;
  deviceStatus: PdaDeviceStatus;
  assignedTo?: string;
  assignedAt?: string;
  location?: string;
  lineCode?: string;
  purchaseOrder?: string;
  supplier?: string;
  purchasePrice?: number;
  purchaseDate?: string;
  warrantyExpiry?: string;
  notes?: string;
  nameZh?: string;
  nameEn?: string;
  nameVi?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // View fields
  currentHolderName?: string;
  activeRepairStatus?: string;
  activeRepairIssue?: string;
  lastInstalledVersion?: string;
  lastSoftwareUpdate?: string;
  lastEventType?: string;
  lastEventAt?: string;
  lastOperator?: string;
}

export type PdaDeviceStatus =
  | "IN_STOCK"
  | "ASSIGNED"
  | "LOST"
  | "DAMAGED"
  | "IN_REPAIR"
  | "RETIRED"
  | "QUARANTINED";

export interface PdaAssignment {
  id: number;
  deviceId: number;
  action: PdaAssignmentAction;
  fromPerson?: string;
  toPerson?: string;
  fromLine?: string;
  toLine?: string;
  reason?: string;
  operatorBadge: string;
  operatorName?: string;
  occurredAt: string;
  createdAt: string;
}

export type PdaAssignmentAction =
  | "RECEIVE"
  | "ASSIGN"
  | "RETURN"
  | "TRANSFER"
  | "LOSS_REPORT"
  | "DAMAGE_REPORT";

export interface PdaRepair {
  id: number;
  deviceId: number;
  repairCode: string;
  reportedBy: string;
  reportedAt: string;
  issueDesc: string;
  issueCategory: PdaRepairCategory;
  severity: PdaRepairSeverity;
  repairStatus: PdaRepairStatus;
  assignedTo?: string;
  diagnosis?: string;
  repairAction?: string;
  partsUsed?: string;
  repairCost?: number;
  repairHours?: number;
  completedAt?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type PdaRepairCategory =
  | "HARDWARE"
  | "SOFTWARE"
  | "SCREEN"
  | "BATTERY"
  | "SCANNER"
  | "NETWORK"
  | "CHARGING"
  | "OTHER";

export type PdaRepairSeverity = "CRITICAL" | "MAJOR" | "MINOR";

export type PdaRepairStatus =
  | "REPORTED"
  | "DIAGNOSING"
  | "REPAIRING"
  | "REPAIRED"
  | "CLOSED"
  | "UNREPAIRABLE";

export interface PdaSoftwareVersion {
  id: number;
  deviceId: number;
  previousVersion?: string;
  newVersion: string;
  apkFileName?: string;
  apkHash?: string;
  apkSizeBytes?: number;
  updateMethod: "OTA" | "MANUAL" | "SIDELOAD" | "AUTO";
  releaseNotes?: string;
  installedBy: string;
  installedAt: string;
  success: boolean;
  errorLog?: string;
}

export interface PdaAuditEntry {
  id: number;
  deviceId?: number;
  deviceCode?: string;
  eventType: PdaAuditEventType;
  operatorBadge?: string;
  operatorName?: string;
  stationCode?: string;
  lineCode?: string;
  workOrderCode?: string;
  payload?: Record<string, unknown>;
  result?: string;
  errorMessage?: string;
  clientTs?: string;
  serverTs: string;
  createdAt: string;
}

export interface PdaManagedApp {
  id: number;
  appCode: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  appType: "ANDROID_APK" | "ELECTRON" | "PYTHON_SCRIPT" | "WEB_APP" | "CAPACITOR_APP";
  targetPlatform: string;
  description?: string;
  sourcePath?: string;
  currentVersion?: string;
  releaseNotes?: string;
  lastReleasedAt?: string;
  associatedLines?: string[];
  appStatus: "ACTIVE" | "DEPRECATED" | "RETIRED" | "IN_DEVELOPMENT";
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type PdaAuditEventType =
  | "SCAN"
  | "BIND"
  | "RELEASE"
  | "LOGIN"
  | "LOGOUT"
  | "HEARTBEAT"
  | "ERROR"
  | "SYNC"
  | "CONFIG_CHANGE"
  | "APP_START"
  | "APP_CRASH";

export interface PdaHeartbeat {
  deviceId: number;
  deviceCode: string;
  online: boolean;
  lastSeen: string;
  lineCode?: string;
  appVersion?: string;
  batteryPct?: number;
}

export interface PdaDashboardSummary {
  totalDevices: number;
  onlineCount: number;
  byStatus: Record<string, number>;
  byLine: Record<string, number>;
  byModel: Record<string, number>;
  inRepair: number;
  assigned: number;
  inStock: number;
  recentActivity: PdaAuditEntry[];
}

// ── API Client ─────────────────────────────────────────────────────────

export const pdaApi = {
  // ── Devices ────────────────────────────────────────────────────────
  getDevices(params?: { status?: string; lineCode?: string; q?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.lineCode) qs.set("lineCode", params.lineCode);
    if (params?.q) qs.set("q", params.q);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    return apiClient.get<ListEnvelope<PdaDevice>>(`/pda/devices${qs.toString() ? "?" + qs.toString() : ""}`);
  },

  getDevicesStats() {
    return apiClient.get<{
      totalDevices: number;
      byStatus: Record<string, number>;
      byLine: Record<string, number>;
      byModel: Record<string, number>;
    }>("/pda/devices/stats/summary");
  },

  getDevice(id: number) {
    return apiClient.get<PdaDevice>(`/pda/devices/${id}`);
  },

  createDevice(data: Partial<PdaDevice>) {
    return apiClient.post<{ item: PdaDevice }>("/pda/devices", data);
  },

  updateDevice(id: number, data: Partial<PdaDevice>) {
    return apiClient.patch<{ item: PdaDevice }>(`/pda/devices/${id}`, data);
  },

  updateDeviceStatus(id: number, status: string, reason?: string) {
    return apiClient.patch<{ item: PdaDevice }>(`/pda/devices/${id}/status`, { status, reason });
  },

  deleteDevice(id: number) {
    return apiClient.delete<{ success: boolean }>(`/pda/devices/${id}`);
  },

  // ── Assignments ────────────────────────────────────────────────────
  getAssignments(params?: { deviceId?: number; action?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.deviceId != null) qs.set("deviceId", String(params.deviceId));
    if (params?.action) qs.set("action", params.action);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    return apiClient.get<ListEnvelope<PdaAssignment>>(`/pda/assignments${qs.toString() ? "?" + qs.toString() : ""}`);
  },

  createAssignment(data: Partial<PdaAssignment>) {
    return apiClient.post<{ item: PdaAssignment }>("/pda/assignments", data);
  },

  getDeviceAssignments(deviceId: number) {
    return apiClient.get<ListEnvelope<PdaAssignment>>(`/pda/assignments/device/${deviceId}`);
  },

  getCurrentAssignments(badge: string) {
    return apiClient.get<ListEnvelope<PdaAssignment>>(`/pda/assignments/current/${encodeURIComponent(badge)}`);
  },

  // ── Repairs ────────────────────────────────────────────────────────
  getRepairs(params?: { deviceId?: number; status?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.deviceId != null) qs.set("deviceId", String(params.deviceId));
    if (params?.status) qs.set("status", params.status);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    return apiClient.get<ListEnvelope<PdaRepair>>(`/pda/repairs${qs.toString() ? "?" + qs.toString() : ""}`);
  },

  getRepairsStats() {
    return apiClient.get<{
      total: number;
      byCategory: Record<string, number>;
      bySeverity: Record<string, number>;
      byStatus: Record<string, number>;
    }>("/pda/repairs/stats/summary");
  },

  createRepair(data: Partial<PdaRepair>) {
    return apiClient.post<{ item: PdaRepair }>("/pda/repairs", data);
  },

  updateRepair(id: number, data: Partial<PdaRepair>) {
    return apiClient.patch<{ item: PdaRepair }>(`/pda/repairs/${id}`, data);
  },

  verifyRepair(id: number, verifiedBy: string) {
    return apiClient.post<{ item: PdaRepair }>(`/pda/repairs/${id}/verify`, { verifiedBy });
  },

  // ── Software ───────────────────────────────────────────────────────
  getSoftwareVersions(params?: { deviceId?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.deviceId != null) qs.set("deviceId", String(params.deviceId));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    return apiClient.get<ListEnvelope<PdaSoftwareVersion>>(`/pda/software${qs.toString() ? "?" + qs.toString() : ""}`);
  },

  // ── Audit ──────────────────────────────────────────────────────────
  getAuditLog(params?: {
    deviceId?: number; eventType?: string; operatorBadge?: string;
    fromDate?: string; toDate?: string; limit?: number; offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.deviceId != null) qs.set("deviceId", String(params.deviceId));
    if (params?.eventType) qs.set("eventType", params.eventType);
    if (params?.operatorBadge) qs.set("operatorBadge", params.operatorBadge);
    if (params?.fromDate) qs.set("fromDate", params.fromDate);
    if (params?.toDate) qs.set("toDate", params.toDate);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    return apiClient.get<ListEnvelope<PdaAuditEntry>>(`/pda/audit${qs.toString() ? "?" + qs.toString() : ""}`);
  },

  getAuditStats() {
    return apiClient.get<{
      total: number;
      byType: Record<string, number>;
      byOperator: Record<string, number>;
    }>("/pda/audit/stats");
  },

  // ── Heartbeat / Online ─────────────────────────────────────────────
  getHeartbeats() {
    return apiClient.get<{ heartbeats: PdaHeartbeat[] }>("/pda/heartbeats");
  },

  getOnlineDevices() {
    return apiClient.get<{ online: PdaHeartbeat[] }>("/pda/online");
  },

  // ── Dashboard ──────────────────────────────────────────────────────
  getDashboard() {
    return apiClient.get<PdaDashboardSummary>("/pda/dashboard");
  },

  getActivityTimeline() {
    return apiClient.get<{ items: PdaAuditEntry[] }>("/pda/dashboard/activity-timeline");
  },

  // ── Managed Apps ──────────────────────────────────────────────────
  getManagedApps(params?: { appType?: string; appStatus?: string; lineCode?: string; q?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.appType) qs.set("appType", params.appType);
    if (params?.appStatus) qs.set("appStatus", params.appStatus);
    if (params?.lineCode) qs.set("lineCode", params.lineCode);
    if (params?.q) qs.set("q", params.q);
    if (params?.limit != null) qs.set("limit", String(params.limit));
    return apiClient.get<ListEnvelope<PdaManagedApp>>(`/pda/managed-apps${qs.toString() ? "?" + qs.toString() : ""}`);
  },

  getManagedApp(id: number) {
    return apiClient.get<{ item: PdaManagedApp }>(`/pda/managed-apps/${id}`);
  },

  createManagedApp(data: Partial<PdaManagedApp>) {
    return apiClient.post<{ item: PdaManagedApp }>("/pda/managed-apps", data);
  },

  updateManagedApp(id: number, data: Partial<PdaManagedApp>) {
    return apiClient.patch<{ item: PdaManagedApp }>(`/pda/managed-apps/${id}`, data);
  },

  deleteManagedApp(id: number) {
    return apiClient.delete<{ success: boolean }>(`/pda/managed-apps/${id}`);
  },
};
