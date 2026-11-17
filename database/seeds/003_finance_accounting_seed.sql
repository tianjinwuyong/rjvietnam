insert into roles (code, name_zh, name_en, name_vi)
values ('finance', '财务', 'Finance', 'Tai chinh')
on conflict (code) do nothing;

insert into users (username, display_name, role_id, locale)
select 'FIN_VN_001', 'Le Finance 001', id, 'vi-VN'
from roles
where code = 'finance'
on conflict (username) do nothing;

insert into permissions (code, name_zh, name_en, name_vi, module)
values
('finance.gl.read', 'General ledger read', 'General ledger read', 'Xem so cai', 'finance'),
('finance.gl.write', 'General ledger write', 'General ledger write', 'Ghi so cai', 'finance'),
('finance.ap.read', 'AP read', 'AP read', 'Xem cong no phai tra', 'finance'),
('finance.ap.write', 'AP write', 'AP write', 'Ghi cong no phai tra', 'finance'),
('finance.ar.read', 'AR read', 'AR read', 'Xem cong no phai thu', 'finance'),
('finance.ar.write', 'AR write', 'AR write', 'Ghi cong no phai thu', 'finance'),
('finance.cost.read', 'Cost read', 'Cost read', 'Xem gia thanh', 'finance'),
('finance.cost.write', 'Cost write', 'Cost write', 'Ghi gia thanh', 'finance'),
('finance.billing.read', 'Billing read', 'Billing read', 'Xem hoa don', 'finance'),
('finance.billing.write', 'Billing write', 'Billing write', 'Ghi hoa don', 'finance'),
('finance.posting.read', 'Posting read', 'Posting read', 'Xem but toan', 'finance'),
('finance.posting.write', 'Posting write', 'Posting write', 'Ghi but toan', 'finance')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'finance.gl.read',
  'finance.gl.write',
  'finance.ap.read',
  'finance.ap.write',
  'finance.ar.read',
  'finance.ar.write',
  'finance.cost.read',
  'finance.cost.write',
  'finance.billing.read',
  'finance.billing.write',
  'finance.posting.read',
  'finance.posting.write'
)
where r.code = 'finance'
on conflict (role_id, permission_id) do nothing;

insert into currencies (code, name_zh, name_en, name_vi, symbol, minor_units)
values
('VND', 'VND', 'Vietnamese Dong', 'Dong Viet Nam', 'VND', 0),
('USD', 'USD', 'US Dollar', 'Do la My', '$', 2),
('CNY', 'CNY', 'Chinese Yuan', 'Nhan dan te', 'CNY', 2)
on conflict (code) do nothing;

insert into fiscal_periods (period_code, period_type, start_date, end_date, status)
values
('FY2026-06', 'month', date '2026-06-01', date '2026-06-30', 'open'),
('FY2026-07', 'month', date '2026-07-01', date '2026-07-31', 'open')
on conflict (period_code) do nothing;

insert into gl_accounts (code, parent_id, name_zh, name_en, name_vi, account_type, normal_balance, is_postable, status)
values
('1000', null, 'Cash', 'Cash', 'Tien mat', 'asset', 'debit', true, 'active'),
('1100', null, 'Raw Material Inventory', 'Raw Material Inventory', 'Hang ton kho nguyen lieu', 'asset', 'debit', true, 'active'),
('1200', null, 'Work In Process', 'Work In Process', 'San xuat do dang', 'asset', 'debit', true, 'active'),
('1300', null, 'Finished Goods Inventory', 'Finished Goods Inventory', 'Hang ton kho thanh pham', 'asset', 'debit', true, 'active'),
('1400', null, 'Accounts Receivable', 'Accounts Receivable', 'Phai thu khach hang', 'asset', 'debit', true, 'active'),
('2000', null, 'Accounts Payable', 'Accounts Payable', 'Phai tra nha cung cap', 'liability', 'credit', true, 'active'),
('2100', null, 'VAT Payable', 'VAT Payable', 'Thue VAT phai nop', 'liability', 'credit', true, 'active'),
('3000', null, 'Equity', 'Equity', 'Von chu so huu', 'equity', 'credit', true, 'active'),
('4000', null, 'Sales Revenue', 'Sales Revenue', 'Doanh thu ban hang', 'revenue', 'credit', true, 'active'),
('5000', null, 'Material Consumption', 'Material Consumption', 'Chi phi nguyen lieu', 'cogs', 'debit', true, 'active'),
('5100', null, 'Direct Labor', 'Direct Labor', 'Chi phi nhan cong truc tiep', 'cogs', 'debit', true, 'active'),
('5200', null, 'Manufacturing Overhead', 'Manufacturing Overhead', 'Chi phi san xuat chung', 'cogs', 'debit', true, 'active'),
('5300', null, 'Scrap Loss', 'Scrap Loss', 'Chi phi phe pham', 'expense', 'debit', true, 'active'),
('5400', null, 'Cost Variance', 'Cost Variance', 'Chenhlech gia thanh', 'expense', 'debit', true, 'active')
on conflict (code) do nothing;

insert into cost_centers (code, parent_id, name_zh, name_en, name_vi, center_type, owner_user_id, status)
select v.code, null, v.name_zh, v.name_en, v.name_vi, v.center_type, u.id, 'active'
from (
  values
    ('CC-WH-RAW', 'Raw Warehouse', 'Raw Warehouse', 'Kho nguyen lieu', 'warehouse'),
    ('CC-SMT-L1', 'SMT Line 1', 'SMT Line 1', 'Line SMT 1', 'production'),
    ('CC-QA', 'Quality Lab', 'Quality Lab', 'Phong chat luong', 'quality'),
    ('CC-FIN', 'Finance Office', 'Finance Office', 'Phong tai chinh', 'finance')
) as v(code, name_zh, name_en, name_vi, center_type)
cross join users u
where u.username = 'FIN_VN_001'
on conflict (code) do nothing;

insert into profit_centers (code, parent_id, name_zh, name_en, name_vi, center_type, owner_user_id, status)
select v.code, null, v.name_zh, v.name_en, v.name_vi, v.center_type, u.id, 'active'
from (
  values
    ('PC-VN-PLANT1', 'Vietnam Plant 1', 'Vietnam Plant 1', 'Nha may Viet Nam 1', 'plant'),
    ('PC-SMT', 'SMT Business', 'SMT Business', 'Kinh doanh SMT', 'business_unit')
) as v(code, name_zh, name_en, name_vi, center_type)
cross join users u
where u.username = 'FIN_VN_001'
on conflict (code) do nothing;

insert into tax_codes (code, name_zh, name_en, name_vi, tax_type, rate, recoverable, status)
values
('VAT10', 'VAT 10%', 'VAT 10%', 'VAT 10%', 'vat', 10.0000, true, 'active'),
('VAT0', 'VAT 0%', 'Zero VAT', 'VAT 0%', 'vat', 0.0000, true, 'active')
on conflict (code) do nothing;

insert into exchange_rates (rate_date, base_currency_code, quote_currency_code, rate, source, status)
values
(date '2026-06-16', 'USD', 'VND', 24500.00000000, 'seed', 'active'),
(date '2026-06-16', 'CNY', 'VND', 3450.00000000, 'seed', 'active'),
(date '2026-06-16', 'VND', 'USD', 0.00004082, 'seed', 'active')
on conflict (rate_date, base_currency_code, quote_currency_code) do nothing;

update customers
set account_owner_id = u.id,
    default_currency_code = 'USD',
    tax_registration_no = 'VN-CUST-010',
    payment_terms_days = 30
from users u
where customers.code = 'CUST-HANOI-01'
  and u.username = 'FIN_VN_001';

update suppliers
set account_owner_id = u.id,
    default_currency_code = 'USD',
    tax_registration_no = 'VN-SUP-001',
    payment_terms_days = 45
from users u
where suppliers.code in ('SUP-HN-PCB', 'SUP-TPE-RES')
  and u.username = 'FIN_VN_001';

update products
set standard_unit_cost = 1.2500,
    cost_center_id = cc.id,
    profit_center_id = pc.id
from cost_centers cc
cross join profit_centers pc
where products.code = 'PCBA-AURORA-CTRL'
  and cc.code = 'CC-SMT-L1'
  and pc.code = 'PC-SMT';

update materials
set standard_unit_cost = case
      when materials.code = 'PCB-AURORA-CTRL' then 0.5000
      when materials.code = 'R-0603-10K-1' then 0.0200
      else standard_unit_cost
    end,
    inventory_account_id = ga.id,
    cogs_account_id = gc.id
from gl_accounts ga
cross join gl_accounts gc
where ga.code = '1100'
  and gc.code = '5000';

update work_orders
set cost_center_id = cc.id,
    profit_center_id = pc.id,
    standard_cost = 10500.0000,
    actual_cost = 10425.0000,
    cost_status = 'accumulating'
from cost_centers cc
cross join profit_centers pc
where work_orders.code = '26061010008'
  and cc.code = 'CC-SMT-L1'
  and pc.code = 'PC-SMT';

insert into customer_contacts (customer_id, contact_code, contact_name, title, email, phone, locale, is_primary, status)
select c.id, 'MAIN', 'Nguyen Thi Hoa', 'Purchasing Manager', 'hoa@example.com', '+84-900-111-222', 'vi-VN', true, 'active'
from customers c
where c.code = 'CUST-HANOI-01'
on conflict (customer_id, contact_code) do nothing;

insert into supplier_contacts (supplier_id, contact_code, contact_name, title, email, phone, locale, is_primary, status)
select s.id, 'MAIN', 'Tran Bao', 'Sales', 'supplier@example.com', '+84-900-333-444', 'vi-VN', true, 'active'
from suppliers s
where s.code = 'SUP-HN-PCB'
on conflict (supplier_id, contact_code) do nothing;

insert into inventory_cost_layers (layer_no, material_lot_id, inventory_transaction_id, source_type, source_no, source_line_no, quantity, remaining_quantity, unit_cost, currency_code, status)
select 'ICL-260616-PCB-0001', ml.id, it.id, 'receiving_order', ro.receipt_no, 1, 5000.0000, 5000.0000, 0.5000, 'USD', 'open'
from material_lots ml
join receiving_order_lines rol on rol.material_lot_id = ml.id
join receiving_orders ro on ro.id = rol.receiving_order_id
join inventory_transactions it on it.reference_no = ro.receipt_no and it.material_lot_id = ml.id and it.action = 'RECEIVE'
where ml.lot_no = 'LOT-260616-PCB-0001'
on conflict (layer_no) do nothing;

insert into inventory_cost_layers (layer_no, material_lot_id, inventory_transaction_id, source_type, source_no, source_line_no, quantity, remaining_quantity, unit_cost, currency_code, status)
select 'ICL-260616-RES-0001', ml.id, it.id, 'receiving_order', ro.receipt_no, 1, 40000.0000, 40000.0000, 0.0200, 'USD', 'open'
from material_lots ml
join receiving_order_lines rol on rol.material_lot_id = ml.id
join receiving_orders ro on ro.id = rol.receiving_order_id
join inventory_transactions it on it.reference_no = ro.receipt_no and it.material_lot_id = ml.id and it.action = 'RECEIVE'
where ml.lot_no = 'LOT-260616-RES-0001'
on conflict (layer_no) do nothing;

insert into shipments (shipment_no, customer_id, customer_po_id, ship_date, ship_to_name, ship_to_address, carrier_name, tracking_no, status, posting_status, created_by, posted_by, posted_at)
select 'SHP-260616-0001', c.id, po.id, date '2026-06-16', 'Hanoi Customer 01', 'Hanoi delivery point', 'VN Post', 'TRK-260616-0001', 'shipped', 'posted', u.id, u.id, timestamptz '2026-06-16 15:10:00+08'
from customers c
join customer_pos po on po.customer_id = c.id
cross join users u
where c.code = 'CUST-HANOI-01'
  and po.po_number = 'RJ-VN-PO-240611'
  and u.username = 'FIN_VN_001'
on conflict (shipment_no) do nothing;

insert into shipment_lines (shipment_id, line_no, customer_po_line_id, work_order_id, product_id, shipped_qty)
select sh.id, 1, pol.id, wo.id, wo.product_id, 8420.0000
from shipments sh
join customer_pos po on po.id = sh.customer_po_id
join customer_po_lines pol on pol.customer_po_id = po.id
join work_orders wo on wo.customer_po_id = po.id
where sh.shipment_no = 'SHP-260616-0001'
  and po.po_number = 'RJ-VN-PO-240611'
on conflict (shipment_id, line_no) do nothing;

insert into gl_journal_entries (entry_no, source_type, source_no, entry_type, period_id, posting_date, currency_code, exchange_rate, memo, status, created_by, posted_by, posted_at)
select 'GL-260616-0001', 'ap_invoice', 'AP-260616-0001', 'supplier_invoice', fp.id, date '2026-06-16', 'USD', 1.00000000, 'Supplier invoice posting for receiving lot', 'posted', u.id, u.id, timestamptz '2026-06-16 10:30:00+08'
from fiscal_periods fp
cross join users u
where fp.period_code = 'FY2026-06'
  and u.username = 'FIN_VN_001'
on conflict (source_type, source_no, entry_type) do nothing;

insert into gl_journal_entries (entry_no, source_type, source_no, entry_type, period_id, posting_date, currency_code, exchange_rate, memo, status, created_by, posted_by, posted_at)
select 'GL-260616-0002', 'ar_invoice', 'AR-260616-0001', 'customer_invoice', fp.id, date '2026-06-16', 'USD', 1.00000000, 'Customer invoice posting for shipment', 'posted', u.id, u.id, timestamptz '2026-06-16 15:20:00+08'
from fiscal_periods fp
cross join users u
where fp.period_code = 'FY2026-06'
  and u.username = 'FIN_VN_001'
on conflict (source_type, source_no, entry_type) do nothing;

insert into gl_journal_entries (entry_no, source_type, source_no, entry_type, period_id, posting_date, currency_code, exchange_rate, memo, status, created_by, posted_by, posted_at)
select 'GL-260616-0003', 'work_order_cost', wo.code, 'work_order_close', fp.id, date '2026-06-16', 'USD', 1.00000000, 'Work order cost accumulation', 'posted', u.id, u.id, timestamptz '2026-06-16 16:00:00+08'
from work_orders wo
join fiscal_periods fp on fp.period_code = 'FY2026-06'
cross join users u
where wo.code = '26061010008'
  and u.username = 'FIN_VN_001'
on conflict (source_type, source_no, entry_type) do nothing;

insert into gl_journal_lines (entry_id, line_no, account_id, cost_center_id, profit_center_id, description, debit_amount, credit_amount, foreign_amount)
select ge.id, 1, ga.id, cc.id, pc.id, 'Inventory received from supplier', 2500.0000, 0, 2500.0000
from gl_journal_entries ge
join gl_accounts ga on ga.code = '1100'
cross join cost_centers cc
cross join profit_centers pc
where ge.entry_no = 'GL-260616-0001'
  and cc.code = 'CC-WH-RAW'
  and pc.code = 'PC-SMT'
on conflict (entry_id, line_no) do nothing;

insert into gl_journal_lines (entry_id, line_no, account_id, cost_center_id, profit_center_id, description, debit_amount, credit_amount, foreign_amount)
select ge.id, 2, ga.id, cc.id, pc.id, 'Accounts payable recognition', 0, 2500.0000, 2500.0000
from gl_journal_entries ge
join gl_accounts ga on ga.code = '2000'
cross join cost_centers cc
cross join profit_centers pc
where ge.entry_no = 'GL-260616-0001'
  and cc.code = 'CC-FIN'
  and pc.code = 'PC-VN-PLANT1'
on conflict (entry_id, line_no) do nothing;

insert into ap_invoices (invoice_no, supplier_id, receiving_order_id, period_id, invoice_date, due_date, currency_code, subtotal_amount, tax_amount, total_amount, paid_amount, outstanding_amount, posting_status, payment_status, posted_entry_id, posted_at, created_by)
select 'AP-260616-0001', s.id, ro.id, fp.id, date '2026-06-16', date '2026-07-16', 'USD', 2500.0000, 250.0000, 2750.0000, 0, 2750.0000, 'posted', 'unpaid', ge.id, timestamptz '2026-06-16 10:30:00+08', u.id
from suppliers s
join receiving_orders ro on ro.receipt_no = 'REC-260616-0001'
join fiscal_periods fp on fp.period_code = 'FY2026-06'
join gl_journal_entries ge on ge.entry_no = 'GL-260616-0001'
cross join users u
where s.code = 'SUP-HN-PCB'
  and u.username = 'FIN_VN_001'
on conflict (invoice_no) do nothing;

insert into ap_invoice_lines (ap_invoice_id, line_no, receiving_order_line_id, material_id, description, quantity, unit_price, tax_code_id, line_amount)
select ap.id, 1, rol.id, ml.material_id, 'Incoming PCB lot invoice', 5000.0000, 0.5000, tc.id, 2500.0000
from ap_invoices ap
join receiving_orders ro on ro.id = ap.receiving_order_id
join receiving_order_lines rol on rol.receiving_order_id = ro.id
join material_lots ml on ml.id = rol.material_lot_id
join tax_codes tc on tc.code = 'VAT10'
where ap.invoice_no = 'AP-260616-0001'
on conflict (ap_invoice_id, line_no) do nothing;

insert into gl_journal_lines (entry_id, line_no, account_id, cost_center_id, profit_center_id, customer_id, description, debit_amount, credit_amount, foreign_amount)
select ge.id, 1, ga.id, cc.id, pc.id, sh.customer_id, 'Accounts receivable recognition', 11577.5000, 0, 11577.5000
from gl_journal_entries ge
join gl_accounts ga on ga.code = '1400'
join shipments sh on sh.shipment_no = 'SHP-260616-0001'
cross join cost_centers cc
cross join profit_centers pc
where ge.entry_no = 'GL-260616-0002'
  and cc.code = 'CC-FIN'
  and pc.code = 'PC-VN-PLANT1'
on conflict (entry_id, line_no) do nothing;

insert into gl_journal_lines (entry_id, line_no, account_id, cost_center_id, profit_center_id, customer_id, description, debit_amount, credit_amount, foreign_amount)
select ge.id, 2, ga.id, cc.id, pc.id, sh.customer_id, 'Sales revenue', 0, 10525.0000, 10525.0000
from gl_journal_entries ge
join gl_accounts ga on ga.code = '4000'
join shipments sh on sh.shipment_no = 'SHP-260616-0001'
cross join cost_centers cc
cross join profit_centers pc
where ge.entry_no = 'GL-260616-0002'
  and cc.code = 'CC-FIN'
  and pc.code = 'PC-VN-PLANT1'
on conflict (entry_id, line_no) do nothing;

insert into gl_journal_lines (entry_id, line_no, account_id, cost_center_id, profit_center_id, customer_id, tax_code_id, description, debit_amount, credit_amount, foreign_amount)
select ge.id, 3, ga.id, cc.id, pc.id, sh.customer_id, tc.id, 'VAT payable', 0, 1052.5000, 1052.5000
from gl_journal_entries ge
join gl_accounts ga on ga.code = '2100'
join shipments sh on sh.shipment_no = 'SHP-260616-0001'
join tax_codes tc on tc.code = 'VAT10'
cross join cost_centers cc
cross join profit_centers pc
where ge.entry_no = 'GL-260616-0002'
  and cc.code = 'CC-FIN'
  and pc.code = 'PC-VN-PLANT1'
on conflict (entry_id, line_no) do nothing;

insert into ar_invoices (invoice_no, customer_id, customer_po_id, shipment_id, period_id, invoice_date, due_date, currency_code, subtotal_amount, tax_amount, total_amount, paid_amount, outstanding_amount, posting_status, payment_status, posted_entry_id, posted_at, created_by)
select 'AR-260616-0001', c.id, po.id, sh.id, fp.id, date '2026-06-16', date '2026-07-16', 'USD', 10525.0000, 1052.5000, 11577.5000, 0, 11577.5000, 'posted', 'unpaid', ge.id, timestamptz '2026-06-16 15:20:00+08', u.id
from customers c
join customer_pos po on po.customer_id = c.id and po.po_number = 'RJ-VN-PO-240611'
join shipments sh on sh.customer_po_id = po.id
join fiscal_periods fp on fp.period_code = 'FY2026-06'
join gl_journal_entries ge on ge.entry_no = 'GL-260616-0002'
cross join users u
where c.code = 'CUST-HANOI-01'
  and u.username = 'FIN_VN_001'
on conflict (invoice_no) do nothing;

insert into ar_invoice_lines (ar_invoice_id, line_no, shipment_line_id, product_id, work_order_id, description, quantity, unit_price, tax_code_id, line_amount)
select ar.id, 1, sl.id, sl.product_id, sl.work_order_id, 'Customer shipment invoice', sl.shipped_qty, 1.2500, tc.id, 10525.0000
from ar_invoices ar
join shipments sh on sh.id = ar.shipment_id
join shipment_lines sl on sl.shipment_id = sh.id
join tax_codes tc on tc.code = 'VAT10'
where ar.invoice_no = 'AR-260616-0001'
on conflict (ar_invoice_id, line_no) do nothing;

insert into gl_journal_lines (entry_id, line_no, account_id, cost_center_id, profit_center_id, work_order_id, description, debit_amount, credit_amount, foreign_amount)
select ge.id, 1, ga.id, cc.id, pc.id, wo.id, 'WIP material and labor accumulation', 10500.0000, 0, 10500.0000
from gl_journal_entries ge
join gl_accounts ga on ga.code = '1200'
join work_orders wo on wo.code = '26061010008'
cross join cost_centers cc
cross join profit_centers pc
where ge.entry_no = 'GL-260616-0003'
  and cc.code = 'CC-SMT-L1'
  and pc.code = 'PC-SMT'
on conflict (entry_id, line_no) do nothing;

insert into gl_journal_lines (entry_id, line_no, account_id, cost_center_id, profit_center_id, work_order_id, description, debit_amount, credit_amount, foreign_amount)
select ge.id, 2, ga.id, cc.id, pc.id, wo.id, 'Material consumption', 0, 9500.0000, 9500.0000
from gl_journal_entries ge
join gl_accounts ga on ga.code = '5000'
join work_orders wo on wo.code = '26061010008'
cross join cost_centers cc
cross join profit_centers pc
where ge.entry_no = 'GL-260616-0003'
  and cc.code = 'CC-SMT-L1'
  and pc.code = 'PC-SMT'
on conflict (entry_id, line_no) do nothing;

insert into gl_journal_lines (entry_id, line_no, account_id, cost_center_id, profit_center_id, work_order_id, description, debit_amount, credit_amount, foreign_amount)
select ge.id, 3, ga.id, cc.id, pc.id, wo.id, 'Direct labor', 0, 700.0000, 700.0000
from gl_journal_entries ge
join gl_accounts ga on ga.code = '5100'
join work_orders wo on wo.code = '26061010008'
cross join cost_centers cc
cross join profit_centers pc
where ge.entry_no = 'GL-260616-0003'
  and cc.code = 'CC-SMT-L1'
  and pc.code = 'PC-SMT'
on conflict (entry_id, line_no) do nothing;

insert into gl_journal_lines (entry_id, line_no, account_id, cost_center_id, profit_center_id, work_order_id, description, debit_amount, credit_amount, foreign_amount)
select ge.id, 4, ga.id, cc.id, pc.id, wo.id, 'Manufacturing overhead', 0, 300.0000, 300.0000
from gl_journal_entries ge
join gl_accounts ga on ga.code = '5200'
join work_orders wo on wo.code = '26061010008'
cross join cost_centers cc
cross join profit_centers pc
where ge.entry_no = 'GL-260616-0003'
  and cc.code = 'CC-SMT-L1'
  and pc.code = 'PC-SMT'
on conflict (entry_id, line_no) do nothing;

insert into work_order_cost_summaries (work_order_id, currency_code, standard_material_cost, standard_labor_cost, standard_overhead_cost, actual_material_cost, actual_labor_cost, actual_overhead_cost, scrap_cost, total_standard_cost, total_actual_cost, cost_status, last_posted_entry_id)
select wo.id, 'USD', 9500.0000, 700.0000, 300.0000, 9300.0000, 650.0000, 475.0000, 0, 10500.0000, 10425.0000, 'posted', ge.id
from work_orders wo
join gl_journal_entries ge on ge.entry_no = 'GL-260616-0003'
where wo.code = '26061010008'
on conflict (work_order_id) do nothing;
