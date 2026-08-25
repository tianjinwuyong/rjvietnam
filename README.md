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
