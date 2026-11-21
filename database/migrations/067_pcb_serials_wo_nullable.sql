-- Make work_order_id nullable in pcb_serials so station agents can auto-register SNs
-- before a work order is linked (WO linkage happens later via the WO manager)
alter table pcb_serials alter column work_order_id drop not null;
