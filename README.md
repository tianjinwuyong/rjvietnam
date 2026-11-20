# Unified PDA Management

Shared Android PDA application for factory employees, line managers, plant managers,
material loaders, warehouse, MES, PMC, IQC, and engineering roles.

The application is domain-neutral. Manual Line, Auto Line, and SMT behavior is selected
by the MES-issued role and line scope; it is not a Manual Line-only application.

The full page hierarchy and management-system interface contract are documented in
[SITE-MAP-AND-MES-API.md](./SITE-MAP-AND-MES-API.md).

Modules include:

- employee and device identity, assigned-line dashboard, and live PDA/line status;
- manager-to-operator communication with acknowledgement;
- material preparation, loading, binding, and exception reporting;
- work orders, NG/rework, approvals, offline events, and audit history;
- MES, WMS, PMC, and IQC status views.

The PDA never grants authority locally. MES returns the role, line scope, approval scope,
and expiry before an approval action is enabled. Station agents remain unchanged; this
PDA is their shared operator and management surface.
