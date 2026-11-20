# MES Parity Audit — Part 2 (contract & module level)

Continuation of `mesrj-parity-gaps-2026-11-20.md`. Same scope: MES only.
This pass covers what Part 1 did not: device-firmware contract, module-level logic mapping,
API/envelope compatibility, permission wiring, status vocabularies and seed/data readiness.

## A. Route ledger per domain (legacy blueprint → new `/mesrj` prefix)

| Domain | Legacy | New mounted | Verdict |
|---|---|---|---|
| exec (过站/跳站/放行/镭雕) | 44 | 33 (+9 `/mes/station-pass`) | laser 15 routes missing; rest renamed |
| smt (上料/锡膏/钢网/PCB/首件) | 42 | 52 | covered **only if** `smt-system.js` 33 routes get merged (Part 1 §3.3) |
| smta (锡膏/钢网/刮刀台账) | 31 | 31 | full |
| repair (维修/交接/报废放行) | 31 | 31 | full |
| oqc (出货抽检/AQL/返工) | 27 | 32 | superset |
| pack (装箱/标签/打印任务) | 21 | 21 | full |
| route (路线/工序/变体) | 18 | 18 | full |
| ecn | 17 | 17 | full |
| order (MO/领料/补料) | 16 | 16 | full |
| pallet (栈板) | 14 | 17 | superset |
| panel (拼版) | 10 | 17 | superset |
| plan (排产/产能) | 10 | 10 | full |
| emp (员工/考试/授权) | 10 | 10 | full |
| aoi | 9 | 8 | `/aoi/export` missing |
| report | 9 | 8 | `/report/yield` renamed into `/exec/yield` |
| trace_export | 5 | 5 | full |
| analyze (alert/oee/spc/output) | 10 | 10 | full (SPC limits unconfigured, Part 1 §3.10) |
| md / bom / cfg / sys / basic | 47 | 47 | resource-driven CRUD, full |
| bind | 11 | **0** | P0 (Part 1 §3.2) |
| dwell | 7 | **0** | P0 (Part 1 §3.1) |
| shift | 7 | 2 | board/summary/stationmap missing |
| devsrc (device API) | 4 | 11 | partial — see §B.1 |
| board | 2 | 1 | `/oldmes/push` missing |

## B. Contract-level findings

1. **Device-firmware contract gap (new).** `api/mesapi.pyc` — bytecode-only, registered in `BLUEPRINTS`, so it *is*
   part of the legacy surface — exposes 9 device endpoints (constants extracted from the 3.10 code object):

   `/DeviceConfig/Lines`, `/DeviceConfig/LineMOs`, `/DeviceConfig/Stations`, `/DeviceConfig/Tracks`,
   `/DeviceConfig/VerifyOperator`, `/MachineData/Submit`, `/StationPass/Check`, `/StationPass/Submit`, `/`.

   New device API (`mesrj.js:914-1152`) implements `/DeviceConfig/{MachineSource,LineConfig}`,
   `/StationPass/{Scan,Pending}`, `/MachineData/{Upload,List,BySn}`, `/Packing/{Box,Pallet}`.
   → 7 of the 9 legacy device paths have no direct equivalent. `StationPass/Check` (validate-only) vs `Scan`
   (validate+write) is a semantic difference firmware may rely on. **Ask the field team which paths the ICT/FCT
   firmware actually calls before merging.**

2. **`itf_api_log` has no writer.** Legacy logs *every* device call and every unknown path, with 60 s sampling
   dedupe (`run.py:38-84`; documented in legacy AGENTS.md as the field debugging lifeline). New only reads the
   table (`mesrj.js:1170`). Device-side "we sent it, you didn't get it" disputes become undiagnosable.

3. **Laser machine-number ↔ model validation absent.** `core/sn_prefix.py` decodes the PCB laser code
   (first digit = machine, second = year, e.g. `5GAT14800A`) and cross-checks against
   `cfg_pcb_code.laser_machine_no` as an independent model check during pass. New MES has zero references to
   `laser_machine_no`. (Consistent with the whole laser subsystem being absent — Part 1 §3.4.)

4. **Cross-code merge is present.** `core/sn_full.py` (PCBSN ↔ 铭牌 SN bidirectional merge only for `PCBA_Link`,
   hint-only for `PANEL_SPLIT`) maps to `src/smt-system/trace-core.js:471` and `repair-core.js:140`. No gap.

5. **Response envelope is byte-compatible.** Legacy `util.ok()/fail()` → `{success, msg, data}`
   (`core/util.py:50-55`); new `ok()/fail()` (`mesrj.js:108-112`) emits the same keys. Existing PDA/scanner
   clients can point at the new API without response-shape changes.

6. **Status vocabularies aligned.** Both sides use `生产中 / 已完工 / 已关闭 / 在制 / 待修 / 已修复 / 合格 / 不合格`;
   new adds `报废 / 完成`. No translation layer needed for migrated rows.

7. **Permissions wired, with one dangling seed.** All 20 permission strings used by `requireMesrjPerm` exist in
   `sys_perm` (39 rows). `prod.bind` is seeded (`287_mesrj_perm_seed.sql` / `291_mesrj_missing_perms.sql`) but
   **no route uses it** — further evidence that the bind-station module was planned and never ported.

8. **No data migration path.** Live PG master data is empty: `md_station=0, md_line=0, md_product=0,
   md_material=0, md_customer=0, md_defect=0, md_shift=0, ord_mo=0` (legacy dev checkout: 37 stations,
   10 processes, 6 dwell rules). Nothing in this repo imports a legacy SQLite DB (`grep sqlite` → only
   `autoline_manager.py` side-project). Cutover needs a one-off exporter; `services/replication` is PG↔PG only.

## C. Module-level logic mapping (legacy `core/*.py` → new)

| Legacy module | New home | Status |
|---|---|---|
| `sn_full.py` (跨码合并) | `smt-system/trace-core.js:471`, `repair-core.js:140` | ported |
| `pcbcode.py` (镭雕码解码) | `smt-system/domain.js`, `/cfg/pcbcode/decode` | ported |
| `packcode.py` (箱/栈板码引擎) | `smt-system/packcode.js` | ported |
| `designator.py` | `smt-system/designator.js` | ported |
| `vncode.py` (越南码) | `domain.js` (`vn_code`), `prd_material_load.vn_code` | ported |
| `seg.py` (工段推导) | `domain.js` (`segment`, `/bom/segment-summary`) | ported |
| `moroute.py`, `route_order.py`, `eta.py` | `domain.js` (`moroute`, `route_order`, `eta`) | ported |
| `aging.py` (呆滞) | `/exec/aging`, `/exec/aging/detail` | ported (no export) |
| `feeder_slot.py` | `smt-core.js` (`/smt/feeder_slot_match`) | ported |
| `smt_baseline.py` | `/smt/baseline/*` (7 routes) | ported |
| `aql.py`, `oqc.py`, `oqc_aql.py`, `oqc_check.py` | `oqc-core.js` (1196 lines) + `src/aql.js` | ported |
| `repair_detail.py`, `scrap_release.py` | `repair-core.js`, `/repair/scrap/release/*` | ported |
| `report_tpl.py` (Excel 模板 cells/mapping) | `report-tpl.js`, `/report/tpl/*` | ported |
| `issue_doc.py` (领料单) | inline in `mesrj.js` / `domain.js` | ported |
| `gkg.py` | inline CSV parser (`mesrj.js:6388-6520`) | ported, **no FTP/auto loop** |
| `aoiraw.py`, `aoi_model.py` (AOI 原始文件解析) | `aoi-model.js`; ingestion moved to `services/aoi-api` (MySQL `pcb_detection` @6309) | mechanism replaced — verify field mapping |
| `sn_prefix.py` | — | **missing** |
| `dwell.py` | — | **missing** |
| `notify.py` | `/alert/*` (6 routes) | ported, no scheduler |
| `auth.py` (HMAC token) | JWT (`authenticateJWT`) | replaced |

## D. UI / deployment deltas

- Legacy UI: 1.4 MB static JS (`web/pages.js`, `pda.html`, `pda-supply.html`, `pda-hub.html`, `board.html`).
  New: React `apps/web` (417 `.tsx`), `apps/display-board`, `apps/station-agent`, Android `apps/pdas`.
  Menu-code parity is a superset (166 vs 138), so every legacy page has a landing slot; page-level feature
  parity was **not** exercised here — needs a click-through (PDA 上料 supplies flow is the riskiest).
- Legacy PDA pages set `no-store` deliberately (field browser cache incident). New scanner app is an APK —
  this class of bug disappears, but the web PDA surface must keep no-cache headers if it survives.
- Deployment: legacy ships GBK `.bat` scripts (`启动全部服务.bat`, `重启MES服务.bat`) + `D:/MY/Python` 3.10
  requirement (pyc magic 3439). New ships `Dockerfile.api` / `Dockerfile.web` + `start_dev.js`.
  **The running field MES must stay on that machine until §E items are closed** — there is no in-place upgrade.

## E. Consolidated gap register (updated)

| # | Gap | Sev | Evidence | Merge action |
|---|---|---|---|---|
| 1 | Router split: 33 SMT 辅料 routes unmounted; 5 routes only in mounted copy | P0 | `src/routes/mesrj.js` 371 vs `src/routes/smt-system.js` 399; mounted at `server.js:9270` | union diff, delete loser |
| 2 | Dwell 时效管控 (rules + real-time + scan) | P0 | `core/dwell.py`, `cfg_dwell_rule` absent in PG | migration + station-pass hook |
| 3 | Bind station CODE TRANSFER runtime | P0 | `api/bind.py`; `prod.bind` perm seeded, unused | port 11 routes + `prd_sn_rel` writes |
| 4 | Laser SN gateway (routes/params/TCP:1000) + machine↔model check | P0 | `api/exec.py` laser block, `core/sn_prefix.py` | port or formally retire |
| 5 | Device firmware contract (`/DeviceConfig/{Lines,LineMOs,Stations,Tracks,VerifyOperator}`, `/MachineData/Submit`, `/StationPass/{Check,Submit}`) | P1 | `api/mesapi.pyc` consts; new routes `mesrj.js:914-1152` | confirm with field firmware, add aliases |
| 6 | `itf_api_log` writer (device + unknown-path logging, 60 s dedupe) | P1 | `run.py:38-84`; new has read-only | middleware + dedupe |
| 7 | Scheduler: backup, alert scan, material low-stock, dwell scan, GKG auto | P1 | `run.py:466-683`; no `pg_dump` in repo | one cron/worker process |
| 8 | Print agent sidecar (BarTender) | P1 | `tools/print_agent.py` 853 lines; protocol exists `mesrj.js:7006` | ship sidecar or port |
| 9 | Shift board/summary/station map | P1 | 7 legacy routes, `shift.station_map` unused | port 3 views |
| 10 | `/exec/hourly`, `/smt/consumption`, `/smt/material_info`, `/aoi/export` | P1 | route diff | port 4 handlers |
| 11 | Legacy data import to PG (master data + history) | P1 | PG seeds empty; no sqlite importer | write exporter |
| 12 | `prd_shift_report.start_time/end_time`, `prd_aoi_result.raw_z` | P2 | live schema diff | re-add columns or prove unused |
| 13 | Device path aliases `/DeviceConfig/PanelQuery`, `/StationPass/{SubmitPanel,FixTime}`, `/oldmes/push` | P2 | `api/devsrc.py`, `api/board.py` | decide/retire |
| 14 | 现场参数缺口：13 个 legacy `get_param` 键在新库没有行/没有消费方（`pallet.check_ng`、`emp.require_emp`、`laser.{keep_alive,close_drain_ms}`、`oqc.aql_{level,severity,ma,mi,lot_basis}`、`oqc.sample_boxes`、`spc.{lsl,usl}`、`alert.scan_minutes`） | P2 | `api/pallet.py`、`core/emp.py`、`core/oqc_aql.py`、`api/analyze.py`、`run.py`、`设备对接工具/镭雕机/laser_sn_server.py` | 迁移 315 补行 + PARAM_DEFS 暴露 + 逐项接线（见下） |
| 15 | SPC 退化成「工位不良率」汇总，丢了控制图（`prd_test` 参数点、均值±3σ、`spc.lsl/usl` 的 Cp/Cpk、超限点） | P2 | `api/analyze.py` `spc_params` / `report_spc` vs `mesrj.js` | 按源重写 `/report/spc/params` + `/report/spc` |

### E.1 关闭记录（2026-11-20 第 4/5 波）

| 缺口 | 提交 | 验证 |
|---|---|---|
| #4 镭雕发码 | `b6b7210be7` | 真发码/游标/面板分组/超量拦截/TCP 往返 |
| #8 打印代理 | `b090d0aef0` | 夹具任务 → 代理单轮 → 已打印 + 心跳参数 |
| #13 设备别名 + 设备侧 JWT 闸误拦 | `0a60176331` | 7 项（含无 key 401、每块 NG/DefectCode、FixTime 时限） |
| #13 `/oldmes/push` 假占位（表都不存在） | `b8586f8d72` | 新增/覆盖/看板取 ATE/空包拒绝 |
| 路由对账（`/exec/sn/rules`） | `835b5af0d5` | 段合计≠总长 → ok=false |
| #14 现场参数 + #15 SPC 控制图 | 见 `315_mesrj_legacy_params.sql` | 参数可见 13/13、pallet 拦/放、SPC Cp/Cpk、AQL 默认值、`emp.require_emp` 拦/放、预警巡检落库 |

仍未关闭：#7 备份（`public.prd_decode_log` 属主/序列 ACL 需 DBA）、#11 真数据导入（等 ops 拍切换）、
`material.low_pct` 的「按工单剩余可用量」判线（源 `core/material.py calc` 未移植，当前只用 `material.low_qty` 全局线）、
`gkg.*`（新架构走 `POST /mesrj/gkg/scan` 手动导入）。

Everything in Part 1 §4 (station-pass engine, SMT loading, rework, `/mes/*`, OQC AQL, pallet/panel extras,
`/sys` CRUD, tri-lingual i18n) stays as-is and must not be regressed by the merge.
