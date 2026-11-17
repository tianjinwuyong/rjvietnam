-- Retire the obsolete per-line material-loader APK registrations.
-- The factory uses one unified PDA with line-domain profiles.
BEGIN;

DELETE FROM pda_managed_apps
 WHERE app_code IN ('SMT-PDA-LOADER', 'AUTO-LINE-PDA', 'MANUAL-LINE-PDA');

INSERT INTO pda_managed_apps
  (app_code, name_zh, name_en, name_vi, app_type, target_platform,
   description, source_path, current_version, associated_lines, app_status,
   notes, created_by)
VALUES
  ('UNIFIED-PDA', '统一工厂 PDA', 'Unified Factory PDA', 'PDA nhà máy thống nhất',
   'CAPACITOR_APP', 'Android 11+',
   'One APK with MES-controlled SMT, auto-line, and manual-line profiles.',
   'apps/pdas/scanner-terminal', '1.0.0',
   ARRAY['SMT', 'AUTO', 'MANUAL'], 'ACTIVE',
   'Select the line domain after login; do not install separate line APKs.',
   'SYSTEM')
ON CONFLICT (app_code) DO UPDATE SET
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi,
  app_type = EXCLUDED.app_type,
  target_platform = EXCLUDED.target_platform,
  description = EXCLUDED.description,
  source_path = EXCLUDED.source_path,
  associated_lines = EXCLUDED.associated_lines,
  app_status = EXCLUDED.app_status,
  notes = EXCLUDED.notes,
  updated_at = NOW();

COMMIT;
