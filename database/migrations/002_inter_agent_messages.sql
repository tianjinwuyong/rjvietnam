-- Migration: 002_inter_agent_messages
-- Inter-agent message queue for MES ↔ WMS ↔ BOM ↔ HR ↔ RDA communication
-- All factory AI managers use this table for asynchronous messaging.

BEGIN;

CREATE TABLE IF NOT EXISTS inter_agent_messages (
  id              BIGSERIAL PRIMARY KEY,
  message_id      VARCHAR(64)  NOT NULL UNIQUE,
  source_agent    VARCHAR(32) NOT NULL,
  target_agent    VARCHAR(32) NOT NULL,
  message_type    VARCHAR(32) NOT NULL,   -- request | response | event | broadcast
  subject         VARCHAR(128) NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  correlation_id  VARCHAR(64),             -- links response to original request
  priority        VARCHAR(16)  DEFAULT 'normal',  -- critical | high | normal | low
  status          VARCHAR(16)  DEFAULT 'pending',  -- pending | processing | completed | failed | dead
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  error_message   TEXT
);

COMMENT ON TABLE inter_agent_messages IS 'Shared async message queue for all factory AI managers';
COMMENT ON COLUMN inter_agent_messages.message_id    IS 'Unique message ID, e.g. msg-ld8f3k-9abc';
COMMENT ON COLUMN inter_agent_messages.source_agent   IS 'Sender agent: mes-ai | wms-ai | bom-ai | hr-ai | rda-ai | worker';
COMMENT ON COLUMN inter_agent_messages.target_agent   IS 'Receiver agent: same list, or * for broadcast';
COMMENT ON COLUMN inter_agent_messages.message_type   IS 'request=needs response, response=reply to request, event=one-way notify, broadcast=all';
COMMENT ON COLUMN inter_agent_messages.subject        IS 'Message topic, e.g. material_issued | bom_updated | operator_absent';
COMMENT ON COLUMN inter_agent_messages.correlation_id IS 'Links a response message to the original request message_id';
COMMENT ON COLUMN inter_agent_messages.priority        IS 'Routing priority — critical messages processed first';
COMMENT ON COLUMN inter_agent_messages.status         IS 'pending=pollable, processing=being handled, completed=done, failed=error, dead=retries exhausted';
COMMENT ON COLUMN inter_agent_messages.expires_at    IS 'TTL — expired messages are skipped by pollers';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iam_target_status
  ON inter_agent_messages (target_agent, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iam_source
  ON inter_agent_messages (source_agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iam_subject
  ON inter_agent_messages (subject);
CREATE INDEX IF NOT EXISTS idx_iam_priority
  ON inter_agent_messages (priority, created_at);
CREATE INDEX IF NOT EXISTS idx_iam_correlation
  ON inter_agent_messages (correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iam_expires
  ON inter_agent_messages (expires_at)
  WHERE expires_at IS NOT NULL;

-- Valid agent IDs (enforced via check constraints)
ALTER TABLE inter_agent_messages
  ADD CONSTRAINT chk_source_agent
  CHECK (source_agent IN ('mes-ai','wms-ai','bom-ai','hr-ai','rda-ai','worker','*'));

ALTER TABLE inter_agent_messages
  ADD CONSTRAINT chk_target_agent
  CHECK (target_agent IN ('mes-ai','wms-ai','bom-ai','hr-ai','rda-ai','worker','*'));

ALTER TABLE inter_agent_messages
  ADD CONSTRAINT chk_message_type
  CHECK (message_type IN ('request','response','event','broadcast'));

ALTER TABLE inter_agent_messages
  ADD CONSTRAINT chk_priority
  CHECK (priority IN ('critical','high','normal','low'));

ALTER TABLE inter_agent_messages
  ADD CONSTRAINT chk_status
  CHECK (status IN ('pending','processing','completed','failed','dead'));

COMMIT;

-- Seed: register all known agents (informational)
-- INSERT INTO inter_agent_registry (agent_id, manager_script, query_script, domain, description)
--   VALUES ('mes-ai', 'services/worker/mes-manager.js', 'services/worker/mes-query.js', 'production', 'Manufacturing Execution System AI Manager')
-- ON CONFLICT (agent_id) DO NOTHING;
