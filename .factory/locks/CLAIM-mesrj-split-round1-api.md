CLAIM: services/api/src/routes/mesrj.js (round-1 split: W10 smta block, then round-1 continuation: pack/panel/pallet/repair/analyze/bind/laser/shift/dwell blocks), services/api/src/mesrj/{smta,pack,panel,pallet,repair,analyze,bind,laser,shift,dwell}-routes.js (new)
Lane: api
Owner: opencode (server.js split lane, refactor-plan-2026-11-21 stage 3 round 1)
Expires: 2026-11-23T23:59:59+07:00
Purpose: Move the W10 辅料管控 (smta, 31 routes, 63 KB) block verbatim out of createMesrjRouter into src/mesrj/smta-routes.js following the existing registerXxxRoutes(router, {deps}) convention (ultra/fixture/aging). Registration position unchanged: same line, after JWT middleware, before W11 pack. Route census total and smta prefix must be identical after the move.

EXCLUDED: every other block in mesrj.js. The uncommitted parallel-lane wiring in this file (ultra/laser/itf/aoi-sync register imports + is_super auth change + /aoi/export rewrite) is NOT mine and will not be staged — commit selects only my hunks via the commit tooling. CLAIM-mesrj-smt-oqc-routes-api.md (mesrj-graft) expired 2026-11-21T07:00; smt/oqc blocks (10621+) untouched by this round regardless.

Coordination: cut issued against line numbers read in the same minute; first line of removed block verified to be the W10 marker before paste. If you are mid-edit in the smta block, say so in the mailbox and I will take another domain.

Round-1 continuation (2026-11-22): nine domains (131 routes) moved verbatim to src/mesrj/*-routes.js, registerXxxRoutes(router, deps) at original positions. mesrj.js 546->383 KB (<400 KB plan target met). Census multiset identical (total=2868); api-typecheck 595->561 zero new signatures; authenticated smoke 129 pass / 4 explicit skips / 0 fail on :8091. P1 gap block (parallel lanes' uncommitted aoi/export rewrite) deliberately NOT moved; their imports (tsStr, aoi group, ultra/itf wiring) left untouched. Same exclusions as above still apply.