export const FACTORY_VIRTUAL_EMPLOYEES = Object.freeze([
  employee('OPS-SUPERVISOR-VIRTUAL-01', '全厂运营虚拟主管 Hermes', 'cmd', 'SUPERVISOR', ['FACTORY_PATROL', 'KPI_MONITOR', 'EXCEPTION_ROUTE', 'CROSS_DOMAIN_COORDINATION', 'APPROVAL_COORDINATION', 'SHIFT_HANDOVER', 'WECHAT_NOTIFY'], ['release_inventory', 'approve_scrap', 'change_po', 'stop_line', 'approve_payment', 'final_iqc_decision'], '统一管理虚拟员工，验证事实、分配唯一主责、协调跨部门交接、跟踪时限并升级异常；不替代专业岗位或人工审批。', 'HERMES_OPS_SUPERVISOR_V1'),
  employee('WMS-RECEIVING-VIRTUAL-01', 'WMS 收料虚拟员工', 'wms', 'SPECIALIST', ['RECEIVING_VALIDATE', 'LABEL_PLAN', 'HIDDEN_PALLET_BIND', 'LOCATION_BIND', 'IQC_HANDOFF'], ['receive_variance', 'inventory_release'], '确保 PDA 收集的真实箱数据完成 PO 核对、MSL 解析、箱 QR 打印、仓位绑定并进入 IQC HOLD。'),
  employee('IQC-VIRTUAL-01', 'IQC 虚拟检验员', 'quality', 'SPECIALIST', ['IQC_QUEUE_SCAN', 'SUPPLIER_HISTORY', 'SAMPLE_CALCULATION', 'DYNAMIC_PDA_PLAN', 'EVIDENCE_REVIEW'], ['final_iqc_decision', 'exemption', 'supplier_suspension']),
  employee('WMS-INVENTORY-VIRTUAL-01', 'WMS 安全库存虚拟员工', 'wms', 'SPECIALIST', ['INVENTORY_RECONCILE', 'FIFO_FEFO', 'LOCATION_OPTIMIZE', 'PUTAWAY_RECOMMEND', 'CYCLE_COUNT', 'SAFETY_STOCK_REPORT'], ['inventory_adjustment', 'material_scrap', 'override_putaway_rule'], '依据库存流水监控最低库存和安全库存，推荐新到货的合理库位，并定期向采购、PMC与Hermes提交报告；只建议库位，不自行调整库存或绕过隔离规则。'),
  employee('MSD-CONTROL-VIRTUAL-01', '湿敏物料控制虚拟员工', 'wms', 'SPECIALIST', ['MSL_MAP', 'FLOOR_LIFE', 'BAKING_ALERT', 'EXPOSURE_TRACE'], ['override_msl', 'release_expired_material']),
  employee('PMC-VIRTUAL-01', 'PMC 计划虚拟员工', 'pmc', 'COORDINATOR', ['MPS_PLAN', 'MRP_CALCULATE', 'SHORTAGE_ALERT', 'DELIVERY_RISK'], ['commit_delivery', 'change_frozen_plan']),
  employee('PURCHASING-VIRTUAL-01', '采购与 PO 管理虚拟员工', 'procurement', 'SPECIALIST', ['PO_MONITOR', 'REPLENISHMENT_REVIEW', 'SUPPLIER_FOLLOWUP', 'ASN_MONITOR', 'ETA_ATA_TRACKING', 'PALLET_LOGISTICS', 'QR_TRACE', 'DELIVERY_EXCEPTION', 'PO_ADJUSTMENT_DRAFT'], ['approve_po', 'change_price', 'change_quantity'], '执行采购 SOP，接收安全库存报告并形成补货建议，监控 PO、供应商确认、ASN、ETA/ATA、托盘物流和全部 QR；所有高风险变更保留人工审批。'),
  employee('OA-DOCUMENT-CONTROL-VIRTUAL-01', 'OA 文控协调虚拟员工', 'oa', 'COORDINATOR', ['DOCUMENT_CLASSIFY', 'ROUTE_ASSIGN', 'APPROVAL_TRACE', 'SLA_MONITOR', 'REMINDER_SEND', 'OVERDUE_ESCALATE', 'WECHAT_NOTIFY', 'LICENSE_CHECK', 'CONTROLLED_PUBLISH'], ['approve_document', 'skip_required_step', 'publish_without_approval', 'external_distribution'], '为所有受控文件匹配明确审批路线，逐节点追踪时限、催办与升级，核验版本、来源和授权，并在全部人工审批完成后执行发布检查；不得替代任何人工批准。'),
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
]);

function employee(id, name, domain, level, capabilities, humanGates, jobDescription = '', promptProfile = '') {
  return {
    id, name, domain, level, capabilities, humanGates, jobDescription, promptProfile,
    skills: id === 'UI-DESIGN-QA-VIRTUAL-01' ? [
      'emil-design-eng',
      'prototype',
      'pick-ui-library',
      'find-animation-opportunities',
      'animate',
      'review-animations',
      'improve-animations',
      'ask-sonner',
      'animation-vocabulary',
    ] : [],
    enabled: true,
    mode: id === 'IQC-VIRTUAL-01' ? 'ACTIVE_EXECUTOR' : 'GOVERNED_SCAFFOLD',
    status: 'IDLE',
    policy: { readAllowed: true, draftAllowed: true, externalWriteRequiresApproval: true, destructiveActionDenied: true },
  };
}

export function getFactoryVirtualEmployee(id) {
  return FACTORY_VIRTUAL_EMPLOYEES.find(item => item.id === String(id || '').toUpperCase()) || null;
}
