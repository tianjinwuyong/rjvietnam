-- Seed 016: Fool-proof rules, first-article inspections, material verifications
-- Station IDs: AOI-01=9, ICT-01=13, FCT-01=14
-- Line IDs: L001=SMT-LINE=1, L002=AUTO-LINE=2
-- Work order IDs: 26061020007=14, 26061030009=15
begin;

-- ── Fool-Proof Rules ────────────────────────────────────────────────────────
insert into fool_proof_rules (station_id, line_id, feeder_slot, material_id, material_reel_code, rule_type, notes, created_by) values
(9, 1, 'F01', NULL, 'REEL-A0001', 'material', 'AOI-01 feeder 1 material rule', 'VN_OP_001'),
(9, 1, 'F02', NULL, 'REEL-A0002', 'both',    'AOI-01 feeder 2 dual verification', 'VN_OP_001'),
(13, 2, 'F01', NULL, 'REEL-B0001', 'material', 'ICT-01 feeder 1 material rule', 'VN_OP_001'),
(14, 2, 'F01', NULL, 'REEL-C0001', 'reel',     'FCT-01 feeder 1 reel only', 'VN_OP_001');

-- ── First Article Inspections ───────────────────────────────────────────────
insert into first_article_inspections (work_order_id, station_id, line_id, result, checked_by, checked_at, lot_no, remarks) values
(14, 9, 1, 'PASS', 'VN_QC_001', '2025-07-01 08:00:00', 'LOT-20250701-A', 'First article OK'),
(14, 13, 2, 'PASS', 'VN_QC_001', '2025-07-01 08:30:00', 'LOT-20250701-A', 'ICT check OK'),
(15, 9, 1, 'FAIL', 'VN_QC_002', '2025-07-02 09:00:00', 'LOT-20250702-B', 'Material position mismatch');

insert into first_article_check_items (inspection_id, check_type, material_code, expected_value, actual_value, result, notes) values
(1, 'bom_match', 'MAT-001', 'EPS48R1-36', 'EPS48R1-36', 'PASS', NULL),
(1, 'direction', 'MAT-001', '正向', '正向', 'PASS', NULL),
(2, 'bom_match', 'MAT-002', 'CAP-10uF', 'CAP-10uF', 'PASS', NULL),
(3, 'position', 'MAT-003', 'X=10 Y=20', 'X=12 Y=20', 'FAIL', 'Position offset detected');

-- ── Material Verifications ──────────────────────────────────────────────────
insert into material_verifications (work_order_id, line_id, station_id, feeder_slot, material_code, expected_reel, actual_reel, match_result, verified_by) values
(14, 1, 9, 'F01', 'MAT-001', 'REEL-A0001', 'REEL-A0001', 'PASS', 'VN_OP_001'),
(14, 1, 9, 'F02', 'MAT-002', 'REEL-A0002', 'REEL-A0002', 'PASS', 'VN_OP_001'),
(14, 2, 13, 'F01', 'MAT-003', 'REEL-B0001', 'REEL-B0002', 'FAIL', 'VN_OP_001'),
(15, 1, 14, 'F01', 'MAT-004', 'REEL-C0001', 'REEL-C0001', 'PASS', 'VN_OP_002');

commit;