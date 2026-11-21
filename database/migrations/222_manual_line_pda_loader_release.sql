-- Register the signed manual-line PDA artifact in the MES managed-app registry.
-- MES remains the authority for the profile, permissions, and line assignment.
BEGIN;

UPDATE pda_managed_apps
SET name_zh = '手动线 PDA 扫码上料',
    name_en = 'Manual Line PDA Material Loading',
    name_vi = 'PDA nạp vật liệu dây chuyền thủ công',
    app_type = 'ANDROID_APK',
    target_platform = 'Android 11+',
    description = 'Manual-line PDA for machine/channel/feeder/material scanning and MES material usage reporting.',
    source_path = '004-手动线/(01)PDA扫码上料/SMT-PDA-Material-Loading-v1.0.10.apk',
    current_version = '1.0.10',
    release_notes = 'Registered release APK for the MANUAL domain; SHA-256 is recorded after build.',
    associated_lines = ARRAY['MANUAL'],
    app_status = 'ACTIVE',
    notes = 'MES assigns the versioned PdaProfile after device/operator registration; no local approval authority.'
WHERE app_code = 'MANUAL-LINE-PDA';

-- Keep deployments explicit if an older database has not seeded MANUAL-LINE-PDA.
INSERT INTO pda_managed_apps (
  app_code, name_zh, name_en, name_vi, app_type, target_platform, description,
  source_path, current_version, release_notes, associated_lines, app_status, notes
)
SELECT
  'MANUAL-LINE-PDA', '手动线 PDA 扫码上料', 'Manual Line PDA Material Loading',
  'PDA nạp vật liệu dây chuyền thủ công', 'ANDROID_APK', 'Android 11+',
  'Manual-line PDA for machine/channel/feeder/material scanning and MES material usage reporting.',
  '004-手动线/(01)PDA扫码上料/SMT-PDA-Material-Loading-v1.0.10.apk', '1.0.10',
  'Registered release APK for the MANUAL domain; SHA-256 is recorded after build.',
  ARRAY['MANUAL'], 'ACTIVE',
  'MES assigns the versioned PdaProfile after device/operator registration; no local approval authority.'
WHERE NOT EXISTS (SELECT 1 FROM pda_managed_apps WHERE app_code = 'MANUAL-LINE-PDA');

COMMIT;
