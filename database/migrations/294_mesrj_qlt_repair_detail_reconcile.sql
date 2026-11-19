-- 293: reconcile `qlt_repair_detail` with repair-core.ensureSchema().
--
-- The live table pre-existed with the legacy 11-column shape
-- (id, sn, station_code, defect_code, defect_desc, result, root_cause, action,
--  repair_by, repair_time, remark), so 289's `CREATE TABLE IF NOT EXISTS` was a
-- no-op and repair-core's runtime DDL never ran either. `qlt_repair_part` and
-- `cfg_repair_disposition` only ever existed via runtime DDL, so they are
-- mirrored here as well.
--
-- Idempotent. `qlt_repair_detail` has 0 rows, so the repair_time type change is
-- free. `repair_time` is normalised to text because the runtime schema declares
-- text and createDetail() writes 'YYYY-MM-DD HH:MM:SS' strings; a timestamptz
-- column would hand the API a JS Date which the UI renders with .slice().

-- ── qlt_repair_detail：补齐 repair-core 需要的列 ────────────────────────────
ALTER TABLE qlt_repair_detail
    ADD COLUMN IF NOT EXISTS repair_no          text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS mo_no              text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS handover_no        text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS defect_station     text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS defect_name        text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS designator         text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS defect_phenomenon  text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS defect_qty         integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS disposition        text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS photos             text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS verify_source      text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS verify_status      text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS verify_ref         text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS verify_by          text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS verify_time        text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS verify_reason      text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS created_at         text    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS updated_at         text    NOT NULL DEFAULT '';

-- repair_time：timestamptz -> text（与 runtime DDL / createDetail 写入值一致）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'qlt_repair_detail'
           AND column_name  = 'repair_time'
           AND data_type   <> 'text'
    ) THEN
        ALTER TABLE qlt_repair_detail
            ALTER COLUMN repair_time TYPE text
            USING CASE WHEN repair_time IS NULL THEN ''
                       ELSE to_char(repair_time, 'YYYY-MM-DD HH24:MI:SS') END;
    END IF;
END $$;

ALTER TABLE qlt_repair_detail ALTER COLUMN repair_time SET DEFAULT '';
UPDATE qlt_repair_detail SET repair_time = '' WHERE repair_time IS NULL;
ALTER TABLE qlt_repair_detail ALTER COLUMN repair_time SET NOT NULL;

-- 单号唯一（空串不参与：导入的历史行可能没有单号）
CREATE UNIQUE INDEX IF NOT EXISTS ux_qlt_repair_detail_no
    ON qlt_repair_detail (repair_no) WHERE repair_no <> '';

CREATE INDEX IF NOT EXISTS idx_rd_sn     ON qlt_repair_detail (sn);
CREATE INDEX IF NOT EXISTS idx_rd_status ON qlt_repair_detail (verify_status);
CREATE INDEX IF NOT EXISTS idx_rd_time   ON qlt_repair_detail (repair_time);

-- ── qlt_repair_part：换料明细（runtime DDL 镜像）────────────────────────────
CREATE TABLE IF NOT EXISTS qlt_repair_part (
    id            bigserial PRIMARY KEY,
    repair_no     text    NOT NULL,
    sn            text    NOT NULL DEFAULT '',
    designator    text    NOT NULL DEFAULT '',
    material_code text    NOT NULL DEFAULT '',
    material_name text    NOT NULL DEFAULT '',
    batch_no      text    NOT NULL DEFAULT '',
    lot_no        text    NOT NULL DEFAULT '',
    dc_code       text    NOT NULL DEFAULT '',
    qty           integer NOT NULL DEFAULT 1,
    maker         text    NOT NULL DEFAULT '',
    operator      text    NOT NULL DEFAULT '',
    remark        text    NOT NULL DEFAULT '',
    created_at    text    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_rp_no  ON qlt_repair_part (repair_no);
CREATE INDEX IF NOT EXISTS idx_rp_sn  ON qlt_repair_part (sn);
CREATE INDEX IF NOT EXISTS idx_rp_mat ON qlt_repair_part (material_code);

-- ── cfg_repair_disposition：处置方式字典（runtime DDL 镜像）─────────────────
CREATE TABLE IF NOT EXISTS cfg_repair_disposition (
    id        bigserial PRIMARY KEY,
    code      text    NOT NULL UNIQUE,
    name_cn   text    NOT NULL DEFAULT '',
    name_en   text    NOT NULL DEFAULT '',
    name_vi   text    NOT NULL DEFAULT '',
    need_part integer NOT NULL DEFAULT 0,
    sort_no   integer NOT NULL DEFAULT 0,
    status    integer NOT NULL DEFAULT 1
);

INSERT INTO cfg_repair_disposition (code, name_cn, name_en, name_vi, need_part, sort_no, status) VALUES
    ('SOLDER',  '补锡',      'Touch-up solder', 'Hàn bổ sung',        0, 10, 1),
    ('REPLACE', '换件',      'Replace part',    'Thay linh kiện',     1, 20, 1),
    ('CLEAN',   '清洗',      'Clean',           'Vệ sinh',            0, 30, 1),
    ('ADJUST',  '调整/校正', 'Adjust',          'Điều chỉnh',         0, 40, 1),
    ('GLUE',    '加胶固定',  'Add glue',        'Keo cố định',        0, 50, 1),
    ('REWORK',  '重工',      'Rework',          'Làm lại',            0, 60, 1),
    ('REWRITE', '软件重刷',  'Re-flash',        'Nạp lại phần mềm',   0, 70, 1),
    ('SCRAP',   '报废',      'Scrap',           'Phế phẩm',           0, 90, 1)
ON CONFLICT (code) DO NOTHING;
