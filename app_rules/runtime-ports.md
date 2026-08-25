# Runtime Port Rules

## Owns

- port assignments for apps and services
- startup notes for network-facing processes

## Required ports

- Web console: `5173`
- Scanner terminal: `5174`
- Display board: `5175`
- API service: `8080`
- Realtime service: `8081`
- Worker service: no public port

## Required rules

1. Every network-facing surface must have its own unique port.
2. Do not reuse `5173` for any other frontend surface.
3. Keep ports in docs, scripts, and runtime configs synchronized.
4. Worker processes stay off the public port list.

## Test URLs

- **3D Line (MES)**: `http://localhost:5178/#manual-line-3d`

## Handoff

- If a service changes ports, update the port map doc and the startup script in the same change set.
