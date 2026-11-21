BEGIN;

INSERT INTO training_videos
  (video_code, title_zh, title_en, title_vi, business_domain, topic_code,
   language_code, version_no, file_url, mime_type, duration_seconds, tags,
   status, approved_at)
VALUES
  ('HR-EMP-FACE-REG', '员工登记与人脸录入操作教程',
   'Employee Registration and Face Enrollment',
   'Hướng dẫn đăng ký nhân viên và khuôn mặt',
   'HR', 'EMPLOYEE_REGISTRATION', 'zh-CN', 1,
   '/uploads/training/员工登记与人脸录入操作教程.mp4',
   'video/mp4', 30,
   '["员工登记","人脸录入","手机录入","快速登录","人事部","PDA","employee","face"]'::jsonb,
   'PUBLISHED', now())
ON CONFLICT (video_code, language_code, version_no) DO UPDATE SET
  file_url = EXCLUDED.file_url,
  tags = EXCLUDED.tags,
  status = 'PUBLISHED',
  approved_at = COALESCE(training_videos.approved_at, now()),
  updated_at = now();

INSERT INTO training_video_page_links(video_id, route_key, sort_order)
SELECT id, route_key, sort_order
FROM training_videos
CROSS JOIN (VALUES
  ('hr.employees', 0),
  ('hr.training', 1),
  ('pda.quick-login', 2)
) AS routes(route_key, sort_order)
WHERE video_code = 'HR-EMP-FACE-REG'
  AND language_code = 'zh-CN'
  AND version_no = 1
ON CONFLICT(video_id, route_key) DO UPDATE SET sort_order = EXCLUDED.sort_order;

INSERT INTO _migrations(filename, hash)
VALUES ('173_seed_employee_registration_video.sql', 'seed-employee-face-registration-video-v1')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
