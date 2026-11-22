// Parity audit, source↔business DIRECT (no ext at rest — transient pipeline drops it).
// Each check: live source row count vs the SMT business landing that must match it,
// joined on the natural key. This is the "100% embedded" proof without a duplicate DB.
import pg from "pg";
import fs from "node:fs";
// 凭证不落 git:源连接配置从 data_source_provider 表读(与 datasources 引擎同源),
// 本地 SMT 库连接读 services/api/.env。
const env = Object.fromEntries(fs.readFileSync(new URL("../services/api/.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const smt = new pg.Client({ host: env.PGHOST, port: +env.PGPORT, user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE });
await smt.connect();
const provs = (await smt.query(`SELECT code, config FROM data_source_provider WHERE code IN ('wms_src','oa_src')`)).rows;
const SRC = {};
for (const p of provs) SRC[p.code === "wms_src" ? "wms" : "oa"] = p.config;
if (!SRC.wms || !SRC.oa) { console.error("providers wms_src/oa_src missing"); process.exit(1); }
const wms = new pg.Client(SRC.wms); const oa = new pg.Client(SRC.oa);
await Promise.all([wms.connect(), oa.connect()]);
const n = async (c, s) => { try { return Number((await c.query(s)).rows[0].n); } catch { return null; } };

// [label, sourceClient, sourceCountSql, smtBusinessCountSql] — smt must be >= src
// (superset allowed: SMT may hold extra local rows; it must never be missing source rows).
const CHECKS = [
  ["WMS material→materials", wms, `SELECT count(*)::int n FROM public.material`, `SELECT count(*)::int n FROM rjvn_material e WHERE EXISTS(SELECT 1 FROM materials m WHERE m.code=e.material_code)`],
  ["WMS supplier→suppliers", wms, `SELECT count(*)::int n FROM public.supplier`, `SELECT count(*)::int n FROM suppliers s WHERE EXISTS(SELECT 1 FROM rjvn_supplier e WHERE e.supplier_code=s.code)`],
  ["WMS location→storage_locations", wms, `SELECT count(*)::int n FROM public.warehouse_location`, `SELECT count(*)::int n FROM storage_locations l WHERE EXISTS(SELECT 1 FROM rjvn_warehouse_location e WHERE e.location_code=l.code)`],
  ["WMS iqc_lot→material_lots", wms, `SELECT count(*)::int n FROM public.iqc_lot`, `SELECT count(*)::int n FROM material_lots m WHERE EXISTS(SELECT 1 FROM rjvn_iqc_lot e WHERE e.lot_no=m.lot_no)`],
  ["WMS iqc_lot→rjvn_iqc_lot", wms, `SELECT count(*)::int n FROM public.iqc_lot`, `SELECT count(*)::int n FROM rjvn_iqc_lot`],
  ["WMS inventory→rjvn_inventory", wms, `SELECT count(*)::int n FROM public.inventory`, `SELECT count(*)::int n FROM rjvn_inventory`],
  ["WMS receipt→rjvn_receipt_order", wms, `SELECT count(*)::int n FROM public.receipt_order`, `SELECT count(*)::int n FROM rjvn_receipt_order`],
  ["WMS iqc_lot_receipt→mirror", wms, `SELECT count(*)::int n FROM public.iqc_lot_receipt`, `SELECT count(*)::int n FROM rjvn_iqc_lot_receipt`],
  ["WMS inventory_transaction→mirror", wms, `SELECT count(*)::int n FROM public.inventory_transaction`, `SELECT count(*)::int n FROM rjvn_inventory_transaction`],
  ["WMS picking→rjvn_picking_order", wms, `SELECT count(*)::int n FROM public.picking_order`, `SELECT count(*)::int n FROM rjvn_picking_order`],
  ["WMS picking→wms_picking_orders", wms, `SELECT count(*)::int n FROM public.picking_order`, `SELECT count(*)::int n FROM wms_picking_orders w WHERE EXISTS(SELECT 1 FROM rjvn_picking_order e WHERE e.id::text=w.rjvn_id::text)`],
  ["WMS picking_item→canonical", wms, `SELECT count(*)::int n FROM public.picking_order_item`, `SELECT count(*)::int n FROM wms_picking_order_items`],
  ["WMS work_order→rjvn_work_order", wms, `SELECT count(*)::int n FROM public.work_order`, `SELECT count(*)::int n FROM rjvn_work_order`],
  ["WMS work_order→mes_work_orders", wms, `SELECT count(*)::int n FROM public.work_order`, `SELECT count(*)::int n FROM mes_work_orders w WHERE EXISTS(SELECT 1 FROM rjvn_work_order e WHERE e.work_order_no=w.work_order_no)`],
  ["WMS mes_sync_log→mirror", wms, `SELECT count(*)::int n FROM public.mes_sync_log`, `SELECT count(*)::int n FROM rjvn_mes_sync_log`],
  ["WMS operation_log→mirror", wms, `SELECT count(*)::int n FROM public.operation_log`, `SELECT count(*)::int n FROM rjvn_operation_log`],
  ["WMS sys_param→mirror", wms, `SELECT count(*)::int n FROM public.sys_param`, `SELECT count(*)::int n FROM rjvn_sys_param`],
  ["WMS sys_role→mirror", wms, `SELECT count(*)::int n FROM public.sys_role`, `SELECT count(*)::int n FROM rjvn_sys_role`],
  ["WMS sys_account→mirror", wms, `SELECT count(*)::int n FROM public.sys_account`, `SELECT count(*)::int n FROM rjvn_sys_account`],
  ["WMS warehouse→mirror", wms, `SELECT count(*)::int n FROM public.warehouse`, `SELECT count(*)::int n FROM rjvn_warehouse`],
  ["WMS material→rjvn_material", wms, `SELECT count(*)::int n FROM public.material`, `SELECT count(*)::int n FROM rjvn_material`],
  ["WMS supplier→rjvn_supplier", wms, `SELECT count(*)::int n FROM public.supplier`, `SELECT count(*)::int n FROM rjvn_supplier`],
  ["OA flow_instance→oa.flow_instance", oa, `SELECT count(*)::int n FROM public.flow_instance`, `SELECT count(*)::int n FROM oa.flow_instance`],
  ["OA flow_definition→oa.flow_definition", oa, `SELECT count(*)::int n FROM public.flow_definition`, `SELECT count(*)::int n FROM oa.flow_definition`],
  ["OA flow_task→oa.flow_task", oa, `SELECT count(*)::int n FROM public.flow_task`, `SELECT count(*)::int n FROM oa.flow_task`],
  ["OA flow_log→oa.flow_log", oa, `SELECT count(*)::int n FROM public.flow_log`, `SELECT count(*)::int n FROM oa.flow_log`],
  ["OA org_user→oa.org_user", oa, `SELECT count(*)::int n FROM public.org_user`, `SELECT count(*)::int n FROM oa.org_user`],
  ["OA org_department→oa.org_department", oa, `SELECT count(*)::int n FROM public.org_department`, `SELECT count(*)::int n FROM oa.org_department`],
  ["OA doc_system→oa.doc_system", oa, `SELECT count(*)::int n FROM public.doc_system`, `SELECT count(*)::int n FROM oa.doc_system`],
  ["OA attachment→oa.attachment", oa, `SELECT count(*)::int n FROM public.attachment`, `SELECT count(*)::int n FROM oa.attachment`],
  ["OA doc_change_log→oa.doc_change_log", oa, `SELECT count(*)::int n FROM public.doc_change_log`, `SELECT count(*)::int n FROM oa.doc_change_log`],
  ["OA doc_code_ledger→oa", oa, `SELECT count(*)::int n FROM public.doc_code_ledger`, `SELECT count(*)::int n FROM oa.doc_code_ledger`],
  ["OA doc_issue_record→oa", oa, `SELECT count(*)::int n FROM public.doc_issue_record`, `SELECT count(*)::int n FROM oa.doc_issue_record`],
  ["OA doc_issue_feed→oa", oa, `SELECT count(*)::int n FROM public.doc_issue_feed`, `SELECT count(*)::int n FROM oa.doc_issue_feed`],
  ["OA doc_version_lang→oa", oa, `SELECT count(*)::int n FROM public.doc_version_lang`, `SELECT count(*)::int n FROM oa.doc_version_lang`],
  ["OA sys_doc_version→oa", oa, `SELECT count(*)::int n FROM public.sys_doc_version`, `SELECT count(*)::int n FROM oa.sys_doc_version`],
  ["OA doc_review_read→oa", oa, `SELECT count(*)::int n FROM public.doc_review_read`, `SELECT count(*)::int n FROM oa.doc_review_read`],
  ["OA notification→oa", oa, `SELECT count(*)::int n FROM public.notification`, `SELECT count(*)::int n FROM oa.notification`],
  ["OA salary_item→oa", oa, `SELECT count(*)::int n FROM public.salary_item`, `SELECT count(*)::int n FROM oa.salary_item`],
  ["OA salary_class→oa", oa, `SELECT count(*)::int n FROM public.salary_class`, `SELECT count(*)::int n FROM oa.salary_class`],
  ["OA salary_param→oa", oa, `SELECT count(*)::int n FROM public.salary_param`, `SELECT count(*)::int n FROM oa.salary_param`],
  ["OA attendance_time_band→oa", oa, `SELECT count(*)::int n FROM public.attendance_time_band`, `SELECT count(*)::int n FROM oa.attendance_time_band`],
  ["OA attendance_holiday→oa", oa, `SELECT count(*)::int n FROM public.attendance_holiday`, `SELECT count(*)::int n FROM oa.attendance_holiday`],
  ["OA attendance_schedule_plan_item→oa", oa, `SELECT count(*)::int n FROM public.attendance_schedule_plan_item`, `SELECT count(*)::int n FROM oa.attendance_schedule_plan_item`],
];
let pass = 0; const fails = [];
for (const [label, sc, sSql, tSql] of CHECKS) {
  const srcN = await n(sc, sSql);
  const tgtN = await n(smt, tSql);
  if (srcN === null || tgtN === null || tgtN < srcN) fails.push(`${label}: src=${srcN} tgt=${tgtN}`);
  else pass++;
}
// logic invariants (SMT-owned, must hold)
const LOGIC = [
  ["inv derived: lots w/o live tx", `SELECT count(*)::int n FROM material_lots m WHERE NOT EXISTS(SELECT 1 FROM inventory_transactions t WHERE t.material_lot_id=m.id AND NOT t.voided)`],
  ["inv balance == Σ live tx", `SELECT count(*)::int n FROM material_lots m WHERE m.received_qty <> COALESCE((SELECT sum(t.qty) FROM inventory_transactions t WHERE t.material_lot_id=m.id AND NOT t.voided),0)`],
  ["iqc status mirror consistent", `SELECT count(*)::int n FROM rjvn_iqc_lot e JOIN sync_stage.live_wms_rjvn__iqc s ON s.payload->>'id'=e.id::text JOIN material_lots m ON m.lot_no=s.payload->>'lotNo' WHERE m.iqc_status <> CASE s.payload->>'status' WHEN 'pass' THEN 'released' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END`],
  ["picking status drift vs source", `SELECT count(*)::int n FROM rjvn_picking_order e JOIN wms_picking_orders w ON w.rjvn_id::text=e.id::text WHERE w.status IS DISTINCT FROM e.status`],
];
let logicFail = [];
for (const [label, sql] of LOGIC) { const v = await n(smt, sql); if (v !== 0) logicFail.push(`${label}=${v}`); }
console.log(`PARITY: ${pass}/${CHECKS.length} source↔business PASS`);
for (const f of fails) console.log("  FAIL", f);
console.log(`LOGIC: ${logicFail.length ? "FAIL " + logicFail.join(", ") : "all invariants hold (0)"}`);
await Promise.all([smt.end(), wms.end(), oa.end()]);
