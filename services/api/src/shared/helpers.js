// ── Response helpers ────────────────────────────────────────────────

export function envelope(data, meta = {}) {
  return { data, meta: { serverTime: new Date().toISOString(), ...meta } };
}

export function listEnvelope(items, total) {
  return envelope({ items, total: total ?? items.length });
}

export function mutateEnvelope(item, auditEventId) {
  return envelope({ item, auditEventId });
}

export function errorEnvelope(code, message, details) {
  return { error: { code, message, details } };
}
