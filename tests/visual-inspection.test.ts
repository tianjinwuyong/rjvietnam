import { describe, expect, it } from "vitest";
import { evaluateVisualInspection } from "../services/api/src/visual-inspection.js";

describe("visual inspection safety policy", () => {
  it("auto-passes only a high-confidence good unit", () => {
    expect(evaluateVisualInspection({ passScore: 0.97, defectScore: 0.02, latencyMs: 120 })).toMatchObject({
      proposedResult: "PASS", status: "AUTO_PASSED", reasonCode: "HIGH_CONFIDENCE_PASS",
    });
  });

  it("sends every suspected defect to human review", () => {
    expect(evaluateVisualInspection({ passScore: 0.12, defectScore: 0.88, latencyMs: 120 })).toMatchObject({
      proposedResult: "FAIL", status: "PENDING_REVIEW", reasonCode: "DEFECT_REQUIRES_HUMAN",
    });
  });

  it("falls back to review when latency exceeds its budget", () => {
    expect(evaluateVisualInspection({ passScore: 0.98, defectScore: 0.01, latencyMs: 900 })).toMatchObject({
      proposedResult: "REVIEW", status: "PENDING_REVIEW", reasonCode: "LATENCY_BUDGET_EXCEEDED",
    });
  });
});
