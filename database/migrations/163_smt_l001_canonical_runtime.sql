-- Canonical SMT L001 route. PDA loading is the first process; every trusted
-- production result must complete these stations in order.
INSERT INTO station_sequences
  (line_code,station_code,sequence_order,station_name_zh,parent_line_code)
VALUES
  ('L001','smt_pda_loading',0,'PD扫码上料',NULL),
  ('L001','smt_laser_marking',1,'镭雕机',NULL),
  ('L001','smt_auto_insertion',2,'AI插件机',NULL),
  ('L001','smt_printer',3,'印刷机',NULL),
  ('L001','smt_spi',4,'SPI锡膏检测',NULL),
  ('L001','smt_placement',5,'贴片机',NULL),
  ('L001','smt_aoi',6,'SMT-AOI',NULL)
ON CONFLICT(line_code,station_code) DO UPDATE SET
  sequence_order=EXCLUDED.sequence_order,
  station_name_zh=EXCLUDED.station_name_zh,
  parent_line_code=EXCLUDED.parent_line_code;

INSERT INTO station_code_aliases
  (line_code,alias_code,canonical_code,name_zh,name_en,name_vi)
VALUES
  ('L001','SMT-PDA','smt_pda_loading','PD扫码上料','PDA Material Loading','Quét cấp liệu PDA'),
  ('L001','SMT-LASER','smt_laser_marking','镭雕机','Laser Marking','Khắc laser'),
  ('L001','SMT-AI','smt_auto_insertion','AI插件机','Automatic Insertion','Máy cắm linh kiện AI'),
  ('L001','SMT-PRINTER','smt_printer','印刷机','Solder Paste Printer','Máy in kem hàn'),
  ('L001','SMT-SPI','smt_spi','SPI锡膏检测','Solder Paste Inspection','Kiểm tra kem hàn SPI'),
  ('L001','SMT-PLACEMENT','smt_placement','贴片机','Pick and Place','Máy gắn linh kiện'),
  ('L001','SMT-AOI','smt_aoi','SMT-AOI','SMT AOI','Kiểm tra SMT-AOI')
ON CONFLICT(line_code,alias_code) DO UPDATE SET
  canonical_code=EXCLUDED.canonical_code,
  name_zh=EXCLUDED.name_zh,
  name_en=EXCLUDED.name_en,
  name_vi=EXCLUDED.name_vi,
  active=TRUE;
