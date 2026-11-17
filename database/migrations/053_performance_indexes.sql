-- 053_performance_indexes.sql
-- Performance indexes for cross-manager queries
-- Targets: inventory_transactions, work_orders, pmc_escalation_log
-- Run after 052_fix_wo_bom_linkage.sql

-- ══════════════════════════════════════════════════════════════
-- inventory_transactions — the hottest table in the system
-- Used by: WMS, PMC (material-status), Reports (movement, balance)
-- ══════════════════════════════════════════════════════════════

-- Composite index for work-order material status queries (PMC ↔ WMS)
-- Covers: SELECT SUM(qty) ... WHERE work_order_id = ? AND material_lot_id = ? AND action IN (...)
CREATE INDEX IF NOT EXISTS idx_inv_tx_wo_mat
  ON inventory_transactions(work_order_id, material_lot_id, action);

-- For material movement report — filter by action + date range
CREATE INDEX IF NOT EXISTS idx_inv_tx_action_created
  ON inventory_transactions(action, occurred_at DESC);

-- For lot-level traceability (WMS ↔ MES)
CREATE INDEX IF NOT EXISTS idx_inv_tx_mat_lot
  ON inventory_transactions(material_lot_id, action);

-- For reference_no lookups (feeder_binding, line_issue traceability)
CREATE INDEX IF NOT EXISTS idx_inv_tx_reference_no
  ON inventory_transactions(reference_no)
  WHERE reference_no IS NOT NULL;

-- For material balance derivation (WMS ↔ Reports)
CREATE INDEX IF NOT EXISTS idx_inv_tx_mat_action
  ON inventory_transactions(material_lot_id, action, qty);

-- ══════════════════════════════════════════════════════════════
-- work_orders — PMC Manager core table
-- Used by: Dashboard, PMC, Reports
-- ══════════════════════════════════════════════════════════════

-- For delivery-watch: filter by status + due_date (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_wo_status_due
  ON work_orders(status, due_date ASC)
  WHERE status NOT IN ('closed', 'voided');

-- For PMC work-order list: filter by line + status + priority
CREATE INDEX IF NOT EXISTS idx_wo_line_status
  ON work_orders(line_id, status, priority DESC, due_date ASC)
  WHERE status NOT IN ('closed', 'voided');

-- For WO code lookup (barcode scan from PDA)
CREATE INDEX IF NOT EXISTS idx_wo_code
  ON work_orders(code);

-- ══════════════════════════════════════════════════════════════
-- pmc_escalation_log — delivery-watch LATERAL subquery
-- Used by: PMC Manager (delivery-watch endpoint)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pmc_escalation_log (
  id bigserial PRIMARY KEY,
  wo_code varchar(80) NOT NULL,
  alert_type varchar(50) NOT NULL,
  description text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by bigint REFERENCES users(id)
);

-- Fixes: LATERAL subquery was doing full table scan per WO
CREATE INDEX IF NOT EXISTS idx_escalation_wo_type_open
  ON pmc_escalation_log(wo_code, alert_type, occurred_at DESC)
  WHERE resolved_at IS NULL;

-- ══════════════════════════════════════════════════════════════
-- production_lines — used in almost every JOIN
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_pl_status
  ON production_lines(status);

-- ══════════════════════════════════════════════════════════════
-- material_lots — WMS core
-- Used by: WMS, PMC (best-lot lookup), Reports
-- ══════════════════════════════════════════════════════════════

-- For released stock lookup (PMC material-status best-lot subquery)
CREATE INDEX IF NOT EXISTS idx_ml_mat_released
  ON material_lots(material_id, iqc_status, (received_qty - COALESCE(reserved_qty, 0)) DESC)
  WHERE iqc_status = 'released';

-- For IQC summary report
CREATE INDEX IF NOT EXISTS idx_ml_iqc_mat
  ON material_lots(iqc_status, material_id);

-- ══════════════════════════════════════════════════════════════
-- Verify indexes were created (non-blocking check)
-- ══════════════════════════════════════════════════════════════

-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname LIKE 'idx_%'
-- ORDER BY indexname;
