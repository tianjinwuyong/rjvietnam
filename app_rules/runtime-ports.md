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

## Handoff

- If a service changes ports, update the port map doc and the startup script in the same change set.
