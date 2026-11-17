-- Migration 204: Maintenance Card (P1)
-- Grill Q1-Q20 (2026-07-25): full-featured maintenance card
-- Tables: maintenance_cards (print tracking)

begin;

-- maintenance_cards: track active card version per equipment
CREATE TABLE IF NOT EXISTS maintenance_cards (
    id              BIGSERIAL PRIMARY KEY,
    asset_id        BIGINT NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
    card_version    INTEGER NOT NULL DEFAULT 1,
    card_serial     VARCHAR(80) UNIQUE,  -- printed serial number for anti-forge
    is_active       BOOLEAN NOT NULL DEFAULT true,
    print_count     INTEGER NOT NULL DEFAULT 0,
    last_printed_at TIMESTAMPTZ,
    last_printed_by BIGINT REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(asset_id, is_active)  -- only one active card per asset
);

-- Print log for audit trail
CREATE TABLE IF NOT EXISTS maintenance_card_print_log (
    id              BIGSERIAL PRIMARY KEY,
    card_id         BIGINT NOT NULL REFERENCES maintenance_cards(id) ON DELETE CASCADE,
    printed_by      BIGINT REFERENCES users(id),
    printed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    card_version    INTEGER NOT NULL,
    print_format    VARCHAR(20) DEFAULT 'A5',  -- A5/A4/A6/multi-page
    copy_count      INTEGER NOT NULL DEFAULT 1,
    factory_id      VARCHAR(50) NOT NULL DEFAULT 'VN_RUIJING'
);

-- signatures stored in pm_execution_records as JSONB
-- Fields: executor_sig, leader_sig, engineer_sig, signed_at

-- pm_execution_records already has:
--   first_article_result, trial_pieces (Q10 triple verification)
-- Add extra signature fields via ALTER (if not already present)
ALTER TABLE pm_execution_records
    ADD COLUMN IF NOT EXISTS signatures JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS leader_id BIGINT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS engineer_id BIGINT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS leader_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS engineer_verified_at TIMESTAMPTZ;

-- Add trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER maintenance_cards_updated_at
    BEFORE UPDATE ON maintenance_cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Sequences (reuse existing pm sequence)
CREATE SEQUENCE IF NOT EXISTS pm_execution_seq START 1;

create index if not exists idx_mc_asset on maintenance_cards(asset_id);
create index if not exists idx_mcpl_card on maintenance_card_print_log(card_id);

commit;
