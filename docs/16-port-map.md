# Port Map

The runtime surfaces in this system should not share ports.

## User-Facing Apps

| Surface | Default port | Notes |
| --- | --- | --- |
| Web console | `5178` | Main office and management UI |
| Scanner terminal | `5174` | Touch and barcode optimized operator UI |
| Display board | `5175` | Large-screen production display |

## Services

| Service | Default port | Notes |
| --- | --- | --- |
| API service | `8080` | Main backend API |
| Realtime service | `8081` | Dashboard and operator event stream |

## Non-network services

| Service | Port |
| --- | --- |
| Worker service | none |

The worker runs as a background process and should not expose a public listening port.

## Deployment rule

- Keep each network-facing service on a unique port.
- Do not reuse `5178` for any other frontend surface.
- Use separate env vars for each service, for example `WEB_PORT`, `SCANNER_PORT`, `DISPLAY_PORT`, `API_PORT`, and `REALTIME_PORT`.
- Keep port defaults in docs and deployment config synchronized.
