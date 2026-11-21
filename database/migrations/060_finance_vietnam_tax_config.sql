-- Migration 060: Vietnam Tax Configuration and SMT Factory Financial Parameters
-- Seeds tax_codes, labor cost rates, and overhead configuration for SMT lines.
-- Uses existing tables from migration 003. Safe to re-run with ON CONFLICT.

begin;

-- ── Tax Codes (VAS-compliant) ─────────────────────────────────────────────────
-- Vietnam tax types: vat, sales_tax, withholding, import, other
insert into tax_codes (code, name_zh, name_en, name_vi, tax_type, rate, recoverable, status) values
-- VAT codes
('VAT-0',  '零税率',          'Zero Rate VAT',     'Thuế GTGT 0%',        'vat',      0.0000, true,  'active'),
('VAT-5',  '5%税率',           '5% VAT',            'Thuế GTGT 5%',        'vat',      5.0000, true,  'active'),
('VAT-8',  '8%税率',           '8% VAT',            'Thuế GTGT 8%',        'vat',      8.0000, true,  'active'),
('VAT-10', '10%标准税率',      '10% Standard VAT',  'Thuế GTGT 10% tiêu chuẩn','vat',10.0000, true,  'active'),
-- Withholding tax (Vietnam: 1%, 2%, 5% on foreign contractors)
('WHT-1',  '代扣税1%',         'WHT 1%',            'Thuế khấu trừ 1%',   'withholding', 1.0000, false, 'active'),
('WHT-2',  '代扣税2%',         'WHT 2%',            'Thuế khấu trừ 2%',   'withholding', 2.0000, false, 'active'),
('WHT-5',  '代扣税5%',         'WHT 5%',            'Thuế khấu trừ 5%',   'withholding', 5.0000, false, 'active'),
-- Import duty (electronics components typically 0-5%)
('IMP-0',  '免税',             'Import Duty 0%',    'Thuế nhập khẩu 0%',  'import',   0.0000, false, 'active'),
('IMP-2',  '进口税2%',         'Import Duty 2%',    'Thuế nhập khẩu 2%',  'import',   2.0000, false, 'active'),
('IMP-5',  '进口税5%',         'Import Duty 5%',    'Thuế nhập khẩu 5%',  'import',   5.0000, false, 'active'),
-- Other
('CIT-20', '企业所得税20%',    'CIT 20%',           'Thuế TNDN 20%',       'other',   20.0000, false, 'active'),
('ST-1',   '销售税1%',         'Sales Tax 1%',      'Thuế bán hàng 1%',   'sales_tax',1.0000, false, 'active')
on conflict (code) do nothing;

-- ── SMT Line Standard Overhead Rates (USD/hour) ────────────────────────────────
-- These are stored in a simple config table for now.
-- Overhead includes: machine depreciation, utilities, floor space, supervision
create table if not exists finance_smt_overhead_rates (
  id          bigserial primary key,
  cost_center_code varchar(40) not null unique references cost_centers(code),
  overhead_rate_usd numeric(12,4) not null default 0,
  currency_code  varchar(12) not null default 'USD',
  effective_from date not null default '2026-01-01',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into finance_smt_overhead_rates (cost_center_code, overhead_rate_usd, effective_from) values
  ('SMT-L1',  42.5000, '2026-01-01'),
  ('SMT-L2',  44.8000, '2026-01-01'),
  ('SMT-L3',  46.2000, '2026-01-01'),
  ('DIP-L1',  28.5000, '2026-01-01'),
  ('TEST-L1', 22.0000, '2026-01-01'),
  ('PACK-L1', 15.0000, '2026-01-01')
on conflict (cost_center_code) do nothing;

-- ── Labor Cost Rates (VND/month, 2026 Vietnam minimum wage by region) ──────────
-- Region I (HCMC, Hanoi): VND 4,960,000/month
-- Factory: assume all workers at Region I + 30% benefits load
create table if not exists finance_labor_rates (
  id            bigserial primary key,
  grade         varchar(40) not null unique,
  name_zh       varchar(120),
  name_en       varchar(120),
  name_vi       varchar(120),
  base_salary_vnd numeric(14,2) not null,
  benefits_load numeric(5,4) not null default 0.3000,  -- 30% for social insurance, unemployment, etc.
  currency_code varchar(12) not null default 'VND',
  effective_from date not null default '2026-01-01',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into finance_labor_rates (grade, name_zh, name_en, name_vi, base_salary_vnd, benefits_load) values
  ('OPERATOR-L1', '操作工一级', 'Operator Grade 1', 'Công nhân cấp 1',    4960000, 0.3000),
  ('OPERATOR-L2', '操作工二级', 'Operator Grade 2', 'Công nhân cấp 2',    5500000, 0.3000),
  ('OPERATOR-L3', '操作工三级', 'Operator Grade 3', 'Công nhân cấp 3',    6200000, 0.3000),
  ('TECH-L1',     '技术员一级', 'Technician Grade 1','Kỹ thuật viên cấp 1', 8500000, 0.3000),
  ('TECH-L2',     '技术员二级', 'Technician Grade 2','Kỹ thuật viên cấp 2',10500000, 0.3000),
  ('QC-L1',       '质检员',     'QC Inspector',     'Nhân viên QC',        7000000, 0.3000),
  ('SUPERVISOR',  '班长',       'Supervisor',        'Giám sát',           12000000, 0.3000),
  ('MANAGER',     '经理',       'Manager',           'Quản lý',            20000000, 0.3000)
on conflict (grade) do nothing;

-- ── Work Order Standard Costing Configuration ─────────────────────────────────
create table if not exists finance_wo_cost_config (
  id              bigserial primary key,
  config_key      varchar(60) not null unique,
  config_value    text,
  description_zh  varchar(200),
  description_en  varchar(200),
  status          varchar(20) not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

insert into finance_wo_cost_config (config_key, config_value, description_zh, description_en) values
  ('DEFAULT_CURRENCY',      'USD',       '默认本位币', 'Default reporting currency'),
  ('VND_EXCHANGE_RATE',     '25250',     'VND汇率（采购记账用）', 'VND exchange rate for costing'),
  ('SCRAP_LOSS_RATE',       '0.02',      'SMT标准报废率2%', 'Standard scrap rate for SMT (2%)'),
  ('REWORK_RATE',           '0.01',      'SMT标准返工率1%', 'Standard rework rate (1%)'),
  ('OVERHEAD_ALLOCATION',   'machine_hours', '制造费用分配基础-machine_hours', 'Overhead allocation base'),
  ('COGS_POSTING_ENABLED',  'true',      '工单关闭时自动过账COGS', 'Auto-post COGS on work order close'),
  ('AR_AGING_ENABLED',      'true',      '启用应收账龄分析', 'Enable AR aging report')
on conflict (config_key) do nothing;

-- ── Finance Report Configurations ────────────────────────────────────────────
insert into finance_reports (code, name_zh, name_en, name_vi, params)
values
  ('RPT-PL', '利润表', 'Profit & Loss Statement', 'Báo cáo lợi nhuận', '{"type":"profit_loss","period":"monthly"}'),
  ('RPT-BS', '资产负债表', 'Balance Sheet', 'Bảng cân đối kế toán', '{"type":"balance_sheet"}'),
  ('RPT-CF', '现金流量表', 'Cash Flow Statement', 'Bảng cáo lưu chuyển tiền tệ', '{"type":"cash_flow"}'),
  ('RPT-WC', '工单成本明细', 'Work Order Cost Detail', 'Chi tiết chi phí đơn hàng', '{"type":"work_order_cost"}')
on conflict (code) do nothing;

-- ── Sequences for Finance Document Numbers ─────────────────────────────────────
-- These ensure unique, sequential invoice/payment numbers across all tenants.
create sequence if not exists ar_invoice_number_seq;
create sequence if not exists ap_invoice_number_seq;
create sequence if not exists gl_journal_number_seq;
create sequence if not exists payment_number_seq;

-- Set reasonable start values (skip — sequence will auto-start at 1 if empty tables)
-- The sequences were just created; their default nextval(1) is fine for new installs.
-- Uncomment and fix the regex for existing data:
-- SELECT setval('ar_invoice_number_seq', 1000, true);
-- SELECT setval('ap_invoice_number_seq', 1000, true);
-- SELECT setval('gl_journal_number_seq', 1000, true);
-- SELECT setval('payment_number_seq', 1000, true);

-- ── Migration record ─────────────────────────────────────────────────────────
insert into _migrations (filename, hash)
values ('060_finance_vietnam_tax_config.sql', '060vnfin2')
on conflict (filename) do update set
  hash = Excluded.hash,
  applied_at = now();

commit;
