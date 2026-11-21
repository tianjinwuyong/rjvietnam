-- 311: MES-ruijing 绑码 / 解码（SN 绑定关系）缺失结构
-- 注：pg 里已存在一张 postgres 属主、无 ACL 的 prd_decode_log（历史遗留，app 角色读不了），
-- 因此解码履历落在 app 自有的 mesrj_decode_log；导旧数据时按同名列直接倒进来。
-- 源 api/bind.py._ensure_decode：prd_sn_rel 补「作废留痕」三列 + 解码履历表。
-- 关系表只做逻辑失效（is_active=0 + reason/void_at/void_by），永不物理删除。

ALTER TABLE prd_sn_rel ADD COLUMN IF NOT EXISTS reason  TEXT NOT NULL DEFAULT '';
ALTER TABLE prd_sn_rel ADD COLUMN IF NOT EXISTS void_at TIMESTAMPTZ;
ALTER TABLE prd_sn_rel ADD COLUMN IF NOT EXISTS void_by TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS mesrj_decode_log (
    id         BIGSERIAL PRIMARY KEY,
    action     TEXT NOT NULL DEFAULT '',
    sn         TEXT NOT NULL DEFAULT '',
    rel_id     INTEGER NOT NULL DEFAULT 0,
    parent_sn  TEXT NOT NULL DEFAULT '',
    child_sn   TEXT NOT NULL DEFAULT '',
    rel_type   TEXT NOT NULL DEFAULT '',
    void_sn    TEXT NOT NULL DEFAULT '',
    reason     TEXT NOT NULL DEFAULT '',
    remark     TEXT NOT NULL DEFAULT '',
    operator   TEXT NOT NULL DEFAULT '',
    station    TEXT NOT NULL DEFAULT '',
    mo_no      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mesrj_ix_decode_log_sn ON mesrj_decode_log(sn, created_at);
CREATE INDEX IF NOT EXISTS mesrj_ix_decode_log_void ON mesrj_decode_log(void_sn);
CREATE INDEX IF NOT EXISTS mesrj_ix_sn_rel_parent ON prd_sn_rel(parent_sn) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS mesrj_ix_sn_rel_child  ON prd_sn_rel(child_sn)  WHERE is_active = 1;
