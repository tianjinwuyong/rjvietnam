-- W10b：mesrj 权限码种子（sys_perm）
--
-- 背景（缺陷修复，非新功能）：
--   mesrj 的权限判定完全依赖 sys_perm / sys_role_perm / sys_user_role 三张表，
--   但这三张表**从未播种**：
--     · /sys/perm/tree（角色授权页的可选项来源）返回空 → 管理员在 UI 上
--       根本勾不出任何权限（POST /sys/role/:rid/perms 要按 perm_code 反查
--       sys_perm.id，查不到就跳过）；
--     · 菜单过滤按 group.perm / child.perm 判定 → 非管理员一律 403。
--   源系统的权限码是运维脚本（工具\运维\perm_page_level.py）往**生产 SQLite**
--   里灌的，仓库里没有种子文件，所以 W1 迁表时漏掉了。
--
-- 本迁移只播种**权限码字典**（sys_perm），不预设任何角色与人员授权：
--   角色由管理员在 mesrj「系统管理 → 角色权限」里建，人员授权同理由
--   「系统管理 → 用户」分配 —— 这正是 mesrj.js 注释里写的
--   「首个接入的管理员在 mesrj 给自己授权」的引导路径。
--
-- 权限码清单来自代码实际检查点（requireMesrjPerm(...) 与 menu.js 的 perm/perm_any），
-- 一一对应，不多不少：36 项。

INSERT INTO sys_perm (perm_code, perm_name, module, remark) VALUES
  -- 主数据
  ('md.view',          '主数据查看',   '主数据', '物料/产品/客户/产线/工位等'),
  ('md.edit',          '主数据维护',   '主数据', '主数据增删改'),
  ('md.station.edit',  '工位维护',     '主数据', '工位规则与防呆配置'),
  ('bom.view',         'BOM 查看',     '主数据', 'BOM 版本与明细'),
  ('bom.edit',         'BOM 维护',     '主数据', 'BOM 版本与明细'),
  ('bom.import',       'BOM 导入',     '主数据', 'BOM 批量导入'),
  ('cfg.view',         '配置查看',     '配置',   '配置中心'),
  ('cfg.edit',         '配置维护',     '配置',   '配置中心'),
  ('route.view',       '工艺路线查看', '工艺',   '工艺路线/工位'),
  ('route.edit',       '工艺路线维护', '工艺',   '工艺路线/工位'),
  -- 计划
  ('plan.view',        '排产查看',     '计划',   '排产看板/计划'),
  ('plan.edit',        '排产维护',     '计划',   '排产看板/计划'),
  ('po.view',          '客户 PO 查看', '计划',   '客户 PO'),
  ('mo.view',          '工单查看',     '计划',   '生产工单'),
  ('mo.create',        '工单创建',     '计划',   '生产工单'),
  ('mo.edit',          '工单维护',     '计划',   '生产工单'),
  ('issue.view',       '领料单查看',   '计划',   '领料/发料'),
  ('issue.create',     '领料单创建',   '计划',   '领料/发料'),
  ('issue.confirm',    '领料单确认',   '计划',   '领料/发料'),
  -- 生产
  ('prod.view',        '生产看板查看', '生产',   '生产总览'),
  ('prod.pass',        '过站作业',     '生产',   '扫码过站/跳站'),
  ('prod.trace',       '追溯与作业登记','生产',  '辅料/品质/工程变更等作业与追溯'),
  ('prod.release',     '放行与审批',   '生产',   '放行单/ECN 审批关闭'),
  ('prod.bind',        '绑码作业',     '生产',   '绑码'),
  ('prod.defect',      '不良处理',     '生产',   '不良记录'),
  ('prod.repair',      '维修作业',     '生产',   '维修'),
  ('prod.scrap',       '报废作业',     '生产',   '报废'),
  ('prod.skip',        '跳站',         '生产',   '跳站'),
  ('prod.void',        '作废',         '生产',   '作废'),
  ('prod.pack',        '包装作业',     '生产',   '装箱/栈板'),
  ('prod.route.change','路线变更',     '生产',   '工位路线变更'),
  -- 系统
  ('sys.user.view',    '用户查看',     '系统',   '用户与角色'),
  ('sys.user.edit',    '用户维护',     '系统',   '用户与角色'),
  ('sys.role.edit',    '角色授权',     '系统',   '角色权限'),
  ('sys.log.view',     '操作日志查看', '系统',   '操作日志'),
  ('sys.param.edit',   '系统参数维护', '系统',   '系统参数')
ON CONFLICT (perm_code) DO NOTHING;
