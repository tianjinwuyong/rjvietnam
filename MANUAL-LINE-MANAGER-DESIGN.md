# Manual Line Manager PDA - Design Specification

Design owner brief: Wegener  
Task ID: `station_ui_owner`  
Scope: Manual Line Manager first; modules are shared with Auto and SMT managers.

## Product intent

This is a fast operational cockpit for a busy line manager. The first screen answers four questions without navigation:

1. What needs attention now?
2. Which subordinate or line activity is blocked?
3. What decision can I make, if MES authorizes me?
4. Are we on target for the current period?

MES remains the source of truth for plans, work orders, material tasks, timestamps, permissions, alarms, and audit history. The app never invents production data and never grants authority locally.

## Scope model

The signed-in manager receives an MES-issued scope:

```text
Manager identity → authorized line(s) → active work orders → team/subordinates → allowed decisions
```

The Manual Line manager sees Manual Line by default. Auto and SMT are separate scopes. A manager may view another line only when MES grants cross-line visibility. Privileged actions are hidden or disabled until MES returns an explicit permission and current authorization window.

## Screen hierarchy

```text
Login / identity verification
└─ Manual Line Cockpit (default)
   ├─ Alert queue
   │  └─ Alert detail → acknowledge / assign / escalate / request decision
   ├─ Decisions
   │  └─ Decision detail → approve / reject / request more information
   ├─ Team communication
   │  ├─ Broadcast / targeted message
   │  └─ Message detail → acknowledge / reply / escalate
   ├─ Targets
   │  ├─ Current shift/day
   │  └─ Week / month / quarter / year
   ├─ Line status
   │  ├─ Work-order timeline
   │  ├─ PDA/operator status
   │  └─ Loading and time compliance
   └─ Profile / permissions / audit history / connection diagnostics
```

Persistent navigation: Cockpit, Alerts, Decisions, Team, Targets. A back action always returns to the previous screen; a Home action returns to Cockpit. The current line and connection state remain visible in the top bar.

## Cockpit layout

```text
┌──────────────────────────────────────┐
│ Manual Line    MES ●   10:42   [Scan] │
│ Manager: <name>   Shift: <MES value>  │
├──────────────────────────────────────┤
│ CRITICAL  2   OVERDUE  4   DECISIONS 3│  ← tappable counters
├──────────────────────────────────────┤
│ NOW                                   │
│ [red] Overdue loading · WO / station  │
│       18 min late          [Open]     │
│ [amber] Operator blocked · station    │
│        reason from MES     [Open]     │
├──────────────────────────────────────┤
│ TEAM                                  │
│ 8 online   1 needs acknowledgement    │
│ [View team]              [Message]     │
├──────────────────────────────────────┤
│ TARGET                                │
│ Today 72%   gap: MES-provided value   │
│ [View targets]                        │
├──────────────────────────────────────┤
│ [Cockpit] [Alerts] [Decisions] [Team] │
│ [Targets]                             │
└──────────────────────────────────────┘
```

The cockpit is deliberately short: maximum five alert rows, one target summary, and one team summary. The manager can triage from the first tap. No decorative charts appear above unresolved critical work.

## Priority rules

MES supplies severity, due time, status, and escalation policy. The client sorts as follows:

1. Critical safety/quality/production-stop alarms
2. Overdue loading or missed planned start
3. Blocked operator, missing heartbeat, or line/PDA offline state
4. Pending manager decisions nearing expiry
5. Target gap and forecast risk
6. Informational communication

Within a category, use earliest MES due time, then oldest creation time. Never change severity locally. Acknowledging an alert changes only the manager’s acknowledgement state; it does not close the MES issue.

## Alert queue and overdue loading

Each row shows severity color and text label, line, work order, station/material when available, delay or age, and current owner.

```text
ALERT DETAIL
<severity> <MES title>
Manual Line · WO <id> · station <id>
Planned <time>  Actual <time>  Delay <duration>
MES reason/status: <value>

[Acknowledge] [Assign] [Escalate]
[Request manager decision]  [Open WO]
```

Actions are server-confirmed. For a late loading event, the manager can acknowledge, assign a subordinate, send a message, escalate to PMC/production management, or request an MES-authorized exception. The app must not silently approve late work.

## Decisions module

Decision cards show requester, line, work order, material/task, requested action, reason, created time, expiry, and required permission.

Initial shared decision types:

- Early/late material-loading exception
- Temporary material substitution or correction request
- Stop/resume line request
- Changeover confirmation
- Offline continuation decision
- Rework/repair routing request

```text
DECISION DETAIL
Requested action: <MES value>
Requested by: <operator/subordinate>
Scope: Manual Line · WO · material/task
Reason: <required text>
Valid until: <MES expiry>
Permission: <authorized / not authorized / expired>

[Approve] [Reject] [Ask for information]
Comment: [required for reject and override]
```

Approval is enabled only when MES confirms identity, role, line scope, work-order scope, current time window, and authorization expiry. The confirmation dialog repeats the exact scope and expiry, then requires deliberate confirmation. If authorization is missing, show “MES authorization required” and provide “Request authorization,” not a local bypass.

## Team communication

Communication is operational, not a social feed. The manager can send a message to all Manual Line members, a subordinate, or a station/team group selected from MES.

```text
TEAM
Online 8   Offline 1   Unacknowledged 2
<person> <role> <station> <status> [message]

MESSAGE
Audience: <MES team/group>
Priority: Normal / Urgent
Message: <large input>
Requires acknowledgement: [on/off]
[Send through MES]
```

Urgent messages require acknowledgement. Show sent, delivered, acknowledged, expired, and failed states. A failed send remains visible with retry; it is never reported as delivered. Replies and escalations retain sender, recipient, timestamps, and work-order context.

## Targets module

MES provides target, actual, forecast, and gap for daily, weekly, monthly, quarterly, and yearly periods. The default is the current shift/day.

```text
TARGETS  [Day] [Week] [Month] [Quarter] [Year]
Output       actual / target   gap   trend
Quality      actual / target   gap   trend
On-time      actual / target   gap   trend
Downtime     actual / limit    gap   trend
Material     ready / required  gap   trend

Risk: <MES forecast statement>
[View contributors] [Assign recovery action]
```

The manager can assign a recovery action to a subordinate, set a due time, and request acknowledgement. Target values and achievement are read-only unless MES explicitly provides an authorized correction workflow.

## Line, PDA, and operator status

Status uses clear text plus color/icon, never color alone:

- Running, waiting, blocked, stopped, offline, unknown
- Operator authenticated / unauthenticated / expired
- PDA online / warning / dead based on MES heartbeat
- Material task planned / open / loading / passed / blocked / overdue

```text
LINE STATUS
Work order <id>   product <MES value>   planned window <MES value>
Timeline: planned → opened → started → loading → verified
Stations: <station> <state> <operator> <last heartbeat>
Materials: planned <n>  passed <n>  blocked <n>  overdue <n>
```

SPI, scanner, PDA, and station evidence are displayed only as MES-received status. The manager app does not directly write SPI or production results.

## Action flows

### Late loading correction

```text
MES detects lateness
→ MES creates alert and decision request
→ PDA shows blocked/overdue state to operator
→ Manager opens alert
→ Manager acknowledges or requests information
→ MES checks manager permission and scope
→ Manager approves/rejects with reason, if authorized
→ MES records decision and expiry
→ PDA refreshes and continues or remains blocked
→ MES closes/escalates according to result
```

### Team escalation

```text
Alert → assign owner → acknowledgement timer
→ no acknowledgement → escalate to manager
→ unresolved → escalate to PMC/production manager
→ MES retains complete timeline
```

### Start-of-shift triage

```text
Login → MES scope/shift check → Cockpit
→ review critical and overdue queue
→ confirm team availability
→ review today target gap
→ send priorities → acknowledgement tracking
```

## States and failure behavior

- Loading: show skeletons and last successful MES timestamp.
- Live: show MES-connected indicator and refresh timestamp.
- Warning: show stale-data banner with age; disable privileged actions.
- Offline: read-only cached context only; no approvals, corrections, stop/resume, or production writes.
- Unauthorized: show required permission and scope; do not expose a working bypass.
- Expired: immediately disable action and preserve the request for reauthorization.
- Conflict: if MES state changed after opening, require refresh and reconfirmation.
- Server rejection: show MES reason, preserve entered comment locally as unsent draft, and offer retry.

Every decision and communication screen must display the target line, work order, user, server time, and audit/result status.

## Shared component model

Build reusable components with a line-domain parameter rather than Manual-specific copies:

- `ManagerShell(lineDomain)`
- `MesStatusBar`
- `PriorityCounter`
- `AlertCard` / `AlertDetail`
- `DecisionCard` / `AuthorizationDialog`
- `TeamRoster` / `AcknowledgementChip`
- `TargetPeriodTabs` / `TargetGapCard`
- `LineStatusBoard`
- `EscalationComposer`
- `AuditTimeline`

`lineDomain` values are `MANUAL`, `AUTO`, and `SMT`. Labels, work-order data, stations, teams, and permissions come from MES.

## Localization and accessibility

- Provide English, Simplified Chinese, and Vietnamese for every label, alarm, action, validation message, and empty/error state.
- Keep factory terms consistent: line, work order, material, loading, acknowledgement, escalation, authorization, expiry.
- Use 48dp minimum touch targets, large primary actions, high-contrast status colors, and text labels/icons together.
- Do not rely on red/green alone; include “Critical,” “Warning,” “Blocked,” and “Online” text.
- Support large text without clipping; critical action buttons remain reachable one-handed.
- Require confirmation for approve, reject, stop, resume, correction, and escalation actions.
- Show server time and timezone; do not use device time for authorization decisions.
- Preserve accessibility focus after refresh and announce new critical alerts.

## Non-negotiable authority boundaries

- No invented targets, alerts, operators, permissions, or production results.
- No local-only manager account or hardcoded production password.
- No approval without MES authorization, line/work-order scope, reason, and expiry.
- No offline privileged action.
- All changes, acknowledgements, messages, decisions, and failures are auditable in MES.

This specification is the shared design baseline for the Manual Line Manager APK and the later Auto Line and SMT Line manager variants.
