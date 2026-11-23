# CLAIM web-ui-style — style-specialist
Lane: web UI style unification (see local://style-brief.md). Active: 2026-11-23 (tail pass).

Phase 1+2 (already landed): styles.css shared vocabulary; i18n.ts keys + legacy plain-string cleanup; main.tsx i18next init; App.tsx style-level chrome/testids; agents/*; manager-dashboard/{AmbassadorDashboard,ManagerDashboard}.tsx; pmc/PmcDashboard.tsx; qms/* (19 sub-tabs palette); reports/ReportsDashboard.tsx; wms/WmsMenuPage.tsx.

Phase 3 (this tail pass) files touched — all under apps/web/src:
- styles.css — added .btn-primary/.btn-ghost global rules (were only defined under .supplier-content), .action-button tone modifiers (-primary/-ok/-warning/-danger/-nav/-ghost, :disabled), .success-note
- finance/FinanceCostReport.tsx — dark palette -> tokens; root -> section landmark + finance.cost testids; tab bar -> .toolbar nav with per-tab testids
- maintenance/EmergencyManagement.tsx — tokens; section landmark + maintenance.emergency.* testids; page-header + toolbar tabs
- maintenance/EquipmentAndonBoard.tsx — tokens; section landmark (dead export, migrated for grep-clean)
- maintenance/EquipmentBom.tsx — tokens; section landmark + maintenance.bom.* testids; tree rows -> role=button + aria-label/title/onKeyDown
- maintenance/EquipmentHealth.tsx — tokens; section landmark + maintenance.health.* testids; stat-tiles; filter selects labelled
- maintenance/EquipmentMobilePda.tsx — tokens; section landmark (dead export)
- maintenance/EquipmentReports.tsx — tokens; section landmark + maintenance.reports.* testids; empty-state
- maintenance/ExcelImport.tsx — tokens; section landmark + maintenance.import.* testids; nav tabs
- maintenance/IsolatedFactory3D.tsx — chrome tokens (three.js 0x scene bg kept); section landmark + maintenance.factory3d.* testids
- maintenance/MaintenanceCard.tsx — tokens; section landmark + maintenance.card.* testids; tablist semantics
- maintenance/PdaEquipment.tsx — tokens; section landmark + maintenance.pda.* testids; div-tabs -> button role=tab
- hr/HrProfileUpdates.tsx — tokens; screen-stack landmark + hr.profile-updates.* testids; error-note/card-grid
- hr/HrPromotionAppraisals.tsx — tokens; hr.promotion-appraisals/gates testids; fixed contrast (error/notice -> error-note/success-note)
- hr/LineManagerTrainingEvaluation.tsx — tokens; hr.line-manager-evaluation landmark; contrast fix
- hr/MicrosoftAiLearningPath.tsx — tokens; hr.ai-learning-path landmark
- hr/TrainingEvaluations.tsx — tokens; hr.training-evaluations* landmarks/testids; contrast fix
- hr/TrainingVideoCenter.tsx — tokens; hr.training-videos / -player landmarks; contrast fix
- hr/W3cTrainingCatalog.tsx — tokens; hr.w3c-catalog landmark + courses testid
- hr/index.ts — promotionAppraisals label "Promotion Appraisals" -> "hr.subnav.promotionAppraisals" key (raw-string leak)
- qms/*.tsx (14 files) — 76 static colored buttons folded from inline style to .action-button + tone modifier
- i18n.ts — +~40 trilingual keys: dynamic-map leaks found via runtime scan (hr.subnav.grievances/pdaDomains/promotionAppraisals, mes.subnav.*, procurement.*, einvoice.*, status.voided, hr.status.*)

Evidence: .tmp-design/shots-after/{hr,maintenance,maintenance-*,oa,admin,finance,sales}.png (2026-11-23, vite 5178, admin login). Runtime scans: dark:0, leaks:[] on all.

NOT touched: modules/registry.ts (FROZEN nav), App.tsx nav structure/render-map (a peer moved the WMS render map to wms/WmsModule.tsx this cycle), services/api/**, harness/**, git operations.
