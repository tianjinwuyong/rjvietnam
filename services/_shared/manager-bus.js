/**
 * manager-bus.js — Shared inter-manager communication helper
 *
 * Thin wrapper around agent-bus.js that provides per-manager:
 * - Lazy bus init + env-configured AGENT_ID
 * - Per-manager message handler dispatcher
 * - Typed send helpers for common cross-manager messages
 * - Automatic message polling integration
 *
 * Usage in each manager:
 *   import { initManagerBus, createManagerBus } from "../_shared/manager-bus.js";
 *
 *   const bus = createManagerBus({
 *     agentId: "hr-ai",
 *     log,
 *     handlers: { operator_absent, shift_change, ... },
 *   });
 *
 *   await bus.init();
 *   await bus.poll();   // call once per patrol cycle
 */

import {
  sendAgentMessage,
  pollAgentMessages,
  completeAgentMessage,
  failAgentMessage,
  initAgentBus,
  AGENT_ID,
  log as busLog,
} from "./agent-bus.js";

// ── Per-manager bus wrapper ──────────────────────────────────────────────────

/**
 * @param {object} cfg
 * @param {string} cfg.agentId        - 'wms-ai' | 'bom-ai' | 'hr-ai' | 'rda-ai'
 * @param {function} cfg.log          - logger function (level, msg) from host manager
 * @param {object} cfg.handlers       - { subject: async (payload) => void }
 * @param {string} [cfg.logPrefix]    - prefix for bus log lines
 * @returns {{ init, poll, send, broadcast, health }}
 */
export function createManagerBus({ agentId, log, handlers = {}, logPrefix = "" }) {
  let _init = false;

  async function init() {
    if (_init) return;
    _init = true;
    try {
      await initAgentBus();
      log("INFO", `${logPrefix}[BUS] ${agentId} initialised`);
    } catch (err) {
      log("WARN", `${logPrefix}[BUS] init failed: ${err.message} (non-fatal)`);
    }
  }

  /**
   * Poll pending messages and dispatch to handlers.
   * Call once per patrol cycle after your main work is done.
   */
  async function poll(limit = 20) {
    const messages = await pollAgentMessages(agentId, limit);
    if (messages.length === 0) return;

    log("INFO", `${logPrefix}[BUS] ${messages.length} message(s) from bus`);

    for (const msg of messages) {
      const handler = handlers[msg.subject];
      if (!handler) {
        log("WARN", `${logPrefix}[BUS] no handler for "${msg.subject}" from ${msg.source_agent}`);
        await completeAgentMessage(msg.message_id);
        continue;
      }

      try {
        const payload = typeof msg.payload === "string"
          ? JSON.parse(msg.payload)
          : (msg.payload || {});
        await handler(payload);
        await completeAgentMessage(msg.message_id);
        log("INFO", `${logPrefix}[BUS] handled ${msg.subject} from ${msg.source_agent}`);
      } catch (err) {
        log("ERR", `${logPrefix}[BUS] ${msg.subject} handler error: ${err.message}`);
        await failAgentMessage(msg.message_id, err.message);
      }
    }
  }

  /** Send a message to a specific agent */
  async function send(targetAgent, subject, body, opts = {}) {
    await init(); // ensure bus is up
    return sendAgentMessage(targetAgent, subject, body, opts);
  }

  /** Broadcast to all agents */
  async function broadcast(subject, body, opts = {}) {
    return sendAgentMessage("*", subject, body, { ...opts, messageType: "broadcast" });
  }

  /** Health check */
  async function health() {
    const { agentBusHealth } = await import("./agent-bus.js");
    return agentBusHealth();
  }

  return { init, poll, send, broadcast, health };
}

// ── Standardised cross-manager message subjects ──────────────────────────────
//
// Format: "subject" — direction — description
//
// INBOUND to WMS (wms-ai):
//   material_needed          MES→WMS   MES needs material for a line
//   line_finished            MES→WMS   Line finished WO, return unused materials
//   feeder_mismatch          MES→WMS   Material on feeder doesn't match BOM
//   scrap_at_line            MES→WMS   Scrap generated at line, update WMS inventory
//   request_issue            MES→WMS   MES requesting emergency issue
//   bom_updated              BOM→WMS   BOM changed, check affected stock
//   operator_absent          HR→WMS    Operator absent, might affect issue schedule
//   shift_change             HR→WMS    Shift changed, update staffing for issue
//
// INBOUND to BOM (bom-ai):
//   material_substitution_needed  MES→BOM  Feeder mismatch, need substitution BOM
//   component_failure_rate        MES→BOM  AOI detected high failure rate on component
//   bom_usage_feedback            MES→BOM  Actual vs BOM qty consumption feedback
//   iqc_released                  WMS→BOM  New material released, BOM may need update
//   material_issued               WMS→BOM  Material issued to line, verify BOM match
//
// INBOUND to HR (hr-ai):
//   line_understaffed             MES→HR   Line needs more operators
//   operator_performance          MES→HR   Operator yield/defect data for review
//   station_cert_gap              MES→HR   Operator missing required certification
//   training_needed               MES→HR   Defect trend suggests training gap
//   work_order_critical           WMS→HR   Critical WO may need OT/extra shifts
//   bom_updated                   BOM→HR   BOM change may require retraining
//
// INBOUND to RDA (rda-ai):
//   analysis_request              MES→RDA  Request deep analysis on data points
//   defect_pattern_query          MES→RDA  Query defect patterns for material/station
//   material_substituted          WMS→RDA  Material substitution for defect correlation
//   operator_performance          HR→RDA   Operator performance data for analysis
//
// INBOUND to MES (mes-ai):
//   material_issued               WMS→MES  Material issued to line
//   iqc_released                  WMS→MES  Lot passed IQC
//   iqc_hold                      WMS→MES  Lot on IQC hold
//   scrap_created                 WMS→MES  Scrap recorded in WMS
//   line_return                   WMS→MES  Material returned from line
//   low_stock_warning             WMS→MES  Stock below threshold
//   msd_alert                     WMS→MES  MSD exposure alert
//   bom_updated                   BOM→MES  BOM structure changed
//   alternative_available         BOM→MES  Alternative material available
//   bom_accuracy_alert            BOM→MES  BOM accuracy concern
//   operator_absent               HR→MES   Operator absent
//   shift_change                  HR→MES   Shift changed
//   certification_expiring        HR→MES   Certification expiring
//   new_operator_assigned         HR→MES   New operator on line
//   ot_limit_warning              HR→MES   OT limit approaching
//   report_ready                  RDA→MES  Analysis report ready
//   anomaly_detected              RDA→MES  Anomaly in data
//   trend_alert                   RDA→MES  Trend alert
//   data_request                  RDA→MES  Request more data
//
// BROADCAST (target='*'):
//   patrol_summary               Any→All   Periodic patrol digest
//   system_alert                 Any→All   Cross-domain critical issue
//   line_status_change           MES→All   Line started/stopped/paused
//
// INBOUND to AGV (agv-ai):
//   kit_delivery_request         MES→AGV   MES requests material kit delivery to line
//   task_cancel                  MES→AGV   MES cancels an assigned AGV task
//   station_block                MES→AGV   Block/unblock a zone for maintenance
//   return_request               WMS→AGV   WMS requests return of empty trolley
//
// OUTBOUND from AGV (agv-ai):
//   agv_task_completed          AGV→MES   AGV task finished successfully
//   agv_low_battery             AGV→MES   AGV battery below threshold
//   agv_stuck                   AGV→MES   AGV stuck or blocked — needs human
//   agv_incident               AGV→MES/HR Critical AGV incident (collision, offline)