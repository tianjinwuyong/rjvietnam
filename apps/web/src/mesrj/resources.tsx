// MES-ruijing 页面注册表 —— 菜单 code → 视图（通用 CRUD 页由字段清单驱动）
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "./i18n";
import { MesrjCrudPage, enabledOptions, type FieldDef } from "./GenericList";

const S = (locale: Locale) => enabledOptions(locale);

/** 12 个 md 通用资源 + sys 用户/角色的字段清单（列序 = 表格列序） */
export interface CrudViewConfig {
  code: string;
  basePath: string;
  res: string;
  fields: FieldDef[];
  filters?: FieldDef[];
}

function statusField(locale: Locale): FieldDef {
  return { key: "status", labelKey: "field.status", type: "bool", options: S(locale) };
}

export function crudViews(locale: Locale): CrudViewConfig[] {
  return [
    {
      code: "md.customer", basePath: "md", res: "customer",
      fields: [
        { key: "cust_code", labelKey: "md.customer.cust_code", required: true },
        { key: "cust_name", labelKey: "md.customer.cust_name", required: true },
        { key: "short_name", labelKey: "md.customer.short_name" },
        { key: "country", labelKey: "md.customer.country" },
        statusField(locale),
        { key: "remark", labelKey: "field.remark" },
      ],
    },
    {
      code: "md.material", basePath: "md", res: "material",
      fields: [
        { key: "material_code", labelKey: "md.material.material_code", required: true },
        { key: "vn_code", labelKey: "md.material.vn_code" },
        { key: "material_name", labelKey: "md.material.material_name" },
        { key: "spec", labelKey: "md.product.spec" },
        { key: "unit", labelKey: "md.product.unit" },
        { key: "mpq", labelKey: "md.material.mpq", type: "number" },
        { key: "loss_rate", labelKey: "md.material.loss_rate", type: "number" },
        { key: "maker", labelKey: "md.material.maker" },
        { key: "category", labelKey: "md.material.category" },
        { key: "is_aux", labelKey: "md.material.is_aux", type: "bool", options: [{ v: "1", t: t("common.yes", locale) }, { v: "0", t: t("common.no", locale) }] },
        statusField(locale),
      ],
      filters: [
        { key: "is_aux", labelKey: "md.material.is_aux", type: "bool", options: [{ v: "1", t: t("common.yes", locale) }, { v: "0", t: t("common.no", locale) }] },
        statusField(locale),
      ],
    },
    {
      code: "md.product", basePath: "md", res: "product",
      fields: [
        { key: "product_code", labelKey: "md.product.product_code", required: true },
        { key: "product_name", labelKey: "md.product.product_name" },
        { key: "product_model", labelKey: "md.product.product_model" },
        { key: "product_type", labelKey: "md.product.product_type", type: "select", options: [{ v: "FG", t: "FG" }, { v: "SFG", t: "SFG" }] },
        { key: "cust_code", labelKey: "md.product.cust_code" },
        { key: "spec", labelKey: "md.product.spec" },
        { key: "unit", labelKey: "md.product.unit" },
        statusField(locale),
      ],
      filters: [statusField(locale)],
    },
    {
      code: "md.line", basePath: "md", res: "line",
      fields: [
        { key: "line_code", labelKey: "md.line.line_code", required: true },
        { key: "line_name", labelKey: "md.line.line_name", required: true },
        { key: "line_type", labelKey: "md.line.line_type" },
        { key: "process_code", labelKey: "field.process_code" },
        { key: "tact_time", labelKey: "md.line.tact_time", type: "number" },
        { key: "plan_hours", labelKey: "md.line.plan_hours", type: "number" },
        statusField(locale),
      ],
      filters: [statusField(locale)],
    },
    {
      code: "md.station", basePath: "md", res: "station",
      fields: [
        { key: "station_code", labelKey: "md.station.station_code", required: true },
        { key: "station_name", labelKey: "md.station.station_name", required: true },
        { key: "short_name", labelKey: "md.station.short_name" },
        { key: "line_code", labelKey: "field.line_code" },
        { key: "process_code", labelKey: "field.process_code" },
        { key: "seq_no", labelKey: "md.station.seq_no", type: "number" },
        { key: "station_type", labelKey: "md.station.station_type" },
        statusField(locale),
      ],
      filters: [statusField(locale)],
    },
    {
      code: "md.track", basePath: "md", res: "track",
      fields: [
        { key: "track_code", labelKey: "md.track.track_code", required: true },
        { key: "track_name", labelKey: "md.track.track_name" },
        statusField(locale),
        { key: "remark", labelKey: "field.remark" },
      ],
    },
    {
      code: "dev.machinesource", basePath: "md", res: "machine-source",
      fields: [
        { key: "machine_no", labelKey: "md.machine-source.machine_no", required: true },
        { key: "line_code", labelKey: "field.line_code", required: true },
        { key: "station_code", labelKey: "md.machine-source.station_code", required: true },
        { key: "track", labelKey: "md.machine-source.track" },
        { key: "mo_hint", labelKey: "md.machine-source.mo_hint" },
        { key: "enabled", labelKey: "common.enabled.y", type: "bool", options: S(locale) },
      ],
      filters: [{ key: "enabled", labelKey: "common.enabled.y", type: "bool", options: S(locale) }],
    },
    {
      code: "md.equipment", basePath: "md", res: "equipment",
      fields: [
        { key: "equip_code", labelKey: "md.equipment.equip_code", required: true },
        { key: "equip_name", labelKey: "md.equipment.equip_name", required: true },
        { key: "equip_type", labelKey: "md.equipment.equip_type" },
        { key: "model", labelKey: "md.equipment.model" },
        { key: "brand", labelKey: "md.equipment.brand" },
        { key: "line_code", labelKey: "field.line_code" },
        { key: "connect_mode", labelKey: "md.equipment.connect_mode" },
        statusField(locale),
      ],
      filters: [statusField(locale)],
    },
    {
      code: "md.defect", basePath: "md", res: "defect",
      fields: [
        { key: "defect_code", labelKey: "md.defect.defect_code", required: true },
        { key: "name_cn", labelKey: "md.defect.name_cn", required: true },
        { key: "name_en", labelKey: "md.defect.name_en" },
        { key: "name_vi", labelKey: "md.defect.name_vi" },
        { key: "process_code", labelKey: "field.process_code" },
        { key: "category", labelKey: "md.defect.category", type: "select", options: [{ v: "Minor", t: "Minor" }, { v: "Major", t: "Major" }, { v: "Critical", t: "Critical" }] },
        { key: "can_retest", labelKey: "md.defect.can_retest", type: "bool", options: [{ v: "1", t: t("common.yes", locale) }, { v: "0", t: t("common.no", locale) }] },
        { key: "is_scrap", labelKey: "md.defect.is_scrap", type: "bool", options: [{ v: "1", t: t("common.yes", locale) }, { v: "0", t: t("common.no", locale) }] },
        statusField(locale),
      ],
      filters: [statusField(locale)],
    },
    {
      code: "md.rootcause", basePath: "md", res: "rootcause",
      fields: [
        { key: "rc_code", labelKey: "md.rootcause.rc_code", required: true },
        { key: "name_cn", labelKey: "md.defect.name_cn", required: true },
        { key: "name_en", labelKey: "md.defect.name_en" },
        { key: "name_vi", labelKey: "md.defect.name_vi" },
        { key: "description", labelKey: "md.rootcause.description" },
        statusField(locale),
      ],
    },
    {
      code: "md.shift", basePath: "md", res: "shift",
      fields: [
        { key: "shift_code", labelKey: "md.shift.shift_code", required: true },
        { key: "shift_name", labelKey: "md.shift.shift_name", required: true },
        { key: "begin_time", labelKey: "md.shift.begin_time" },
        { key: "end_time", labelKey: "md.shift.end_time" },
        { key: "cross_day", labelKey: "md.shift.cross_day", type: "bool", options: [{ v: "1", t: t("common.yes", locale) }, { v: "0", t: t("common.no", locale) }] },
        statusField(locale),
      ],
    },
    {
      code: "md.calendar", basePath: "md", res: "calendar",
      fields: [
        { key: "cal_date", labelKey: "md.calendar.cal_date", required: true },
        { key: "line_code", labelKey: "field.line_code" },
        { key: "is_workday", labelKey: "md.calendar.is_workday", type: "bool", options: [{ v: "1", t: t("common.yes", locale) }, { v: "0", t: t("common.no", locale) }] },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [{ key: "is_workday", labelKey: "md.calendar.is_workday", type: "bool", options: [{ v: "1", t: t("common.yes", locale) }, { v: "0", t: t("common.no", locale) }] }],
    },
    {
      code: "sys.user", basePath: "sys", res: "user",
      fields: [
        { key: "login_name", labelKey: "sys.user.login_name", required: true },
        { key: "emp_name", labelKey: "sys.user.emp_name", required: true },
        { key: "dept", labelKey: "sys.user.dept" },
        { key: "phone", labelKey: "sys.user.phone" },
        statusField(locale),
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [statusField(locale)],
    },
    {
      code: "sys.role", basePath: "sys", res: "role",
      fields: [
        { key: "role_code", labelKey: "sys.role.role_code", required: true },
        { key: "role_name", labelKey: "sys.role.role_name", required: true },
        { key: "remark", labelKey: "field.remark" },
      ],
    },
    // ── W4：bom / order / plan ──
    {
      code: "bom.header", basePath: "bom", res: "header",
      fields: [
        { key: "product_code", labelKey: "md.product.product_code", required: true },
        { key: "version", labelKey: "bom.header.version", required: true },
        { key: "cust_code", labelKey: "md.product.cust_code" },
        { key: "eff_date", labelKey: "bom.header.eff_date" },
        { key: "status", labelKey: "bom.header.status" },
        { key: "src_file", labelKey: "bom.header.src_file", readonly: true },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [
        { key: "status", labelKey: "bom.header.status", type: "select", options: [{ v: "有效", t: "有效" }, { v: "停用", t: "停用" }] },
      ],
    },
    {
      code: "bom.item", basePath: "bom", res: "item",
      fields: [
        { key: "product_code", labelKey: "md.product.product_code", required: true },
        { key: "version", labelKey: "bom.header.version" },
        { key: "item_type", labelKey: "bom.item.item_type", type: "select", options: [{ v: "RM", t: "RM" }, { v: "SFG", t: "SFG" }] },
        { key: "material_code", labelKey: "md.material.material_code", required: true },
        { key: "material_name", labelKey: "md.material.material_name" },
        { key: "segment", labelKey: "bom.item.segment" },
        { key: "wo_type", labelKey: "bom.item.wo_type" },
        { key: "qty_per", labelKey: "bom.item.qty_per", type: "number" },
        { key: "unit", labelKey: "md.product.unit" },
        { key: "mpq", labelKey: "md.material.mpq", type: "number" },
        { key: "pos_ref", labelKey: "bom.item.pos_ref" },
        { key: "is_alt", labelKey: "bom.item.is_alt", type: "bool", options: [{ v: "1", t: t("common.yes", locale) }, { v: "0", t: t("common.no", locale) }] },
        { key: "alt_group", labelKey: "bom.item.alt_group" },
        { key: "vn_code", labelKey: "md.material.vn_code", readonly: true },
        { key: "model", labelKey: "md.product.product_model", readonly: true },
      ],
      filters: [
        { key: "segment", labelKey: "bom.item.segment" },
        { key: "item_type", labelKey: "bom.item.item_type", type: "select", options: [{ v: "RM", t: "RM" }, { v: "SFG", t: "SFG" }] },
      ],
    },
    {
      code: "po", basePath: "order", res: "po",
      fields: [
        { key: "po_no", labelKey: "po.po_no", required: true },
        { key: "po_line", labelKey: "po.po_line" },
        { key: "cust_code", labelKey: "md.customer.cust_code" },
        { key: "product_code", labelKey: "md.product.product_code", required: true },
        { key: "order_qty", labelKey: "po.order_qty", type: "number", required: true },
        { key: "delivery_date", labelKey: "po.delivery_date" },
        { key: "status", labelKey: "field.status" },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [{ key: "status", labelKey: "field.status" }],
    },
    {
      code: "mo", basePath: "order", res: "mo",
      fields: [
        { key: "mo_no", labelKey: "mo.mo_no", readonly: true },
        { key: "status", labelKey: "field.status" },
        { key: "fg_code", labelKey: "mo.fg_code", readonly: true },
        { key: "product_code", labelKey: "md.product.product_code", readonly: true },
        { key: "product_model", labelKey: "md.product.product_model", readonly: true },
        { key: "product_name", labelKey: "md.product.product_name", readonly: true },
        { key: "po_no", labelKey: "po.po_no", readonly: true },
        { key: "plan_qty", labelKey: "mo.plan_qty", type: "number" },
        { key: "out_qty", labelKey: "mo.out_qty", readonly: true },
        { key: "line_code", labelKey: "field.line_code" },
        { key: "plan_start", labelKey: "mo.plan_start" },
        { key: "plan_end", labelKey: "mo.plan_end" },
        { key: "eta_hours", labelKey: "mo.eta_hours", readonly: true },
        { key: "eta_at", labelKey: "mo.eta_at", readonly: true },
        { key: "eta_bottleneck", labelKey: "mo.eta_bottleneck", readonly: true },
        { key: "actual_start", labelKey: "mo.actual_start", readonly: true },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [
        { key: "status", labelKey: "field.status" },
        { key: "type_code", labelKey: "mo.type_code", type: "select", options: [{ v: "1", t: "正单" }, { v: "2", t: "备品" }, { v: "3", t: "返单" }] },
      ],
    },
    {
      code: "replenish", basePath: "order", res: "replenish",
      fields: [
        { key: "rep_no", labelKey: "replenish.rep_no", readonly: true },
        { key: "mo_no", labelKey: "mo.mo_no", required: true },
        { key: "material_code", labelKey: "md.material.material_code", required: true },
        { key: "qty", labelKey: "po.order_qty", type: "number" },
        { key: "reason", labelKey: "replenish.reason" },
        { key: "status", labelKey: "field.status" },
      ],
      filters: [{ key: "status", labelKey: "field.status" }],
    },
    {
      code: "issueitem", basePath: "order", res: "issueitem",
      fields: [
        { key: "issue_no", labelKey: "issue.issue_no", readonly: true },
        { key: "line_seq", labelKey: "issue.line_seq", readonly: true },
        { key: "material_code", labelKey: "md.material.material_code" },
        { key: "material_name", labelKey: "md.material.material_name" },
        { key: "segment", labelKey: "bom.item.segment", readonly: true },
        { key: "qty_per", labelKey: "bom.item.qty_per", type: "number" },
        { key: "need_qty", labelKey: "issue.need_qty", type: "number" },
        { key: "issue_qty", labelKey: "issue.issue_qty", type: "number" },
        { key: "is_substitute", labelKey: "issue.is_substitute", readonly: true },
      ],
      filters: [{ key: "issue_no", labelKey: "issue.issue_no" }],
    },
    {
      code: "plan.schedule", basePath: "plan", res: "schedule",
      fields: [
        { key: "plan_date", labelKey: "md.calendar.cal_date", required: true },
        { key: "shift_code", labelKey: "plan.shift", type: "select", options: [{ v: "DAY", t: "白班" }, { v: "NIGHT", t: "夜班" }] },
        { key: "line_code", labelKey: "field.line_code", required: true },
        { key: "mo_no", labelKey: "mo.mo_no", required: true },
        { key: "product_code", labelKey: "md.product.product_code" },
        { key: "process", labelKey: "field.process_code" },
        { key: "plan_qty", labelKey: "mo.plan_qty", type: "number" },
        { key: "seq_no", labelKey: "md.station.seq_no", type: "number" },
        { key: "status", labelKey: "field.status", type: "select", options: [{ v: "计划中", t: "计划中" }, { v: "执行中", t: "执行中" }, { v: "已完成", t: "已完成" }, { v: "已取消", t: "已取消" }] },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [
        { key: "status", labelKey: "field.status" },
        { key: "shift_code", labelKey: "plan.shift", type: "select", options: [{ v: "DAY", t: "白班" }, { v: "NIGHT", t: "夜班" }] },
      ],
    },
    {
      code: "plan.capacity", basePath: "plan", res: "capacity",
      fields: [
        { key: "line_code", labelKey: "field.line_code", required: true },
        { key: "shift_code", labelKey: "plan.shift", type: "select", options: [{ v: "DAY", t: "白班" }, { v: "NIGHT", t: "夜班" }] },
        { key: "tact_time", labelKey: "md.line.tact_time", type: "number" },
        { key: "capacity", labelKey: "plan.capacity_n", type: "number" },
        { key: "status", labelKey: "field.status", type: "bool", options: S(locale) },
      ],
      filters: [{ key: "shift_code", labelKey: "plan.shift", type: "select", options: [{ v: "DAY", t: "白班" }, { v: "NIGHT", t: "夜班" }] }],
    },
    // ── W5：route / cfg ──
    {
      code: "route.rule", basePath: "route", res: "rule",
      fields: [
        { key: "station_code", labelKey: "md.station.station_code", required: true },
        { key: "rule_type", labelKey: "route.rule.rule_type", required: true },
        { key: "rule_name", labelKey: "route.rule.rule_name" },
        { key: "param", labelKey: "route.rule.param" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [
        { key: "station_code", labelKey: "md.station.station_code" },
        { key: "rule_type", labelKey: "route.rule.rule_type" },
      ],
    },
    {
      code: "cfg.dict", basePath: "cfg", res: "dict",
      fields: [
        { key: "dict_type", labelKey: "cfg.dict.dict_type", required: true },
        { key: "code", labelKey: "cfg.dict.code", required: true },
        { key: "name", labelKey: "cfg.dict.name", required: true },
        { key: "sort_no", labelKey: "md.station.seq_no", type: "number" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
      ],
      filters: [{ key: "dict_type", labelKey: "cfg.dict.dict_type" }],
    },
    {
      code: "cfg.threshold", basePath: "cfg", res: "threshold",
      fields: [
        { key: "th_key", labelKey: "cfg.threshold.th_key", required: true },
        { key: "th_name", labelKey: "cfg.threshold.th_name", required: true },
        { key: "apply_to", labelKey: "cfg.threshold.apply_to" },
        { key: "threshold", labelKey: "cfg.threshold.threshold", type: "number" },
        { key: "action", labelKey: "cfg.threshold.action" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
      ],
      filters: [{ key: "apply_to", labelKey: "cfg.threshold.apply_to" }],
    },
    {
      code: "cfg.pokayoke", basePath: "cfg", res: "pokayoke",
      fields: [
        { key: "rule_key", labelKey: "cfg.pokayoke.rule_key", required: true },
        { key: "rule_name", labelKey: "cfg.pokayoke.rule_name", required: true },
        { key: "scope", labelKey: "cfg.pokayoke.scope" },
        { key: "rule_json", labelKey: "cfg.pokayoke.rule_json" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [{ key: "scope", labelKey: "cfg.pokayoke.scope" }],
    },
    {
      code: "cfg.snrule", basePath: "cfg", res: "snrule",
      fields: [
        { key: "sn_type", labelKey: "cfg.snrule.sn_type", required: true },
        { key: "total_len", labelKey: "cfg.snrule.total_len", type: "number" },
        { key: "segments", labelKey: "cfg.snrule.segments" },
        { key: "cur_seq", labelKey: "cfg.snrule.cur_seq", type: "number" },
        { key: "reset_cycle", labelKey: "cfg.snrule.reset_cycle" },
        { key: "sample", labelKey: "cfg.snrule.sample", readonly: true },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [],
    },
    {
      code: "cfg.packrule", basePath: "cfg", res: "packrule",
      fields: [
        { key: "product_code", labelKey: "md.product.product_code", required: true },
        { key: "machine_model", labelKey: "md.product.product_model", required: true },
        { key: "model_code", labelKey: "cfg.packrule.model_code" },
        { key: "supplier_code", labelKey: "cfg.packrule.supplier_code" },
        { key: "factory_code", labelKey: "cfg.packrule.factory_code" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
      ],
      filters: [{ key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) }],
    },
    {
      code: "cfg.printtpl", basePath: "cfg", res: "print_tpl",
      fields: [
        { key: "tpl_code", labelKey: "cfg.printtpl.tpl_code", required: true },
        { key: "tpl_name", labelKey: "cfg.printtpl.tpl_name", required: true },
        { key: "tpl_type", labelKey: "cfg.printtpl.tpl_type" },
        { key: "file_name", labelKey: "cfg.printtpl.file_name" },
        { key: "product_code", labelKey: "md.product.product_code" },
        { key: "sort_no", labelKey: "md.station.seq_no", type: "number" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
      ],
      filters: [{ key: "tpl_type", labelKey: "cfg.printtpl.tpl_type" }],
    },
    {
      code: "cfg.pcbcode", basePath: "cfg", res: "pcbcode",
      fields: [
        { key: "product_code", labelKey: "md.product.product_code", required: true },
        { key: "machine_model", labelKey: "md.product.product_model" },
        { key: "pcb_code", labelKey: "cfg.pcbcode.pcb_code" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
      ],
      filters: [],
    },
    {
      code: "cfg.aoipoints", basePath: "cfg", res: "aoipoints",
      fields: [
        { key: "model", labelKey: "md.product.product_model", required: true },
        { key: "station_name", labelKey: "md.station.station_name", required: true },
        { key: "point_qty", labelKey: "cfg.aoipoints.point_qty", type: "number", required: true },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [{ key: "station_name", labelKey: "md.station.station_name" }],
    },
    {
      code: "cfg.aoidefect", basePath: "cfg", res: "aoidefect",
      fields: [
        { key: "code", labelKey: "cfg.aoidefect.code", required: true },
        { key: "name_zh", labelKey: "cfg.aoidefect.name_zh", required: true },
        { key: "name_en", labelKey: "cfg.aoidefect.name_en" },
        { key: "category", labelKey: "cfg.aoidefect.category" },
      ],
      filters: [{ key: "category", labelKey: "cfg.aoidefect.category" }],
    },
    {
      code: "cfg.aoicompmap", basePath: "cfg", res: "aoicompmap",
      fields: [
        { key: "model", labelKey: "md.product.product_model", required: true },
        { key: "comp_id", labelKey: "cfg.aoicompmap.comp_id", required: true },
        { key: "designator", labelKey: "cfg.aoicompmap.designator", required: true },
        { key: "part_no", labelKey: "cfg.aoicompmap.part_no" },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [{ key: "model", labelKey: "md.product.product_model" }],
    },
    {
      code: "cfg.aoiprogrammap", basePath: "cfg", res: "aoiprogrammap",
      fields: [
        { key: "program_name", labelKey: "cfg.aoiprogrammap.program_name", required: true },
        { key: "model", labelKey: "md.product.product_model", required: true },
        { key: "source", labelKey: "cfg.aoiprogrammap.source" },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [{ key: "model", labelKey: "md.product.product_model" }],
    },
    {
      code: "cfg.bindstation", basePath: "cfg", res: "bindstation",
      fields: [
        { key: "station_code", labelKey: "md.station.station_code", required: true },
        { key: "station_name", labelKey: "md.station.station_name" },
        { key: "rel_type", labelKey: "cfg.bindstation.rel_type" },
        { key: "rel_code", labelKey: "cfg.bindstation.rel_code" },
        { key: "sort_no", labelKey: "md.station.seq_no", type: "number" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
      ],
      filters: [{ key: "rel_type", labelKey: "cfg.bindstation.rel_type" }],
    },
    {
      code: "cfg.bindrule", basePath: "cfg", res: "bindrule",
      fields: [
        { key: "station_code", labelKey: "md.station.station_code", required: true },
        { key: "role", labelKey: "cfg.bindrule.role", required: true },
        { key: "sn_type", labelKey: "cfg.snrule.sn_type" },
        { key: "label", labelKey: "cfg.bindrule.label" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
      ],
      filters: [{ key: "station_code", labelKey: "md.station.station_code" }],
    },
    {
      code: "cfg.apikey", basePath: "cfg", res: "apikey",
      fields: [
        { key: "api_key", labelKey: "cfg.apikey.api_key", required: true },
        { key: "name", labelKey: "cfg.apikey.name" },
        { key: "machine_no", labelKey: "cfg.apikey.machine_no" },
        { key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) },
        { key: "remark", labelKey: "field.remark" },
      ],
      filters: [{ key: "enabled", labelKey: "field.status", type: "bool", options: S(locale) }],
    },
    // ── W5 只读：设备上报 / AOI 检测数据（设备走 HTTP 上报，后台只查）──
    {
      code: "cfg.machine", basePath: "cfg", res: "machine",
      fields: [
        { key: "id", labelKey: "common.id", readonly: true },
        { key: "sn", labelKey: "exec.sn", readonly: true },
        { key: "machine_no", labelKey: "cfg.machine.machine_no", readonly: true },
        { key: "station_code", labelKey: "md.station.station_code", readonly: true },
        { key: "mo_no", labelKey: "mo.mo_no", readonly: true },
        { key: "pass_ng", labelKey: "cfg.machine.pass_ng", readonly: true },
        { key: "ng_info", labelKey: "cfg.machine.ng_info", readonly: true },
        { key: "create_by", labelKey: "sys.log.user", readonly: true },
        { key: "created_at", labelKey: "sys.log.time", readonly: true },
      ],
      filters: [
        { key: "station_code", labelKey: "md.station.station_code" },
        { key: "mo_no", labelKey: "mo.mo_no" },
      ],
    },
    {
      code: "cfg.machinetest", basePath: "cfg", res: "machinetest",
      fields: [
        { key: "sn", labelKey: "exec.sn", readonly: true },
        { key: "param_key", labelKey: "cfg.machinetest.param_key", readonly: true },
        { key: "param_val", labelKey: "cfg.machinetest.param_val", readonly: true },
        { key: "station_code", labelKey: "md.station.station_code", readonly: true },
        { key: "result", labelKey: "qms.result", readonly: true },
      ],
      filters: [{ key: "sn", labelKey: "exec.sn" }],
    },
    {
      code: "cfg.aoi", basePath: "cfg", res: "aoi",
      fields: [
        { key: "id", labelKey: "common.id", readonly: true },
        { key: "test_time", labelKey: "sys.log.time", readonly: true },
        { key: "device_name", labelKey: "cfg.aoi.device_name", readonly: true },
        { key: "pcb_sn", labelKey: "exec.sn", readonly: true },
        { key: "project_name", labelKey: "cfg.aoi.project_name", readonly: true },
        { key: "board_side", labelKey: "cfg.aoi.board_side", readonly: true },
        { key: "final_result", labelKey: "qms.result", readonly: true },
        { key: "sn_count", labelKey: "cfg.aoi.sn_count", readonly: true },
        { key: "comp_ng_number", labelKey: "cfg.aoi.comp_ng", readonly: true },
      ],
      filters: [
        { key: "final_result", labelKey: "qms.result" },
        { key: "device_name", labelKey: "cfg.aoi.device_name" },
      ],
    },
    {
      code: "cfg.aoiboard", basePath: "cfg", res: "aoiboard",
      fields: [
        { key: "board_sn", labelKey: "cfg.aoiboard.board_sn", readonly: true },
        { key: "pcb_sn", labelKey: "exec.sn", readonly: true },
        { key: "board_no", labelKey: "cfg.aoiboard.board_no", readonly: true },
        { key: "file_name", labelKey: "cfg.aoi.project_name", readonly: true },
        { key: "final_result", labelKey: "qms.result", readonly: true },
      ],
      filters: [{ key: "file_name", labelKey: "cfg.aoi.project_name" }],
    },
    {
      code: "cfg.aoicomp", basePath: "cfg", res: "aoicomp",
      fields: [
        { key: "pcb_sn", labelKey: "exec.sn", readonly: true },
        { key: "comp_designator", labelKey: "cfg.aoicompmap.designator", readonly: true },
        { key: "comp_type", labelKey: "cfg.aoicomp.comp_type", readonly: true },
        { key: "robot_result", labelKey: "qms.result", readonly: true },
      ],
      filters: [{ key: "pcb_sn", labelKey: "exec.sn" }],
    },
  ];
}
