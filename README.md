# SMT Factory Integrated Management System

This repository is the integrated factory platform for the Vietnam SMT site. The web console is dashboard-first and covers PMC, WMS, MES, quality, traceability, reports, and admin in one shell.

## Run

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5178
```

## Notes

- All UI text is i18n-backed for `zh-CN`, `vi-VN`, and `en-US`
- The current web app uses demo data for operational lists
- Auth, permissions, transaction persistence, and realtime feeds still need backend work

> Project convention: Unified PDA is the Kotlin Android app in `C:\Users\tianj\Desktop\越南工厂瑞晶\统一PDA管理\unifiedpda`, tested with PowerShell/ADB. WMS generates dynamic IQC tasks from PO, supplier history, and ACTIVE Excel; the PDA executes the task and syncs evidence/results back.

WMS organization, staffing, virtual employee responsibilities and authority boundaries are defined in [WMS_ORGANIZATION.md](./WMS_ORGANIZATION.md).

The whole-factory organization, module boundaries, virtual employee model and end-to-end operating loops are defined in [FACTORY_MANAGEMENT_SYSTEM.md](./FACTORY_MANAGEMENT_SYSTEM.md).
