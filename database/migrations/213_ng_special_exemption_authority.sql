BEGIN;

INSERT INTO positions(code, department_id, name_zh, name_en, name_vi, position_level, level, is_shift_leader, status)
SELECT 'LINE-LEADER', d.id, '线长', 'Line Leader', 'Trưởng chuyền', 'SUPERVISOR', 3, TRUE, 'active'
FROM departments d WHERE d.code='SMT'
ON CONFLICT(code) DO UPDATE SET
  name_zh=EXCLUDED.name_zh, name_en=EXCLUDED.name_en, name_vi=EXCLUDED.name_vi,
  is_shift_leader=TRUE, status='active', updated_at=NOW();

INSERT INTO users(username, display_name, role_id, locale, status)
SELECT 'HWG', '黄文钢', r.id, 'zh-CN', 'active'
FROM roles r WHERE r.code='management'
ON CONFLICT(username) DO UPDATE SET display_name='黄文钢', status='active', updated_at=NOW();

INSERT INTO employees(employee_no, code, user_id, department_id, position_id,
  full_name, full_name_zh, full_name_en, full_name_vi,
  display_name, name_zh, name_en, name_vi, employment_type, hire_date, work_location, status)
SELECT 'HWG', 'HWG', u.id, d.id, p.id,
  '黄文钢', '黄文钢', 'Huang Wengang', 'Huang Wengang',
  '黄文钢', '黄文钢', 'Huang Wengang', 'Huang Wengang', 'full_time', CURRENT_DATE, 'Vietnam Factory', 'active'
FROM users u
JOIN departments d ON d.code='SMT'
JOIN positions p ON p.code='LINE-LEADER'
WHERE u.username='HWG'
ON CONFLICT(employee_no) DO UPDATE SET
  code='HWG', user_id=EXCLUDED.user_id, department_id=EXCLUDED.department_id,
  position_id=EXCLUDED.position_id, full_name='黄文钢', full_name_zh='黄文钢',
  display_name='黄文钢', name_zh='黄文钢', status='active', updated_at=NOW();

CREATE TABLE IF NOT EXISTS ng_special_exemptions (
  exemption_id BIGSERIAL PRIMARY KEY,
  sn VARCHAR(160) NOT NULL,
  source_station VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  approved_by_user_id BIGINT NOT NULL REFERENCES users(id),
  approved_by_username VARCHAR(80) NOT NULL,
  approved_by_name VARCHAR(160) NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  used_at TIMESTAMPTZ,
  used_station VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ng_special_exemptions_source_ck CHECK (source_station IN ('manu_supersonic','auto_supersonic','supersonic')),
  CONSTRAINT ng_special_exemptions_status_ck CHECK (status IN ('ACTIVE','USED','EXPIRED','REVOKED'))
);
CREATE INDEX IF NOT EXISTS idx_ng_special_exemptions_sn_active
  ON ng_special_exemptions(UPPER(sn), expires_at DESC) WHERE status='ACTIVE';

COMMIT;
