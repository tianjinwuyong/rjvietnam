# 运行中 WMS / OA ↔ SMT 表级 parity 矩阵(终版)

生成 2026-11-22,收敛全部跑完后实测。srcRows=源库行数(SSH 直连源机 psql 枚举),ext=SMT 全量副本(ext_wms_src / ext_oa_src,管理→外部数据源 wms_src/oa_src),target=业务落点。

状态: OK=业务落点与源行数一致 | DIFF=落后(收敛补,下一轮闭合) | EXT-ONLY(有意)=源内部表,只保留全量副本不进业务表 | SMT-本地行=落点含 SMT 本地产生的行(超集,正常)。

## WMS 源(public.wms @100.107.212.49:5434)

| 源表 | 源行数 | ext 副本 | SMT 业务落点 | 落点行数 | 状态 |
|---|---|---|---|---|---|
| inventory | 222 | 222 | public.rjvn_inventory | 222 | OK |
| inventory_transaction | 935 | 935 | public.rjvn_inventory_transaction | 935 | OK |
| iqc_inspection_draft | 2 | 2 | public.rjvn_iqc_inspection_draft | 2 | OK |
| iqc_inspection_record | 139 | 139 | public.rjvn_iqc_inspection_record | 139 | OK |
| iqc_inspection_strictness | 3 | 3 | public.rjvn_iqc_inspection_strictness | 3 | OK |
| iqc_lot | 226 | 226 | public.rjvn_iqc_lot | 226 | OK |
| iqc_lot_receipt | 917 | 917 | public.rjvn_iqc_lot_receipt | 917 | OK |
| iqc_lot_strictness_count | 4 | 4 | public.rjvn_iqc_lot_strictness_count | 4 | OK |
| iqc_report | 27 | 27 | public.rjvn_iqc_report | 27 | OK |
| iqc_standard_item | 11 | 11 | public.rjvn_iqc_standard_item | 11 | OK |
| iqc_template | 32 | 32 | public.rjvn_iqc_template | 32 | OK |
| iqc_template_item | 131 | 131 | public.rjvn_iqc_template_item | 131 | OK |
| material | 406 | 406 | public.rjvn_material | 406 | OK |
| mes_sync_log | 8103 | 8110 | public.rjvn_mes_sync_log | 8110 | SMT-本地行 |
| mes_sync_state | 1 | 1 | public.rjvn_mes_sync_state | 1 | OK |
| operation_log | 440 | 443 | public.rjvn_operation_log | 443 | SMT-本地行 |
| picking_order | 10 | 10 | public.rjvn_picking_order | 10 | OK |
| picking_order_item | 173 | 173 | public.rjvn_picking_order_item | 173 | OK |
| receipt_order | 924 | 924 | public.rjvn_receipt_order | 924 | OK |
| supplier | 89 | 89 | public.rjvn_supplier | 89 | OK |
| sys_account | 14 | 14 | public.rjvn_sys_account | 14 | OK |
| sys_param | 25 | 25 | public.rjvn_sys_param | 25 | OK |
| sys_role | 22 | 22 | public.rjvn_sys_role | 22 | OK |
| warehouse | 2 | 2 | public.rjvn_warehouse | 2 | OK |
| warehouse_location | 5 | 5 | public.rjvn_warehouse_location | 5 | OK |
| work_order | 2 | 2 | public.rjvn_work_order | 2 | OK |

## OA 源(public.oa_system @100.107.212.49:5433)

| 源表 | 源行数 | ext 副本 | SMT 业务落点 | 落点行数 | 状态 |
|---|---|---|---|---|---|
| _bak_rule_20261026 | 34 | 34 | oa._bak_rule_20261026 | 0 | EXT-ONLY(有意) — 源备份残渣表 |
| attachment | 271 | 271 | oa.attachment | 271 | OK |
| attendance_holiday | 67 | 67 | oa.attendance_holiday | 67 | OK |
| attendance_leave_type | 14 | 14 | oa.attendance_leave_type | 14 | OK |
| attendance_rule | 2 | 2 | oa.attendance_rule | 2 | OK |
| attendance_rule_slot | 4 | 4 | oa.attendance_rule_slot | 4 | OK |
| attendance_rule_window | 3 | 3 | oa.attendance_rule_window | 3 | OK |
| attendance_schedule_plan | 3 | 3 | oa.attendance_schedule_plan | 3 | OK |
| attendance_schedule_plan_item | 248 | 248 | oa.attendance_schedule_plan_item | 248 | OK |
| attendance_schedule_plan_log | 5 | 5 | oa.attendance_schedule_plan_log | 5 | OK |
| attendance_shift_def | 4 | 4 | oa.attendance_shift_def | 4 | OK |
| attendance_time_band | 24 | 24 | oa.attendance_time_band | 24 | OK |
| attendance_time_band_meal | 8 | 8 | oa.attendance_time_band_meal | 8 | OK |
| attendance_time_band_set | 2 | 2 | oa.attendance_time_band_set | 2 | OK |
| attendance_work_calendar | 4 | 4 | oa.attendance_work_calendar | 4 | OK |
| doc_change_log | 57 | 57 | oa.doc_change_log | 57 | OK |
| doc_code_ledger | 272 | 272 | oa.doc_code_ledger | 272 | OK |
| doc_code_seq | 62 | 62 | oa.doc_code_seq | 62 | OK |
| doc_issue_feed | 271 | 271 | oa.doc_issue_feed | 271 | OK |
| doc_issue_record | 271 | 271 | oa.doc_issue_record | 271 | OK |
| doc_print_log | 2 | 2 | oa.doc_print_log | 2 | OK |
| doc_review_read | 939 | 939 | oa.doc_review_read | 939 | OK |
| doc_seal | 4 | 4 | oa.doc_seal | 4 | OK |
| doc_system | 271 | 271 | oa.doc_system | 271 | OK |
| doc_version_lang | 271 | 271 | oa.doc_version_lang | 271 | OK |
| drive_audit_log | 3 | 3 | oa.drive_audit_log | 3 | OK |
| drive_folder | 4 | 4 | oa.drive_folder | 4 | OK |
| employee_onboarding | 39 | 39 | oa.employee_onboarding | 39 | OK |
| flow_definition | 33 | 33 | oa.flow_definition | 33 | OK |
| flow_definition_version | 43 | 43 | oa.flow_definition_version | 43 | OK |
| flow_instance | 271 | 271 | oa.flow_instance | 271 | OK |
| flow_instance_seq | 8 | 8 | oa.flow_instance_seq | 8 | OK |
| flow_log | 1290 | 1290 | oa.flow_log | 1290 | OK |
| flow_task | 1019 | 1019 | oa.flow_task | 1019 | OK |
| flow_threshold | 6 | 6 | oa.flow_threshold | 6 | OK |
| flow_webhook_outbox | 1 | 1 | oa.flow_webhook_outbox | 1 | OK |
| iqc_event_inbox | 1 | 1 | oa.iqc_event_inbox | 1 | OK |
| iqc_lot_mirror | 288 | 288 | oa.iqc_lot_mirror | 288 | OK |
| knowledge_comment | 1 | 1 | oa.knowledge_comment | 1 | OK |
| knowledge_doc | 1 | 1 | oa.knowledge_doc | 1 | OK |
| knowledge_favorite | 2 | 2 | oa.knowledge_favorite | 2 | OK |
| knowledge_like | 1 | 1 | oa.knowledge_like | 1 | OK |
| meeting_item_submission | 3 | 3 | oa.meeting_item_submission | 3 | OK |
| meeting_seq | 2 | 2 | oa.meeting_seq | 2 | OK |
| meeting_series | 7 | 7 | oa.meeting_series | 7 | OK |
| notification | 124 | 124 | oa.notification | 125 | SMT-本地行 |
| org_department | 10 | 10 | oa.org_department | 10 | OK |
| org_minutes_seq | 1 | 1 | oa.org_minutes_seq | 1 | OK |
| org_transfer_log | 6 | 6 | oa.org_transfer_log | 6 | OK |
| org_user | 41 | 41 | oa.org_user | 41 | OK |
| salary_base_purpose | 6 | 6 | oa.salary_base_purpose | 6 | OK |
| salary_base_purpose_item | 11 | 11 | oa.salary_base_purpose_item | 11 | OK |
| salary_base_scheme | 2 | 2 | oa.salary_base_scheme | 2 | OK |
| salary_class | 18 | 18 | oa.salary_class | 18 | OK |
| salary_insurance_rate | 4 | 4 | oa.salary_insurance_rate | 4 | OK |
| salary_item | 21 | 21 | oa.salary_item | 21 | OK |
| salary_param | 53 | 53 | oa.salary_param | 53 | OK |
| salary_stat_profile | 3 | 3 | oa.salary_stat_profile | 3 | OK |
| salary_tax_bracket | 5 | 5 | oa.salary_tax_bracket | 5 | OK |
| schema_migrations | 151 | 151 | oa.schema_migrations | 0 | EXT-ONLY(有意) — 源迁移台账(SMT 有自己的 _migrations) |
| sys_api_key | 3 | 3 | oa.sys_api_key | 3 | OK |
| sys_class | 4 | 4 | oa.sys_class | 4 | OK |
| sys_class_audit | 18 | 18 | oa.sys_class_audit | 18 | OK |
| sys_class_policy | 18 | 18 | oa.sys_class_policy | 18 | OK |
| sys_config | 50 | 50 | oa.sys_config | 50 | OK |
| sys_doc_version | 271 | 271 | oa.sys_doc_version | 271 | OK |
| sys_i18n_dict | 245 | 245 | oa.sys_i18n_dict | 245 | OK |
| sys_integration | 1 | 1 | oa.sys_integration | 1 | EXT-ONLY(有意) — 源集成配置内部表 |
| sys_integration_alert | 199 | 199 | oa.sys_integration_alert | 210 | EXT-ONLY(有意) — 源集成监控内部表(SMT 侧 oa.sys_integration_alert 是本地告警,非镜像) |
| sys_integration_biz | 6 | 6 | oa.sys_integration_biz | 6 | EXT-ONLY(有意) — 源集成配置内部表 |
| sys_integration_reconcile_run | 257 | 257 | oa.sys_integration_reconcile_run | 355 | EXT-ONLY(有意) — 源集成对账内部表(同上) |
| sys_integration_system | 2 | 2 | oa.sys_integration_system | 2 | EXT-ONLY(有意) — 源集成配置内部表 |
| sys_module | 48 | 48 | oa.sys_module | 48 | OK |
| sys_module_grant | 153 | 153 | oa.sys_module_grant | 153 | OK |
| sys_module_grant_bak_905 | 252 | 252 | — | — | EXT-ONLY(有意) — 源备份残渣表 |
| sys_module_grant_log | 553 | 553 | oa.sys_module_grant_log | 553 | OK |
| sys_permission | 34 | 34 | oa.sys_permission | 34 | OK |
| sys_position_class | 15 | 15 | oa.sys_position_class | 15 | OK |
| sys_role | 17 | 17 | oa.sys_role | 17 | OK |
| sys_role_permission | 110 | 110 | oa.sys_role_permission | 110 | OK |
| sys_session | 27 | 27 | oa.sys_session | 0 | EXT-ONLY(有意) — 源临时会话表(安全:会话不复制) |
| sys_user_role | 44 | 44 | oa.sys_user_role | 44 | OK |
| template_custom_field | 43 | 43 | oa.template_custom_field | 43 | OK |
| training | 1 | 1 | oa.training | 1 | OK |
| training_record | 21 | 21 | oa.training_record | 21 | OK |

**汇总**:26+85 张非空源表 = 111;业务落点行数一致 99;有意 ext-only 9;落点为超集(含本地行)3;DIFF 0(无);GAP 0(无)。
