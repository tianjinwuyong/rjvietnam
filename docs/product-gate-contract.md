# Product Gate contract

`POST /api/mes/product-gate/evaluate` is the only station-entry decision interface Station Agents need to learn.

The Agent submits one immutable scan fact with Product Identifier, Station identity, operator, host IP, event time, and idempotency key. MES resolves PCBA SN or Shell SN to one Product, creates Product and Product Attendance only for a released first-station registration, evaluates route/NG/disposition/identity gates, stores the decision, and returns one of:

- `ALLOW` — start station work.
- `HOLD` — wait for identity, data, or authorization.
- `REJECT` — return to first, expected, or missing Station.
- `REPAIR_ROUTE` — follow the active NG dependent sequence.
- `COMPLETED` — no further normal production is permitted.

HTTP `409` carries a valid non-ALLOW business decision; it is not a transport failure. Retrying the same `idempotencyKey` returns the original decision. Agents must never turn network failure, timeout, or unknown response into `ALLOW`.

Persistence maps to migration `217_mes_product_root_and_gate.sql`: Product, typed identifiers, Product Attendance, Station visits, Product Gate decisions, dependent sequences, and binding relationships. Operational rows hold current state; immutable decision and relationship history explains every change.
