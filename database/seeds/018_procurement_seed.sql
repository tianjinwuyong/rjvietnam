-- ============================================================
-- Procurement Management Seed Data
-- Demo data for purchase requisitions, RFQs, quotes, POs, contracts
-- ============================================================

-- ── Suppliers ─────────────────────────────────────────────────────────────────
-- currencies: VND, USD, CNY (from currencies table)

insert into suppliers (id, code, name_zh, name_en, name_vi, status, short_name, contact_name, contact_phone, default_currency_code, payment_terms_days)
values
  (200, 'SUPPLIER_001', '华强电子', 'Huaqiang Electronics', 'Huaqiang Điện tử', 'active', '华强', 'Zhang Hua', '+86-755-12345678', 'CNY', 30),
  (201, 'SUPPLIER_002', '越南精密电子', 'VN Precision Electronics', 'VN Precision Điện tử', 'active', 'VNPE', 'Tran Van B', '+84-28-87654321', 'USD', 45),
  (202, 'SUPPLIER_003', '昭和物资', 'Showa Materials', 'Showa Materials', 'active', '昭和', 'Yamamoto Taro', '+81-3-12345678', 'CNY', 30),
  (203, 'SUPPLIER_004', '信越南责任有限公司', 'Xin Viet Co., Ltd', 'Xin Việt TNHH', 'active', 'XinViet', 'Nguyen Van D', '+84-24-98765432', 'USD', 30)
on conflict (code) do update set
  name_zh=EXCLUDED.name_zh, name_en=EXCLUDED.name_en, name_vi=EXCLUDED.name_vi,
  short_name=EXCLUDED.short_name, contact_name=EXCLUDED.contact_name,
  contact_phone=EXCLUDED.contact_phone, default_currency_code=EXCLUDED.default_currency_code,
  payment_terms_days=EXCLUDED.payment_terms_days;

-- ── Materials / Parts ────────────────────────────────────────────────────────

insert into materials (id, code, name_zh, name_en, name_vi, uom, material_type, specification, status, iqc_required, standard_unit_cost)
values
  (5001, 'MAT-01001', '贴片电容 100nF', 'SMD Capacitor 100nF', 'Tụ gắn SMD 100nF', 'PCS', 'Capacitor', '0603 100nF 50V X7R', 'active', true, 0.048),
  (5002, 'MAT-01002', '贴片电阻 10K', 'SMD Resistor 10K', 'Điện trở SMD 10K', 'PCS', 'Resistor', '0603 10KΩ 1%', 'active', true, 0.002),
  (5003, 'MAT-02001', 'IC STM32F103C8T6', 'MCU STM32F103C8T6', 'IC STM32F103C8T6', 'PCS', 'Integrated Circuit', 'ARM Cortex-M3 LQFP-48', 'active', true, 165.00),
  (5004, 'MAT-03001', 'PCB 双面板 100x80mm', 'PCB Double Layer 100x80mm', 'PCB 2 lớp 100x80mm', 'PCS', 'PCB', '2层 1.6mm HASL', 'active', true, 25.00),
  (5005, 'MAT-04001', 'Type-C 连接器 24PIN', 'USB Type-C 24PIN Connector', 'Jack USB Type-C 24PIN', 'PCS', 'Connector', '24PIN SMD 0.8mm', 'active', true, 1.50),
  (5006, 'MAT-05001', 'LED 0805 绿色', 'LED 0805 Green', 'LED 0805 Xanh', 'PCS', 'Optoelectronic', '0805 Green 2.1V 20mA', 'active', true, 0.05)
on conflict (code) do update set
  name_zh=EXCLUDED.name_zh, name_en=EXCLUDED.name_en, name_vi=EXCLUDED.name_vi,
  uom=EXCLUDED.uom, material_type=EXCLUDED.material_type, specification=EXCLUDED.specification,
  status=EXCLUDED.status, iqc_required=EXCLUDED.iqc_required, standard_unit_cost=EXCLUDED.standard_unit_cost;

-- ── Users (buyers) ──────────────────────────────────────────────────────────

insert into users (username, display_name, role_id, locale)
select 'BUYER_001', 'Li Ming', id, 'zh-CN' from roles where code = 'pmc'
on conflict (username) do nothing;

insert into users (username, display_name, role_id, locale)
select 'BUYER_002', 'Nguyen Thi E', id, 'vi-VN' from roles where code = 'pmc'
on conflict (username) do nothing;

-- ── Purchase Requisitions ────────────────────────────────────────────────────
-- status: draft|submitted|quoted|po_created|partially_received|closed|cancelled

insert into purchase_requisitions (requisition_no, requester_id, department, reason, urgency, target_date, status, created_at)
select 'PR-2026-0001', u.id, 'SMT', 'SMT产线日常物料补充', 'normal', '2026-06-25', 'submitted', '2026-06-10 08:00:00+07'
from users u where u.username = 'PMC_CN_01'
on conflict (requisition_no) do nothing;

insert into purchase_requisition_lines (requisition_id, line_no, material_id, material_code, material_name_zh, qty_requested, unit, target_unit_cost, notes)
select r.id, 1, m.id, m.code, m.name_zh, 5000, 'PCS', 0.05, 'SMT产线使用'
from purchase_requisitions r, materials m
where r.requisition_no = 'PR-2026-0001' and m.code = 'MAT-01001'
on conflict do nothing;

insert into purchase_requisition_lines (requisition_id, line_no, material_id, material_code, material_name_zh, qty_requested, unit, target_unit_cost, notes)
select r.id, 2, m.id, m.code, m.name_zh, 10000, 'PCS', 0.002, 'SMT产线使用'
from purchase_requisitions r, materials m
where r.requisition_no = 'PR-2026-0001' and m.code = 'MAT-01002'
on conflict do nothing;

-- Urgent PR
insert into purchase_requisitions (requisition_no, requester_id, department, reason, urgency, target_date, status, created_at)
select 'PR-2026-0002', u.id, 'SMT', '紧急缺料：IC库存告急', 'urgent', '2026-06-28', 'submitted', '2026-06-20 09:00:00+07'
from users u where u.username = 'BUYER_002'
on conflict (requisition_no) do nothing;

insert into purchase_requisition_lines (requisition_id, line_no, material_id, material_code, material_name_zh, qty_requested, unit, target_unit_cost, notes)
select r.id, 1, m.id, m.code, m.name_zh, 500, 'PCS', 12.00, '紧急'
from purchase_requisitions r, materials m
where r.requisition_no = 'PR-2026-0002' and m.code = 'MAT-02001'
on conflict do nothing;

-- ── RFQ Headers & Lines ──────────────────────────────────────────────────────
-- status: draft|sent|quotes_received|comparing|awarded|cancelled
-- rfq_headers.requisition_id FK → purchase_requisitions(id) — must link to PR

insert into rfq_headers (rfq_no, requisition_id, title, description, priority, response_deadline, requested_by, department, status, notes, created_at)
select 'RFQ-2026-0001', r.id, 'SMT常用物料询价 2026Q3', '针对常用物料的季度询价', 'normal', '2026-06-30 17:00:00+07', u.id, 'PMC', 'quotes_received', '含税含运费到厂价', '2026-06-12 08:00:00+07'
from purchase_requisitions r, users u
where r.requisition_no = 'PR-2026-0001' and u.username = 'BUYER_001'
on conflict (rfq_no) do nothing;

insert into rfq_lines (rfq_header_id, line_no, material_id, material_code, material_name_zh, qty_requested, unit, target_unit_price, delivery_date, notes)
select h.id, 1, m.id, m.code, m.name_zh, 5000, 'PCS', 0.05, '2026-07-15', '含税含运费到厂价'
from rfq_headers h, materials m
where h.rfq_no = 'RFQ-2026-0001' and m.code = 'MAT-01001'
on conflict do nothing;

insert into rfq_lines (rfq_header_id, line_no, material_id, material_code, material_name_zh, qty_requested, unit, target_unit_price, delivery_date, notes)
select h.id, 2, m.id, m.code, m.name_zh, 10000, 'PCS', 0.002, '2026-07-15', '含税含运费到厂价'
from rfq_headers h, materials m
where h.rfq_no = 'RFQ-2026-0001' and m.code = 'MAT-01002'
on conflict do nothing;

insert into rfq_lines (rfq_header_id, line_no, material_id, material_code, material_name_zh, qty_requested, unit, target_unit_price, delivery_date, notes)
select h.id, 3, m.id, m.code, m.name_zh, 500, 'PCS', 12.00, '2026-07-20', '原装正品'
from rfq_headers h, materials m
where h.rfq_no = 'RFQ-2026-0001' and m.code = 'MAT-02001'
on conflict do nothing;

-- ── Supplier Quote Headers (per RFQ, winner first) ───────────────────────────
-- status: draft|submitted|accepted|rejected|expired|superseded

insert into supplier_quote_headers (rfq_header_id, supplier_id, quote_no, currency_code, valid_until, lead_time_days, payment_terms, delivery_terms, total_amount, grand_total, notes, status, is_winner, rank_position, submitted_at, created_by)
select h.id, s.id, 'HQ-2026-Q1-001', 'CNY', '2026-07-15', 7, 'NET30', 'DDP', 440.00, 440.00, '含税', 'submitted', true, 1, '2026-06-15 10:00:00+07', u.id
from rfq_headers h, suppliers s, users u
where h.rfq_no = 'RFQ-2026-0001' and s.code = 'SUPPLIER_001' and u.username = 'BUYER_001'
on conflict do nothing;

insert into supplier_quote_headers (rfq_header_id, supplier_id, quote_no, currency_code, valid_until, lead_time_days, payment_terms, delivery_terms, total_amount, grand_total, notes, status, is_winner, rank_position, submitted_at, created_by)
select h.id, s.id, 'VNP-2026-001', 'USD', '2026-07-10', 10, 'NET45', 'FOB HCM', 70.00, 70.00, 'FOB报价', 'submitted', false, 2, '2026-06-16 14:00:00+07', u.id
from rfq_headers h, suppliers s, users u
where h.rfq_no = 'RFQ-2026-0001' and s.code = 'SUPPLIER_002' and u.username = 'BUYER_001'
on conflict do nothing;

-- Award RFQ to Huaqiang
update rfq_headers set status = 'awarded', awarded_supplier_id = (select id from suppliers where code = 'SUPPLIER_001')
where rfq_no = 'RFQ-2026-0001';

-- ── Quote Comparisons ─────────────────────────────────────────────────────────
-- quote_comparisons columns: rfq_header_id, supplier_id, total_amount, lead_time_days,
--   payment_terms, delivery_terms, quality_score, price_score, overall_score,
--   rank_position, recommendation, rationale, evaluated_at, evaluated_by

insert into quote_comparisons (rfq_header_id, supplier_id, total_amount, lead_time_days, payment_terms, delivery_terms, quality_score, price_score, overall_score, rank_position, recommendation, rationale, evaluated_at, evaluated_by)
select h.id, s.id,
  case s.code when 'SUPPLIER_001' then 440.00 when 'SUPPLIER_002' then 70.00 else 0 end,
  case s.code when 'SUPPLIER_001' then 7 when 'SUPPLIER_002' then 10 else 0 end,
  case s.code when 'SUPPLIER_001' then 'NET30' when 'SUPPLIER_002' then 'NET45' else '' end,
  case s.code when 'SUPPLIER_001' then 'DDP' when 'SUPPLIER_002' then 'FOB HCM' else '' end,
  case s.code when 'SUPPLIER_001' then 0.90 when 'SUPPLIER_002' then 0.85 else 0.80 end,
  case s.code when 'SUPPLIER_001' then 0.95 when 'SUPPLIER_002' then 0.92 else 0.85 end,
  case s.code when 'SUPPLIER_001' then 0.94 when 'SUPPLIER_002' then 0.87 else 0.82 end,
  case s.code when 'SUPPLIER_001' then 1 when 'SUPPLIER_002' then 2 else 0 end,
  case s.code when 'SUPPLIER_001' then 'award' else 'reject' end,
  case s.code when 'SUPPLIER_001' then '综合最优：价格低，交期快' else '价格偏高' end,
  '2026-06-18 16:00:00+07', u.id
from rfq_headers h, suppliers s, users u
where h.rfq_no = 'RFQ-2026-0001' and u.username = 'BUYER_001'
  and s.code in ('SUPPLIER_001', 'SUPPLIER_002')
on conflict do nothing;

-- ── Purchase Orders ─────────────────────────────────────────────────────────
-- status: draft|sent|acknowledged|partially_received|received|closed|cancelled

insert into purchase_order_headers (po_no, requisition_id, supplier_id, order_date, promised_date, currency_code, exchange_rate, status, payment_terms, delivery_terms, notes, created_at, created_by)
select 'PO-2026-0001', r.id, s.id, '2026-06-18', '2026-06-28', 'CNY', 1.0, 'sent', 'NET30', 'DDP 到厂', '根据RFQ-2026-0001', '2026-06-18 09:00:00+07', u.id
from purchase_requisitions r, suppliers s, users u
where r.requisition_no = 'PR-2026-0001' and s.code = 'SUPPLIER_001' and u.username = 'BUYER_001'
on conflict (po_no) do nothing;

insert into purchase_order_lines (po_header_id, line_no, requisition_line_id, material_id, material_code, description, qty_ordered, qty_received, unit, unit_price, line_total, promised_date, status)
select h.id, 1, rl.id, m.id, m.code, '贴片电容 100nF', 5000, 0, 'PCS', 0.048, 240.00, '2026-06-28', 'pending'
from purchase_order_headers h, materials m, purchase_requisition_lines rl
join purchase_requisitions r on r.id = rl.requisition_id
where h.po_no = 'PO-2026-0001' and m.code = 'MAT-01001' and r.requisition_no = 'PR-2026-0001' and rl.line_no = 1
on conflict do nothing;

insert into purchase_order_lines (po_header_id, line_no, requisition_line_id, material_id, material_code, description, qty_ordered, qty_received, unit, unit_price, line_total, promised_date, status)
select h.id, 2, rl.id, m.id, m.code, '贴片电阻 10K', 10000, 0, 'PCS', 0.002, 20.00, '2026-06-28', 'pending'
from purchase_order_headers h, materials m, purchase_requisition_lines rl
join purchase_requisitions r on r.id = rl.requisition_id
where h.po_no = 'PO-2026-0001' and m.code = 'MAT-01002' and r.requisition_no = 'PR-2026-0001' and rl.line_no = 2
on conflict do nothing;

-- Second PO (partially received)
insert into purchase_order_headers (po_no, requisition_id, supplier_id, order_date, promised_date, currency_code, exchange_rate, status, payment_terms, delivery_terms, notes, created_at, created_by)
select 'PO-2026-0002', r.id, s.id, '2026-06-10', '2026-06-25', 'USD', 23500.0, 'partially_received', 'NET45', 'FOB HCM', 'IC备货', '2026-06-10 09:00:00+07', u.id
from purchase_requisitions r, suppliers s, users u
where r.requisition_no = 'PR-2026-0002' and s.code = 'SUPPLIER_002' and u.username = 'BUYER_002'
on conflict (po_no) do nothing;

insert into purchase_order_lines (po_header_id, line_no, requisition_line_id, material_id, material_code, description, qty_ordered, qty_received, unit, unit_price, line_total, promised_date, status)
select h.id, 1, rl.id, m.id, m.code, 'STM32F103C8T6', 500, 300, 'PCS', 165.00, 82500.00, '2026-06-25', 'partial'
from purchase_order_headers h, materials m, purchase_requisition_lines rl
join purchase_requisitions r on r.id = rl.requisition_id
where h.po_no = 'PO-2026-0002' and m.code = 'MAT-02001' and r.requisition_no = 'PR-2026-0002' and rl.line_no = 1
on conflict do nothing;

-- ── Procurement Contracts ───────────────────────────────────────────────────
-- status: draft|pending_approval|approved|rejected|active|expired|terminated|voided
-- contract_type: purchase|framework|rate_agreement|service|nda
-- No `notes` column in actual schema — use `rationale` or omit

insert into procurement_contracts (contract_no, po_header_id, supplier_id, contact_id, title, contract_type, total_value, currency_code, payment_terms, effective_date, expiry_date, status, rejection_reason, created_at, created_by)
select 'CT-2026-0001', h.id, s.id, null, '华强电子 2026年度框架协议', 'framework', 500000.00, 'CNY', 'NET30', '2026-06-01', '2027-05-31', 'approved', '年度框架协议，批量采购优惠', '2026-06-01 10:00:00+07', u.id
from suppliers s, purchase_order_headers h, users u
where s.code = 'SUPPLIER_001' and h.po_no = 'PO-2026-0001' and u.username = 'BUYER_001'
on conflict (contract_no) do nothing;

-- Contract approval tasks
insert into contract_approval_history (contract_id, step, approver_role, approver_id, action, notes, acted_at)
select c.id, 1, 'PMC主管', u.id, 'approved', '同意，价格合理', '2026-06-20 10:00:00+07'
from procurement_contracts c, users u
where c.contract_no = 'CT-2026-0001' and u.username = 'PMC_CN_01'
on conflict do nothing;

insert into contract_approval_tasks (contract_id, step, approver_role, approver_id, status, notes, decided_at)
select c.id, 1, 'PMC主管', u.id, 'approved', '同意，价格合理', '2026-06-20 10:00:00+07'
from procurement_contracts c, users u
where c.contract_no = 'CT-2026-0001' and u.username = 'PMC_CN_01'
on conflict do nothing;

-- ── Supplier Scorecards ─────────────────────────────────────────────────────
-- overall_score: 0-1 range (constraint CHECK (overall_score >= 0 AND overall_score <= 1))

insert into supplier_scorecards (supplier_id, period_start, period_end, on_time_delivery_rate, quality_accept_rate, price_competitiveness, complaint_count, return_rate, overall_score, grade, evaluated_by, evaluated_at, notes)
select s.id, '2026-01-01', '2026-03-31',
  case s.code when 'SUPPLIER_001' then 95.6 when 'SUPPLIER_002' then 73.3 when 'SUPPLIER_003' then 90.0 else 80.0 end,
  case s.code when 'SUPPLIER_001' then 92.0 when 'SUPPLIER_002' then 85.0 when 'SUPPLIER_003' then 98.0 else 80.0 end,
  case s.code when 'SUPPLIER_001' then 8.8 when 'SUPPLIER_002' then 9.2 when 'SUPPLIER_003' then 7.0 else 8.5 end,
  case s.code when 'SUPPLIER_001' then 1 when 'SUPPLIER_002' then 3 when 'SUPPLIER_003' then 0 else 1 end,
  case s.code when 'SUPPLIER_001' then 0.5 when 'SUPPLIER_002' then 2.1 when 'SUPPLIER_003' then 0.0 else 1.0 end,
  case s.code when 'SUPPLIER_001' then 0.91 when 'SUPPLIER_002' then 0.84 when 'SUPPLIER_003' then 0.87 else 0.83 end,
  case s.code when 'SUPPLIER_001' then 'A' when 'SUPPLIER_002' then 'B' when 'SUPPLIER_003' then 'A' else 'B' end,
  u.id, '2026-04-05 10:00:00+07', 'Q1综合评分'
from suppliers s, users u
where s.code in ('SUPPLIER_001', 'SUPPLIER_002', 'SUPPLIER_003') and u.username = 'PMC_CN_01'
on conflict do nothing;

insert into supplier_scorecards (supplier_id, period_start, period_end, on_time_delivery_rate, quality_accept_rate, price_competitiveness, complaint_count, return_rate, overall_score, grade, evaluated_by, evaluated_at, notes)
select s.id, '2026-04-01', '2026-06-30',
  case s.code when 'SUPPLIER_001' then 98.1 when 'SUPPLIER_002' then 81.6 when 'SUPPLIER_003' then 88.0 else 80.0 end,
  case s.code when 'SUPPLIER_001' then 95.0 when 'SUPPLIER_002' then 88.0 when 'SUPPLIER_003' then 97.0 else 82.0 end,
  case s.code when 'SUPPLIER_001' then 9.0 when 'SUPPLIER_002' then 9.4 when 'SUPPLIER_003' then 7.2 else 8.3 end,
  case s.code when 'SUPPLIER_001' then 0 when 'SUPPLIER_002' then 2 when 'SUPPLIER_003' then 1 else 2 end,
  case s.code when 'SUPPLIER_001' then 0.0 when 'SUPPLIER_002' then 1.5 when 'SUPPLIER_003' then 0.5 else 1.0 end,
  case s.code when 'SUPPLIER_001' then 0.94 when 'SUPPLIER_002' then 0.87 when 'SUPPLIER_003' then 0.88 else 0.81 end,
  case s.code when 'SUPPLIER_001' then 'A' when 'SUPPLIER_002' then 'B' when 'SUPPLIER_003' then 'A' else 'B' end,
  u.id, '2026-07-05 10:00:00+07', 'Q2综合评分'
from suppliers s, users u
where s.code in ('SUPPLIER_001', 'SUPPLIER_002', 'SUPPLIER_003') and u.username = 'PMC_CN_01'
on conflict do nothing;

-- ── Price History ────────────────────────────────────────────────────────────

insert into price_history (material_id, material_code, supplier_id, currency_code, unit_price, qty_min, qty_max, effective_from, effective_to, source_doc)
select m.id, m.code, s.id, 'CNY',
  case m.code when 'MAT-01001' then 0.048 when 'MAT-01002' then 0.002 when 'MAT-02001' then 165.00 else 0.0 end,
  1, 99999,
  '2026-01-01', '2026-06-30',
  case m.code when 'MAT-01001' then 'HQ-Q1-2026' when 'MAT-01002' then 'HQ-Q1-2026' when 'MAT-02001' then 'VNP-2026-001' else null end
from materials m, suppliers s
where m.code in ('MAT-01001', 'MAT-01002', 'MAT-02001')
  and s.code = 'SUPPLIER_001'
on conflict do nothing;
