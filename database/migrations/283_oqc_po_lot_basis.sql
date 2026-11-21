-- Migration 283: OQC 批量按 PO/托盘自动推导 + SN 托盘归属校验
--
-- 逐语义移植自源 core/oqc_aql.py 的 _po_lot_qty / _belongs：
--   - lot_basis：记录批量来源（po=prd_pallet.total_qty 汇总 / box=prd_box.qty 汇总 /
--     manual=人工填写），便于回溯与审计。
--   - pallet_no：OQC 批对应的托盘号，供 SN 托盘归属校验使用。
-- 两张表已由 201_qms_phase1.sql 建好，本迁移只补字段（幂等）。

BEGIN;

ALTER TABLE qms_oqc_batches
    ADD COLUMN IF NOT EXISTS po_no       VARCHAR(50),
    ADD COLUMN IF NOT EXISTS pallet_no   VARCHAR(50),
    ADD COLUMN IF NOT EXISTS lot_basis    VARCHAR(20) DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_oqc_batches_po ON qms_oqc_batches(po_no);
CREATE INDEX IF NOT EXISTS idx_oqc_batches_pallet ON qms_oqc_batches(pallet_no);

COMMIT;