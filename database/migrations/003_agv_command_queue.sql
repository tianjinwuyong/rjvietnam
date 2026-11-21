-- AGV command queue for REST API
-- AGV devices poll GET /agv/commands?agv_code=X
-- MES enqueues commands via INSERT

CREATE TABLE IF NOT EXISTS agv_command_queue (
  id            bigserial PRIMARY KEY,
  agv_code      varchar(40) NOT NULL,
  command_type  varchar(30) NOT NULL,  -- dispatch|return|pause|resume|charge|cancel
  payload       jsonb NOT NULL DEFAULT '{}',
  status        varchar(20) NOT NULL DEFAULT 'pending',  -- pending|acknowledged|completed|failed|cancelled
  priority      int NOT NULL DEFAULT 5,
  created_at    timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  completed_at  timestamptz,
  notes         varchar(200)
);

CREATE INDEX IF NOT EXISTS idx_agv_cmd_queue_agv_status
  ON agv_command_queue(agv_code, status)
  WHERE status IN ('pending', 'acknowledged');
