CLAIM: services/api/src/mesrj/gap-routes.js (NEW), services/api/src/routes/mesrj.js (只加不改: 1 import line + 2 register calls at existing mount points), services/api/server.js (只加不改: 1 element appended to DEVICE_OPEN_PATHS array for /mesrj/Device/UltraScan — required by device-key.js:13 documented rule; no existing entry moved, JWT wrapper untouched)
W17 (frontend embed, 2026-11-22 追加): apps/web/src/mesrj/views-w17.tsx (NEW), apps/web/src/mesrj/menu.js (10 叶子按源位置插入), apps/web/src/mesrj/index.tsx (import + 10 renderView 分支), apps/web/src/mesrj/labels.ts (206 三语条目追加), database/migrations/396_mesrj_w17_menu_perms.sql (NEW)
Lane: api
Owner: opencode (ruijing-mes → mesrj gap graft)
Expires: 2026-11-24T23:59:59+07:00
Baseline: HEAD b374884 of github.com/tianjinwuyong/ruijing-mes (deployed live at rjms:8088)

Purpose
-------
Close the residual route delta between the working ruijing-mes (源 499 routes) and the
already-grafted mesrj domain. Census (see .factory/mes-graft-census.json) = 489/499 covered
after folding renamed equivalents. This lane adds the 10 genuinely-absent endpoints and
NOTHING else.

Shared-file rule: services/api/src/routes/mesrj.js is touched ADDITIVELY only —
  (a) one import line near the other `register*Routes` imports (~L107),
  (b) one `registerDeviceGapRoutes(router, {…})` call inside the pre-JWT device block,
  (c) one `registerMesrjGapRoutes(router, {…})` call among the JWT-side register* calls.
No existing line is edited or moved. server.js is NOT touched (no auth-order/mount change).

Endpoints added (all read existing tables — verified against live DB, NO migration):
  JWT side (registerMesrjGapRoutes):
    GET  /smt/mo_variants      板别列表（源 smt.py mo_variants）        perm prod.pass
    POST /smt/mo_variant       设 ord_mo.feeder_model（源 mo_variant）   perm smt.load→md.edit
    POST /smt/load_recommend   扫料盘→候选站位（源 load_recommend）       perm smt.load→md.edit
    GET  /plan/kitting         齐套检查（源 plan.py kitting）            perm null(view)
    GET  /report/station-board 工位看板（源 analyze.py station_board）   perm null(view)
    POST /md/machine-source/point-to-mo  机台批量指向工单（源 md.py）     perm md.edit
    POST /bind/teardown        拆壳返工 action='拆壳'（源 bind.py）       perm prod.bind
  device side X-Api-Key (registerDeviceGapRoutes, pre-JWT):
    POST /Device/UltraScan     超声扫码旁路闸门（源 devcfg_fix.py）
    GET  /Device/UltraScan/recent  最近扫码（源 devcfg_fix.py）
    GET  /DeviceConfig/OpenMo  路线快照感知工单下拉（源 devsrc.py，修 LineMOs line_code bug）

NOT added: /smt/load_confirm — capability already exists as /smt/load_check (validate+record
  in one call; non-strict path records without machine/slot; prd_material_load.load_type exists).
  Re-adding a near-duplicate violates "don't re-add what exists under another path".

Envelope/auth per grafting-standards §4: mesrj 域内信封 {success,msg,data} + requireMesrjPerm;
device routes X-Api-Key (requireDeviceKey, fail-closed) + 源逐字契约 (Success/Message/verdict).

Verify: node --check server.js; check:register-deps; check:route-census (total must grow);
check:auth-order (stranded=0); check:route-shadowing (dead_guards not grow); boot + JWT probe
each new path (200/403 = registered; device: correct key 200, wrong key 401).
