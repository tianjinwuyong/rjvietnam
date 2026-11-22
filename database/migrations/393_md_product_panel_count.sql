-- =============================================================================
-- 393: md_product 补 panel_count —— 修复 /api/itf/wms/mo 的 500
-- =============================================================================
-- 实测（2026-11-21，非推断）：
--   GET /api/itf/wms/mo → {"code":50001,"message":"MES 内部错误：字段 panel_count 不存在"}
--   根因：src/mesrj/itf/wms-mo.js 的 prodMap() SELECT … panel_count FROM md_product，
--   但 272_mesrj_schema.sql 的 md_product DDL 没有这一列。参考 MES-ruijing 的
--   SQLite schema（sql/schema_dump_20261110.sql:103）是在建表后 ALTER 追加的：
--     `…, feeder_model TEXT, print_times INTEGER DEFAULT 5,
--        panel_count INTEGER DEFAULT 12, bom_versions TEXT, product_type TEXT …`
--   嫁接时只带了 product_type（273），漏了 panel_count。本迁移补齐被读取的这一列，
--   默认值与参考一致（12 拼版）。feeder_model/print_times/bom_versions 当前无读取方，
--   不在此补（避免无消费者的列）。
--
-- 归属: 迁移以 postgres 跑、应用以 smt_factory 连 —— pg_default_acl 为空，
--       新列随表 owner，无需单独授权（表已归 smt_factory，见 272/333）。
-- =============================================================================

ALTER TABLE md_product ADD COLUMN IF NOT EXISTS panel_count INTEGER NOT NULL DEFAULT 12;

COMMENT ON COLUMN md_product.panel_count IS
  '拼版数（每大版含多少小板）；参考 MES-ruijing md_product.panel_count DEFAULT 12，供 /api/itf/wms/mo 的 panelCount 字段';