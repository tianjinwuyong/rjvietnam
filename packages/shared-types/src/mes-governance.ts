export type MesEvidenceReference = {
  sourceSystem: "MES" | "PMC" | "WMS" | "QMS" | "STATION" | "DEVICE";
  sourceRecord: string;
  sourceEventId?: string;
  occurredAt?: string;
};

export type MesDefinitionStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "RETIRED";

export type MesDefinition = {
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  meaning: string;
  rationale: string;
  ownerRole: string;
  sourceOfTruth: string;
  formulaOrRule: string;
  scope: string;
  version: number;
  status: MesDefinitionStatus;
  approvedBy?: string;
  approvedAt?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
};

export type MesGovernedValue<T> = {
  definitionCode: string;
  definitionVersion: number;
  value: T;
  calculatedAt: string;
  evidence: MesEvidenceReference[];
};

export type MesDecisionEvidence = {
  decisionId: string;
  decisionType: string;
  result: "ALLOW" | "BLOCK" | "HOLD" | "ROUTE" | "CLOSE";
  reasonCode: string;
  reasonText: string;
  definitionCode: string;
  definitionVersion: number;
  evidence: MesEvidenceReference[];
  decidedAt: string;
  decidedBy: string;
};

export type MesClosedLoopDefinition = {
  projectCode: string;
  trigger: string;
  accountableRole: string;
  requiredActions: string[];
  verificationRule: string;
  closureRule: string;
  slaDefinitionCode?: string;
  escalationRule?: string;
  auditEventTypes: string[];
  reviewMetricDefinitionCodes: string[];
};
