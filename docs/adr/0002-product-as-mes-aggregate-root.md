---
status: accepted
---

# Product is the MES execution aggregate root

MES models one physical Product as the execution aggregate root. Typed identifiers such as PCBA SN and Shell SN resolve the same Product; Product Attendance is a Product-owned lifecycle child, while versioned Binding Relationships and NG Cases remain independently auditable aggregates referenced by Product. This avoids duplicating route, NG, and binding authority across Station Agents while preventing one unbounded Product row from becoming a concurrency bottleneck.

Station Agents submit immutable facts and execute Product Gate decisions. They do not own route sequence, active NG, exception authorization, or binding policy. Final packaging removes Product Attendance from the active work queue but never deletes Product, attendance, NG, decision, or binding history.
