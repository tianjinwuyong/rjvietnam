BEGIN;
CREATE TABLE IF NOT EXISTS api_domain_rules(
  id BIGSERIAL PRIMARY KEY,domain_code VARCHAR(32) NOT NULL,prefix VARCHAR(100) NOT NULL UNIQUE,
  owner_department VARCHAR(100) NOT NULL,data_authority VARCHAR(20) NOT NULL CHECK(data_authority IN('SYSTEM_OF_RECORD','EXECUTION','READ_MODEL','INTEGRATION')),
  audit_level VARCHAR(16) NOT NULL CHECK(audit_level IN('NORMAL','IMPORTANT','CRITICAL')),
  description TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO api_domain_rules(domain_code,prefix,owner_department,data_authority,audit_level,description)VALUES
('PMC','/pmc','生产计划与物料控制部','SYSTEM_OF_RECORD','IMPORTANT','需求、计划、工单、排产和交期'),
('MES','/mes','制造执行管理','SYSTEM_OF_RECORD','CRITICAL','生产执行、工艺路线和SN'),
('WMS','/wms','仓储管理部','SYSTEM_OF_RECORD','CRITICAL','库存、收发料和库位'),
('STATION','/api/station','生产工站','EXECUTION','CRITICAL','现场扫描、测试和工站行为'),
('QUALITY','/quality','品质管理部','SYSTEM_OF_RECORD','CRITICAL','检验、冻结、放行和质量结论'),
('MAINTENANCE','/maintenance','设备与维修部门','SYSTEM_OF_RECORD','IMPORTANT','设备和维修工单'),
('HR','/hr','人力资源部','SYSTEM_OF_RECORD','CRITICAL','员工、考勤、薪资和人事事项'),
('FINANCE','/finance','财务部','SYSTEM_OF_RECORD','CRITICAL','成本、凭证和财务结算'),
('SALES','/sales','销售部','SYSTEM_OF_RECORD','IMPORTANT','客户、订单和交付承诺'),
('ADMIN','/admin','系统管理','SYSTEM_OF_RECORD','CRITICAL','权限、配置和审计'),
('INTEGRATION','/api/integration','系统集成','INTEGRATION','CRITICAL','跨域数据接力'),
('REPORTING','/reports','报表中心','READ_MODEL','NORMAL','只读报表'),
('AUTH','/api/auth','系统安全','SYSTEM_OF_RECORD','CRITICAL','认证与令牌'),
('CORE','/api','核心平台','INTEGRATION','IMPORTANT','尚未迁移到专用域的核心接口'),
('CORE','/','核心平台','INTEGRATION','NORMAL','默认分类，禁止无域接口')
ON CONFLICT(prefix) DO UPDATE SET domain_code=EXCLUDED.domain_code,owner_department=EXCLUDED.owner_department,
data_authority=EXCLUDED.data_authority,audit_level=EXCLUDED.audit_level,description=EXCLUDED.description;
INSERT INTO _migrations(filename,hash)VALUES('190_api_domain_governance.sql','api-domain-governance-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
