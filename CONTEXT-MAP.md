# Context Map

## Contexts

- [Factory Order Fulfilment](./CONTEXT.md) — governs customer demand through production, delivery, settlement, and closure.
- [MES Production Execution](./apps/web/src/mes/CONTEXT.md) — governs released work orders, station execution, product state, exceptions, repair, binding, and manufacturing traceability.

## Relationships

- **PMC → MES**: PMC releases an authorized Work Order and route assignment; MES owns execution after release.
- **WMS → MES**: WMS releases and issues physical material; MES consumes the release and records production use without owning inventory balances.
- **MES → QMS**: MES reports inspection and defect facts; QMS owns quality standards and disposition authority.
- **MES → WMS**: MES reports material consumption, return demand, and finished-goods completion; WMS executes physical movements.
- **MES → Traceability and Reports**: MES emits immutable product and execution facts; read models project them for search, dashboards, and 3D views.

