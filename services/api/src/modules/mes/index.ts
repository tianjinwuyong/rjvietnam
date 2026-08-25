import type { FactoryModule } from "../_shared/module";

/**
 * MES (Manufacturing Execution System) — production-line execution.
 *
 * Eight resource groups (24 routes):
 *   1. Lines            — physical production lines
 *   2. Stations         — physical stations on each line
 *   3. Process routes   — per-product multi-step flow definitions
 *   4. Runs             — per-line work-order execution sessions
 *   5. Feeder bindings  — reel/feeder-to-machine assignments
 *   6. PCB serials      — every scanned PCB's identity
 *   7. Station events   — scan-in, output, defect, downtime
 *   8. Downtime         — line-level stop/start lifecycle
 *
 * Output rules per step (from process_route_steps.output_rule):
 *   pass_through            — continue to next step
 *   route_fail_to_repair    — failed unit goes to repair
 *   close_work_order        — step is terminal (e.g. OQC pass closes WO)
 */
export const mesModule: FactoryModule = {
  key: "mes",
  name: "SMT production execution",
  owns: [
    "production lines",
    "stations and station events",
    "process routes and route steps",
    "work-order runs and OEE",
    "feeder/reel bindings",
    "PCB serial lifecycle",
    "downtime and stop reasons",
  ],
  routes: [
    // ── Lines ─────────────────────────────────────────────────────
    {
      method: "GET",
      path: "/mes/lines",
      summary: "List production lines and their current run state",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "GET",
      path: "/mes/lines/{lineCode}",
      summary: "Get a production line plus its current run, OEE, and recent events",
      requiredPermissions: ["mes.view"],
    },

    // ── Stations ──────────────────────────────────────────────────
    {
      method: "GET",
      path: "/mes/stations",
      summary: "List stations filtered by line or station type",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "GET",
      path: "/mes/stations/{code}",
      summary: "Get a single station with its 20 most recent events",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "GET",
      path: "/mes/station-query",
      summary: "Unified read-only query for NG, history, station status, and WIP used by Web, PDA, and Agents",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "PATCH",
      path: "/mes/stations/{code}/ip",
      summary: "Update a station's registered IP address (called by station on startup)",
      public: true,
    },

    // ── Process routes ────────────────────────────────────────────
    {
      method: "GET",
      path: "/mes/process-routes",
      summary: "List active process routes, optionally filtered by product code",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "GET",
      path: "/mes/process-routes/{id}",
      summary: "Get a process route with its full ordered step list",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "GET",
      path: "/mes/process-routes/{id}/steps",
      summary: "List the steps of a process route in order",
      requiredPermissions: ["mes.view"],
    },

    // ── Runs (work-order execution sessions) ───────────────────────
    {
      method: "GET",
      path: "/mes/runs",
      summary: "List work-order runs filtered by line, work order, or status",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "POST",
      path: "/mes/runs",
      summary: "Start or stop a run for a work order",
      requiredPermissions: ["mes.execute"],
    },
    {
      method: "GET",
      path: "/mes/runs/{id}",
      summary: "Get a run with its current OEE, downtime, and station progress",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "POST",
      path: "/mes/runs/{id}/close",
      summary: "Close a run and mark the work order as closed",
      requiredPermissions: ["mes.execute"],
    },

    // ── Feeder bindings ───────────────────────────────────────────
    {
      method: "GET",
      path: "/mes/feeder-bindings",
      summary: "List feeder bindings filtered by work order, line, or machine",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "POST",
      path: "/mes/feeder-bindings",
      summary: "Bind a material lot to a feeder slot on a machine",
      requiredPermissions: ["mes.execute"],
    },
    {
      method: "PATCH",
      path: "/mes/feeder-bindings/{id}",
      summary: "Update a feeder binding (e.g. release/unbind)",
      requiredPermissions: ["mes.execute"],
    },
    {
      method: "DELETE",
      path: "/mes/feeder-bindings/{id}",
      summary: "Remove a feeder binding and return the slot to unbound state",
      requiredPermissions: ["mes.execute"],
    },

    // ── PCB serials ───────────────────────────────────────────────
    {
      method: "GET",
      path: "/mes/pcb-serials",
      summary: "List PCB serials filtered by work order, line, or status",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "POST",
      path: "/mes/pcb-serials",
      summary: "Register a new PCB serial against a work order",
      requiredPermissions: ["mes.execute"],
    },
    {
      method: "GET",
      path: "/mes/pcb-serials/{serialNo}",
      summary: "Get a PCB serial with its full station-event history",
      requiredPermissions: ["mes.view"],
    },

    // ── Station events ────────────────────────────────────────────
    {
      method: "GET",
      path: "/mes/events",
      summary: "List station events filtered by type, line, work order, or PCB serial",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "POST",
      path: "/mes/events",
      summary: "Append a station event (scan-in, scan-out, output, defect)",
      requiredPermissions: ["mes.execute"],
    },

    // ── Downtime ──────────────────────────────────────────────────
    {
      method: "GET",
      path: "/mes/downtimes",
      summary: "List downtime events filtered by line, status, or date range",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "POST",
      path: "/mes/downtimes",
      summary: "Open a new downtime event for a line",
      requiredPermissions: ["mes.execute"],
    },
    {
      method: "PATCH",
      path: "/mes/downtimes/{id}",
      summary: "Close an open downtime event with action taken and operator",
      requiredPermissions: ["mes.execute"],
    },

    // ── Cross-cutting: PCB trace ──────────────────────────────────
    {
      method: "GET",
      path: "/mes/trace/{serialNo}",
      summary: "Return the end-to-end trace for a PCB serial: events + material bindings",
      requiredPermissions: ["mes.view"],
    },

    // ── Stagnation Tracking ───────────────────────────────────────
    {
      method: "GET",
      path: "/mes/stagnation",
      summary: "List product stagnation logs with filters (mirrors Excel 产品呆滞管控 filter bar)",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "GET",
      path: "/mes/stagnation/check",
      summary: "Re-calculate dwell time from station_flow_records and sync product_stagnation_logs",
      requiredPermissions: ["mes.execute"],
    },
    {
      method: "GET",
      path: "/mes/stagnation/thresholds",
      summary: "Get stagnation thresholds per station",
      requiredPermissions: ["mes.view"],
    },
    {
      method: "POST",
      path: "/mes/stagnation/thresholds",
      summary: "Upsert a stagnation threshold entry",
      requiredPermissions: ["mes.execute"],
    },
    {
      method: "PATCH",
      path: "/mes/stagnation/{id}/resolve",
      summary: "Mark a stagnation log as resolved",
      requiredPermissions: ["mes.execute"],
    },
  ],
};
