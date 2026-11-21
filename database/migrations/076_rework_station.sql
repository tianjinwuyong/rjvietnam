-- ============================================================
-- Migration: 076_rework_station.sql
-- 回修站 MES 集成：rework_records 表 + API 端点
-- ============================================================

-- 回修站 schema
CREATE SCHEMA IF NOT EXISTS rework;

-- 回修记录表
CREATE TABLE IF NOT EXISTS rework.rework_records (
  id              bigserial PRIMARY KEY,
  sn              varchar(120) NOT NULL,          -- PCB序列号
  source_station  varchar(50),                   -- 产生NG的工站
  source_line     varchar(20),                    -- 产生NG的产线
  route_to        varchar(50),                   -- 返工后去向（重新ATE/报废/入库）
  defect_code     varchar(80),                    -- 缺陷代码
  defect_reason   text,                           -- 缺陷原因
  material_code  varchar(60),                    -- 更换物料编码
  repair_count   integer NOT NULL DEFAULT 1,     -- 返修次数（第几次）
  result         varchar(20) NOT NULL DEFAULT 'open',  -- open|repaired|scrapped
  operator       varchar(60),                    -- 返修操作员
  repaired_at    timestamptz,                    -- 修复时间
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE rework.rework_records IS '回修站修复记录';
COMMENT ON COLUMN rework.rework_records.sn IS 'PCB序列号';
COMMENT ON COLUMN rework.rework_records.result IS 'open|repaired|scrapped';

-- 索引
CREATE INDEX IF NOT EXISTS idx_rework_sn         ON rework.rework_records USING hash (sn);
CREATE INDEX IF NOT EXISTS idx_rework_result     ON rework.rework_records (result, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rework_created    ON rework.rework_records (created_at DESC);

-- 回修计数视图（用于判断≥3次报废）
CREATE OR REPLACE FUNCTION rework.get_repair_count(p_sn varchar)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COUNT(*) FROM rework.rework_records WHERE sn = p_sn;
$$;

DO $$
BEGIN
  RAISE NOTICE '076_rework_station: rework.rework_records created';
END $$;
