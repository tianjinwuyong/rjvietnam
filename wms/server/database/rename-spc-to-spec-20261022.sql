-- ============================================================
-- IQC 字段拼写统一：spc → spec
-- 生成日期：2026-10-22
-- 背景：早期录入笔误把 Spec 写成 Spc，导致数据库列名、服务端读写、
--       前端字段名三处不一致（写入用 spc、读取映射成 spec），
--       表现为「Spec 列输入后不显示 / 报告 Spec 空格」。
-- 本脚本将 3 张表的列名与草稿 JSON 内的历史键统一改为 spec。
--
-- 幂等：可重复执行（已改过的表会跳过）
-- 回滚：见文件末尾 ROLLBACK 段（注释状态，按需启用）
-- ============================================================

BEGIN;

-- ---------- 1. 表列重命名 ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iqc_template_item' AND column_name = 'spc'
  ) THEN
    ALTER TABLE iqc_template_item RENAME COLUMN spc TO spec;
    RAISE NOTICE 'iqc_template_item.spc -> spec 完成';
  ELSE
    RAISE NOTICE 'iqc_template_item 已是 spec，跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iqc_standard_item' AND column_name = 'spc'
  ) THEN
    ALTER TABLE iqc_standard_item RENAME COLUMN spc TO spec;
    RAISE NOTICE 'iqc_standard_item.spc -> spec 完成';
  ELSE
    RAISE NOTICE 'iqc_standard_item 已是 spec，跳过';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'iqc_inspection_record' AND column_name = 'spc'
  ) THEN
    ALTER TABLE iqc_inspection_record RENAME COLUMN spc TO spec;
    RAISE NOTICE 'iqc_inspection_record.spc -> spec 完成';
  ELSE
    RAISE NOTICE 'iqc_inspection_record 已是 spec，跳过';
  END IF;
END $$;

-- ---------- 2. 检验草稿 JSON 内的历史键 records[].spc → records[].spec ----------
-- 草稿是 jsonb，列重命名管不到，必须单独搬键，否则历史草稿打开后 Spec 列仍为空。
UPDATE iqc_inspection_draft d
SET payload = jsonb_set(
      d.payload,
      '{records}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN e ? 'spc'
                     THEN (e - 'spc') || jsonb_build_object('spec', e -> 'spc')
                   ELSE e
                 END
                 ORDER BY t.ord
               )
        FROM jsonb_array_elements(d.payload -> 'records') WITH ORDINALITY AS t(e, ord)
      )
    )
WHERE jsonb_typeof(d.payload -> 'records') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(d.payload -> 'records') AS e
    WHERE e ? 'spc'
  );

COMMIT;

-- ---------- 3. 校验（执行后手工跑一遍） ----------
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE table_schema='public' AND column_name IN ('spc','spec') ORDER BY 1,2;
-- 期望：只剩 3 行 spec，0 行 spc
--
-- SELECT count(*) FROM iqc_inspection_draft
--  WHERE payload::text LIKE '%"spc"%';
-- 期望：0

-- ============================================================
-- ROLLBACK（如需回退，整段取消注释执行）
-- ============================================================
-- BEGIN;
-- ALTER TABLE iqc_template_item    RENAME COLUMN spec TO spc;
-- ALTER TABLE iqc_standard_item    RENAME COLUMN spec TO spc;
-- ALTER TABLE iqc_inspection_record RENAME COLUMN spec TO spc;
-- UPDATE iqc_inspection_draft d
-- SET payload = jsonb_set(d.payload, '{records}',
--       (SELECT jsonb_agg(CASE WHEN e ? 'spec'
--                              THEN (e - 'spec') || jsonb_build_object('spc', e -> 'spec')
--                              ELSE e END ORDER BY t.ord)
--        FROM jsonb_array_elements(d.payload -> 'records') WITH ORDINALITY AS t(e, ord)))
-- WHERE jsonb_typeof(d.payload -> 'records') = 'array'
--   AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.payload -> 'records') AS e WHERE e ? 'spec');
-- COMMIT;
