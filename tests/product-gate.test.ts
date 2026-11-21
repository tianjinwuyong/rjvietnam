import { describe, expect, it } from "vitest";
import { evaluateProductGate } from "../services/api/src/product-gate.js";

describe("Product Gate", () => {
  it("creates Product only through a released first-station registration", () => {
    expect(evaluateProductGate({identifier:"PCB-1",stationCode:"manu_pda",
      firstStationCode:"manu_pda",workOrderReleased:true})).toMatchObject({
        gateState:"ALLOW",registrationRequired:true,reasonCode:"FIRST_REGISTRATION_REQUIRED",
      });
    expect(evaluateProductGate({identifier:"PCB-1",stationCode:"manu_fct",
      firstStationCode:"manu_pda",workOrderReleased:true})).toMatchObject({
        gateState:"REJECT",nextAction:"RETURN_TO_FIRST_STATION",
      });
  });

  it("routes active NG before normal route permission", () => {
    const result=evaluateProductGate({identifier:"PCB-1",stationCode:"manu_fct",
      product:{productId:"P1",lifecycleState:"IN_PRODUCTION"},
      activeNgCase:{ngCaseId:"NG1",destinationStationCode:"manu_rework"},
      expectedStationCode:"manu_fct"});
    expect(result).toMatchObject({gateState:"REPAIR_ROUTE",ngCaseId:"NG1",
      destinationStationCode:"manu_rework"});
  });

  it("rejects to the first missing required station", () => {
    const result=evaluateProductGate({identifier:"PCB-1",stationCode:"manu_agingcab",
      product:{productId:"P1",lifecycleState:"IN_PRODUCTION"},
      missingRequiredStationCodes:["manu_supersonic"]});
    expect(result).toMatchObject({gateState:"REJECT",reasonCode:"MISSING_REQUIRED_STATION",
      destinationStationCode:"manu_supersonic"});
  });

  it("holds when Shell SN is required but not bound", () => {
    const result=evaluateProductGate({identifier:"PCB-1",stationCode:"manu_assem_ate",
      product:{productId:"P1",lifecycleState:"IN_PRODUCTION"},
      expectedStationCode:"manu_assem_ate",missingRequiredIdentityTypes:["SHELL_SN"]});
    expect(result).toMatchObject({gateState:"HOLD",reasonCode:"PRODUCT_IDENTITY_INCOMPLETE"});
  });

  it("allows a valid expected Product and closes terminal Products", () => {
    expect(evaluateProductGate({identifier:"SHELL-1",stationCode:"manu_fct",
      product:{productId:"P1",lifecycleState:"IN_PRODUCTION"},
      expectedStationCode:"manu_fct"}).gateState).toBe("ALLOW");
    expect(evaluateProductGate({identifier:"SHELL-1",stationCode:"manu_fct",
      product:{productId:"P1",lifecycleState:"COMPLETED"}}).gateState).toBe("COMPLETED");
  });
});
