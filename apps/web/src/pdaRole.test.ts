import { describe, expect, it } from "vitest";
import { resolvePdaRole } from "./pdaRole";

describe("resolvePdaRole", () => {
  it("maps factory management accounts to plant manager", () => {
    expect(resolvePdaRole({ username: "MENG_YING", roleKey: "TEAM_LEADER" })).toBe("PLANT_MANAGER");
    expect(resolvePdaRole({ username: "MGT_CN_01", roleKey: "management" })).toBe("PLANT_MANAGER");
  });
  it("keeps line manager and group leader scopes separate", () => {
    expect(resolvePdaRole({ username: "LM01", roleKey: "LINE_MANAGER" })).toBe("LINE_MANAGER");
    expect(resolvePdaRole({ username: "GL01", roleKey: "TEAM_LEADER" })).toBe("GROUP_LEADER");
  });
});
