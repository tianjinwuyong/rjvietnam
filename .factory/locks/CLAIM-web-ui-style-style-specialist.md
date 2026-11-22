# CLAIM web-ui-style — style-specialist
Lane: web UI style unification (see local://style-brief.md). Active: 2026-11-22.

Files touched by this lane (all under apps/web/src unless noted):
- apps/web/src/styles.css (shared vocabulary: page-header, toolbar button pills, stat-tile, empty-state, data-table, chip, glyph, card-grid, employee-card, menu-tile, qms-shell/qms-tabs, report-filter-bar, error-note, ambassador cells; alias tokens --bg-2/--accent; fixed pre-existing unterminated .wms-low-stock-blink rule that killed all later CSS)
- apps/web/src/i18n.ts (+~360 trilingual keys; removed 68 zh-only plain-string legacy entries that shadowed proper entries and leaked raw keys in vi/en)
- apps/web/src/main.tsx (initialize react-i18next from the shared dictionary — root cause of qms.* raw-key leaks)
- apps/web/src/App.tsx (STYLE-LEVEL ONLY: main landmark + aria, dashboard empty state + translated line-status labels + testids, pmc/wms toolbar testids+titles, admin hardcoded toolbar strings → trilingual keys)
- apps/web/src/agents/AgentsModule.tsx (tab labels via t(), shared chrome, main/nav landmarks)
- apps/web/src/agents/VirtualEmployeeCenter.tsx (locale prop, stat-tiles, employee-card, badge tones, empty state, error-note, testids)
- apps/web/src/agents/AgentBusMonitor.tsx (palette-aligned status/priority/latency colors, data-table, empty-state, filter labels, testids)
- apps/web/src/manager-dashboard/AmbassadorDashboard.tsx (rewritten on shared vocabulary; emoji kept only as aria-hidden data glyphs in .glyph spans; STATUS_COLOR/STATUS_BG drift removed)
- apps/web/src/pmc/PmcDashboard.tsx (typed SupplySignal replacing any, translated supply-signal table, empty states, testids)
- apps/web/src/qms/QmsApp.tsx (light shell, toolbar tabs, testids, aiInspection label via t())
- apps/web/src/qms/QmsDashboard.tsx (dark island → stat-tiles + page-header + shared empty/error states)
- apps/web/src/reports/ReportsDashboard.tsx (toolbar nav vocabulary, translated sessions panel, empty-state, testids, no any casts in touched lines)
- apps/web/src/wms/WmsMenuPage.tsx (dark gradient island → surface-panel/menu-tile/flow vocabulary, trilingual loop, testids)
- .factory/locks/CLAIM-web-ui-style-style-specialist.md (this file)

Evidence: .tmp-design/shots-after/*.png (10 key pages + qms-*.png sub-tabs + managerDashboard.png, 2026-11-23, vite 5178, admin login).

Phase 2 (Main follow-up 2026-11-23) additionally touched:
- apps/web/src/qms/*.tsx (all 19 sub-tab files: dark slate palette -> shared light tokens; data-table/page-header/surface-panel/empty-state; landmarks + qms.* testids)
- apps/web/src/manager-dashboard/ManagerDashboard.tsx (STATUS_CONFIG emoji pills -> badge-ok/warning/danger; hpBadge emoji -> badges; priority/status hexes -> tokens)
- apps/web/src/App.tsx (tab-bar data-testid+title for hr/finance/procurement/einvoice/sales/service/maintenance/bom/quality/mes-nav/admin; nav structure untouched)

NOT touched: services/api/**, App.tsx nav structure (moduleGroups/FULL_MODULES/render map), API shapes, harness/**.
