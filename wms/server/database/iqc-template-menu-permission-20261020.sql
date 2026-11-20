-- ============================================================================
-- 质量经理 / IQC 主管 补齐 IQC 菜单权限（2026-10-20）
--
-- 现象：质量经理账号打开「IQC → 检验报告模板」显示「网络错误，请稍后再试」。
-- 实际不是网络故障，是模板页的权限守卫 hasPermission('/iqc/template') 未通过：
--   质量经理角色 menu_permissions 为空数组 → 前端回退到静态权限表，
--   而静态表里 /iqc/template 只配了 admin / iqc_manager。
--
-- 处理：给两个质量岗位补齐 IQC 全部页面权限（含模板、标准库、检验严格度、
-- 产线退料待检、供应商欠料台账）。采用并集写法，不覆盖已有自定义权限，可重复执行。
-- ============================================================================

BEGIN;

UPDATE sys_role
   SET menu_permissions = ARRAY(
     SELECT DISTINCT unnest(
       COALESCE(menu_permissions, ARRAY[]::text[])
       || ARRAY[
         '/iqc', '/iqc/pending', '/iqc/record', '/iqc/report', '/iqc/template',
         '/iqc/standard-library', '/iqc/stats', '/iqc/strictness',
         '/iqc/production-return-pending', '/iqc/supplier-debt'
       ]::text[]
     )
   )
 WHERE role_code IN ('iqc_manager', 'quality_manager');

COMMIT;

-- 校验：两个角色都应包含 /iqc/template 与 /iqc/strictness
-- SELECT role_code, menu_permissions FROM sys_role
--  WHERE role_code IN ('iqc_manager','quality_manager');
