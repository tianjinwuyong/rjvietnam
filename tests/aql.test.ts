import { describe, expect, it } from "vitest";
import { codeFor, plan, plansFor, verdict } from "../services/api/src/aql.js";
import { CODE_ORDER, PLANS } from "../services/api/src/aql-plans.js";

describe("AQL code letter (Z1.4 general level)", () => {
  it("maps lot quantity to the standard code at level II", () => {
    expect(codeFor(500).code).toBe("H");
    expect(codeFor(100).code).toBe("F");
    expect(codeFor(1).code).toBe("A");
    expect(codeFor(1_000_000).code).toBe("Q");
  });

  it("shifts one letter per inspection level", () => {
    expect(codeFor(500, "I").code).toBe("G");
    expect(codeFor(500, "III").code).toBe("J");
    // A at level I clamps instead of going negative
    expect(codeFor(1, "I").code).toBe("A");
    // Q at level III clamps at the last letter
    expect(codeFor(1_000_000, "III").code).toBe("R");
  });

  it("refuses unknown lots and levels", () => {
    expect(codeFor(0).code).toBeNull();
    expect(codeFor(-5).code).toBeNull();
    expect(codeFor(500, "S-4").code).toBeNull();
  });
});

describe("AQL plan", () => {
  it("reads Ac/Re straight out of the table", () => {
    // lot 500 -> H, n=50, AQL 2.5 -> Ac 3 / Re 4
    expect(plan(500, 2.5)).toMatchObject({ ok: true, code: "H", lotCode: "H", n: 50, ac: 3, re: 4 });
  });

  it("jumps to a neighbouring code letter when the AQL has no row", () => {
    // lot 100 -> F, but F has no 1.0 column; the standard moves to H (n=50, Ac=1)
    const result = plan(100, 1.0);
    expect(result).toMatchObject({ ok: true, code: "H", lotCode: "F", n: 50, ac: 1 });
    expect(result.note).toContain("H");
  });

  it("switches tables by severity", () => {
    expect(plan(500, 2.5, "II", "tightened")).toMatchObject({ code: "H", ac: 2, re: 3 });
    expect(plan(500, 2.5, "II", "reduced")).toMatchObject({ code: "H", ac: 1, re: 4 });
  });

  it("rejects unusable input instead of guessing", () => {
    expect(plan(0, 2.5).ok).toBe(false);
    expect(plan(500, 0).ok).toBe(false);
    expect(plan(500, "abc").ok).toBe(false);
    expect(plan(500, 9999).ok).toBe(false);
  });
});

describe("AQL plan for CR / MA / MI", () => {
  it("takes the larger sample and pins CR at Ac=0", () => {
    const p = plansFor(500, 1.0, 2.5);
    expect(p).toMatchObject({ ok: true, n: 50, level: "II", cr: { ac: 0, re: 1 } });
    expect(p.ma).toMatchObject({ ac: 1, n: 50 });
    expect(p.mi).toMatchObject({ ac: 3, n: 50 });
  });

  it("propagates the first invalid class", () => {
    expect(plansFor(0, 1.0, 2.5).ok).toBe(false);
    expect(plansFor(500, 1.0, 0).ok).toBe(false);
  });
});

describe("AQL verdict", () => {
  const p = plansFor(500, 1.0, 2.5);

  it("accepts a lot at the acceptance numbers", () => {
    expect(verdict({ cr: 0, ma: 1, mi: 3 }, p)).toMatchObject({ ok: true, accepted: true });
  });

  it("rejects on any critical defect", () => {
    const v = verdict({ cr: 1, ma: 0, mi: 0 }, p);
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toContain("致命缺陷");
  });

  it("rejects when major or minor exceed Ac", () => {
    expect(verdict({ ma: 2 }, p).ok).toBe(false);
    expect(verdict({ mi: 4 }, p).ok).toBe(false);
  });

  it("refuses to judge without a valid plan", () => {
    const v = verdict({ cr: 0 }, { ok: false, note: "批量必须大于 0" });
    expect(v).toMatchObject({ ok: null, accepted: null });
    expect(v.reasons[0]).toContain("批量必须大于 0");
  });
});

describe("AQL table integrity", () => {
  it("has all 16 code letters in every severity", () => {
    for (const [name, table] of Object.entries(PLANS)) {
      expect(Object.keys(table).sort(), name).toEqual([...CODE_ORDER].sort());
    }
  });

  it("keeps Re = Ac + 1 in normal and tightened tables", () => {
    for (const name of ["normal", "tightened"]) {
      for (const [code, rows] of Object.entries(PLANS[name])) {
        for (const [aql, [ac, re]] of Object.entries(rows)) {
          expect(re, `${name}/${code}/${aql}`).toBe(ac + 1);
        }
      }
    }
  });

  it("allows the wider Ac/Re gaps that reduced inspection really has", () => {
    // 放宽检验不是相邻判定数：B/15 是 Ac 0 / Re 2。别把这条"修"成 Ac+1。
    expect(PLANS.reduced.B[15]).toEqual([0, 2]);
  });
});
