-- 258: WO material-pick success announcements + immutable issue/acceptance
-- sheet records for reporting.
--
-- Announcement: emitted when EVERY collect line of a WO reaches COLLECTED
-- (warehouse finished collecting). Targeted at the WO's production line so the
-- line picker PDA / display board can announce "materials ready to pick".
-- History is append-only (never deleted) for audit/reporting.

CREATE TABLE IF NOT EXISTS wms_issue_announcements (
  id           BIGSERIAL PRIMARY KEY,
  wo_code      VARCHAR(80) NOT NULL,
  line_code    VARCHAR(40),
  collect_no   VARCHAR(40) NOT NULL,
  message      TEXT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'READY',  -- READY | ACKED | EXPIRED
  acked_by     VARCHAR(80),
  acked_at     TIMESTAMPTZ,
  announced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wms_issue_announce_wo    ON wms_issue_announcements(wo_code);
CREATE INDEX IF NOT EXISTS idx_wms_issue_announce_line  ON wms_issue_announcements(line_code, status);

-- Reporting ledger: material issue sheets (one per WO-collect order) are the
-- wms_collect_orders rows already kept; acceptance sheets (产线收料签名) are
-- wms_pick_acceptance rows. Both are append-only. This view flattens the two
-- into one reporting record set for the slips page/reporting.
CREATE OR REPLACE VIEW wms_issue_sheet_ledger AS
SELECT 'ISSUE'::text AS sheet_type,
       c.collect_no  AS sheet_no,
       c.work_order_code AS wo_code,
       c.line_code,
       c.status      AS sheet_status,
       c.created_by  AS raised_by,
       c.created_at  AS raised_at,
       c.collector   AS picked_by,
       c.collected_at,
       (SELECT COUNT(*) FROM wms_collect_order_lines l WHERE l.collect_order_id=c.id) AS line_count,
       (SELECT COUNT(*) FROM wms_collect_order_lines l WHERE l.collect_order_id=c.id AND l.status='COLLECTED') AS collected_count,
       (SELECT COUNT(*) FROM wms_collect_order_lines l WHERE l.collect_order_id=c.id AND l.status='ISSUED') AS issued_count
  FROM wms_collect_orders c
UNION ALL
SELECT 'ACCEPT'::text AS sheet_type,
       'ACC-' || a.id AS sheet_no,
       a.wo_code,
       NULL AS line_code,
       'ACCEPTED' AS sheet_status,
       a.operator AS raised_by,
       a.created_at AS raised_at,
       a.operator AS picked_by,
       a.accepted_at,
       a.item_count AS line_count,
       a.item_count AS collected_count,
       a.item_count AS issued_count
  FROM wms_pick_acceptance a;
