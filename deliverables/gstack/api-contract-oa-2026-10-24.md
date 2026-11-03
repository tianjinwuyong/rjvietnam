# OA 后端 API 契约（自动提取）

> 来源：`app/server/src/routes/*.js`｜提取时间：2026-10-24｜共 **465** 个端点
> 统一响应信封：成功 `{ code:0, msg, data }`；失败 `{ code:1, msg }`（HTTP 4xx/5xx）
> 令牌：`Authorization: Bearer <token>` / `x-token` / `?token=`；语言：`X-OA-Lang: zh|vi|en`

| 文件 | 端点数 |
|---|---|
| attendance.js | 58 |
| auth.js | 9 |
| doc.js | 49 |
| drive.js | 26 |
| exam.js | 17 |
| flow.js | 34 |
| meeting.js | 52 |
| modules.js | 93 |
| oa-iqc.js | 17 |
| oa-mrb.js | 6 |
| oqc.js | 2 |
| qc-library.js | 19 |
| quality.js | 2 |
| stocktake.js | 13 |
| system.js | 45 |
| template-field.js | 6 |
| training.js | 17 |

## attendance.js（58）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/attendance/template` | — | — |
| POST | `/api/attendance/import` | — | `attend:manage` |
| GET | `/api/attendance/raw` | — | — |
| GET | `/api/attendance/summary` | — | — |
| POST | `/api/attendance/compute` | — | `attend:manage` |
| GET | `/api/attendance/export` | — | — |
| GET | `/api/attendance/rules` | — | — |
| GET | `/api/attendance/rules/:code` | — | — |
| POST | `/api/attendance/rules` | — | `attend:manage` |
| PUT | `/api/attendance/rules/:code` | — | `attend:manage` |
| DELETE | `/api/attendance/rules/:code` | — | `attend:manage` |
| GET | `/api/attendance/calendar/:yearMonth` | — | — |
| PUT | `/api/attendance/calendar/:yearMonth` | — | `attend:manage` |
| GET | `/api/attendance/schedule/template` | — | — |
| POST | `/api/attendance/schedule/import` | — | `attend:schedule` |
| GET | `/api/attendance/schedule/export` | — | — |
| GET | `/api/attendance/schedule` | — | — |
| POST | `/api/attendance/schedule/cell` | — | `attend:schedule` |
| POST | `/api/attendance/schedule/batch` | — | `attend:schedule` |
| DELETE | `/api/attendance/schedule` | — | `attend:schedule` |
| GET | `/api/attendance/shifts` | — | — |
| PUT | `/api/attendance/shifts/:code` | — | `attend:schedule` |
| POST | `/api/attendance/anomalies/detect` | — | `attend:schedule` |
| GET | `/api/attendance/anomalies/stats` | — | — |
| GET | `/api/attendance/anomalies/export` | — | — |
| GET | `/api/attendance/anomalies` | — | — |
| POST | `/api/attendance/anomalies/:id/resolve` | — | `attend:schedule` |
| POST | `/api/attendance/anomalies/:id/unresolve` | — | `attend:schedule` |
| GET | `/api/attendance/anomalies/remedy-stats` | — | — |
| GET | `/api/attendance/anomalies/:id/remedy-preview` | — | — |
| POST | `/api/attendance/anomalies/:id/miss-card` | — | `attend:remedy` |
| POST | `/api/attendance/anomalies/:id/clear-remedy` | — | `attend:remedy` |
| GET | `/api/attendance/comp/overrides` | — | — |
| POST | `/api/attendance/comp/overrides` | — | `attend:comp` |
| DELETE | `/api/attendance/comp/overrides/:id` | — | `attend:comp` |
| GET | `/api/attendance/comp/balance` | — | — |
| GET | `/api/attendance/comp/ledger` | — | — |
| POST | `/api/attendance/comp/batch` | — | `attend:comp` |
| GET | `/api/attendance/comp/stats` | — | — |
| GET | `/api/attendance/comp/overdue` | — | `attend:comp` |
| POST | `/api/attendance/comp/offset-annual` | — | `attend:comp` |
| GET | `/api/salary/structures` | — | `salary:manage` |
| GET | `/api/salary/structures/:id` | — | `salary:manage` |
| POST | `/api/salary/structures` | — | `salary:manage` |
| PUT | `/api/salary/structures/:id` | — | `salary:manage` |
| POST | `/api/salary/structures/:id/approve` | — | `salary:manage` |
| GET | `/api/salary/classes` | — | — |
| GET | `/api/salary/classes/:id` | — | — |
| POST | `/api/salary/classes` | — | `salary:manage` |
| PUT | `/api/salary/classes/:id` | — | `salary:manage` |
| DELETE | `/api/salary/classes/:id` | — | `salary:manage` |
| GET | `/api/salary/assignments` | — | `salary:manage` |
| POST | `/api/salary/assignments` | — | `salary:manage` |
| POST | `/api/salary/assignments/batch` | — | `salary:manage` |
| POST | `/api/salary/generate` | — | `salary:manage` |
| GET | `/api/salary/records` | — | — |
| GET | `/api/salary/performance-records` | — | `salary:manage` |
| GET | `/api/salary/export` | — | — |

## auth.js（9）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| POST | `/api/auth/login` | — | — |
| POST | `/api/auth/feishu/login` | — | — |
| POST | `/api/auth/logout` | ✅ | — |
| PUT | `/api/auth/language` | ✅ | — |
| GET | `/api/i18n/dict` | ✅ | — |
| GET | `/api/auth/profile` | ✅ | — |
| POST | `/api/auth/password` | ✅ | — |
| GET | `/api/notifications` | ✅ | — |
| POST | `/api/notifications/read` | ✅ | — |

## doc.js（49）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/docs/next-code` | — | `doc:edit` |
| GET | `/api/doc-drafts/latest` | — | — |
| GET | `/api/doc-drafts` | — | — |
| GET | `/api/doc-drafts/:id` | — | — |
| POST | `/api/doc-drafts` | — | `doc:edit` |
| PUT | `/api/doc-drafts/:id` | — | `doc:edit` |
| DELETE | `/api/doc-drafts/:id` | — | `doc:edit` |
| GET | `/api/docs` | — | — |
| GET | `/api/docs/public-list` | — | — |
| GET | `/api/docs/seals` | — | — |
| PUT | `/api/docs/seals/:type` | — | `doc:manage` |
| GET | `/api/docs/external` | — | — |
| GET | `/api/docs/reviews` | — | `doc:manage` |
| GET | `/api/docs/ledger/:type` | — | — |
| GET | `/api/docs/ledger/:type/export` | — | `doc:manage` |
| POST | `/api/docs/borrow/:id/return` | — | `doc:manage` |
| POST | `/api/docs/cron/scan` | — | — |
| GET | `/api/docs/issue/feed` | — | — |
| POST | `/api/docs/issue/feed/:id/read` | — | — |
| GET | `/api/docs/issue/feed/:id/reads` | — | — |
| GET | `/api/docs/:id` | — | — |
| POST | `/api/docs` | — | `doc:edit` |
| PUT | `/api/docs/:id` | — | `doc:edit` |
| POST | `/api/docs/:id/lock` | — | `doc:edit` |
| POST | `/api/docs/:id/heartbeat` | — | — |
| POST | `/api/docs/:id/unlock` | — | — |
| POST | `/api/docs/:id/draft` | — | `doc:edit` |
| POST | `/api/docs/:id/version` | — | `doc:edit` |
| POST | `/api/docs/:id/version-lang` | — | `doc:edit` |
| POST | `/api/docs/:id/submit-issue` | — | `doc:edit` |
| GET | `/api/docs/:id/issue-status` | — | — |
| POST | `/api/docs/:id/review-action` | — | `doc:edit` |
| POST | `/api/docs/:id/publish` | — | `doc:issue` |
| POST | `/api/docs/:id/obsolete` | — | `doc:issue` |
| POST | `/api/docs/:id/submit-obsolete` | — | `doc:issue` |
| GET | `/api/docs/:id/obsolete-status` | — | — |
| POST | `/api/docs/:id/destroy` | — | `doc:issue` |
| GET | `/api/docs/:id/issue-records` | — | `doc:manage` |
| POST | `/api/docs/:id/issue-records` | — | `doc:manage` |
| GET | `/api/docs/:id/borrow` | — | `doc:manage` |
| POST | `/api/docs/:id/borrow` | — | `doc:borrow` |
| GET | `/api/docs/:id/relations` | — | — |
| POST | `/api/docs/:id/relations` | — | `doc:edit` |
| GET | `/api/docs/:id/sealed-file` | — | — |
| GET | `/api/docs/:id/attachments` | — | — |
| POST | `/api/docs/:id/attachments` | — | `doc:edit` |
| POST | `/api/docs/:id/external-review` | — | `doc:manage` |
| POST | `/api/docs/:id/review-plan` | — | `doc:manage` |
| POST | `/api/docs/:id/print-log` | — | — |

## drive.js（26）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/drive` | — | — |
| GET | `/api/drive/meta/:type/:id` | — | — |
| GET | `/api/drive/folder/:id` | — | — |
| GET | `/api/drive/breadcrumb/:id` | — | — |
| POST | `/api/drive/folder` | — | — |
| PUT | `/api/drive/folder/:id` | — | — |
| DELETE | `/api/drive/folder/:id` | — | — |
| POST | `/api/drive/file` | — | — |
| PUT | `/api/drive/file/:id/content` | — | — |
| PUT | `/api/drive/file/:id` | — | — |
| DELETE | `/api/drive/file/:id` | — | — |
| GET | `/api/drive/acl/:folderId` | — | — |
| PUT | `/api/drive/acl/:folderId` | — | — |
| DELETE | `/api/drive/acl/:folderId/:userId` | — | — |
| POST | `/api/drive/file/:id/move` | — | — |
| POST | `/api/drive/file/:id/copy` | — | — |
| POST | `/api/drive/folder/:id/move` | — | — |
| POST | `/api/drive/folder/:id/copy` | — | — |
| GET | `/api/drive/trash` | — | — |
| POST | `/api/drive/trash/:type/:id/restore` | — | — |
| POST | `/api/drive/trash/:type/:id/purge` | — | — |
| GET | `/api/drive/search` | — | — |
| POST | `/api/drive/share` | — | — |
| GET | `/api/drive/share/:token` | — | — |
| GET | `/api/drive/audit` | — | — |
| GET | `/api/drive/audit/export` | — | — |

## exam.js（17）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/exams` | — | — |
| POST | `/api/exams` | — | `train:manage` |
| GET | `/api/exams/my` | — | — |
| GET | `/api/exams/attempts/:attemptId` | — | — |
| POST | `/api/exams/attempts/:attemptId/submit` | — | — |
| POST | `/api/exams/attempts/:attemptId/retake` | — | — |
| GET | `/api/exams/:id/attempts` | — | `train:manage` |
| POST | `/api/exams/:id/publish` | — | `train:manage` |
| POST | `/api/exams/:id/close` | — | `train:manage` |
| GET | `/api/exams/:id` | — | `train:manage` |
| PUT | `/api/exams/:id` | — | `train:manage` |
| DELETE | `/api/exams/:id` | — | `train:manage` |
| GET | `/api/exams/:id/questions` | — | `train:manage` |
| POST | `/api/exams/:id/questions` | — | `train:manage` |
| POST | `/api/exams/:id/questions/import` | — | `train:manage` |
| PUT | `/api/exams/:id/questions/:qid` | — | `train:manage` |
| DELETE | `/api/exams/:id/questions/:qid` | — | `train:manage` |

## flow.js（34）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/flows` | — | — |
| GET | `/api/flows/:id` | — | — |
| GET | `/api/instances` | — | — |
| GET | `/api/instances/:id` | — | — |
| POST | `/api/instances/:id/attachments` | — | — |
| PATCH | `/api/instances/:id/form-data` | — | — |
| POST | `/api/instances` | — | `flow:submit` |
| POST | `/api/instances/:id/submit` | — | — |
| GET | `/api/handover/items` | — | — |
| GET | `/api/handover` | — | — |
| GET | `/api/handover/:id` | — | — |
| POST | `/api/handover` | — | — |
| GET | `/api/handover/blockers/:userId` | — | — |
| POST | `/api/tasks/:id/approve` | — | `flow:approve` |
| POST | `/api/tasks/batch-approve` | — | `flow:approve` |
| POST | `/api/instances/:id/return` | — | — |
| POST | `/api/tasks/:id/transfer` | — | — |
| POST | `/api/instances/:id/assign-node` | — | — |
| POST | `/api/instances/:id/urge` | — | — |
| POST | `/api/instances/:id/terminate` | — | — |
| POST | `/api/instances/:id/cc` | — | — |
| POST | `/api/instances/:id/archive` | — | — |
| POST | `/api/instances/:id/temp-add` | — | — |
| POST | `/api/instances/:id/withdraw` | — | — |
| GET | `/api/flows/:id/candidates` | — | — |
| GET | `/api/ledger/:code` | — | — |
| GET | `/api/stats/overview` | — | — |
| GET | `/api/stats/calendar` | — | — |
| PUT | `/api/flows/:id/config` | — | `flow:config` |
| POST | `/api/flows` | — | `flow:config` |
| GET | `/api/flows/:id/versions` | — | — |
| POST | `/api/flows/:id/versions` | — | `flow:config` |
| POST | `/api/flows/:id/versions/:vid/release` | — | `flow:config` |
| POST | `/api/flows/:id/versions/:vid/rollback` | — | `flow:config` |

## meeting.js（52）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/meeting/series` | — | — |
| POST | `/api/meeting/series` | — | — |
| GET | `/api/meeting/series/:id` | — | — |
| PUT | `/api/meeting/series/:id` | — | — |
| DELETE | `/api/meeting/series/:id` | — | — |
| GET | `/api/meeting/series/:id/follow` | — | — |
| GET | `/api/meeting/series/:id/follow/export` | — | — |
| PUT | `/api/meeting/decisions/:id` | — | — |
| DELETE | `/api/meeting/decisions/:id` | — | — |
| GET | `/api/meeting/decisions/:id/submissions` | — | — |
| POST | `/api/meeting/decisions/:id/deliverables` | — | — |
| GET | `/api/meeting/actions` | — | — |
| GET | `/api/meeting/actions/:id` | — | — |
| PUT | `/api/meeting/actions/:id` | — | — |
| DELETE | `/api/meeting/actions/:id` | — | — |
| POST | `/api/meeting/actions/:id/progress` | — | — |
| POST | `/api/meeting/actions/:id/claim` | — | — |
| POST | `/api/meeting/actions/:id/done` | — | — |
| POST | `/api/meeting/actions/:id/close` | — | — |
| POST | `/api/meeting/actions/:id/reopen` | — | — |
| POST | `/api/meeting/actions/:id/cancel` | — | — |
| GET | `/api/meeting/actions/:id/submissions` | — | — |
| POST | `/api/meeting/actions/:id/deliverables` | — | — |
| POST | `/api/meeting/submissions/:id/review` | — | — |
| POST | `/api/meeting/submissions/:id/attachments` | — | — |
| GET | `/api/meeting/minutes` | — | — |
| GET | `/api/meeting/my` | — | — |
| GET | `/api/meeting` | — | — |
| POST | `/api/meeting` | — | — |
| GET | `/api/meeting/:id` | — | — |
| PUT | `/api/meeting/:id` | — | — |
| DELETE | `/api/meeting/:id` | — | — |
| POST | `/api/meeting/:id/schedule` | — | — |
| POST | `/api/meeting/:id/reschedule` | — | — |
| POST | `/api/meeting/:id/cancel` | — | — |
| POST | `/api/meeting/:id/start` | — | — |
| POST | `/api/meeting/:id/end` | — | — |
| POST | `/api/meeting/:id/close` | — | — |
| GET | `/api/meeting/:id/attendees` | — | — |
| POST | `/api/meeting/:id/attendees` | — | — |
| PUT | `/api/meeting/:id/attendees/:aid` | — | — |
| DELETE | `/api/meeting/:id/attendees/:aid` | — | — |
| POST | `/api/meeting/:id/attendees/:aid/attend` | — | — |
| POST | `/api/meeting/:id/notify` | — | — |
| PUT | `/api/meeting/:id/minutes` | — | — |
| POST | `/api/meeting/:id/minutes/confirm` | — | — |
| GET | `/api/meeting/:id/decisions` | — | — |
| POST | `/api/meeting/:id/decisions` | — | — |
| GET | `/api/meeting/:id/actions` | — | — |
| POST | `/api/meeting/:id/actions` | — | — |
| GET | `/api/meeting/:id/review` | — | — |
| POST | `/api/meeting/:id/review/:rid` | — | — |

## modules.js（93）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/knowledge` | — | — |
| POST | `/api/knowledge` | — | `knowledge:manage` |
| POST | `/api/knowledge/:id/approve` | — | — |
| POST | `/api/knowledge/:id/view` | — | — |
| POST | `/api/knowledge/:id/download` | — | — |
| POST | `/api/knowledge/:id/version` | — | `knowledge:manage` |
| GET | `/api/knowledge/:id/versions` | — | — |
| GET | `/api/training` | — | — |
| POST | `/api/training` | — | `train:manage` |
| GET | `/api/questions` | — | — |
| POST | `/api/questions/import` | — | `train:manage` |
| POST | `/api/exam/submit` | — | — |
| GET | `/api/certificates` | — | — |
| GET | `/api/equipment` | — | — |
| GET | `/api/equipment/by-code/:code` | — | — |
| GET | `/api/equipment/template` | — | — |
| POST | `/api/equipment/import` | — | `equip:manage` |
| POST | `/api/equipment` | — | `equip:manage` |
| PUT | `/api/equipment/:id` | — | `equip:manage` |
| DELETE | `/api/equipment/:id` | — | `equip:manage` |
| GET | `/api/equipment/:id/history` | — | — |
| POST | `/api/equipment/:id/scan-log` | — | — |
| GET | `/api/equipment/calibrations` | — | — |
| POST | `/api/equipment/calibrations` | — | `equip:manage` |
| PUT | `/api/equipment/calibrations/:id` | — | `equip:manage` |
| DELETE | `/api/equipment/calibrations/:id` | — | `equip:manage` |
| GET | `/api/equipment/alerts` | — | — |
| POST | `/api/equipment/alerts/scan` | — | `equip:manage` |
| GET | `/api/equipment/inspect/templates` | — | — |
| GET | `/api/equipment/inspect/templates/:id` | — | — |
| POST | `/api/equipment/inspect/templates` | — | `equip:manage` |
| PUT | `/api/equipment/inspect/templates/:id` | — | `equip:manage` |
| DELETE | `/api/equipment/inspect/templates/:id` | — | `equip:manage` |
| GET | `/api/equipment/inspect/records` | — | — |
| GET | `/api/equipment/inspect/records/:id` | — | — |
| POST | `/api/equipment/inspect/records` | — | — |
| PUT | `/api/equipment/inspect/records/:id` | — | — |
| POST | `/api/equipment/inspect/records/:id/report-issue` | — | — |
| POST | `/api/equipment/inspect/records/:id/attachments` | — | — |
| GET | `/api/equipment/inspect/tasks/:id` | — | — |
| GET | `/api/equipment/stats` | — | — |
| GET | `/api/equipment/inspect/stats` | — | — |
| POST | `/api/equipment/tasks/generate` | — | `equip:manage` |
| GET | `/api/equipment/tasks` | — | — |
| GET | `/api/equipment/tasks/:id` | — | — |
| POST | `/api/equipment/tasks/:id/done` | — | — |
| GET | `/api/ipqc/templates` | — | — |
| GET | `/api/ipqc/templates/:id` | — | — |
| POST | `/api/ipqc/templates` | — | `ipqc:manage` |
| PUT | `/api/ipqc/templates/:id` | — | `ipqc:manage` |
| DELETE | `/api/ipqc/templates/:id` | — | `ipqc:manage` |
| GET | `/api/ipqc/records` | — | — |
| GET | `/api/ipqc/records/:id` | — | — |
| POST | `/api/ipqc/records` | — | — |
| PUT | `/api/ipqc/records/:id` | — | — |
| POST | `/api/ipqc/records/:id/report-issue` | — | — |
| POST | `/api/ipqc/records/:id/attachments` | — | — |
| GET | `/api/ipqc/stats` | — | — |
| POST | `/api/ipqc/tasks/generate` | — | `ipqc:manage` |
| GET | `/api/ipqc/tasks/:id` | — | — |
| GET | `/api/fai/templates` | — | — |
| GET | `/api/fai/stats` | — | — |
| GET | `/api/fai/templates/:id` | — | — |
| POST | `/api/fai/templates` | — | `fai:manage` |
| PUT | `/api/fai/templates/:id` | — | `fai:manage` |
| DELETE | `/api/fai/templates/:id` | — | `fai:manage` |
| GET | `/api/fai/records` | — | — |
| GET | `/api/fai/records/:id` | — | — |
| POST | `/api/fai/records` | — | — |
| PUT | `/api/fai/records/:id` | — | — |
| POST | `/api/fai/records/:id/report-issue` | — | — |
| POST | `/api/fai/records/:id/attachments` | — | — |
| GET | `/api/stats/advanced` | — | — |
| GET | `/api/knowledge/favorites` | — | — |
| GET | `/api/knowledge/search` | — | — |
| GET | `/api/knowledge/likes` | — | — |
| GET | `/api/knowledge/stats` | — | — |
| POST | `/api/knowledge/:id/like` | — | — |
| POST | `/api/knowledge/:id/favorite` | — | — |
| GET | `/api/calendar/events` | — | — |
| GET | `/api/calendar` | — | — |
| POST | `/api/calendar` | — | — |
| GET | `/api/calendar/:id` | — | — |
| PUT | `/api/calendar/:id` | — | — |
| DELETE | `/api/calendar/:id` | — | — |
| GET | `/api/announcements/unread` | — | — |
| GET | `/api/announcements` | — | — |
| POST | `/api/announcements` | — | — |
| GET | `/api/announcements/:id` | — | — |
| PUT | `/api/announcements/:id` | — | — |
| POST | `/api/announcements/:id/publish` | — | — |
| POST | `/api/announcements/:id/read` | — | — |
| DELETE | `/api/announcements/:id` | — | — |

## oa-iqc.js（17）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| POST | `/api/integration/iqc/lots` | — | — |
| GET | `/api/iqc/lots` | — | `ipqc:manage` |
| GET | `/api/iqc/lots/:id` | — | `ipqc:manage` |
| POST | `/api/iqc/lots/:id/claim` | — | `ipqc:manage` |
| POST | `/api/iqc/lots/:id/release` | — | `ipqc:manage` |
| GET | `/api/iqc/templates` | — | `ipqc:manage` |
| GET | `/api/iqc/lots/:id/sheet` | — | `ipqc:manage` |
| POST | `/api/iqc/lots/:id/record` | — | `ipqc:manage` |
| POST | `/api/iqc/lots/:id/record/save` | — | `ipqc:manage` |
| POST | `/api/iqc/records/:id/submit` | — | `ipqc:manage` |
| GET | `/api/iqc/stats` | — | `ipqc:manage` |
| GET | `/api/iqc/records/:id/report` | — | `ipqc:manage` |
| POST | `/api/iqc/jobs/retry-backfill` | — | `ipqc:manage` |
| GET | `/api/iqc/wms-link` | — | — |
| GET | `/api/iqc/reconcile` | — | `ipqc:manage` |
| POST | `/api/iqc/jobs/release-stale` | — | `ipqc:manage` |
| POST | `/api/iqc/records/:id/approve` | — | `ipqc:manage` |

## oa-mrb.js（6）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| POST | `/api/integration/mrb` | — | — |
| GET | `/api/mrb/list` | — | `ipqc:manage` |
| GET | `/api/mrb/:id` | — | `ipqc:manage` |
| POST | `/api/mrb/:id/decision` | — | `ipqc:manage` |
| POST | `/api/mrb/:id/resubmit` | — | `ipqc:manage` |
| POST | `/api/mrb/:id/reject` | — | `ipqc:manage` |

## oqc.js（2）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/oqc/sampling/options` | — | — |
| GET | `/api/oqc/sampling` | — | — |

## qc-library.js（19）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/qc/templates` | — | — |
| GET | `/api/qc/templates/:id` | — | — |
| POST | `/api/qc/templates` | — | — |
| PUT | `/api/qc/templates/:id` | — | — |
| DELETE | `/api/qc/templates/:id` | — | — |
| POST | `/api/qc/templates/:id/duplicate` | — | — |
| GET | `/api/qc/templates/:id/items` | — | — |
| PUT | `/api/qc/templates/:id/items` | — | — |
| POST | `/api/qc/templates/:id/import-section` | — | — |
| GET | `/api/qc/standard-items` | — | — |
| POST | `/api/qc/standard-items/save-all` | — | — |
| POST | `/api/qc/standard-items/bulk` | — | — |
| POST | `/api/qc/standard-items` | — | — |
| PUT | `/api/qc/standard-items/:id` | — | — |
| DELETE | `/api/qc/standard-items/:id` | — | — |
| GET | `/api/qc/templates/:id/materials` | — | — |
| POST | `/api/qc/templates/:id/materials` | — | — |
| DELETE | `/api/qc/templates/:id/materials/:materialCode` | — | — |
| GET | `/api/qc/materials/:code/templates` | — | — |

## quality.js（2）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/quality/wms-iqc/dashboard` | — | — |
| GET | `/api/quality/wms-iqc/defects` | — | — |

## stocktake.js（13）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/equipment/stocktakes/scope-preview` | — | — |
| GET | `/api/equipment/stocktakes/mobile-tasks` | — | — |
| POST | `/api/equipment/stocktakes` | — | — |
| PUT | `/api/equipment/stocktakes/:id` | — | — |
| DELETE | `/api/equipment/stocktakes/:id` | — | — |
| GET | `/api/equipment/stocktakes` | — | — |
| GET | `/api/equipment/stocktakes/:id/report` | — | — |
| GET | `/api/equipment/stocktakes/:id` | — | — |
| POST | `/api/equipment/stocktakes/:id/submit` | — | — |
| POST | `/api/equipment/stocktakes/:id/withdraw` | — | — |
| POST | `/api/equipment/stocktakes/:id/submit-finish` | — | — |
| POST | `/api/equipment/stocktakes/:id/withdraw-finish` | — | — |
| POST | `/api/equipment/stocktakes/:id/check` | — | — |

## system.js（45）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/departments` | — | — |
| POST | `/api/departments` | — | — |
| PUT | `/api/departments/:id` | — | — |
| DELETE | `/api/departments/:id` | — | — |
| GET | `/api/onboardings` | — | — |
| POST | `/api/onboardings/import` | — | — |
| POST | `/api/onboardings/batch-confirm` | — | — |
| POST | `/api/onboardings/:id/reveal` | — | — |
| GET | `/api/onboardings/:id` | — | — |
| POST | `/api/onboardings` | — | — |
| PUT | `/api/onboardings/:id` | — | — |
| POST | `/api/onboardings/:id/confirm` | — | — |
| POST | `/api/onboardings/:id/cancel` | — | — |
| GET | `/api/sensitive-viewers` | — | — |
| POST | `/api/sensitive-viewers` | — | — |
| DELETE | `/api/sensitive-viewers/:userId` | — | — |
| GET | `/api/sensitive-logs` | — | — |
| GET | `/api/users` | — | — |
| POST | `/api/users` | — | — |
| PUT | `/api/users/:id` | — | — |
| GET | `/api/users/:id/transfers` | — | — |
| POST | `/api/users/:id/reset-password` | — | — |
| GET | `/api/roles` | — | — |
| GET | `/api/config` | — | — |
| PUT | `/api/config` | — | — |
| POST | `/api/upload` | — | — |
| GET | `/api/files/*` | — | — |
| GET | `/api/audit` | — | — |
| GET | `/api/org/import/template` | — | — |
| GET | `/api/org/positions` | — | — |
| GET | `/api/org/sections` | — | — |
| GET | `/api/org/positions/all` | — | `org:manage` |
| POST | `/api/org/positions` | — | — |
| PUT | `/api/org/positions/:id` | — | — |
| DELETE | `/api/org/positions/:id` | — | — |
| POST | `/api/org/import` | — | `org:manage` |
| GET | `/api/org/export` | — | `org:manage` |
| GET | `/api/org/minutes/template` | — | — |
| GET | `/api/org/minutes/export` | — | — |
| GET | `/api/org/minutes` | — | — |
| GET | `/api/org/minutes/:id` | — | — |
| POST | `/api/org/minutes` | — | `org:manage` |
| POST | `/api/org/minutes/import` | — | `org:manage` |
| PUT | `/api/org/minutes/:id` | — | `org:manage` |
| DELETE | `/api/org/minutes/:id` | — | `org:manage` |

## template-field.js（6）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/template-fields` | — | — |
| GET | `/api/template-fields/builtin/:scope` | — | — |
| POST | `/api/template-fields` | — | `template:field` |
| PUT | `/api/template-fields/:id` | — | `template:field` |
| DELETE | `/api/template-fields/:id` | — | `template:field` |
| GET | `/api/template-fields/values/:scope/:templateId` | — | — |

## training.js（17）

| Method | Path | 认证 | 权限码 |
|---|---|---|---|
| GET | `/api/training/members/preview` | — | — |
| GET | `/api/training/plans` | — | — |
| GET | `/api/training/plans/:id/export` | — | — |
| GET | `/api/training/plans/:id` | — | — |
| POST | `/api/training/plans` | — | `train:manage` |
| PUT | `/api/training/plans/:id` | — | `train:manage` |
| DELETE | `/api/training/plans/:id` | — | `train:manage` |
| GET | `/api/training/plans/:id/members` | — | — |
| POST | `/api/training/plans/:id/members/import` | — | `train:manage` |
| POST | `/api/training/plans/:id/members/remove` | — | `train:manage` |
| POST | `/api/training/plans/:id/records/generate` | — | `train:manage` |
| GET | `/api/training/records/export` | — | — |
| GET | `/api/training/records/by-user/:userId` | — | — |
| GET | `/api/training/records` | — | — |
| POST | `/api/training/records/batch` | — | `train:manage` |
| PUT | `/api/training/records/:id` | — | `train:manage` |
| DELETE | `/api/training/records/:id` | — | `train:manage` |

