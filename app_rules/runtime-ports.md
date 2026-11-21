# Runtime Port Rules

## Owns

- port assignments for apps and services
- startup notes for network-facing processes

## Required ports

Authoritative source is `services/watchdog/watchdog.js:17-21` (what actually gets
supervised) plus each app's `vite.config.ts`. Values below were verified against
both on 2026-11-20; the previous edition listed the web console as `5173`, which no
config in this repository has ever served.

- Web console (`apps/web`): `5178`
- Scanner terminal (`apps/pdas/scanner-terminal`): `5174`
- Display board (`apps/display-board`): `5175`
- API service (`services/api`): `8080`
- Supplier portal (`services/supplier-portal-api`, Python/FastAPI): `8098`
- Realtime service (`services/realtime`): `8081`
- Station agent (`apps/station-agent`): `5179`
- 3D factory view (second Vite instance over `apps/web/factory3d`): `5179` in
  `start_dev.js` — see rule 5 before adding a surface here
- Worker service: no public port

## Required rules

1. Every network-facing surface must have its own unique port.
2. Do not reuse `5178` for any other frontend surface; it is the Playwright `baseURL`
   and the whole e2e gate assumes it.
3. Keep ports in docs, scripts, and runtime configs synchronized.
4. Worker processes stay off the public port list.
5. Port `5179` is claimed twice — `apps/station-agent` (`vite.config.ts:12`) and the
   3D viewer spawned by `start_dev.js`. They cannot run together. Resolve the
   collision before adding a fourth surface, rather than documenting around it.

## Test URLs

- **3D Line (MES)**: `http://localhost:5178/#manual-line-3d`

## Production: which compose file actually runs

The live stack on `rjms` starts from `/home/wy/smt-factory-system/docker-compose.yml`
(~5.6 KB, hand-maintained on the host). That file is not in git: the repository's
`docker-compose.yml` is a 507-byte stub and the tracked `docker-compose.prod.yml` is
not the file `docker compose` reads there. Verified 2026-11-21 with `docker inspect`
on `smt-api` (its `com.docker.compose.project.config_files` resolves to the host
default) plus `grep` of both files.

Two consequences worth knowing before you deploy:

1. A variable added only to `docker-compose.prod.yml` never reaches production. The
   station device credential (`STATION_LOGIN_KEY`) is read from the host default
   file's `api.environment` plus the host `.env`; that is the only place it works.
2. Copying the repository stub over the host file would take the whole stack down.
   Bringing the host file under version control is the fix, and it is an owner
   decision about the deploy pipeline — not a cleanup to slip into another change.

Check what is running before believing any compose file: `docker inspect -f
'{{.Config.Image}} {{index .Config.Labels "com.docker.compose.project.config_files"}}'
smt-api`. On 2026-11-21 the running image was `sync20261121c` while
`docker-compose.prod.yml` still named `sync20261120` — three tags behind, silently.

## Local capacity note

`max_connections=100` with `superuser_reserved_connections=3` on this box. One API
instance is worth ~20-25 of them: the main pool and the auth pool are each `max: 10`
(the two `new pg.Pool({...})` declarations near the top of
`services/api/server.js`, before `const app = express()`), plus the OA pool it opens
at boot. Four or five instances plus a harness run is therefore enough to produce
`500 remaining connection slots are reserved for roles with the SUPERUSER attribute`,
which has been mistaken for a code fault twice. Boot a spare instance, use it, kill it
in the same step.

## Handoff

- If a service changes ports, update the port map doc and the startup script in the same change set.
