// ── Core Quality Types ────────────────────────────────────────────────

export interface QualityRecord {
  id: string;
  inspectionNo: string;
  station: string;
  workOrderCode: string;
  result: string;
  occurredAt: string;
  inspectionType: string;
  operator: string;
  defectCode?: string;
  pcbSerial?: string;
}

// ── AOI Types ────────────────────────────────────────────────────────

export type AoiResult = "PASS" | "FAIL";

export interface AoiInspectionRecord {
  id: string;
  pcbSerial: string;
  workOrderCode: string;
  machineCode: string;
  program: string;
  result: AoiResult;
  defectCount: number;
  defectCodes: string[];
  defectLocations: string[];
  inspectedAt: string;
  operator: string;
  boardId?: string;
  stationCode?: string;
}

export interface AoiDefectCode {
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  category: string;
  description?: string;
}

export interface AoiStats {
  total: number;
  pass: number;
  fail: number;
  yieldRate: number;
  defectPareto: AoiParetoEntry[];
}

export interface AoiParetoEntry {
  defectCode: string;
  count: number;
  percentage: number;
  nameZh?: string;
  nameEn?: string;
  nameVi?: string;
}

export interface AoiStationConfig {
  stationCode: string;
  stationName: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  lineCode: string;
  machineCode: string;
  programName: string;
  status: "active" | "idle" | "down";
}

// ── IQC Types ─────────────────────────────────────────────────────────

export type IqcStatus = "pending" | "hold" | "released" | "rejected";

export interface IqcLot {
  id: string | number;
  materialCode: string;
  lotNo: string;
  supplierCode: string | null;
  qty: number | null;
  iqcStatus: IqcStatus;
  receivedDate?: string;
}

export interface IqcTxRecord {
  id: string;
  txNo: string;
  action: "IQC_RELEASE" | "IQC_REJECT" | "IQC_HOLD";
  materialLotId: string | number;
  materialCode: string;
  lotNo: string;
  qty: number;
  operator: string;
  reason?: string;
  occurredAt: string;
}

// ── Defect Reference ──────────────────────────────────────────────────

// ── FCT Types ───────────────────────────────────────────────────────────

export type FctResult = "PASS" | "FAIL";

export interface FctTestItem {
  testName: string;
  testCode: string;
  result: "PASS" | "FAIL" | "SKIP";
  measuredValue?: string;
  expectedValue?: string;
  unit?: string;
}

export interface FctInspectionRecord {
  id: string;
  pcbSerial: string;
  workOrderCode: string;
  machineCode: string;
  program: string;
  result: FctResult;
  defectCount: number;
  defectCodes: string[];
  defectLocations: string[];
  testItems: FctTestItem[];
  inspectedAt: string;
  operator: string;
  boardId?: string;
  stationCode?: string;
  testDurationMs?: number;
  fixtureCode?: string;
}

export interface FctDefectCode {
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  category: "circuit" | "power" | "communication" | "function" | "config";
  description?: string;
}

export interface FctStats {
  total: number;
  pass: number;
  fail: number;
  yieldRate: number;
  avgTestDurationMs: number;
  defectPareto: FctParetoEntry[];
}

export interface FctParetoEntry {
  defectCode: string;
  count: number;
  percentage: number;
  nameZh?: string;
  nameEn?: string;
  nameVi?: string;
}

export interface FctStationConfig {
  stationCode: string;
  stationName: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  lineCode: string;
  machineCode: string;
  programName: string;
  fixtureCode: string;
  status: "active" | "idle" | "down";
}

// ── Defect Reference ──────────────────────────────────────────────────

export interface DefectCodeRef {
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  category: "solder" | "placement" | "visual" | "component";
}

// ── API List Envelope ─────────────────────────────────────────────────

export interface ListEnvelope<T> {
  items: T[];
  total: number;
}
