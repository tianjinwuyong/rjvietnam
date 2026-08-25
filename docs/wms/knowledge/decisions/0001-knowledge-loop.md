# Decision 0001: Use a permanent WMS knowledge loop

- Date: 2026-08-25
- Related Paperclip issues: RJV-133, RJV-138
- Status: accepted

## Decision

WMS knowledge is stored in GitHub under `docs/wms/knowledge/`. Paperclip tasks must link to the relevant file or commit. Completion requires both verified delivery evidence and a durable learning record.

## Rationale

The team needs to compound learning across agents and sessions instead of losing decisions in chat or treating each task as new work.

## Required evidence

Every completed or blocked task records the context, decision, artifacts, test command/output, failure/root cause, and reusable next step.

## Safety boundary

Knowledge must be staging-safe. Do not commit passwords, tokens, employee data, production data, or unverified claims.
