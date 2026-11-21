-- One official identity per station. Aliases are accepted only at system boundaries.
CREATE TABLE IF NOT EXISTS station_code_aliases (
  line_code varchar(40) NOT NULL,
  alias_code varchar(80) NOT NULL,
  canonical_code varchar(80) NOT NULL,
  name_zh varchar(120),
  name_en varchar(120),
  name_vi varchar(120),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (line_code, alias_code)
);
ALTER TABLE station_code_aliases ADD COLUMN IF NOT EXISTS canonical_key varchar(180);

INSERT INTO station_code_aliases(line_code,alias_code,canonical_code,name_zh,name_en,name_vi) VALUES
('L004','AOI-01','manu_aio','AOI质量工位','AOI Quality','Kiểm tra AOI'),
('L004','ICT-01','manu_ict','ICT','ICT','ICT'),
('L004','FCT-01','manu_fct','FCT','FCT','FCT'),
('L004','DEPANEL-01','manu_depanel','分板工位','Depanel','Tách bảng'),
('L004','SHELL-BIND-01','manu_shellbinding','PCBA外壳绑码','Shell Binding','Gán mã vỏ'),
('L004','manu_qr_binding','manu_shellbinding','PCBA外壳绑码','Shell Binding','Gán mã vỏ'),
('L004','ASSY-ATE-01','manu_assem_ate','组装ATE','Assembly ATE','ATE lắp ráp'),
('L004','ULTRA-01','manu_supersonic','超声工位','Ultrasonic','Siêu âm'),
('L004','AGING-01','manu_agingcab','成品老化','Aging','Lão hóa'),
('L004','HIPOT-01','manu_hivolt_ate','高压ATE','High-voltage ATE','ATE cao áp'),
('L004','PACK-ATE-01','manu_package_ate','包装ATE','Packaging ATE','ATE đóng gói'),
('L004','CARTON-BIND-01','manu_case_binding','外箱码绑定','Outer-box Binding','Gán mã thùng'),
('L004','manu_outer_box_binding','manu_case_binding','外箱码绑定','Outer-box Binding','Gán mã thùng'),
('L004','PALLET-BIND-01','manu_pallet_binding','栈板绑码','Pallet Binding','Gán mã pallet'),
('L004','REWORK-01','manu_rework','回修站','Maintenance / Rework','Trạm sửa chữa')
,
('L002','PDA-01','auto_pda','PDA扫码上料','PDA Loading','Nạp liệu PDA'),
('L002','AUTO-LOAD-01','auto_pda','PDA扫码上料','PDA Loading','Nạp liệu PDA'),
('L002','AOI-01','auto_aio','AOI','AOI','AOI'),
('L002','AUTO-AOI-01','auto_aio','AOI','AOI','AOI'),
('L002','ICT-01','auto_ict','ICT','ICT','ICT'),
('L002','AUTO-ICT-01','auto_ict','ICT','ICT','ICT'),
('L002','FCT-01','auto_fct','FCT','FCT','FCT'),
('L002','AUTO-FCT-01','auto_fct','FCT','FCT','FCT'),
('L002','DEPANEL-01','auto_depanel','分板工位','Depanel','Tách bảng'),
('L002','AUTO-PCBA-01','auto_depanel','分板工位','Depanel','Tách bảng'),
('L002','SHELL-BIND-01','auto_shellbinding','PCBA外壳绑码','Shell Binding','Gán mã vỏ'),
('L002','AUTO-ASM-01','auto_shellbinding','PCBA外壳绑码','Shell Binding','Gán mã vỏ'),
('L002','ASSY-ATE-01','auto_assem_ate','组装ATE','Assembly ATE','ATE lắp ráp'),
('L002','ULTRA-01','auto_supersonic','超声工位','Ultrasonic','Siêu âm'),
('L002','AGING-01','auto_agingcab','成品老化','Aging','Lão hóa'),
('L002','AGING-CAB-01','auto_agingcab','成品老化','Aging','Lão hóa'),
('L002','HIPOT-01','auto_hivolt_ate','高压ATE','High-voltage ATE','ATE cao áp'),
('L002','PACK-ATE-01','auto_package_ate','包装ATE','Packaging ATE','ATE đóng gói'),
('L002','CARTON-BIND-01','auto_case_binding','外箱码绑定','Outer-box Binding','Gán mã thùng'),
('L002','PALLET-BIND-01','auto_pallet_binding','栈板绑码','Pallet Binding','Gán mã pallet')
ON CONFLICT(line_code,alias_code) DO UPDATE SET canonical_code=EXCLUDED.canonical_code,
  name_zh=EXCLUDED.name_zh,name_en=EXCLUDED.name_en,name_vi=EXCLUDED.name_vi,active=true;

UPDATE station_code_aliases SET canonical_key='station:'||line_code||':'||canonical_code
WHERE canonical_key IS DISTINCT FROM 'station:'||line_code||':'||canonical_code;
CREATE UNIQUE INDEX IF NOT EXISTS idx_station_alias_canonical_key_alias
  ON station_code_aliases(canonical_key,alias_code);

INSERT INTO station_sequences(line_code,station_code,sequence_order,station_name_zh,parent_line_code) VALUES
('L004','manu_aio',1,'AOI质量工位',NULL),
('L004','manu_ict',2,'ICT',NULL),
('L004','manu_fct',3,'FCT',NULL),
('L004','manu_depanel',4,'分板工位',NULL),
('L004','manu_shellbinding',5,'PCBA外壳绑码',NULL),
('L004','manu_assem_ate',6,'组装ATE',NULL),
('L004','manu_supersonic',7,'超声工位',NULL),
('L004','manu_agingcab',8,'成品老化',NULL),
('L004','manu_hivolt_ate',9,'高压ATE',NULL),
('L004','manu_package_ate',10,'包装ATE',NULL),
('L004','manu_case_binding',11,'外箱码绑定',NULL),
('L004','manu_pallet_binding',12,'栈板绑码',NULL)
ON CONFLICT(line_code,station_code) DO UPDATE SET sequence_order=EXCLUDED.sequence_order,
  station_name_zh=EXCLUDED.station_name_zh,parent_line_code=EXCLUDED.parent_line_code;

INSERT INTO station_sequences(line_code,station_code,sequence_order,station_name_zh,parent_line_code) VALUES
('L002','auto_aio',1,'AOI',NULL),
('L002','auto_ict',2,'ICT',NULL),
('L002','auto_fct',3,'FCT',NULL),
('L002','auto_depanel',4,'分板工位',NULL),
('L002','auto_shellbinding',5,'PCBA外壳绑码',NULL),
('L002','auto_assem_ate',6,'组装ATE',NULL),
('L002','auto_supersonic',7,'超声工位',NULL),
('L002','auto_agingcab',8,'成品老化',NULL),
('L002','auto_hivolt_ate',9,'高压ATE',NULL),
('L002','auto_package_ate',10,'包装ATE',NULL),
('L002','auto_case_binding',11,'外箱码绑定',NULL),
('L002','auto_pallet_binding',12,'栈板绑码',NULL)
ON CONFLICT(line_code,station_code) DO UPDATE SET sequence_order=EXCLUDED.sequence_order,
  station_name_zh=EXCLUDED.station_name_zh,parent_line_code=EXCLUDED.parent_line_code;

DELETE FROM station_sequences WHERE line_code='L002' AND station_code IN
('AUTO-LOAD-01','AUTO-AOI-01','AUTO-ICT-01','AUTO-FCT-01','AUTO-PCBA-01','AUTO-ASM-01',
 'AGING-CAB-01','ASSY-ATE-01','PACK-ATE-01','ULTRA-01','AGING-01','PALLET-BIND-01');

-- The automatic line has the same outer-box process as the manual line.  Keep
-- one physical station row so heartbeat/events can resolve to a real 3D node.
INSERT INTO stations(line_id,code,station_type_id,name_zh,name_en,name_vi,status,required_scan,sequence_order)
SELECT auto_line.id,'auto_case_binding',manual_case.station_type_id,
       '外箱码绑定','Outer-box Binding','Gán mã thùng','running',true,13
FROM production_lines auto_line
JOIN stations manual_case ON manual_case.code='manu_case_binding'
WHERE auto_line.internal_code='L002'
  AND NOT EXISTS (SELECT 1 FROM stations WHERE code='auto_case_binding');

UPDATE stations SET sequence_order=14
WHERE code='auto_pallet_binding' AND sequence_order<=13;
