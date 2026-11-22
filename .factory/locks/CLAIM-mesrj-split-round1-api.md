CLAIM: services/api/src/routes/mesrj.js (round-1 split: W10 smta block only, lines 5752-7146 at claim time), services/api/src/mesrj/smta-routes.js (new)
Lane: api
Owner: opencode (server.js split lane, refactor-plan-2026-11-21 stage 3 round 1)
Expires: 2026-11-23T23:59:59+07:00
Purpose: Move the W10 辅料管控 (smta, 31 routes, 63 KB) block verbatim out of createMesrjRouter into src/mesrj/smta-routes.js following the existing registerXxxRoutes(router, {deps}) convention (ultra/fixture/aging). Registration position unchanged: same line, after JWT middleware, before W11 pack. Route census total and smta prefix must be identical after the move.

EXCLUDED: every other block in mesrj.js. The uncommitted parallel-lane wiring in this file (ultra/laser/itf/aoi-sync register imports + is_super auth change + /aoi/export rewrite) is NOT mine and will not be staged — commit selects only my hunks via the commit tooling. CLAIM-mesrj-smt-oqc-routes-api.md (mesrj-graft) expired 2026-11-21T07:00; smt/oqc blocks (10621+) untouched by this round regardless.

Coordination: cut issued against line numbers read in the same minute; first line of removed block verified to be the W10 marker before paste. If you are mid-edit in the smta block, say so in the mailbox and I will take another domain.