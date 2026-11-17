-- Migration 082: Add ip_address column to stations table
-- Stations report their host IP to MES on startup; MES stores it here for monitoring.

ALTER TABLE stations ADD COLUMN IF NOT EXISTS ip_address varchar(45);

CREATE INDEX IF NOT EXISTS idx_stations_ip_address ON stations(ip_address) WHERE ip_address IS NOT NULL;
