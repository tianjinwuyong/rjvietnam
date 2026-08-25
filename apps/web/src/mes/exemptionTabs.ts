export type ExemptionRowLike = {
  exceptionType: string;
};

export type ExemptionTab = "all" | "material" | "binding" | "quality" | "system" | "other";

const MATERIAL_TYPES = new Set(["UNCLASSIFIED_MATERIAL", "NEGATIVE_BALANCE", "BOM_VARIANCE", "MSD_BLOCKED"]);
const BINDING_TYPES = new Set(["BINDING_MISMATCH", "NPM_UNMATCHED"]);
const QUALITY_TYPES = new Set(["IQC_BLOCKED", "EXPIRY_BLOCKED"]);
const SYSTEM_TYPES = new Set(["OFFLINE_VIOLATION"]);

export function exemptionTabForType(exceptionType: string): ExemptionTab {
  const normalized = exceptionType.trim().toUpperCase();
  if (MATERIAL_TYPES.has(normalized)) return "material";
  if (BINDING_TYPES.has(normalized)) return "binding";
  if (QUALITY_TYPES.has(normalized)) return "quality";
  if (SYSTEM_TYPES.has(normalized)) return "system";
  return "other";
}

export function filterExemptions<T extends ExemptionRowLike>(rows: T[], tab: ExemptionTab): T[] {
  return tab === "all" ? rows : rows.filter(row => exemptionTabForType(row.exceptionType) === tab);
}
