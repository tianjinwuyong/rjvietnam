-- MES-ruijing 移植 W8：出货报告模板 + AOI 看板索引
-- 来源：源系统 core/report_tpl.py（ensure_schema 建 cfg_report_tpl）
--       源系统 api/aoi.py（_ensure_tables 建 4 个 AOI 索引）
-- 说明：cfg_aoi_defect / cfg_aoi_comp_map / cfg_aoi_points / cfg_aoi_program_map
--       已由迁移 280_mesrj_w5_aoi_cfg.sql 建好，本迁移只补 report_tpl 与索引。

-- ── cfg_report_tpl：出货报告（COC / OQC / CPK）模板 ────────────────────────
CREATE TABLE IF NOT EXISTS cfg_report_tpl (
  id           bigserial PRIMARY KEY,
  tpl_code     text        NOT NULL DEFAULT '',
  tpl_name     text        NOT NULL DEFAULT '',
  kind         text        NOT NULL DEFAULT 'coc',
  file_name    text        NOT NULL DEFAULT '',
  rel_path     text        NOT NULL DEFAULT '',
  sheets       text        NOT NULL DEFAULT '[]',
  mapping      text        NOT NULL DEFAULT '{}',
  enabled      integer     NOT NULL DEFAULT 1,
  remark       text        NOT NULL DEFAULT '',
  created_by   text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  doc_no       text        NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS mesrj_ux_report_tpl_code ON cfg_report_tpl(tpl_code);

-- ── AOI 列表页索引（源 api/aoi.py 的 _ensure_tables）────────────────────────
--   ix_aoi_board_aoi   「实板数」按 aoi_id 统计（没索引就每次全扫）
--   ix_aoi_board_file  按 file_name 关联明细
--   ix_aoi_board_sn_aoi 关键字搜子板条码时是 LIKE '%x%'，做覆盖索引
--   ix_aoi_dev_time    按设备筛 + 按检测时间倒序（列表默认过滤）
--   ix_aoi_result_ft   按结果筛
--   ix_aoi_comp_file   明细弹窗按 file_name 拉不良器件
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_board_aoi    ON prd_aoi_board(aoi_id);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_board_file   ON prd_aoi_board(file_name);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_board_sn_aoi ON prd_aoi_board(board_sn, aoi_id);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_dev_time    ON prd_aoi_result(device_name, test_time DESC);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_result_ft   ON prd_aoi_result(final_result);
CREATE INDEX IF NOT EXISTS mesrj_ix_aoi_comp_file   ON prd_aoi_comp(file_name);

-- ── AOI 复判统计列（源 api/aoi.py 运行时补的列，2026-11-05 起）────────────
--   comp_user_ng_number  复判后仍 NG 的器件数（NULL = 老文件没这个字段，不能当 0）
--   board_user_ng_number 复判后仍 NG 的整板数
--   DPMO 的 True Fail 口径就靠这两列区分「真不良」与「误判」。
ALTER TABLE prd_aoi_result ADD COLUMN IF NOT EXISTS comp_user_ng_number  integer;
ALTER TABLE prd_aoi_result ADD COLUMN IF NOT EXISTS board_user_ng_number integer;

-- ── OQC 抽检单 + 逐项检验（源 core/oqc.py / core/oqc_check.py）──────────────
--   出货报告模板要读这两张表：qlt_oqc_order 出「检验数/判定/检验员」，
--   cfg_oqc_item 出「可映射的检验项清单」，qlt_oqc_check 存逐项检验结果。
CREATE TABLE IF NOT EXISTS qlt_oqc_order (
  id           bigserial PRIMARY KEY,
  oqc_no       text        NOT NULL DEFAULT '',
  pallet_no    text        NOT NULL DEFAULT '',
  po_no        text        NOT NULL DEFAULT '',
  mo_no        text        NOT NULL DEFAULT '',
  product_code text        NOT NULL DEFAULT '',
  cust_code    text        NOT NULL DEFAULT '',
  pallet_qty   integer     NOT NULL DEFAULT 0,
  box_total    integer     NOT NULL DEFAULT 0,
  sample_n     integer     NOT NULL DEFAULT 2,
  sample_boxes text        NOT NULL DEFAULT '',
  ok_boxes     text        NOT NULL DEFAULT '',
  ng_boxes     text        NOT NULL DEFAULT '',
  result       text        NOT NULL DEFAULT '待判',
  status       text        NOT NULL DEFAULT '待检',
  round_no     integer     NOT NULL DEFAULT 1,
  inspector    text        NOT NULL DEFAULT '',
  inspect_time text        NOT NULL DEFAULT '',
  remark       text        NOT NULL DEFAULT '',
  created_by   text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mesrj_ux_oqc_order_no ON qlt_oqc_order(oqc_no);
CREATE INDEX IF NOT EXISTS mesrj_ix_oqc_order_po ON qlt_oqc_order(po_no);

CREATE TABLE IF NOT EXISTS cfg_oqc_item (
  id           bigserial PRIMARY KEY,
  model        text        NOT NULL DEFAULT '',
  seq          integer     NOT NULL DEFAULT 0,
  cat          text        NOT NULL DEFAULT '',
  item_name    text        NOT NULL DEFAULT '',
  spec         text        NOT NULL DEFAULT '',
  insp_default integer     NOT NULL DEFAULT 0,
  equip        text        NOT NULL DEFAULT '',
  enabled      integer     NOT NULL DEFAULT 1,
  remark       text        NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mesrj_ux_oqc_item_ms ON cfg_oqc_item(model, seq);

CREATE TABLE IF NOT EXISTS qlt_oqc_check (
  id           bigserial PRIMARY KEY,
  po_no        text        NOT NULL DEFAULT '',
  model        text        NOT NULL DEFAULT '',
  seq          integer     NOT NULL DEFAULT 0,
  cat          text        NOT NULL DEFAULT '',
  item_name    text        NOT NULL DEFAULT '',
  spec         text        NOT NULL DEFAULT '',
  insp_qty     integer     NOT NULL DEFAULT 0,
  ng_qty       integer     NOT NULL DEFAULT 0,
  equip        text        NOT NULL DEFAULT '',
  remark       text        NOT NULL DEFAULT '',
  inspector    text        NOT NULL DEFAULT '',
  check_time   text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mesrj_ux_oqc_check_po_s ON qlt_oqc_check(po_no, seq);
CREATE INDEX IF NOT EXISTS mesrj_ix_oqc_check_po ON qlt_oqc_check(po_no);
