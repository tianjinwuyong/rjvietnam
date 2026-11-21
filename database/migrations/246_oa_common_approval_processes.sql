WITH items(process_code,process_name,entity_type) AS (VALUES
 ('HR-LEAVE','请假申请','HR_LEAVE'),('HR-OVERTIME','加班申请','HR_OVERTIME'),('HR-BUSINESS-TRIP','出差申请','HR_BUSINESS_TRIP'),
 ('HR-HIRING','招聘申请','HR_HIRING'),('HR-RESIGNATION','离职申请','HR_RESIGNATION'),('HR-SALARY-CHANGE','调薪申请','HR_SALARY_CHANGE'),
 ('PROCUREMENT-REQUEST','采购申请','PROCUREMENT_REQUEST'),('PURCHASE-ORDER','采购订单审批','PURCHASE_ORDER'),('CONTRACT-APPROVAL','合同审批','CONTRACT'),
 ('SUPPLIER-ONBOARDING','供应商准入','SUPPLIER_ONBOARDING'),('SUPPLIER-PAYMENT','供应商付款','SUPPLIER_PAYMENT'),
 ('FIN-EXPENSE','费用报销','FIN_EXPENSE'),('FIN-PAYMENT','付款申请','FIN_PAYMENT'),('FIN-CAPEX','固定资产/资本支出','FIN_CAPEX'),('FIN-WRITEOFF','资产及库存核销','FIN_WRITEOFF'),
 ('WMS-MATERIAL-REQUISITION','物料取料审批','WMS_REQUISITION'),('WMS-INVENTORY-ADJUSTMENT','库存调整','WMS_INVENTORY_ADJUSTMENT'),
 ('WMS-MATERIAL-SCRAP','物料报废','WMS_MATERIAL_SCRAP'),('WMS-SUPPLIER-RETURN','退供应商','WMS_SUPPLIER_RETURN'),
 ('QUALITY-MRB','MRB物料评审','QUALITY_MRB'),('QUALITY-DEVIATION','质量偏差/特采','QUALITY_DEVIATION'),('QUALITY-CAPA','CAPA关闭审批','QUALITY_CAPA'),
 ('ENGINEERING-CHANGE','工程变更 ECN','ENGINEERING_CHANGE'),('BOM-CHANGE','BOM变更','BOM_CHANGE'),('PROCESS-CHANGE','工艺变更','PROCESS_CHANGE'),
 ('PRODUCTION-EXCEPTION','生产异常放行','PRODUCTION_EXCEPTION'),('WORK-ORDER-CHANGE','工单变更','WORK_ORDER_CHANGE'),
 ('EHS-HOT-WORK','动火作业许可','EHS_HOT_WORK'),('EHS-LOTO','上锁挂牌作业许可','EHS_LOTO'),('EHS-CHEMICAL','化学品导入/使用','EHS_CHEMICAL'),('EHS-WASTE','危险废物处置','EHS_WASTE'),
 ('IT-ACCESS','系统权限申请','IT_ACCESS'),('IT-CHANGE','IT系统变更','IT_CHANGE'),('IT-EQUIPMENT','IT设备申请','IT_EQUIPMENT'),
 ('GENERAL-SEAL','印章使用','GENERAL_SEAL'),('GENERAL-DOCUMENT','受控文件发布','GENERAL_DOCUMENT'),('GENERAL-VISITOR','访客/外来施工','GENERAL_VISITOR')
)
INSERT INTO oa_process_definitions(process_code,process_name,entity_type,created_by)
SELECT process_code,process_name,entity_type,'SYSTEM' FROM items
ON CONFLICT(process_code) DO UPDATE SET process_name=EXCLUDED.process_name,entity_type=EXCLUDED.entity_type,updated_at=now();

WITH defaults(process_code,signer_username,signer_name,signer_role,sla_hours) AS (VALUES
 ('HR-LEAVE','PMC_CN_01','直属主管','department_manager',8),('HR-OVERTIME','PMC_CN_01','直属主管','department_manager',8),('HR-BUSINESS-TRIP','PMC_CN_01','部门经理','department_manager',8),
 ('HR-HIRING','PMC_CN_01','部门经理','department_manager',24),('HR-RESIGNATION','PMC_CN_01','部门经理','department_manager',24),('HR-SALARY-CHANGE','PMC_CN_01','部门经理','department_manager',24),
 ('PROCUREMENT-REQUEST','PMC_CN_01','需求部门经理','department_manager',8),('PURCHASE-ORDER','PMC_CN_01','采购经理','purchasing_manager',8),('CONTRACT-APPROVAL','PMC_CN_01','合同负责人','contract_owner',24),
 ('SUPPLIER-ONBOARDING','QC_VN_01','质量经理','quality_manager',24),('SUPPLIER-PAYMENT','FIN_VN_001','财务经理','finance_manager',8),
 ('FIN-EXPENSE','FIN_VN_001','财务审核','finance_manager',8),('FIN-PAYMENT','FIN_VN_001','财务经理','finance_manager',8),('FIN-CAPEX','FIN_VN_001','财务经理','finance_manager',24),('FIN-WRITEOFF','FIN_VN_001','财务经理','finance_manager',24),
 ('WMS-MATERIAL-REQUISITION','PMC_CN_01','PMC审批人','pmc_manager',8),('WMS-INVENTORY-ADJUSTMENT','VN_WH_001','仓库主管','warehouse_manager',8),
 ('WMS-MATERIAL-SCRAP','QC_VN_01','质量经理','quality_manager',8),('WMS-SUPPLIER-RETURN','VN_WH_001','仓库主管','warehouse_manager',8),
 ('QUALITY-MRB','QC_VN_01','质量经理','quality_manager',8),('QUALITY-DEVIATION','QC_VN_01','质量经理','quality_manager',8),('QUALITY-CAPA','QC_VN_01','质量经理','quality_manager',24),
 ('ENGINEERING-CHANGE','PMC_CN_01','工程经理','engineering_manager',24),('BOM-CHANGE','PMC_CN_01','工程经理','engineering_manager',24),('PROCESS-CHANGE','PMC_CN_01','工程经理','engineering_manager',24),
 ('PRODUCTION-EXCEPTION','PMC_CN_01','生产经理','production_manager',8),('WORK-ORDER-CHANGE','PMC_CN_01','PMC经理','pmc_manager',8),
 ('EHS-HOT-WORK','PMC_CN_01','EHS负责人','ehs_manager',4),('EHS-LOTO','PMC_CN_01','EHS负责人','ehs_manager',4),('EHS-CHEMICAL','PMC_CN_01','EHS负责人','ehs_manager',24),('EHS-WASTE','PMC_CN_01','EHS负责人','ehs_manager',24),
 ('IT-ACCESS','PMC_CN_01','IT管理员','it_manager',8),('IT-CHANGE','PMC_CN_01','IT经理','it_manager',24),('IT-EQUIPMENT','PMC_CN_01','IT管理员','it_manager',8),
 ('GENERAL-SEAL','PMC_CN_01','行政负责人','admin_manager',8),('GENERAL-DOCUMENT','PMC_CN_01','文控负责人','document_controller',24),('GENERAL-VISITOR','PMC_CN_01','行政负责人','admin_manager',4)
)
INSERT INTO oa_process_signature_steps(process_id,step_no,signer_username,signer_name,signer_role,sla_hours,created_by)
SELECT p.id,1,d.signer_username,d.signer_name,d.signer_role,d.sla_hours,'SYSTEM' FROM defaults d JOIN oa_process_definitions p USING(process_code)
WHERE NOT EXISTS(SELECT 1 FROM oa_process_signature_steps s WHERE s.process_id=p.id AND s.active=true);

INSERT INTO _migrations(filename,hash) VALUES('246_oa_common_approval_processes.sql','oa-common-approval-processes-v1') ON CONFLICT(filename) DO NOTHING;
