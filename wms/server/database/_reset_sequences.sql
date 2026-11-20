-- ============================================================
-- 单据号序列重置
-- 生成时间：2026-10-16
-- 背景：TRUNCATE ... RESTART IDENTITY 只重置「表自带自增列」，
--       单据号走的是独立 CREATE SEQUENCE 建的 19 个序列，需单独重置。
-- 效果：下一个单据号从 1 开始（is_called=false，nextval 首次返回 1）
-- ============================================================

DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename LOOP
    EXECUTE format('ALTER SEQUENCE public.%I RESTART WITH 1', r.sequencename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '已重置序列数: %', n;
END $$;
