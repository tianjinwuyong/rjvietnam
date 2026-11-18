// MES-ruijing 菜单树（逐字移植自源 api/sys.py MENU，权限过滤在 mesrj.js 做）
export const MENU = [
  {
    "code": "home",
    "name": "首页",
    "perm": null
  },
  {
    "code": "md",
    "name": "基础数据",
    "perm": "md.view",
    "children": [
      {
        "code": "md.customer",
        "name": "客户"
      },
      {
        "code": "md.model",
        "name": "机种维护"
      },
      {
        "code": "md.line",
        "name": "产线"
      },
      {
        "code": "md.station",
        "name": "工位"
      },
      {
        "code": "cfg.feederslot",
        "name": "SMT 站位绑码"
      },
      {
        "code": "md.employee",
        "name": "员工档案"
      },
      {
        "code": "md.shift",
        "name": "班次"
      },
      {
        "code": "md.defect",
        "name": "不良代码"
      },
      {
        "code": "md.rootcause",
        "name": "根因代码"
      }
    ]
  },
  {
    "code": "bom",
    "name": "物料与 BOM",
    "perm_any": [
      "md.view",
      "bom.view"
    ],
    "children": [
      {
        "code": "md.material",
        "name": "物料"
      },
      {
        "code": "bom.header",
        "name": "BOM 版本"
      },
      {
        "code": "bom.tree",
        "name": "BOM 结构"
      },
      {
        "code": "bom.item",
        "name": "BOM 明细"
      },
      {
        "code": "bom.import",
        "name": "BOM 导入"
      }
    ]
  },
  {
    "code": "plan",
    "name": "排产管理",
    "perm": "plan.view",
    "children": [
      {
        "code": "plan.board",
        "name": "排产看板"
      },
      {
        "code": "plan.load",
        "name": "产线负荷"
      },
      {
        "code": "plan.capacity",
        "name": "产能主数据"
      }
    ]
  },
  {
    "code": "order",
    "name": "订单与工单",
    "perm_any": [
      "po.view",
      "mo.view",
      "issue.view"
    ],
    "children": [
      {
        "code": "po",
        "name": "客户 PO",
        "perm": "po.view"
      },
      {
        "code": "mo",
        "name": "生产计划",
        "perm": "mo.view"
      },
      {
        "code": "issue",
        "name": "领料单",
        "perm": "issue.view"
      },
      {
        "code": "wmsmo",
        "name": "工单下发 WMS",
        "perm": "issue.view"
      }
    ]
  },
  {
    "code": "route",
    "name": "工艺管理",
    "perm": "route.view",
    "children": [
      {
        "code": "route.process",
        "name": "工艺路线"
      },
      {
        "code": "route.rule",
        "name": "工位规则"
      }
    ]
  },
  {
    "code": "exec",
    "name": "生产执行",
    "perm_any": [
      "prod.pass",
      "prod.trace",
      "prod.pack"
    ],
    "children": [
      {
        "code": "exec.scan",
        "name": "扫码过站台",
        "perm": "prod.pass"
      },
      {
        "code": "exec.dippass",
        "name": "DIP 过站",
        "perm": "prod.pass"
      },
      {
        "code": "exec.consume",
        "name": "物料消耗",
        "perm": "prod.pass"
      },
      {
        "code": "exec.smta",
        "name": "辅料管控",
        "perm": "prod.pass"
      },
      {
        "code": "exec.emplogin",
        "name": "上岗登记",
        "perm": "prod.pass"
      },
      {
        "code": "exec.snpool",
        "name": "发码管理",
        "perm": "prod.pass"
      },
      {
        "code": "exec.laser",
        "name": "镭雕发码记录",
        "perm": "prod.pass"
      },
      {
        "code": "exec.shiftreport",
        "name": "班长填报"
      },
      {
        "code": "exec.moroute",
        "name": "工单路线"
      },
      {
        "code": "exec.panelsplit",
        "name": "分板扫码"
      },
      {
        "code": "exec.release",
        "name": "跳站放行单"
      },
      {
        "code": "exec.bind",
        "name": "绑码（转码）"
      },
      {
        "code": "exec.decode",
        "name": "解码 / 换标",
        "perm": "prod.bind"
      },
      {
        "code": "exec.pack",
        "name": "外箱绑码"
      },
      {
        "code": "exec.pallet",
        "name": "栈板绑码"
      }
    ]
  },
  {
    "code": "smt",
    "name": "SMT 管控",
    "perm_any": [
      "prod.pass",
      "prod.trace"
    ],
    "children": [
      {
        "code": "exec.loading",
        "name": "上料防错"
      },
      {
        "code": "smt.baseline",
        "name": "上料基准（首扫建档）"
      },
      {
        "code": "exec.paste",
        "name": "锡膏/红胶回温"
      },
      {
        "code": "exec.stencil",
        "name": "钢网管控"
      },
      {
        "code": "exec.pcb",
        "name": "PCB 拆封/烘烤"
      },
      {
        "code": "exec.fa",
        "name": "首件与点检"
      },
      {
        "code": "exec.tracebind",
        "name": "SN 绑定追溯"
      }
    ]
  },
  {
    "code": "qc",
    "name": "质量与追溯",
    "perm_any": [
      "prod.trace",
      "prod.defect",
      "prod.repair"
    ],
    "children": [
      {
        "code": "exec.trace",
        "name": "SN 追溯"
      },
      {
        "code": "exec.pass",
        "name": "过站记录"
      },
      {
        "code": "exec.defect",
        "name": "不良记录"
      },
      {
        "code": "qlt.repairboard",
        "name": "维修看板"
      },
      {
        "code": "qlt.repairdesk",
        "name": "维修作业台"
      },
      {
        "code": "exec.repair",
        "name": "维修查询"
      },
      {
        "code": "exec.repairhandover",
        "name": "维修交接"
      },
      {
        "code": "exec.scraprelease",
        "name": "解报废审批"
      },
      {
        "code": "exec.empcert",
        "name": "员工资质"
      },
      {
        "code": "exec.dwell",
        "name": "时效超期"
      },
      {
        "code": "exec.aoi",
        "name": "AOI / SPI 数据"
      },
      {
        "code": "exec.momaterial",
        "name": "工单物料反追溯"
      },
      {
        "code": "qlt.ecn",
        "name": "ECN/PCN 变更"
      },
      {
        "code": "qlt.oqcboard",
        "name": "OQC 看板"
      },
      {
        "code": "qlt.oqc",
        "name": "OQC 出货抽检"
      },
      {
        "code": "qlt.aqlstd",
        "name": "AQL 检验标准"
      },
      {
        "code": "qlt.oqclist",
        "name": "OQC 检验记录"
      },
      {
        "code": "qlt.oqccheck",
        "name": "OQC 逐项检验录入"
      },
      {
        "code": "qlt.oqcreport",
        "name": "OQC 出货报告"
      },
      {
        "code": "qlt.poexport",
        "name": "PO 全数据导出"
      }
    ]
  },
  {
    "code": "dev",
    "name": "设备管理",
    "perm_any": [
      "md.view",
      "prod.trace"
    ],
    "children": [
      {
        "code": "md.equipment",
        "name": "设备台账"
      },
      {
        "code": "dev.machinesource",
        "name": "机台数据源"
      },
      {
        "code": "exec.health",
        "name": "设备接入状态"
      },
      {
        "code": "exec.machine",
        "name": "设备上报数据"
      },
      {
        "code": "exec.aging",
        "name": "老化数据"
      }
    ]
  },
  {
    "code": "report",
    "name": "报表与看板",
    "perm_any": [
      "prod.trace",
      "plan.view"
    ],
    "children": [
      {
        "code": "report.board",
        "name": "车间大屏"
      },
      {
        "code": "report.aoi",
        "name": "AOI 看板"
      },
      {
        "code": "report.yield",
        "name": "PCBA 良率"
      },
      {
        "code": "report.output",
        "name": "产能看板"
      },
      {
        "code": "report.oee",
        "name": "设备 OEE"
      },
      {
        "code": "report.spc",
        "name": "SPC 过程控制"
      },
      {
        "code": "report.alert",
        "name": "预警中心"
      }
    ]
  },
  {
    "code": "cfg",
    "name": "配置中心",
    "perm": "cfg.view",
    "children": [
      {
        "code": "cfg.basic",
        "name": "基础数据维护"
      },
      {
        "code": "cfg.dict",
        "name": "编码字典"
      },
      {
        "code": "cfg.threshold",
        "name": "时间阈值"
      },
      {
        "code": "cfg.pokayoke",
        "name": "防错规则"
      },
      {
        "code": "cfg.snrule",
        "name": "SN 规则"
      },
      {
        "code": "cfg.times",
        "name": "辅料时间参数"
      },
      {
        "code": "cfg.packrule",
        "name": "装箱编码规则"
      },
      {
        "code": "cfg.printtpl",
        "name": "打印模板"
      },
      {
        "code": "cfg.panellayout",
        "name": "拼版布局"
      },
      {
        "code": "cfg.pcbcode",
        "name": "PCB 镭雕码"
      },
      {
        "code": "cfg.aoipoints",
        "name": "AOI 点数"
      },
      {
        "code": "cfg.aoidefect",
        "name": "AOI 不良代码"
      },
      {
        "code": "cfg.aoicompmap",
        "name": "AOI 位号映射"
      },
      {
        "code": "cfg.aoiprogrammap",
        "name": "AOI 程序名映射"
      },
      {
        "code": "cfg.bindstation",
        "name": "绑码工位"
      },
      {
        "code": "cfg.bindrule",
        "name": "绑码规则"
      },
      {
        "code": "cfg.skill",
        "name": "资质项 / 工位要求"
      },
      {
        "code": "cfg.apikey",
        "name": "设备接口密钥"
      }
    ]
  },
  {
    "code": "sys",
    "name": "系统管理",
    "perm": "sys.user.view",
    "children": [
      {
        "code": "sys.user",
        "name": "用户"
      },
      {
        "code": "sys.role",
        "name": "角色权限"
      },
      {
        "code": "sys.param",
        "name": "系统参数"
      },
      {
        "code": "sys.log",
        "name": "操作日志"
      },
      {
        "code": "sys.info",
        "name": "系统信息"
      }
    ]
  },
  {
    "code": "erp",
    "name": "业务管理",
    "perm_any": [
      "md.view",
      "po.view",
      "mo.view",
      "erp.view"
    ],
    "children": [
      {
        "code": "erp.alerts",
        "name": "商务预警"
      },
      {
        "code": "erp.contract",
        "name": "合同管理"
      },
      {
        "code": "erp.supplier",
        "name": "供应商"
      },
      {
        "code": "erp.customer2",
        "name": "客户（业务）"
      },
      {
        "code": "erp.material2",
        "name": "物料（业务）"
      },
      {
        "code": "erp.warehouse",
        "name": "仓库/库位"
      },
      {
        "code": "erp.bom",
        "name": "BOM"
      },
      {
        "code": "erp.stock",
        "name": "库存台账（对账）"
      },
      {
        "code": "erp.inv",
        "name": "库存查询（WMS）"
      },
      {
        "code": "erp.invstat",
        "name": "库存现有量统计"
      },
      {
        "code": "erp.iqc",
        "name": "IQC检验看板"
      },
      {
        "code": "erp.movement",
        "name": "出入库流水"
      },
      {
        "code": "erp.transfer",
        "name": "调拨单"
      },
      {
        "code": "erp.count",
        "name": "盘点单"
      },
      {
        "code": "erp.issue2",
        "name": "领料/发料"
      },
      {
        "code": "erp.so",
        "name": "销售订单"
      },
      {
        "code": "erp.ship",
        "name": "出货单"
      },
      {
        "code": "erp.po",
        "name": "采购订单"
      },
      {
        "code": "erp.gr",
        "name": "采购收货"
      },
      {
        "code": "erp.ar",
        "name": "应收账款"
      },
      {
        "code": "erp.ap",
        "name": "应付账款"
      },
      {
        "code": "erp.eq",
        "name": "设备保养台账"
      },
      {
        "code": "erp.maintplan",
        "name": "保养计划"
      },
      {
        "code": "erp.maintrec",
        "name": "保养记录"
      }
    ]
  }
];
