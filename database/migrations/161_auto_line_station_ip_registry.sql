-- Canonical automatic-line station addresses.
-- PDA loading remains a non-station client and therefore has no stations row.
UPDATE stations AS s
SET ip_address = v.ip_address,
    updated_at = NOW()
FROM (VALUES
  ('auto_aio',            '192.168.6.50'),
  ('auto_ict',            '192.168.6.51'),
  ('auto_fct',            '192.168.6.52'),
  ('auto_depanel',        '192.168.6.53'),
  ('auto_shellbinding',   '192.168.6.54'),
  ('auto_assem_ate',      '192.168.6.55'),
  ('auto_supersonic',     '192.168.6.56'),
  ('auto_agingcab',       '192.168.6.57'),
  ('auto_hivolt_ate',     '192.168.6.58'),
  ('auto_package_ate',    '192.168.6.59'),
  ('auto_case_binding',   '192.168.6.61'),
  ('auto_pallet_binding', '192.168.6.62')
) AS v(code, ip_address)
WHERE s.code = v.code;
