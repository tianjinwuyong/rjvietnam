export const DEFAULT_BACKEND_VALIDATION_INTERVAL_MS: number;

export type BackendValidationLogger = {
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type BackendValidationLoopOptions = {
  intervalMs?: number;
  logger?: BackendValidationLogger;
};

export type BackendValidationLoopController = {
  stop(): void;
};

export function runBackendValidationCycle(): string[];

export function startBackendValidationLoop(
  options?: BackendValidationLoopOptions,
): BackendValidationLoopController;
