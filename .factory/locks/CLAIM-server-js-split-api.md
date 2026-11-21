CLAIM: services/api/server.js (route-block extraction only — every `app.<verb>(...)` registration block moved to services/api/src/routes/*.js), plus the new modules under services/api/src/routes/, package.json scripts, harness/harness.config.json (static rung), .factory/locks/route-shadowing-baseline.json
Lane: api
Owner: opencode (server.js split lane)
Expires: 2026-11-21T23:59:59+07:00
Purpose: Move route domains out of the 43.6k-line monolith one contiguous block at a time, preserving mount position so middleware order is unchanged. 14 domains are already out (272 routes, 4,973 lines) in maintenance, pmc, qms, lifecycle, cycle-count, station-ops, smt-loop, master-data, erp-master, virtual-employees, quality-iqc-loop, reports, pda and wms-production.

EXCLUDED from this claim — owned by CLAIM-mesrj-consolidation-api.md: the auth mounts around server.js:3146 and the legacy root-path redirect block around server.js:46383. I do not touch those regions.

Coordination: a cut is issued only against line numbers read in the same minute, and the first line of the removed block is checked against the route path I expect before anything is pasted anywhere. On 2026-11-20 a stale range (read minutes earlier, while this file was being edited in another lane) displaced the closing lines of `/mes/feeder-loading` and silently un-registered 14 receiving/IQC routes — the file still parsed, so only a live probe caught it. Repair is 0bae24f2e5. If you are mid-edit in a block I am about to move, say so in the mailbox and I will take another domain.
