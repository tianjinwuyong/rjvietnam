# Line Manager PDA — Site Map and MES Interface Contract

Version: 0.1 · Scope: Manual Line first, shared with Auto Line and SMT Line

## Product rule

The Line Manager PDA is an MES client. MES owns production plans, work orders, line scope, roles, material status, alarms, approvals, targets, messages, and audit history. The PDA presents the next action and sends requests; it never grants authority locally and never writes simulated production data.

## Site map

```text
Line Manager PDA
├── Identity
│   ├── Language: 中文 / English / Tiếng Việt
│   ├── MES login
│   ├── MuMu test quick login (debug build only)
│   └── Session / line scope / permission expiry
├── Home: Cockpit
│   ├── Current manager, line, shift, MES connection
│   ├── Critical and overdue counters
│   ├── Now: top five actions requiring attention
│   ├── Production progress and forecast
│   ├── Material readiness: PCB / solder paste / plugin components / SMT
│   ├── Team and PDA health
│   └── Today target and gap
├── Alerts
│   ├── All alerts
│   ├── Critical / overdue / blocked / offline / target risk
│   ├── Alert detail
│   │   ├── Acknowledge
│   │   ├── Assign owner
│   │   ├── Message team
│   │   ├── Escalate
│   │   └── Request manager decision
│   └── Alert timeline and audit
├── Line status
│   ├── Current work order timeline
│   ├── Planned start / actual start / loading / verification
│   ├── Station and equipment state
│   ├── Operator authentication and station heartbeat
│   ├── PCB loading status
│   ├── Solder paste batch / expiry / temperature status
│   ├── Plugin component status: resistor / capacitor / inductor
│   └── SMT feeder / SPI evidence received by MES
├── Decisions
│   ├── Pending requests
│   ├── Early / late material loading
│   ├── Material substitution or correction
│   ├── Stop / resume
│   ├── Changeover
│   ├── Offline continuation
│   ├── Rework / repair routing
│   └── Decision detail: approve / reject / ask for information
├── Team
│   ├── Team roster and line assignment
│   ├── Online / offline / blocked / unacknowledged
│   ├── Broadcast message
│   ├── Targeted message
│   ├── Message detail and acknowledgement
│   └── Escalation history
├── Targets
│   ├── Current shift / day
│   ├── Week
│   ├── Month
│   ├── Quarter
│   ├── Year
│   ├── Output / quality / on-time / downtime / material readiness
│   └── Recovery action and acknowledgement
├── Handover
│   ├── Open issues
│   ├── Incomplete work orders
│   ├── Unloaded / blocked material
│   ├── Equipment and quality follow-up
│   ├── Next-shift priorities
│   └── Confirm handover through MES
└── Profile and diagnostics
    ├── Manager identity and roles
    ├── Authorized lines and expiry
    ├── Audit history
    ├── Connection / stale-data status
    └── Logout
```

## Navigation rules

- Default landing page is `Cockpit`.
- Persistent bottom navigation: `Cockpit`, `Alerts`, `Decisions`, `Team`, `Targets`.
- `Back` returns to the previous page; `Home` returns to `Cockpit`.
- Current line, manager identity, language, and MES connection state remain visible.
- A manager only sees lines returned in the MES scope. Default Manual Line code is `L004`; Auto and SMT use their MES-issued line codes.
- Critical alerts and overdue loading open from the cockpit in one tap.
- Privileged actions are disabled when the MES session is expired, stale, offline, out of scope, or missing a permission.

## API ownership and status

`Existing` means the endpoint is already present in the current codebase and must be verified against the production MES contract. `Required` means the management system must expose it before the PDA can claim the feature is live.

| Module | Method and path | Status | Purpose |
|---|---|---|---|
| Identity | `POST /auth/login` | Existing | Authenticate manager and return token, user, role, line scope, shift, locale. |
| Identity | `GET /auth/session` | Existing | Restore session and current MES permissions. |
| Scope | `GET /mes/lines/{lineCode}` | Existing | Line metadata, state, current work order and assigned manager scope. |
| Heartbeat | `GET /api/pda/heartbeats` | Existing | PDA/station online state and last heartbeat. Filter by MES line scope. |
| Events | `GET /api/pda/events` | Existing | Live station, quality, stop, and alarm events. Must support line-scoped filtering. |
| Events | `GET /api/pda/events/history` | Existing | Auditable event history for alert detail. |
| Work orders | `GET /api/smt/loading/work-orders?lineCode={code}` | Existing | Scheduled loading work orders. Must return planned start/finish and status. |
| Loading | `GET /api/pda/loading-status?woCode={code}` | Existing | Material task progress and loading state. |
| Loading | `GET /api/smt/loading/offline-violations?status=OPEN` | Existing | Current offline loading violations; must be line-scoped before use by Manager PDA. |
| Manager alerts | `GET /api/manager/alerts?lineCode={code}&status=open` | Required | One authoritative alert feed for critical, overdue, blocked, offline, and target-risk items. |
| Alert action | `POST /api/manager/alerts/{alertId}/acknowledge` | Required | Record manager acknowledgement in MES. |
| Alert action | `POST /api/manager/alerts/{alertId}/assign` | Required | Assign owner/subordinate with due time. |
| Alert action | `POST /api/manager/alerts/{alertId}/escalate` | Required | Escalate to PMC, production manager, engineering, or quality. |
| Decisions | `GET /api/manager/decisions?lineCode={code}&status=pending` | Required | Pending manager decision requests. |
| Decisions | `GET /api/manager/decisions/{decisionId}` | Required | Scope, reason, requester, expiry, and required permission. |
| Decisions | `POST /api/manager/decisions/{decisionId}/approve` | Required | MES permission-checked approval with required comment and idempotency key. |
| Decisions | `POST /api/manager/decisions/{decisionId}/reject` | Required | Reject with mandatory reason. |
| Decisions | `POST /api/manager/decisions/{decisionId}/information` | Required | Ask requester for more information. |
| Team | `GET /api/manager/team?lineCode={code}` | Required | Team roster, station, role, operator status and acknowledgement counts. |
| Team / HR | `GET /hr/employees?status=active&limit=100` | Existing | HR-authoritative employee identity, employee code, multilingual name, department, position, manager and employment status. The manager API must scope the result to the MES-authorized team before exposing it to the PDA. |
| Team | `POST /api/manager/messages` | Required | Send normal/urgent message through MES. |
| Team | `GET /api/manager/messages?lineCode={code}` | Required | Sent, delivered, acknowledged, expired and failed messages. |
| Team | `POST /api/manager/messages/{messageId}/acknowledge` | Required | Record recipient acknowledgement. |
| Targets | `GET /api/manager/targets?lineCode={code}&period={shift|day|week|month|quarter|year}` | Required | Target, actual, forecast, gap, trend, and contributors. |
| Recovery | `POST /api/manager/recovery-actions` | Required | Assign recovery action tied to target gap and owner. |
| Handover | `GET /api/manager/handover?lineCode={code}&shift=current` | Required | Open issues, incomplete work, material, equipment, and quality follow-up. |
| Handover | `POST /api/manager/handover/confirm` | Required | Confirm handover with receiver, time, and unresolved items. |
| Audit | `GET /api/manager/audit?lineCode={code}&limit={n}` | Required | Manager views actions, decisions, messages, and authorization results. |

## Required response envelope

Every management endpoint should use the existing MES envelope style:

```json
{
  "data": {},
  "error": null,
  "meta": {
    "serverTime": "2026-08-04T10:42:00Z",
    "requestId": "req-123",
    "staleAfterSeconds": 30
  }
}
```

Error responses must include a stable code such as `UNAUTHORIZED_SCOPE`, `AUTHORIZATION_EXPIRED`, `STALE_VERSION`, `CONFLICT`, `OFFLINE`, or `MES_VALIDATION_FAILED`.

## Authorization contract for every write

The PDA sends the manager's MES token, `lineCode`, `workOrderCode` when applicable, client request ID, and current screen version. MES rechecks:

1. manager identity;
2. role and decision permission;
3. authorized line scope;
4. work-order/material scope;
5. current planned time window;
6. authorization expiry;
7. current MES version to prevent stale approvals.

The PDA only shows success after MES commits the action and returns the audit ID. A timeout is `unknown`, not success. Offline mode is read-only for manager decisions and production-impacting actions.

## Real-time and refresh model

- Use server-sent events or WebSocket for alerts, decisions, team messages, heartbeats, and loading status when available.
- Keep a polling fallback every 10 seconds while the app is visible.
- Show last successful MES update and stale age on every live page.
- Re-fetch before every approval, stop/resume, correction, or handover confirmation.
- Duplicate actions use an idempotency key and render the original MES result.

## Daily line-manager flow represented by the map

```text
Login and scope check
  → review cockpit
  → confirm people / equipment / material readiness
  → monitor planned loading and production progress
  → acknowledge, assign, escalate or request decision
  → review targets and recovery actions
  → perform changeover checks
  → confirm handover through MES
```

## Closure checklist

- [x] Three-language navigation and manager login labels defined.
- [x] Manual Line first; Auto and SMT are scope variants, not separate duplicated workflows.
- [x] PCB, solder paste, plugin components, and SMT material status included.
- [x] Every privileged action has a MES authorization and audit requirement.
- [x] Offline and stale-data behavior defined.
- [ ] Management system implements the `Required` endpoints.
- [ ] Existing loading violation endpoint is line-scoped for Manual Line before manager use.
- [ ] MES and PDA integration tests cover early/late loading, expired authority, duplicate approval, offline, and stale conflict.
- [ ] MuMu smoke test covers all three languages and quick-login debug build.

## Ownership

- MES/API team: required endpoints, permissions, server time, audit, event delivery, and line scoping.
- HR/API team: employee identity, department, position, reporting manager, employment status, and the authorized line-team mapping. Do not expose ID-card, salary, address, or other sensitive HR fields to the line-manager PDA.
- PDA team: navigation, localization, state rendering, retry/idempotency handling, and no-local-authority enforcement.
- PMC/production management: target definitions, escalation recipients, and decision policy.
- Quality/engineering: quality, repair, stop/resume, and rework decision rules.
