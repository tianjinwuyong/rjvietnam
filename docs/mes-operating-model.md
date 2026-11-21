# SMT MES operating model

The existing SMT MES remains the system of record. This model applies proven
MES concepts inside the current PostgreSQL database:

- route operations provide one consistent work-order/station state machine;
- quality gates enforce pass, hold, fail, rework and scrap decisions;
- the WIP queue exposes waiting time, SLA due time and overdue operations;
- the event ledger makes station, quality and material events replay-safe;
- existing IQC, MRB, NG, PDA, feeder, SN and WMS tables remain linked through
  work-order code, station code, batch/lot and identity keys.

This is an additive foundation. It does not install or depend on OpenMES,
Odoo, or a second production database.
