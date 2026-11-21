# End-to-end journeys

<!--
  Owner: humans only (harness/ is PROTECTED). The factory cannot edit this file.

  HOW THESE ARE DRIVEN. `driver: http` in harness/harness.config.json. The gate boots
  `node services/api/server.js` on a free port and polls /health until it answers
  `"status":"ready"`. Everything below is then reached through that base URL.

  PRE-CONDITION the gate does NOT provide: a seeded `smt_factory` PostgreSQL database
  and the web console on http://127.0.0.1:5178 (`npm run dev:web`) for the journeys
  that mention a screen. Start the web console before running the full gate.

  NUMBERS ARE ASSERTED BY RECONCILIATION, NOT BY LITERAL. The seed changes as the
  factory is used, so "there are 47 lots" would rot by Thursday. Each journey instead
  says: query the database with the statement below, then confirm the API agrees
  exactly. The failure it is designed to catch is the realistic one -- a list that
  silently drops rows, a total computed from the wrong table, a filter that hides
  rejected material.

  REPLACE the placeholder token in each step with the real one: credentials are in the
  database, never in this file.
-->

## J1 — A warehouse operator's token opens the warehouse, and nothing opens without it

1. `GET /health` returns 200 and a body containing `"status":"ready"`.
2. `GET /wms/raw-material-inventory` **without** an `Authorization` header returns
   **401**, not 200 and not a redirect.
3. `POST /auth/station-login` with `{"operator":"VN_MATERIAL_RECEIVER","stationCode":"AC-CABLE-01"}`
   returns 200 and a JWT in `data.token`.
4. `POST /auth/station-login` with `{"operator":"NOT_A_REAL_OPERATOR","stationCode":"AC-CABLE-01"}`
   returns **401** with `error.code = "AUTH_FAILED"`.
5. Re-run step 2 with `Authorization: Bearer <token from step 3>`. It now returns 200.

**What would make this fail:** an anonymous read succeeds, a bad operator is handed a
token, or a valid token still gets 401 — the last one is what a route registered above
the global auth middleware looks like from the outside.

## J2 — What the warehouse sees is exactly what the database says

1. With the token from J1, call `GET /wms/raw-material-inventory`. Note the number of
   items in `data.items` and the set of `material_lot_id` values.
2. Read the same inventory from PostgreSQL directly:
   ```
   node -e "…"   -- connect with the credentials in services/api/.env and run:
   SELECT count(*) FROM material_lots WHERE <same population the endpoint uses>;
   ```
   The endpoint's source is `app.get("/wms/raw-material-inventory")` in
   `services/api/server.js`; copy its WHERE clause rather than guessing one.
3. The two counts are **equal**, and every `material_lot_id` from the API exists in the
   SQL result. No row is present on one side only.
4. For the lot whose `iqc_status` is `rejected`, confirm it still appears in the list.
   Rejected material is visible in inventory, not deleted from it.

**What would make this fail:** the endpoint returns a subset (a stale filter), a lot that
was rejected disappears, or a `LIMIT` truncates without a total.

## J3 — Supplier master data is complete and trilingual

1. `GET /wms/suppliers` returns 200.
2. Every item has non-empty `code`, `name_zh`, `name_en` **and** `name_vi`. Report the
   count of suppliers missing any of the three.
3. `SELECT count(*) FROM suppliers WHERE status = 'active'` in PostgreSQL equals the
   number of items returned by the endpoint.
4. Pick the first supplier, request it through whatever single-supplier route the
   module exposes, and confirm the name fields match the list row exactly.

**What would make this fail:** a supplier is listed without its Vietnamese name (it
prints as a blank in the receiving screen), or the count disagrees with the table.

## J4 — The warehouse list and the lot table cannot disagree

This journey replaces an earlier one that asserted a `wms_finished_goods.oqc_status`
column. That column does not exist (the table carries `iqc_status`, `oqc_inspector`,
`oqc_inspected_at`, `status`) and the table was empty, so the check could never pass and
never fail — the exact trap this file warns about. The version below was run against
live data before it was written down: 100 API items, all matched.

1. With the warehouse token, `GET /wms/raw-material-inventory` → 200, `data.items` is a
   **page** (currently capped at 100 even though `material_lots` holds 517 rows). Record
   the `material_lot_id` list and each `received_qty`.
2. In PostgreSQL, select those ids from `material_lots`:
   `SELECT id::text, received_qty::text, voided_at FROM material_lots WHERE id = ANY($1)`.
3. **Every** id from step 1 exists in the DB, and `received_qty` matches exactly after
   numeric comparison. Report the counts: `missing`, `mismatch`.
4. None of the returned lots has `voided_at` set, and none has a **negative**
   `received_qty`. A voided lot appearing in warehouse stock, or a negative balance
   rendered as stock, is the failure a person would notice as "we cannot have minus
   forty of that".

**What would make this fail:** the endpoint joins a different quantity column than the
one it displays, a `voided_at` filter is dropped, or the response is cached from a
previous shape. Because the page is capped, also record whether the endpoint exposes a
`total` — a silent truncation with no total is itself worth reporting.
