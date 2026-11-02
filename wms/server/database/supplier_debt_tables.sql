-- 供应商欠料表
CREATE TABLE IF NOT EXISTS supplier_debt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_no VARCHAR(50) NOT NULL UNIQUE,
  supplier_id UUID NOT NULL,
  supplier_code VARCHAR(50) NOT NULL,
  supplier_name VARCHAR(200) NOT NULL,
  material_id UUID NOT NULL,
  material_code VARCHAR(100) NOT NULL,
  material_name VARCHAR(200) NOT NULL,
  origin_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  settled_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  source_type VARCHAR(50) NOT NULL DEFAULT 'production_return',
  source_id UUID NOT NULL,
  source_no VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  remark TEXT,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_by user_profile
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_supplier_debt_supplier ON supplier_debt(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_material ON supplier_debt(material_id);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_status ON supplier_debt(status);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_source ON supplier_debt(source_id);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_created ON supplier_debt(_created_at);

-- 供应商欠料补料冲减记录表
CREATE TABLE IF NOT EXISTS supplier_debt_settlement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id UUID NOT NULL REFERENCES supplier_debt(id),
  receipt_id UUID,
  receipt_no VARCHAR(50),
  qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  iqc_result VARCHAR(20) NOT NULL DEFAULT 'pass',
  remark TEXT,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_by user_profile
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_sds_debt ON supplier_debt_settlement(debt_id);
CREATE INDEX IF NOT EXISTS idx_sds_receipt ON supplier_debt_settlement(receipt_id);
