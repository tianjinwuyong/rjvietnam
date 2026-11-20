-- 315: 补齐 legacy 现场参数（源 run.py / api/exec.py / core/*.py 里的 get_param 键）
-- 这些键在原系统里是「有默认值、能被现场改」的开关；新库缺行时页面看不到，
-- 现场只能改代码。这里按原默认值补行（已有行不动，避免覆盖现场调过的值）。
INSERT INTO sys_param (param_key, param_val, param_name, group_name, remark) VALUES
  ('pallet.check_ng',      '1',     '上栈板前查未处理不良', '防呆 · 装箱与栈板', '1=外箱里有未处理不良的 SN 不许上栈板'),
  ('emp.require_emp',      '0',     '过站必须识别工号',     '防呆 · 员工工号',   '1=设备过站没带工号直接拒收'),
  ('laser.keep_alive',     '0',     '镭雕保持长连接',       '镭雕发码',          '1=发完不主动关连接'),
  ('laser.close_drain_ms', '',      '镭雕断开前等待毫秒',   '镭雕发码',          '留空按 200ms'),
  ('oqc.aql_level',        'II',    '默认检验水平',         'OQC AQL',           'I/II/III'),
  ('oqc.aql_severity',     'normal','默认检验严格度',       'OQC AQL',           'normal/tightened/reduced'),
  ('oqc.aql_ma',           '1.0',   '默认 AQL（主要）',     'OQC AQL',           ''),
  ('oqc.aql_mi',           '2.5',   '默认 AQL（次要）',     'OQC AQL',           ''),
  ('oqc.aql_lot_basis',    'pallet','AQL 批量口径',         'OQC AQL',           'pallet/box'),
  ('oqc.sample_boxes',     '',      '抽检箱数',             'OQC AQL',           '留空按抽样方案自动算'),
  ('spc.lsl',              '',      'SPC 控制下限',         '报表 · SPC',        '留空不判'),
  ('spc.usl',              '',      'SPC 控制上限',         '报表 · SPC',        '留空不判'),
  ('alert.scan_minutes',   '10',    '预警巡检间隔（分钟）', '预警中心',          '源 run.py alert 扫描线程')
ON CONFLICT (param_key) DO NOTHING;
