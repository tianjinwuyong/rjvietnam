INSERT INTO agv_zones (code, name_zh, zone_type, area, x_coord, y_coord, is_charging, is_parking) VALUES
('ZONE-WH-A', '原材料仓库A区', 'storage', 'Warehouse', 0.00, 0.00, false, false),
('ZONE-WH-B', '原材料仓库B区', 'storage', 'Warehouse', 5.00, 0.00, false, false),
('ZONE-SMT-1', 'SMT线上料区', 'production', 'SMT-A', 10.00, 0.00, false, false),
('ZONE-SMT-2', 'SMT线上料区', 'production', 'SMT-A', 15.00, 0.00, false, false),
('ZONE-FG', '成品暂存区', 'loading', 'Warehouse', 0.00, 10.00, false, false),
('ZONE-CHG-1', 'AGV充电区', 'charging', 'Factory', 20.00, 0.00, true, true),
('ZONE-CHG-2', 'AGV充电区', 'charging', 'Factory', 20.00, 5.00, true, true),
('ZONE-TRANSIT', '过道中转区', 'transit', 'Factory', 10.00, 10.00, false, false)
ON CONFLICT (code) DO NOTHING;
-- Zone ids are resolved by code: hardcoded serial ids break on fresh installs.
INSERT INTO agv_stations (code, name_zh, zone_id, station_type, agv_type_suitable, supports_forklift, supports_shuttle, max_load_kg) VALUES
('ST-CHG-1', '充电站', (SELECT id FROM agv_zones WHERE code='ZONE-CHG-1'), 'charging', 'both', true, true, 2000),
('ST-CHG-2', '充电站', (SELECT id FROM agv_zones WHERE code='ZONE-CHG-2'), 'charging', 'both', true, true, 2000),
('ST-LOAD-WH', '仓库上料站', (SELECT id FROM agv_zones WHERE code='ZONE-WH-A'), 'load', 'shuttle', false, true, 500),
('ST-UNLOAD-SMT1', 'SMT1卸料站', (SELECT id FROM agv_zones WHERE code='ZONE-SMT-1'), 'unload', 'shuttle', false, true, 500),
('ST-UNLOAD-SMT2', 'SMT2卸料站', (SELECT id FROM agv_zones WHERE code='ZONE-SMT-2'), 'unload', 'shuttle', false, true, 500),
('ST-FG-LOAD', '成品装车站', (SELECT id FROM agv_zones WHERE code='ZONE-FG'), 'load', 'forklift', true, false, 1500)
ON CONFLICT (code) DO NOTHING;
INSERT INTO agv_fleet (code, name_zh, agv_type, model, serial_no, status, current_zone_id, x_coord, y_coord, battery_pct, battery_cycle_count, last_heartbeat_at, max_load_kg, max_lift_height_mm, navigation_type) VALUES
('AGV-S01', '潜伏式AGV-S01', 'shuttle', 'Model-X100-Shuttle', 'SN-SH-001', 'idle', (SELECT id FROM agv_zones WHERE code='ZONE-CHG-1'), 20.00, 0.00, 95.5, 45, now(), 500, NULL, 'slam'),
('AGV-S02', '潜伏式AGV-S02', 'shuttle', 'Model-X100-Shuttle', 'SN-SH-002', 'busy', (SELECT id FROM agv_zones WHERE code='ZONE-SMT-1'), 10.00, 0.00, 72.0, 32, now(), 500, NULL, 'slam'),
('AGV-F01', '叉式AGV-F01', 'forklift', 'Model-F200-Forklift', 'SN-FL-001', 'idle', (SELECT id FROM agv_zones WHERE code='ZONE-CHG-2'), 20.00, 5.00, 45.0, 18, now(), 1500, 3000, 'lidar'),
('AGV-F02', '叉式AGV-F02', 'forklift', 'Model-F200-Forklift', 'SN-FL-002', 'maintenance', (SELECT id FROM agv_zones WHERE code='ZONE-TRANSIT'), 10.00, 10.00, 88.0, 22, now(), 1500, 3000, 'lidar')
ON CONFLICT (code) DO NOTHING;
INSERT INTO agv_tasks (task_code, task_type, priority, status, agv_id, from_zone_id, to_zone_id, from_station_id, to_station_id, work_order_id, line_id, load_type, load_kg, created_at, started_at, completed_at, actual_distance_m, actual_duration_s) VALUES
('AGV-T00001', 'material_delivery', 2, 'completed', (SELECT id FROM agv_fleet WHERE code='AGV-S01'), (SELECT id FROM agv_zones WHERE code='ZONE-WH-A'), (SELECT id FROM agv_zones WHERE code='ZONE-SMT-1'), (SELECT id FROM agv_stations WHERE code='ST-LOAD-WH'), (SELECT id FROM agv_stations WHERE code='ST-UNLOAD-SMT1'), NULL, (SELECT id FROM production_lines WHERE internal_code='L001'), 'reel_trolley', 120.0, now()-interval '2 hours', now()-interval '1 hour 50 minutes', now()-interval '1 hour 40 minutes', 14.2, 600),
('AGV-T00002', 'material_delivery', 3, 'in_progress', (SELECT id FROM agv_fleet WHERE code='AGV-S02'), (SELECT id FROM agv_zones WHERE code='ZONE-WH-B'), (SELECT id FROM agv_zones WHERE code='ZONE-SMT-2'), NULL, (SELECT id FROM agv_stations WHERE code='ST-UNLOAD-SMT2'), NULL, (SELECT id FROM production_lines WHERE internal_code='L001'), 'reel_trolley', 95.0, now()-interval '30 minutes', now()-interval '10 minutes', NULL, NULL, NULL),
('AGV-T00003', 'pallet_pickup', 1, 'pending', NULL, (SELECT id FROM agv_zones WHERE code='ZONE-SMT-1'), (SELECT id FROM agv_zones WHERE code='ZONE-FG'), NULL, (SELECT id FROM agv_stations WHERE code='ST-FG-LOAD'), NULL, (SELECT id FROM production_lines WHERE internal_code='L001'), 'pallet', 200.0, now(), NULL, NULL, NULL, NULL),
('AGV-T00004', 'reel_supply', 4, 'pending', NULL, (SELECT id FROM agv_zones WHERE code='ZONE-WH-A'), (SELECT id FROM agv_zones WHERE code='ZONE-SMT-1'), NULL, NULL, NULL, NULL, 'cart', 80.0, now(), NULL, NULL, NULL, NULL),
('AGV-T00005', 'empty_pallet', 5, 'pending', NULL, (SELECT id FROM agv_zones WHERE code='ZONE-SMT-2'), (SELECT id FROM agv_zones WHERE code='ZONE-WH-A'), NULL, NULL, NULL, NULL, 'pallet', 30.0, now(), NULL, NULL, NULL, NULL)
ON CONFLICT (task_code) DO NOTHING;
INSERT INTO agv_task_history (task_code, task_type, priority, status, agv_code, agv_type, from_zone, to_zone, distance_m, duration_s, battery_start_pct, battery_end_pct, outcome, completed_at)
SELECT 'AGV-T00001', 'material_delivery', 2, 'completed', 'AGV-S01', 'shuttle', 'ZONE-WH-A', 'ZONE-SMT-1', 14.2, 600, 100.0, 92.5, 'success', now()-interval '1 hour 40 minutes'
WHERE NOT EXISTS (SELECT 1 FROM agv_task_history WHERE task_code='AGV-T00001');
INSERT INTO agv_alerts (agv_id, agv_code, alert_type, severity, message) VALUES
((SELECT id FROM agv_fleet WHERE code='AGV-F01'), 'AGV-F01', 'low_battery', 'warning', 'Battery at 45% - below threshold 50%'),
((SELECT id FROM agv_fleet WHERE code='AGV-F02'), 'AGV-F02', 'maintenance_due', 'info', 'Scheduled maintenance due - 500 hours reached'),
((SELECT id FROM agv_fleet WHERE code='AGV-S02'), 'AGV-S02', 'task_timeout', 'warning', 'Task AGV-T00002 in progress > 20 minutes')
ON CONFLICT DO NOTHING;
