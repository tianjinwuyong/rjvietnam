insert into permissions (code, name_zh, name_en, name_vi, module)
values
('admin.audit.read', 'Audit log read', 'Audit log read', 'Xem audit log', 'admin'),
('admin.audit.write', 'Audit log write', 'Audit log write', 'Ghi audit log', 'admin'),
('master_data.read', 'Master data read', 'Master data read', 'Xem master data', 'admin'),
('wms.receive', 'Material receiving', 'Material receiving', 'Nhận vật tư', 'wms'),
('wms.iqc', 'Incoming inspection', 'Incoming inspection', 'IQC đầu vào', 'wms'),
('wms.pick', 'Pick materials', 'Pick materials', 'Lấy vật tư', 'wms'),
('wms.issue', 'Issue to line', 'Issue to line', 'Xuất line', 'wms'),
('wms.return', 'Return from line', 'Return from line', 'Trả từ line', 'wms'),
('mes.bind', 'Feeder binding', 'Feeder binding', 'Gán feeder', 'mes'),
('quality.inspect', 'Quality inspection', 'Quality inspection', 'Kiểm tra chất lượng', 'quality'),
('traceability.query', 'Traceability query', 'Traceability query', 'Truy xuất nguồn gốc', 'traceability'),
('ai.chat', 'AI chat', 'AI chat', 'Trò chuyện AI', 'ai'),
('ai.query', 'AI data query', 'AI data query', 'Truy vấn AI', 'ai'),
('ai.report', 'AI report generation', 'AI report generation', 'Báo cáo AI', 'ai')
ON CONFLICT (code) DO NOTHING;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'admin.audit.read',
  'admin.audit.write',
  'master_data.read',
  'traceability.query',
  'ai.chat',
  'ai.query',
  'ai.report'
)
where r.code = 'admin';

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
  'wms.receive',
  'wms.iqc',
  'wms.pick',
  'wms.issue',
  'wms.return',
  'traceability.query',
  'ai.chat',
  'ai.query'
)
where r.code = 'warehouse';

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('quality.inspect', 'traceability.query')
where r.code = 'quality';

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('mes.bind', 'traceability.query')
where r.code = 'smt_operator';

insert into process_routes (code, product_id, revision, status, created_by)
select 'PR-PCBA-AURORA-A1', p.id, 'A1', 'active', u.id
from products p
cross join users u
where p.code = 'PCBA-AURORA-CTRL'
  and u.username = 'PMC_CN_01';

update products
set default_route_id = pr.id
from process_routes pr
where products.code = 'PCBA-AURORA-CTRL'
  and pr.code = 'PR-PCBA-AURORA-A1';

insert into process_route_steps (route_id, step_no, station_type, station_id, required_scan, required_inspection, output_rule)
select pr.id, 10, 'SPI', null, true, true, 'pass_through'
from process_routes pr
where pr.code = 'PR-PCBA-AURORA-A1';

insert into process_route_steps (route_id, step_no, station_type, station_id, required_scan, required_inspection, output_rule)
select pr.id, 20, 'SMT', null, true, false, 'pass_through'
from process_routes pr
where pr.code = 'PR-PCBA-AURORA-A1';

insert into process_route_steps (route_id, step_no, station_type, station_id, required_scan, required_inspection, output_rule)
select pr.id, 30, 'AOI', s.id, true, true, 'pass_through'
from process_routes pr
join stations s on s.code = 'AOI-01'
where pr.code = 'PR-PCBA-AURORA-A1';

insert into process_route_steps (route_id, step_no, station_type, station_id, required_scan, required_inspection, output_rule)
select pr.id, 40, 'PACK', null, false, false, 'close_work_order'
from process_routes pr
where pr.code = 'PR-PCBA-AURORA-A1';

insert into customer_po_lines (customer_po_id, line_no, product_id, ordered_qty, promised_date, unit_price, status)
select po.id, 1, p.id, 24000, date '2026-06-24', 1.2500, 'open'
from customer_pos po
join products p on p.code = 'PCBA-AURORA-CTRL'
where po.po_number = 'RJ-VN-PO-240611'
ON CONFLICT (customer_po_id, line_no) DO NOTHING;

insert into defect_codes (code, name_zh, name_en, name_vi, severity, defect_category)
values
('AOI-OPEN', 'Open joint', 'Open joint', 'Lỗi hở mạch', 'major', 'solder'),
('REWORK-MISS', 'Missing component', 'Missing component', 'Thiếu linh kiện', 'major', 'assembly')
ON CONFLICT (code) DO NOTHING;

insert into storage_locations (code, area, name_zh, name_en, name_vi, status, location_type)
values
('RAW-01-01', 'RAW', 'Raw line 01 bin 01', 'Raw line 01 bin 01', 'Khu nguyên liệu 01-01', 'active', 'raw'),
('LINE-01-BUF', 'LINE', 'Line 01 buffer', 'Line 01 buffer', 'Khu đệm line 01', 'active', 'line_buffer'),
('HOLD-01-01', 'HOLD', 'Hold area 01', 'Hold area 01', 'Khu hold 01', 'active', 'hold')
ON CONFLICT (code) DO NOTHING;

insert into receiving_orders (receipt_no, supplier_id, document_no, status, received_at, operator_id)
select 'REC-260616-0001', s.id, 'ASN-260616-0001', 'received', timestamptz '2026-06-16 09:10:00+08', u.id
from suppliers s
cross join users u
where s.code = 'SUP-HN-PCB'
  and u.username = 'VN_WH_010'
ON CONFLICT (receipt_no) DO NOTHING;

insert into receiving_orders (receipt_no, supplier_id, document_no, status, received_at, operator_id)
select 'REC-260616-0002', s.id, 'ASN-260616-0002', 'received', timestamptz '2026-06-16 09:15:00+08', u.id
from suppliers s
cross join users u
where s.code = 'SUP-TPE-RES'
  and u.username = 'VN_WH_010'
ON CONFLICT (receipt_no) DO NOTHING;

insert into material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, received_at, received_by, storage_location_id, lot_status)
select m.id, s.id, v.lot_no, v.received_qty, 'pending', v.received_at, u.id, sl.id, 'open'
from (
  values
    ('PCB-AURORA-CTRL', 'SUP-HN-PCB', 'LOT-260616-PCB-0001', 5000.0000::numeric, timestamptz '2026-06-16 09:10:00+08'),
    ('R-0603-10K-1', 'SUP-TPE-RES', 'LOT-260616-RES-0001', 40000.0000::numeric, timestamptz '2026-06-16 09:15:00+08')
) as v(material_code, supplier_code, lot_no, received_qty, received_at)
join materials m on m.code = v.material_code
join suppliers s on s.code = v.supplier_code
cross join users u
cross join storage_locations sl
where u.username = 'VN_WH_010'
  and sl.code = 'RAW-01-01';

insert into receiving_order_lines (receiving_order_id, line_no, material_id, material_lot_id, lot_no, received_qty, to_location_id, status)
select ro.id, 1, m.id, ml.id, 'LOT-260616-PCB-0001', 5000.0000::numeric, sl.id, 'matched'
from receiving_orders ro
join materials m on m.code = 'PCB-AURORA-CTRL'
join material_lots ml on ml.lot_no = 'LOT-260616-PCB-0001'
cross join storage_locations sl
where ro.receipt_no = 'REC-260616-0001'
  and sl.code = 'RAW-01-01'
ON CONFLICT (receiving_order_id, line_no) DO NOTHING;

insert into receiving_order_lines (receiving_order_id, line_no, material_id, material_lot_id, lot_no, received_qty, to_location_id, status)
select ro.id, 1, m.id, ml.id, 'LOT-260616-RES-0001', 40000.0000::numeric, sl.id, 'matched'
from receiving_orders ro
join materials m on m.code = 'R-0603-10K-1'
join material_lots ml on ml.lot_no = 'LOT-260616-RES-0001'
cross join storage_locations sl
where ro.receipt_no = 'REC-260616-0002'
  and sl.code = 'RAW-01-01'
ON CONFLICT (receiving_order_id, line_no) DO NOTHING;

insert into iqc_inspections (inspection_no, receiving_order_line_id, material_lot_id, inspection_type, result, sampled_qty, inspected_qty, operator_id, occurred_at)
select 'IQC-260616-0001', rol.id, ml.id, 'incoming', 'pass', 10.0000, 10.0000, u.id, timestamptz '2026-06-16 10:00:00+08'
from receiving_order_lines rol
join material_lots ml on ml.id = rol.material_lot_id
cross join users u
where rol.receiving_order_id = (select id from receiving_orders where receipt_no = 'REC-260616-0001')
  and u.username = 'VN_WH_010'
ON CONFLICT (inspection_no) DO NOTHING;

insert into iqc_inspections (inspection_no, receiving_order_line_id, material_lot_id, defect_code_id, inspection_type, result, sampled_qty, inspected_qty, operator_id, occurred_at)
select 'IQC-260616-0002', rol.id, ml.id, d.id, 'incoming', 'pass', 10.0000, 10.0000, u.id, timestamptz '2026-06-16 10:05:00+08'
from receiving_order_lines rol
join material_lots ml on ml.id = rol.material_lot_id
join defect_codes d on d.code = 'AOI-OPEN'
cross join users u
where rol.receiving_order_id = (select id from receiving_orders where receipt_no = 'REC-260616-0002')
  and u.username = 'VN_WH_010'
ON CONFLICT (inspection_no) DO NOTHING;

update material_lots
set iqc_status = 'released',
    lot_status = 'open'
where lot_no in ('LOT-260616-PCB-0001', 'LOT-260616-RES-0001');

insert into inventory_transactions (tx_no, action, material_lot_id, qty, from_location_id, to_location_id, operator_id, occurred_at, reference_type, reference_no)
select v.tx_no, v.action, ml.id, v.qty, fl.id, tl.id, u.id, v.occurred_at, v.reference_type, v.reference_no
from (
  values
    ('TX-260616-0001', 'RECEIVE', 'LOT-260616-PCB-0001', 5000.0000::numeric, 'RAW-01-01', 'RAW-01-01', '2026-06-16 09:10:00+08'::timestamptz, 'receiving_order', 'REC-260616-0001'),
    ('TX-260616-0002', 'IQC_RELEASE', 'LOT-260616-PCB-0001', 5000.0000::numeric, 'RAW-01-01', 'RAW-01-01', '2026-06-16 10:00:00+08'::timestamptz, 'iqc_inspection', 'IQC-260616-0001'),
    ('TX-260616-0003', 'PUT_AWAY', 'LOT-260616-PCB-0001', 5000.0000::numeric, 'RAW-01-01', 'RAW-01-01', '2026-06-16 10:15:00+08'::timestamptz, 'receiving_order', 'REC-260616-0001'),
    ('TX-260616-0004', 'RECEIVE', 'LOT-260616-RES-0001', 40000.0000::numeric, 'RAW-01-01', 'RAW-01-01', '2026-06-16 09:15:00+08'::timestamptz, 'receiving_order', 'REC-260616-0002'),
    ('TX-260616-0005', 'IQC_RELEASE', 'LOT-260616-RES-0001', 40000.0000::numeric, 'RAW-01-01', 'RAW-01-01', '2026-06-16 10:05:00+08'::timestamptz, 'iqc_inspection', 'IQC-260616-0002'),
    ('TX-260616-0006', 'PUT_AWAY', 'LOT-260616-RES-0001', 40000.0000::numeric, 'RAW-01-01', 'RAW-01-01', '2026-06-16 10:16:00+08'::timestamptz, 'receiving_order', 'REC-260616-0002')
) as v(tx_no, action, lot_no, qty, from_location_code, to_location_code, occurred_at, reference_type, reference_no)
join material_lots ml on ml.lot_no = v.lot_no
join storage_locations fl on fl.code = v.from_location_code
join storage_locations tl on tl.code = v.to_location_code
cross join users u
where u.username = 'VN_WH_010'
  and not exists (select 1 from inventory_transactions it where it.tx_no = v.tx_no);

insert into pick_orders (pick_no, work_order_id, source_location_id, status, required_qty, picked_qty, operator_id, created_at, updated_at)
select 'PICK-260616-0001', wo.id, sl.id, 'released', 600.0000, 600.0000, u.id, timestamptz '2026-06-16 10:30:00+08', timestamptz '2026-06-16 10:30:00+08'
from work_orders wo
cross join storage_locations sl
cross join users u
where wo.code = '26061010008'
  and sl.code = 'RAW-01-01'
  and u.username = 'VN_WH_010'
ON CONFLICT (pick_no) DO NOTHING;

insert into pick_order_lines (pick_order_id, line_no, material_lot_id, requested_qty, picked_qty)
select po.id, v.line_no, ml.id, v.requested_qty, v.picked_qty
from pick_orders po
join (
  values
    (1, 'LOT-260616-PCB-0001', 500.0000::numeric, 500.0000::numeric),
    (2, 'LOT-260616-RES-0001', 100.0000::numeric, 100.0000::numeric)
) as v(line_no, lot_no, requested_qty, picked_qty)
  on true
join material_lots ml on ml.lot_no = v.lot_no
where po.pick_no = 'PICK-260616-0001';

insert into line_issue_orders (issue_no, work_order_id, line_id, source_location_id, target_location_id, status, issued_qty, operator_id, created_at, updated_at)
select 'ISSUE-260616-0001', wo.id, l.id, src.id, dst.id, 'issued', 600.0000, u.id, timestamptz '2026-06-16 10:45:00+08', timestamptz '2026-06-16 10:45:00+08'
from work_orders wo
join production_lines l on l.id = wo.line_id
cross join storage_locations src
cross join storage_locations dst
cross join users u
where wo.code = '26061010008'
  and src.code = 'RAW-01-01'
  and dst.code = 'LINE-01-BUF'
  and u.username = 'VN_WH_010'
ON CONFLICT (issue_no) DO NOTHING;

insert into line_issue_order_lines (line_issue_order_id, line_no, material_lot_id, issued_qty)
select lio.id, v.line_no, ml.id, v.issued_qty
from line_issue_orders lio
join (
  values
    (1, 'LOT-260616-PCB-0001', 500.0000::numeric),
    (2, 'LOT-260616-RES-0001', 100.0000::numeric)
) as v(line_no, lot_no, issued_qty)
  on true
join material_lots ml on ml.lot_no = v.lot_no
where lio.issue_no = 'ISSUE-260616-0001';

insert into line_return_orders (return_no, work_order_id, line_id, from_location_id, to_location_id, status, returned_qty, reason_code, operator_id, created_at, updated_at)
select 'RET-260616-0001', wo.id, l.id, src.id, dst.id, 'received', 25.0000, 'LEFTOVER', u.id, timestamptz '2026-06-16 14:20:00+08', timestamptz '2026-06-16 14:20:00+08'
from work_orders wo
join production_lines l on l.id = wo.line_id
cross join storage_locations src
cross join storage_locations dst
cross join users u
where wo.code = '26061010008'
  and src.code = 'LINE-01-BUF'
  and dst.code = 'RAW-01-01'
  and u.username = 'VN_WH_010'
ON CONFLICT (return_no) DO NOTHING;

insert into line_return_order_lines (line_return_order_id, line_no, material_lot_id, returned_qty)
select lro.id, 1, ml.id, 25.0000
from line_return_orders lro
join material_lots ml on ml.lot_no = 'LOT-260616-RES-0001'
where lro.return_no = 'RET-260616-0001';

update work_orders
set released_by = u.id,
    updated_at = now()
from users u
where work_orders.code = '26061010008'
  and u.username = 'PMC_CN_01';

insert into feeder_bindings (work_order_id, line_id, machine_id, material_lot_id, feeder_no, reel_code, operator_id, bound_at, unbound_at, updated_at)
select wo.id, wo.line_id, m.id, ml.id, 'F-01', 'REEL-260616-RES-0001', u.id, timestamptz '2026-06-16 10:50:00+08', null, timestamptz '2026-06-16 10:50:00+08'
from work_orders wo
join machines m on m.line_id = wo.line_id
join material_lots ml on ml.lot_no = 'LOT-260616-RES-0001'
cross join users u
where wo.code = '26061010008'
  and u.username = 'VN_OP_013';

insert into pcb_serials (serial_no, work_order_id, status, source_work_order_code, created_at, updated_at)
select 'PCB-260616-0001', wo.id, 'wip', wo.code, timestamptz '2026-06-16 11:05:00+08', timestamptz '2026-06-16 11:05:00+08'
from work_orders wo
where wo.code = '26061010008'
ON CONFLICT (serial_no) DO NOTHING;

insert into station_events (pcb_serial_id, station_id, machine_id, operator_id, event_type, result, occurred_at, traceability_key, updated_at)
select ps.id, s.id, m.id, u.id, 'AOI', 'fail', timestamptz '2026-06-16 11:30:00+08', 'PCB-260616-0001', timestamptz '2026-06-16 11:30:00+08'
from pcb_serials ps
join work_orders wo on wo.id = ps.work_order_id
join stations s on s.line_id = wo.line_id and s.code = 'AOI-01'
join machines m on m.line_id = wo.line_id and m.code = 'NXT-01'
cross join users u
where ps.serial_no = 'PCB-260616-0001'
  and u.username = 'VN_OP_013';

insert into quality_inspections (inspection_no, work_order_id, pcb_serial_id, station_type, result, operator_id, occurred_at, inspection_type, updated_at)
select 'Q-260616-0001', wo.id, ps.id, 'AOI', 'fail', u.id, timestamptz '2026-06-16 11:35:00+08', 'in_process', timestamptz '2026-06-16 11:35:00+08'
from pcb_serials ps
join work_orders wo on wo.id = ps.work_order_id
cross join users u
where ps.serial_no = 'PCB-260616-0001'
  and u.username = 'PMC_CN_01'
ON CONFLICT (inspection_no) DO NOTHING;

insert into repair_records (repair_no, inspection_id, defect_code_id, action_taken, result, operator_id, closed_at, reinspection_required, updated_at)
select 'R-260616-0001', qi.id, d.id, 'Replaced missing component and reflowed the board.', 'closed', u.id, timestamptz '2026-06-16 13:00:00+08', true, timestamptz '2026-06-16 13:00:00+08'
from quality_inspections qi
join defect_codes d on d.code = 'REWORK-MISS'
cross join users u
where qi.inspection_no = 'Q-260616-0001'
  and u.username = 'VN_OP_013'
ON CONFLICT (repair_no) DO NOTHING;

insert into traceability_events (trace_key, event_type, reference_no, status, actor, actor_id, entity_type, entity_id, event_payload, occurred_at, updated_at)
select 'PO-RJ-VN-PO-240611', 'customer_po', po.po_number, 'posted', 'PMC_CN_01', u.id, 'customer_po', po.id, '{"po_number":"RJ-VN-PO-240611"}'::jsonb, '2026-06-16 08:30:00+08'::timestamptz, '2026-06-16 08:30:00+08'::timestamptz
from customer_pos po
cross join users u
where po.po_number = 'RJ-VN-PO-240611'
  and u.username = 'PMC_CN_01'
  and not exists (select 1 from traceability_events te where te.trace_key = 'PO-RJ-VN-PO-240611');

insert into traceability_events (trace_key, event_type, reference_no, status, actor, actor_id, entity_type, entity_id, event_payload, occurred_at, updated_at)
select 'WO-26061010008', 'work_order', wo.code, 'posted', 'PMC_CN_01', u.id, 'work_order', wo.id, '{"work_order_code":"26061010008"}'::jsonb, '2026-06-16 08:35:00+08'::timestamptz, '2026-06-16 08:35:00+08'::timestamptz
from work_orders wo
cross join users u
where wo.code = '26061010008'
  and u.username = 'PMC_CN_01'
  and not exists (select 1 from traceability_events te where te.trace_key = 'WO-26061010008');

insert into traceability_events (trace_key, event_type, reference_no, status, actor, actor_id, entity_type, entity_id, event_payload, occurred_at, updated_at)
select 'LOT-260616-RES-0001', 'material_lot', ml.lot_no, 'posted', 'VN_WH_010', u.id, 'material_lot', ml.id, '{"material_lot_no":"LOT-260616-RES-0001"}'::jsonb, '2026-06-16 09:12:00+08'::timestamptz, '2026-06-16 09:12:00+08'::timestamptz
from material_lots ml
cross join users u
where ml.lot_no = 'LOT-260616-RES-0001'
  and u.username = 'VN_WH_010'
  and not exists (select 1 from traceability_events te where te.trace_key = 'LOT-260616-RES-0001');

insert into traceability_events (trace_key, event_type, reference_no, status, actor, actor_id, entity_type, entity_id, event_payload, occurred_at, updated_at)
select 'PCB-260616-0001', 'pcb_serial', ps.serial_no, 'posted', 'VN_OP_013', u.id, 'pcb_serial', ps.id, '{"serial_no":"PCB-260616-0001"}'::jsonb, '2026-06-16 11:05:00+08'::timestamptz, '2026-06-16 11:05:00+08'::timestamptz
from pcb_serials ps
cross join users u
where ps.serial_no = 'PCB-260616-0001'
  and u.username = 'VN_OP_013'
  and not exists (select 1 from traceability_events te where te.trace_key = 'PCB-260616-0001');

-- audit_logs seed entries omitted: audit_logs table not present in current schema
