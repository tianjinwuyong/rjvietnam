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
  }
];
