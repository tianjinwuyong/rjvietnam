-- Migration 055: Return reason codes + feeder loading undo support
-- 1. return_reason_codes master table
-- 2. Extend feeder_loading_events with return tracking columns
-- 3. Seed standard return reason codes

CREATE TABLE IF NOT EXISTS return_reason_codes (
    id          bigserial PRIMARY KEY,
    code        varchar(30)  NOT NULL UNIQUE,
    name_zh     varchar(100) NOT NULL,
    name_en     varchar(100) NOT NULL,
    name_vi     varchar(100) NOT NULL,
    category    varchar(20)  NOT NULL DEFAULT 'general',
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE return_reason_codes IS '退料原因代码 - Return reason code master data';
COMMENT ON COLUMN return_reason_codes.category IS 'general | material | quality | schedule';

-- 2. Extend feeder_loading_events with return fields
ALTER TABLE feeder_loading_events
    ADD COLUMN IF NOT EXISTS returned_qty         int,
    ADD COLUMN IF NOT EXISTS return_reason_code    varchar(30),
    ADD COLUMN IF NOT EXISTS return_reason_note    varchar(200),
    ADD COLUMN IF NOT EXISTS quality_verdict       varchar(10)  DEFAULT 'PASS',
    ADD COLUMN IF NOT EXISTS returned_at          timestamptz,
    ADD COLUMN IF NOT EXISTS returned_by          bigint;

COMMENT ON COLUMN feeder_loading_events.quality_verdict IS 'PASS | NG | DAMAGED — quality check result for returned material';
CREATE INDEX IF NOT EXISTS idx_feeder_loading_returned ON feeder_loading_events(work_order_code, returned_at);

-- 3. Seed standard return reason codes
INSERT INTO return_reason_codes (code, name_zh, name_en, name_vi, category) VALUES
    ('WRONG_MATERIAL',  '装错了',           'Wrong Material',       'Vật liệu sai',          'material'),
    ('EXCESS',          '多料了',           'Excess Quantity',      'Thừa vật liệu',        'material'),
    ('DEFECTIVE',       '来料不良',         'Defective Material',   'Vật liệu lỗi',         'quality'),
    ('MSD_OPENED',     'MSD开封超期',       'MSD Exposure Exceeded','MSD đã mở quá hạn',    'quality'),
    ('WRONG_SLOT',      '装错槽位',         'Wrong Slot',           'Sai vị trí slot',       'material'),
    ('WO_CANCELLED',   '工单取消',         'WO Cancelled',        'LX bị hủy',            'schedule'),
    ('MATERIAL_EOF',   '物料用完',         'Material Exhausted',  'Vật liệu hết',         'general'),
    ('OTHER',          '其他',             'Other',               'Khác',                  'general')
ON CONFLICT (code) DO NOTHING;

-- Record: admin (id=10) applied this migration
INSERT INTO _migrations (filename, hash) VALUES ('055_return_reasons_and_undo.sql', 'return-reasons-undo')
ON CONFLICT (filename) DO NOTHING;
