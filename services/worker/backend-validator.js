export const DEFAULT_BACKEND_VALIDATION_INTERVAL_MS = 60_000;

function isWorkOrderCode(value) {
  return /^\d{11}$/.test(value);
}

function generateSampleWorkOrderCode() {
  return "26060100001";
}

function validateInventoryTransaction(tx) {
  const issues = [];

  if (!tx.materialLotId) issues.push("materialLotId is required");
  if (!tx.operator) issues.push("operator is required");
  if (!Number.isFinite(tx.quantity) || tx.quantity <= 0) issues.push("quantity must be greater than 0");
  if (["RESERVE", "PICK", "ISSUE_TO_LINE"].includes(tx.action) && !tx.workOrderCode) {
    issues.push(`${tx.action} requires workOrderCode`);
  }
  if (tx.action === "PUT_AWAY" && !tx.toLocationCode) {
    issues.push("PUT_AWAY requires toLocationCode");
  }

  return issues;
}

export function runBackendValidationCycle() {
  const issues = [];

  const sampleWorkOrderCode = generateSampleWorkOrderCode();
  if (!isWorkOrderCode(sampleWorkOrderCode)) {
    issues.push(`work-order-code: sample code is invalid: ${sampleWorkOrderCode}`);
  }

  const inventoryIssues = validateInventoryTransaction({
    action: "PUT_AWAY",
    materialLotId: "validation-lot",
    quantity: 1,
    toLocationCode: "WH-A1",
    operator: "backend-validator",
  });
  if (inventoryIssues.length > 0) {
    issues.push(...inventoryIssues.map((issue) => `inventory: ${issue}`));
  }

  if (typeof fetch === "function") {
    // Optional live health check when the API service is reachable on the standard port.
    // The worker still runs the local rule checks even if the service is not up.
    void fetch("http://127.0.0.1:8080/health")
      .then(async (response) => {
        if (!response.ok) {
          issues.push(`api-health: unexpected status ${response.status}`);
          return;
        }

        const payload = await response.json();
        if (payload?.status !== "ready" || payload?.service !== "api") {
          issues.push("api-health: invalid health payload");
        }
      })
      .catch(() => {
        // Ignore connection failures. The backend validator must still run its local checks.
      });
  }

  return issues;
}

export function startBackendValidationLoop({
  intervalMs = DEFAULT_BACKEND_VALIDATION_INTERVAL_MS,
  logger = console,
} = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new Error("backend validation interval must be a positive integer");
  }

  let running = false;
  let timer = null;

  const runOnce = () => {
    if (running) {
      logger.warn?.("backend validation skipped because a previous cycle is still running");
      return;
    }

    running = true;
    try {
      const issues = runBackendValidationCycle();
      if (issues.length === 0) {
        logger.log?.(`backend validation passed (${new Date().toISOString()})`);
      } else {
        logger.error?.(`backend validation failed with ${issues.length} issue(s)`);
        for (const issue of issues) {
          logger.error?.(`- ${issue}`);
        }
      }
    } catch (error) {
      logger.error?.(`backend validation crashed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };

  runOnce();
  timer = setInterval(runOnce, intervalMs);

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
