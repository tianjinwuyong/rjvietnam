# Unified PDA domain glossary

## Employee

The factory identity that owns a PDA session and every recorded action. An employee
always has the basic employee rights; operational roles add capabilities but do not
replace the employee identity.

## Basic employee rights

The minimum shared capabilities: view the PDA, view personal employee information,
view attendance, and submit leave requests.

## Role rights

Capabilities granted by the MES-issued role. Examples are material loading, NG pickup
acknowledgement, manager review, or plant approval. Role rights are additive to basic
employee rights and are never inferred from the screen being opened.

The role hierarchy is additive: `Employee` is the base; `Material Loader` and `Group
Leader` inherit it; `Line Manager` inherits both `Group Leader` and `Employee`; Plant
Manager inherits the line-manager capabilities and adds only its MES-issued site
approval scope.

## Line scope

The production line(s) an employee may operate or supervise, such as manual line
`L004`, auto line `L002`, or SMT line `L001`. A role without a valid line scope cannot
perform line-scoped actions.

## Approval scope

The MES-issued boundary for approvals. Being a group leader or line manager does not
by itself grant final release, scrap, replacement, or route-change authority.

## Virtual employee

A clearly labelled test identity available only in test builds for MuMu/local smoke
tests. It is not a real HR identity and cannot be used for production attendance,
payroll, MES authentication, or final approval.

## Permanent project convention

- "Unified PDA" always means the Kotlin Android project at `C:\Users\tianj\Desktop\越南工厂瑞晶\统一PDA管理\unifiedpda`.
- Build, install, and test it with PowerShell and `adb`.
- WMS generates dynamic IQC inspection tasks from PO/receiving data, supplier/material history, and ACTIVE Excel rules.
- Unified PDA reads the task-level inspection items, sample size, inspection level, evidence requirements, and performs scans, visual checks, photos, defect counts, and result sync back to WMS.
- Do not substitute the browser PDA page for the Unified PDA Android app.
