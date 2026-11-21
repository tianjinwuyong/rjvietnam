// Cadence for every enabled virtual employee. Frequencies are derived from the
// nature of the task, not from a uniform interval:
//   EVENT  - triggered by a business event; no polling, bounded latency
//   WATCH  - polls a state whose cost grows with time; deterministic check,
//            model called only when a threshold is crossed
//   BATCH  - fixed local-time window (Vietnam, UTC+7)
//   DEMAND - only when a human or another employee requests it
//
// This is loop cadence, NOT LLM call frequency. `llmBudgetPerDay` is the hard
// cap on model invocations; every entry stays at or under 20/day because the
// measured human approval ceiling is ~30 tasks/person/day.

export const CADENCE_KIND = Object.freeze({
  EVENT: "EVENT", WATCH: "WATCH", BATCH: "BATCH", DEMAND: "DEMAND",
});

export const TIMEZONE = "Asia/Ho_Chi_Minh"; // UTC+7

// One cadence row. The fields a row must carry depend on its kind (BATCH needs
// `cron`+`window`, WATCH needs the intervals, …), which is what
// validateFrequencies() checks at runtime; declaring the widest shape here keeps
// that check readable instead of splitting the table into five literal unions
// the compiler then refuses to index uniformly.
/**
 * @typedef {{
 *   kind: "EVENT" | "WATCH" | "BATCH" | "DEMAND",
 *   event?: string,
 *   cron?: string,
 *   window?: string,
 *   intervalSeconds?: number,
 *   maxLatencySeconds?: number,
 *   llmBudgetPerDay: number,
 *   note: string,
 *   secondary?: { kind: "EVENT" | "WATCH" | "BATCH" | "DEMAND", cron?: string, note?: string },
 * }} Cadence
 */

// intervalSeconds thresholds mirror factory_virtual_employee_configs
// (interval_seconds INTEGER DEFAULT 300 CHECK(interval_seconds>=60)).
/** @type {Readonly<Record<string, Cadence>>} */
export const FREQUENCIES = Object.freeze({
  // ---- 指挥 ----
  "OPS-SUPERVISOR-VIRTUAL-01": { kind: "EVENT", event: "TASK_ESCALATED|KPI_BREACH", intervalSeconds: 300, maxLatencySeconds: 30, llmBudgetPerDay: 20, note: "派工即时；KPI/队列每 5 分钟兜底扫描" },

  // ---- D1 来料与仓储 ----
  "WMS-SUPERVISOR-VIRTUAL-01": { kind: "EVENT", event: "D1_QUEUE_CONFLICT", intervalSeconds: 300, maxLatencySeconds: 60, llmBudgetPerDay: 10, note: "只在多岗争单或冻结冲突时仲裁" },
  "WMS-RECEIVING-VIRTUAL-01": { kind: "EVENT", event: "INCOMING_RECORD_CREATED|ASN_CONFIRMED", intervalSeconds: 300, maxLatencySeconds: 60, llmBudgetPerDay: 20, note: "PDA 扫码事件驱动；保留现有 300s 兜底扫描" },
  "WMS-IQC-HANDOFF-VIRTUAL-01": { kind: "EVENT", event: "RECEIVING_COMPLETED", intervalSeconds: 300, maxLatencySeconds: 60, llmBudgetPerDay: 20, note: "每批收料完成即建交接任务" },
  "WMS-INVENTORY-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 300, maxLatencySeconds: 300, llmBudgetPerDay: 20, note: "安全库存/库位冲突随时间恶化；确定性规则先行", secondary: { kind: "BATCH", cron: "0 6,12,18,0 * * *", note: "安全库存报告每 6 小时；WAREHOUSE_SAFETY_REPORT_INTERVAL_MS 可调，最短 5 分钟" } },
  "WMS-COUNT-VIRTUAL-01": { kind: "BATCH", cron: "0 22 * * *", window: "22:00", llmBudgetPerDay: 5, note: "按班次结束盘点；白天不跑" },
  "WMS-ISSUE-VIRTUAL-01": { kind: "EVENT", event: "PICK_REQUESTED|PACKAGE_UNRECEIVED", intervalSeconds: 300, maxLatencySeconds: 120, llmBudgetPerDay: 20, note: "配送请求事件驱动；SLA 超时兜底扫描" },
  "MSD-CONTROL-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 60, maxLatencySeconds: 60, llmBudgetPerDay: 5, note: "车间寿命按分钟计时；只有阈值跨越才调模型" },

  // ---- D2 计划与采购 ----
  "PMC-VIRTUAL-01": { kind: "BATCH", cron: "0 6 * * 1-6", window: "06:00（周一至周六）", llmBudgetPerDay: 10, note: "MPS/MRP 每日跑；缺料事件可插队" },
  "PURCHASING-VIRTUAL-01": { kind: "EVENT", event: "PO_CONFIRMED|ASN_UPDATED|ETA_CHANGED", intervalSeconds: 900, maxLatencySeconds: 300, llmBudgetPerDay: 20, note: "跟单事件驱动；工作时段每小时汇总" },
  "SUPPLIER-COLLAB-VIRTUAL-01": { kind: "BATCH", cron: "0 * * * *", window: "每小时", llmBudgetPerDay: 10, note: "门户同步是批量对齐，不是实时链路" },

  // ---- D3 制造执行 ----
  "MES-VIRTUAL-01": { kind: "EVENT", event: "WORK_ORDER_RELEASED|STATION_PASS", intervalSeconds: 300, maxLatencySeconds: 30, llmBudgetPerDay: 20, note: "过站校验必须近实时，但判定本身是确定性规则" },
  "SMT-LOOP-VIRTUAL-01": { kind: "EVENT", event: "FEEDER_CHANGED|REEL_CONSUMED", intervalSeconds: 300, maxLatencySeconds: 60, llmBudgetPerDay: 20, note: "上料/换料事件驱动，按站机节拍" },
  "ANDON-VIRTUAL-01": { kind: "EVENT", event: "ANDON_CALLED", intervalSeconds: 300, maxLatencySeconds: 15, llmBudgetPerDay: 5, note: "呼叫即刻升级；不依赖模型检测" },
  "PACK-VIRTUAL-01": { kind: "EVENT", event: "ORDER_READY_TO_PACK", intervalSeconds: 900, maxLatencySeconds: 300, llmBudgetPerDay: 10, note: "按订单完成包装，非连续动作" },

  // ---- D4 品质 ----
  "QUALITY-VIRTUAL-01": { kind: "EVENT", event: "NCR_OPENED|CAPA_DUE", intervalSeconds: 600, maxLatencySeconds: 300, llmBudgetPerDay: 20, note: "不合格闭环事件驱动；每日汇总一次" },
  "IQC-VIRTUAL-01": { kind: "EVENT", event: "LOT_HANDED_TO_IQC", intervalSeconds: 300, maxLatencySeconds: 120, llmBudgetPerDay: 20, note: "逐批判定；唯一 ACTIVE_EXECUTOR，样板岗位" },
  "OQC-VIRTUAL-01": { kind: "EVENT", event: "BATCH_READY_FOR_OQC", intervalSeconds: 600, maxLatencySeconds: 300, llmBudgetPerDay: 20, note: "AQL 抽样按出货批次" },
  "TRACE-VIRTUAL-01": { kind: "DEMAND", event: "TRACE_QUERY|ECN_SUBMITTED|RECALL_REQUEST", llmBudgetPerDay: 5, note: "追溯与影响面按需；每日只做索引自检" },

  // ---- D5 设备与工程 ----
  "MAINTENANCE-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 300, maxLatencySeconds: 300, llmBudgetPerDay: 10, note: "设备健康连续监控；PM 计划每日 07:00" },
  "STATION-EQUIP-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 60, maxLatencySeconds: 60, llmBudgetPerDay: 5, note: "站机程序版本/复判每分钟轮询，异常才调模型" },
  "REPAIR-VIRTUAL-01": { kind: "EVENT", event: "NG_RECORDED|REWORK_OPENED", intervalSeconds: 600, maxLatencySeconds: 120, llmBudgetPerDay: 10, note: "按不良事件分诊；二次返工立即升级" },

  // ---- D6 商务财务 ----
  "FINANCE-VIRTUAL-01": { kind: "BATCH", cron: "0 18 * * 1-6", window: "18:00（周一至周六）", llmBudgetPerDay: 10, note: "三单匹配按日对账；付款请求事件可插队" },
  "SALES-VIRTUAL-01": { kind: "EVENT", event: "ORDER_CREATED|DELIVERY_PROMISE_REQUEST", intervalSeconds: 1800, maxLatencySeconds: 300, llmBudgetPerDay: 10, note: "报价/交期按需，工作时段每半小时扫描" },
  "E-INVOICE-VIRTUAL-01": { kind: "EVENT", event: "SHIPMENT_CONFIRMED|INVOICE_REQUIRED", intervalSeconds: 1800, maxLatencySeconds: 300, llmBudgetPerDay: 10, note: "开票按出货事件；每日 17:00 查漏" },

  "OA-DOCUMENT-CONTROL-VIRTUAL-01": { kind: "EVENT", event: "DOCUMENT_SUBMITTED|APPROVAL_STEP_DONE", intervalSeconds: 300, maxLatencySeconds: 120, llmBudgetPerDay: 20, note: "审批包事件驱动；已有 5 分钟 SLA monitor（server.js:22097）" },
  "HR-VIRTUAL-01": { kind: "BATCH", cron: "30 7 * * 1-6", window: "07:30（周一至周六）", llmBudgetPerDay: 5, note: "考勤与排班按班前处理；资质到期事件插队" },
  "SAFETY-VIRTUAL-01": { kind: "EVENT", event: "HAZARD_REPORTED", intervalSeconds: 300, maxLatencySeconds: 60, llmBudgetPerDay: 5, note: "隐患上报即刻分级；严重项立即升级人类" },

  // ---- D8 平台 IT ----
  "APP-OPS-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 60, maxLatencySeconds: 60, llmBudgetPerDay: 5, note: "员工层 60 秒（DB CHECK 下限）；已有 watchdog 30 秒级巡检，异常才唤醒模型" },
  "INFRA-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 60, maxLatencySeconds: 60, llmBudgetPerDay: 5, note: "主机/网络/容器指标按分钟" },
  "DATABASE-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 300, maxLatencySeconds: 300, llmBudgetPerDay: 5, note: "慢查询/复制按 5 分钟；模式漂移每日 03:00" },
  "INTEGRATION-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 300, maxLatencySeconds: 300, llmBudgetPerDay: 5, note: "契约/镜像比对按 5 分钟，连续两期红才升级" },
  "SECURITY-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 300, maxLatencySeconds: 300, llmBudgetPerDay: 5, note: "访问审计按 5 分钟；密钥扫描每日 01:00" },
  "PDA-FLEET-VIRTUAL-01": { kind: "WATCH", intervalSeconds: 60, maxLatencySeconds: 60, llmBudgetPerDay: 5, note: "设备心跳按分钟，与 pdaCommMonitor 一致" },
  "BACKUP-VIRTUAL-01": { kind: "BATCH", cron: "30 2 * * *", window: "02:30 每日；周日演练", llmBudgetPerDay: 5, note: "备份校验按日，恢复演练按周" },
  "RELEASE-VIRTUAL-01": { kind: "DEMAND", event: "GATE_PASSED|DEPLOY_REQUESTED", llmBudgetPerDay: 5, note: "只在发布门通过或被请求时运行，禁止轮询生产" },
  "REPORTS-VIRTUAL-01": { kind: "BATCH", cron: "0 * * * *", window: "每小时刷新；07:00 日报", llmBudgetPerDay: 5, note: "指标字典按需查，报表按小时/日刷新" },
});

export function cadenceFor(employeeId) {
  return FREQUENCIES[String(employeeId || "").toUpperCase()] ?? null;
}

// Machine-checkable contract for the config above. Returns an array of errors;
// empty means the frequency table is internally consistent.
export function validateFrequencies(enabledIds = []) {
  const errors = [];
  for (const [id, c] of Object.entries(FREQUENCIES)) {
    if (!Object.values(CADENCE_KIND).includes(c.kind)) errors.push(`${id}: unknown kind ${c.kind}`);
    if (!Number.isInteger(c.llmBudgetPerDay) || c.llmBudgetPerDay < 1 || c.llmBudgetPerDay > 20) {
      errors.push(`${id}: llmBudgetPerDay out of 1..20`);
    }
    if (c.kind === "WATCH") {
      if (!Number.isInteger(c.intervalSeconds) || c.intervalSeconds < 60 || c.intervalSeconds > 86400) {
        errors.push(`${id}: WATCH interval_seconds must be 60..86400`);
      }
      if (!Number.isInteger(c.maxLatencySeconds) || c.maxLatencySeconds < c.intervalSeconds) {
        errors.push(`${id}: maxLatencySeconds must be >= intervalSeconds for WATCH`);
      }
    }
    if (c.kind === "EVENT" && (!c.event || !Number.isInteger(c.maxLatencySeconds))) {
      errors.push(`${id}: EVENT needs event + maxLatencySeconds`);
    }
    if (c.kind === "BATCH" && (!c.cron || !c.window)) errors.push(`${id}: BATCH needs cron + window`);
    if (c.kind === "DEMAND" && !c.event) errors.push(`${id}: DEMAND needs event`);
  }
  for (const id of enabledIds) {
    if (!FREQUENCIES[id]) errors.push(`${id}: enabled employee has no cadence`);
  }
  return errors;
}
