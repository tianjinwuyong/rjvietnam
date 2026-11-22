CLAIM: services/api/server.js (round-3 station split: edge band 5405-6115 + scrap band 6135-6414, pre-cut coordinates), services/api/src/routes/station-edge.js (new), app_rules/server-split.md (new lane rules), .agents/skills/server-js-split/SKILL.md (new), app_rules/README.md (index line)
Lane: api
Owner: opencode (server.js split lane, refactor-plan-2026-11-21 stage 3 round 3)
Expires: 2026-11-25T23:59:59+07:00
Purpose: Move the two contiguous station bands verbatim out of server.js: (edge) 拦截/工单请求/维护交接/NG 复活审计/SN 守卫/sync 对账冲突, 20 routes → registerStationEdgeRoutes; (scrap) 统一报废审批链/驻留统计/工位数据清除 + overall-balance/lineage, 10 routes → registerStationScrapRoutes. Both register calls sit at the exact original lines — ABOVE app.use("/api",api) and the app-level auth gate (gate_line now 14802), so the JWT-exempt-by-position semantics are unchanged; the 3 scrap-approval routes keep their inline authenticateJWT via a forwarding closure (TDZ, station-ops precedent). server.js 2457→2383 KB this round (−74 KB).

EXCLUDED: /api/station/activity + inventory + bucket-snapshots + database-management + ng-guard + ng-special-exemption (lines 4675-5300: interleaved pda/mes/quality routes and module-level LEGACY_BUCKET_STATION_ALIASES / stationBucketSnapshotCache declarations — not a pure contiguous band, later round); the stationOpsDeps block between the two bands stays; parallel-lane uncommitted hunks (pmc.view perm line, /mes/heartbeats/stream public path) are NOT staged and were preserved in the worktree.

REPAIRS INSIDE THE MOVE (latent bugs that travelled with the block, broken at HEAD too):
1. GET /api/station/ng-revival/audit `?sn=` path: `const snCond` reassigned → runtime TypeError at HEAD (tsc TS2588 surfaced it); fixed to `let`.
2. Same query: `UPPER($3)` against a jsonb-text expression → pg "无法确定参数 $3 的数据类型" (500) even after (1); added `::text` cast.
3. Same handler's second query: LIMIT placeholder index double-counted sn (`$4` with 3 params) when `?sn=` present; index fixed.
Proven live: `?stationCode=manu_rework&sn=ZZTEST123` → 200 `{ok:true,items:[]}` on both trees. No other endpoint behavior changed.

Verification: worktree census multiset identical before/after (2868=2868); commit-candidate tree (git archive HEAD + this move only, junction node_modules) census identical to HEAD (2769) and boots; table-driven authenticated smoke 30/30 on worktree :8095 AND clean tree :8096 (reads 200, writes via first-guard rejection 400/404 only; DELETE /api/station/data targets a nonexistent sentinel — splice on empty array is a no-op). register-deps OK / auth-order stranded=0 (registerCalls=12) / shadowing 10=10 / migrations 362=baseline / syntax 389 files / api-typecheck 561≤595 / test:unit 1342 pass 0 fail.

Round-3 continuation (2026-11-22): bucket band (inventory PUT/GET, bucket-snapshots
PUT/GET, database-management, ng-guard, ng-special-exemption — 7 routes, ~30 KB,
old 4765-5277) moved verbatim into the same file as registerStationBucketRoutes,
register call at the original line (above the gate, JWT-exempt unchanged).
LEGACY_BUCKET_STATION_ALIASES + stationBucketSnapshotCache are used ONLY inside
the band -> travel with it (cache rewritten in place, same object as before).
The four exports now share ONE hoisted stationEdgeDeps declared above the earliest
call site (check:register-deps requires every call site to pass every destructured
name; comments must stay OUTSIDE the braces — the checker joins object lines with
spaces and // comments swallow the rest). server.js 2383->2353 KB.
Verified: worktree census identical before/after (2878 incl. parallel-lane routes);
commit-candidate tree census identical to HEAD (2769) and boots; smoke 30/30 (round-3
regression) + 7/7 (bucket) on worktree :8097 and clean tree :8098 — bucket PUT via
DOMAIN_MISMATCH rejection (no write), inventory PUT via ZZ sentinel row deleted after.
register-deps / auth-order(0, calls=13) / shadowing(10=10) / syntax(390) /
api-typecheck(561<=595) green; test:unit green.
