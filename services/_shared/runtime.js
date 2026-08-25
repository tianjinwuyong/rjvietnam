import http from "node:http";

export const DEFAULT_SERVICE_PORTS = {
  api: 8080,
  realtime: 8081,
};

export const WORKER_JOBS = [
  "Import AOI/SPI/ICT result files",
  "Generate daily/monthly reports",
  "Recalculate inventory balances",
  "Send shortage and delivery-risk alerts",
  "Archive old machine files",
  "Sync smart shelf state",
];

export function resolveListenPort(value, fallbackPort, serviceName) {
  const rawPort = value ?? String(fallbackPort);
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${serviceName} port must be an integer from 0 to 65535`);
  }

  return port;
}

export function createJsonResponder(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function createHealthResponder(serviceName, getPort, startedAt = Date.now()) {
  return (_req, res) => {
    createJsonResponder(res, 200, {
      ok: true,
      service: serviceName,
      port: getPort(),
      status: "ready",
      uptimeMs: Date.now() - startedAt,
    });
  };
}

export function validateJobList(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("worker job list must not be empty");
  }

  const seen = new Set();
  for (const job of jobs) {
    if (typeof job !== "string" || job.trim().length === 0) {
      throw new Error("worker job names must be non-empty strings");
    }
    const normalized = job.trim();
    if (seen.has(normalized)) {
      throw new Error(`worker job list contains a duplicate job: ${normalized}`);
    }
    seen.add(normalized);
  }

  return [...seen];
}

export function createWorkerManifest() {
  const jobs = validateJobList(WORKER_JOBS);
  return {
    service: "worker",
    jobs,
    jobCount: jobs.length,
  };
}

export function startHttpService({
  serviceName,
  requestedPort,
  handler,
}) {
  const server = http.createServer(handler);
  let activePort = requestedPort;

  server.listen(requestedPort, "127.0.0.1", () => {
    const address = server.address();
    activePort = typeof address === "object" && address ? address.port : requestedPort;
    console.log(`${serviceName} service listening on http://127.0.0.1:${activePort}`);
  });

  return {
    server,
    getPort: () => activePort,
  };
}
