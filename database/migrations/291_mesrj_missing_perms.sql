-- W12: 补齐缺失的权限码 prod.panel
INSERT INTO sys_perm (perm_code, perm_name, module, remark) VALUES
  ('prod.panel', '面板/分板', '生产', '拼版分板、布局匹配、老化查询')
ON CONFLICT (perm_code) DO NOTHING;