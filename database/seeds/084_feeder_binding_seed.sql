-- Seed data for SMT feeder binding 4-way validation
-- Run AFTER 083_feeder_binding.sql

-- (no begin/commit - caller manages transaction)

-- ── Machine Slots: NPM-01, NPM-02, NPM-03 ────────────────────────────────────
-- Standard NPM dual-track: slots 1L~20L (left) and 1R~20R (right), 40 per machine
INSERT INTO machine_slots (machine_code, slot_no, slot_type, feeder_width, max_qty) VALUES
-- NPM-01 left track
('NPM-01','1L','SMT','8mm',1),('NPM-01','2L','SMT','8mm',1),('NPM-01','3L','SMT','8mm',1),('NPM-01','4L','SMT','8mm',1),('NPM-01','5L','SMT','8mm',1),
('NPM-01','6L','SMT','8mm',1),('NPM-01','7L','SMT','8mm',1),('NPM-01','8L','SMT','8mm',1),('NPM-01','9L','SMT','8mm',1),('NPM-01','10L','SMT','8mm',1),
('NPM-01','11L','SMT','8mm',1),('NPM-01','12L','SMT','8mm',1),('NPM-01','13L','SMT','8mm',1),('NPM-01','14L','SMT','8mm',1),('NPM-01','15L','SMT','8mm',1),
('NPM-01','16L','SMT','8mm',1),('NPM-01','17L','SMT','8mm',1),('NPM-01','18L','SMT','8mm',1),('NPM-01','19L','SMT','8mm',1),('NPM-01','20L','SMT','8mm',1),
-- NPM-01 right track
('NPM-01','1R','SMT','8mm',1),('NPM-01','2R','SMT','8mm',1),('NPM-01','3R','SMT','8mm',1),('NPM-01','4R','SMT','8mm',1),('NPM-01','5R','SMT','8mm',1),
('NPM-01','6R','SMT','8mm',1),('NPM-01','7R','SMT','8mm',1),('NPM-01','8R','SMT','8mm',1),('NPM-01','9R','SMT','8mm',1),('NPM-01','10R','SMT','8mm',1),
('NPM-01','11R','SMT','8mm',1),('NPM-01','12R','SMT','8mm',1),('NPM-01','13R','SMT','8mm',1),('NPM-01','14R','SMT','8mm',1),('NPM-01','15R','SMT','8mm',1),
('NPM-01','16R','SMT','8mm',1),('NPM-01','17R','SMT','8mm',1),('NPM-01','18R','SMT','8mm',1),('NPM-01','19R','SMT','8mm',1),('NPM-01','20R','SMT','8mm',1),

-- NPM-02 left track
('NPM-02','1L','SMT','8mm',1),('NPM-02','2L','SMT','8mm',1),('NPM-02','3L','SMT','8mm',1),('NPM-02','4L','SMT','8mm',1),('NPM-02','5L','SMT','8mm',1),
('NPM-02','6L','SMT','8mm',1),('NPM-02','7L','SMT','8mm',1),('NPM-02','8L','SMT','8mm',1),('NPM-02','9L','SMT','8mm',1),('NPM-02','10L','SMT','8mm',1),
('NPM-02','11L','SMT','8mm',1),('NPM-02','12L','SMT','8mm',1),('NPM-02','13L','SMT','8mm',1),('NPM-02','14L','SMT','8mm',1),('NPM-02','15L','SMT','8mm',1),
('NPM-02','16L','SMT','8mm',1),('NPM-02','17L','SMT','8mm',1),('NPM-02','18L','SMT','8mm',1),('NPM-02','19L','SMT','8mm',1),('NPM-02','20L','SMT','8mm',1),
-- NPM-02 right track
('NPM-02','1R','SMT','8mm',1),('NPM-02','2R','SMT','8mm',1),('NPM-02','3R','SMT','8mm',1),('NPM-02','4R','SMT','8mm',1),('NPM-02','5R','SMT','8mm',1),
('NPM-02','6R','SMT','8mm',1),('NPM-02','7R','SMT','8mm',1),('NPM-02','8R','SMT','8mm',1),('NPM-02','9R','SMT','8mm',1),('NPM-02','10R','SMT','8mm',1),
('NPM-02','11R','SMT','8mm',1),('NPM-02','12R','SMT','8mm',1),('NPM-02','13R','SMT','8mm',1),('NPM-02','14R','SMT','8mm',1),('NPM-02','15R','SMT','8mm',1),
('NPM-02','16R','SMT','8mm',1),('NPM-02','17R','SMT','8mm',1),('NPM-02','18R','SMT','8mm',1),('NPM-02','19R','SMT','8mm',1),('NPM-02','20R','SMT','8mm',1),

-- NPM-03 left track
('NPM-03','1L','SMT','8mm',1),('NPM-03','2L','SMT','8mm',1),('NPM-03','3L','SMT','8mm',1),('NPM-03','4L','SMT','8mm',1),('NPM-03','5L','SMT','8mm',1),
('NPM-03','6L','SMT','8mm',1),('NPM-03','7L','SMT','8mm',1),('NPM-03','8L','SMT','8mm',1),('NPM-03','9L','SMT','8mm',1),('NPM-03','10L','SMT','8mm',1),
('NPM-03','11L','SMT','8mm',1),('NPM-03','12L','SMT','8mm',1),('NPM-03','13L','SMT','8mm',1),('NPM-03','14L','SMT','8mm',1),('NPM-03','15L','SMT','8mm',1),
('NPM-03','16L','SMT','8mm',1),('NPM-03','17L','SMT','8mm',1),('NPM-03','18L','SMT','8mm',1),('NPM-03','19L','SMT','8mm',1),('NPM-03','20L','SMT','8mm',1),
-- NPM-03 right track
('NPM-03','1R','SMT','8mm',1),('NPM-03','2R','SMT','8mm',1),('NPM-03','3R','SMT','8mm',1),('NPM-03','4R','SMT','8mm',1),('NPM-03','5R','SMT','8mm',1),
('NPM-03','6R','SMT','8mm',1),('NPM-03','7R','SMT','8mm',1),('NPM-03','8R','SMT','8mm',1),('NPM-03','9R','SMT','8mm',1),('NPM-03','10R','SMT','8mm',1),
('NPM-03','11R','SMT','8mm',1),('NPM-03','12R','SMT','8mm',1),('NPM-03','13R','SMT','8mm',1),('NPM-03','14R','SMT','8mm',1),('NPM-03','15R','SMT','8mm',1),
('NPM-03','16R','SMT','8mm',1),('NPM-03','17R','SMT','8mm',1),('NPM-03','18R','SMT','8mm',1),('NPM-03','19R','SMT','8mm',1),('NPM-03','20R','SMT','8mm',1)
ON CONFLICT (machine_code, slot_no) DO NOTHING;

-- ── Feeders: from NPM贴片机+飞达唯一码管理规范.xlsx ───────────────────────────
INSERT INTO feeders (feeder_code, feeder_type, width_mm, status, location_code, total_usage_count, notes) VALUES
-- 8mm电动飞达 FD08001~FD08039
('FD08001','SMT','8mm','available','L001',0,''),
('FD08002','SMT','8mm','available','L001',0,''),
('FD08003','SMT','8mm','available','L001',0,''),
('FD08004','SMT','8mm','available','L001',0,''),
('FD08005','SMT','8mm','available','L001',0,''),
('FD08006','SMT','8mm','available','L001',0,''),
('FD08007','SMT','8mm','available','L001',0,''),
('FD08008','SMT','8mm','available','L001',0,''),
('FD08009','SMT','8mm','available','L001',0,''),
('FD08010','SMT','8mm','available','L001',0,''),
('FD08011','SMT','8mm','available','L001',0,''),
('FD08012','SMT','8mm','available','L001',0,''),
('FD08013','SMT','8mm','available','L001',0,''),
('FD08014','SMT','8mm','available','L001',0,''),
('FD08015','SMT','8mm','available','L001',0,''),
('FD08016','SMT','8mm','available','L001',0,''),
('FD08017','SMT','8mm','available','L001',0,''),
('FD08018','SMT','8mm','available','L001',0,''),
('FD08019','SMT','8mm','available','L001',0,''),
('FD08020','SMT','8mm','available','L001',0,''),
('FD08021','SMT','8mm','available','L001',0,''),
('FD08022','SMT','8mm','available','L001',0,''),
('FD08023','SMT','8mm','available','L001',0,''),
('FD08024','SMT','8mm','available','L001',0,''),
('FD08025','SMT','8mm','available','L001',0,''),
('FD08026','SMT','8mm','available','L001',0,''),
('FD08027','SMT','8mm','available','L001',0,''),
('FD08028','SMT','8mm','available','L001',0,''),
('FD08029','SMT','8mm','available','L001',0,''),
('FD08030','SMT','8mm','available','L001',0,''),
('FD08031','SMT','8mm','available','L001',0,''),
('FD08032','SMT','8mm','available','L001',0,''),
('FD08033','SMT','8mm','available','L001',0,''),
('FD08034','SMT','8mm','available','L001',0,''),
('FD08035','SMT','8mm','available','L001',0,''),
('FD08036','SMT','8mm','available','L001',0,''),
('FD08037','SMT','8mm','available','L001',0,''),
('FD08038','SMT','8mm','available','L001',0,''),
('FD08039','SMT','8mm','available','L001',0,''),
-- 托盘飞达 FD08040
('FD08040','SMT','tray','available','L001',0,'托盘飞达'),
-- 12/16mm电动飞达 FD12001~FD12006
('FD12001','SMT','12/16mm','available','L001',0,''),
('FD12002','SMT','12/16mm','available','L001',1180,'0402/0603物料专用'),
('FD12003','SMT','12/16mm','available','L001',0,''),
('FD12004','SMT','12/16mm','available','L001',0,''),
('FD12005','SMT','12/16mm','available','L001',1200,'0402/0603物料专用'),
('FD12006','SMT','12/16mm','available','L001',0,'')
ON CONFLICT (feeder_code) DO NOTHING;

-- ── fool_proof_rules: SMT binding rules for all NPM machines ──────────────────
-- These rules define the 4-way validation: slot + material must match BOM expectation
-- Rule type: 'feeder_slot_material' means feeder_code+slot must match expected material
INSERT INTO fool_proof_rules (rule_code, rule_name, rule_type, machine_code, feeder_slot, slot_type, expected_material_code, feeder_width, priority, is_active, notes) VALUES
-- NPM-01 SMT rules (example: slot 1L/1R expects specific material patterns)
('FPR-NPM01-1L','NPM-01 1L slot rule','feeder_slot_material','NPM-01','1L','SMT',NULL,'8mm',10,true,'NPM-01 left track slot 1'),
('FPR-NPM01-1R','NPM-01 1R slot rule','feeder_slot_material','NPM-01','1R','SMT',NULL,'8mm',10,true,'NPM-01 right track slot 1'),
('FPR-NPM01-2L','NPM-01 2L slot rule','feeder_slot_material','NPM-01','2L','SMT',NULL,'8mm',10,true,'NPM-01 left track slot 2'),
('FPR-NPM01-2R','NPM-01 2R slot rule','feeder_slot_material','NPM-01','2R','SMT',NULL,'8mm',10,true,'NPM-01 right track slot 2'),
('FPR-NPM02-1L','NPM-02 1L slot rule','feeder_slot_material','NPM-02','1L','SMT',NULL,'8mm',10,true,'NPM-02 left track slot 1'),
('FPR-NPM02-1R','NPM-02 1R slot rule','feeder_slot_material','NPM-02','1R','SMT',NULL,'8mm',10,true,'NPM-02 right track slot 1'),
('FPR-NPM02-2L','NPM-02 2L slot rule','feeder_slot_material','NPM-02','2L','SMT',NULL,'8mm',10,true,'NPM-02 left track slot 2'),
('FPR-NPM02-2R','NPM-02 2R slot rule','feeder_slot_material','NPM-02','2R','SMT',NULL,'8mm',10,true,'NPM-02 right track slot 2'),
('FPR-NPM03-1L','NPM-03 1L slot rule','feeder_slot_material','NPM-03','1L','SMT',NULL,'8mm',10,true,'NPM-03 left track slot 1'),
('FPR-NPM03-1R','NPM-03 1R slot rule','feeder_slot_material','NPM-03','1R','SMT',NULL,'8mm',10,true,'NPM-03 right track slot 1'),
('FPR-NPM03-2L','NPM-03 2L slot rule','feeder_slot_material','NPM-03','2L','SMT',NULL,'8mm',10,true,'NPM-03 left track slot 2'),
('FPR-NPM03-2R','NPM-03 2R slot rule','feeder_slot_material','NPM-03','2R','SMT',NULL,'8mm',10,true,'NPM-03 right track slot 2'),
-- Global SMT feeder type rule: reject non-SMT feeder on SMT slots
('FPR-SMT-TYPE','SMT slot accepts only SMT feeders','feeder_type_match','NPM-01','*','SMT',NULL,NULL,50,true,'Reject non-SMT feeder on SMT line'),
('FPR-SMT-TYPE-NPM02','SMT slot accepts only SMT feeders NPM-02','feeder_type_match','NPM-02','*','SMT',NULL,NULL,50,true,'Reject non-SMT feeder on NPM-02'),
('FPR-SMT-TYPE-NPM03','SMT slot accepts only SMT feeders NPM-03','feeder_type_match','NPM-03','*','SMT',NULL,NULL,50,true,'Reject non-SMT feeder on NPM-03'),
-- Width match rule: feeder width must be compatible with slot expectation
('FPR-WIDTH-8MM','8mm feeder slot','feeder_width_match','NPM-01','*','SMT',NULL,'8mm',20,true,'8mm feeder width validation'),
('FPR-WIDTH-12MM','12/16mm feeder slot','feeder_width_match','NPM-01','*','SMT',NULL,'12/16mm',20,true,'12/16mm feeder width validation')
ON CONFLICT (rule_code) DO NOTHING;

-- commit handled by caller
