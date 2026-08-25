import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function validateStationConfiguration(config) {
  const errors = [];
  if (config?.schemaVersion !== "1.0") errors.push("schemaVersion must be 1.0");
  if (!Array.isArray(config?.lines) || config.lines.length === 0) errors.push("at least one line is required");
  if (!Array.isArray(config?.ngPolicies) || config.ngPolicies.length === 0) errors.push("at least one NG policy is required");
  if (config?.ngTracking?.authority !== "MES") errors.push("MES must own NG tracking");
  if (config?.ngTracking?.ackRequiredBeforePhysicalRelease !== true) errors.push("MES acknowledgement is required before physical NG release");
  if (config?.ngTracking?.invariants?.confirmedNgIsImmutable !== true) errors.push("confirmed NG history must be immutable");
  if (config?.ngTracking?.invariants?.everyTransitionRequiresEventId !== true) errors.push("every NG transition requires an event ID");
  if (config?.ngTracking?.invariants?.routeDeviationCreatesAlarm !== true) errors.push("route deviations must create an alarm");

  const policyCodes = new Set();
  for (const policy of config?.ngPolicies ?? []) {
    if (!policy?.code) errors.push("NG policy code is required");
    else if (policyCodes.has(policy.code)) errors.push(`duplicate NG policy ${policy.code}`);
    else policyCodes.add(policy.code);
    if (policy?.mesSupervision?.required !== true) errors.push(`${policy?.code}: MES supervision is required`);
    if (policy?.mesSupervision?.alarmOnDeviation !== true) errors.push(`${policy?.code}: route deviation alarm is required`);
    if (policy?.mesSupervision?.immutableHistory !== true) errors.push(`${policy?.code}: immutable history is required`);
  }

  const globalStationCodes = new Set();
  for (const line of config?.lines ?? []) {
    const stationCodes = new Set();
    let priorSequence = 0;
    for (const station of line.stations ?? []) {
      if (station.sequence <= priorSequence) errors.push(`${line.lineCode}: station sequence must be strictly increasing at ${station.code}`);
      priorSequence = station.sequence;
      if (stationCodes.has(station.code)) errors.push(`${line.lineCode}: duplicate station ${station.code}`);
      stationCodes.add(station.code);
      if (globalStationCodes.has(station.code)) errors.push(`station code must be globally unique: ${station.code}`);
      globalStationCodes.add(station.code);
      if (!policyCodes.has(station.onNg)) errors.push(`${station.code}: unknown NG policy ${station.onNg}`);
    }
    for (const station of line.stations ?? []) {
      if (station.onPass !== null && !stationCodes.has(station.onPass)) {
        errors.push(`${station.code}: onPass references unknown station ${station.onPass}`);
      }
    }
  }

  for (const policy of config?.ngPolicies ?? []) {
    for (const stationCode of policy.appliesTo ?? []) {
      if (!globalStationCodes.has(stationCode)) errors.push(`${policy.code}: appliesTo references unknown station ${stationCode}`);
    }
  }

  const offline = config?.offlineContinuity;
  if (offline?.activation?.onlyWhenMesUnavailable !== true) errors.push("offline continuity must activate only when MES is unavailable");
  if (offline?.recovery?.mesDecisionWins !== true) errors.push("MES must win every offline reconciliation conflict");
  if (offline?.recovery?.freezePeerDecisionsImmediately !== true) errors.push("peer decisions must freeze immediately when MES recovers");
  if (offline?.handoff?.singleUse !== true || offline?.handoff?.signed !== true) errors.push("offline handoff tokens must be signed and single-use");
  if (Number(offline?.limits?.maxOfflineMinutes ?? 0) <= 0) errors.push("offline continuity requires a positive maximum duration");
  const offlineServiceNodes = new Set(["manu_rework"]);
  for (const stationCode of offline?.cell?.orderedStations ?? []) {
    if (!globalStationCodes.has(stationCode) && !offlineServiceNodes.has(stationCode)) errors.push(`offline continuity references unknown station ${stationCode}`);
  }
  const offlineRepair = offline?.offlineRepair;
  if (offlineRepair?.policySource !== "LAST_MES_PUBLISHED_POLICY") errors.push("offline repair must use the last MES-published policy");
  if (offlineRepair?.triggeredByComponentConfiguration !== true) errors.push("offline repair must be triggered by component configuration");
  for (const required of ["MODIFY_REPAIR_ROUTE", "INCREASE_RETEST_LIMIT", "SCRAP_WITHOUT_MES", "FINAL_QUALITY_RELEASE_WITHOUT_MES", "DELETE_NG_HISTORY", "OVERWRITE_NG_HISTORY"]) {
    if (!(offlineRepair?.forbidden ?? []).includes(required)) errors.push(`offline repair must forbid ${required}`);
  }
  if (offlineRepair?.temporaryOrder?.eventIdRequired !== true || offlineRepair?.temporaryOrder?.idempotencyRequired !== true) errors.push("offline temporary repair orders require eventId idempotency");
  if (!(offlineRepair?.onMesRecovery ?? []).includes("MES_DECISION_WINS")) errors.push("MES must win offline repair reconciliation");
  return { valid: errors.length === 0, errors };
}

export function loadStationConfiguration(file = path.join(here, "stations.json")) {
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const validation = validateStationConfiguration(config);
  if (!validation.valid) throw new Error(`Invalid station configuration:\n${validation.errors.join("\n")}`);
  return config;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadStationConfiguration(process.argv[2]);
  console.log(`OK ${config.configuration.revision}: ${config.lines.length} lines, ${config.ngPolicies.length} NG policies`);
}
