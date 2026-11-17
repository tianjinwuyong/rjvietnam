import { describe, expect, it } from "vitest";
import { evaluateSafeAlertExpression } from "../apps/station-agent/src/alertRuleEngine";

describe("safe station alert expressions",()=>{
  it("supports bounded threshold and boolean rules",()=>{
    expect(evaluateSafeAlertExpression("defect_count > 3",{defect_count:4})).toBe(true);
    expect(evaluateSafeAlertExpression("peak_temp >= 260 && enabled == true",{peak_temp:261,enabled:true})).toBe(true);
    expect(evaluateSafeAlertExpression("result == 'NG' || voltage > 250",{result:"PASS",voltage:260})).toBe(true);
  });

  it("rejects function calls, property construction and executable syntax",()=>{
    for(const expression of ["constructor('return 1')()","a[0] > 1","x > 1; alert(1)","field > otherField"]){
      expect(()=>evaluateSafeAlertExpression(expression,{field:2,x:2,a:[2]})).toThrow();
    }
  });
});
