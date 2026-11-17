-- Migration: 080_srt_wo_code.sql
-- Add work_order_code to smart_rack_transactions for PDA loading traceability
-- Place-wo logs which WO caused the shelf-in, enabling dashboard queries

ALTER TABLE smart_rack_transactions
ADD COLUMN IF NOT EXISTS work_order_code VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_srt_wo_code ON smart_rack_transactions(work_order_code);
CREATE INDEX IF NOT EXISTS idx_srt_created_at ON smart_rack_transactions(created_at DESC);
