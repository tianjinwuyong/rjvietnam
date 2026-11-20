# Line Manager PDA Skill

## Scope

This skill defines the shared Android phone application used by the three line managers:

| Manager | MES line scope |
|---|---|
| Manual Line Manager | Manual Line |
| Auto Line Manager | Auto Line |
| SMT Line Manager | SMT Line |

The same application components are reused for all three managers. MES assigns the identity and line scope. The PDA must not allow local switching to another line.

## Shared Components

- authenticated manager login and line-scoped permissions;
- live line, station, operator, and PDA heartbeat status;
- communication with operators and subordinate leaders, including delivery and acknowledgement;
- daily, weekly, monthly, quarterly, and yearly team targets;
- actual achievement, target gap, trend, blocker, owner, and escalation tracking;
- floor decisions such as early/late material approval, stop/resume, changeover, offline-event decisions, and rework routing;
- audit records containing manager, line, work order, material, reason, time, decision, and expiry.

## Time Management and Alerts

MES controls the time window for every loading task and records planned start, actual start, progress, completion, delay, and closure. The PDA stays locked before the scheduled start and after the allowed completion window. Early or late work requires a time-limited, line-scoped manager exception from MES.

MES alerts the responsible line manager for early scans, late scans, missed starts, overdue loading, excessive idle time, missing heartbeat, delayed reporting, incomplete loading, or any correction and bypass. Alerts include the line, work order, material, operator, event time, and reason. The default response is block and alert; a manager correction must be authenticated and audited.

## Authority and MES Rules

The manager PDA is an MES client, not an independent authority. MES must validate the manager role, assigned line, active production plan, decision scope, and expiry before enabling a privileged action. Offline privileged actions are blocked.

Team achievement must use MES production, quality, material-readiness, downtime, and schedule data rather than unverified local claims. All communication, target updates, decisions, and acknowledgements must be traceable to the authenticated user and line.

## Busy Manager Operating Model

The manager home screen is a triage cockpit, not a menu of every factory function. It must answer immediately: what is stopped or at risk, who needs the manager, and what decision is waiting.

Priority order:

1. critical blocked or overdue events;
2. manager approvals expiring soon;
3. missing operators, offline PDAs, and unacknowledged escalations;
4. target gaps and schedule risk;
5. normal team communication and history.

Each item is an actionable card with line, work order, material or station, owner, age, impact, and one primary action. Detailed history opens only when requested. The manager should be able to acknowledge, assign, escalate, or approve from the item without navigating through unrelated modules.

The Manual, Auto, and SMT versions share this information architecture. Only the MES-assigned line scope, stations, targets, alerts, and decision permissions vary.
