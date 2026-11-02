-- =============================================================================
-- 2026-10-18  主数据 _updated_at 自动维护
--
-- 背景：应用层所有 update / upsert 的 set 里都没有写 _updated_at，
--       导致数据被改过之后时间戳仍停留在创建时间。
--       本次供应商名称被导入覆写时，正是因此无法从时间戳判断"数据到底动过没有"，
--       排查时一度误判为"数据从未变化"。
--
-- 方案：在数据库层统一挂 BEFORE UPDATE 触发器，任何写入路径
--       （接口 / 批量导入 / SQL 脚本 / 运维手改）都会自动刷新 _updated_at。
--       应用层无需再逐个补 set，也不会遗漏。
--
-- 幂等：可重复执行。
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at_column() RETURNS trigger AS $$
BEGIN
  NEW._updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
  cnt int := 0;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = '_updated_at'
      AND tb.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION set_updated_at_column()', t);
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE '已为 % 张表挂载 _updated_at 自动更新触发器', cnt;
END $$;

-- 校验：列出已挂载的表数量
SELECT COUNT(*) AS tables_with_trigger
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name = 'trg_set_updated_at';
