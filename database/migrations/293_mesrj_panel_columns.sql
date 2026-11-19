-- W12: 面板/分板缺失列补齐（源 api/panel.py）
--
-- 278 建了 cfg_panel_layout 但缺 orientation/station_code；
-- 289 建了 prd_panel_split/prd_panel_slot 但缺 panel_scan/panel_complete/panel_reset 需要的列。
-- 所有 ALTER TABLE ADD COLUMN IF NOT EXISTS，幂等可重复执行。

-- ── cfg_panel_layout：拼版布局 ──
ALTER TABLE cfg_panel_layout
  ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT 'landscape',
  ADD COLUMN IF NOT EXISTS station_code TEXT NOT NULL DEFAULT '';

-- ── prd_panel_split：拼版分板会话 ──
ALTER TABLE prd_panel_split
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS seq_base integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS good_cnt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ng_cnt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS operator TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS remark TEXT NOT NULL DEFAULT '';

-- ── prd_panel_slot：拼版每格明细 ──
ALTER TABLE prd_panel_slot
  ADD COLUMN IF NOT EXISTS row_idx integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS col_idx integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disposition TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS operator TEXT NOT NULL DEFAULT '';

COMMENT ON TABLE cfg_panel_layout IS '拼板布局（含 orientation/station_code）';
COMMENT ON TABLE prd_panel_split IS '拼版分板会话（含 seq_base/good_cnt/ng_cnt/operator/finished_at）';
COMMENT ON TABLE prd_panel_slot IS '拼版每格明细（含 row_idx/col_idx/disposition/operator）';
