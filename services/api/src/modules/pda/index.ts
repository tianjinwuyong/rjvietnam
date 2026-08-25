import type { FactoryModule } from "../_shared/module";

/**
 * PDA Device Management — unified asset lifecycle for all handheld PDA devices.
 *
 * Seven resource groups (38 routes):
 *   1. Devices        — PDA device master CRUD
 *   2. Assignments    — receive / assign / return / transfer / loss / damage
 *   3. Repairs        — fault reporting and repair workflow
 *   4. Software       — APK version tracking and OTA management
 *   5. Managed Apps   — mobile/station app registry (工厂应用管理)
 *   6. Audit          — operation audit log
 *   7. Dashboard      — aggregated statistics and status views
 */
export const pdaModule: FactoryModule = {
  key: "pda",
  name: "PDA Device Management",
  owns: [
    "PDA device master records",
    "device assignment and transfer history",
    "repair and maintenance records",
    "software version tracking",
    "operation audit log",
    "PDA heartbeat and online status",
    "managed app registry and lifecycle",
  ],
  routes: [
    // ── Devices ───────────────────────────────────────────────────
    {
      method: "GET",
      path: "/pda/devices",
      summary: "List PDA devices with status/location/line filters",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "GET",
      path: "/pda/devices/stats/summary",
      summary: "Aggregated PDA fleet statistics (by status, line, model)",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "GET",
      path: "/pda/devices/{id}",
      summary: "Single PDA device detail with full lifecycle",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "POST",
      path: "/pda/devices",
      summary: "Register a new PDA device (receiving from procurement)",
      requiredPermissions: ["pda.manage"],
    },
    {
      method: "PATCH",
      path: "/pda/devices/{id}",
      summary: "Update PDA device info (status, location, version, notes)",
      requiredPermissions: ["pda.manage"],
    },
    {
      method: "PATCH",
      path: "/pda/devices/{id}/status",
      summary: "Transition device status with reason",
      requiredPermissions: ["pda.manage"],
    },
    {
      method: "DELETE",
      path: "/pda/devices/{id}",
      summary: "Soft-delete / retire a PDA device",
      requiredPermissions: ["pda.manage"],
    },
    {
      method: "POST",
      path: "/pda/devices/bulk",
      summary: "Bulk register PDA devices (batch import)",
      requiredPermissions: ["pda.manage"],
    },

    // ── Assignments ───────────────────────────────────────────────
    {
      method: "GET",
      path: "/pda/assignments",
      summary: "List assignment/transfer history with filters",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "GET",
      path: "/pda/assignments/{id}",
      summary: "Single assignment record detail",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "POST",
      path: "/pda/assignments",
      summary: "Create assignment (RECEIVE / ASSIGN / RETURN / TRANSFER / LOSS / DAMAGE)",
      requiredPermissions: ["pda.manage"],
    },
    {
      method: "GET",
      path: "/pda/assignments/device/{deviceId}",
      summary: "Full assignment history for one device",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "GET",
      path: "/pda/assignments/current/{badge}",
      summary: "List devices currently assigned to a person",
      requiredPermissions: ["pda.view"],
    },

    // ── Repairs ───────────────────────────────────────────────────
    {
      method: "GET",
      path: "/pda/repairs",
      summary: "List repair records with status/device/date filters",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "GET",
      path: "/pda/repairs/stats/summary",
      summary: "Repair statistics (by category, severity, status)",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "GET",
      path: "/pda/repairs/{id}",
      summary: "Single repair record detail",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "POST",
      path: "/pda/repairs",
      summary: "Report a PDA device issue (create repair ticket)",
      requiredPermissions: ["pda.repair"],
    },
    {
      method: "PATCH",
      path: "/pda/repairs/{id}",
      summary: "Update repair record (diagnosis, action, status, cost)",
      requiredPermissions: ["pda.repair"],
    },
    {
      method: "POST",
      path: "/pda/repairs/{id}/verify",
      summary: "Verify completed repair (QA close)",
      requiredPermissions: ["pda.repair"],
    },

    // ── Software Versions ──────────────────────────────────────────
    {
      method: "GET",
      path: "/pda/software",
      summary: "List software version records filtered by device or version",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "POST",
      path: "/pda/software",
      summary: "Log a software update for a device",
      requiredPermissions: ["pda.manage"],
    },
    {
      method: "GET",
      path: "/pda/software/latest",
      summary: "Get latest available APK version info",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "POST",
      path: "/pda/software/register-apk",
      summary: "Register a new APK release for OTA distribution",
      requiredPermissions: ["pda.manage"],
    },

    // ── Audit Log ─────────────────────────────────────────────────
    {
      method: "GET",
      path: "/pda/audit",
      summary: "Query operation audit log with multi-filter",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "GET",
      path: "/pda/audit/stats",
      summary: "Audit statistics (by type, operator, date)",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "POST",
      path: "/pda/audit",
      summary: "Append an audit event (called by PDA devices or API)",
      requiredPermissions: ["pda.execute"],
    },
    {
      method: "GET",
      path: "/pda/audit/export",
      summary: "Export audit log as CSV/JSON",
      requiredPermissions: ["pda.view"],
    },

    // ── Heartbeat / Online Status ──────────────────────────────────
    {
      method: "GET",
      path: "/pda/heartbeats",
      summary: "Get all PDA heartbeat statuses (online/offline/lastSeen)",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "POST",
      path: "/pda/heartbeats",
      summary: "Submit a heartbeat ping from a PDA device",
      public: true,
    },
    {
      method: "GET",
      path: "/pda/online",
      summary: "Get currently online PDA devices list",
      requiredPermissions: ["pda.view"],
    },

    // ── Managed Apps ───────────────────────────────────────────────
    {
      method: "GET",
      path: "/pda/managed-apps",
      summary: "List all managed mobile/station apps with type/line/status filters",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "GET",
      path: "/pda/managed-apps/{id}",
      summary: "Single managed app detail",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "POST",
      path: "/pda/managed-apps",
      summary: "Register a new mobile/station app in the registry",
      requiredPermissions: ["pda.manage"],
    },
    {
      method: "PATCH",
      path: "/pda/managed-apps/{id}",
      summary: "Update managed app info (version, status, lines, notes)",
      requiredPermissions: ["pda.manage"],
    },
    {
      method: "DELETE",
      path: "/pda/managed-apps/{id}",
      summary: "Remove a managed app from the registry",
      requiredPermissions: ["pda.manage"],
    },

    // ── Dashboard ──────────────────────────────────────────────────
    {
      method: "GET",
      path: "/pda/dashboard",
      summary: "PDA management dashboard aggregated data",
      requiredPermissions: ["pda.view"],
    },
    {
      method: "GET",
      path: "/pda/dashboard/activity-timeline",
      summary: "Recent PDA activity timeline for dashboard",
      requiredPermissions: ["pda.view"],
    },
  ],
};
