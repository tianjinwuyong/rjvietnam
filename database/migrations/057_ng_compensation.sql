-- Migration 057: NG Compensation (补料申请) System
-- Operators file compensation requests when NG occurs in production.
-- PMC reviews and approves or disputes.
-- Two tables:
--   ng_compensation_reasons  — reason master data (who bears cost: SUPPLIER / INTERNAL)
--   ng_compensation_requests — compensation request records with approval workflow

-- 1. Reason master data
CREATE TABLE IF NOT EXISTS ng_compensation_reasons (
    id               bigserial PRIMARY KEY,
    code             varchar(30)  NOT NULL UNIQUE,
    name_zh          varchar(100) NOT NULL,
    name_en          varchar(100) NOT NULL,
    name_vi          varchar(100) NOT NULL,
    cost_bearer      varchar(20)  NOT NULL DEFAULT 'INTERNAL',
    -- SUPPLIER: cost charged back to supplier (via supplier return)
    -- INTERNAL: absorbed by factory (absorbed into unit cost)
    is_active        boolean     NOT NULL DEFAULT true,
    sort_order       int         NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE ng_compensation_reasons IS 'NG补料原因代码 — NG compensation reason master data';
COMMENT ON COLUMN ng_compensation_reasons.cost_bearer IS 'SUPPLIER | INTERNAL';

-- 2. Compensation request records
CREATE TABLE IF NOT EXISTS ng_compensation_requests (
    id                       bigserial PRIMARY KEY,
    request_no               varchar(50)  NOT NULL UNIQUE,
    -- WO context
    work_order_code          varchar(50)  NOT NULL,
    line_code                varchar(20),
    station_code             varchar(30),
    -- Material being compensated
    material_code            varchar(50)  NOT NULL,
    material_name_zh         varchar(100),
    lot_no                   varchar(80),
    compensation_qty         int          NOT NULL,
    unit_cost_usd            numeric(12,4),
    estimated_cost_usd       numeric(12,2),
    -- Reason
    reason_code              varchar(30)  NOT NULL REFERENCES ng_compensation_reasons(code),
    reason_note              varchar(200),
    -- NG description
    ng_description           varchar(300),
    -- Status: PENDING | APPROVED | DISPUTED | ISSUED | CLOSED
    status                   varchar(20)  NOT NULL DEFAULT 'PENDING',
    -- PMC review
    reviewed_by              bigint,
    reviewed_by_name         varchar(100),
    reviewed_at              timestamptz,
    review_note              varchar(200),
    -- Material issue (once approved)
    issued_material_lot_id   bigint REFERENCES material_lots(id),
    issued_qty               int,
    issued_at                timestamptz,
    issued_by                bigint,
    -- Who filed
    filed_by                 bigint,
    filed_by_name            varchar(100),
    filed_at                 timestamptz  NOT NULL DEFAULT now(),
    updated_at               timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE ng_compensation_requests IS 'NG补料申请表 — NG compensation request with PMC approval workflow';

CREATE INDEX IF NOT EXISTS idx_comp_wo        ON ng_compensation_requests(work_order_code);
CREATE INDEX IF NOT EXISTS idx_comp_status    ON ng_compensation_requests(status);
CREATE INDEX IF NOT EXISTS idx_comp_reason    ON ng_compensation_requests(reason_code);
CREATE INDEX IF NOT EXISTS idx_comp_filed_by  ON ng_compensation_requests(filed_by);

-- 3. Seed standard compensation reasons
INSERT INTO ng_compensation_reasons (code, name_zh, name_en, name_vi, cost_bearer, sort_order) VALUES
    ('SMT_MISPLACE',      'SMT贴装偏移',    'SMT Misplacement',    'Đặt linh kiện lệch SMT',     'INTERNAL',  1),
    ('SPI_FAIL',          'SPI检测不良',    'SPI Failure',         'SPI thất bại',               'SUPPLIER',  2),
    ('AOI_REJECT',        'AOI拒收',        'AOI Reject',          'AOI từ chối',               'SUPPLIER',  3),
    ('SOLDER_DEFECT',     '焊接不良',       'Solder Defect',       'Lỗi hàn',                   'SUPPLIER',  4),
    ('COMP_DAMAGED',      '元器件损坏',     'Component Damaged',   'Linh kiện hỏng',            'INTERNAL',  5),
    ('LABEL_ERROR',       '标签错误',       'Label Error',         'Lỗi nhãn',                  'INTERNAL',  6),
    ('MSD_DAMAGED',       'MSD受潮',        'MSD Moisture Damage', 'MSD hút ẩm',                'SUPPLIER',  7),
    ('OVER_BAKE',         '烘烤过度',       'Over-baked',          'Nướng quá',                 'INTERNAL',  8),
    ('HANDLING_DAMAGE',   '操作损坏',       'Handling Damage',     'Hỏng khi thao tác',         'INTERNAL',  9),
    ('MATERIAL_DEFECT',   '物料本身缺陷',   'Material Defect',     'Lỗi vật liệu',              'SUPPLIER',  10),
    ('OTHER',             '其他',           'Other',               'Khác',                      'INTERNAL',  99)
ON CONFLICT (code) DO NOTHING;

-- Record: admin (id=10) applied this migration
INSERT INTO _migrations (filename, hash) VALUES ('057_ng_compensation.sql', 'ng-compensation')
ON CONFLICT (filename) DO NOTHING;