import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = readFileSync(new URL("../services/api/server.js", import.meta.url), "utf8");
const wmsLocation = readFileSync(new URL("../apps/web/src/wms/WmsLocationManagement.tsx", import.meta.url), "utf8");
const receivingCommunication = readFileSync(new URL("../apps/web/src/wms/WmsReceivingEmployeeCommunication.tsx", import.meta.url), "utf8");
const web3d = readFileSync(new URL("../apps/web/src/mes/WarehouseScene3d.tsx", import.meta.url), "utf8");

describe("PDA and 3D WMS security contract", () => {
  it("purges explicit test areas but soft-disables production areas", () => {
    expect(server).toContain("SELECT area_code,status FROM wms_floor_storage_areas WHERE area_code=upper($1)");
    expect(server).toContain("/^TEST([-_]|\\d|$)/i.test(area.area_code) || /[-_]TEST([-_]|$)/i.test(area.area_code)");
    expect(server).toContain("DELETE FROM wms_floor_storage_areas WHERE area_code=upper($1)");
    expect(server).toContain("UPDATE wms_floor_storage_areas SET status='DISABLED'");
  });

  it("requires authentication and WMS view permission for the control state", () => {
    expect(server).not.toContain('req.path === "/3d/wms-control-state"');
    expect(server).toContain('app.get("/api/3d/wms-control-state", requirePermission("wms.view")');
  });

  it("enforces accepted ownership and scan proof on the server", () => {
    expect(server).toContain('task.status!=="ACCEPTED"');
    expect(server).toContain("task.accepted_by!==actor");
    expect(server).toContain('String(p.scanEventId??"").trim()');
    expect(server).toContain("scanValue!==expectedLabel");
    expect(server).toContain("targetScanValue!==expectedTarget");
  });

  it("keeps the WMS location client on the authenticated control-state route and prevents management UI completion", () => {
    expect(wmsLocation).toContain('"/api/3d/wms-control-state"');
    expect(web3d).not.toContain('void runTask("TASK_COMPLETE"');
    expect(web3d).not.toContain('void runTask("TASK_ACCEPT"');
  });

  it("opens and focuses the location property editor from the location table", () => {
    // 源码 JSX 属性可能被格式化工具折行，这里按空白归一化后再匹配
    const flat = wmsLocation.replace(/\s+/g, " ");
    expect(flat).toContain("locationEditorRef.current?.scrollIntoView");
    expect(flat).toContain('type="button" className="btn btn-secondary" title={`编辑库位 ${loc.code} 的属性`}');
    expect(flat).toContain("event.stopPropagation(); openEdit(loc)");
  });

  it("uses the shared API base for receiving employee HTTP and SSE communication", () => {
    expect(receivingCommunication).toContain('import { API_BASE } from "../api/client"');
    expect(receivingCommunication).toContain('`${API_BASE}/api/factory`');
    expect(receivingCommunication).toContain('`${API_BASE}/api/pda/events?');
    expect(receivingCommunication).not.toContain("127.0.0.1:8081");
  });
});
