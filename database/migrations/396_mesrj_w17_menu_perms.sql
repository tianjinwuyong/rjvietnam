-- mesrj W17：ruijing-mes 残余 10 屏的叶子菜单权限码（menu.<code>）
-- 背景：/menu 端点用 sys_perm 里 "menu.%" 的已知集合决定是否启用页面级权限过滤
--       （routes/mesrj.js，函数 createMesrjRouter 内 GET /menu）。菜单叶子已在
--       src/mesrj/menu.js 落地（源 api/sys.py MENU 逐字位置），这里只补权限码，
--       不建角色、不授权：授予仍走 sys.role 页面，管理员（roleKey=ADMIN）本就直通。
-- 标准：docs/grafting-standards.md §5（append-only、幂等）；模式同 315_mesrj_menu_perms.sql。
-- 幂等：ON CONFLICT (perm_code) DO NOTHING
INSERT INTO sys_perm (perm_code, perm_name, module, remark) VALUES
  ('menu.exec.ultra', '超声工位看板', 'mesrj-mes', '生产执行 / 超声工位看板'),
  ('menu.exec.ultraparam', '超声参数维护', 'mesrj-mes', '生产执行 / 超声参数维护'),
  ('menu.exec.teardown', '拆壳返工', 'mesrj-mes', '生产执行 / 拆壳返工'),
  ('menu.exec.agingctl', '老化时效', 'mesrj-mes', '品质与追溯 / 老化时效'),
  ('menu.exec.lasercheck', '镭雕回读核对', 'mesrj-mes', '品质与追溯 / 镭雕回读核对'),
  ('menu.prod.shelflife', '成品库龄', 'mesrj-mes', '品质与追溯 / 成品库龄'),
  ('menu.cfg.calib', '仪器校准台账', 'mesrj-mes', '设备管理 / 仪器校准台账'),
  ('menu.md.fixture', '治具台账', 'mesrj-mes', '设备管理 / 治具台账'),
  ('menu.report.stboard', '工位质量看板', 'mesrj-mes', '报表与看板 / 工位质量看板'),
  ('menu.sys.dept', '组织架构', 'mesrj-mes', '系统管理 / 组织架构')
ON CONFLICT (perm_code) DO NOTHING;
