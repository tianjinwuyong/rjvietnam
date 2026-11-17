-- Seed: stagnation logs and scrap records for 产品呆滞管控 and 产品报废
-- Stations: AOI-01=9, ICT-01=13, FCT-01=14
-- Work orders: 26061020007=14, 26061030009=15, 26061010008=2
begin;

-- Step 1: upsert pcb serials (work_order_id NOT NULL, status ∈ passed/wip/scrapped)
INSERT INTO pcb_serials (serial_no, work_order_id, status, created_at, source_work_order_code) VALUES
  ('NV48A2545D8532', 14, 'wip', '2025-01-09 12:00:00', '26061020007'),
  ('NV48A2545D8541', 14, 'wip', '2025-01-20 18:00:00', '26061020007'),
  ('NV48A2545D8555', 15, 'wip', '2025-02-10 11:00:00', '26061030009'),
  ('NV36B1234A0012', 2,  'wip', '2025-03-01 14:00:00', '26061010008'),
  ('NV36B1234A0023', 2,  'wip', '2025-05-15 10:00:00', '26061010008'),
  ('NV36B1234A0028', 2,  'scrapped', '2025-06-21 09:00:00', '26061010008'),
  ('NV48A2545D8600', 15, 'wip', '2025-07-01 11:00:00', NULL)
ON CONFLICT (serial_no) DO UPDATE SET status = excluded.status;

-- Step 2: stagnation logs (from_station_id NOT NULL)
-- NV48A2545D8532 → ICT-01=13, NV48A2545D8541 → FCT-01=14, NV48A2545D8555 → AOI-01=9
-- NV36B1234A0012 → AOI-01=9,  NV36B1234A0023 → ICT-01=13
INSERT INTO product_stagnation_logs
  (pcb_serial_id, from_station_id, sn, pcb_no, station_code, line_code,
   stagnation_minutes, stagnation_level, status,
   customer_code, product_model, laser_qr_date, notes, created_at)
SELECT
  (SELECT id FROM pcb_serials WHERE serial_no = 'NV48A2545D8532'),
  13, 'NV48A2545D8532', '3FAC02670A', 'ICT-01', 'L002',
  525600, 'critical', 'open',
  'NetBit', 'EPS48R1-36', '2025-01-09 08:00:00', 'Overdue 12 months — awaiting scrap decision',
  '2025-01-09 12:00:00'
WHERE EXISTS (SELECT 1 FROM pcb_serials WHERE serial_no = 'NV48A2545D8532')
ON CONFLICT DO NOTHING;

INSERT INTO product_stagnation_logs
  (pcb_serial_id, from_station_id, sn, pcb_no, station_code, line_code,
   stagnation_minutes, stagnation_level, status,
   customer_code, product_model, laser_qr_date, notes, created_at)
SELECT
  (SELECT id FROM pcb_serials WHERE serial_no = 'NV48A2545D8541'),
  14, 'NV48A2545D8541', '3FAC02671B', 'FCT-01', 'L002',
  220320, 'alert', 'open',
  'NetBit', 'EPS48R1-36', '2025-01-20 14:30:00', 'Overdue 5 months — pending investigation',
  '2025-01-20 18:00:00'
WHERE EXISTS (SELECT 1 FROM pcb_serials WHERE serial_no = 'NV48A2545D8541')
ON CONFLICT DO NOTHING;

INSERT INTO product_stagnation_logs
  (pcb_serial_id, from_station_id, sn, pcb_no, station_code, line_code,
   stagnation_minutes, stagnation_level, status,
   customer_code, product_model, laser_qr_date, notes, created_at)
SELECT
  (SELECT id FROM pcb_serials WHERE serial_no = 'NV48A2545D8555'),
  9, 'NV48A2545D8555', '3FAC02672C', 'AOI-01', 'L002',
  86400, 'warning', 'open',
  'NetBit', 'EPS48R1-36', '2025-02-10 09:00:00', 'Overdue 60 days — QA review needed',
  '2025-02-10 11:00:00'
WHERE EXISTS (SELECT 1 FROM pcb_serials WHERE serial_no = 'NV48A2545D8555')
ON CONFLICT DO NOTHING;

INSERT INTO product_stagnation_logs
  (pcb_serial_id, from_station_id, sn, pcb_no, station_code, line_code,
   stagnation_minutes, stagnation_level, status,
   customer_code, product_model, laser_qr_date, notes, created_at)
SELECT
  (SELECT id FROM pcb_serials WHERE serial_no = 'NV36B1234A0012'),
  9, 'NV36B1234A0012', '4EFA03820B', 'AOI-01', 'L002',
  43200, 'normal', 'resolved',
  'Anker', 'PCBA-AURORA-CTRL', '2025-03-01 10:00:00', 'Resolved — transferred to rework line',
  '2025-03-01 14:00:00'
WHERE EXISTS (SELECT 1 FROM pcb_serials WHERE serial_no = 'NV36B1234A0012')
ON CONFLICT DO NOTHING;

INSERT INTO product_stagnation_logs
  (pcb_serial_id, from_station_id, sn, pcb_no, station_code, line_code,
   stagnation_minutes, stagnation_level, status,
   customer_code, product_model, laser_qr_date, notes, created_at)
SELECT
  (SELECT id FROM pcb_serials WHERE serial_no = 'NV36B1234A0023'),
  13, 'NV36B1234A0023', '4EFA03821C', 'ICT-01', 'L002',
  30240, 'normal', 'open',
  'Anker', 'PCBA-AURORA-CTRL', '2025-05-15 08:30:00', '21 days — monitor',
  '2025-05-15 10:00:00'
WHERE EXISTS (SELECT 1 FROM pcb_serials WHERE serial_no = 'NV36B1234A0023')
ON CONFLICT DO NOTHING;

-- Step 3: scrap records
INSERT INTO product_scraps
  (pcb_serial_id, sn, pcb_no, product_model, scrap_station, line_code, scrap_reason_code,
   scrap_reason_detail, responsible_person, quantity, status, po_number,
   work_order_code, created_at, approved_at)
SELECT
  (SELECT id FROM pcb_serials WHERE serial_no = 'NV48A2545D8532'),
  'NV48A2545D8532', '3FAC02670A', 'EPS48R1-36', 'FCT-01', 'L002',
  'BALL_STRIKE', 'Ball strike test failed — visible crack on solder joint',
  'Admin', 1, 'pending', 'RJ-VN-PO-240612', '26061020007',
  '2025-07-09 15:24:17', NULL
WHERE EXISTS (SELECT 1 FROM pcb_serials WHERE serial_no = 'NV48A2545D8532')
ON CONFLICT DO NOTHING;

INSERT INTO product_scraps
  (pcb_serial_id, sn, pcb_no, product_model, scrap_station, line_code, scrap_reason_code,
   scrap_reason_detail, responsible_person, quantity, status, po_number,
   work_order_code, created_at, approved_at)
SELECT
  (SELECT id FROM pcb_serials WHERE serial_no = 'NV36B1234A0012'),
  'NV36B1234A0012', '4EFA03820B', 'PCBA-AURORA-CTRL', 'AOI-01', 'L002',
  'DRY_JOINT', 'Dry joint at IC pin 23 — rework failed twice',
  'RW_001', 1, 'approved', 'RJ-VN-PO-240501', '26061010008',
  '2025-06-20 10:30:00', '2025-06-20 14:00:00'
WHERE EXISTS (SELECT 1 FROM pcb_serials WHERE serial_no = 'NV36B1234A0012')
ON CONFLICT DO NOTHING;

INSERT INTO product_scraps
  (pcb_serial_id, sn, pcb_no, product_model, scrap_station, line_code, scrap_reason_code,
   scrap_reason_detail, responsible_person, quantity, status, po_number,
   work_order_code, created_at, approved_at)
SELECT
  (SELECT id FROM pcb_serials WHERE serial_no = 'NV36B1234A0028'),
  'NV36B1234A0028', '4EFA03822D', 'PCBA-AURORA-CTRL', 'ICT-01', 'L002',
  'SHORT_CIRCUIT', 'Short between VCC and GND — cannot repair',
  'RW_001', 1, 'rejected', 'RJ-VN-PO-240501', '26061010008',
  '2025-06-21 09:00:00', NULL
WHERE EXISTS (SELECT 1 FROM pcb_serials WHERE serial_no = 'NV36B1234A0028')
ON CONFLICT DO NOTHING;

INSERT INTO product_scraps
  (pcb_serial_id, sn, pcb_no, product_model, scrap_station, line_code, scrap_reason_code,
   scrap_reason_detail, responsible_person, quantity, status, po_number,
   work_order_code, created_at, approved_at)
SELECT
  (SELECT id FROM pcb_serials WHERE serial_no = 'NV48A2545D8600'),
  'NV48A2545D8600', '5GFB03930E', 'EPS18R1G', 'AOI-01', 'L001',
  'MISSING_COMP', 'Missing R58 10K resistor on channel 2',
  'VN_OP_001', 1, 'pending', NULL, NULL,
  '2025-07-01 11:00:00', NULL
WHERE EXISTS (SELECT 1 FROM pcb_serials WHERE serial_no = 'NV48A2545D8600')
ON CONFLICT DO NOTHING;

commit;