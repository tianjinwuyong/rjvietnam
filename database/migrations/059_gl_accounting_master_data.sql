-- Migration 059: GL Accounting Master Data for Vietnam SMT Factory
-- Seeds chart of accounts, currencies, cost/profit centers, fiscal periods, and exchange rates.
-- Table structures already exist from migration 003. This file ONLY seeds data.
-- Safe to re-run: uses ON CONFLICT DO NOTHING.

begin;

-- ── Currencies ───────────────────────────────────────────────────────────────
insert into currencies (code, name_zh, name_en, name_vi, symbol, minor_units, status) values
  ('VND', '越南盾', 'Vietnamese Dong', 'Đồng Việt Nam', '₫', 0, 'active'),
  ('USD', '美元', 'US Dollar', 'Đô la Mỹ', '$', 2, 'active'),
  ('CNY', '人民币', 'Chinese Yuan', 'Nhân dân tệ', '¥', 2, 'active')
on conflict (code) do nothing;

-- ── GL Accounts ───────────────────────────────────────────────────────────────
-- gl_accounts table already exists from migration 003. Seed chart of accounts.
insert into gl_accounts (code, name_zh, name_en, name_vi, account_type, normal_balance, is_postable, status) values
-- Assets 1000
('1100', '现金和等价物', 'Cash and Cash Equivalents', 'Tiền và tương đương tiền', 'asset', 'debit', true, 'active'),
('1110', '美元银行账户', 'USD Bank Account', 'Tài khoản ngân hàng USD', 'asset', 'debit', true, 'active'),
('1120', '越南盾银行账户', 'VND Bank Account', 'Tài khoản ngân hàng VND', 'asset', 'debit', true, 'active'),
('1200', '应收账款', 'Accounts Receivable', 'Phải thu khách hàng', 'asset', 'debit', true, 'active'),
('1300', '其他应收款', 'Other Receivables', 'Các khoản phải thu khác', 'asset', 'debit', true, 'active'),
('1400', '存货-原材料', 'Inventory - Raw Materials', 'Tồn kho - Nguyên vật liệu', 'asset', 'debit', true, 'active'),
('1410', '存货-在制品', 'Inventory - Work in Progress', 'Tồn kho - Sản phẩm dở dang', 'asset', 'debit', true, 'active'),
('1420', '存货-成品', 'Inventory - Finished Goods', 'Tồn kho - Thành phẩm', 'asset', 'debit', true, 'active'),
('1500', '预付账款', 'Prepaid Expenses', 'Chi phí trả trước', 'asset', 'debit', true, 'active'),
('1600', '固定资产', 'Fixed Assets', 'Tài sản cố định', 'asset', 'debit', true, 'active'),
('1610', '累计折旧', 'Accumulated Depreciation', 'Hao mòn TSCĐ', 'asset', 'credit', true, 'active'),
('1700', '无形资产', 'Intangible Assets', 'Tài sản vô hình', 'asset', 'debit', true, 'active'),

-- Liabilities 2000
('2100', '应付账款', 'Accounts Payable', 'Phải trả người bán', 'liability', 'credit', true, 'active'),
('2200', '应交税费', 'Taxes Payable', 'Thuế phải nộp', 'liability', 'credit', true, 'active'),
('2210', '销项增值税', 'VAT Payable - Output', 'Thuế GTGT phải nộp - Đầu ra', 'liability', 'credit', true, 'active'),
('2220', '进项增值税可抵扣', 'VAT Receivable - Input', 'Thuế GTGT được khấu trừ - Đầu vào', 'liability', 'debit', true, 'active'),
('2300', '代扣所得税', 'Withholding Tax Payable', 'Thuế thu nhập khấu trừ', 'liability', 'credit', true, 'active'),
('2400', '进口关税应付', 'Import Duty Payable', 'Thuế nhập khẩu phải nộp', 'liability', 'credit', true, 'active'),
('2500', '应付费用', 'Accrued Expenses', 'Chi phí phải trả', 'liability', 'credit', true, 'active'),
('2600', '递延收益', 'Deferred Revenue', 'Doanh thu chưa thực hiện', 'liability', 'credit', true, 'active'),
('2700', '长期借款', 'Long-term Loans', 'Vay dài hạn', 'liability', 'credit', true, 'active'),

-- Equity 3000
('3100', '实收资本', 'Paid-in Capital', 'Vốn góp', 'equity', 'credit', true, 'active'),
('3200', '留存收益', 'Retained Earnings', 'Lợi nhuận giữ lại', 'equity', 'credit', true, 'active'),
('3300', '汇率差额', 'Foreign Exchange Difference', 'Chênh lệch tỷ giá', 'equity', 'credit', true, 'active'),

-- Revenue 4000
('4100', '销售收入-国内', 'Sales Revenue - Domestic', 'Doanh thu bán hàng - Trong nước', 'revenue', 'credit', true, 'active'),
('4110', '销售收入-出口', 'Sales Revenue - Export', 'Doanh thu bán hàng - Xuất khẩu', 'revenue', 'credit', true, 'active'),
('4200', '服务收入', 'Service Revenue', 'Doanh thu dịch vụ', 'revenue', 'credit', true, 'active'),
('4300', '其他收入', 'Other Revenue', 'Thu nhập khác', 'revenue', 'credit', true, 'active'),

-- COGS 5000
('5100', '销售成本-材料', 'COGS - Materials', 'Giá vốn - Nguyên vật liệu', 'cogs', 'debit', true, 'active'),
('5110', '销售成本-人工', 'COGS - Labor', 'Giá vốn - Nhân công', 'cogs', 'debit', true, 'active'),
('5120', '销售成本-制造费用', 'COGS - Overhead', 'Giá vốn - Chi phí sản xuất chung', 'cogs', 'debit', true, 'active'),
('5130', '销售成本-废品返工', 'COGS - Scrap & Rework', 'Giá vốn - Phế liệu & tái chế', 'cogs', 'debit', true, 'active'),
('5140', '销售成本-损耗损失', 'COGS - Yield Loss', 'Giá vốn - Tổn thất suất', 'cogs', 'debit', true, 'active'),

-- Expenses 6000
('6100', '材料用量差异', 'Material Usage Variance', 'Chênh lệch sử dụng nguyên vật liệu', 'expense', 'debit', true, 'active'),
('6200', '人工成本差异', 'Labor Cost Variance', 'Chênh lệch chi phí nhân công', 'expense', 'debit', true, 'active'),
('6300', '制造费用差异', 'Overhead Variance', 'Chênh lệch chi phí sản xuất chung', 'expense', 'debit', true, 'active'),
('6400', '销售费用', 'Selling Expenses', 'Chi phí bán hàng', 'expense', 'debit', true, 'active'),
('6500', '管理费用', 'Administrative Expenses', 'Chi phí quản lý doanh nghiệp', 'expense', 'debit', true, 'active'),
('6600', '财务费用', 'Financial Expenses', 'Chi phí tài chính', 'expense', 'debit', true, 'active'),
('6610', '汇兑损失', 'Foreign Exchange Loss', 'Lỗ chênh lệch tỷ giá', 'expense', 'debit', true, 'active'),
('6700', '其他费用', 'Other Expenses', 'Chi phí khác', 'expense', 'debit', true, 'active')
on conflict (code) do nothing;

-- ── Cost Centers (SMT Production Lines) ──────────────────────────────────────
insert into cost_centers (code, name_zh, name_en, name_vi, center_type, status) values
('SMT-L1', 'SMT生产线1', 'SMT Line 1', 'Dây chuyền SMT 1', 'production', 'active'),
('SMT-L2', 'SMT生产线2', 'SMT Line 2', 'Dây chuyền SMT 2', 'production', 'active'),
('SMT-L3', 'SMT生产线3', 'SMT Line 3', 'Dây chuyền SMT 3', 'production', 'active'),
('DIP-L1', 'DIP生产线1', 'DIP Line 1', 'Dây chuyền DIP 1', 'production', 'active'),
('TEST-L1', '测试线', 'Test Line', 'Dây chuyền kiểm tra', 'test', 'active'),
('PACK-L1', '包装线', 'Packing Line', 'Dây chuyền đóng gói', 'packing', 'active'),
('WH-MAT', '原材料仓库', 'Material Warehouse', 'Kho nguyên vật liệu', 'warehouse', 'active'),
('QA', '质量检验', 'Quality Assurance', 'Kiểm tra chất lượng', 'quality', 'active'),
('ADMIN', '行政管理', 'Administration', 'Hành chính quản trị', 'admin', 'active')
on conflict (code) do nothing;

-- ── Profit Centers ───────────────────────────────────────────────────────────
insert into profit_centers (code, name_zh, name_en, name_vi, center_type, status) values
('PC-EXPORT', '出口业务', 'Export Business', 'Kinh doanh xuất khẩu', 'business', 'active'),
('PC-DOMESTIC', '国内业务', 'Domestic Business', 'Kinh doanh trong nước', 'business', 'active'),
('PC-SERVICE', '服务业务', 'Service Business', 'Kinh doanh dịch vụ', 'business', 'active')
on conflict (code) do nothing;

-- ── Fiscal Periods 2026 ───────────────────────────────────────────────────────
do $$
declare
  m int;
  p_start date;
  p_end date;
  p_code varchar(20);
  p_status varchar(20);
begin
  for m in 1..12 loop
    p_start := date '2026-01-01' + (m-1) * interval '1 month';
    p_end   := date '2026-01-01' + m * interval '1 month' - interval '1 day';
    p_code  := to_char(p_start, 'YYYY-MM');
    if m < 6 then
      p_status := 'closed';
    elsif m = 6 then
      p_status := 'open';
    else
      p_status := 'open';
    end if;
    insert into fiscal_periods (period_code, period_type, start_date, end_date, status)
    values (p_code, 'month', p_start, p_end, p_status)
    on conflict (period_code) do nothing;
  end loop;
end $$;

-- ── Exchange Rates USD/VND ────────────────────────────────────────────────────
-- Approximate market rates for 2026
insert into exchange_rates (rate_date, base_currency_code, quote_currency_code, rate, source, status) values
  ('2026-01-01', 'USD', 'VND', 25480, 'SBV Reference Rate', 'active'),
  ('2026-02-01', 'USD', 'VND', 25520, 'SBV Reference Rate', 'active'),
  ('2026-03-01', 'USD', 'VND', 25450, 'SBV Reference Rate', 'active'),
  ('2026-04-01', 'USD', 'VND', 25380, 'SBV Reference Rate', 'active'),
  ('2026-05-01', 'USD', 'VND', 25300, 'SBV Reference Rate', 'active'),
  ('2026-06-01', 'USD', 'VND', 25250, 'SBV Reference Rate', 'active'),
  ('2026-07-01', 'USD', 'VND', 25180, 'SBV Reference Rate', 'active')
on conflict (rate_date, base_currency_code, quote_currency_code) do nothing;

-- ── Migration record ───────────────────────────────────────────────────────────
insert into _migrations (filename, hash)
values ('059_gl_accounting_master_data.sql', '059glacc')
on conflict (filename) do update set
  hash = Excluded.hash,
  applied_at = now();

commit;
