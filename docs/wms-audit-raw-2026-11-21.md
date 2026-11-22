### receiving
API: GET 200[HTML!] /wms/receiving-queue
TABLES: 0r[批次/物料/QR单据/栈板QR] 1r[采购单号/物料/供应商/数量]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 扫描条码收料 必须使用已批准的入库单；系统自动核销单据数量 0 待检 确认收料 接口 /wms/receiving-queue 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 已绑定物料清单 QR绑

### returnReceive
API: GET 200[HTML!] /wms/material-lots?limit=200
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 产线退料 将物料从产线退回到仓库 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### supplierReturn
API: GET 200[HTML!] /wms/material-lots?iqcStatus=rejected&limit=200 ; GET 200[HTML!] /wms/material-lots?iqcStatus=hold&limit=200
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 退供应商 将不良品退回给供应商 无不合格批次 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### salesReturn
API: (none)
TABLES: 0r[退料单号/客户/物料/数量]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 销售退货 将物料从产线退回到仓库 wms.newReturn 退料记录 退料单号 客户 物料 数量 退料原因 日期 状态 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### inboundOrders
API: GET 200[HTML!] /wms/inbound?pageSize=50
TABLES: -
BANNER: 接口 /wms/inbound?pageSize=50 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 全部状态 DRAFT SUBMITTED APPROVED EXECUTING COMPLETED REJECTED CANCELLED 共 0 条 接口 /wms/inbound?pageSize=50 返回了网页 HTML，而

### poReceipt
API: GET 200[HTML!] /wms/receiving/qr-bindings ; GET 200[HTML!] /wms/receiving/pre-iqc ; GET 200[HTML!] /qms/iqc/guidance-documents
TABLES: 1r[标记/Material SN/越南料号/Supplier Code]
BANNER: 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 PO采购到货 收货后生成QR单据，绑定待检仓位并进入IQC。 返回来源页面 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 前IQC管理 

### qrBinding
API: (none)
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 QR绑定仓库 生成系统QR收货单，将物料批次绑定到指定待检仓位。 返回来源页面 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 收货并生成

### materialLoading
API: GET 200 /api/smt/loading/records?limit=200 ; GET 304 /api/smt/loading/records?limit=200
TABLES: 0r[绑定时间/工单/机台/槽位]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 PDA 上料追溯 MES 权威记录 · 所有扫码绑定永久保存 刷新 全部绑定 0 当前有效 0 今日绑定 0 进行中工单 0 绑定总数量 0 全部 状态 Active Replaced Unbound 搜索工单、机台、槽位、Fee

### syncHealth
API: GET 200[HTML!] /wms/mes-exchange/events?state=ALL&limit=500 ; GET 200[HTML!] /wms/mes-exchange/conflicts?status=PENDING
TABLES: 1r[ID/事件/时间/处理] 1r[事件/对象/流向/状态]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 多PDA实时收料 WMS 分配收料设备，支持最多 5 台 PDA 并行收料。 角色：收料员 PDA-RECV-01 ONLINE 角色：收料员 当前批次：等待扫描 收料员：待分配 最后心跳：— PDA-RECV-02 OFFLIN

### iqc
API: GET 200[HTML!] /qms/iqc/virtual-employee/tasks ; GET 200[HTML!] /qms/iqc/guidance-documents ; GET 200[HTML!] /wms/pda-inspection-records?recordType=IQC&limit=100 ; GET 200[HTML!] /wms/receiving/qr-bindings ; GET 403 /api/wms/incoming?iqc_status=pending&limit=200 ; GET 403 /api/wms/iqc/inspections?limit=200
TABLES: -
BANNER: 员工通讯异常：接口 /qms/iqc/virtual-employee/tasks 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC-VIRTUAL-01 · IQC 检验专员 正在重新连接 · 扫描待检队列 立即检查 IQC 正在重新连接 虚拟员

### iqcClosedLoop
API: GET 200[HTML!] /quality/iqc-loop/dashboard
TABLES: 1r[Lot/Supplier/Material/Qty] 1r[Document/Type/Qty/Destination] 1r[CAPA/Supplier/Severity/Status]
BANNER: 接口 /quality/iqc-loop/dashboard 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC 物料管理闭环 收货建批 → 风险抽样 → 原始测量 → 质量判定 → 数量分流 → 供应商整改 → 受控关单 刷新

### iqcDefectLoop
API: GET 200[HTML!] /wms/receiving/qr-bindings
TABLES: 1r[ID/Document / case/Lot/Source / status]
BANNER: 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC defect closed loop Receiving todo -> system QR document -

### iqcInspectionLevels
API: GET 200[HTML!] /qms/iqc/inspection-levels ; GET 200[HTML!] /qms/iqc/inspection-level-events ; GET 200[HTML!] /qms/iqc/inspection-manual-events ; GET 200[HTML!] /qms/iqc/guidance-documents
TABLES: 1r[文件/版本/状态/导入时间] 1r[供应商/物料/等级/计数器] 1r[日期/供应商/物料/批次] 1r[日期/供应商/物料/动作]
BANNER: 接口 /qms/iqc/inspection-level-events 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC检验等级与人工决策 系统自动计算批次规则，人工审批受权限控制。 刷新 接口 /qms/iqc/inspection-

### iqcReport
API: (none)
TABLES: 0r[供应商/wms.totalInspections/wms.passCount/合格率]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC报告 wms.iqcReportDesc ~ wms.totalInspections 0 合格率 0.0% wms

### iqcStandards
API: GET 200[HTML!] /wms/iqc/plans
TABLES: 1r[编码/物料/common.version/wms.testItem]
BANNER: 接口 /wms/iqc/plans 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC 标准 wms.iqcStandardsDesc 刷新 接口 /wms/iqc/plans 返回了网页 HTML，而

### iqcTemplates
API: GET 200[HTML!] /wms/iqc-templates
TABLES: 1r[模板编号/模板名称/版本/包装AQL]
BANNER: 接口 /wms/iqc-templates 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC 检验模板库 原 WMS 的检验报告模板（包装/外观/尺寸/可靠性/环境），点一行看检验项。 接口 /wms/iqc

### iqcPassMaintenance
API: GET 200[HTML!] /wms/receiving/qr-bindings
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC合格结果维护 维护IQC结果；合格后解除QR绑定并转入良品仓库。 返回来源页面 接口 /wms/receiving/

### defectArchive
API: GET 200[HTML!] /quality/iqc-defect-cases
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /quality/iqc-defect-cases 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC不良品档案 建立不良品档案，并记录从栈板移除。 返回来源页面 接口 /quality/iqc-defect-case

### iqcReinspection
API: GET 200[HTML!] /quality/iqc-reinspections
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /quality/iqc-reinspections 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC复检档案 建立复检档案，完成PASS/FAIL判定；PASS后重新建立有效期记录。 返回来源页面 接口 /quali

### pdaIqc
API: GET 200[HTML!] /wms/pda-inspection-records?recordType=IQC&limit=100
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 PDA IQC 检查 PDA 设备 ID PDA-5EC13D8F IQC 检验员 待填写 工作设备 1 / 5 台 1 

### rjvnIqc
API: GET 200[HTML!] /rjvn-iqc/stats ; GET 200[HTML!] /rjvn-iqc/strictness/list?limit=100 ; GET 200[HTML!] /rjvn-iqc/pending?limit=50 ; GET 200[HTML!] /rjvn-iqc/strictness/transfer-logs?limit=50
TABLES: -
BANNER: 接口 /rjvn-iqc/stats 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 待检清单 严格度转移 + 抽样方案 + 判定规则，来自 D:\rj\rjvn\WMS-20261019 可写入判定 接口 

### qualityTrend
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 质量趋势 wms.qualityTrendDesc wms.allCategories wms.overallPassRa

### graftOps
API: GET 200 /api/wms/iqc/pending?limit=100 ; GET 200 /api/wms/picking-orders ; GET 200 /api/wms/count/open?limit=50 ; GET 200 /api/wms/inventory/stock-summary ; GET 200 /api/wms/inventory-expiry/by-material ; GET 304 /api/wms/inventory/stock-summary
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 移植作业台 IQC 判定 / 领料审批拣料接收 / 盘点确认 / 库存导出 / 有效期延期 —— 全部落到真实数据表 IQ

### inventoryControl
API: GET 200[HTML!] /wms/material-lots?limit=500 ; GET 200[HTML!] /wms/storage-locations?limit=500 ; GET 200[HTML!] /wms/inventory-transactions?limit=500
TABLES: 0r[物料/批次/数量/库位]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 库存控制中心 统一管理数量、位置、状态、交易台账和处理时限。 打开3D流程 0批次数 0可用数量 0库位数 0超时待处理 交易台账 盘点 调拨/调整 按库位查看数量 当前批次余额和流程状态 0 条台账记录 物料 

### rjvnInventory
API: GET 200[HTML!] /rjvn-inventory/list?limit=50 ; GET 200[HTML!] /rjvn-inventory/list?stockStatus=locked&limit=1 ; GET 200[HTML!] /rjvn-inventory/summary ; GET 200[HTML!] /rjvn-inventory/transactions?limit=50 ; GET 200[HTML!] /rjvn-inventory/transfers?limit=50
TABLES: -
BANNER: 接口 /rjvn-inventory/list?stockStatus=locked&limit=1 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 库存查询 移库 / 盘点调整 / 锁定解锁，含库存流水（来自 inventory.service.ts） 接口 /rjvn-inventory/list?stockStatus=locked&limit=1 返回

### cycleCount
API: GET 200[HTML!] /wms/material-lots?limit=500
TABLES: 0r[库位/批次数量/总数量/操作]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 库存盘点 按库位清点实际库存 选择库位 选择目标库位上架 库位 批次数量 总数量 操作 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### transferAdjust
API: GET 200[HTML!] /wms/inventory-transactions?limit=100
TABLES: 0r[wms.txNo/日期/动作/物料]
BANNER: 接口 /wms/inventory-transactions?limit=100 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 移库调整 最近的收料/发料/退料/报废事务 wms.transfer wms.adjust wms.doTransfer wms.confirmTransfer 接口 /wms/inventory-transac

### expiryControl
API: GET 200[HTML!] /wms/inventory-expiry
TABLES: 0r[物料/批次/接收日期/到期日期]
BANNER: 接口 /wms/inventory-expiry 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 超期管控 有效期监控 wms.expired ≤7d ≤30d OK 接口 /wms/inventory-expiry 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 wms.ex

### lifecycle
API: GET 200 /api/lifecycle/lots?limit=200 ; GET 200 /api/lifecycle/summary ; GET 304 /api/lifecycle/lots?limit=200 ; GET 304 /api/lifecycle/summary
TABLES: 200r[批次号/物料编码/物料名称/物料类型]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 物料有效期管控台账 仓库电子元器件寿命管参考 · 5 Sheet 完整集成 · 数据来源: PostgreSQL v_material_lifecycle ① 台账 ② 预警清单 ③ 复检报告 ④ 开封记录 ⑤ 

### fifoMonitor
API: GET 200[HTML!] /wms/material-lots?limit=500
TABLES: 0r[物料/wms.totalLots/FIFO顺序/wms.violations]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 FIFO监控 库存预警 wms.checkFifo wms.totalLots 0 wms.fifoViolations 0 wms.complianceRate 100% wms.lastChecked 202

### fifoSimulation
API: GET 200[HTML!] /wms/material-lots?limit=200
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 FIFO 模拟 — 物料跟进 先入先出模拟：输入物料和需求数量，系统自动按接收日期从老到新分配批次 1 收料 2 贴标 3 IQC 4 放行 5 上架 6 拣货 7 发料到产线 物料编码 — 请选择 — 需求数量

### defectiveMove
API: GET 200 /api/defective-move/list?page=1&pageSize=20 ; GET 200 /api/defective-move/pending-count ; GET 200 /api/defective-move/locations ; GET 304 /api/defective-move/list?page=1&pageSize=20 ; GET 304 /api/defective-move/pending-count ; GET 304 /api/defective-move/locations
TABLES: 7r[转移单号/库存ID/物料编码/物料]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 不良品移库 不良品转移管理 全部 待确认 待处理 已完成 已取消 新建不良品转移 转移列表 转移单号 库存ID 物料编码 物料 数量 单位 原因 来源库存状态 目标库位 状态 创建时间 操作 DM20261120

### transactions
API: GET 200[HTML!] /wms/inventory-transactions?limit=200
TABLES: -
BANNER: 错误: 接口 /wms/inventory-transactions?limit=200 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 错误: 接口 /wms/inventory-transactions?limit=200 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 WMS-INVENTORY-VIRTUAL

### batchManagement
API: GET 200[HTML!] /wms/material-lots?limit=500
TABLES: 1r[#/物料编码/物料名称/批次号]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 批次/序列号管理 基础数据 0 / 0 lots All IQC Status Pending Hold Released Rejected # 物料编码 物料名称 批次号 供应商 库存数量 Reserved 物

### locationManagement
API: GET 200 /api/3d/wms-layout ; GET 200[HTML!] /wms/storage-locations?limit=500 ; GET 200 /api/3d/wms-control-state ; GET 200[HTML!] /wms/stock?limit=1000 ; GET 200[HTML!] /wms/receiving/pallet-box-bindings/box-counts
TABLES: 1r[#/物料编码/物料名称/Type]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 库位精细化管理 基础数据 0 / 0 locations 新增库位 打印全部仓位 QR All Areas FL-FG-01 FL-IQC-01 FL-IQC-NG FL-IQC-PASS FL-LINE-04 

### requisitions
API: GET 200[HTML!] /wms/requisition?pageSize=50
TABLES: -
BANNER: 接口 /wms/requisition?pageSize=50 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 全部状态 DRAFT SUBMITTED APPROVED EXECUTING COMPLETED REJECTED CANCELLED

### slips
API: GET 200[HTML!] /wms/slips ; GET 200[HTML!] /wms/picking-status ; GET 200[HTML!] /wms/shortages ; GET 200[HTML!] /wms/collect-activity?limit=30
TABLES: -
BANNER: 接口 /wms/slips 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 发料 / 收料单据 全部发料与收料过程留痕 · 记录发料人（集料）与收料人（产线接料）及时间 流程总览图 发料单（仓库集料） (0) 收

### materialDistribution
API: GET 200[HTML!] /wms/fetch-packages?limit=200
TABLES: 0r[PO/领料单/物料/批次]
BANNER: 接口 /wms/fetch-packages?limit=200 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 物料配送控制台 配送电子单由领料、审批、交接和签收活动自动生成 导出配送电子表 刷新 全部状态 PREPARED HANDED_OVER

### woHandover
API: (none)
TABLES: 1r[/工单/物料/批次] 1r[签收时间/物料/批次/数量]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 工单物料交接 (仓库 → 产线) 工单已发料但尚未由产线签收的物料；填入领料人/线长工号，提交后写入 wms_wo_handover 审

### outboundOrders
API: GET 200[HTML!] /wms/outbound?pageSize=50
TABLES: -
BANNER: 接口 /wms/outbound?pageSize=50 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 全部状态 DRAFT SUBMITTED APPROVED EXECUTING COMPLETED REJECTED CANCELLED

### returnSlips
API: GET 200[HTML!] /wms/return?pageSize=50
TABLES: -
BANNER: 接口 /wms/return?pageSize=50 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 全部状态 DRAFT SUBMITTED EXECUTING COMPLETED REJECTED CANCELLED 共 0 条 接口

### replenishments
API: GET 200[HTML!] /wms/replenishment?pageSize=50
TABLES: 1r[物料/需求/可用/短缺] 1r[物料/需求/发料/消耗] 0r[补料单/工单号/原领料单/状态]
BANNER: 接口 /wms/replenishment?pageSize=50 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 补料与工单物料对账 补料必须引用原始领料单；差异必须说明并审批 刷新 查询 接口 /wms/replenishment?pageSize

### overPicking
API: GET 200 /api/over-picking/list?page=1&pageSize=20 ; GET 304 /api/over-picking/list?page=1&pageSize=20
TABLES: 5r[超领单号/工单号/申请人/申请人角色]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 超量领料 超量领料单管理 全部 待处理 已批准 已拒绝 已取消 新建超量领料单 超领单列表 超领单号 工单号 申请人 申请人角色 审批人

### pdaConsumption
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 物料实时状态与位置 输入物料 SN/批次后查看 当前位置: — | 下一步: 确认收料信息 进入当前流程 查看物料流程追踪 订单采购 产

### rjvnPicking
API: GET 200[HTML!] /rjvn-picking/list?limit=50 ; GET 200[HTML!] /rjvn-picking/reels?limit=50
TABLES: -
BANNER: 接口 /rjvn-picking/list?limit=50 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 领料单 拣货单审批 / FIFO 拣货扣库存 / 签收，含料卷记录（来自 workorder.service.ts） 接口 /rjvn-

### rjvnDocFlow
API: GET 200[HTML!] /rjvn-doc/stock-take/list?limit=50
TABLES: -
BANNER: ERR: 接口 /rjvn-doc/stock-take/list?limit=50 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 超补领料单 盘点 / MRB / 供应商退货 / 超领 —— 镜像表源数据为空，导入后可用 盘点 MRB 评审 供应商退货 超领 单据数

### productionInbound
API: GET 403 /api/production/orders?status= ; GET 403 /api/production/fg?pageSize=100
TABLES: 1r[#/工单号/MO号/物料]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 生产入库 成品入库登记与QC确认 工单 0 入库记录 全部状态 草稿 待发料 已发料 生产中 质检中 已完成 已取消 0 / 0 条工单

### productionOutbound
API: GET 403 /api/production/orders?status=
TABLES: 1r[#/工单号/MO号/成品物料]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 生产出库 工单发料：仓库向产线发料 0 条工单 全部状态 草稿 待发料 已发料 生产中 质检中 已完成 已取消 # 工单号 MO号 成品

### materialConsumption
API: GET 200[HTML!] /wms/material-consumption-summary?limit=5000
TABLES: 1r[物料/姓名/已消耗/总剩余] 0r[日期时间/物料/批次/数量]
BANNER: 接口 /wms/material-consumption-summary?limit=5000 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 物料消耗实时看板 按物料追踪实际消耗、仓库剩余、线边剩余和完整消费流水 实时数据 · 15s 接口 /wms/material-cons

### smtClosedLoop
API: GET 200 /api/wms/smt-loop/dashboard
TABLES: 1r[No./Severity/Type/WO] 1r[Event/WO/Machine/Slot/Material SN]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 SMT 物料闭环 WMS库存 → PDA上料 → 机台/槽位/Feeder绑定 → NPM消耗 → 退料/报废 → BOM核销 刷新 S

### nonSmtClosedLoop
API: GET 200 /api/wms/non-smt/dashboard
TABLES: 1r[No./Severity/Type/WO] 1r[No./WO/Material/Theoretical] 1r[Event/Mode/WO / Station/Material]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 非SMT物料闭环 逐件SN · 批次计量 · 包装绑定 · 间接耗材 — 从领料到BOM核销 刷新 已分类物料0 已配置规则0 有效逐件

### nonIqcClosedLoop
API: GET 200 /api/wms/non-iqc/dashboard
TABLES: 1r[Receipt/PO / Supplier/Material / Lot/Qty] 1r[Request/Material/Qty/Purpose] 1r[Loan/Item/Borrower/Due]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 非 IQC 物料管理闭环 基础收货验证、异常隔离、用途领用、借还、成本归集和受控关单 刷新 有效物料0 隔离收货0 待批领用0 超期借用

### mesSync
API: GET 200[HTML!] /wms/mes-sync/status ; GET 200[HTML!] /wms/mes-sync/config ; GET 200[HTML!] /wms/mes-sync/pending?limit=200 ; GET 200[HTML!] /wms/mes-sync/writeback/list?limit=50 ; GET 200[HTML!] /wms/mes-sync/logs?limit=20
TABLES: -
BANNER: 接口 /wms/mes-sync/status 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 接口 /wms/mes-sync/status 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 MES 

### supplierReturnOrder
API: GET 200 /api/supplier-return/list?page=1&pageSize=20 ; GET 304 /api/supplier-return/list?page=1&pageSize=20
TABLES: 1r[退货单号/供应商/批号/数量]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 退供应商单 MRB 退供应商处置生成的退货出库单 全部 待出库 已出库 已取消 退供应商单列表 退货单号 供应商 批号 数量 单位 已退数量 状态 出库时间 操作 SR2026112000

### lineReturn
API: GET 200[HTML!] /wms/receiving/qr-bindings
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 产线退料回仓 产线退料收货后生成QR单据，进入IQC复检。 返回来源页面 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API

### rework
API: GET 200 /api/rework/list?page=1&pageSize=20 ; GET 304 /api/rework/list?page=1&pageSize=20
TABLES: 3r[返工单号/MRB单号/物料编码/物料]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 返工修复 返工修复管理 全部 待处理 返工中 待复检 复检合格 复检不合格 返工单列表 返工单号 MRB单号 物料编码 物料 供应商 批号 数量 单位 状态 完成时间 操作 RW20261

### reworkComplete
API: GET 200[HTML!] /wms/receiving/qr-bindings
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 返工修复完成回仓 登记返工完成，生成新QR单据并等待IQC复检。 返回来源页面 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 

### mrb
API: GET 200 /api/mrb/list?page=1&pageSize=20 ; GET 500 /api/mrb/reviewer-candidates
TABLES: 1r[MRB单号/物料编码/物料名称/批号]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 MRB物料评审 MRB物料评审管理 全部 草稿 待评审 评审中 待预审 待终审 已批准 已驳回 已作废 搜索 发起MRB 评审列表 (1) MRB单号 物料编码 物料名称 批号 数量 状态

### mrbApproval
API: GET 200[HTML!] /quality/iqc-mrb-tasks
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /quality/iqc-mrb-tasks 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 MRB物料评审 / OA审批 对不良品执行返工、报废或退货供应商的评审审批。 返回来源页面 接口 /quality/iqc-mrb-tasks 返回了网页 HTML，而不是 JSON。请检

### mrbReworkReturn
API: GET 200[HTML!] /wms/receiving/qr-bindings
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 MRB返工修复回仓 返工修复完成回仓，生成新QR单据并进入IQC复检。 返回来源页面 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请

### subcontractReturn
API: (none)
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 外协完工回厂 外协加工完工收货后生成QR单据，进入IQC。 返回来源页面 接口 /wms/receiving/qr-bindings 返回了网页 HTML，而不是 JSON。请检查 API

### scrapFinanceApproval
API: GET 200[HTML!] /quality/iqc-scrap-finance-approvals
TABLES: 1r[ID/单据/档案/批次/状态/来源]
BANNER: 接口 /quality/iqc-scrap-finance-approvals 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 报废财务审批闭环 财务审批报废金额；批准后由仓库执行报废并关闭库存台账。 返回来源页面 接口 /quality/iqc-scrap-finance-approvals 返回了网页 HTML

### supplierDebt
API: GET 200 /api/supplier-debt/list?page=1&pageSize=20 ; GET 304 /api/supplier-debt/list?page=1&pageSize=20
TABLES: 2r[欠款单号/供应商代码/供应商名称/物料编码]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 退供应商 退供应商单 销售退货 产线退料 返工修复 返工修复完成回仓 MRB物料评审 MRB物料评审/OA审批 MRB返工修复回仓 外协完工回厂 报废财务审批 供应商欠款 供应商欠款 供应商欠款管理 全部 待处理 已结算 已作废 欠款列表 欠款单号 供应商代码 供应商名称 物料编码 物料 原始数量 已结算数量 来源类型 来源单号 状态 日期 操作 SD202

### solderPaste
API: GET 401 /api/solder-paste/lots?limit=200&offset=0 ; GET 401 /api/solder-paste/summary
TABLES: -
BANNER: -
ERR: TypeError: Cannot read properties of undefined (reading 'toFixed') | TypeError: Cannot read properties of undefined (reading 'toFixed')
DEMO: false
TXT: 加载错误 (3D组件崩溃) 某些3D组件在此环境无法运行，应用其余部分正常。 错误详情（仅供调试） 重试

### auxiliary
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: 加载错误 (3D组件崩溃) 某些3D组件在此环境无法运行，应用其余部分正常。 错误详情（仅供调试） 重试

### msd
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: 加载错误 (3D组件崩溃) 某些3D组件在此环境无法运行，应用其余部分正常。 错误详情（仅供调试） 重试

### pdaMsd
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: 加载错误 (3D组件崩溃) 某些3D组件在此环境无法运行，应用其余部分正常。 错误详情（仅供调试） 重试

### traceability
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 追溯 物料流程追踪 3D WMS流程模拟 追溯 批次履历 搜索 输入批次/序列号 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### materialTrace
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 追溯 物料流程追踪 3D WMS流程模拟 物料流程追踪 输入批次号、物料QR或栈板QR，查看物料在流程图中的当前位置和完整历史。 追踪 请输入物料标识开始追踪 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### wms3dFlow
API: GET 200 /gh/lojjic/unicode-font-resolver@v1.0.1/packages/data/codepoint-index/plane0/0-ff.json ; GET 200 /gh/lojjic/unicode-font-resolver@v1.0.1/packages/data/font-meta/latin.json ; GET 200 /gh/lojjic/unicode-font-resolver@v1.0.1/packages/data/font-files/latin/sans-serif.normal.100.woff ; GET 200 /gh/lojjic/unicode-font-resolver@v1.0.1/packages/data/codepoint-index/plane0/6500-65ff.json ; GET 200 /gh/lojjic/unicode-font-resolver@v1.0.1/packages/data/codepoint-index/plane0/8d00-8dff.json ; GET 200 /gh/lojjic/unicode-font-resolver@v1.0.1/packages/data/codepoint-index/plane0/5f00-5fff.json
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 追溯 物料流程追踪 3D WMS流程模拟 3D WMS物料流程模拟 可按批次号、物料ID或栈板QR追踪；点击节点进入对应业务页面。 打开物料流程追踪 开始追踪 🟡 物料流转中 🟢 合格/成品仓 🔴 不良/MRB 3D模拟视图 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### materialMaster
API: GET 200[HTML!] /wms/material-lots?limit=500
TABLES: 1r[序号/标记/物料编码/越南料号]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 物料主数据管理 物料条码闭环 物料替代关系 供应商管理 供应商KPI 基础数据 来料管理 物料主数据管理 基础数据 0 lots All IQC Status Pending Hold Released Rejected 序号 标记 物料编码 越南料号 物料名称 Lot No 供应商 库存数量 已发料 已预留 库位QR 入库日期 生产日期 失效日期 IQC 

### materialBarcodeLoop
API: GET 200[HTML!] /wms/material-roll-labels ; GET 200[HTML!] /mes/material-roll-imports ; GET 200 /material_label_master.xlsx ; POST 404 /wms/material-roll-labels/resolve-bom-fields ; POST 404 /wms/material-label-master/import-sheet1
TABLES: 173r[序号/越南东泰料号/深圳瑞晶料号/规格] 0r[Batch/File/Operator/Total] 0r[料卷SN/越南料号/供应商/MSD]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 物料主数据管理 物料条码闭环 物料替代关系 供应商管理 供应商KPI 基础数据 来料管理 WMS 条码闭环 供应商标签 → 入库标签 → 打印履历 统一使用物料 SN、批次、数量和打印事件，避免供应商标签与仓库标签脱节。 可追溯闭环 供应商标签 / Nhãn NCC / Supplier label Blueway SupplierLabelPrinting

### substitution
API: GET 200[HTML!] /wms/material-substitutions
TABLES: 1r[主料//替代料/替代类型]
BANNER: 接口 /wms/material-substitutions 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 物料主数据管理 物料条码闭环 物料替代关系 供应商管理 供应商KPI 基础数据 来料管理 物料替代关系 原 WMS 的替代料一览：主料 → 可替代料，领料/上料时按这里放行替代。 接口 /wms/material-substitutions 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 主料 替代料 替代类型 状态 备注 暂

### supplierManagement
API: GET 200[HTML!] /wms/suppliers?status=active
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 物料主数据管理 物料条码闭环 物料替代关系 供应商管理 供应商KPI 基础数据 来料管理 SUPPLIER RELATIONSHIP MANAGEMENT · WMS CONTROL 供应商管理中心 从准入、资质、物料授权、远程门户、发货预报到收货、IQC、绩效和整改的完整闭环。 Excel模板 导出供应商Excel 导入最新版供应商 刷新 接口 /wms/

### supplierKpi
API: (none)
TABLES: 0r[供应商/不良率/wms.onTimeDelivery/wms.rejectCount]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 物料主数据管理 物料条码闭环 物料替代关系 供应商管理 供应商KPI 基础数据 来料管理 供应商KPI wms.supplierKpiDesc wms.totalSuppliers 0 wms.avgDefectRate 0.0% wms.avgDeliveryRate 0.0% wms.avgLeadTime 0.0d wms.supplierKpiDet

### basicData
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 物料主数据管理 物料条码闭环 物料替代关系 供应商管理 供应商KPI 基础数据 来料管理 基础数据 基础数据 选择子模块 物料主数据管理 物料编码/名称/规格/供应商/库存查询 库位精细化管理 库位编码/类型/容量/状态管理 批次/序列号管理 批次号/SN追溯/库存分布/事务记录 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### incoming
API: GET 403 /api/wms/incoming?limit=20&offset=0
TABLES: 1r[批次号/物料编码/供应商/实收数量]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 物料主数据管理 物料条码闭环 物料替代关系 供应商管理 供应商KPI 基础数据 来料管理 来料登记 wms.incoming.all wms.incoming.pending wms.incoming.exempt wms.incoming.submitted 新建来料 批次号 物料编码 供应商 实收数量 到货时间 包装状态 MSD等级 IQC状态 No r

### qualityDashboard
API: GET 200[HTML!] /qms/kpi/summary
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 质量总览 出货检验 不良品管理 8D报告 qms.loadError WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### oqc
API: GET 200[HTML!] /qms/oqc/batches
TABLES: 0r[qms.batchNo/qms.customer/qms.type/qms.qty]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 质量总览 出货检验 不良品管理 8D报告 qms.oqcTitle + qms.newBatch qms.batchNo qms.customer qms.type qms.qty qms.passFail qms.status qms.action WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### ngManagement
API: GET 200[HTML!] /qms/ng/cases
TABLES: 0r[qms.caseNo/SN/qms.woCode/qms.station]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 质量总览 出货检验 不良品管理 8D报告 qms.ngTitle + qms.newNg qms.caseNo SN qms.woCode qms.station qms.defectCode qms.severity qms.repairCount qms.status qms.action WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### eightD
API: GET 200[HTML!] /qms/8d
TABLES: 0r[qms.reportNo/qms.title/qms.severity/qms.source]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 质量总览 出货检验 不良品管理 8D报告 qms.eightDTitle + qms.new8d qms.reportNo qms.title qms.severity qms.source qms.ngQty qms.status qms.action WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### smartRack
API: GET 200[HTML!] /wms/shelf/rack-cells/RAW-A ; GET 200[HTML!] /wms/shelf/rack-status
TABLES: 1r[/库位/FIFO顺序/标签号]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 智能料架 料架联调 货架操作 料架监控 料架流程图 PDA 盘点 PDA 检查记录 协同看板 智能料架管理 料架库存查询、入库、出库、LED引导操作 已超期 0 三级预警 0 二级预警 0 一级预警 0 正常 0 FIFO违规 0 低库存 0 空闲 0 料架选择 选择料架后进行操作 RAW-A RAW-B RAW-C RAW-D 入库 出库 wms.filt

### smartShelf
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 智能料架 料架联调 货架操作 料架监控 料架流程图 PDA 盘点 PDA 检查记录 协同看板 感应式料架接口联调 逐个测试 4 个料架接口，请求与响应实时显示 未连接 服务地址 超时 (ms) 使用 Mock 服务 Mock (in-process) 健康检查 顺序执行全部接口 Mock state (4 shelves, 0 removed) — clic

### shelfOps
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 智能料架 料架联调 货架操作 料架监控 料架流程图 PDA 盘点 PDA 检查记录 协同看板 智能料架操作面板 直接调用货架控制器 API — 测试 LightOn / ShelfIn / ShelfOut / RemoveLabel 📊 状态 控制器地址 · SHELF_CONTROLLER_URL=http://10.100.29.151:8093 �

### rackSim
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 智能料架 料架联调 货架操作 料架监控 料架流程图 PDA 盘点 PDA 检查记录 协同看板 离线 总槽位 0 已占用 0 空槽 0 全部 已占用 空闲 等待实时数据... WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### smartRackWorkflow
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 智能料架 料架联调 货架操作 料架监控 料架流程图 PDA 盘点 PDA 检查记录 协同看板 SMT 智能料架上料流程 感应式料架 · WO+BOM+PDA串联 · 三线共用 角色: 仓库 SMT操作员 系统 QC Type: ⚡ 🔗 💾 📋 流程步骤 🔗 数据流 + API 📦 1. 来料入库 仓库 供应商送货 ⚡ QC IQC 检验 ⚡ 系统 

### pdaCycleCount
API: GET 200[HTML!] /wms/material-lots?limit=500
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 智能料架 料架联调 货架操作 料架监控 料架流程图 PDA 盘点 PDA 检查记录 协同看板 PDA 盘点 重置 选择库位开始盘点 暂无处盘点 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### pdaHistory
API: GET 200[HTML!] /wms/pda-inspection-records?limit=500
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 智能料架 料架联调 货架操作 料架监控 料架流程图 PDA 盘点 PDA 检查记录 协同看板 PDA 检查记录 button.refresh 总检查数 0 通过率 — HOLD率 — 拒收率 — 收货数 0 全部类型 PDA 收货 PDA IQC 检查 全部判定 PASS HOLD REJECT RECEIVED 批号 类型 物料 判定 不良数 操作员 时间

### collaboration
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 智能料架 料架联调 货架操作 料架监控 料架流程图 PDA 盘点 PDA 检查记录 协同看板 协同看板 协同管理看板 协同管理看板 — 急料标识 0 MSD预警 / IQC 0 有效期监控 0 协同管理看板 0 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### closure
API: GET 200[HTML!] /wms/closure/dashboard
TABLES: 1r[批次/对象/Gate/当前状态/数量] 1r[No./Type/Entity/Status] 1r[No./Entity/Route/Qty]
BANNER: 接口 /wms/closure/dashboard 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 WMS 闭环控制中心 异常、审批、冻结、交接与超时统一监管 刷新 接口 /wms/closure/dashboard 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 Pending 0 In transit 0 Overdue 0 Handover 

### rjvnClassic
API: GET 200[HTML!] /rjvn-receipt/pending?limit=50 ; GET 200[HTML!] /rjvn-receipt/warehouses ; POST 404 /rjvn-receipt/submit-iqc/preview
TABLES: -
BANNER: 接口 /rjvn-receipt/submit-iqc/preview 返回了非 JSON 内容（HTTP 404）
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 仓库管理系统 WMS 首页 ▸ 收料管理 ▾ 扫码收料收料单列表退料收货 发料管理 ▸ 库存管理 ▸ IQC检验 ▸ 工单管理 ▸ 生产管理 ▸ BOM管理 ▸ MRB评审 ▸ 返工单 ▸ 供应商退货出库单 ▸ 仓库管理 ▸ 物料管理 ▸ 系统设置 ▸ 收料单列表 收料单列表 二维

### rjvnData
API: GET 200[HTML!] /rjvn-wms/summary ; GET 200[HTML!] /rjvn-wms/tables ; GET 200[HTML!] /rjvn-wms/iqc/overview ; GET 200[HTML!] /rjvn-wms/data/rjvn_material?limit=50&offset=0
TABLES: -
BANNER: 接口 /rjvn-wms/data/rjvn_material?limit=50&offset=0 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 物料主数据 源 WMS 库的只读镜像（仅参考，写入仍走正式 WMS 流程） 只读 接口 /rjvn-wms/data/rjvn_material?limit=50&offset=0 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 物料 0 供应商 0

### rjvnCanonical
API: GET 200[HTML!] /canonical-data/summary ; GET 200[HTML!] /canonical-data/materials?limit=50
TABLES: -
BANNER: 接口 /canonical-data/materials?limit=50 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 仓库档案 rjvn 数据导入正式业务表后的只读视图：物料/供应商/料号/收料单/检验/BOM/拣货 接口 /canonical-data/materials?limit=50 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。 加载中… 物料 供应商 料

### notices
API: GET 200 /api/notices/list?pageSize=200 ; GET 200 /api/notices/unread-count ; GET 304 /api/notices/list?pageSize=200 ; GET 304 /api/notices/unread-count
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 消息通知中心 MRB、返工、退供应商、盘点等业务提醒 只看未读 全部已读 暂无消息 WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### pdaReceiving
API: GET 200[HTML!] /wms/material-roll-labels ; GET 200[HTML!] /mes/material-roll-imports ; GET 200 /material_label_master.xlsx ; GET 200[HTML!] /wms/pda-devices?pool=RECEIVING ; GET 200[HTML!] /wms/receiving/pre-receiving-manifests ; GET 200[HTML!] /wms/receiving/qr-bindings
TABLES: 3r[PO/供应商/物料编码/批次] 1r[物料ID/批次/物料/箱 QR] 1r[设备ID/操作员/当前阶段/物料]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 待收料 PO 清单 从供应商 Portal 已登记的标签清单选择物料后开始收料。 3 项待收 刷新 PO 供应商 物料编码 批次 应收数量 箱数 扫码进度 状态 操作 PO-TEST-RECV-001 测试供应商 A R0210-

### pdaReceivingMobile
API: GET 404[HTML!] /api/wms/receiving/pre-receiving-manifests ; GET 304 /api/wms/pda-devices?pool=RECEIVING
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 WMS 自动分配 VN_OP_001 箱码直接收料 READY PDA 收料 重置 已接收 WMS 下发的收料任务，请在现场扫码确认 第一步：选择待收料 PO 3 项 PO-TEST-RECV-001 · R0210-01019 

### rjvnReceipt
API: GET 200[HTML!] /rjvn-receipt/pending?limit=50 ; GET 200[HTML!] /rjvn-receipt/warehouses ; POST 404 /rjvn-receipt/submit-iqc/preview
TABLES: -
BANNER: 接口 /rjvn-receipt/submit-iqc/preview 返回了非 JSON 内容（HTTP 404）
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 收料单列表 二维码校验 + 收料单合并提交 IQC 批次（来自 receipt.service.ts） 接口 /rjvn-receipt/submit-iqc/preview 返回了非 JSON 内容（HTTP 404） 待提交收料单 0 将生成批次数 0 仓库数 0 二维码校验 

### finishedGoods
API: GET 200 /api/wms/finished-goods?limit=200 ; GET 200 /api/wms/outbound-orders?limit=200 ; GET 304 /api/wms/finished-goods?limit=200 ; GET 304 /api/wms/outbound-orders?limit=200
TABLES: 1r[SN/工单/产品型号/批次]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 成品 & 出货 入库 新建出货 成品库存 出货单 SN追溯 SN 工单 产品型号 批次 生产日期 状态 OQC 库位 客户订单 No finished goods WMS-INVENTORY-VIRTUAL-01 人工输入已满足

### shelfApi
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 货架 API 测试 测试 /api/shelf/* 和 /api/wms/shelf/* 所有接口 · 可编辑请求体 API Base: ▶ ▶ 全部运行 0 Pass (0/15) 0 NG (0/15) 0 Error (0/15) 15 Idle (15/15) QUERY 

### shelfSim
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: 加载错误 (3D组件崩溃) 某些3D组件在此环境无法运行，应用其余部分正常。 错误详情（仅供调试） 重试

### shelfSim3d
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 🏭 3D 货架模拟器 — 入口：主厂房 → 视图 → 原材料仓库 Smart shelf 3D view is integrated in the Manual Line 3D dashboard (主厂房 → 视图 → 原材料仓库) WMS-INVENTORY-VIRTUAL-

### sqlConsole
API: GET 401 /api/sql/tables
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 SQL 查询控制台 GM_WareHouse SQL Server — 192.168.0.110 · 可执行任意 SELECT/INSERT/UPDATE/DELETE localhost:8080 192.168.0.110:8080 localhost:8080 ▶ 执行 �

### dashboard
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 仓库管理系统 📊 首页 📥 收料管理 🔍 IQC检验 🏭 仓库管理 📤 领料与发料 ↩️ 退货 · 返工 · MRB ⚠️ 辅料与特殊物料管理 🧭 追溯管理 🗂️ 基础数据 🔬 质量管理 🤖 料架与协同 首页 仓库看板 闭环控制中心 仓库管理系统 WMS 物料主数据 仓库档案 消息通知 采购与供应商管理闭环 供应商管理 → 采购 PO → 供应商送货单 → WMS 收料 → IQC → 财务匹配 供应商管理 主数据 / 资质 采购部 PO / 交期 供应商送货单 送货单 / OCR WMS 收料 箱 / 托板 / 库位 IQC / 财务 

### materialReceiving
API: GET 200[HTML!] /wms/material-roll-labels ; GET 200[HTML!] /mes/material-roll-imports ; GET 200 /material_label_master.xlsx ; GET 200[HTML!] /wms/pda-devices?pool=RECEIVING ; GET 200[HTML!] /wms/receiving/pre-receiving-manifests ; GET 200[HTML!] /wms/receiving/qr-bindings
TABLES: 3r[PO/供应商/物料编码/批次] 1r[物料ID/批次/物料/箱 QR] 2r[设备ID/操作员/当前阶段/物料]
BANNER: -
ERR: -
DEMO: true
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 待收料 PO 清单 从供应商 Portal 已登记的标签清单选择物料后开始收料。 3 项待收 刷新 PO 供应商 物料编码 批次 应收数量 箱数 扫码进度 状态 操作 PO-TEST-RECV-001 测试供应商 A R0210-

### iqcInspect
API: GET 200[HTML!] /wms/material-lots?iqcStatus=pending&limit=100 ; GET 200[HTML!] /wms/material-lots?iqcStatus=hold&limit=100
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 IQC 检验 IQC检验执行 IQC检验等级与人工判定 IQC物料闭环 IQC不良品闭环 IQC报告 IQC 标准 IQC 检验模板库 IQC合格结果维护 IQC不良品档案 IQC复检档案 PDA IQC 待检清单 质量趋势 移植作业台 IQC检验执行 来料检验：合格放行 / 待判定 / 拒收 wms.selectLot 暂无数据 WMS-RECEIVING

### putaway
API: GET 200[HTML!] /wms/material-lots?iqcStatus=released&limit=200 ; GET 200[HTML!] /wms/storage-locations?status=active&limit=200 ; GET 200[HTML!] /wms/inventory-transactions?action=PUT_AWAY&limit=50
TABLES: 1r[物料/批次/数量/当前位置]
BANNER: 接口 /wms/material-lots?iqcStatus=released&limit=200 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 来料管理 收料 退料接收 PDA 收货 PDA 收料 入库单 PO采购到货 上架 QR绑定仓库 上料管理 MES-WMS同步中心 推荐库位 全部 物料 批次 数量 当前位置 目标库位 动作 暂无数据 接口 /wms/material-lots?iqcStatus=released&limit=200 返回了网页 HTML，而不是 JSON。请检查 API 路

### inventory
API: GET 200[HTML!] /wms/material-lots?limit=200 ; GET 200[HTML!] /wms/storage-locations?limit=200
TABLES: 0r[物料/库存域/Roll QR / SN/批次] 0r[编码/库存域/库区/状态]
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 库存 库存控制中心 库存查询 盘点 移库调整 超期管控 有效期管控 FIFO监控 FIFO模拟 不良品移库 履历 批次/序列号管理 库位精细化管理 Material roll validation Scan or enter a roll QR/SN before issuing it to MES/PDA loading. Validate roll 库存

### picking
API: GET 200[HTML!] /wms/pick-orders
TABLES: 1r[需求/工单/产线/物料]
BANNER: 接口 /wms/pick-orders 返回了网页 HTML，而不是 JSON。请检查 API 路径或服务是否已注册。
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 待领取物料清单 显示已下达和生产中工单的待领取物料，可按工单筛选 刷新 物料领料流程 材料通过 IQC（iqc_status=relea

### issue
API: (none)
TABLES: -
BANNER: -
ERR: -
DEMO: false
TXT: WMS 物料 收料、IQC、库存、备料与线边发料 WMS 物料 实时数据 API OK 中文 Tiếng Việt English 退出 WMS 物料 收料、IQC、库存、备料与线边发料 ← 主菜单 首页 收料管理 IQC检验 仓库管理 领料与发料 退货 · 返工 · MRB 辅料与特殊物料管理 追溯管理 基础数据 质量管理 料架与协同 备料 发料 领料单 发料/收料单据 物料配送 工单物料交接 出库单 退库单 补料单 超量领料 发料 领料单 超补领料单 生产入库 生产出库 物料消耗看板 SMT物料闭环 非SMT物料闭环 非IQC物料闭环 MES 工单同步 发料到产线 扫描料卷发料 物料领料流程 材料通过 IQC（iqc_status=released）后即可领料；点击节点跳转到对应模块 B
