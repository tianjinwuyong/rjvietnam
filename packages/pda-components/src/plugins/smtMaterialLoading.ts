import type { PdaAction, PdaActionResult, PdaContext, PdaPlugin } from "../contracts";

export type LoadingStep = "machine" | "channel" | "feeder" | "material" | "ready";

export interface SmtLoadingState {
  step: LoadingStep;
  machineCode?: string;
  channelCode?: string;
  feederCode?: string;
  materialCode?: string;
}

export interface SmtMaterialLoadingMes {
  validate(input: Required<Omit<SmtLoadingState, "step">> & {
    operatorId: string;
    workOrderCode: string;
    stationCode: string;
    idempotencyKey: string;
  }): Promise<{ allowed: boolean; code: string; messageKey?: string; details?: unknown }>;
  confirm(input: Required<Omit<SmtLoadingState, "step">> & {
    operatorId: string;
    workOrderCode: string;
    stationCode: string;
    idempotencyKey: string;
  }): Promise<{ loadingId: string; code: string }>;
}

const sequence: Exclude<LoadingStep, "ready">[] = ["machine", "channel", "feeder", "material"];

function clean(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function createSmtMaterialLoadingPlugin(mes: SmtMaterialLoadingMes): PdaPlugin {
  let state: SmtLoadingState = { step: "machine" };

  const reset = () => { state = { step: "machine" }; };
  const complete = () => Boolean(state.machineCode && state.channelCode && state.feederCode && state.materialCode);
  const requiredContext = (context: Readonly<PdaContext>, action: PdaAction): PdaActionResult | undefined => {
    if (!context.operatorId) return { ok: false, decision: "HOLD", code: "OPERATOR_REQUIRED", messageKey: "pda.loading.operatorRequired", traceId: action.traceId! };
    if (!context.workOrderCode) return { ok: false, decision: "HOLD", code: "WORK_ORDER_REQUIRED", messageKey: "pda.loading.workOrderRequired", traceId: action.traceId! };
    if (!action.idempotencyKey) return { ok: false, decision: "HOLD", code: "IDEMPOTENCY_REQUIRED", messageKey: "pda.loading.idempotencyRequired", traceId: action.traceId! };
  };
  const loadingInput = (context: Readonly<PdaContext>, action: PdaAction) => ({
    machineCode: state.machineCode!,
    channelCode: state.channelCode!,
    feederCode: state.feederCode!,
    materialCode: state.materialCode!,
    operatorId: context.operatorId!,
    workOrderCode: context.workOrderCode!,
    stationCode: context.stationCode,
    idempotencyKey: action.idempotencyKey!,
  });

  return {
    id: "smt-material-loading",
    version: "1.0.0",
    actions: ["smt-loading.scan", "smt-loading.state", "smt-loading.reset", "smt-loading.validate", "smt-loading.confirm"],
    async execute(action: PdaAction, context: Readonly<PdaContext>): Promise<PdaActionResult> {
      if (action.type === "smt-loading.state") {
        return { ok: true, decision: "CAPTURED", code: "STATE_READ", messageKey: "pda.loading.state", data: { ...state }, traceId: action.traceId! };
      }
      if (action.type === "smt-loading.reset") {
        reset();
        return { ok: true, decision: "CAPTURED", code: "LOADING_RESET", messageKey: "pda.loading.reset", data: { ...state }, traceId: action.traceId! };
      }
      if (action.type === "smt-loading.scan") {
        const value = clean((action.payload as { rawValue?: unknown })?.rawValue);
        if (!value) return { ok: false, decision: "REJECT", code: "EMPTY_SCAN", messageKey: "pda.scanner.invalid", data: { ...state }, traceId: action.traceId! };
        if (state.step === "ready") return { ok: false, decision: "HOLD", code: "SEQUENCE_COMPLETE", messageKey: "pda.loading.validateFirst", data: { ...state }, traceId: action.traceId! };
        const current = state.step;
        const field = `${current}Code` as "machineCode" | "channelCode" | "feederCode" | "materialCode";
        state = { ...state, [field]: value, step: sequence[sequence.indexOf(current) + 1] ?? "ready" };
        return { ok: true, decision: "CAPTURED", code: `${current.toUpperCase()}_CAPTURED`, messageKey: `pda.loading.${current}Captured`, data: { ...state }, traceId: action.traceId! };
      }
      if (!complete()) return { ok: false, decision: "HOLD", code: "SCAN_SEQUENCE_INCOMPLETE", messageKey: "pda.loading.incomplete", data: { ...state }, traceId: action.traceId! };
      const contextError = requiredContext(context, action);
      if (contextError) return contextError;
      try {
        if (action.type === "smt-loading.validate") {
          const result = await mes.validate(loadingInput(context, action));
          return { ok: result.allowed, decision: result.allowed ? "ALLOW" : "REJECT", code: result.code, messageKey: result.messageKey ?? (result.allowed ? "pda.loading.allowed" : "pda.loading.rejected"), data: { state: { ...state }, details: result.details }, traceId: action.traceId! };
        }
        const result = await mes.confirm(loadingInput(context, action));
        const completed = { ...state };
        reset();
        return { ok: true, decision: "COMPLETED", code: result.code, messageKey: "pda.loading.completed", data: { loadingId: result.loadingId, state: completed }, traceId: action.traceId! };
      } catch {
        return { ok: false, decision: "HOLD", code: "MES_UNAVAILABLE", messageKey: "pda.loading.mesUnavailable", retryable: true, data: { ...state }, traceId: action.traceId! };
      }
    },
    health: () => ({ status: "healthy", details: { step: state.step } }),
  };
}
