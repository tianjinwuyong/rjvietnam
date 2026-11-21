-- Migration: Add timestamps to boms and bom_lines
-- These columns are needed for the BOM management API

ALTER TABLE boms ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE boms ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE bom_lines ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE bom_lines ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
