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
  ];
}
