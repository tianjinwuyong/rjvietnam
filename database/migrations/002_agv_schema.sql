-- ============================================================
-- AGV Management Schema Migration
-- AGV Types: 潜伏式 (under-shelf) + 叉式 (forklift)
-- Navigation: Free (Laser SLAM / LIDAR)
-- ============================================================

-- ── agv_zones ──────────────────────────────────────────────────────────────
-- Factory zones / navigation nodes for SLAM-based AGV positioning
CREATE TABLE agv_zones (
  id           bigserial PRIMARY KEY,
  code         varchar(40) NOT NULL UNIQUE,
  name_zh      varchar(120) NOT NULL,
  name_en      varchar(120),
  name_vi      varchar(120),
  zone_type    varchar(30) NOT NULL,  -- 'storage' | 'production' | 'charging' | 'loading' | 'unloading' | 'transit'
  area         varchar(60),            -- factory area (e.g. 'SMT-A', 'Warehouse')
  x_coord      numeric(10,2),          -- SLAM map X coordinate (meters)
  y_coord      numeric(10,2),          -- SLAM map Y coordinate (meters)
  is_charging  boolean NOT NULL DEFAULT false,
  is_parking   boolean NOT NULL DEFAULT false,
  status       varchar(20) NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── agv_stations ──────────────────────────────────────────────────────────
-- Physical docking/charging stations for AGVs
CREATE TABLE agv_stations (
  id              bigserial PRIMARY KEY,
  code            varchar(40) NOT NULL UNIQUE,
  name_zh         varchar(120) NOT NULL,
  zone_id         bigint REFERENCES agv_zones(id),
  station_type    varchar(30) NOT NULL,  -- 'charging' | 'load' | 'unload' | 'parking' | 'multi'
  agv_type_suitable varchar(20) NOT NULL, -- 'forklift' | 'shuttle' | 'both'
  supports_forklift  boolean NOT NULL DEFAULT false,
  supports_shuttle   boolean NOT NULL DEFAULT false,
  max_load_kg     numeric(8,2),           -- max load capacity (kg)
  status          varchar(20) NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── agv_fleet ──────────────────────────────────────────────────────────────
-- AGV vehicle registry
CREATE TABLE agv_fleet (
  id                  bigserial PRIMARY KEY,
  code                varchar(40) NOT NULL UNIQUE,
  name_zh             varchar(120) NOT NULL,
  agv_type            varchar(20) NOT NULL,  -- 'forklift' | 'shuttle'
  model               varchar(80),           -- manufacturer model
  serial_no           varchar(80) UNIQUE,
  -- Status tracking
  status              varchar(20) NOT NULL DEFAULT 'idle',  -- idle|busy|charging|maintenance|error|offline
  -- Navigation
  current_zone_id     bigint REFERENCES agv_zones(id),
  x_coord             numeric(10,2),         -- current SLAM X
  y_coord             numeric(10,2),         -- current SLAM Y
  heading             numeric(6,2),          -- degrees 0-360
  speed_mps           numeric(6,2),          -- current speed m/s
  -- Battery
  battery_pct         numeric(5,1) NOT NULL DEFAULT 100.0,
  battery_cycle_count int,
  low_battery_threshold numeric(5,1) NOT NULL DEFAULT 20.0,
  -- Current task
  current_task_id     bigint,
  last_task_id        bigint,
  -- Specs
  max_load_kg         numeric(8,2) NOT NULL DEFAULT 1000.0,
  max_lift_height_mm  numeric(8,2),          -- for forklift
  navigation_type     varchar(30) NOT NULL DEFAULT 'slam',  -- slam|lidar|gps|hybrid
  -- Maintenance
  total_distance_m    numeric(12,2) DEFAULT 0,
  total_tasks         int DEFAULT 0,
  last_maintenance_at timestamptz,
  next_maintenance_at timestamptz,
  -- Timestamps
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at   timestamptz
);

-- ── agv_tasks ──────────────────────────────────────────────────────────────
-- AGV transport task queue
CREATE TABLE agv_tasks (
  id                bigserial PRIMARY KEY,
  task_code         varchar(40) NOT NULL UNIQUE,
  task_type         varchar(30) NOT NULL,  -- 'material_delivery'|'pallet_pickup'|'material_return'|'reel_supply'|'finished_goods'|'empty_pallet'
  priority          int NOT NULL DEFAULT 5,  -- 1=highest, 10=lowest
  status            varchar(20) NOT NULL DEFAULT 'pending',  -- pending|assigned|dispatched|en_route|in_progress|completed|cancelled|failed
  -- AGV assignment
  agv_id            bigint REFERENCES agv_fleet(id),
  assigned_at       timestamptz,
  dispatched_at     timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  -- Route
  from_zone_id      bigint REFERENCES agv_zones(id),
  to_zone_id        bigint REFERENCES agv_zones(id),
  from_station_id   bigint REFERENCES agv_stations(id),
  to_station_id     bigint REFERENCES agv_stations(id),
  -- Associated entities
  work_order_id     bigint REFERENCES work_orders(id),
  material_lot_id   bigint REFERENCES material_lots(id),
  line_id           bigint REFERENCES production_lines(id),
  -- Load info
  load_type         varchar(30),   -- 'pallet'|'reel_trolley'|'cart'|'bin'
  load_kg           numeric(8,2),
  -- Result
  actual_distance_m numeric(10,2),
  actual_duration_s int,
  failure_reason    varchar(200),
  -- Escalation
  escalation_level  int DEFAULT 0,
  last_escalated_at timestamptz,
  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  due_at            timestamptz,
  cancelled_at      timestamptz,
  cancelled_reason  varchar(200)
);

-- ── agv_task_history ───────────────────────────────────────────────────────
-- Completed task audit log (not partitioned, audit only)
CREATE TABLE agv_task_history (
  id                bigserial PRIMARY KEY,
  task_code         varchar(40) NOT NULL,
  task_type         varchar(30) NOT NULL,
  priority          int,
  status            varchar(20) NOT NULL,
  -- AGV
  agv_code          varchar(40),
  agv_type          varchar(20),
  -- Route
  from_zone         varchar(40),
  to_zone           varchar(40),
  from_station      varchar(40),
  to_station        varchar(40),
  -- Associated
  work_order_code   varchar(40),
  line_code         varchar(40),
  -- Performance
  distance_m        numeric(10,2),
  duration_s        int,
  battery_start_pct numeric(5,1),
  battery_end_pct   numeric(5,1),
  -- Outcome
  outcome           varchar(20) NOT NULL,  -- success|failed|cancelled|escalated
  failure_reason    varchar(200),
  -- Timestamps
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);

-- ── agv_positions ──────────────────────────────────────────────────────────
-- Position log for path analysis (can be partitioned by year)
CREATE TABLE agv_positions (
  id              bigserial PRIMARY KEY,
  agv_id          bigint NOT NULL REFERENCES agv_fleet(id),
  agv_code        varchar(40) NOT NULL,
  zone_id         bigint REFERENCES agv_zones(id),
  zone_code       varchar(40),
  x_coord         numeric(10,2) NOT NULL,
  y_coord         numeric(10,2) NOT NULL,
  heading         numeric(6,2),
  speed_mps       numeric(6,2),
  battery_pct     numeric(5,1),
  task_id         bigint,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

-- ── agv_alerts ─────────────────────────────────────────────────────────────
-- AGV alert log
CREATE TABLE agv_alerts (
  id          bigserial PRIMARY KEY,
  agv_id      bigint NOT NULL REFERENCES agv_fleet(id),
  agv_code    varchar(40) NOT NULL,
  alert_type  varchar(40) NOT NULL,  -- low_battery|collision_warning|obstacle|offline|stuck|task_timeout|maintenance_due
  severity    varchar(10) NOT NULL,   -- info|warning|critical
  message     varchar(300),
  resolved    boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by varchar(80),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── agv_charging_log ───────────────────────────────────────────────────────
-- Charging session history
CREATE TABLE agv_charging_log (
  id              bigserial PRIMARY KEY,
  agv_id          bigint NOT NULL REFERENCES agv_fleet(id),
  agv_code        varchar(40) NOT NULL,
  station_id      bigint REFERENCES agv_stations(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  start_battery_pct numeric(5,1),
  end_battery_pct   numeric(5,1),
  energy_kwh      numeric(8,3),
  outcome         varchar(20) DEFAULT 'in_progress'  -- completed|interrupted|failed
);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX idx_agv_fleet_status ON agv_fleet(status);
CREATE INDEX idx_agv_fleet_zone ON agv_fleet(current_zone_id);
CREATE INDEX idx_agv_tasks_status ON agv_tasks(status);
CREATE INDEX idx_agv_tasks_agv ON agv_tasks(agv_id);
CREATE INDEX idx_agv_tasks_priority ON agv_tasks(priority) WHERE status = 'pending';
CREATE INDEX idx_agv_tasks_wo ON agv_tasks(work_order_id);
CREATE INDEX idx_agv_tasks_created ON agv_tasks(created_at);
CREATE INDEX idx_agv_task_history_agv ON agv_task_history(agv_code);
CREATE INDEX idx_agv_task_history_completed ON agv_task_history(completed_at);
CREATE INDEX idx_agv_positions_agv_time ON agv_positions(agv_id, occurred_at DESC);
CREATE INDEX idx_agv_positions_zone ON agv_positions(zone_id, occurred_at DESC);
CREATE INDEX idx_agv_alerts_agv ON agv_alerts(agv_id, created_at DESC);
CREATE INDEX idx_agv_alerts_unresolved ON agv_alerts(resolved) WHERE resolved = false;
CREATE INDEX idx_agv_charging_agv ON agv_charging_log(agv_id, started_at DESC);