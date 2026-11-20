# MES Parity Audit — `D:\rj\repos\MES-ruijing` vs `smt-factory-system` (MES scope)

Date: 2026-11-20. Scope: MES sections only (excludes WMS, ERP, supplier portal, finance, OA, HR).
Method: static diff of the legacy repo against the live system — legacy `sql/schema.sql` + live dev DB `data/mes.db`,
`api/*.py` (459 routes), `core/*.py`, `run.py` daemons, `api/sys.py` MENU; new side
`services/api/server.js` + `src/routes/*.js` + `src/smt-system/*.js` + live PG `smt_factory` (1406 tables).

## 1. Headline numbers

| Dimension | Legacy `MES-ruijing` | `smt-factory-system` (MES surface) | Verdict |
|---|---|---|---|
| DB engine | SQLite `data/mes.db`, per-thread conn (`core/db.py:20-40`) | PostgreSQL, pool (`src/db.js`) | rewritten |
| Tables | 78 in live dev DB | 76/78 same-name present; 2 absent; 12 with column deltas | **97%** |
| Schema evolution | none — `sql/schema.sql` applied by `init_db()` | 317 append-only migrations (`database/migrations/`) | different model |
| HTTP routes | 459 (33 blueprints) | 371 `/mesrj/*` + 126 `/mes/*` + device API | **~88% mapped**, gaps §3 |
| `sys_param` keys | 92 read by code | 50 literals present in MES code | **41 absent** |
| Menu codes | 138 (`api/sys.py` MENU) | 166 (`src/smt-system/menu.js`) | superset |
| Background jobs | 9 daemon threads in `run.py` | none equivalent (`services/worker` = AI agents) | **gap** |
| Auth | HMAC token + `sys_user/role/perm` | JWT + `requireMesrjPerm` | rewritten |
| Device integrations | 4 in-repo gateways (镭雕 TCP:1000, ICT/FCT, 料架, WMS sync) | HTTP pull/push API only | **gap** |

## 2. Schema deltas (verified against live PG)

Missing tables:
- `cfg_dwell_rule` — dwell-time rules (6 rows in live legacy DB). No consumer in new code.
- `erp_stock` — ERP mirror (out of MES scope; ERP handled by new ERP/WMS modules).

Column deltas (new side lost or renamed):

| Table | Missing in new | Added in new |
|---|---|---|
| `prd_shift_report` | `start_time`, `end_time` | — |
| `prd_aoi_result` | `raw_z` | `board_user_ng_number`, `comp_user_ng_number` |
| `md_station` | — | `panel_work`, `short_name`, `type_code` |
| `ord_mo` | — | `fg_code`, `is_pool`, `output_codes` |
| `prd_pallet` | — | `oqc_status`, `oqc_time`, `oqc_waiver`, `release_locked`, `stock_in_status`, `stock_in_time` |
| `sys_user` | — | `emp_no` |

`prd_shift_report.start_time/end_time` are used by legacy 报工 duration math and Excel templates —
confirm no new report depends on them before dropping.

## 3. Functional gaps (legacy capability with no reachable equivalent)

### P0 — blocks MES cutover

1. **Dwell-time / 时效管控** (站间停留超期).
   Legacy: `core/dwell.py` (real-time `check_on_pass` inside `exec.do_pass_inner` + hourly `scan()` daemon),
   7 routes `/dwell/*`, params `dwell.auto_enabled`, `dwell.days`, `dwell.scan_minutes`, table `cfg_dwell_rule`.
   New: table absent, **zero code references**, 7 routes absent, 3 params absent.
   Note: `src/station-pass.js:238-247` implements *minDwellMinutes* (minimum wait before a pass) — the opposite
   rule. Do not mistake it for parity.

2. **绑码工位 CODE TRANSFER** (SN OLD → SN NEW).
   Legacy: `api/bind.py` (1098 lines) — station-configurable two-code binding with anti-error
   (length/prefix/regex/repeat/cross-MO/scrapped/waiting-repair/route check), 11 routes
   (`/bind/init|rule|precheck|do|unbind|list|chain|hourly|lookup|decode|decode/log`),
   params `bind.check_mo|check_ng|check_route`, tables `cfg_bind_station`, `cfg_bind_rule`, `prd_sn_rel`.
   New: config tables exist and are exposed as generic CRUD (`mesrj.js:778,790`), `prd_sn_rel` is only written by
   panel split (`mesrj.js:7859`). **No runtime bind/check/decode endpoints.** `/smt/sn_bind` is a different
   feature (`prd_sn_bind` SMT trace record), `/pack/bind` is box binding.

3. **SMT 辅料/工程管控 ported but UNREACHABLE.**
   `src/routes/smt-system.js` (399 routes) contains 33 SMT routes that the **mounted** router
   `src/routes/mesrj.js` (371 routes, `server.js:9270`) does not have:
   `/smt/paste/{out,open,return,check,done,stir,release,list}`,
   `/smt/stencil/{create,online,offline,clean,scrap,check,list}`,
   `/smt/pcb/{unseal,bake,check,list}`, `/smt/fa/{confirm,status}`,
   `/smt/load_{check,change,return}`, `/smt/{sn_import,sn_trace,models,report,baseline}`,
   `/smt/overuse/{list,confirm}`, `/smt/equip/{check,status}`.
   These are real implementations (e.g. `smt-system.js:9959` PCB unseal with `smt.pcb_unseal_hours`), not stubs.
   Conversely `mesrj.js` has 5 routes `smt-system.js` lacks (`/smt/equip_check`, `/smt/overuse`, `/smt/sn_bind`).
   **Two 500 KB near-identical router monoliths have diverged — pick one, union the diff, delete the other.**

4. **镭雕发码 gateway (laser SN issuance).**
   Legacy: 15 routes `/exec/laser/*` in `api/exec.py`, 10 params `laser.*`
   (`sn_port`, `sn_suffix`, `seq_start`, `seq_next`, `panel_size`, `over_pct`, `cur_mo`, `machine_code`,
   `keep_alive`, `close_drain_ms`, `push_grace_ms`), TCP server `设备对接工具/镭雕机/laser_sn_server.py` (port 1000).
   New: params absent, routes absent; only a comment at `mesrj.js:3634`. No TCP gateway in-repo.

### P1 — operational / reporting gaps

5. **Auto backup.** Legacy `run.py:466` daemon + `工具/运维/backup_db.py`, params
   `backup.enabled|interval_hours|keep|dir`. New: no scheduler, no `pg_dump` wrapper anywhere (`grep pg_dump` = 0).
6. **Periodic scans** (all absent): `alert.scan_minutes` (告警扫描, `run.py:553`),
   `material.low_qty|low_pct|scan_minutes` (低库存, `run.py:586`),
   `gkg.auto_enabled|scan_minutes` (印刷机 CSV, `run.py:671`), `dwell.scan_minutes`.
   `/alert/check` and the GKG CSV route exist but nothing calls them on a timer.
   `repair.auto_hours` is read (`mesrj.js:8741`) but no daemon runs it.
7. **Print agent executable.** Server protocol exists (`/pack/agent/ping`, `mesrj.js:7006`, `print.agent_*` params)
   but the BarTender sidecar (`tools/print_agent.py`, 853 lines) has no counterpart in this repo.
8. **Shift board / summary / station map.** Legacy `/shift/board|summary|options|stationmap|save|delete` +
   param `shift.station_map` (工位↔班次). New has only `md_shift` CRUD + work hours
   (`mesrj.js:1923-1950`, `/cfg/basic/shift`). No board, no per-station shift map.
9. **`/exec/hourly`** (每小时产出 across stations) absent; only `/panel/hourly` exists.
10. **SPC limits**: `/report/spc` exists but ignores `spc.lsl|spc.usl` (legacy had configurable limits).
11. **AQL/OQC**: ok — `oqc.aql_*` implemented in `src/smt-system/oqc-core.js:50-54` (earlier param scan missed it).
12. **`/smt/consumption`, `/smt/material_info`** (物料消耗/物料信息) have no equivalent.

### P2 — device / misc

13. Device API gaps: `/DeviceConfig/PanelQuery`, `/StationPass/SubmitPanel`, `/StationPass/FixTime`
    (`api/devsrc.py`). New device API is otherwise a superset (`mesrj.js:914-1152`).
14. `/aoi/export` (AOI 数据导出) absent.
15. `/oldmes/push` (旧 MES 推送, `api/board.py`) — verify whether `services/replication` covers the flow.
16. Legacy quirk only: `api/mesapi.pyc` is bytecode-only (Python 3.10, magic 3439) — no source to port from;
    behaviour must be inferred from `web/pages.js` callers and route names.

## 4. New-only capabilities to preserve (no legacy counterpart)

- Station-pass engine: `/mes/station-pass` policies, history, skip-release approval flow, NG routes
  (`src/routes/station-pass.js`, migration `269_mes_station_pass_engine.sql`).
- SMT loading module: 37 `/smt/loading/*` endpoints incl. offline lease / offline violations / approvals.
- Rework module: 11 `/rework/*` endpoints (revival board, reinspect, local-ng).
- `/mes/*` (126 paths): heartbeats, andon board, downtimes, first-article inspections, fool-proof rules, lineage.
- OQC: `apply_plan`, `can_ship`, `stock_in`, `check_box`, `station_stats`, `trend`.
- Pallet box add/remove, panel `align|judge|sn/parse`, `/sys/{user,role,perm}` CRUD, tri-lingual i18n.

## 5. Recommended order for the merge agent

1. Resolve the router split (`mesrj.js` vs `smt-system.js`) — union 33+5 routes into the mounted router, delete the loser.
2. Port dwell (`core/dwell.py` → station-pass hook + periodic scan; add `cfg_dwell_rule` migration).
3. Port bind station runtime (`api/bind.py`) on top of existing `cfg_bind_station|cfg_bind_rule` + `prd_sn_rel`.
4. Port laser gateway (params + `/exec/laser/*` + TCP server) or explicitly retire it with the field team.
5. Add the missing background scans + PG backup job (single scheduler process, DB-driven intervals).
6. Fill P1 reporting gaps (`prd_shift_report` timestamps, `/exec/hourly`, SPC limits, shift map).
7. Re-run this audit script after each wave; it is reproducible from the checklists above.
