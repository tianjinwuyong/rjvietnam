import { describe, expect, it } from "vitest";
import { loadStationConfiguration, validateStationConfiguration } from "../packages/station-config/validate-stations.mjs";

describe("canonical station routing configuration", () => {
  it("loads the Excel-derived manual and automatic routes", () => {
    const config = loadStationConfiguration();
    expect(config.lines.map((line: { domain: string }) => line.domain)).toEqual(["MANUAL_LINE", "AUTO_LINE"]);
    expect(config.ngPolicies).toHaveLength(10);
  });

  it("ends both production routes at MES-controlled final inspection", () => {
    const config = loadStationConfiguration();
    for (const line of config.lines) {
      const finalStation = line.stations.at(-1);
      expect(finalStation.capability).toBe("FINAL_INSPECTION");
      expect(finalStation.onPass).toBeNull();
      expect(finalStation.rules.warehouseBlockedUntilRelease).toBe(true);
    }
  });

  it("rejects a route that jumps to an unknown station", () => {
    const config = structuredClone(loadStationConfiguration());
    config.lines[0].stations[0].onPass = "MISSING_STATION";
    const result = validateStationConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("unknown station MISSING_STATION");
  });

  it("requires MES supervision and immutable NG history", () => {
    const config = structuredClone(loadStationConfiguration());
    config.ngPolicies[0].mesSupervision.immutableHistory = false;
    const result = validateStationConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("immutable history is required");
  });

  it("requires MES acknowledgement for every physical NG movement", () => {
    const config = structuredClone(loadStationConfiguration());
    config.ngTracking.ackRequiredBeforePhysicalRelease = false;
    const result = validateStationConfiguration(config);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("MES acknowledgement is required");
  });
});
