-- Fix: make pcb_serial_id nullable in station_events
-- Station events can exist without a specific PCB serial (e.g., scan events, line-level events)
-- The API endpoint accepts null pcbSerial, but the schema had NOT NULL blocking it

ALTER TABLE station_events ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2026 ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2027 ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2028 ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2029 ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2030 ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2031 ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2032 ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2033 ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2034 ALTER COLUMN pcb_serial_id DROP NOT NULL;
ALTER TABLE station_events_2035 ALTER COLUMN pcb_serial_id DROP NOT NULL;
