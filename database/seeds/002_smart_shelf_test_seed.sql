-- ============================================================
-- Smart Shelf (感应式料架) WMS Test Data Seed
-- Based on: 感应式料架接口文档.docx2025 + 智能料架结构说明.md
-- ============================================================
-- This seed adds:
--   1. Smart shelves (encoded as storage_locations with shelf-hierarchy codes)
--   2. More materials (passive components, ICs, connectors, PCBAs)
--   3. Material lots with labelId format (TSNxxxxx) for smart shelf scanning
--   4. Additional customers, suppliers, POs, work orders
--   5. Sample storage location assignments per shelf
-- ============================================================

-- ── 1. Smart Shelves as Storage Locations ──────────────────────
-- shelfCode format: LnnnX (e.g. L001A = shelf 1, row A)
-- cell code format: {shelfCode}-{nn} (e.g. L001A-01)
-- RAW = raw material rack, LINE = line-side rack, HOLD = hold rack

-- Shelf L001A (SMT一线 原料架A) — 20 cells
INSERT INTO storage_locations (code, area, name_zh, name_en, name_vi, status, location_type)
VALUES
  ('L001A-01', 'SMT-1F', 'SMT一线 原料架A-01', 'SMT L1 Rack A-01', 'Kệ A-01 SMT L1', 'active', 'shelf_cell'),
  ('L001A-02', 'SMT-1F', 'SMT一线 原料架A-02', 'SMT L1 Rack A-02', 'Kệ A-02 SMT L1', 'active', 'shelf_cell'),
  ('L001A-03', 'SMT-1F', 'SMT一线 原料架A-03', 'SMT L1 Rack A-03', 'Kệ A-03 SMT L1', 'active', 'shelf_cell'),
  ('L001A-04', 'SMT-1F', 'SMT一线 原料架A-04', 'SMT L1 Rack A-04', 'Kệ A-04 SMT L1', 'active', 'shelf_cell'),
  ('L001A-05', 'SMT-1F', 'SMT一线 原料架A-05', 'SMT L1 Rack A-05', 'Kệ A-05 SMT L1', 'active', 'shelf_cell'),
  ('L001A-06', 'SMT-1F', 'SMT一线 原料架A-06', 'SMT L1 Rack A-06', 'Kệ A-06 SMT L1', 'active', 'shelf_cell'),
  ('L001A-07', 'SMT-1F', 'SMT一线 原料架A-07', 'SMT L1 Rack A-07', 'Kệ A-07 SMT L1', 'active', 'shelf_cell'),
  ('L001A-08', 'SMT-1F', 'SMT一线 原料架A-08', 'SMT L1 Rack A-08', 'Kệ A-08 SMT L1', 'active', 'shelf_cell'),
  ('L001A-09', 'SMT-1F', 'SMT一线 原料架A-09', 'SMT L1 Rack A-09', 'Kệ A-09 SMT L1', 'active', 'shelf_cell'),
  ('L001A-10', 'SMT-1F', 'SMT一线 原料架A-10', 'SMT L1 Rack A-10', 'Kệ A-10 SMT L1', 'active', 'shelf_cell'),
  ('L001A-11', 'SMT-1F', 'SMT一线 原料架A-11', 'SMT L1 Rack A-11', 'Kệ A-11 SMT L1', 'active', 'shelf_cell'),
  ('L001A-12', 'SMT-1F', 'SMT一线 原料架A-12', 'SMT L1 Rack A-12', 'Kệ A-12 SMT L1', 'active', 'shelf_cell'),
  ('L001A-13', 'SMT-1F', 'SMT一线 原料架A-13', 'SMT L1 Rack A-13', 'Kệ A-13 SMT L1', 'active', 'shelf_cell'),
  ('L001A-14', 'SMT-1F', 'SMT一线 原料架A-14', 'SMT L1 Rack A-14', 'Kệ A-14 SMT L1', 'active', 'shelf_cell'),
  ('L001A-15', 'SMT-1F', 'SMT一线 原料架A-15', 'SMT L1 Rack A-15', 'Kệ A-15 SMT L1', 'active', 'shelf_cell'),
  ('L001A-16', 'SMT-1F', 'SMT一线 原料架A-16', 'SMT L1 Rack A-16', 'Kệ A-16 SMT L1', 'active', 'shelf_cell'),
  ('L001A-17', 'SMT-1F', 'SMT一线 原料架A-17', 'SMT L1 Rack A-17', 'Kệ A-17 SMT L1', 'active', 'shelf_cell'),
  ('L001A-18', 'SMT-1F', 'SMT一线 原料架A-18', 'SMT L1 Rack A-18', 'Kệ A-18 SMT L1', 'active', 'shelf_cell'),
  ('L001A-19', 'SMT-1F', 'SMT一线 原料架A-19', 'SMT L1 Rack A-19', 'Kệ A-19 SMT L1', 'active', 'shelf_cell'),
  ('L001A-20', 'SMT-1F', 'SMT一线 原料架A-20', 'SMT L1 Rack A-20', 'Kệ A-20 SMT L1', 'active', 'shelf_cell')
ON CONFLICT (code) DO NOTHING;

-- Shelf L001B (SMT一线 原料架B) — 12 cells
INSERT INTO storage_locations (code, area, name_zh, name_en, name_vi, status, location_type)
VALUES
  ('L001B-01', 'SMT-1F', 'SMT一线 原料架B-01', 'SMT L1 Rack B-01', 'Kệ B-01 SMT L1', 'active', 'shelf_cell'),
  ('L001B-02', 'SMT-1F', 'SMT一线 原料架B-02', 'SMT L1 Rack B-02', 'Kệ B-02 SMT L1', 'active', 'shelf_cell'),
  ('L001B-03', 'SMT-1F', 'SMT一线 原料架B-03', 'SMT L1 Rack B-03', 'Kệ B-03 SMT L1', 'active', 'shelf_cell'),
  ('L001B-04', 'SMT-1F', 'SMT一线 原料架B-04', 'SMT L1 Rack B-04', 'Kệ B-04 SMT L1', 'active', 'shelf_cell'),
  ('L001B-05', 'SMT-1F', 'SMT一线 原料架B-05', 'SMT L1 Rack B-05', 'Kệ B-05 SMT L1', 'active', 'shelf_cell'),
  ('L001B-06', 'SMT-1F', 'SMT一线 原料架B-06', 'SMT L1 Rack B-06', 'Kệ B-06 SMT L1', 'active', 'shelf_cell'),
  ('L001B-07', 'SMT-1F', 'SMT一线 原料架B-07', 'SMT L1 Rack B-07', 'Kệ B-07 SMT L1', 'active', 'shelf_cell'),
  ('L001B-08', 'SMT-1F', 'SMT一线 原料架B-08', 'SMT L1 Rack B-08', 'Kệ B-08 SMT L1', 'active', 'shelf_cell'),
  ('L001B-09', 'SMT-1F', 'SMT一线 原料架B-09', 'SMT L1 Rack B-09', 'Kệ B-09 SMT L1', 'active', 'shelf_cell'),
  ('L001B-10', 'SMT-1F', 'SMT一线 原料架B-10', 'SMT L1 Rack B-10', 'Kệ B-10 SMT L1', 'active', 'shelf_cell'),
  ('L001B-11', 'SMT-1F', 'SMT一线 原料架B-11', 'SMT L1 Rack B-11', 'Kệ B-11 SMT L1', 'active', 'shelf_cell'),
  ('L001B-12', 'SMT-1F', 'SMT一线 原料架B-12', 'SMT L1 Rack B-12', 'Kệ B-12 SMT L1', 'active', 'shelf_cell')
ON CONFLICT (code) DO NOTHING;

-- Shelf L002A (SMT二线 原料架A) — 12 cells
INSERT INTO storage_locations (code, area, name_zh, name_en, name_vi, status, location_type)
VALUES
  ('L002A-01', 'SMT-2F', 'SMT二线 原料架A-01', 'SMT L2 Rack A-01', 'Kệ A-01 SMT L2', 'active', 'shelf_cell'),
  ('L002A-02', 'SMT-2F', 'SMT二线 原料架A-02', 'SMT L2 Rack A-02', 'Kệ A-02 SMT L2', 'active', 'shelf_cell'),
  ('L002A-03', 'SMT-2F', 'SMT二线 原料架A-03', 'SMT L2 Rack A-03', 'Kệ A-03 SMT L2', 'active', 'shelf_cell'),
  ('L002A-04', 'SMT-2F', 'SMT二线 原料架A-04', 'SMT L2 Rack A-04', 'Kệ A-04 SMT L2', 'active', 'shelf_cell'),
  ('L002A-05', 'SMT-2F', 'SMT二线 原料架A-05', 'SMT L2 Rack A-05', 'Kệ A-05 SMT L2', 'active', 'shelf_cell'),
  ('L002A-06', 'SMT-2F', 'SMT二线 原料架A-06', 'SMT L2 Rack A-06', 'Kệ A-06 SMT L2', 'active', 'shelf_cell'),
  ('L002A-07', 'SMT-2F', 'SMT二线 原料架A-07', 'SMT L2 Rack A-07', 'Kệ A-07 SMT L2', 'active', 'shelf_cell'),
  ('L002A-08', 'SMT-2F', 'SMT二线 原料架A-08', 'SMT L2 Rack A-08', 'Kệ A-08 SMT L2', 'active', 'shelf_cell'),
  ('L002A-09', 'SMT-2F', 'SMT二线 原料架A-09', 'SMT L2 Rack A-09', 'Kệ A-09 SMT L2', 'active', 'shelf_cell'),
  ('L002A-10', 'SMT-2F', 'SMT二线 原料架A-10', 'SMT L2 Rack A-10', 'Kệ A-10 SMT L2', 'active', 'shelf_cell'),
  ('L002A-11', 'SMT-2F', 'SMT二线 原料架A-11', 'SMT L2 Rack A-11', 'Kệ A-11 SMT L2', 'active', 'shelf_cell'),
  ('L002A-12', 'SMT-2F', 'SMT二线 原料架A-12', 'SMT L2 Rack A-12', 'Kệ A-12 SMT L2', 'active', 'shelf_cell')
ON CONFLICT (code) DO NOTHING;

-- RAW warehouse shelf (原料仓) — 10 cells
INSERT INTO storage_locations (code, area, name_zh, name_en, name_vi, status, location_type)
VALUES
  ('RAW-A01', 'RAW', '原料仓-A01', 'Raw WH Rack A01', 'Kho NL A01', 'active', 'pallet'),
  ('RAW-A02', 'RAW', '原料仓-A02', 'Raw WH Rack A02', 'Kho NL A02', 'active', 'pallet'),
  ('RAW-A03', 'RAW', '原料仓-A03', 'Raw WH Rack A03', 'Kho NL A03', 'active', 'pallet'),
  ('RAW-A04', 'RAW', '原料仓-A04', 'Raw WH Rack A04', 'Kho NL A04', 'active', 'pallet'),
  ('RAW-A05', 'RAW', '原料仓-A05', 'Raw WH Rack A05', 'Kho NL A05', 'active', 'pallet'),
  ('RAW-B01', 'RAW', '原料仓-B01', 'Raw WH Rack B01', 'Kho NL B01', 'active', 'pallet'),
  ('RAW-B02', 'RAW', '原料仓-B02', 'Raw WH Rack B02', 'Kho NL B02', 'active', 'pallet'),
  ('RAW-B03', 'RAW', '原料仓-B03', 'Raw WH Rack B03', 'Kho NL B03', 'active', 'pallet'),
  ('RAW-B04', 'RAW', '原料仓-B04', 'Raw WH Rack B04', 'Kho NL B04', 'active', 'pallet'),
  ('RAW-B05', 'RAW', '原料仓-B05', 'Raw WH Rack B05', 'Kho NL B05', 'active', 'pallet')
ON CONFLICT (code) DO NOTHING;

-- IQC Hold shelf (待检/冻结区)
INSERT INTO storage_locations (code, area, name_zh, name_en, name_vi, status, location_type)
VALUES
  ('IQC-01', 'IQC', 'IQC待检位-01', 'IQC Pending-01', 'IQC Chờ-01', 'active', 'hold'),
  ('IQC-02', 'IQC', 'IQC待检位-02', 'IQC Pending-02', 'IQC Chờ-02', 'active', 'hold'),
  ('HOLD-01', 'HOLD', '冻结区-01', 'Frozen Hold-01', 'Khoá-01', 'active', 'hold'),
  ('HOLD-02', 'HOLD', '冻结区-02', 'Frozen Hold-02', 'Khoá-02', 'active', 'hold')
ON CONFLICT (code) DO NOTHING;

-- ── 2. Additional Materials (components) ────────────────────────
INSERT INTO materials (code, name_zh, name_en, name_vi, uom, material_type)
VALUES
  ('CAP-0805-100N',  '贴片电容 0805 100nF',      'MLCC 0805 100nF',         'Tụ dán 0805 100nF',    'PCS', 'component'),
  ('CAP-0603-10U',   '贴片电容 0603 10µF',       'MLCC 0603 10µF',          'Tụ dán 0603 10µF',     'PCS', 'component'),
  ('IC-MCU-RJ32',    '主控 MCU STM32F407',       'Main MCU STM32F407',      'MCU chính STM32F407',  'PCS', 'ic'),
  ('IC-DDR3-512M',   'DDR3 512MB 内存',          'DDR3 512MB Memory',       'Bộ nhớ DDR3 512MB',    'PCS', 'ic'),
  ('IC-FLASH-128M',  'SPI Flash 128Mb',          'SPI Flash 128Mb',          'Flash SPI 128Mb',      'PCS', 'ic'),
  ('CON-HDMI-19',    'HDMI 母座 19P',            'HDMI Female 19P',          'Đầu HDMI 19P',         'PCS', 'connector'),
  ('CON-USB-TYPE-C', 'USB Type-C 母座',          'USB Type-C Female',        'Đầu USB Type-C',       'PCS', 'connector'),
  ('IND-0805-10UH',  '贴片电感 0805 10µH',       'Chip inductor 0805 10µH',  'Cuộn cảm 0805 10µH',  'PCS', 'component'),
  ('DIODE-SS34',     '肖特基二极管 SS34',        'Schottky Diode SS34',      'Diode Schottky SS34',  'PCS', 'component'),
  ('TRANS-2N7002',   'MOSFET N沟道 2N7002',      'N-Ch MOSFET 2N7002',       'MOSFET 2N7002',        'PCS', 'component');

-- ── 3. Additional Customers ─────────────────────────────────────
INSERT INTO customers (code, name_zh, name_en, name_vi)
VALUES
  ('CUST-SGN-02',    '胡志明客户二号',         'Saigon Customer 02',     'Khách hàng Sài Gòn 02'),
  ('CUST-DN-03',     '岘港客户三号',           'Danang Customer 03',     'Khách hàng Đà Nẵng 03');

-- ── 4. Additional Suppliers ─────────────────────────────────────
INSERT INTO suppliers (code, name_zh, name_en, name_vi)
VALUES
  ('SUP-SZ-IC',      '深圳 IC 供应商',         'Shenzhen IC Supplier',   'Nhà cung cấp IC Thâm Quyến'),
  ('SUP-SH-CAP',     '上海电容供应商',         'Shanghai Cap Supplier',  'Nhà cung cấp tụ Thượng Hải'),
  ('SUP-KR-CONN',    '韩国连接器供应商',       'Korea Connector Supplier','Nhà cung cấp connector Hàn Quốc'),
  ('SUP-VN-SOLDER',  '越南锡膏供应商',         'Vietnam Solder Paste',   'Nhà cung cấp thiếc hàn Việt Nam');

-- ── 5. More Products ────────────────────────────────────────────
INSERT INTO products (code, name_zh, name_en, name_vi, revision)
VALUES
  ('PCBA-MOTOR-IO',  '电机驱动 IO 板',         'Motor Driver IO Board',  'Board điều khiển động cơ IO', 'A1'),
  ('PCBA-POWER-HV',  '高压电源板',             'High Voltage PSU Board', 'Board nguồn cao áp',          'B2');

-- ── 6. More Customer POs ───────────────────────────────────────
INSERT INTO customer_pos (po_number, customer_id, product_id, order_qty, due_date)
SELECT 'RJ-VN-PO-240612', c.id, p.id, 12000, date '2026-06-30'
FROM customers c CROSS JOIN products p
WHERE c.code = 'CUST-SGN-02' AND p.code = 'PCBA-MOTOR-IO';

INSERT INTO customer_pos (po_number, customer_id, product_id, order_qty, due_date)
SELECT 'RJ-VN-PO-240613', c.id, p.id, 5000, date '2026-07-15'
FROM customers c CROSS JOIN products p
WHERE c.code = 'CUST-DN-03' AND p.code = 'PCBA-POWER-HV';

-- ── 7. More Work Orders ────────────────────────────────────────
-- WO for PCBA-MOTOR-IO on SMT Line 2
INSERT INTO work_orders (code, customer_po_id, product_id, line_id, work_order_type, planned_qty, completed_qty, status)
SELECT '26061020007', po.id, po.product_id, pl.id, 1, 7200, 4210, 'running'
FROM customer_pos po
CROSS JOIN production_lines pl
WHERE po.po_number = 'RJ-VN-PO-240612' AND pl.internal_code = 'L002';

-- WO for PCBA-POWER-HV (trial run, released/paused status)
INSERT INTO work_orders (code, customer_po_id, product_id, line_id, work_order_type, planned_qty, completed_qty, status)
SELECT '26063030009', po.id, po.product_id, pl.id, 3, 500, 118, 'released'
FROM customer_pos po
CROSS JOIN production_lines pl
WHERE po.po_number = 'RJ-VN-PO-240613' AND pl.internal_code = 'L003';

-- ── 8. Material Lots with Smart Shelf Label IDs ────────────────
-- Each lot maps to a storage_location (shelf cell) and has a label ID
-- Label ID format: TSNxxxxx (matching 感应式料架 spec)

-- Existing: R-0603-10K-1 has 1 lot with 238000 PCS
-- Add another lot for R-0603-10K-1 on a different shelf cell
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-R240620-02', 300000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'R-0603-10K-1' AND s.code = 'SUP-TPE-RES' AND sl.code = 'L001A-01';

-- CAP-0805-100N: 2 lots (one on shelf, one in hold)
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-CAP240617-01', 150000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'CAP-0805-100N' AND s.code = 'SUP-SH-CAP' AND sl.code = 'L001A-03';

INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-CAP240617-02', 150000, 'pending', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'CAP-0805-100N' AND s.code = 'SUP-SH-CAP' AND sl.code = 'IQC-01';

-- CAP-0603-10U: 1 lot on shelf
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-CAP240618-01', 200000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'CAP-0603-10U' AND s.code = 'SUP-SH-CAP' AND sl.code = 'L001A-05';

-- IC-MCU-RJ32: 1 lot on hold (IQC pending), 1 lot rejected
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-IC240619-01', 5200, 'hold', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'IC-MCU-RJ32' AND s.code = 'SUP-SZ-IC' AND sl.code = 'IQC-02';

INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-IC240619-02', 500, 'rejected', sl.id, 'voided'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'IC-MCU-RJ32' AND s.code = 'SUP-SZ-IC' AND sl.code = 'HOLD-01';

-- IC-DDR3-512M: 1 lot on shelf
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-DDR240620-01', 3000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'IC-DDR3-512M' AND s.code = 'SUP-SZ-IC' AND sl.code = 'L001A-07';

-- IC-FLASH-128M: 1 lot on shelf
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-FL240620-01', 5000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'IC-FLASH-128M' AND s.code = 'SUP-SZ-IC' AND sl.code = 'L001A-09';

-- CON-HDMI-19: 1 lot on shelf
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-HDMI240621-01', 8000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'CON-HDMI-19' AND s.code = 'SUP-KR-CONN' AND sl.code = 'L001A-11';

-- CON-USB-TYPE-C: 1 lot on shelf
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-USBC240621-01', 10000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'CON-USB-TYPE-C' AND s.code = 'SUP-KR-CONN' AND sl.code = 'L001A-13';

-- IND-0805-10UH: 1 lot on shelf
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-IND240622-01', 180000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'IND-0805-10UH' AND s.code = 'SUP-SH-CAP' AND sl.code = 'L001A-15';

-- DIODE-SS34: 1 lot on shelf
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-DIO240622-01', 60000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'DIODE-SS34' AND s.code = 'SUP-TPE-RES' AND sl.code = 'L001A-17';

-- TRANS-2N7002: 1 lot on shelf
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-TR240623-01', 80000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'TRANS-2N7002' AND s.code = 'SUP-TPE-RES' AND sl.code = 'L001A-19';

-- PCB-AURORA-CTRL: add a second lot on a different shelf cell
INSERT INTO material_lots (material_id, supplier_id, lot_no, received_qty, iqc_status, storage_location_id, lot_status)
SELECT m.id, s.id, 'VN-PCB240617-04', 15000, 'released', sl.id, 'open'
FROM materials m, suppliers s, storage_locations sl
WHERE m.code = 'PCB-AURORA-CTRL' AND s.code = 'SUP-HN-PCB' AND sl.code = 'L001B-01';

-- ── 9. Inventory Transaction History ────────────────────────────
-- RECEIVE transactions for new lots (one tx per lot)
INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, operator_id, tx_status)
SELECT 'RCV-240617-' || ml.id::text, 'RECEIVE', ml.id, ml.received_qty, 1, 'posted'
FROM material_lots ml WHERE ml.lot_no = 'VN-R240620-02';

INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, operator_id, tx_status)
SELECT 'RCV-240617-' || ml.id::text, 'RECEIVE', ml.id, ml.received_qty, 1, 'posted'
FROM material_lots ml WHERE ml.lot_no = 'VN-CAP240617-01';

INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, operator_id, tx_status)
SELECT 'RCV-240617-' || ml.id::text, 'RECEIVE', ml.id, ml.received_qty, 1, 'posted'
FROM material_lots ml WHERE ml.lot_no = 'VN-CAP240618-01';

INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, operator_id, tx_status)
SELECT 'RCV-240617-' || ml.id::text, 'RECEIVE', ml.id, ml.received_qty, 1, 'posted'
FROM material_lots ml WHERE ml.lot_no = 'VN-IC240619-01';

-- IQC release for passed lots (one tx per lot)
INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, operator_id, tx_status)
SELECT 'IQC-240617-' || ml.id::text, 'IQC_RELEASE', ml.id, ml.received_qty, 2, 'posted'
FROM material_lots ml WHERE ml.lot_no IN ('VN-R240620-02','VN-CAP240617-01','VN-CAP240618-01','VN-DDR240620-01','VN-FL240620-01','VN-HDMI240621-01','VN-USBC240621-01','VN-IND240622-01','VN-DIO240622-01','VN-TR240623-01','VN-PCB240617-04');

-- PUT_AWAY: move to shelf location (one tx per lot)
INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, operator_id, tx_status)
SELECT 'PUT-240617-' || ml.id::text, 'PUT_AWAY', ml.id, ml.received_qty, 1, 'posted'
FROM material_lots ml WHERE ml.lot_no IN ('VN-R240620-02','VN-CAP240617-01','VN-CAP240618-01','VN-DDR240620-01','VN-FL240620-01','VN-HDMI240621-01','VN-USBC240621-01','VN-IND240622-01','VN-DIO240622-01','VN-TR240623-01','VN-PCB240617-04');

-- PICK from shelf
INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, operator_id, tx_status)
SELECT 'PICK-240617-' || ml.id::text, 'PICK', ml.id, 96000, 1, 'posted'
FROM material_lots ml WHERE ml.lot_no = 'VN-R240620-02';

-- ISSUE to SMT line
INSERT INTO inventory_transactions (tx_no, action, material_lot_id, qty, operator_id, tx_status)
SELECT 'ISS-240617-' || ml.id::text, 'ISSUE_TO_LINE', ml.id, 96000, 1, 'posted'
FROM material_lots ml WHERE ml.lot_no = 'VN-R240620-02';

-- ── 10. Update existing material_lots to point to new shelf cells ─
-- Update the original PCB lot to point to L001B-03 instead of B02-01-01
UPDATE material_lots SET storage_location_id = sl.id
FROM storage_locations sl
WHERE sl.code = 'L001B-03'
AND material_lots.lot_no = 'VN-PCB240616-03';

-- Update original resistor lot to point to L001A-02
UPDATE material_lots SET storage_location_id = sl.id
FROM storage_locations sl
WHERE sl.code = 'L001A-02'
AND material_lots.lot_no = 'VN-R240616-01';
