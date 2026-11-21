-- Migration: Add vietnam_code column to materials
-- The BOM Excel files use Vietnamese material codes (R0xxx-xxxxx) as the primary identifier.
-- The materials.code field holds Chinese-format codes (0.xx.xx.xx.xxxx) for Chinese-supplied materials.
-- This column stores the Vietnamese code for materials sourced from Vietnam.

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS vietnam_code varchar(80) unique;

CREATE INDEX IF NOT EXISTS idx_materials_vietnam_code ON materials (vietnam_code) WHERE vietnam_code IS NOT NULL;

COMMENT ON COLUMN materials.vietnam_code IS 'Vietnamese material code (R0xxx-xxxxx), primary code used in BOM import';
