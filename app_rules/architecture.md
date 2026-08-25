# Architecture Rules

- Own cross-cutting module boundaries and shared system structure.
- Keep `apps`, `services`, `packages`, `database`, `integrations`, `docs`, and `operations` aligned.
- Do not implement feature logic that belongs in a domain worker.
- Resolve conflicts between workers by narrowing contracts, not by duplicating behavior.
- Keep the integrated factory flow intact: ERP -> PMC -> WMS -> MES -> Quality -> Traceability -> Reports -> Admin.
