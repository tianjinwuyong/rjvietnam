// ── Response helpers ────────────────────────────────────────────────

export function envelope(data, meta = {}) {
  return { data, meta: { serverTime: new Date().toISOString(), ...meta } };
}

// Success envelope matching WMS reference format: { code: 0, message: 'success', data }
export function successEnvelope(data) {
  return { code: 0, message: "success", data };
}

export function listEnvelope(items, total) {
  return envelope({ items, total: total ?? items.length });
}

export function mutateEnvelope(item, auditEventId) {
  return envelope({ item, auditEventId });
}

export function errorEnvelope(code, message, details) {
  // Reference WMS-20261019 returns { code, message } on errors. Keep the SMT
  // { error: { code, message } } shape for existing clients while exposing the
  // reference fields at the top level so grafted routes are wire-compatible.
  return { error: { code, message, details }, code: 1, message };
}
