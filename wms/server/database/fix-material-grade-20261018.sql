-- 物料「等级」列（2026-10-18）
--
-- 背景：用户要求主数据导入时「等级」为必填字段（与 MSL 防潮等级不同的维度）。
-- 为什么必须写这个脚本：init-db 只在空库执行 drizzle-kit push，
-- 直接改 schema.ts 对存量库不生效（DDL 漂移）——F-10 就是这么来的。
-- 幂等：IF NOT EXISTS 判列存在，可随每次启动安全重跑。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'material' AND column_name = 'grade'
  ) THEN
    ALTER TABLE public.material ADD COLUMN grade varchar(50);
    RAISE NOTICE '[fix-material-grade] 已为 material 增加 grade（等级）列';
  ELSE
    RAISE NOTICE '[fix-material-grade] material.grade 已存在，跳过';
  END IF;
END $$;
