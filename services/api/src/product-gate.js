export const PRODUCT_GATE_STATES = Object.freeze([
  "ALLOW", "HOLD", "REJECT", "REPAIR_ROUTE", "COMPLETED",
]);

const decision = (gateState, reasonCode, nextAction, extra = {}) => ({
  gateState,
  allowed: gateState === "ALLOW",
  reasonCode,
  nextAction,
  ...extra,
});

/**
 * Pure Product Gate policy. Persistence and station adapters sit outside this seam.
 * Callers provide MES-owned Product/route/NG facts; the module returns one decision.
 */
export function evaluateProductGate(input = {}) {
  const stationCode = String(input.stationCode || "").trim().toLowerCase();
  const identifier = String(input.identifier || "").trim().toUpperCase();
  if (!stationCode || !identifier) {
    return decision("REJECT", "INVALID_GATE_REQUEST", "CORRECT_SCAN_REQUEST");
  }

  const product = input.product || null;
  if (!product) {
    const firstStation = String(input.firstStationCode || "").trim().toLowerCase();
    if (firstStation && stationCode === firstStation && input.workOrderReleased === true) {
      return decision("ALLOW", "FIRST_REGISTRATION_REQUIRED", "REGISTER_PRODUCT", {
        registrationRequired: true,
      });
    }
    return decision("REJECT", "PRODUCT_NOT_REGISTERED", "RETURN_TO_FIRST_STATION", {
      destinationStationCode: firstStation || null,
    });
  }

  if (["COMPLETED", "SCRAPPED", "DESTROYED", "CANCELLED"].includes(String(product.lifecycleState || "").toUpperCase())) {
    return decision("COMPLETED", "PRODUCT_TERMINAL", "NO_FURTHER_PRODUCTION", {
      productId: product.productId,
    });
  }

  if (input.activeNgCase) {
    const repairStation = String(input.activeNgCase.destinationStationCode || "").trim().toLowerCase();
    return decision("REPAIR_ROUTE", "ACTIVE_NG_DEPENDENT_SEQUENCE", "FOLLOW_NG_ROUTE", {
      productId: product.productId,
      ngCaseId: input.activeNgCase.ngCaseId || null,
      destinationStationCode: repairStation || null,
    });
  }

  if (input.unresolvedDisposition) {
    return decision("HOLD", "DISPOSITION_AUTHORIZATION_REQUIRED", "WAIT_FOR_AUTHORIZATION", {
      productId: product.productId,
      dispositionId: input.unresolvedDisposition.dispositionId || null,
    });
  }

  const missing = Array.isArray(input.missingRequiredStationCodes)
    ? input.missingRequiredStationCodes.filter(Boolean)
    : [];
  if (missing.length) {
    return decision("REJECT", "MISSING_REQUIRED_STATION", "RETURN_TO_MISSING_STATION", {
      productId: product.productId,
      destinationStationCode: String(missing[0]).toLowerCase(),
      missingStationCodes: missing,
    });
  }

  const expected = String(input.expectedStationCode || "").trim().toLowerCase();
  if (expected && expected !== stationCode) {
    return decision("REJECT", "STATION_NOT_EXPECTED", "GO_TO_EXPECTED_STATION", {
      productId: product.productId,
      destinationStationCode: expected,
    });
  }

  const missingIdentities = Array.isArray(input.missingRequiredIdentityTypes)
    ? input.missingRequiredIdentityTypes.filter(Boolean)
    : [];
  if (missingIdentities.length) {
    return decision("HOLD", "PRODUCT_IDENTITY_INCOMPLETE", "BIND_REQUIRED_IDENTITY", {
      productId: product.productId,
      missingIdentityTypes: missingIdentities,
    });
  }

  return decision("ALLOW", "PRODUCT_GATE_PASSED", "START_STATION_WORK", {
    productId: product.productId,
  });
}
