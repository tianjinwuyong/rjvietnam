// ============================================================================
// W18 ERP 叶子 → SMT 规范屏「跳转」登记表（决策 b：不重复做 UI，指向唯一真源）
//
// 为什么不复制一份 ERP 表格：SMT 已有 procurement/sales/finance/wms/maintenance…
// 这些规范屏在渲染同一批 canonical 表（实测有真实数据）。再套一层 ERP 皮 = 两套
// UI 对同一数据，迟早漂移 —— 与 grafting-protocol 禁止影子表同理。
//
// 落地方式：模块选择本来就是 hash 驱动（App.tsx:3120 `#<module>` + hashchange），
// 所以叶子只需给一张「在 SMT 中打开」卡片，链接到对应模块；不往共享 App.tsx 里塞
// 任何 prop。目标模块的 tab 深链是渐进增强（HR 已有 ?hrTab= 先例），这里先只跳模块。
// ============================================================================

export interface Jump {
  /** 目标模块 key（App.tsx ModuleKey 之一） */
  module: string;
  /** 人类可读的目标屏（三语走 labels w18j.*） */
  labelKey: string;
}

// 源 erp.* 叶子 code → SMT 规范模块
export const ERP_JUMP: Record<string, Jump> = {
  "erp.supplier":   { module: "procurement", labelKey: "w18j.suppliers" },
  "erp.customer2":  { module: "pmc",         labelKey: "w18j.customers" },
  "erp.material2":  { module: "wms",         labelKey: "w18j.materials" },
  "erp.warehouse":  { module: "mes",         labelKey: "w18j.warehouses" },
  "erp.bom":        { module: "bom",         labelKey: "w18j.bom" },
  "erp.inv":        { module: "wms",         labelKey: "w18j.inventory" },
  "erp.stock":      { module: "wms",         labelKey: "w18j.inventory" },
  "erp.invstat":    { module: "wms",         labelKey: "w18j.inventory" },
  "erp.iqc":        { module: "quality",     labelKey: "w18j.iqc" },
  "erp.movement":   { module: "wms",         labelKey: "w18j.transactions" },
  "erp.transfer":   { module: "wms",         labelKey: "w18j.transfers" },
  "erp.count":      { module: "wms",         labelKey: "w18j.cycleCount" },
  "erp.issue2":     { module: "wms",         labelKey: "w18j.issuing" },
  "erp.so":         { module: "sales",       labelKey: "w18j.salesOrders" },
  "erp.ship":       { module: "sales",       labelKey: "w18j.shipments" },
  "erp.po":         { module: "procurement", labelKey: "w18j.purchaseOrders" },
  "erp.gr":         { module: "wms",         labelKey: "w18j.receiving" },
  "erp.ar":         { module: "finance",     labelKey: "w18j.receivables" },
  "erp.ap":         { module: "finance",     labelKey: "w18j.payables" },
  "erp.contract":   { module: "procurement", labelKey: "w18j.contracts" },
  "erp.eq":         { module: "maintenance", labelKey: "w18j.equipment" },
  "erp.maintplan":  { module: "maintenance", labelKey: "w18j.maintPlans" },
  "erp.maintrec":   { module: "maintenance", labelKey: "w18j.maintRecords" },
  "erp.alerts":     { module: "pmc",         labelKey: "w18j.alerts" },
};
