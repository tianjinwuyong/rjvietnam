import { apiClient } from "./client";

export interface AiVisualInspection {
  id:number; inspection_no:string; station_code:string; sn:string;
  model_name:string; model_version:string; pass_score:number; defect_score:number;
  defect_code:string|null; inference_latency_ms:number; proposed_result:"PASS"|"FAIL"|"REVIEW";
  confidence:number; reason_code:string; status:"AUTO_PASSED"|"PENDING_REVIEW"|"REVIEWED";
  final_result:"PASS"|"FAIL"|null; reviewed_by:string|null; created_at:string;
}

export const visualInspectionApi = {
  list: () => apiClient.get<{items:AiVisualInspection[];total:number}>("/qms/ai-inspections"),
  submit: (payload:Record<string,unknown>) =>
    apiClient.post<{item:AiVisualInspection}>("/qms/ai-inspections", payload),
  review: (id:number, decision:"PASS"|"FAIL") =>
    apiClient.post<{item:AiVisualInspection}>(`/qms/ai-inspections/${id}/review`,
      {decision, comment:"Reviewed in QMS AI inspection cockpit"}),
};
