import type { PdaLocale } from "./contracts";

export type PdaModuleId =
  | "scanner"
  | "product-gate"
  | "auth"
  | "alarm"
  | "language"
  | "sync"
  | "receiving"
  | "placement"
  | "consumption"
  | "cycle-count"
  | "iqc-evidence"
  | "printing"
  | "diagnostics"
  | "material-usage";

export interface PdaProfile {
  profileId: string;
  version: string;
  nameKey: string;
  defaultLocale: PdaLocale;
  enabledModules: PdaModuleId[];
  permissions: string[];
  effectiveAt: string;
}

export const BASE_PDA_MODULES: PdaModuleId[] = [
  "scanner",
  "auth",
  "alarm",
  "language",
  "sync",
  "diagnostics",
];

export function resolvePdaModules(profile: PdaProfile): PdaModuleId[] {
  return [...new Set([...BASE_PDA_MODULES, ...profile.enabledModules])];
}
