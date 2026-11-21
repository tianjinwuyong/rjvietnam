import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const apiBase = process.env.WMS_API_BASE;
const live = process.env.RUN_WMS_M4_LIVE === "1" && Boolean(apiBase);
const { Pool } = pg;

describe.skipIf(!live)("M4 inbound -> IQC -> put-away live acceptance", () => {
  it("keeps the lot, ledger and final location exactly reconciled", async () => {
    const pool = new Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "smt_factory" });
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const lotNo = `QA-M4-${suffix}`;
    const holdLotNo = `QA-M4-H-${suffix}`;
    const rejectLotNo = `QA-M4-R-${suffix}`;
    const lotIds: number[] = [];
    let planId: number | undefined;
    let supplierId: number | undefined;
    let inboundOrderId: number | undefined;
    try {
      const loginResponse = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "Factory@123" }),
      });
      expect(loginResponse.ok).toBe(true);
      const login = await loginResponse.json() as any;
      const headers = { authorization: `Bearer ${login.data.token}`, "content-type": "application/json" };

      const material = (await pool.query(`SELECT m.id,m.code FROM materials m
        JOIN bom_lines bl ON bl.material_id=m.id JOIN boms b ON b.id=bl.bom_id
        WHERE b.id=45 ORDER BY m.id LIMIT 1`)).rows[0];
      const target = (await pool.query(`SELECT sl.id,sl.code FROM storage_locations sl
        JOIN wms_warehouses w ON w.id=sl.warehouse_id
        WHERE w.warehouse_type='RAW_MATERIAL' AND w.status='ACTIVE'
          AND sl.status='active' AND sl.locked_reason IS NULL AND COALESCE(sl.area,'')<>'IQC'
        ORDER BY sl.id LIMIT 1`)).rows[0];
      expect(material).toBeTruthy();
      expect(target).toBeTruthy();
      await pool.query("UPDATE materials SET iqc_required=true WHERE id=$1", [material.id]);
      supplierId = Number((await pool.query(`INSERT INTO suppliers(code,name_zh,name_en,name_vi,status)
        VALUES($1,'M4\u9a8c\u6536\u4f9b\u5e94\u5546','M4 acceptance supplier','Nha cung cap nghiem thu M4','active') RETURNING id`, [`QA-M4-${suffix}`])).rows[0].id);
      await pool.query(`INSERT INTO wms_supplier_materials(supplier_id,material_id,approved,status,effective_from)
        VALUES($1,$2,true,'ACTIVE',CURRENT_DATE)`, [supplierId, material.id]);

      const inboundOrderNo = `IN-QA-M4-${suffix}`;
      inboundOrderId = Number((await pool.query(`INSERT INTO inbound_orders
        (doc_no,status,supplier_id,supplier_code,supplier_name,created_by,approved_by,approved_at)
        VALUES($1,'APPROVED',$2,$3,'M4 acceptance supplier',10,10,now()) RETURNING id`,
        [inboundOrderNo, supplierId, `QA-M4-${suffix}`])).rows[0].id);
      await pool.query(`INSERT INTO inbound_order_lines
        (inbound_order_id,material_id,material_code,requested_qty,approved_qqty,executed_qty,line_status)
        VALUES($1,$2,$3,30,30,0,'APPROVED')`, [inboundOrderId, material.id, material.code]);

      const createPlan = await fetch(`${apiBase}/wms/iqc/plans`, {
        method: "POST", headers,
        body: JSON.stringify({ payload: { planCode: `QA-M4-${suffix}`, materialId: material.id, revision: "A",
          characteristics: [{ characteristicCode: "VISUAL", name_zh: "外观", name_en: "Visual", name_vi: "Ngoai quan", dataType: "BOOLEAN", required: true }] } }),
      });
      expect(createPlan.status).toBe(201);
      planId = Number(((await createPlan.json()) as any).data.item.id);
      const approve = await fetch(`${apiBase}/wms/iqc/plans/${planId}/decision`, { method: "POST", headers, body: JSON.stringify({ decision: "APPROVE" }) });
      expect(approve.ok).toBe(true);

      const unreferenced = await fetch(`${apiBase}/api/receiving`, { method: "POST", headers,
        body: JSON.stringify({ lot_no: `QA-M4-U-${suffix}`, material_code: material.code, supplier_code: `QA-M4-${suffix}`, received_qty: 10 }) });
      expect(unreferenced.status).toBe(400);

      const receive = await fetch(`${apiBase}/api/receiving`, { method: "POST", headers,
        body: JSON.stringify({ lot_no: lotNo, inbound_order_no: inboundOrderNo, material_code: material.code, supplier_code: `QA-M4-${suffix}`, received_qty: 10, receiving_notes: "M4 controlled acceptance" }) });
      expect(receive.status, await receive.clone().text()).toBe(200);
      const received = await receive.json() as any;
      const lotId = Number(received.data.id);
      lotIds.push(lotId);
      expect(received.data.iqc_status).toBe("pending");
      expect(received.data.label_code).toBe(`MATLOT-${lotNo}`);
      expect(received.data.inbound_order_id).toBe(inboundOrderId);

      const prematurePutAway = await fetch(`${apiBase}/wms/put-away`, { method: "POST", headers,
        body: JSON.stringify({ lotNo, toLocation: target.code, qty: 10, operator: "admin" }) });
      expect(prematurePutAway.status).toBe(400);

      const duplicateReceipt = await fetch(`${apiBase}/api/receiving`, { method: "POST", headers,
        body: JSON.stringify({ lot_no: lotNo, inbound_order_no: inboundOrderNo, material_code: material.code, supplier_code: `QA-M4-${suffix}`, received_qty: 10 }) });
      expect(duplicateReceipt.status).toBe(409);

      const resolvedPlan = await fetch(`${apiBase}/wms/iqc/plan-for-lot/${lotId}`, { headers });
      expect(resolvedPlan.ok).toBe(true);
      const plan = (await resolvedPlan.json() as any).data.item;
      expect(Number(plan.id)).toBe(planId);
      expect(plan.characteristics).toHaveLength(1);

      const inspect = await fetch(`${apiBase}/wms/iqc/inspections`, { method: "POST", headers,
        body: JSON.stringify({ payload: { materialLotId: lotId, planId, decision: "PASS", sampleSize: 1, operator: "admin",
          results: [{ characteristicId: plan.characteristics[0].id, measuredValue: "OK", result: "PASS" }] } }) });
      expect(inspect.status, await inspect.clone().text()).toBe(201);

      const putAway = await fetch(`${apiBase}/wms/put-away`, { method: "POST", headers,
        body: JSON.stringify({ lotNo, toLocation: target.code, qty: 10, operator: "admin" }) });
      expect(putAway.status, await putAway.clone().text()).toBe(201);

      const finalLot = (await pool.query("SELECT received_qty,iqc_status,storage_location_id FROM material_lots WHERE id=$1", [lotId])).rows[0];
      const ledger = (await pool.query("SELECT action,qty FROM inventory_transactions WHERE material_lot_id=$1 ORDER BY id", [lotId])).rows;
      const labels = (await pool.query("SELECT label_code FROM wms_labels WHERE entity_type='MATERIAL_LOT' AND entity_id=$1", [String(lotId)])).rows;
      expect(Number(finalLot.received_qty)).toBe(10);
      expect(finalLot.iqc_status).toBe("released");
      expect(Number(finalLot.storage_location_id)).toBe(Number(target.id));
      expect(ledger.map((row) => row.action)).toEqual(["RECEIVE", "IQC_RELEASE", "PUT_AWAY"]);
      expect(ledger.every((row) => Number(row.qty) === 10)).toBe(true);
      expect(labels.map((row) => row.label_code)).toEqual([`MATLOT-${lotNo}`]);

      for (const scenario of [
        { lotNo: holdLotNo, decision: "HOLD", expected: "hold", action: "IQC_HOLD" },
        { lotNo: rejectLotNo, decision: "FAIL", expected: "rejected", action: "IQC_REJECT" },
      ]) {
        const receiptResponse = await fetch(`${apiBase}/api/receiving`, { method: "POST", headers,
          body: JSON.stringify({ lot_no: scenario.lotNo, inbound_order_no: inboundOrderNo, material_code: material.code,
            supplier_code: `QA-M4-${suffix}`, received_qty: 10 }) });
        expect(receiptResponse.status, await receiptResponse.clone().text()).toBe(200);
        const scenarioLotId = Number(((await receiptResponse.json()) as any).data.id);
        lotIds.push(scenarioLotId);
        const inspectionResponse = await fetch(`${apiBase}/wms/iqc/inspections`, { method: "POST", headers,
          body: JSON.stringify({ payload: { materialLotId: scenarioLotId, planId, decision: scenario.decision, sampleSize: 1,
            operator: "admin", results: [{ characteristicId: plan.characteristics[0].id, measuredValue: "NG", result: "FAIL" }] } }) });
        expect(inspectionResponse.status, await inspectionResponse.clone().text()).toBe(201);
        const blockedPutAway = await fetch(`${apiBase}/wms/put-away`, { method: "POST", headers,
          body: JSON.stringify({ lotNo: scenario.lotNo, toLocation: target.code, qty: 10, operator: "admin" }) });
        expect(blockedPutAway.status).toBe(400);
        const state = (await pool.query("SELECT iqc_status FROM material_lots WHERE id=$1", [scenarioLotId])).rows[0];
        const actions = (await pool.query("SELECT action FROM inventory_transactions WHERE material_lot_id=$1 ORDER BY id", [scenarioLotId])).rows.map((row) => row.action);
        expect(state.iqc_status).toBe(scenario.expected);
        expect(actions).toEqual(["RECEIVE", scenario.action]);
        expect(actions).not.toContain("PUT_AWAY");
      }

      const inboundState = (await pool.query(`SELECT io.status,iol.executed_qty
        FROM inbound_orders io JOIN inbound_order_lines iol ON iol.inbound_order_id=io.id WHERE io.id=$1`, [inboundOrderId])).rows[0];
      expect(inboundState.status).toBe("COMPLETED");
      expect(Number(inboundState.executed_qty)).toBe(30);
    } finally {
      for (const lotId of lotIds) {
        await pool.query("DELETE FROM wms_labels WHERE entity_type='MATERIAL_LOT' AND entity_id=$1", [String(lotId)]);
        await pool.query("DELETE FROM wms_lot_status_history WHERE material_lot_id=$1", [lotId]);
        await pool.query("DELETE FROM wms_inspection_results WHERE inspection_id IN (SELECT id FROM iqc_inspections WHERE material_lot_id=$1)", [lotId]);
        await pool.query("DELETE FROM inventory_transactions WHERE material_lot_id=$1", [lotId]);
        await pool.query("DELETE FROM iqc_inspections WHERE material_lot_id=$1", [lotId]);
        await pool.query("DELETE FROM material_lots WHERE id=$1", [lotId]);
      }
      if (planId) {
        await pool.query("DELETE FROM wms_inspection_characteristics WHERE inspection_plan_id=$1", [planId]);
        await pool.query("DELETE FROM wms_inspection_plans WHERE id=$1", [planId]);
      }
      if (supplierId) {
        if (inboundOrderId) await pool.query("DELETE FROM inbound_orders WHERE id=$1", [inboundOrderId]);
        await pool.query("DELETE FROM wms_supplier_materials WHERE supplier_id=$1", [supplierId]);
        await pool.query("DELETE FROM suppliers WHERE id=$1", [supplierId]);
      }
      await pool.end();
    }
  });
});
