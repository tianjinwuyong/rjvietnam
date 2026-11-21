# Holdout scenarios

<!--
  Owner: humans only. `.factory/holdout/` is PROTECTED and on every workflow node's
  deny list: the builder cannot read this file, which is the only reason a merge may
  land on evidence the builder never optimised against.

  DIFFERENT FROM `harness/END-TO-END.md`: those journeys assert one workflow each and
  the builder can read them. These compose two things that are individually correct
  and can still disagree -- cross-role visibility, permission × data, configuration ×
  response. That is the failure mode that ships: every part green, the seam broken.

  EVERY ASSERTION NAMES AN OBSERVED VALUE. No "the endpoint works". The agent writes
  down what it saw next to what it expected.

  STATE OF THE PRODUCT THESE WERE WRITTEN AGAINST: the read surfaces below were
  verified live on 2026-11-20 against a seeded `smt_factory` database. The write paths
  in WMS receiving (QR bindings, IQC handover) currently return 401 for a valid token
  -- see the escalation in `factory/` notes -- so composition scenarios that need a
  write are deliberately NOT here yet. Add them when that is fixed; a scenario for
  behaviour that cannot run reds the gate for the wrong reason.
-->

## S1 — Two roles, one endpoint: authorization narrows the door without changing the room

1. Log in three times via `POST /auth/station-login`, all on station `AC-CABLE-01`:
   `VN_MATERIAL_RECEIVER`, `VN_OP_001`, `MO_LI_BIN`. Keep the three tokens.
2. `GET /wms/raw-material-inventory` with the **VN_MATERIAL_RECEIVER** token → 200.
   Record the number of items and the sorted list of `material_lot_id`.
3. The same call with the **VN_OP_001** token → **403**, and the body's `error.code`
   is `FORBIDDEN` (not `UNAUTHORIZED` — that distinction is whether the token was read
   at all).
4. The same call with the **MO_LI_BIN** (plant manager) token → 200, and the item count
   and `material_lot_id` set are **identical** to step 2.
5. `GET /api/lifecycle/lots` with the **VN_OP_001** token → 200. An operator is denied
   warehouse balances and allowed lot lifecycle. Both statements must hold at once.

**Why composition:** step 3 passing and step 4 failing means the permission check
narrows the response instead of the door. Step 2 and step 4 disagreeing means the route
filters rows by role — an authorization change silently rewriting data.

## S2 — The health check describes the server that is actually listening

1. Ask the gate's driver for the base URL it will use (the dynamic port it selected).
2. `GET /health` on that base URL → 200, `ok: true`.
3. The `port` field in the body **equals** the port in the URL you called.
4. `service` is the literal string `api`, and `status` is the literal string `ready`.

**Why composition:** the ladder polls `health_path` with `health_contains: "ready"`.
A server that hardcodes `port: 8080` in its health body, or a second process that
answers on the port, passes the ladder and then fails every journey — this is the check
that separates "something answered" from "our API answered on the port we chose".

## S3 — Inventory arithmetic is the same from both sides of the system

1. With the VN_MATERIAL_RECEIVER token, `GET /wms/raw-material-inventory`. For each
   item keep `material_lot_id`, `material_code`, `received_qty`, `reserved_qty`.
2. Compute, in the agent's own arithmetic, `sum(received_qty)` grouped by
   `material_code`, and `sum(reserved_qty)` overall. Write the numbers down.
3. Via PostgreSQL (credentials in `services/api/.env`), run the same grouping over the
   table the endpoint reads from — `material_lots` joined the way the handler joins it.
4. Both totals are **equal to the cent/unit**. Then repeat step 1 and confirm the
   grouped totals did not move between the two reads with no write in between.
5. At least one item has `iqc_status = 'rejected'`. Confirm it is present in the API
   response and included in the SQL totals — rejected stock is visible and counted, not
   hidden or deleted.

**Why composition:** it crosses the API and the database, and it re-reads. A cached
aggregate, a `LIMIT`, or a status filter that hides rejections all pass a count check
and fail this one.
