import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiModuleCatalog } from "../services/api/src/contracts/api-contract";
import { apiModules } from "../services/api/src/app";
import { validateApiContract } from "../services/api/src/contracts/validation";
import { validateInventoryTransaction } from "../packages/business-rules/src/inventory";
import { startBackendValidationLoop } from "../services/worker/backend-validator";

// Enable the API smoke test when a PostgreSQL host is reachable at 127.0.0.1
// Always set defaults so vitest workers (which isolate env) also see them
process.env.PGHOST = process.env.PGHOST || process.env.DATABASE_URL || "127.0.0.1";
process.env.PGPASSWORD = process.env.PGPASSWORD || "postgres";
process.env.PGUSER = process.env.PGUSER || "postgres";
process.env.PGDATABASE = process.env.PGDATABASE || "smt_factory";
process.env.PGPORT = process.env.PGPORT || "5432";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

function spawnService(scriptPath: string, env: Record<string, string | undefined> = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...env,
      // Always pass DB credentials so the API server can connect
      PGHOST: process.env.PGHOST ?? "127.0.0.1",
      PGPASSWORD: process.env.PGPASSWORD ?? "postgres",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return child;
}

async function waitForLine(child: ReturnType<typeof spawnService>, pattern: RegExp, timeoutMs = 10_000): Promise<string> {
  let buffer = "";
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out after ${timeoutMs}ms waiting for ${pattern}. Received: ${buffer.slice(0, 500)}`));
    }, timeoutMs);

    const onData = (chunk: { toString(encoding: string): string }) => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(pattern);
      if (match) {
        cleanup();
        resolve(match[0]);
      }
    };

    const onExit = (code: number | null, signal: string | null) => {
      cleanup();
      reject(new Error(`service exited before emitting expected output (${code ?? signal ?? "unknown"}). Received: ${buffer.slice(0, 500)}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function readJson(url: string) {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

afterEach(() => {
  // The individual tests clean up their own child processes.
});

describe("backend contract validation", () => {
  it("keeps the API module catalog aligned with the OpenAPI route inventory", () => {
    expect(validateApiContract()).toEqual([]);
    expect(apiModules.map((module) => module.key)).toEqual(
      expect.arrayContaining(apiModuleCatalog.map((entry) => entry.key)),
    );
  });

  it("enforces inventory transaction boundary rules", () => {
    expect(
      validateInventoryTransaction({
        action: "PUT_AWAY",
        materialLotId: "lot-001",
        quantity: 24,
        toLocationCode: "WH-A1",
        operator: "warehouse-op",
      }),
    ).toEqual([]);

    expect(
      validateInventoryTransaction({
        action: "RESERVE",
        materialLotId: "",
        quantity: 0,
        operator: "",
      }),
    ).toEqual(
      expect.arrayContaining([
        "materialLotId is required",
        "operator is required",
        "quantity must be greater than 0",
        "RESERVE requires workOrderCode",
      ]),
    );
  });
});

describe("backend service startup smoke checks", () => {
  // Requires a live PostgreSQL connection — skip when PGHOST is not configured in the shell environment
  if (process.env.PGHOST || process.env.DATABASE_URL) {
    it("boots the API service on an ephemeral port and serves health plus OpenAPI", async () => {
      const apiScript = path.join(projectRoot, "services", "api", "server.js");
      const child = spawnService(apiScript, { API_PORT: "0" });
      const portLine = await waitForLine(child, /api service listening on http:\/\/(0\.0\.0\.0|127\.0\.0\.1):(\d+)/i, 15_000);
      const port = Number(portLine.match(/(\d+)$/)?.[1]);

      expect(port).toBeGreaterThan(0);

      const health = await readJson(`http://127.0.0.1:${port}/health`);
      expect(health).toMatchObject({ ok: true, service: "api", port, status: "ready" });

      const openApiResponse = await fetch(`http://127.0.0.1:${port}/openapi.yaml`);
      expect(openApiResponse.ok).toBe(true);
      const openApiText = await openApiResponse.text();
      expect(openApiText).toContain("Vietnam Ruijing SMT Factory API");

      child.kill();
      await once(child, "exit");
    }, 20_000);
  }

  it("boots the realtime service on an ephemeral port and serves health", async () => {
    const realtimeScript = path.join(projectRoot, "services", "realtime", "server.js");
    const child = spawnService(realtimeScript, { REALTIME_PORT: "0" });
    const portLine = await waitForLine(child, /realtime service listening on http:\/\/127\.0\.0\.1:(\d+)/i);
    const port = Number(portLine.match(/(\d+)$/)?.[1]);

    expect(port).toBeGreaterThan(0);

    const health = await readJson(`http://127.0.0.1:${port}/health`);
    expect(health).toMatchObject({ ok: true, service: "realtime", port, status: "ready" });

    child.kill();
    await once(child, "exit");
  });

  it("starts the worker job loop with the expected task manifest", async () => {
    const workerScript = path.join(projectRoot, "services", "worker", "worker.js");
    const child = spawnService(workerScript);
    const firstLine = await waitForLine(child, /Worker service started with \d+ jobs/);
    expect(firstLine).toContain("Worker service started with 6 jobs");

    child.kill();
    await once(child, "exit");
  });

  it("runs the backend validation loop immediately and on the configured interval", () => {
    vi.useFakeTimers();

    const logs: string[] = [];
    const errors: string[] = [];
    const controller = startBackendValidationLoop({
      intervalMs: 1_000,
      logger: {
        log: (message: string) => logs.push(message),
        error: (message: string) => errors.push(message),
        warn: (message: string) => logs.push(message),
      },
    });

    try {
      expect(logs.some((line) => line.startsWith("backend validation passed"))).toBe(true);
      expect(errors).toEqual([]);

      vi.advanceTimersByTime(1_000);
      expect(logs.filter((line) => line.startsWith("backend validation passed")).length).toBeGreaterThanOrEqual(2);
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });
});
