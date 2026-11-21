// Probes for the 30 in-post roles that previously skipped NO_PROBE.
// Every SQL here was executed against the real smt_factory schema before
// being added (read-only SELECT, row_key alias, $1 limit). Reminder-type
// probes carry gate: null: they draft a VE task, never a business write.
// Keep the verified SQL verbatim; a schema change must be re-verified.
export const EXTRA_PROBES = Object.freeze({
  "WMS-SUPERVISOR-VIRTUAL-01": {
    taskType: "OVERDUE_ESCALATE",
    sql: `SELECT id AS row_key, receipt_no, material_code, status, created_at FROM wms_receipt_orders WHERE status = 'iqc_pass' ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `IQC 已放行待复核：${r.receipt_no || r.row_key}`,
  },
  "WMS-IQC-HANDOFF-VIRTUAL-01": {
    taskType: "HANDOFF_RECEIPT",
    sql: `SELECT id AS row_key, lot_no, inspection_no, status, claimed_at FROM oa.iqc_lot_mirror WHERE status = 'pending' AND wms_status = 'pending' AND record_id IS NULL ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `来料待交接：${r.lot_no || r.row_key}`,
  },
  "WMS-COUNT-VIRTUAL-01": {
    taskType: "COUNT_SHEET",
    sql: `SELECT id AS row_key, session_code, lot_no, material_code, variance, timeout_hours FROM count_sessions WHERE completed_at IS NULL AND variance IS NOT NULL ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `盘点差异待处理：${r.session_code || r.row_key}`,
  },
  "WMS-ISSUE-VIRTUAL-01": {
    taskType: "KIT_PICK",
    sql: `SELECT id AS row_key, picking_id, material_code, pick_qty, actual_qty, received_qty FROM wms_picking_order_items WHERE actual_qty < pick_qty ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `发料欠数待补：${r.material_code || r.row_key}`,
  },
  "MSD-CONTROL-VIRTUAL-01": {
    taskType: "BAKING_ALERT",
    sql: `SELECT id AS row_key, code, msd_level, msl_level, shelf_life_days, storage_condition FROM materials WHERE msd_level IS NOT NULL ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `湿敏物料待管控：${r.code || r.row_key}`,
  },
  "PMC-VIRTUAL-01": {
    taskType: "DELIVERY_RISK",
    sql: `SELECT id AS row_key, plan_no, product_id, planned_qty, status, planned_finish_at FROM pmc_master_plans WHERE status IN ('draft','pending','approved') ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `计划待推进：${r.plan_no || r.row_key}`,
  },
  "PURCHASING-VIRTUAL-01": {
    taskType: "PO_MONITOR",
    sql: `SELECT id AS row_key, po_no, supplier_id, status, promised_date FROM purchase_order_headers WHERE sent_at IS NOT NULL AND acknowledged_at IS NULL ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `PO 待供应商确认：${r.po_no || r.row_key}`,
  },
  "MES-VIRTUAL-01": {
    taskType: "WORK_ORDER_MONITOR",
    sql: `SELECT id AS row_key, code, product_id, planned_qty, completed_qty, status, due_date FROM work_orders WHERE status NOT IN ('closed','completed','void') ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `工单待闭环：${r.code || r.row_key}`,
  },
  "QUALITY-VIRTUAL-01": {
    taskType: "MRB_CONVENE",
    sql: `SELECT id AS row_key, mrb_id, disposition_type, exec_status, hold_until FROM mrb_disposition WHERE exec_status NOT IN ('executed','done','completed') ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `MRB 处置待执行：${r.mrb_id || r.row_key}`,
  },
  "SMT-LOOP-VIRTUAL-01": {
    taskType: "FEEDER_LOADING",
    sql: `SELECT id AS row_key, feeder_code, location_code, next_calibration_at, status FROM feeders WHERE next_calibration_at IS NOT NULL AND next_calibration_at < now() ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `料站校准到期：${r.feeder_code || r.row_key}`,
  },
  "ANDON-VIRTUAL-01": {
    taskType: "ESCALATION_TIMER",
    sql: `SELECT id AS row_key, alert_type, severity, message, acknowledged FROM parts_wear_alerts WHERE acknowledged = false AND resolved_at IS NULL ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `安灯告警待响应：${r.alert_type || r.row_key}`,
  },
  "PACK-VIRTUAL-01": {
    taskType: "PACK_LIST_VALIDATE",
    sql: `SELECT id AS row_key, box_sn, work_order_id, product_count, label_printed FROM packaging_records_2026 WHERE label_printed = false ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `包装标签待补打：${r.box_sn || r.row_key}`,
  },
  "E-INVOICE-VIRTUAL-01": {
    taskType: "TAX_CODE_CHECK",
    sql: `SELECT id AS row_key, code, tax_type, rate, status FROM tax_codes WHERE status IS DISTINCT FROM 'active' ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `税率配置待复核：${r.code || r.row_key}`,
  },
  "OQC-VIRTUAL-01": {
    taskType: "SHIPMENT_SAMPLE",
    sql: `SELECT id AS row_key, pcb_serial_id, work_order_id, inspection_type, result FROM oqc_inspection_records_2026 WHERE result IS NULL ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `出货检验待判定：${r.pcb_serial_id || r.row_key}`,
  },
  "TRACE-VIRTUAL-01": {
    taskType: "SERIAL_TRACE",
    sql: `SELECT id AS row_key, trace_key, event_type, reference_no, status FROM traceability_events_2026 WHERE status IN ('open','pending','escalated') ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `追溯事件待闭环：${r.trace_key || r.row_key}`,
  },
  "STATION-EQUIP-VIRTUAL-01": {
    taskType: "STATION_HEARTBEAT",
    sql: `SELECT id AS row_key, asset_code, status, machine_id, station_id, warranty_expiry FROM equipment_assets WHERE status <> 'active' ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `设备非正常状态：${r.asset_code || r.row_key}`,
  },
  "REPAIR-VIRTUAL-01": {
    taskType: "REWORK_ROUTE",
    sql: `SELECT repair_work_order_id AS row_key, work_order_no, ng_sn, status, created_at FROM station_repair_work_orders WHERE status NOT IN ('completed','closed') ORDER BY repair_work_order_id ASC LIMIT $1`,
    gate: null,
    title: r => `返工单待处理：${r.work_order_no || r.row_key}`,
  },
  "FINANCE-VIRTUAL-01": {
    taskType: "THREE_WAY_MATCH",
    sql: `SELECT id AS row_key, invoice_no, supplier_id, due_date, payment_status, posting_status, outstanding_amount FROM ap_invoices WHERE payment_status IS DISTINCT FROM 'paid' AND posting_status IS DISTINCT FROM 'posted' ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `应付发票待三单匹配：${r.invoice_no || r.row_key}`,
  },
  "SALES-VIRTUAL-01": {
    taskType: "ORDER_INTAKE",
    sql: `SELECT id AS row_key, so_id, line_no, qty, fulfilled_qty, planned_delivery FROM sales_order_lines WHERE fulfilled_qty < qty ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `订单欠交待确认：${r.so_id || r.row_key}`,
  },
  "INFRA-VIRTUAL-01": {
    taskType: "CAPACITY_ALERT",
    sql: `SELECT id AS row_key, line_code, product_code, process, uph FROM cfg_capacity WHERE enabled = 0 ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `产能配置待启用：${r.line_code || r.row_key}`,
  },
  "HR-VIRTUAL-01": {
    taskType: "CERT_EXPIRY",
    sql: `SELECT id AS row_key, user_id, cert_no, expire_at, status FROM oa.staff_certificate WHERE expire_at < now() + interval '90 days' ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `证书待续期：${r.cert_no || r.row_key}`,
  },
  "INTEGRATION-VIRTUAL-01": {
    taskType: "API_MONITOR",
    sql: `SELECT id AS row_key, api_path, http_status, success, cost_ms, created_at FROM itf_api_log WHERE success = 0 ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `接口失败待重试：${r.api_path || r.row_key}`,
  },
  "APP-OPS-VIRTUAL-01": {
    taskType: "ALERT_ROUTING",
    sql: `SELECT id AS row_key, alert_key, level, category, status, hit_count, last_seen_at FROM oa.sys_integration_alert WHERE status IS DISTINCT FROM 'closed' ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `集成告警待处理：${r.alert_key || r.row_key}`,
  },
  "DATABASE-VIRTUAL-01": {
    taskType: "SLOW_QUERY",
    sql: `SELECT pid::text AS row_key, usename, application_name, wait_event_type, state, query FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND state <> 'idle' ORDER BY pid ASC LIMIT $1`,
    gate: null,
    title: r => `数据库锁等待：${r.row_key}`,
  },
  "SECURITY-VIRTUAL-01": {
    taskType: "ACCESS_AUDIT",
    sql: `SELECT id AS row_key, user_name, module, action, target, created_at FROM sys_audit_log WHERE created_at >= now() - interval '7 days' ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `账号操作待审计：${r.user_name || r.row_key}`,
  },
  "PDA-FLEET-VIRTUAL-01": {
    taskType: "DEVICE_HEARTBEAT",
    sql: `SELECT id AS row_key, device_code, device_status, assigned_to, line_code FROM pda_devices WHERE device_status IS DISTINCT FROM 'ACTIVE' ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `设备状态异常：${r.device_code || r.row_key}`,
  },
  "BACKUP-VIRTUAL-01": {
    taskType: "RETENTION_MONITOR",
    sql: `SELECT dataset AS row_key, retention_days, enabled, protected FROM station_data_retention_policies WHERE enabled = false ORDER BY dataset ASC LIMIT $1`,
    gate: null,
    title: r => `保留策略待复核：${r.row_key}`,
  },
  "RELEASE-VIRTUAL-01": {
    taskType: "MIGRATION_CHECK",
    sql: `SELECT filename AS row_key, applied_at FROM schema_migrations WHERE filename NOT IN (SELECT filename FROM _migrations) ORDER BY filename ASC LIMIT $1`,
    gate: null,
    title: r => `迁移待核对：${r.row_key}`,
  },
  "REPORTS-VIRTUAL-01": {
    taskType: "KPI_MONITOR",
    sql: `SELECT employee_id AS row_key, day, tasks_created, tasks_rejected, approval_denied, computed_at FROM ve_kpi_daily WHERE tasks_rejected > 0 ORDER BY computed_at DESC, employee_id ASC LIMIT $1`,
    gate: null,
    title: r => `指标异常待复核：${r.row_key}`,
  },
  "SAFETY-VIRTUAL-01": {
    taskType: "DRILL_SCHEDULE",
    sql: `SELECT id AS row_key, drill_code, scheduled_date, result, findings FROM emergency_drills WHERE scheduled_date < now() AND result IS NULL ORDER BY id ASC LIMIT $1`,
    gate: null,
    title: r => `演练待执行：${r.drill_code || r.row_key}`,
  },
});
