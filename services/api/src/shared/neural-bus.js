import { query } from "../db.js";

// ═════════════════════════════════════════════════════════════════════
// NEURAL COMM BUS — event routing between agent nodes
// Agent nodes: pda_loader | pmc_manager | wms_manager | mes_manager | ai_monitor | quality_manager
//
// Event schema:
//   { from, to, type, payload, priority? }
//   to="*" broadcasts to all
//   to="ai_monitor" routes only to AI
//   priority: "critical" | "warning" | "info"
// ═════════════════════════════════════════════════════════════════════

export const neuralBus = new Set(); // SSE connections

export function neuralBroadcast(event) {
  // Attach timestamp
  const enriched = { ...event, _ts: new Date().toISOString(), _id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
  const payload = `data: ${JSON.stringify(enriched)}\n\n`;
  // Defer all writes so neuralBroadcast itself never blocks the event loop
  setImmediate(() => {
    for (const sub of neuralBus) {
      try {
        sub.res.write(payload, () => {
          // Fired when this chunk is written (not blocking)
        });
      } catch {
        neuralBus.delete(sub);
      }
    }
  });
  // Don't block on DB writes — fire and forget
  if (event.priority === "critical" || event.type === "SCAN_ERROR") {
    query(
      "INSERT INTO pda_audit_logs (device_id, user_id, action, detail, meta) VALUES ($1,$2,$3,$4,$5)",
      [event.from ?? "system", event.to ?? "*", event.type, JSON.stringify(event.payload), JSON.stringify({ priority: event.priority })]
    ).catch(() => {});
  }
}
