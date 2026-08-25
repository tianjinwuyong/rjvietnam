export type PdaLocale = "zh-CN" | "en-US" | "vi-VN";

export interface PdaContext {
  deviceId: string;
  hostIp: string;
  stationCode: string;
  lineDomain: string;
  locale: PdaLocale;
  operatorId?: string;
  workOrderCode?: string;
  configurationVersion: string;
}

export interface PdaAction<TPayload = unknown> {
  type: string;
  payload: TPayload;
  idempotencyKey?: string;
  traceId?: string;
}

export type PdaDecision =
  | "ALLOW"
  | "HOLD"
  | "REJECT"
  | "REPAIR_ROUTE"
  | "COMPLETED"
  | "CAPTURED";

export interface PdaActionResult<TData = unknown> {
  ok: boolean;
  decision: PdaDecision;
  code: string;
  messageKey: string;
  data?: TData;
  retryable?: boolean;
  traceId: string;
}

export interface PdaHealth {
  status: "healthy" | "degraded" | "offline";
  details?: Record<string, string | number | boolean>;
}

export interface PdaPlugin {
  readonly id: string;
  readonly version: string;
  readonly actions: readonly string[];
  initialize?(context: Readonly<PdaContext>): Promise<void> | void;
  execute(action: PdaAction, context: Readonly<PdaContext>): Promise<PdaActionResult>;
  health?(): Promise<PdaHealth> | PdaHealth;
  dispose?(): Promise<void> | void;
}

export interface PdaAuditEvent {
  eventId: string;
  occurredAt: string;
  pluginId: string;
  actionType: string;
  traceId: string;
  idempotencyKey?: string;
  stationCode: string;
  deviceId: string;
  hostIp: string;
  operatorId?: string;
  workOrderCode?: string;
  decision: PdaDecision;
  resultCode: string;
}

export type PdaAuditSink = (event: PdaAuditEvent) => Promise<void> | void;
