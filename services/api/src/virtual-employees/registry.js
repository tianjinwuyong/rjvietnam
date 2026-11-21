import { skillsFor, mcpFor, gatesFor } from "./capabilities.js";

export const FACTORY_VIRTUAL_EMPLOYEES = Object.freeze([
  employee('OPS-SUPERVISOR-VIRTUAL-01', '全厂运营虚拟主管 Hermes', 'cmd', 'SUPERVISOR', ['FACTORY_PATROL', 'KPI_MONITOR', 'EXCEPTION_ROUTE', 'CROSS_DOMAIN_COORDINATION', 'APPROVAL_COORDINATION', 'SHIFT_HANDOVER', 'WECHAT_NOTIFY'], ['release_inventory', 'approve_scrap', 'change_po', 'stop_line', 'approve_payment', 'final_iqc_decision'], '统一管理虚拟员工，验证事实、分配唯一主责、协调跨部门交接、跟踪时限并升级异常；不替代专业岗位或人工审批。', 'HERMES_OPS_SUPERVISOR_V1'),
  employee('WMS-RECEIVING-VIRTUAL-01', 'WMS 收料虚拟员工', 'wms', 'SPECIALIST', ['RECEIVING_VALIDATE', 'LABEL_PLAN', 'HIDDEN_PALLET_BIND', 'LOCATION_BIND', 'IQC_HANDOFF'], ['receive_variance', 'inventory_release'], '确保 PDA 收集的真实箱数据完成 PO 核对、MSL 解析、箱 QR 打印、仓位绑定并进入 IQC HOLD。'),
  employee('IQC-VIRTUAL-01', 'IQC 虚拟检验员', 'quality', 'SPECIALIST', ['IQC_QUEUE_SCAN', 'SUPPLIER_HISTORY', 'SAMPLE_CALCULATION', 'DYNAMIC_PDA_PLAN', 'EVIDENCE_REVIEW'], ['final_iqc_decision', 'exemption', 'supplier_suspension']),
  employee('WMS-INVENTORY-VIRTUAL-01', 'WMS 安全库存虚拟员工', 'wms', 'SPECIALIST', ['INVENTORY_RECONCILE', 'FIFO_FEFO', 'LOCATION_OPTIMIZE', 'PUTAWAY_RECOMMEND', 'CYCLE_COUNT', 'SAFETY_STOCK_REPORT', 'DISTRIBUTION_SLA_MONITOR', 'DELIVERY_VARIANCE_ALERT', 'UNRECEIVED_PACKAGE_ESCALATE', 'DISTRIBUTION_KANBAN_REFRESH'], ['inventory_adjustment', 'material_scrap', 'override_putaway_rule', 'approve_distribution', 'hand_over_package', 'receive_package'], '依据库存流水监控最低库存和安全库存，推荐库位并跟踪物料配送的时限、差异和未签收包裹；只负责提醒、升级和刷新看板，不自行审批、交出、签收、调整库存或绕过隔离规则。'),
  employee('MSD-CONTROL-VIRTUAL-01', '湿敏物料控制虚拟员工', 'wms', 'SPECIALIST', ['MSL_MAP', 'FLOOR_LIFE', 'BAKING_ALERT', 'EXPOSURE_TRACE'], ['override_msl', 'release_expired_material']),
  employee('PMC-VIRTUAL-01', 'PMC 计划虚拟员工', 'pmc', 'COORDINATOR', ['MPS_PLAN', 'MRP_CALCULATE', 'SHORTAGE_ALERT', 'DELIVERY_RISK'], ['commit_delivery', 'change_frozen_plan']),
  employee('PURCHASING-VIRTUAL-01', '采购与 PO 管理虚拟员工', 'procurement', 'SPECIALIST', ['PO_MONITOR', 'REPLENISHMENT_REVIEW', 'SUPPLIER_FOLLOWUP', 'ASN_MONITOR', 'ETA_ATA_TRACKING', 'PALLET_LOGISTICS', 'QR_TRACE', 'DELIVERY_EXCEPTION', 'PO_ADJUSTMENT_DRAFT'], ['approve_po', 'change_price', 'change_quantity'], '执行采购 SOP，接收安全库存报告并形成补货建议，监控 PO、供应商确认、ASN、ETA/ATA、托盘物流和全部 QR；所有高风险变更保留人工审批。'),
  employee('OA-DOCUMENT-CONTROL-VIRTUAL-01', 'OA 文控协调虚拟员工', 'oa', 'COORDINATOR', ['DOCUMENT_CLASSIFY', 'ROUTE_ASSIGN', 'APPROVAL_TRACE', 'SLA_MONITOR', 'PRIORITY_QUEUE', 'REMINDER_SEND', 'OVERDUE_ESCALATE', 'WECHAT_NOTIFY', 'LICENSE_CHECK', 'CONTROLLED_PUBLISH', 'MATERIAL_REQUISITION_PACKAGE_CHECK', 'ROLE_DOCUMENT_SIGNATURE_CHECK', 'WMS_APPROVAL_RELEASE_NOTIFY'], ['approve_document', 'reject_document', 'sign_for_human', 'skip_required_step', 'publish_without_approval', 'external_distribution', 'execute_material_issue'], '协调全部 OA 审批包；核验领料内容、附件和各角色必签文件，按紧急程度与 SLA 追踪、催办和升级，并仅在全部人工签核完成后通知 WMS 放行。不得代替任何人员批准、拒绝、签字或执行发料。'),
  employee('SUPPLIER-COLLAB-VIRTUAL-01', '供应商协同虚拟员工', 'supplier', 'SPECIALIST', ['PORTAL_SYNC', 'ASN_MONITOR', 'QR_PRERECEIVING', 'IQC_FEEDBACK'], ['publish_rejection', 'supplier_account_approval']),
  employee('MES-VIRTUAL-01', 'MES 生产执行虚拟员工', 'mes', 'COORDINATOR', ['WORK_ORDER_MONITOR', 'ROUTE_GUARD', 'WIP_TRACE', 'LINE_EXCEPTION'], ['stop_line', 'close_work_order']),
  employee('QUALITY-VIRTUAL-01', '品质闭环虚拟主管', 'quality', 'COORDINATOR', ['QUALITY_TREND', 'NCR_ROUTE', 'CAPA_MONITOR', 'AUDIT_TRACE'], ['close_ncr', 'approve_capa']),
  employee('MAINTENANCE-VIRTUAL-01', '设备维护虚拟员工', 'maintenance', 'SPECIALIST', ['EQUIPMENT_HEALTH', 'PM_SCHEDULE', 'BREAKDOWN_ROUTE', 'SPARE_ALERT'], ['return_machine_to_service']),
  employee('FINANCE-VIRTUAL-01', '财务核对虚拟员工', 'finance', 'SPECIALIST', ['THREE_WAY_MATCH', 'COST_VARIANCE', 'SCRAP_COST_REVIEW'], ['approve_payment', 'approve_scrap_value']),
  employee('APP-OPS-VIRTUAL-01', '应用运维虚拟员工', 'it', 'SPECIALIST', ['SERVICE_HEALTH', 'ERROR_TRIAGE', 'JOB_MONITOR'], ['restart_production_service', 'data_mutation']),
  employee('INFRA-VIRTUAL-01', '基础设施虚拟员工', 'it', 'SPECIALIST', ['HOST_HEALTH', 'NETWORK_MONITOR', 'CAPACITY_ALERT'], ['firewall_change', 'server_reboot']),
  employee('DATABASE-VIRTUAL-01', '数据库虚拟员工', 'it', 'SPECIALIST', ['DB_HEALTH', 'SLOW_QUERY', 'REPLICATION_MONITOR'], ['schema_change', 'restore_database', 'delete_data']),
  employee('INTEGRATION-VIRTUAL-01', '系统集成虚拟员工', 'it', 'SPECIALIST', ['API_MONITOR', 'SYNC_RETRY', 'CONTRACT_VALIDATE'], ['external_write', 'mapping_change']),
  employee('DATA-QUALITY-VIRTUAL-01', '数据质量虚拟员工', 'it', 'SPECIALIST', ['DUPLICATE_DETECT', 'MISSING_FIELD', 'CROSS_SYSTEM_RECONCILE'], ['master_data_merge', 'bulk_correction']),
  employee('SECURITY-VIRTUAL-01', '安全虚拟员工', 'it', 'SPECIALIST', ['ACCESS_AUDIT', 'SECRET_SCAN', 'ANOMALY_ALERT'], ['disable_account', 'rotate_secret']),
  employee('PDA-FLEET-VIRTUAL-01', 'PDA 设备群虚拟员工', 'it', 'SPECIALIST', ['DEVICE_HEARTBEAT', 'ROLE_CONFIG', 'APK_VERSION', 'PRINT_HEALTH'], ['remote_device_control', 'apk_rollout']),
  employee('BACKUP-VIRTUAL-01', '备份与恢复虚拟员工', 'it', 'SPECIALIST', ['BACKUP_VERIFY', 'RETENTION_MONITOR', 'RESTORE_DRILL'], ['production_restore', 'delete_backup']),
  employee('RELEASE-VIRTUAL-01', '发布虚拟员工', 'it', 'SPECIALIST', ['BUILD_VERIFY', 'MIGRATION_CHECK', 'ROLLOUT_MONITOR', 'ROLLBACK_PLAN'], ['production_deploy', 'database_migration']),
  employee('UI-DESIGN-QA-VIRTUAL-01', 'UI 设计与测试虚拟员工', 'it', 'SPECIALIST', ['VISUAL_AUDIT', 'RESPONSIVE_TEST', 'ACCESSIBILITY_CHECK', 'REGRESSION_TEST'], ['change_design_system', 'release_ui']),
  employee('ANDON-VIRTUAL-01', '安灯与换线虚拟员工', 'mes', 'SPECIALIST', ['ANDON_INTAKE','ESCALATION_TIMER','RESPONSE_ASSIGN','ROOT_CAUSE_LOG','LINE_EXCEPTION'], [], '', ''),
  employee('E-INVOICE-VIRTUAL-01', '电子发票虚拟员工', 'finance', 'SPECIALIST', ['INVOICE_DRAFT','TAX_CODE_CHECK','INVOICE_ISSUE','CREDIT_NOTE','INVOICE_ARCHIVE'], [], '', ''),
  employee('HR-VIRTUAL-01', '行政与人事主管虚拟员工', 'hr', 'SPECIALIST', ['EMPLOYEE_MASTER_DATA','ATTENDANCE_AUDIT','SHIFT_ROSTER','CERT_EXPIRY','GRIEVANCE_INTAKE','TRAINING_ASSIGN','WORKLOAD_BALANCE','GATE_PACKET_ASSEMBLE'], [], '', ''),
  employee('LINE-CADENCE-VIRTUAL-01', '自动线与手动线节拍虚拟员工', 'mes', 'PLACEHOLDER', ['CT_MEASURE','BALANCE_ANALYSIS','CHANGEOVER_MONITOR','CADENCE_ALERT'], [], '', ''),
  employee('MRB-VIRTUAL-01', '报废评审虚拟员工', 'quality', 'PLACEHOLDER', ['MRB_CONVENE','MRB_DISPOSITION_DRAFT','COST_TAG','REPEAT_DEFECT_FLAG'], [], '', ''),
  employee('OQC-VIRTUAL-01', '出货检验虚拟员工', 'quality', 'SPECIALIST', ['OQC_AQL_PLAN','SHIPMENT_SAMPLE','DEFECT_CLASSIFY','OQC_DISPOSITION','PACKING_AUDIT'], [], '', ''),
  employee('PACK-VIRTUAL-01', '包装与出货虚拟员工', 'mes', 'SPECIALIST', ['PACK_LIST_VALIDATE','CARTON_LABEL_PLAN','OUTBOUND_SCAN','SHIPMENT_HOLD','SERIAL_EXPORT_PACK'], [], '', ''),
  employee('REPAIR-VIRTUAL-01', '维修与返工虚拟员工', 'maintenance', 'SPECIALIST', ['REWORK_ROUTE','REWORK_LIMIT_CHECK','RETEST_PLAN','DISPOSITION_APPLY','DOWNTIME_RECORD'], [], '', ''),
  employee('REPORTS-VIRTUAL-01', '指标与看板虚拟员工', 'it', 'SPECIALIST', ['METRIC_DICT','KPI_DEFINITION','DASHBOARD_AUDIT','DATA_LINEAGE','ADHOC_QUERY','KPI_MONITOR','REPORT_DISTRIBUTE'], [], '', ''),
  employee('SAFETY-VIRTUAL-01', '安全虚拟员工', 'hr', 'SPECIALIST', ['HAZARD_INTAKE','SAFETY_ROUND','INCIDENT_REPORT','PPE_AUDIT','DRILL_SCHEDULE'], [], '', ''),
  employee('SALES-VIRTUAL-01', '销售订单与交期虚拟员工', 'finance', 'SPECIALIST', ['ORDER_INTAKE','ATP_CHECK','DELIVERY_REPLY','CHANGE_ORDER_NOTICE'], [], '', ''),
  employee('SMT-LOOP-VIRTUAL-01', 'SMT 上料与料盘消耗虚拟员工', 'mes', 'SPECIALIST', ['FEEDER_LOADING','REEL_CONSUME','SPLICING_TRACE','JOINT_VALIDATE','MISSING_PART_ALERT','LOADING_PLAN_DRAFT'], [], '', ''),
  employee('SPARE-PARTS-VIRTUAL-01', '备件虚拟员工', 'maintenance', 'PLACEHOLDER', ['PARITY_LEVEL','CONSUME_FORECAST','STOCKOUT_ALERT','SPARE_LEAD_TRACK'], [], '', ''),
  employee('STATION-EQUIP-VIRTUAL-01', '站机群虚拟员工', 'maintenance', 'SPECIALIST', ['STATION_CONFIG_AUDIT','PROGRAM_VERSION_CHECK','EQUIP_INTERLOCK','TORQUE_DATA_TRACE','STATION_HEARTBEAT'], [], '', ''),
  employee('SUPPLIER-CLAIM-VIRTUAL-01', '退货与索赔虚拟员工', 'pmc', 'PLACEHOLDER', ['CLAIM_DRAFT','EVIDENCE_PACKAGE','CREDIT_NOTE_TRACK','IQC_FEEDBACK'], [], '', ''),
  employee('SUPPLIER-DEBT-VIRTUAL-01', '供应商欠款虚拟员工', 'finance', 'PLACEHOLDER', ['DEBT_AGING','PAYMENT_PLAN_DRAFT','OVERDUE_ESCALATE','TERMS_CHECK'], [], '', ''),
  employee('TRACE-VIRTUAL-01', '追溯与 ECN 虚拟员工', 'quality', 'SPECIALIST', ['SERIAL_TRACE','RECALL_SCOPE','ECN_TRACE','CUSTOMER_IMPACT_LIST','RETENTION_PURGE_PROPOSE','QR_TRACE'], [], '', ''),
  employee('WMS-COUNT-VIRTUAL-01', '循环盘点虚拟员工', 'wms', 'SPECIALIST', ['COUNT_PLAN','COUNT_SHEET','CYCLE_COUNT','VARIANCE_ANALYSIS','RECOUNT_REQUEST'], [], '', ''),
  employee('WMS-IQC-HANDOFF-VIRTUAL-01', '来料交接虚拟员工', 'wms', 'SPECIALIST', ['IQC_SUBMIT','IQC_HANDOFF','HOLD_ENFORCE','HANDOFF_RECEIPT','SAMPLE_WITNESS'], [], '', ''),
  employee('WMS-ISSUE-VIRTUAL-01', '发料与线边配送虚拟员工', 'wms', 'SPECIALIST', ['KIT_PICK','FOFO_ALLOC','LINE_FEED','ISSUE_CONFIRM','SHORTAGE_ESCALATE','KANBAN_REFRESH','DISTRIBUTION_SLA_MONITOR'], [], '', ''),
  employee('WMS-SUPERVISOR-VIRTUAL-01', '来料与仓储虚拟主管', 'wms', 'COORDINATOR', ['SUPERVISE_INTAKE','INBOUND_ARBITRATION','WORKLOAD_BALANCE','GATE_PACKET_ASSEMBLE','EXCEPTION_ROUTE','KPI_MONITOR','SHIFT_HANDOVER','OVERDUE_ESCALATE'], [], '', ''),
]);

function employee(id, name, domain, level, capabilities, humanGates, jobDescription = '', promptProfile = '') {
  return {
    id, name, domain, level, capabilities, humanGates: humanGates.length ? humanGates : (gatesFor(id) || []), jobDescription, promptProfile,
    // Capability contract (see capabilities.js): skill ids resolve through the
    // catalog, MCP servers are the union of what those skills need plus this
    // employee's own memory namespace. Previously `skills` was a one-off literal
    // for the UI role only.
    skills: skillsFor(id) || [],
    mcpServers: mcpFor(id) || [],
    // The org chart marks seven positions as placeholders
    // (ve_reporting_lines.enabled = false); the code registry mirrors that
    // instead of claiming all 44 positions are active.
    enabled: !['DATA-QUALITY-VIRTUAL-01', 'UI-DESIGN-QA-VIRTUAL-01', 'LINE-CADENCE-VIRTUAL-01', 'MRB-VIRTUAL-01', 'SPARE-PARTS-VIRTUAL-01', 'SUPPLIER-CLAIM-VIRTUAL-01', 'SUPPLIER-DEBT-VIRTUAL-01'].includes(id),
    mode: id === 'IQC-VIRTUAL-01' ? 'ACTIVE_EXECUTOR' : 'GOVERNED_SCAFFOLD',
    status: 'IDLE',
    policy: { readAllowed: true, draftAllowed: true, externalWriteRequiresApproval: true, destructiveActionDenied: true },
  };
}

export function getFactoryVirtualEmployee(id) {
  return FACTORY_VIRTUAL_EMPLOYEES.find(item => item.id === String(id || '').toUpperCase()) || null;
}
