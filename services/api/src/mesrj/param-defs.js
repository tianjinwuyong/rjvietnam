// MES-ruijing 关键参数定义（逐字移植自源 api/basic.py PARAM_DEFS）
export const PARAM_DEFS = [
  {
    "group": "排产与填报",
    "key": "plan.hours_day",
    "name": "白班有效工时",
    "type": "num",
    "unit": "小时",
    "default": "10",
    "desc": "计划量 = 标准 UPH × 有效工时。08:00-20:00 是 12 小时，扣休息后按 10 小时算就填 10。"
  },
  {
    "group": "排产与填报",
    "key": "plan.hours_night",
    "name": "夜班有效工时",
    "type": "num",
    "unit": "小时",
    "default": "10",
    "desc": "夜班 20:00-次日 08:00。跨天班次请确认工时口径与白班一致。"
  },
  {
    "group": "排产与填报",
    "key": "board.daily_target",
    "name": "车间大屏日目标",
    "type": "num",
    "unit": "台",
    "default": "0",
    "desc": "大屏达成率的分母。0 = 不显示达成率。"
  },
  {
    "group": "防呆 · 必测工段",
    "key": "pack.require_stations",
    "name": "装箱前必须过的工段",
    "type": "text",
    "default": "ATE",
    "desc": "扫整机 SN 装箱时检查。多个用英文逗号分隔，按工段关键词匹配（ATE 会同时匹配 ATE1/ATE2）。"
  },
  {
    "group": "防呆 · 必测工段",
    "key": "bind.require_stations",
    "name": "绑码前必须过的工段",
    "type": "text",
    "default": "ICT,FCT",
    "desc": "绑码扫的是 PCBA SN（10 位），所以看 ICT/FCT，不是整机的 ATE。"
  },
  {
    "group": "防呆 · 必测工段",
    "key": "guard.require_stations",
    "name": "通用未检验判定工段",
    "type": "text",
    "default": "ICT,FCT",
    "desc": "公共防呆函数 guard_untested 的默认值；各入口有单独配置时以单独配置为准。"
  },
  {
    "group": "防呆 · 开关",
    "key": "pack.require_tested",
    "name": "装箱必须已测试",
    "type": "bool",
    "default": "1",
    "desc": "关掉后允许未测试的整机装箱（不建议）。"
  },
  {
    "group": "防呆 · 开关",
    "key": "bind.require_tested",
    "name": "绑码必须已测试",
    "type": "bool",
    "default": "1",
    "desc": "关掉后允许未过 ICT/FCT 的 PCBA 绑码（不建议）。"
  },
  {
    "group": "防呆 · 开关",
    "key": "pack.check_ng",
    "name": "装箱拦截未处理 NG",
    "type": "bool",
    "default": "1",
    "desc": "任一工位最近一次为 NG 的 SN 不许装箱。"
  },
  {
    "group": "打印",
    "key": "print.tpl_dir",
    "name": "标签模板目录",
    "type": "text",
    "default": "",
    "desc": "存放 .btw 模板的目录，如 E:\\5.越南瑞晶&东泰\\生产资料\\打印标签"
  },
  {
    "group": "时效管控",
    "key": "dwell.auto_enabled",
    "name": "时效定时扫描",
    "type": "bool",
    "default": "1",
    "desc": "关闭后只保留过站实时校验，不做定时呆滞扫描（源 run.py 的 dwell 扫描线程）。"
  },
  {
    "group": "时效管控",
    "key": "dwell.scan_minutes",
    "name": "扫描间隔（分钟）",
    "type": "num",
    "default": "60",
    "desc": "定时扫描「卡在原地不动」的在制 SN 的间隔，最小 10 分钟。"
  },
  {
    "group": "时效管控",
    "key": "dwell.days",
    "name": "扫描回看天数",
    "type": "num",
    "default": "7",
    "desc": "只扫最近 N 天内有过过站的 SN，避免老库存反复报。"
  },
  {
    "group": "防呆 · 装箱与栈板",
    "key": "pallet.check_ng",
    "name": "上栈板前查未处理不良",
    "type": "bool",
    "default": "1",
    "desc": "1 = 外箱里还有未处理不良的 SN 时不许上栈板；0 = 只记录不拦（源 api/pallet.py）。"
  },
  {
    "group": "防呆 · 员工工号",
    "key": "emp.require_emp",
    "name": "过站必须识别工号",
    "type": "bool",
    "default": "0",
    "desc": "1 = 设备过站没带工号直接拒收。分两步上线用：工牌发齐、员工档案维护好之后再打开（源 core/emp.py）。"
  },
  {
    "group": "镭雕发码",
    "key": "laser.keep_alive",
    "name": "保持长连接",
    "type": "bool",
    "default": "0",
    "desc": "1 = 镭雕机连上来后不主动关连接（有的设备重连很慢）；0 = 发完即关。"
  },
  {
    "group": "镭雕发码",
    "key": "laser.close_drain_ms",
    "name": "断开前等待（毫秒）",
    "type": "num",
    "default": "",
    "desc": "关连接前等设备把回包收完的时间，留空按 200ms。设备日志报「回包丢失」时调大。"
  },
  {
    "group": "OQC AQL",
    "key": "oqc.aql_level",
    "name": "默认检验水平",
    "type": "text",
    "default": "II",
    "desc": "I / II / III，新建抽检批时页面没选就按这个（源 core/oqc_aql.py）。"
  },
  {
    "group": "OQC AQL",
    "key": "oqc.aql_severity",
    "name": "默认检验严格度",
    "type": "text",
    "default": "normal",
    "desc": "normal / tightened / reduced（源 core/oqc_aql.py）。"
  },
  {
    "group": "OQC AQL",
    "key": "oqc.aql_ma",
    "name": "默认 AQL（主要）",
    "type": "num",
    "default": "1.0",
    "desc": "主要缺陷 AQL 值，缺省 1.0（源 core/oqc_aql.py）。"
  },
  {
    "group": "OQC AQL",
    "key": "oqc.aql_mi",
    "name": "默认 AQL（次要）",
    "type": "num",
    "default": "2.5",
    "desc": "次要缺陷 AQL 值，缺省 2.5（源 core/oqc_aql.py）。"
  },
  {
    "group": "OQC AQL",
    "key": "oqc.aql_lot_basis",
    "name": "批量口径",
    "type": "text",
    "default": "pallet",
    "desc": "pallet = 按栈板数量定批；box = 按外箱数量定批（源 core/oqc_aql.py）。"
  },
  {
    "group": "OQC AQL",
    "key": "oqc.sample_boxes",
    "name": "抽检箱数",
    "type": "num",
    "default": "",
    "desc": "固定抽几箱；留空按 AQL 抽样方案自动算（源 core/oqc.py）。"
  },
  {
    "group": "报表 · SPC",
    "key": "spc.lsl",
    "name": "SPC 控制下限",
    "type": "num",
    "default": "",
    "desc": "不良率低于这个值不算异常；留空不判（源 api/analyze.py）。"
  },
  {
    "group": "报表 · SPC",
    "key": "spc.usl",
    "name": "SPC 控制上限",
    "type": "num",
    "default": "",
    "desc": "不良率高于这个值标超限；留空不判（源 api/analyze.py）。"
  },
  {
    "group": "预警中心",
    "key": "alert.scan_minutes",
    "name": "预警巡检间隔（分钟）",
    "type": "num",
    "default": "10",
    "desc": "定时按 cfg_alert_rule 评估机台不良率的间隔（源 run.py 的 alert 扫描线程）。"
  }
];
