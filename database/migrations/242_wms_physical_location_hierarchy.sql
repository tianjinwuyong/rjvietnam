-- Canonical WMS physical hierarchy and routing attributes.
-- Additive only: existing warehouse, zone, location and inventory records remain valid.

CREATE TABLE IF NOT EXISTS wms_sites (
  id bigserial PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name_zh varchar(120) NOT NULL,
  name_en varchar(120),
  name_vi varchar(120),
  address text,
  timezone varchar(60) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','LOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wms_buildings (
  id bigserial PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES wms_sites(id),
  code varchar(40) NOT NULL,
  name_zh varchar(120) NOT NULL,
  name_en varchar(120),
  name_vi varchar(120),
  building_type varchar(40) NOT NULL DEFAULT 'WAREHOUSE',
  length_m numeric(10,2), width_m numeric(10,2), height_m numeric(10,2),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','LOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, code)
);

CREATE TABLE IF NOT EXISTS wms_floors (
  id bigserial PRIMARY KEY,
  building_id bigint NOT NULL REFERENCES wms_buildings(id),
  code varchar(40) NOT NULL,
  floor_number integer NOT NULL,
  name_zh varchar(120) NOT NULL,
  name_en varchar(120),
  name_vi varchar(120),
  elevation_m numeric(10,2) NOT NULL DEFAULT 0,
  clear_height_m numeric(10,2),
  max_floor_load_kg_m2 numeric(12,2),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','LOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(building_id, code),
  UNIQUE(building_id, floor_number)
);

ALTER TABLE wms_warehouses ADD COLUMN IF NOT EXISTS floor_id bigint REFERENCES wms_floors(id);
ALTER TABLE wms_warehouses ADD COLUMN IF NOT EXISTS receiving_dock_code varchar(60);
ALTER TABLE wms_warehouses ADD COLUMN IF NOT EXISTS receiving_x numeric(12,3);
ALTER TABLE wms_warehouses ADD COLUMN IF NOT EXISTS receiving_y numeric(12,3);
ALTER TABLE wms_warehouses ADD COLUMN IF NOT EXISTS receiving_z numeric(12,3);

CREATE TABLE IF NOT EXISTS wms_route_nodes (
  id bigserial PRIMARY KEY,
  floor_id bigint NOT NULL REFERENCES wms_floors(id),
  code varchar(80) NOT NULL,
  node_type varchar(30) NOT NULL CHECK (node_type IN ('DOCK','STAGING','JUNCTION','AISLE','ELEVATOR','STAIR','LOCATION')),
  x_coord numeric(12,3) NOT NULL,
  y_coord numeric(12,3) NOT NULL,
  z_coord numeric(12,3) NOT NULL DEFAULT 0,
  forklift_allowed boolean NOT NULL DEFAULT true,
  agv_allowed boolean NOT NULL DEFAULT true,
  pedestrian_allowed boolean NOT NULL DEFAULT true,
  max_width_cm numeric(10,2),
  max_height_cm numeric(10,2),
  max_weight_kg numeric(12,2),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','LOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(floor_id, code)
);

CREATE TABLE IF NOT EXISTS wms_route_edges (
  id bigserial PRIMARY KEY,
  from_node_id bigint NOT NULL REFERENCES wms_route_nodes(id),
  to_node_id bigint NOT NULL REFERENCES wms_route_nodes(id),
  distance_m numeric(12,3) NOT NULL CHECK (distance_m > 0),
  travel_seconds integer CHECK (travel_seconds > 0),
  direction varchar(20) NOT NULL DEFAULT 'BOTH' CHECK (direction IN ('ONE_WAY','BOTH')),
  forklift_allowed boolean NOT NULL DEFAULT true,
  agv_allowed boolean NOT NULL DEFAULT true,
  pedestrian_allowed boolean NOT NULL DEFAULT true,
  max_width_cm numeric(10,2),
  max_height_cm numeric(10,2),
  max_weight_kg numeric(12,2),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','LOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(from_node_id, to_node_id)
);

ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS floor_id bigint REFERENCES wms_floors(id);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS position_code varchar(80);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS cross_aisle_code varchar(40);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS aisle_side varchar(10) CHECK (aisle_side IS NULL OR aisle_side IN ('LEFT','RIGHT','CENTER'));
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS access_direction varchar(20) CHECK (access_direction IS NULL OR access_direction IN ('FRONT','REAR','BOTH'));
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS z_coord numeric(12,3);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS orientation_deg numeric(6,2);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS capacity_uom varchar(20);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS max_weight_kg numeric(12,2);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS max_volume_m3 numeric(12,4);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS max_stack_height integer;
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS route_node_id bigint REFERENCES wms_route_nodes(id);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS handling_equipment varchar(40);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS fire_zone_code varchar(40);
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS esd_controlled boolean NOT NULL DEFAULT false;
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS hazardous_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE storage_locations ADD COLUMN IF NOT EXISTS cold_storage boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_wms_buildings_site_status ON wms_buildings(site_id,status);
CREATE INDEX IF NOT EXISTS idx_wms_floors_building_status ON wms_floors(building_id,status);
CREATE INDEX IF NOT EXISTS idx_wms_warehouses_floor ON wms_warehouses(floor_id,status);
CREATE INDEX IF NOT EXISTS idx_storage_locations_physical_path ON storage_locations(floor_id,zone_id,aisle_code,cross_aisle_code,rack_code,level_code,bin_code);
CREATE INDEX IF NOT EXISTS idx_storage_locations_route_node ON storage_locations(route_node_id);
CREATE INDEX IF NOT EXISTS idx_wms_route_nodes_floor_status ON wms_route_nodes(floor_id,status);
CREATE INDEX IF NOT EXISTS idx_wms_route_edges_from_status ON wms_route_edges(from_node_id,status);
CREATE INDEX IF NOT EXISTS idx_wms_route_edges_to_status ON wms_route_edges(to_node_id,status);

COMMENT ON TABLE wms_sites IS 'Top-level physical factory or logistics site.';
COMMENT ON TABLE wms_buildings IS 'Physical buildings within a site.';
COMMENT ON TABLE wms_floors IS 'Building floors including elevation, clearance and floor loading.';
COMMENT ON TABLE wms_route_nodes IS 'Navigable warehouse path nodes used for forklift, AGV and pedestrian routing.';
COMMENT ON TABLE wms_route_edges IS 'Auditable traversable connections and physical movement constraints.';
