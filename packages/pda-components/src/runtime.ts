import type {
  PdaAction,
  PdaActionResult,
  PdaAuditSink,
  PdaContext,
  PdaHealth,
  PdaPlugin,
} from "./contracts";

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface PdaRuntime {
  initialize(): Promise<void>;
  execute<T = unknown>(type: string, payload: unknown, options?: { idempotencyKey?: string; traceId?: string }): Promise<PdaActionResult<T>>;
  health(): Promise<Record<string, PdaHealth>>;
  dispose(): Promise<void>;
}

export function createPdaRuntime(input: {
  context: PdaContext;
  plugins: PdaPlugin[];
  auditSink?: PdaAuditSink;
}): PdaRuntime {
  const actionOwners = new Map<string, PdaPlugin>();
  for (const plugin of input.plugins) {
    for (const action of plugin.actions) {
      if (actionOwners.has(action)) throw new Error(`PDA action already registered: ${action}`);
      actionOwners.set(action, plugin);
    }
  }

  return {
    async initialize() {
      for (const plugin of input.plugins) await plugin.initialize?.(Object.freeze({ ...input.context }));
    },

    async execute<T>(
      type: string,
      payload: unknown,
      options: { idempotencyKey?: string; traceId?: string } = {},
    ): Promise<PdaActionResult<T>> {
      const plugin = actionOwners.get(type);
      if (!plugin) throw new Error(`No PDA module handles action: ${type}`);
      const traceId = options.traceId ?? newId("trace");
      const action: PdaAction = { type, payload, traceId, idempotencyKey: options.idempotencyKey };
      const result = (await plugin.execute(action, Object.freeze({ ...input.context }))) as PdaActionResult<T>;
      const normalized = { ...result, traceId };
      await input.auditSink?.({
        eventId: newId("pda-event"),
        occurredAt: new Date().toISOString(),
        pluginId: plugin.id,
        actionType: type,
        traceId,
        idempotencyKey: options.idempotencyKey,
        stationCode: input.context.stationCode,
        deviceId: input.context.deviceId,
        hostIp: input.context.hostIp,
        operatorId: input.context.operatorId,
        workOrderCode: input.context.workOrderCode,
        decision: normalized.decision,
        resultCode: normalized.code,
      });
      return normalized;
    },

    async health() {
      const report: Record<string, PdaHealth> = {};
      for (const plugin of input.plugins) report[plugin.id] = (await plugin.health?.()) ?? { status: "healthy" };
      return report;
    },

    async dispose() {
      for (const plugin of [...input.plugins].reverse()) await plugin.dispose?.();
    },
  };
}
// @ts-nocheck
