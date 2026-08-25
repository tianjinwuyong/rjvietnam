# Migration Audit: 076–137

Audit date: 2026-07-22  
Database checked: local `smt_factory`  
Policy: additive changes, no synthetic production data, no destruction of operational history

## Result

Status: **NOT READY TO APPLY ALL PENDING MIGRATIONS**

The migration runner tracks the complete filename, not only the numeric prefix. Duplicate legacy prefixes therefore do not cause a file to be skipped. They do make ordering harder to understand and are frozen: do not rename already published files and do not add another duplicate prefix.

## Applied state observed

- Applied in the audited range: `076_auto_line_stations.sql`, `083_feeder_binding.sql`.
- Later applied contract migrations: `138` through `142`.
- Sixteen files in `076`–`137` remain pending on the local database and must be tested on a restored copy before application. This was verified with `node scripts/migrate.mjs --plan`.
- The filename gap from `090` through `135` is real; it is not interpreted as missing work by the filename-based runner.

## Findings

| Severity | Finding | Resolution |
|---|---|---|
| Critical | `085_drop_laser_marking.sql` used `DROP TABLE ... CASCADE` and could destroy production history | Fixed: migration is now a non-destructive retirement marker |
| High | `081_admin_vn_01_user.sql` created a demo login during every production schema upgrade | Fixed: migration retired; optional record moved to `database/seeds/085_admin_vn_01_demo_seed.sql` |
| High | Prefix `076` is used by three files | Frozen compatibility; runner executes by full filename; no renaming of published files |
| High | Many older prefixes before `076` are duplicated | Existing historical debt; future migrations must use a unique next number |
| High | Migrations `086` and `087` define ownership-sensitive SQLite↔PG mappings | Must be applied together on a restored copy and verified against the canonical ownership matrix |
| Medium | `137` removes alias rows from `station_sequences` | The table is routing reference data, not production history; verify row snapshot before/after |
| Medium | `137` changes automatic-line sequence numbers | Expected normalization; verify no runtime consumer uses the old numeric positions as identity |
| Medium | `076_dispatch_shelf_lots.sql` formerly contained demonstration inventory | Already retired; current file performs no inventory writes |
| Medium | Migration hashes are stored but changed applied files are skipped without reporting drift | Add hash-verification mode before production rollout |
| Medium | `--fresh` can drop every public table | Development-only; must never be used against production; add a hard environment/database guard before M1 gate |

## Pending migration groups

Apply to a restored database copy in this order and verify each group before continuing:

1. Station/support schema: `076_rework_station`, `077`–`083`.
2. Reporting and retirement: `084`–`085`.
3. Local/central mapping contract: `086`–`088`.
4. Staging, quarantine and retention: `089`.
5. Canonical SN and station identity: `136`–`137`.
6. Already-applied central contracts: confirm `138`–`142` checksums and objects; do not replay manually.

## Required acceptance evidence

- Backup identifier and restore timestamp.
- Migration filename, stored hash, start/end time and result.
- Row counts before and after for operational tables.
- Checksums for SN, NG, repair, inventory ledger and work-order identifiers.
- Foreign-key validation and invalid-row count.
- Duplicate indexes/constraints report.
- Rollback decision and operator identity.

## Prohibited actions

- Do not rename an already applied migration.
- Do not edit `_migrations` by hand.
- Do not run `--fresh` on production.
- Do not apply all pending files directly to the live database.
- Do not delete old production tables merely because their UI/API was retired.
