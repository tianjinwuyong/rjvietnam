---
name: server-js-split
description: Move a contiguous route block out of services/api/server.js into a src/routes/*.js module (refactor-plan 阶段3). Use when asked to split/extract/move server.js routes, a WMS/MES/station/PMC/QMS domain out of the monolith, or when a round of the server.js split plan is being executed.
---

# server.js Split (round procedure)

Extract one domain band from `services/api/server.js` by **moving, not copying**: the block goes verbatim into `services/api/src/routes/<domain>.js`, and server.js keeps a `register<Domain>Routes(app, deps)` call at the exact original line. Mount position relative to the app-level auth gate (server.js ~L15764) is load-bearing — routes registered above it are JWT-exempt by position and stay so.

Full rules, dep classification table, and gotchas: `app_rules/server-split.md`. Read it first.

## Checklist per round

1. **Claim** — write `.factory/locks/CLAIM-<artifact>-api.md` before editing; list EXCLUDED bands and any parallel-lane files.
2. **Band** — contiguous single-domain, `awk 'NR>=A && NR<=B && /^(const|let|var|function|async function|class) /'` empty, no dirty `@@` hunk start inside `[A,B]`, edges asserted in the cut script (abort on mismatch).
3. **Census snapshot** — dump the sorted route multiset of `services/api/**/*.js` to repo-root `.tmp-*` (NEVER under `services/api/` — the gate counts every `.js` there; a stray copy double-counts).
4. **Deps** — `tsc --checkJs --allowJs --noEmit --target es2022 --module nodenext` on the band wrapped in `function reg(app,deps){…}`; the `Cannot find name` list IS the deps line. Imports go direct; consts above go by name; consts below (esp. `authenticateJWT`) go through a **forwarding closure** `(req,res,next)=>fn(req,res,next)`; shared mutable state by reference; helpers needed by a *later* mount are `return {fn}` from the register call.
5. **Cut** — bottom-up splice in a root `.tmp-rN-cut.mjs`; one comment + one register call per band; import beside sibling route imports.
6. **Gates** — `node --check` ×2, `check:route-census` (multiset identical), `check:register-deps`, `check:auth-order` (stranded=0), `check:route-shadowing` (baseline not grown), `check:syntax`, `typecheck:api` (≤ baseline), `test:unit` (repoint server.js-text contract assertions to `server.js + new module`, same needles).
7. **Clean-tree proof** — `git archive HEAD` + only this move (strip other lanes' uncommitted lines), junction node_modules, boot on a free port, table-driven authenticated smoke over EVERY moved endpoint: reads 200; writes only via first-guard rejection (400/404/409). 404 on an *unknown* path proves nothing; a known handler's status does.
8. **Travelling lines** — additive uncommitted SQL whose columns exist in the live DB moves with the block and is attributed in the commit body; foreign *untracked test files* stay out of the commit (repair them in worktree, owner lane commits them).
9. **Commit** — selective `commit` tooling only (never `git add -A`); update `docs/refactor-plan-2026-11-21.md` with an **[OK] 阶段3 轮N** block (KB delta, endpoints, repairs, verification numbers); push (`SKIP_PREPUSH=1` if parallel-lane in-flight files trip the local hook) and confirm the remote CI run green.
10. **Cleanup** — delete scratch (`rm -rf .tmp-rN*`; `cmd /c rmdir` junctions first so nothing descends into node_modules).

## Status

- 轮1 (mesrj) done: commits fe7416e, 938a6ef — mesrj.js 617→383 KB.
- 轮2 (WMS bands A+C) done: commit 80f225f — server.js 2614→2457 KB, 50 routes.
- 轮3 (station edge 20 + scrap 10 routes) done: see CLAIM-server-js-split-round3-api.md — server.js 2457→2383 KB.
- 轮3续 (bucket band 7 routes; band-local decls travel; ONE hoisted union deps object above the earliest call site, comments OUTSIDE the braces) done — server.js 2383→2353 KB.
- 轮4 (BOM 12+2, PMC alerts 9, closure 6 = 29 routes; all bands below the auth gate) done: CLAIM-server-js-split-round4-api.md — server.js 2353→2294 KB. Smoke uses a minted `permissions:["*"]` JWT so handler first-guard branches run, not just the 403 gate. New src/routes modules import `../db.js` (depth gotcha).
- Remaining bands: WMS B band (finance/OA interleaved — needs splitting, not moving), receiving scatter, shelf, closure dashboard; then 轮4 PMC/BOM, 轮5 QMS/MRB, 轮6 finance/auth/admin.
