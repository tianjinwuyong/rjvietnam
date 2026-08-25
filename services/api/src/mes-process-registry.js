const PROCESS_DEFINITIONS = Object.freeze({
  MANUAL_LINE_MATERIAL_LOADING: Object.freeze({
    processCode: "MANUAL_LINE_MATERIAL_LOADING",
    domain: "manual-line",
    owner: "MES",
    acceptedFacts: Object.freeze(["MATERIAL_LOADING_SCANNED", "MATERIAL_LOADING_CONFIRMED"]),
    inventoryAuthority: "WMS",
  }),
  MANUAL_LINE_MATERIAL_USAGE: Object.freeze({
    processCode: "MANUAL_LINE_MATERIAL_USAGE",
    domain: "manual-line",
    owner: "MES",
    acceptedFacts: Object.freeze(["MATERIAL_USAGE_REPORTED", "MATERIAL_USAGE_CORRECTED"]),
    inventoryAuthority: "WMS",
  }),
  SMT_FEEDER_LOADING: Object.freeze({
    processCode: "SMT_FEEDER_LOADING",
    domain: "smt",
    owner: "MES",
    acceptedFacts: Object.freeze(["FEEDER_BINDING_VALIDATED", "FEEDER_LOADING_CONFIRMED"]),
    inventoryAuthority: "WMS",
  }),
  SMT_MACHINE_CONSUMPTION: Object.freeze({
    processCode: "SMT_MACHINE_CONSUMPTION",
    domain: "smt",
    owner: "MES",
    acceptedFacts: Object.freeze(["MACHINE_CONSUMPTION_REPORTED", "MACHINE_CONSUMPTION_RECONCILED"]),
    inventoryAuthority: "WMS",
  }),
  AUTO_LINE_MATERIAL_USAGE: Object.freeze({
    processCode: "AUTO_LINE_MATERIAL_USAGE",
    domain: "auto-line",
    owner: "MES",
    acceptedFacts: Object.freeze(["MATERIAL_USAGE_REPORTED", "MATERIAL_USAGE_CORRECTED"]),
    inventoryAuthority: "WMS",
  }),
});

export function listMesProcesses() {
  return Object.values(PROCESS_DEFINITIONS).map((definition) => ({ ...definition }));
}

export function requireMesProcess(processCode, domain, factType) {
  const process = PROCESS_DEFINITIONS[String(processCode ?? "").toUpperCase()];
  if (!process) return { ok: false, code: "UNKNOWN_MES_PROCESS" };
  if (process.domain !== domain) {
    return { ok: false, code: "MES_PROCESS_DOMAIN_MISMATCH", process: { ...process } };
  }
  if (!process.acceptedFacts.includes(factType)) {
    return { ok: false, code: "FACT_NOT_ACCEPTED_BY_PROCESS", process: { ...process } };
  }
  return { ok: true, code: "MES_PROCESS_ACCEPTED", process: { ...process } };
}

export { PROCESS_DEFINITIONS };
