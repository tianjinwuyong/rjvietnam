export type OaRequestStatus = "pending" | "approved" | "rejected";
export type OaRequestType = "leave" | "purchase" | "expense" | "material_receiving";

export interface OaRequest {
  id: string;
  title: string;
  type: OaRequestType;
  requester: string;
  department: string;
  amount?: number;
  submittedAt: string;
  dueAt: string;
  status: OaRequestStatus;
  summary: string;
  details: Array<{ label: string; value: string }>;
}

export interface OaAuditEvent {
  id: string;
  requestId: string;
  action: "submitted" | "approved" | "rejected";
  actor: string;
  at: string;
  note?: string;
}

const seedRequests: OaRequest[] = [
  {
    id: "OA-20260826-014",
    title: "September line-side tooling purchase",
    type: "purchase",
    requester: "Nguyen Minh Anh",
    department: "Manufacturing Engineering",
    amount: 1280,
    submittedAt: "2026-08-26 09:42",
    dueAt: "2026-08-27",
    status: "pending",
    summary: "Replacement torque drivers and ESD fixtures for L004 manual line.",
    details: [
      { label: "Cost center", value: "VN-ENG-04" },
      { label: "Supplier", value: "Vina Industrial Supply" },
      { label: "Business reason", value: "Two fixtures are beyond calibration window; replacement protects the next model changeover." },
    ],
  },
  {
    id: "OA-20260826-013",
    title: "Annual leave · September 2",
    type: "leave",
    requester: "Tran Thi Hoa",
    department: "SMT Operations",
    submittedAt: "2026-08-26 08:15",
    dueAt: "2026-08-26",
    status: "pending",
    summary: "One day annual leave request with shift coverage confirmed.",
    details: [
      { label: "Leave dates", value: "2026-09-02 (1 day)" },
      { label: "Coverage", value: "Le Van Nam · SMT Operator" },
      { label: "Handover", value: "AOI inspection checklist handed over before shift end." },
    ],
  },
  {
    id: "OA-20260825-011",
    title: "Line 3 overtime meal expense",
    type: "expense",
    requester: "Pham Quoc Bao",
    department: "PMC",
    amount: 86,
    submittedAt: "2026-08-25 17:26",
    dueAt: "2026-08-26",
    status: "approved",
    summary: "Meal expense for approved overtime during customer order recovery.",
    details: [
      { label: "Cost center", value: "VN-PMC-02" },
      { label: "Overtime window", value: "2026-08-25 · 18:00–21:00" },
      { label: "Receipt", value: "Attached · 1 file" },
    ],
  },
];

const seedAudit: OaAuditEvent[] = [
  { id: "AUD-104", requestId: "OA-20260826-014", action: "submitted", actor: "Nguyen Minh Anh", at: "2026-08-26 09:42", note: "Submitted for plant manager review" },
  { id: "AUD-103", requestId: "OA-20260826-013", action: "submitted", actor: "Tran Thi Hoa", at: "2026-08-26 08:15", note: "Coverage confirmed" },
  { id: "AUD-102", requestId: "OA-20260825-011", action: "approved", actor: "Le Quang Huy", at: "2026-08-25 18:02", note: "Approved within PMC overtime budget" },
  { id: "AUD-101", requestId: "OA-20260825-011", action: "submitted", actor: "Pham Quoc Bao", at: "2026-08-25 17:26" },
];

export interface OaRepository {
  listRequests(): Promise<OaRequest[]>;
  listAudit(): Promise<OaAuditEvent[]>;
  submit(request: Omit<OaRequest, "id" | "submittedAt" | "status"> & { requester?: string }): Promise<OaRequest>;
  decide(id: string, decision: "approved" | "rejected", note: string): Promise<{ request: OaRequest; audit: OaAuditEvent }>;
}

/** Replace this adapter with the OA HTTP client when backend contracts are available. */
export function createOaMockRepository(): OaRepository {
  let requests = seedRequests.map((request) => ({ ...request, details: [...request.details] }));
  let audit = [...seedAudit];
  return {
    async listRequests() { return requests; },
    async listAudit() { return audit; },
    async submit(input) {
      const now = new Date();
      const submittedAt = now.toISOString().slice(0, 16).replace("T", " ");
      const request: OaRequest = { ...input, id: `OA-${now.toISOString().slice(0, 10).replace(/-/g, "")}-MAT-${String(Date.now()).slice(-6)}`, requester: input.requester || "Current user", submittedAt, status: "pending" };
      requests = [request, ...requests];
      audit = [{ id: `AUD-${Date.now()}`, requestId: request.id, action: "submitted", actor: request.requester, at: submittedAt, note: "Material receiving approval submitted" }, ...audit];
      return { ...request };
    },
    async decide(id, decision, note) {
      const request = requests.find((item) => item.id === id);
      if (!request) throw new Error("OA request not found");
      request.status = decision;
      const event: OaAuditEvent = { id: `AUD-${Date.now()}`, requestId: id, action: decision, actor: "Current user", at: new Date().toISOString().slice(0, 16).replace("T", " "), note };
      audit = [event, ...audit];
      return { request: { ...request }, audit: event };
    },
  };
}

export const oaRepository = createOaMockRepository();
