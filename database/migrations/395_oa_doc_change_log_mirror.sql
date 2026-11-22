-- =============================================================================
-- 395: OA doc_change_log 镜像落点 —— parity 矩阵里唯一没有业务落点的 OA 表
-- =============================================================================
-- 背景（2026-11-22 实测，docs/live-source-parity-2026-11-22.md）：
--   运行中 OA（100.107.212.49:5433 / oa_system）的 public.doc_change_log
--   有 57 行（体系文件字段级修改审计），SMT 侧此前无任何落点 —— 85 张非空
--   OA 源表里唯一一张 ext 有副本、业务表没有的。
--   其余 84 张要么已映射（oa.* / rjvn_*），要么是源系统内部表
--   （schema_migrations=源迁移台账、sys_session=临时会话、
--   _bak_rule_20261026 / sys_module_grant_bak_905=源侧备份残渣）——
--   那四类只保留 ext_oa_src 全量副本，不进业务表，理由见 parity 文档。
--
-- 本表按源形状镜像（id 沿用源 bigint，不生成 uuid；镜像行主键=源主键，
-- converge 的 NOT EXISTS 去重靠它）。无 FK：源里 operator_id 允许指向
-- 已删用户，镜像的职责是「和源一致」，不是「和本地主数据一致」。
-- =============================================================================

CREATE TABLE IF NOT EXISTS oa.doc_change_log (
    id          BIGINT PRIMARY KEY,
    doc_id      BIGINT,
    field       TEXT,
    old_value   TEXT,
    new_value   TEXT,
    source      TEXT,
    operator_id BIGINT,
    reason      TEXT,
    created_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_oa_doc_change_log_doc ON oa.doc_change_log (doc_id);

DO $$
DECLARE
  app_role text := coalesce(nullif(current_setting('smt.app_role', true), ''), 'smt_factory');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE NOTICE 'role % missing; skipping ownership transfer', app_role;
    RETURN;
  END IF;
  EXECUTE format('ALTER TABLE oa.doc_change_log OWNER TO %I', app_role);
END $$;
