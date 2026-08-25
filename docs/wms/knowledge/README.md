# WMS Knowledge Base

This is the durable, versioned knowledge base for the Ruijing Vietnam WMS.

The knowledge base is part of the delivery process, not a post-project archive. Every WMS task must leave a useful record here or link to an existing record.

## Required record

Each entry should include:

- date, author/agent, and related Paperclip issue ID;
- problem and business context;
- decision, alternatives considered, and rationale;
- changed files, artifacts, workspace, and branch;
- exact verification command and captured result;
- failure mode and root cause, when applicable;
- reusable guidance and follow-up dependencies.

## Rules

1. Search this directory before starting new WMS work.
2. Do not mark a task complete from a claim or summary alone.
3. Preserve failed attempts with their root cause; do not erase history.
4. Correct old knowledge with a dated follow-up entry.
5. Keep secrets, employee data, production data, and unsupported assumptions out of this repository.
6. Staging evidence must identify the disposable target and confirm that production systems were not touched.

## Domains

- `decisions/` — architecture and conflict resolutions.
- `domain/` — WMS terminology and business rules.
- `testing/` — test contracts, fixtures, and evidence formats.
- `failures/` — reproducible failures and root causes.
- `runbooks/` — operational procedures and recovery steps.

Paperclip remains the execution and coordination system. GitHub is the durable source of truth for the accumulated knowledge.
