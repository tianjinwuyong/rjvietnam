-- ============================================================================
-- 修复 mrb_reviewer.reviewer_id 存成「工号」而非账号 UUID 的存量脏数据
-- 日期：2026-10-18
-- 背景（用户反馈「提交MRB失败」）：
--   mrb_reviewer.reviewer_id 是 PG 复合类型 user_profile，其 user_id 字段语义是
--   sys_account.id(UUID)。旧版前端指派评审员时是手填文本框，员工习惯填工号
--   （如 RJ100），于是库里存成了 (RJ100)；而提交评审时后端用登录态的
--   userId(UUID) 去比对，永远匹配不上 → 报「您不是该MRB的评审人员」，提交失败。
-- 修法：把 user_id 不是合法 uuid 的行，按 sys_account.account 反查并改写为 UUID。
-- 幂等：重复执行不会重复改写（改写后 user_id 已是 uuid，不再命中更新条件）。
-- ============================================================================

DO $$
BEGIN
  -- 仅在列类型确为 user_profile 时执行，避免误伤其它部署
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mrb_reviewer'
      AND column_name = 'reviewer_id'
      AND udt_name = 'user_profile'
  ) THEN
    UPDATE mrb_reviewer r
    SET reviewer_id = ROW(sa.id::text)::user_profile
    FROM sys_account sa
    WHERE sa.account = (r.reviewer_id).user_id
      AND (r.reviewer_id).user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    RAISE NOTICE 'mrb_reviewer.reviewer_id 工号→UUID 修正完成';
  ELSE
    RAISE NOTICE 'mrb_reviewer.reviewer_id 不是 user_profile 类型，跳过修正';
  END IF;
END $$;
