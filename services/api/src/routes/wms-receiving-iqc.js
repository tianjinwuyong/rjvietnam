// WMS receiving and incoming IQC (/api/wms/incoming, /api/wms/iqc/*), moved out of
// services/api/server.js.
//
// 14 registrations: the receiving transaction (create, list, detail, amend) and the
// inspection that follows it -- the rule/sampling-plan lookups, inspection creation with
// its derived sample size, defect capture, completion with the disposition decision, and
// the special-approval chain for non-standard concessions.
//
// Pure registrations, no module-level statements in the block.
export function registerWmsReceivingIqcRoutes(app, deps) {
  const { } = deps;

  //__BODY__
}
