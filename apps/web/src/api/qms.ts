import { apiClient } from "./client";

export interface QmsOqcBatch {
  id: number; batch_no: string; shipment_no: string | null;
  customer_code: string | null; customer_name: string | null;
  customer_po_no: string | null; inspection_type: string; status: string;
  total_qty: number; sample_size: number; passed_qty: number; failed_qty: number;
  aql_level: string | null; ac_reject: number; re_pass: number;
  inspector_id: number | null; inspector_name: string | null;
  inspection_started_at: string | null; inspection_completed_at: string | null;
  remarks: string | null; factory_id: string; created_at: string; updated_at: string;
}
export interface QmsOqcItem {
  id: number; batch_id: number; sn: string | null;
  material_code: string | null; material_name: string | null;
  result: string; defect_code: string | null; defect_desc: string | null;
  severity: string | null; inspector_name: string | null;
  inspected_at: string | null; created_at: string;
}
export interface QmsEightD {
  id: number; report_no: string; title: string; source: string;
  severity: string; status: string; customer_code: string | null;
  customer_name: string | null; wo_code: string | null; batch_no: string | null;
  defect_code: string | null; defect_desc: string | null; ng_qty: number;
  d1_team: string | null; d2_problem: string | null; d3_containment: string | null;
  d4_root_cause: string | null; d5_corrective: string | null;
  d6_implement: string | null; d7_preventive: string | null;
  d8_congratulate: string | null; opened_by: string | null;
  opened_at: string | null; closed_at: string | null;
  factory_id: string; created_at: string; updated_at: string;
}
export interface QmsNgCase {
  id: number; case_no: string; sn: string | null; wo_code: string | null;
  station_code: string | null; defect_code: string | null;
  defect_desc: string | null; severity: string; status: string;
  repair_count: number; retest_count: number; repair_notes: string | null;
  retest_result: string | null; scrap_reason: string | null;
  scrap_approved_by: string | null; operator_name: string | null;
  created_at: string; updated_at: string;
}
export interface QmsKpiSummary {
  total_oqc_batches: number; oqc_pass_rate: number;
  total_8d: number; open_8d: number; closed_8d: number;
  total_ng: number; ng_repaired: number; ng_scrapped: number; ng_pending: number;
  customer_complaints: number; supplier_ppm: number;
}
export interface QmsCustomerStandard {
  id: number; customer_code: string; customer_name: string;
  inspection_type: string; aql_level: string; sample_plan: string | null;
  special_requirements: string | null; is_active: boolean;
  created_at: string; updated_at: string;
}

// The QMS surface is extended in phases below. Keep one stable, permissive
// client shape while the backend rolls out the newer IPQC/SPC endpoints.
export const qmsApi: any = {
  listOqcBatches: (p?: Record<string,string>) => apiClient.get<{data:{items:QmsOqcBatch[],total:number}}>("/qms/oqc/batches",{params:p}),
  createOqcBatch: (d: Partial<QmsOqcBatch>) => apiClient.post<QmsOqcBatch>("/qms/oqc/batches",d),
  getOqcBatch: (id: number) => apiClient.get<QmsOqcBatch>(`/qms/oqc/batches/${id}`),
  updateOqcBatch: (id: number, d: Partial<QmsOqcBatch>) => apiClient.put<QmsOqcBatch>(`/qms/oqc/batches/${id}`,d),
  listOqcItems: (p?: Record<string,string>) => apiClient.get<{data:{items:QmsOqcItem[],total:number}}>("/qms/oqc/items",{params:p}),
  recordOqcItem: (d: Partial<QmsOqcItem>) => apiClient.post<QmsOqcItem>("/qms/oqc/items",d),
  list8d: (p?: Record<string,string>) => apiClient.get<{data:{items:QmsEightD[],total:number}}>("/qms/8d",{params:p}),
  create8d: (d: Partial<QmsEightD>) => apiClient.post<QmsEightD>("/qms/8d",d),
  get8d: (id: number) => apiClient.get<QmsEightD>(`/qms/8d/${id}`),
  update8d: (id: number, d: Partial<QmsEightD>) => apiClient.put<QmsEightD>(`/qms/8d/${id}`,d),
  add8dEvidence: (id: number, d: {evidence_type:string;content:string}) => apiClient.post(`/qms/8d/${id}/evidence`,d),
  close8d: (id: number) => apiClient.put(`/qms/8d/${id}/close`),
  listNgCases: (p?: Record<string,string>) => apiClient.get<{data:{items:QmsNgCase[],total:number}}>("/qms/ng/cases",{params:p}),
  createNgCase: (d: Partial<QmsNgCase>) => apiClient.post<QmsNgCase>("/qms/ng/cases",d),
  repairNg: (id: number, d: {repair_notes:string}) => apiClient.put(`/qms/ng/cases/${id}/repair`,d),
  retestNg: (id: number, d: {retest_result:string}) => apiClient.put(`/qms/ng/cases/${id}/retest`,d),
  scrapNg: (id: number, d: {scrap_reason:string;scrap_approved_by:string}) => apiClient.put(`/qms/ng/cases/${id}/scrap`,d),
  getKpiSummary: () => apiClient.get<QmsKpiSummary>("/qms/kpi/summary"),
  listCustomerStandards: () => apiClient.get<QmsCustomerStandard[]>("/qms/customer-standards"),
};

// ── Phase 2: IPQC + SPC Types ─────────────────────────────────────────────────

export interface QmsIpqcInspection {
  id: number; inspection_no: string; wo_code: string | null;
  line_code: string | null; station_code: string | null;
  inspection_type: string; status: string;
  inspector_id: number | null; inspector_name: string | null;
  scheduled_at: string | null; started_at: string | null; completed_at: string | null;
  result_summary: string | null; factory_id: string;
  created_at: string; updated_at: string;
  items?: QmsIpqcItem[];
}
export interface QmsIpqcItem {
  id: number; inspection_id: number; item_code: string | null;
  item_name: string | null; category: string | null;
  standard_value: string | null; actual_value: string | null;
  upper_limit: number | null; lower_limit: number | null;
  measured_value: number | null; result: string;
  defect_code: string | null; remarks: string | null;
  inspected_at: string | null; created_at: string;
}
export interface QmsFirstArticle {
  id: number; fa_no: string; wo_code: string; line_code: string | null;
  product_code: string | null; product_name: string | null;
  status: string; checked_by: string | null; approved_by: string | null;
  check_items: any[]; photos: any[]; remarks: string | null;
  checked_at: string | null; approved_at: string | null;
  factory_id: string; created_at: string; updated_at: string;
}
export interface QmsSpcParam {
  id: number; param_code: string; param_name: string;
  param_name_en: string | null; param_name_vi: string | null;
  category: string; unit: string | null;
  usl: number | null; lsl: number | null; target_value: number | null;
  ucl: number | null; lcl: number | null;
  sample_size: number; station_code: string | null;
  is_active: boolean; factory_id: string;
  created_at: string; updated_at: string;
}
export interface QmsSpcReading {
  id: number; param_id: number; wo_code: string | null;
  line_code: string | null; station_code: string | null;
  lot_no: string | null; measured_value: number;
  sample_group: number | null; is_ooc: boolean;
  rule_violated: string | null; recorded_at: string;
  recorded_by: string | null; factory_id: string;
  param_name?: string; param_code?: string; unit?: string;
  usl?: number; lsl?: number; ucl?: number; lcl?: number; target_value?: number;
}
export interface QmsSpcCpk {
  param: QmsSpcParam; cpk: number | null; cp: number | null;
  mean: number | null; std: number | null; count: number;
  trend: string | null; message?: string;
}
export interface QmsSpcAlert {
  id: number; param_id: number; reading_id: number | null;
  alert_type: string; severity: string; message: string | null;
  cpk_value: number | null; status: string;
  acknowledged_by: string | null; resolved_at: string | null;
  factory_id: string; created_at: string;
  param_name?: string; param_code?: string;
}

// ── Phase 2 API Methods ───────────────────────────────────────────────────────

Object.assign(qmsApi, {
  // IPQC
  listIpqc: (p?: Record<string,string>) => apiClient.get<QmsIpqcInspection[]>("/qms/ipqc",{params:p}),
  createIpqc: (d: any) => apiClient.post<QmsIpqcInspection>("/qms/ipqc",d),
  getIpqc: (id: number) => apiClient.get<QmsIpqcInspection>(`/qms/ipqc/${id}`),
  updateIpqc: (id: number, d: any) => apiClient.put<QmsIpqcInspection>(`/qms/ipqc/${id}`,d),
  addIpqcItem: (id: number, d: any) => apiClient.post<QmsIpqcItem>(`/qms/ipqc/${id}/items`,d),
  // First Article
  listFirstArticle: (p?: Record<string,string>) => apiClient.get<QmsFirstArticle[]>("/qms/first-article",{params:p}),
  createFirstArticle: (d: any) => apiClient.post<QmsFirstArticle>("/qms/first-article",d),
  approveFirstArticle: (id: number, d: any) => apiClient.put<QmsFirstArticle>(`/qms/first-article/${id}`,d),
  // SPC Params
  listSpcParams: (p?: Record<string,string>) => apiClient.get<QmsSpcParam[]>("/qms/spc/params",{params:p}),
  createSpcParam: (d: any) => apiClient.post<QmsSpcParam>("/qms/spc/params",d),
  updateSpcParam: (id: number, d: any) => apiClient.put<QmsSpcParam>(`/qms/spc/params/${id}`,d),
  // SPC Readings
  listSpcReadings: (p?: Record<string,string>) => apiClient.get<QmsSpcReading[]>("/qms/spc/readings",{params:p}),
  recordSpcReading: (d: any) => apiClient.post<QmsSpcReading>("/qms/spc/readings",d),
  // SPC CPK
  getSpcCpk: (paramId: number, hours?: number) => apiClient.get<QmsSpcCpk>("/qms/spc/cpk",{params:{param_id:String(paramId),hours:String(hours||168)}}),
  // SPC Alerts
  listSpcAlerts: (p?: Record<string,string>) => apiClient.get<QmsSpcAlert[]>("/qms/spc/alerts",{params:p}),
  updateSpcAlert: (id: number, d: any) => apiClient.put<QmsSpcAlert>(`/qms/spc/alerts/${id}`,d),
});


// ── Phase 3: Documents + Audits + Complaints + SupplierEval + QualityCosts ─────

export interface QmsDocument {
  id: number; doc_no: string; doc_title: string;
  doc_type: string; iso_standard: string | null; department: string | null;
  revision: string; status: string;
  effective_date: string | null; expiry_date: string | null;
  author: string | null; approved_by: string | null;
  file_path: string | null; description: string | null;
  factory_id: string; created_at: string; updated_at: string;
}

export interface QmsDocRevision {
  id: number; doc_id: number; revision: string;
  change_desc: string | null; changed_by: string | null;
  file_path: string | null; created_at: string;
}

export interface QmsAudit {
  id: number; audit_no: string; audit_type: string;
  iso_standard: string | null; title: string; scope: string | null;
  status: string; lead_auditor: string | null; audit_team: any;
  planned_date: string | null; actual_date: string | null;
  department: string | null; findings_count: number; nc_count: number;
  conclusion: string | null; report_path: string | null;
  factory_id: string; created_at: string; updated_at: string;
}

export interface QmsAuditNc {
  id: number; audit_id: number; nc_no: string | null;
  severity: string; clause: string | null; finding: string;
  root_cause: string | null; corrective_action: string | null;
  due_date: string | null; status: string;
  verified_by: string | null; verified_at: string | null; created_at: string;
}

export interface QmsComplaint {
  id: number; complaint_no: string; customer_code: string | null;
  customer_name: string | null; complaint_date: string;
  product_code: string | null; product_name: string | null;
  batch_no: string | null; sn_list: any; defect_desc: string;
  defect_qty: number; severity: string; status: string;
  eight_d_id: number | null; ppm_value: number | null;
  compensation_type: string | null; compensation_amount: number | null;
  customer_level: string | null; handler: string | null;
  resolved_at: string | null; satisfaction_score: number | null;
  factory_id: string; created_at: string; updated_at: string;
}

export interface QmsComplaintStats {
  total: number; open: number; investigating: number;
  resolved: number; closed: number; avg_resolution_days: number;
}

export interface QmsSupplierEval {
  id: number; supplier_code: string; supplier_name: string | null;
  eval_period: string; iqc_pass_rate: number | null;
  oqc_reject_rate: number | null; delivery_rate: number | null;
  complaint_count: number; eight_d_count: number;
  total_score: number | null; grade: string | null;
  co_cq_status: string; action_required: string | null;
  status: string; factory_id: string; created_at: string; updated_at: string;
}

export interface QmsSupplierEvalStats {
  total_suppliers: number; avg_score: number;
  grade_a: number; grade_b: number; grade_c: number; grade_d: number;
  blocked: number;
}

export interface QmsQualityCost {
  id: number; cost_period: string; cost_category: string;
  cost_type: string | null; wo_code: string | null;
  line_code: string | null; department: string | null;
  amount: number; currency: string;
  description: string | null; source_type: string | null;
  source_id: number | null; factory_id: string; created_at: string;
}

export interface QmsQualityCostSummary {
  period: string;
  prevention: number; appraisal: number;
  internal_failure: number; external_failure: number;
  total: number; currency: string;
}

// ── Phase 3 API Methods ───────────────────────────────────────────────────────

Object.assign(qmsApi, {
  // Documents
  listDocuments: (p?: Record<string,string>) =>
    apiClient.get<QmsDocument[]>("/qms/documents",{params:p}),
  createDocument: (d: Partial<QmsDocument>) =>
    apiClient.post<QmsDocument>("/qms/documents",d),
  getDocument: (id: number) =>
    apiClient.get<QmsDocument>(`/qms/documents/${id}`),
  updateDocument: (id: number, d: Partial<QmsDocument>) =>
    apiClient.put<QmsDocument>(`/qms/documents/${id}`,d),
  approveDocument: (id: number) =>
    apiClient.put(`/qms/documents/${id}/approve`),
  // Audits
  listAudits: (p?: Record<string,string>) =>
    apiClient.get<QmsAudit[]>("/qms/audits",{params:p}),
  createAudit: (d: Partial<QmsAudit>) =>
    apiClient.post<QmsAudit>("/qms/audits",d),
  getAudit: (id: number) =>
    apiClient.get<QmsAudit>(`/qms/audits/${id}`),
  updateAudit: (id: number, d: Partial<QmsAudit>) =>
    apiClient.put<QmsAudit>(`/qms/audits/${id}`,d),
  updateAuditStatus: (id: number, d: {status:string}) =>
    apiClient.put(`/qms/audits/${id}/status`, d),
  listAuditNc: (auditId: number) =>
    apiClient.get<QmsAuditNc[]>(`/qms/audits/${auditId}/findings`),
  createAuditNc: (auditId: number, d: Partial<QmsAuditNc>) =>
    apiClient.post<QmsAuditNc>(`/qms/audits/${auditId}/findings`, d),
  updateAuditNc: (fid: number, d: Partial<QmsAuditNc>) =>
    apiClient.put<QmsAuditNc>(`/qms/audits/findings/${fid}/status`, d),
  // Complaints
  listComplaints: (p?: Record<string,string>) =>
    apiClient.get<QmsComplaint[]>("/qms/complaints",{params:p}),
  createComplaint: (d: Partial<QmsComplaint>) =>
    apiClient.post<QmsComplaint>("/qms/complaints",d),
  getComplaint: (id: number) =>
    apiClient.get<QmsComplaint>(`/qms/complaints/${id}`),
  updateComplaint: (id: number, d: Partial<QmsComplaint>) =>
    apiClient.put<QmsComplaint>(`/qms/complaints/${id}`,d),
  respondComplaint: (id: number, d: {response_text:string;respond_by:string}) =>
    apiClient.post(`/qms/complaints/${id}/respond`, d),
  getComplaintResponses: (id: number) =>
    apiClient.get(`/qms/complaints/${id}/responses`),
  getComplaintStats: () =>
    apiClient.get<QmsComplaintStats>("/qms/complaints/stats"),
  // Supplier Evaluations
  listSupplierEvals: (p?: Record<string,string>) =>
    apiClient.get<QmsSupplierEval[]>("/qms/supplier-evaluations",{params:p}),
  createSupplierEval: (d: Partial<QmsSupplierEval>) =>
    apiClient.post<QmsSupplierEval>("/qms/supplier-evaluations",d),
  getSupplierEval: (id: number) =>
    apiClient.get<QmsSupplierEval>(`/qms/supplier-evaluations/${id}`),
  updateSupplierEval: (id: number, d: Partial<QmsSupplierEval>) =>
    apiClient.put<QmsSupplierEval>(`/qms/supplier-evaluations/${id}`,d),
  getSupplierEvalHistory: (supplierId: string) =>
    apiClient.get<QmsSupplierEval[]>(`/qms/supplier-evaluations/history/${supplierId}`),
  getSupplierEvalStats: () =>
    apiClient.get<QmsSupplierEvalStats>("/qms/supplier-evaluations/stats"),
  getSupplierEvalSuppliers: () =>
    apiClient.get<{supplier_code:string;supplier_name:string}[]>("/qms/supplier-evaluations/suppliers"),
  // Quality Costs
  listQualityCosts: (p?: Record<string,string>) =>
    apiClient.get<QmsQualityCost[]>("/qms/quality-costs",{params:p}),
  createQualityCost: (d: Partial<QmsQualityCost>) =>
    apiClient.post<QmsQualityCost>("/qms/quality-costs",d),
  getQualityCost: (id: number) =>
    apiClient.get<QmsQualityCost>(`/qms/quality-costs/${id}`),
  updateQualityCost: (id: number, d: Partial<QmsQualityCost>) =>
    apiClient.put<QmsQualityCost>(`/qms/quality-costs/${id}`,d),
  getQualityCostSummary: (p?: {period?:string}) =>
    apiClient.get<QmsQualityCostSummary[]>("/qms/quality-costs/summary",{params:p}),
});
