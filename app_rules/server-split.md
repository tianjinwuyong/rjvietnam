# Server.js Split Rules (阶段3 lane)

## Owns

- The mechanical extraction of contiguous route blocks from `services/api/server.js` into `services/api/src/routes/*.js` (refactor-plan-2026-11-21 阶段3).
- The register-call mount line each block leaves behind.

## May edit

- `services/api/server.js` (only the band being moved + its register call + its import line)
- `services/api/src/routes/<domain>.js` (new or extended)
- `services/api/src/*-shared.js` (helper extracted because server.js keeps callers of it)
- `tests/*.test.ts` **only** to repoint assertions that grep server.js *text* at the moved module
- `.factory/locks/CLAIM-*.md`, `docs/refactor-plan-2026-11-21.md`

## Must not edit

- auth policy internals: moving `authenticateJWT` itself, or any band that would cross the app-level gate (L15764). Mount position is load-bearing.
- another lane's uncommitted hunks (see "Travelling lines" below).
- the sync-frozen zone: `live-sync.js`, `mes-sync.js`, `src/mesrj/itf/`, `src/oa/`, `oa-integration.js` — never in any round's band list.
- `harness/END-TO-END.md` (humans-only).

## Method: 搬迁而非复制 (move, not copy)

One domain per round. The block is moved **verbatim**; `server.js` keeps only a `register<Domain>Routes(app, {deps})` call **at the exact line the block used to occupy**. Registration order above/below the auth gate is part of the contract — a route registered before the gate is JWT-exempt by position, and that must not change.

## The procedure (fixed order)

### 1. Pick the band

- Must be a **contiguous single-prefix** block (or two adjacent sub-bands sharing one domain) with **no module-level declarations inside**: verify `awk 'NR>=A && NR<=B && /^(const|let|var|function|async function|class) /'` is empty. A band with `const`/`function` at top level violates the recipe — either exclude them or they are genuinely shared (see step 3).
- Verify **no parallel-lane dirty hunks** land inside the band: `git diff HEAD -- services/api/server.js | grep '^@@'`, parse the start line of each, reject any that falls in `[A,B]`.
- Pin the edges with an assertion in the cut script: first line starts with the expected `app.<verb>("/prefix"`, last line is `});`, and the line after is the next section banner. Anchors that don't match abort before any write.

### 2. Snapshot census before

`scripts/check-route-census.mjs` walks `services/api/**/*.js` and counts `ROUTE` matches. Before cutting, dump the full sorted multiset to a scratch file (repo-root `.tmp-*`, **never under `services/api`** — see Gotchas). After cutting, the multiset must be **identical** (total unchanged; the routes just moved files).

### 3. Derive deps — `tsc --checkJs` is the only truth

Wrap the band body in `function reg(app, deps){ …body… }` (with `query`/`errorEnvelope`/`createHash`/`neuralBroadcast` pre-imported so they don't pollute the list) and run:

```
npx tsc --checkJs --allowJs --noEmit --target es2022 --module nodenext --moduleResolution nodenext <probe>.mjs
```

The `Cannot find name 'X'` set **is** the deps line. Classify each:

| Declared as | Where | How to hand it over |
|---|---|---|
| module import | `../db.js`, `../shared/helpers.js`, `node:crypto`, `../shared/neural-bus.js` | `import` directly in the new file |
| `const`/`function` ABOVE the band | server.js line < A | pass by name in deps (safe) |
| `const`/arrow BELOW the band | server.js line > B — **`authenticateJWT` (~13364)** | **forwarding closure**: `authenticateJWT: (req,res,next)=>authenticateJWT(req,res,next)` — direct passing reads it in its TDZ and hands Express `undefined` (boot-time `ReferenceError`/arg rejection that `node --check` cannot see). `check:register-deps` flags exactly this shape. |
| mutable shared state | `recentStationEvents` array, caches | inject **by reference** — a copy keeps the route working but silently breaks every other reader that shares the real one |
| band-declared fn used by a LATER mount | e.g. `ensureCollectOrder` used by the PMC mount | `return { fn }` from the register call; server.js does `const { fn } = registerBand(...)` and forwards it into the later mount as a closure |

### 4. Cut with a script

Host shell is PowerShell: write a `.tmp-rN-cut.mjs` at repo root, run with `node`. Splice **bottom-up** (higher line numbers first) so earlier anchors stay valid while editing the array. Replace each band with its comment + register call; insert the import next to its sibling route imports.

### 5. Verify (all must be green before commit)

- `node --check` server.js and the new module.
- `check:route-census` — total unchanged vs the step-2 snapshot.
- `check:register-deps` — catches TDZ + a name server.js never declares.
- `check:auth-order` (stranded=0), `check:route-shadowing` (baseline must not grow), `check:syntax`, `typecheck:api` (≤ baseline; a dropped count is fine, a raised one is a human decision).
- `test:unit` — **contract tests that grep server.js text** (e.g. `wms-lot-lock-contract.test.ts`) go red on a clean move; repoint the assertion to `server.js + the new module` (same needle, same threshold). Do not weaken the needle.
- **Clean-tree proof**: `git archive HEAD` → apply **only this move** (strip parallel-lane uncommitted lines like the migration-332 filters, which aren't in HEAD) → junction `node_modules` → boot on a free port → table-driven authenticated smoke covering **every** moved endpoint. Reads expect 200; writes are exercised only through their first-guard rejection branch (400/404/409) so nothing mutates. `404` does **not** prove registration — the SPA catch-all answers unknown paths; a known handler returning 200/400/403/404 proves the route registered.

### 6. Schema-drift repairs travel with the block

Some moved endpoints were already broken at HEAD (SQL references columns no migration ever created — e.g. `it.from_location`, `pda_inspection_records.material_lot_id`, `sl.temperature_min`). The move surfaces them as smoke failures. Fix to the **canonical migration shape**, prove the fix end-to-end on a throwaway `is_test` row, then delete that row. Record each repair in the claim; it is a behavior change (500 → working), not a regression.

## Travelling lines (parallel-lane attribution)

A band may contain another lane's **uncommitted** lines (e.g. migration-332 manual-lock SQL filters). Decide by content:

- Additive SQL whose columns already exist in the live DB **and** a committed/contract test asserts their presence → move verbatim with the block, include in the commit, attribute the lane in the commit body + claim.
- A foreign **untracked test file** that depends on other lanes' untracked modules (e.g. the lock contract test + `wms-ops.js` + migrations 332/333) → do **NOT** stage it; repair it in the worktree so it's green, and leave it for the owner lane's commit. Say so in the claim.

## Commit + push

- Use the selective `commit` tooling (never `git add -A` — hundreds of scratch files, other agents' work). Select only your hunks; leave foreign `@@` hunks out.
- Write `.factory/locks/CLAIM-<artifact>-<lane>.md`: lane, owner, files, EXCLUDED, travelling lines, verification numbers.
- Push with `SKIP_PREPUSH=1` when parallel-lane in-flight files would trip the local hook — those files don't reach the remote; the remote CI validates the clean tree. Confirm the run goes green.

## Gotchas (learned the hard way)

- **`check:register-deps` reads a hoisted deps object by joining its lines with SPACES** (`objectLiteralFor`), so a `// comment` on its own line *inside* `const xDeps = { … }` swallows every entry after it — the gate then reports every destructured name as UNPASSED and looks like a real bug. Keep comments for a hoisted deps object **above** the `const` line, never inside the braces.
- **One shared deps object across several `registerXRoutes(app, deps)` calls must be complete**: the gate checks, per call site, that the object passes *every* name destructured anywhere in the module file. Consolidating several bands into one module means one union deps object — declare it above the earliest call site.
- **Never leave a copy of `server.js` (or any `*.js`) under `services/api/`.** `check-route-census` walks that tree and counts every `*.js`; a `.bak`/duplicate of the pre-cut file silently adds the whole band a second time (2868 → 2898) and the gate stays "green" because it only checks the floor. Scratch lives in repo-root `.tmp-*` (gitignored) or `/tmp`.
- **`const X=""; if(...) X=…`** reassign-to-const is a latent runtime `TypeError` that `node --check` and even `tsc` miss in some shapes; HEAD has several (`snCond`). Fix to `let` as it travels and note it.
- **awk `\b` counting on server.js is unreliable** for identifiers embedded in template strings; extract the band with `sed -n 'A,Bp'` and `grep -cE "(^|[^.[:alnum:]_])name\b"`.
- **TDZ is a boot failure, not a syntax error.** `node --check` passes while `app.listen` never runs because a deps object reads a `const` declared later. `check:register-deps` + booting the app are the two catches.
- **Line numbers drift** under parallel agents between reading them and cutting. Re-assert every anchor in the cut script; abort on mismatch; the parallel edits that landed *above* your band shift your anchors but the band content is unchanged — re-run the cut script, don't hand-patch.
