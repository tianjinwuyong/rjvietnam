const DEFAULT_POLICY = Object.freeze({
  autoPassThreshold: 0.92,
  defectReviewThreshold: 0.65,
  maxLatencyMs: 500,
});

function score(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error("Scores must be numbers between 0 and 1");
  return n;
}

/**
 * The visual-inspection module's interface. AI may auto-pass a highly
 * confident good unit, but every suspected defect requires human review.
 */
export function evaluateVisualInspection(input, policy = DEFAULT_POLICY) {
  const passScore = score(input.passScore);
  const defectScore = score(input.defectScore);
  const latencyMs = Math.max(0, Number(input.latencyMs ?? 0));
  const modelHealthy = latencyMs <= policy.maxLatencyMs;

  if (!modelHealthy) {
    return { proposedResult: "REVIEW", status: "PENDING_REVIEW", reasonCode: "LATENCY_BUDGET_EXCEEDED", confidence: Math.max(passScore, defectScore) };
  }
  if (defectScore >= policy.defectReviewThreshold) {
    return { proposedResult: "FAIL", status: "PENDING_REVIEW", reasonCode: "DEFECT_REQUIRES_HUMAN", confidence: defectScore };
  }
  if (passScore >= policy.autoPassThreshold && passScore > defectScore) {
    return { proposedResult: "PASS", status: "AUTO_PASSED", reasonCode: "HIGH_CONFIDENCE_PASS", confidence: passScore };
  }
  return { proposedResult: "REVIEW", status: "PENDING_REVIEW", reasonCode: "LOW_CONFIDENCE", confidence: Math.max(passScore, defectScore) };
}

export { DEFAULT_POLICY };
