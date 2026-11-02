INSERT INTO sys_account (account, password_hash, name, role_code, status, is_first_login)
VALUES
  ('TEST-SQE', 'pbkdf2:sha256:100000:d649888a20beee5a866c5c2f5b869015:6a74b75f1297d53855477c2926f61e51a19ffb5b8169f4458fd111add040c5425b7193b665b5961bcfd6a09064934490b081b038466daeed6e0640ba556a36be', '测试SQE', 'sqe', 'active', false),
  ('TEST-QM',  'pbkdf2:sha256:100000:d649888a20beee5a866c5c2f5b869015:6a74b75f1297d53855477c2926f61e51a19ffb5b8169f4458fd111add040c5425b7193b665b5961bcfd6a09064934490b081b038466daeed6e0640ba556a36be', '测试质量经理', 'quality_manager', 'active', false)
ON CONFLICT (account) DO NOTHING;
SELECT account, name, role_code FROM sys_account WHERE account LIKE 'TEST-%';
