记住测试箱：TST-001..TST-020 / R301..R400 / pallet TEST14 P01-01..P04-02 / 物料 0.12.00.00.0765, 0.12.00.00.0916X, 0.12.01.00.0961X。等用户说清理时执行：
- DELETE FROM material_lots WHERE lot_no LIKE 'TST-%'
- DELETE FROM wms_receiving_pallet_box_bindings WHERE lot_no LIKE 'TST-%'
- DELETE FROM wms_receiving_qr_registrations WHERE lot_no LIKE 'TST-%'
