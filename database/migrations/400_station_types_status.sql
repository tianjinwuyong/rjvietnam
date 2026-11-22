-- =============================================================================
-- 400: station_types 补 status 列（server.js 的 CRUD 一直在读写它）
-- =============================================================================
-- GET/POST/PUT/DELETE /mes/station-types 的 SQL 都带 status 列（软删写
-- 'inactive'），但建表迁移从未创建它 —— GET 直接 500「字段 "status" 不存在」
-- （api-8080 死前日志里反复出现）。补列，默认 active，与既有软删语义一致。

BEGIN;

ALTER TABLE station_types
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active';

COMMENT ON COLUMN station_types.status IS 'active / inactive（DELETE 走软删，置 inactive）';

COMMIT;
