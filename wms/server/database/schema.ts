/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { bigint, boolean, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const inventoryTransaction = pgTable("inventory_transaction", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull(),
  locationId: uuid("location_id").notNull(),
  batchNo: varchar("batch_no", { length: 100 }),
  labelNo: varchar("label_no", { length: 100 }),
  stockStatus: varchar("stock_status", { length: 20 }).notNull().default('good'),
  txType: varchar("tx_type", { length: 30 }).notNull(),
  txNo: varchar("tx_no", { length: 100 }),
  qty: numeric("qty").notNull().default('0'),
  balanceAfter: numeric("balance_after").notNull().default('0'),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  referenceNo: varchar("reference_no", { length: 100 }),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_invt_material").on(table.materialId),
  index("idx_invt_location").on(table.locationId),
  index("idx_invt_batch").on(table.batchNo),
  index("idx_invt_label").on(table.labelNo),
  index("idx_invt_tx_type").on(table.txType),
  index("idx_invt_tx_no").on(table.txNo),
  index("idx_invt_created").on(table.createdAt),
]);

export const materialExpiryExtension = pgTable("material_expiry_extension", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull(),
  batchNo: varchar("batch_no", { length: 100 }).notNull(),
  locationId: uuid("location_id").notNull(),
  originalExpiryDate: date("original_expiry_date").notNull(),
  newExpiryDate: date("new_expiry_date").notNull(),
  extendedDays: integer("extended_days").notNull().default(0),
  operatorId: userProfile("operator_id"),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_expiry_mat_batch").on(table.materialId, table.batchNo),
]);

export const iqcTemplateMaterial = pgTable("iqc_template_material", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull(),
  materialId: uuid("material_id").notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
}, (table) => [
  uniqueIndex("iqc_template_material_template_id_material_id_key").on(table.templateId, table.materialId),
  index("idx_iqc_tpl_mat_material").on(table.materialId),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "iqc_template_material_material_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.templateId],
    foreignColumns: [iqcTemplate.id],
    name: "iqc_template_material_template_id_fkey",
  }).onDelete("cascade"),
]);

export const iqcTemplateItem = pgTable("iqc_template_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull(),
  sectionType: varchar("section_type", { length: 30 }).notNull(),
  itemName: varchar("item_name", { length: 300 }).notNull(),
  itemNameVi: varchar("item_name_vi", { length: 300 }),
  itemNameEn: varchar("item_name_en", { length: 300 }),
  standard: text("standard"),
  standardVi: text("standard_vi"),
  standardEn: text("standard_en"),
  /** 规格表达式（如 10±0.1、≤5、3.15~4.15），由 spec-parser 解析为 LSL/USL。
   *  历史拼写 spc 已于 2026-10-22 统一改为 spec，见 rename-spc-to-spec-20261022.sql */
  spec: varchar("spec", { length: 50 }),
  lsl: varchar("lsl", { length: 100 }),
  usl: varchar("usl", { length: 100 }),
  unit: varchar("unit", { length: 20 }),
  aql: varchar("aql", { length: 20 }).default('0.4'),
  samplingPlanText: varchar("sampling_plan_text", { length: 100 }),
  sampleSize: integer("sample_size"),
  ac: integer("ac"),
  re: integer("re"),
  sortOrder: integer("sort_order").default(0),
  isRequired: boolean("is_required").default(true),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_iqc_tpl_item_template").on(table.templateId),
  index("idx_iqc_tpl_item_section").on(table.templateId, table.sectionType),
  foreignKey({
    columns: [table.templateId],
    foreignColumns: [iqcTemplate.id],
    name: "iqc_template_item_template_id_fkey",
  }).onDelete("cascade"),
]);

export const iqcStandardItem = pgTable("iqc_standard_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectionType: varchar("section_type", { length: 30 }).notNull(),
  itemName: varchar("item_name", { length: 300 }).notNull(),
  itemNameVi: varchar("item_name_vi", { length: 300 }),
  itemNameEn: varchar("item_name_en", { length: 300 }),
  standard: text("standard"),
  standardVi: text("standard_vi"),
  standardEn: text("standard_en"),
  /** 规格表达式（如 10±0.1、≤5、3.15~4.15），由 spec-parser 解析为 LSL/USL。
   *  历史拼写 spc 已于 2026-10-22 统一改为 spec，见 rename-spc-to-spec-20261022.sql */
  spec: varchar("spec", { length: 50 }),
  lsl: varchar("lsl", { length: 100 }),
  usl: varchar("usl", { length: 100 }),
  unit: varchar("unit", { length: 20 }),
  aql: varchar("aql", { length: 20 }).default('0.4'),
  samplingPlanText: varchar("sampling_plan_text", { length: 100 }),
  sampleSize: integer("sample_size"),
  ac: integer("ac"),
  re: integer("re"),
  sortOrder: integer("sort_order").default(0),
  isRequired: boolean("is_required").default(true),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_iqc_std_item_section").on(table.sectionType),
]);

export const iqcTemplate = pgTable("iqc_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateName: varchar("template_name", { length: 200 }).notNull(),
  templateCode: varchar("template_code", { length: 50 }),
  version: varchar("version", { length: 20 }).default('1.0'),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  description: text("description"),
  packagingAql: varchar("packaging_aql", { length: 20 }),
  appearanceLevel: varchar("appearance_level", { length: 20 }).default('G-II'),
  appearanceAql: varchar("appearance_aql", { length: 20 }).default('0.4'),
  dimensionLevel: varchar("dimension_level", { length: 20 }).default('S-2'),
  dimensionAql: varchar("dimension_aql", { length: 20 }).default('0.4'),
  reliabilitySampleSize: integer("reliability_sample_size").default(2),
  environmentalSampleSize: integer("environmental_sample_size").default(1),
  /**
   * 模板启用的检验分类（packaging/appearance/dimension/reliability/environmental）
   * @type { string[] }
   */
  selectedSections: varchar("selected_sections", { length: 30 }).array().notNull().default([]),
  /**
   * @type { cells: TemplateCell[], merges: TemplateMerge[], colWidths: number[] }
   */
  rawData: jsonb("raw_data"),
  rowCount: integer("row_count").default(0),
  colCount: integer("col_count").default(0),
  fileName: varchar("file_name", { length: 500 }),
  sheetName: varchar("sheet_name", { length: 200 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
});

export const sysAccount = pgTable("sys_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  account: varchar("account", { length: 50 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 200 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  roleCode: varchar("role_code", { length: 50 }).notNull(),
  workSection: varchar("work_section", { length: 20 }),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  isFirstLogin: boolean("is_first_login").notNull().default(true),
  lastLoginAt: customTimestamptz("last_login_at", { precision: 3 }),
  platformUserId: varchar("platform_user_id", { length: 100 }).unique(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("sys_account_account_key").on(table.account),
  index("idx_sys_account_role").on(table.roleCode),
  index("idx_sys_account_status").on(table.status),
  uniqueIndex("idx_sys_account_platform_user_id").on(table.platformUserId),
]);

export const sysRole = pgTable("sys_role", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleCode: varchar("role_code", { length: 50 }).notNull().unique(),
  roleName: varchar("role_name", { length: 100 }).notNull(),
  description: varchar("description", { length: 500 }),
  menuPermissions: text("menu_permissions").array().notNull().default([]),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("sys_role_role_code_key").on(table.roleCode),
]);

export const roleUser = pgTable("role_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleCode: varchar("role_code", { length: 50 }).notNull(),
  userId: varchar("user_id", { length: 100 }).notNull(),
  userName: varchar("user_name", { length: 100 }),
  workSection: varchar("work_section", { length: 20 }),
  status: varchar("status", { length: 20 }).notNull().default('active'),
}, (table) => [
  uniqueIndex("role_user_role_code_user_id_key").on(table.roleCode, table.userId),
]);

export const operationLog = pgTable("operation_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  bizType: varchar("biz_type", { length: 50 }).notNull(),
  bizId: uuid("biz_id"),
  bizNo: varchar("biz_no", { length: 100 }),
  action: varchar("action", { length: 50 }).notNull(),
  actionDetail: text("action_detail"),
  operatorId: userProfile("operator_id"),
  operatorName: varchar("operator_name", { length: 100 }),
  ipAddress: varchar("ip_address", { length: 50 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_oplog_biz").on(table.bizType, table.bizId),
  index("idx_oplog_created").on(table.createdAt),
]);

export const mrbReviewer = pgTable("mrb_reviewer", {
  id: uuid("id").primaryKey().defaultRandom(),
  mrbId: uuid("mrb_id").notNull(),
  reviewerId: userProfile("reviewer_id").notNull(),
  reviewerRole: varchar("reviewer_role", { length: 50 }),
  reviewOpinion: text("review_opinion"),
  reviewResult: varchar("review_result", { length: 20 }),
  reviewTime: customTimestamptz("review_time", { precision: 3 }),
  sortOrder: integer("sort_order").default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_mrb_r_mrb").on(table.mrbId),
  foreignKey({
    columns: [table.mrbId],
    foreignColumns: [mrbReview.id],
    name: "mrb_reviewer_mrb_id_fkey",
  }).onDelete("cascade"),
]);

export const mrbReview = pgTable("mrb_review", {
  id: uuid("id").primaryKey().defaultRandom(),
  mrbNo: varchar("mrb_no", { length: 50 }).notNull().unique(),
  /** 来源 IQC 检验单号（单号前缀同源，供追溯检索） */
  sourceInspectionNo: varchar("source_inspection_no", { length: 50 }),
  lotId: uuid("lot_id").notNull(),
  materialId: uuid("material_id").notNull(),
  supplierId: uuid("supplier_id").notNull(),
  batchNo: varchar("batch_no", { length: 100 }),
  quantity: numeric("quantity").notNull(),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  failReason: text("fail_reason"),
  status: varchar("status", { length: 20 }).notNull().default('pending_review'),
  finalDecision: varchar("final_decision", { length: 20 }),
  sqeId: userProfile("sqe_id"),
  qualityManagerId: userProfile("quality_manager_id"),
  finalApprovalTime: customTimestamptz("final_approval_time", { precision: 3 }),
  finalRemark: text("final_remark"),
  remark: text("remark"),
  // ---- MRB v2 增量（mrb-v2-20261018.sql）：齐全性预审 4 列 + 急件 2 列 ----
  completenessResult: varchar("completeness_result", { length: 20 }),
  completenessBy: userProfile("completeness_by"),
  completenessTime: customTimestamptz("completeness_time", { precision: 3 }),
  completenessRemark: text("completeness_remark"),
  isUrgent: boolean("is_urgent").notNull().default(false),
  urgentReason: text("urgent_reason"),
  // ---- MRB v2.1 增量（mrb-v2.1-20261018.sql）：状态机 + 作废 + 单人审批 ----
  statusSince: customTimestamptz("status_since", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  cancelReason: text("cancel_reason"),
  cancelBy: userProfile("cancel_by"),
  cancelTime: customTimestamptz("cancel_time", { precision: 3 }),
  separationRemark: text("separation_remark"),
  // ---- MRB v3 增量（mrb-v3-20261019.sql）：方案提交 + 抄送 ----
  planBy: userProfile("plan_by"),
  planTime: customTimestamptz("plan_time", { precision: 3 }),
  ccSentAt: customTimestamptz("cc_sent_at", { precision: 3 }),
  // ---- MRB v3.1 增量（mrb-v3.1-20261019.sql）：撤回 + 驳回留痕 ----
  withdrawReason: text("withdraw_reason"),
  withdrawBy: userProfile("withdraw_by"),
  withdrawTime: customTimestamptz("withdraw_time", { precision: 3 }),
  returnReason: text("return_reason"),
  returnBy: userProfile("return_by"),
  returnTime: customTimestamptz("return_time", { precision: 3 }),
  /** 退回来路：pending_approval=预审 / pending_final=终审 */
  returnFrom: varchar("return_from", { length: 20 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("mrb_review_mrb_no_key").on(table.mrbNo),
  index("idx_mrb_lot").on(table.lotId),
  index("idx_mrb_status").on(table.status),
  foreignKey({
    columns: [table.supplierId],
    foreignColumns: [supplier.id],
    name: "mrb_review_supplier_id_fkey",
  }),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "mrb_review_material_id_fkey",
  }),
  foreignKey({
    columns: [table.lotId],
    foreignColumns: [iqcLot.id],
    name: "mrb_review_lot_id_fkey",
  }),
]);

export const pickingOrderItem = pgTable("picking_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  pickingId: uuid("picking_id").notNull(),
  materialId: uuid("material_id"),
  materialCode: varchar("material_code", { length: 100 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  pickQty: numeric("pick_qty").notNull(),
  actualQty: numeric("actual_qty").default('0'),
  // 签收时领料方确认的实收数量（与 actualQty 的差额即差异）
  receivedQty: numeric("received_qty").default('0'),
  receiveRemark: text("receive_remark"),
  actualMaterialId: uuid("actual_material_id"),
  actualMaterialCode: varchar("actual_material_code", { length: 100 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_poi_picking").on(table.pickingId),
  foreignKey({
    columns: [table.pickingId],
    foreignColumns: [pickingOrder.id],
    name: "picking_order_item_picking_id_fkey",
  }).onDelete("cascade"),
]);

export const pickingOrder = pgTable("picking_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  pickingNo: varchar("picking_no", { length: 50 }).notNull().unique(),
  workOrderId: uuid("work_order_id").notNull(),
  reqId: uuid("req_id"),
  workSection: varchar("work_section", { length: 20 }).notNull(),
  isSupplement: boolean("is_supplement").notNull().default(false),
  totalQty: numeric("total_qty").default('0'),
  status: varchar("status", { length: 20 }).notNull().default('pending_approval'),
  applicantId: userProfile("applicant_id"),
  approverId: userProfile("approver_id"),
  approvalTime: customTimestamptz("approval_time", { precision: 3 }),
  approvalRemark: text("approval_remark"),
  pickerId: userProfile("picker_id"),
  pickTime: customTimestamptz("pick_time", { precision: 3 }),
  /** OA 电子流实例（领料完成确认） */
  oaInstanceId: bigint("oa_instance_id", { mode: 'number' }),
  oaStatus: varchar("oa_status", { length: 20 }),
  oaSyncedAt: customTimestamptz("oa_synced_at", { precision: 3 }),
  // ---- 领料签收（发料完成后由领料方物料员确认实收） ----
  receivedBy: userProfile("received_by"),
  receivedTime: customTimestamptz("received_time", { precision: 3 }),
  receiveRemark: text("receive_remark"),
  remark: text("remark"),
  // ---- MES 接入（2026-10-31）：manual = WMS 手工/工单下发，mes = 按 MES 用料自动生成 ----
  source: varchar("source", { length: 20 }).notNull().default('manual'),
  mesIssueNo: varchar("mes_issue_no", { length: 100 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("picking_order_picking_no_key").on(table.pickingNo),
  index("idx_po_work_order").on(table.workOrderId),
  index("idx_po_status").on(table.status),
  index("idx_po_section").on(table.workSection),
  foreignKey({
    columns: [table.reqId],
    foreignColumns: [materialRequirement.id],
    name: "picking_order_req_id_fkey",
  }),
  foreignKey({
    columns: [table.workOrderId],
    foreignColumns: [workOrder.id],
    name: "picking_order_work_order_id_fkey",
  }),
]);

export const materialRequirementItem = pgTable("material_requirement_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  reqId: uuid("req_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 100 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  specification: text("specification"),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  requiredQty: numeric("required_qty").notNull(),
  baseQty: numeric("base_qty").default('0'),
  overIssueQty: numeric("over_issue_qty").default('0'),
  supplementQty: numeric("supplement_qty").default('0'),
  issuedQty: numeric("issued_qty").default('0'),
  workSection: varchar("work_section", { length: 20 }),
  unitUsage: numeric("unit_usage").default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_mri_req").on(table.reqId),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "material_requirement_item_material_id_fkey",
  }),
  foreignKey({
    columns: [table.reqId],
    foreignColumns: [materialRequirement.id],
    name: "material_requirement_item_req_id_fkey",
  }).onDelete("cascade"),
]);

/** SMT 盘装料台账：一盘一码，记录发料/退回/消耗 */
export const pickingReel = pgTable("picking_reel", {
  id: uuid("id").primaryKey().defaultRandom(),
  pickingId: uuid("picking_id").notNull(),
  pickingItemId: uuid("picking_item_id").notNull(),
  workOrderId: uuid("work_order_id").notNull(),
  materialId: uuid("material_id").notNull(),
  /** 盘号：实物标签第 6 段；无码退回时由系统生成新标签 */
  reelNo: varchar("reel_no", { length: 120 }).notNull(),
  batchNo: varchar("batch_no", { length: 100 }),
  fromLocationId: uuid("from_location_id"),
  issuedQty: numeric("issued_qty").notNull().default('0'),
  returnedQty: numeric("returned_qty").notNull().default('0'),
  consumedQty: numeric("consumed_qty").notNull().default('0'),
  /** issued(在产线) / partial_returned / closed */
  status: varchar("status", { length: 20 }).notNull().default('issued'),
  issuedAt: customTimestamptz("issued_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  issuedBy: userProfile("issued_by"),
  returnedAt: customTimestamptz("returned_at", { precision: 3 }),
  returnedBy: userProfile("returned_by"),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_picking_reel").on(table.pickingId, table.reelNo),
  index("idx_reel_wo").on(table.workOrderId),
  index("idx_reel_no").on(table.reelNo),
  index("idx_reel_material").on(table.materialId),
]);

export const materialRequirement = pgTable("material_requirement", {
  id: uuid("id").primaryKey().defaultRandom(),
  reqNo: varchar("req_no", { length: 50 }).notNull().unique(),
  workOrderId: uuid("work_order_id").notNull(),
  workSection: varchar("work_section", { length: 20 }),
  totalQty: numeric("total_qty").default('0'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  applicantId: userProfile("applicant_id"),
  approverId: userProfile("approver_id"),
  approvalTime: customTimestamptz("approval_time", { precision: 3 }),
  approvalRemark: text("approval_remark"),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("material_requirement_req_no_key").on(table.reqNo),
  index("idx_mr_work_order").on(table.workOrderId),
  index("idx_mr_status").on(table.status),
  foreignKey({
    columns: [table.workOrderId],
    foreignColumns: [workOrder.id],
    name: "material_requirement_work_order_id_fkey",
  }),
]);

export const workOrder = pgTable("work_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  workOrderNo: varchar("work_order_no", { length: 50 }).notNull().unique(),
  bomId: uuid("bom_id"),
  productCode: varchar("product_code", { length: 100 }).notNull(),
  productName: varchar("product_name", { length: 200 }).notNull(),
  planQty: numeric("plan_qty").notNull(),
  actualQty: numeric("actual_qty").default('0'),
  workOrderDate: date("work_order_date").notNull(),
  isSupplement: boolean("is_supplement").notNull().default(false),
  parentOrderId: uuid("parent_order_id"),
  status: varchar("status", { length: 20 }).notNull().default('created'),
  // 超耗（超补）审批：超过 BOM 标准用量 3‰ 需审批后才能结案
  /** OA 电子流实例（工单超耗审批） */
  oaInstanceId: bigint("oa_instance_id", { mode: 'number' }),
  oaStatus: varchar("oa_status", { length: 20 }),
  overConsumeStatus: varchar("over_consume_status", { length: 20 }),
  overConsumeRate: numeric("over_consume_rate"),
  overConsumeQty: numeric("over_consume_qty"),
  overConsumeApprovedBy: userProfile("over_consume_approved_by"),
  overConsumeApprovedTime: customTimestamptz("over_consume_approved_time", { precision: 3 }),
  overConsumeRemark: text("over_consume_remark"),
  version: integer("version").notNull().default(0),
  plannerId: userProfile("planner_id"),
  remark: text("remark"),
  // ---- MES 接入（2026-10-31）：manual = WMS 自建，mes = 从 MES 同步 ----
  source: varchar("source", { length: 20 }).notNull().default('manual'),
  mesMoNo: varchar("mes_mo_no", { length: 50 }),
  mesStatus: varchar("mes_status", { length: 20 }),
  productModel: varchar("product_model", { length: 200 }),
  woType: varchar("wo_type", { length: 20 }),
  lineCode: varchar("line_code", { length: 50 }),
  poNo: varchar("po_no", { length: 50 }),
  custCode: varchar("cust_code", { length: 50 }),
  planStart: date("plan_start"),
  planEnd: date("plan_end"),
  panelCount: integer("panel_count"),
  mesUpdatedAt: customTimestamptz("mes_updated_at", { precision: 3 }),
  mesSyncedAt: customTimestamptz("mes_synced_at", { precision: 3 }),
  mesIssueNo: varchar("mes_issue_no", { length: 100 }),
  mesIssueStatus: varchar("mes_issue_status", { length: 20 }),
  mesIssueCount: integer("mes_issue_count"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("work_order_work_order_no_key").on(table.workOrderNo),
  index("idx_wo_date").on(table.workOrderDate),
  index("idx_wo_status").on(table.status),
  index("idx_wo_parent").on(table.parentOrderId),
  foreignKey({
    columns: [table.parentOrderId],
    foreignColumns: [workOrder.id],
    name: "work_order_parent_order_id_fkey",
  }),
  foreignKey({
    columns: [table.bomId],
    foreignColumns: [bom.id],
    name: "work_order_bom_id_fkey",
  }),
]);

export const bomItem = pgTable("bom_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  bomId: uuid("bom_id").notNull(),
  materialId: uuid("material_id"),
  materialCode: varchar("material_code", { length: 100 }).notNull(),
  vietnamCode: varchar("vietnam_code", { length: 100 }),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  specification: text("specification"),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  quantity: numeric("quantity").notNull(),
  workSection: varchar("work_section", { length: 20 }).notNull().default('smt'),
  sortOrder: integer("sort_order").default(0),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_bom_item_bom").on(table.bomId),
  index("idx_bom_item_section").on(table.workSection),
  foreignKey({
    columns: [table.bomId],
    foreignColumns: [bom.id],
    name: "bom_item_bom_id_fkey",
  }).onDelete("cascade"),
]);

export const bom = pgTable("bom", {
  id: uuid("id").primaryKey().defaultRandom(),
  bomCode: varchar("bom_code", { length: 50 }).notNull().unique(),
  productCode: varchar("product_code", { length: 100 }).notNull(),
  productName: varchar("product_name", { length: 200 }).notNull(),
  version: varchar("version", { length: 20 }).default('V1.0'),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  description: text("description"),
  devTestMarker: varchar("_dev_test_marker", { length: 100 }).default('from_dev_db'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("bom_bom_code_key").on(table.bomCode),
]);

export const stockTransfer = pgTable("stock_transfer", {
  id: uuid("id").primaryKey().defaultRandom(),
  transferNo: varchar("transfer_no", { length: 50 }).notNull().unique(),
  transferDate: date("transfer_date").notNull(),
  fromLocationId: uuid("from_location_id").notNull(),
  toLocationId: uuid("to_location_id").notNull(),
  materialId: uuid("material_id").notNull(),
  batchNo: varchar("batch_no", { length: 100 }),
  quantity: numeric("quantity").notNull(),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  operatorId: userProfile("operator_id"),
  status: varchar("status", { length: 20 }).notNull().default('completed'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("stock_transfer_transfer_no_key").on(table.transferNo),
  index("idx_st_date").on(table.transferDate),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "stock_transfer_material_id_fkey",
  }),
  foreignKey({
    columns: [table.toLocationId],
    foreignColumns: [warehouseLocation.id],
    name: "stock_transfer_to_location_id_fkey",
  }),
  foreignKey({
    columns: [table.fromLocationId],
    foreignColumns: [warehouseLocation.id],
    name: "stock_transfer_from_location_id_fkey",
  }),
]);

export const inventory = pgTable("inventory", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull(),
  locationId: uuid("location_id").notNull(),
  batchNo: varchar("batch_no", { length: 100 }).notNull().default(''),
  supplierId: uuid("supplier_id"),
  quantity: numeric("quantity").notNull().default('0'),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  stockStatus: varchar("stock_status", { length: 20 }).notNull().default('good'),
  productionDate: date("production_date"),
  locked: boolean("locked").notNull().default(false),
  lockReason: text("lock_reason"),
  isSpecialAdmit: boolean("is_special_admit").notNull().default(false),
  specialAdmitRef: varchar("special_admit_ref", { length: 100 }),
  labelNo: varchar("label_no", { length: 100 }).unique(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  // 唯一键：`(material_id, location_id, batch_no, stock_status)`
  // ⚠️ 这条索引被全仓 20+ 处 `onConflictDoUpdate` 依赖，**不要**改成部分索引/表达式索引：
  //    任何一处调用方忘记同步 target/targetWhere 都会运行时 42P10，直接打断收料/发料/调拨。
  //    MRB「其他」处置的库存隔离靠「一张 MRB 一个专属保留库位」实现（4 列含 location_id，
  //    跨 MRB 天然隔离），同单多条明细合并成一行是预期行为，核销时按 mrb_disposition.quantity 扣减。
  uniqueIndex("inventory_material_id_location_id_batch_no_stock_status_key").on(
    table.materialId,
    table.locationId,
    table.batchNo,
    table.stockStatus,
  ),
  // MRB 占用标记查询用（confirm-out 按 lock_reason 定位保留行，避免全表扫）
  index("idx_inv_lock_reason").on(table.lockReason),
  index("idx_inv_material").on(table.materialId),
  index("idx_inv_location").on(table.locationId),
  index("idx_inv_batch").on(table.batchNo),
  index("idx_inv_status").on(table.stockStatus),
  uniqueIndex("idx_inventory_label_no").on(table.labelNo),
  foreignKey({
    columns: [table.locationId],
    foreignColumns: [warehouseLocation.id],
    name: "inventory_location_id_fkey",
  }),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "inventory_material_id_fkey",
  }),
]);

export const iqcReport = pgTable("iqc_report", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull().unique(),
  reportNo: varchar("report_no", { length: 50 }).notNull().unique(),
  finalResult: varchar("final_result", { length: 20 }).notNull(),
  inspectorId: userProfile("inspector_id"),
  inspectionTime: customTimestamptz("inspection_time", { precision: 3 }),
  reviewerId: userProfile("reviewer_id"),
  reviewTime: customTimestamptz("review_time", { precision: 3 }),
  reviewRemark: text("review_remark"),
  remark: text("remark"),
  reviewStatus: varchar("review_status", { length: 20 }).notNull().default('pending'),
  rejectReason: text("reject_reason"),
  rejectTime: customTimestamptz("reject_time", { precision: 3 }),
  rejectorId: userProfile("rejector_id"),
  /**
   * 判定方式：inspection=按检验小项推导（默认，唯一正常路径）；
   * manual=主管人工判定（批次无任何小项时才允许，原因必填）。
   * 见 server/database/add-iqc-judge-mode-20261018.sql
   */
  judgeMode: varchar("judge_mode", { length: 20 }).notNull().default('inspection'),
  judgeReason: text("judge_reason"),
  judgedBy: userProfile("judged_by"),
  judgedAt: customTimestamptz("judged_at", { precision: 3 }),
  /** OA 审批实例（既有 DB 列，此前未在 schema 声明；OA 接管 IQC 后由 P1 读写） */
  oaInstanceId: bigint("oa_instance_id", { mode: 'number' }),
  oaStatus: varchar("oa_status", { length: 20 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("iqc_report_lot_id_key").on(table.lotId),
  uniqueIndex("iqc_report_report_no_key").on(table.reportNo),
  index("idx_iqc_rpt_result").on(table.finalResult),
  index("idx_iqc_rpt_review_status").on(table.reviewStatus),
  index("idx_iqc_rpt_judge_mode").on(table.judgeMode),
  foreignKey({
    columns: [table.lotId],
    foreignColumns: [iqcLot.id],
    name: "iqc_report_lot_id_fkey",
  }),
]);

export const iqcInspectionRecord = pgTable("iqc_inspection_record", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull(),
  itemId: uuid("item_id"),
  itemName: varchar("item_name", { length: 200 }).notNull(),
  standard: text("standard"),
  specMin: varchar("spec_min", { length: 100 }),
  specMax: varchar("spec_max", { length: 100 }),
  unit: varchar("unit", { length: 20 }),
  measuredValue: varchar("measured_value", { length: 200 }),
  defectDescription: text("defect_description"),
  defectQty: numeric("defect_qty").default('0'),
  isPass: boolean("is_pass"),
  sortOrder: integer("sort_order").default(0),
  sectionType: varchar("section_type", { length: 30 }),
  templateItemId: uuid("template_item_id"),
  /**
   * @type { string[] }
   */
  measuredValues: jsonb("measured_values"),
  /** 规格表达式（如 10±0.1、≤5、3.15~4.15），由 spec-parser 解析为 LSL/USL。
   *  历史拼写 spc 已于 2026-10-22 统一改为 spec，见 rename-spc-to-spec-20261022.sql */
  spec: varchar("spec", { length: 50 }),
  samplingPlanText: varchar("sampling_plan_text", { length: 100 }),
  /** GB/T 2828.1 抽样方案的 AQL 值（如 0.40 / 1.0），国标方案必须随报告打印 */
  aql: varchar("aql", { length: 20 }),
  sampleSize: integer("sample_size"),
  ac: integer("ac"),
  re: integer("re"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_iqc_rec_lot").on(table.lotId),
  foreignKey({
    columns: [table.templateItemId],
    foreignColumns: [iqcTemplateItem.id],
    name: "iqc_inspection_record_template_item_id_fkey",
  }),
  foreignKey({
    columns: [table.itemId],
    foreignColumns: [iqcInspectionItem.id],
    name: "iqc_inspection_record_item_id_fkey",
  }),
  foreignKey({
    columns: [table.lotId],
    foreignColumns: [iqcLot.id],
    name: "iqc_inspection_record_lot_id_fkey",
  }),
]);

/**
 * IQC 检验草稿（检验员填写过程中的临时存档）
 * 与 iqc_inspection_record 完全隔离：只是「没提交前不丢数据」的兜底，
 * 不参与报告/判定/库存，避免出现「没提交却多出一条报告」的副作用。
 */
export const iqcInspectionDraft = pgTable("iqc_inspection_draft", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull().unique(),
  /** 整份草稿 JSON：{ templateId, records, remark, defectType, updatedAt } */
  payload: jsonb("payload").notNull(),
  inspectorId: userProfile("inspector_id"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("iqc_inspection_draft_lot_id_key").on(table.lotId),
  foreignKey({
    columns: [table.lotId],
    foreignColumns: [iqcLot.id],
    name: "iqc_inspection_draft_lot_id_fkey",
  }).onDelete("cascade"),
]);

export const iqcInspectionItem = pgTable("iqc_inspection_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull(),
  itemName: varchar("item_name", { length: 200 }).notNull(),
  standard: text("standard"),
  specMin: varchar("spec_min", { length: 100 }),
  specMax: varchar("spec_max", { length: 100 }),
  unit: varchar("unit", { length: 20 }),
  sortOrder: integer("sort_order").default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_iqc_item_material").on(table.materialId),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "iqc_inspection_item_material_id_fkey",
  }),
]);

export const iqcLotReceipt = pgTable("iqc_lot_receipt", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull(),
  receiptId: uuid("receipt_id").notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("iqc_lot_receipt_lot_id_receipt_id_key").on(table.lotId, table.receiptId),
  foreignKey({
    columns: [table.receiptId],
    foreignColumns: [receiptOrder.id],
    name: "iqc_lot_receipt_receipt_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.lotId],
    foreignColumns: [iqcLot.id],
    name: "iqc_lot_receipt_lot_id_fkey",
  }).onDelete("cascade"),
]);

export const iqcLot = pgTable("iqc_lot", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotNo: varchar("lot_no", { length: 50 }).notNull().unique(),
  /** 检验编号：仓库提交报检清单时生成（JY+yyyyMMdd+4位流水），IQC 报告编号即使用该字段 */
  inspectionNo: varchar("inspection_no", { length: 50 }),
  receiptDate: date("receipt_date").notNull(),
  /** 最近一次到货（并批）日期；receiptDate 保持"首次收货日"语义 */
  lastReceiptDate: date("last_receipt_date"),
  supplierId: uuid("supplier_id"),
  materialId: uuid("material_id").notNull(),
  totalQty: numeric("total_qty").notNull(),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  productionDate: date("production_date"),
  batchNo: varchar("batch_no", { length: 100 }),
  locationCodes: text("location_codes"),
  boxCount: integer("box_count").default(0),
  materialSource: varchar("material_source", { length: 200 }),
  inspectorId: userProfile("inspector_id"),
  approverId: userProfile("approver_id"),
  inspectionResult: varchar("inspection_result", { length: 20 }).default('pending'),
  defectType: varchar('defect_type', { length: 50 }),
  inspectionTime: customTimestamptz("inspection_time", { precision: 3 }),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  remark: text("remark"),
  templateId: uuid("template_id"),
  lastTemplateId: uuid("last_template_id"),
  /** OA 接管检验（P1）：批次认领人与时间；见 db_migration_oa_iqc.sql */
  oaClaimedBy: varchar("oa_claimed_by", { length: 100 }),
  oaClaimedAt: customTimestamptz("oa_claimed_at", { precision: 3 }),
  /** 检验来源：oa / wms / null(历史) —— 只用于审计与对账，不参与业务判定 */
  oaSource: varchar("oa_source", { length: 10 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("iqc_lot_lot_no_key").on(table.lotNo),
  uniqueIndex("iqc_lot_inspection_no_key").on(table.inspectionNo),
  index("idx_iqc_lot_date").on(table.receiptDate),
  index("idx_iqc_lot_supplier").on(table.supplierId),
  index("idx_iqc_lot_material").on(table.materialId),
  index("idx_iqc_lot_batch").on(table.batchNo),
  index("idx_iqc_lot_status").on(table.status),
  index("idx_iqc_lot_result").on(table.inspectionResult),
  // 合并键索引：不再唯一 —— 已完成检验的批次允许再次出现同键新批次（新到货重新检验）
  // ⚠️ 历史库曾残留 UNIQUE 版本，导致 F-10（新批次被静默吞掉）；由
  //    fix-iqc-pending-isolation-20261017.sql 负责在存量库 DROP 唯一版本并重建普通索引。
  index("idx_iqc_lot_merge_key").on(table.receiptDate, table.supplierId, table.materialId, table.productionDate, table.batchNo),
  // 进行中检验批次的去重键（4 列，去掉 receipt_date，与库存桶对齐）：
  //   同 (supplier_id, material_id, production_date, batch_no) 至多一条 active 批次。
  // ⚠️ 库上由 fix-iqc-pending-isolation-20261017.sql 创建并带 NULLS NOT DISTINCT；
  //    drizzle-kit 0.44 不支持 NULLS NOT DISTINCT，此处仅作文档/空库建表声明（空库建好后由该脚本重建）。
  uniqueIndex("iqc_lot_active_dedup_uniq")
    .on(table.supplierId, table.materialId, table.productionDate, table.batchNo)
    .where(sql`status in ('pending','inspecting','review_pending','rejected')`),
  index("idx_iqc_lot_last_template").on(table.lastTemplateId),
  foreignKey({
    columns: [table.lastTemplateId],
    foreignColumns: [iqcTemplate.id],
    name: "iqc_lot_last_template_id_fkey",
  }),
  foreignKey({
    columns: [table.templateId],
    foreignColumns: [iqcTemplate.id],
    name: "iqc_lot_template_id_fkey",
  }),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "iqc_lot_material_id_fkey",
  }),
]);

export const receiptOrder = pgTable("receipt_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptNo: varchar("receipt_no", { length: 50 }).notNull().unique(),
  receiptDate: date("receipt_date").notNull(),
  supplierId: uuid("supplier_id"),
  materialId: uuid("material_id").notNull(),
  quantity: numeric("quantity").notNull(),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  productionDate: date("production_date"),
  batchNo: varchar("batch_no", { length: 100 }),
  serialNo: varchar("serial_no", { length: 100 }),
  locationId: uuid("location_id"),
  keeperId: userProfile("keeper_id"),
  qrContent: text("qr_content"),
  remark: text("remark"),
  status: varchar("status", { length: 20 }).notNull().default('pending_iqc'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("receipt_order_receipt_no_key").on(table.receiptNo),
  index("idx_receipt_date").on(table.receiptDate),
  index("idx_receipt_supplier").on(table.supplierId),
  index("idx_receipt_material").on(table.materialId),
  index("idx_receipt_batch").on(table.batchNo),
  index("idx_receipt_status").on(table.status),
  foreignKey({
    columns: [table.locationId],
    foreignColumns: [warehouseLocation.id],
    name: "receipt_order_location_id_fkey",
  }),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "receipt_order_material_id_fkey",
  }),
]);

export const supplierMaterial = pgTable("supplier_material", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id").notNull(),
  materialId: uuid("material_id").notNull(),
  supplierMaterialCode: varchar("supplier_material_code", { length: 100 }),
  mslLevel: varchar("msl_level", { length: 20 }).default('不管控'),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("supplier_material_supplier_id_material_id_key").on(table.supplierId, table.materialId),
  index("idx_sm_supplier").on(table.supplierId),
  index("idx_sm_material").on(table.materialId),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "supplier_material_material_id_fkey",
  }),
  foreignKey({
    columns: [table.supplierId],
    foreignColumns: [supplier.id],
    name: "supplier_material_supplier_id_fkey",
  }),
]);

export const materialSubstitution = pgTable("material_substitution", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 100 }).notNull(),
  substituteMaterialId: uuid("substitute_material_id").notNull(),
  substituteMaterialCode: varchar("substitute_material_code", { length: 100 }).notNull(),
  remark: varchar("remark", { length: 500 }),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  substitutionType: varchar("substitution_type", { length: 20 }).notNull().default('one_way'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("material_substitution_mat_sub_key").on(table.materialId, table.substituteMaterialId),
  index("idx_ms_material").on(table.materialId),
  index("idx_ms_material_code").on(table.materialCode),
  index("idx_ms_substitute").on(table.substituteMaterialId),
  index("idx_ms_status").on(table.status),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "material_substitution_material_id_fkey",
  }),
  foreignKey({
    columns: [table.substituteMaterialId],
    foreignColumns: [material.id],
    name: "material_substitution_substitute_material_id_fkey",
  }),
]);

export const material = pgTable("material", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialCode: varchar("material_code", { length: 100 }).notNull().unique(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  specification: text("specification"),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  materialType: varchar("material_type", { length: 50 }),
  /** 包装类型：normal=普通，reel=盘装料（SMT Reel，必须扫盘号收发） */
  packagingType: varchar("packaging_type", { length: 20 }).notNull().default('normal'),
  mslLevel: varchar("msl_level", { length: 20 }).default('不管控'),
  // 物料等级（2026-10-18 新增）：用户明确要求主数据导入时「等级」为必填字段，
  // 与 MSL 是两个不同维度（MSL 是防潮等级，等级是物料品质/分级），故单列存放。
  grade: varchar("grade", { length: 50 }),
  vietnamCode: varchar("vietnam_code", { length: 100 }),
  inspectionStandard: text("inspection_standard"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  description: text("description"),
  expiryDays: integer("expiry_days"),
  forceScrapDays: integer("force_scrap_days"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).default('0'),
  overIssueRatio: integer("over_issue_ratio").default(0),
  supplementRatio: integer("supplement_ratio").default(0),
  supplierCode: varchar("supplier_code", { length: 50 }),
  materialSource: varchar("material_source", { length: 200 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("material_material_code_key").on(table.materialCode),
  index("idx_material_code").on(table.materialCode),
  index("idx_material_type").on(table.materialType),
  index("idx_material_supplier_code").on(table.supplierCode),
]);

export const supplier = pgTable("supplier", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierCode: varchar("supplier_code", { length: 50 }).notNull().unique(),
  supplierName: varchar("supplier_name", { length: 200 }).notNull(),
  contactPerson: varchar("contact_person", { length: 100 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  contactEmail: varchar("contact_email", { length: 100 }),
  address: text("address"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  description: text("description"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("supplier_supplier_code_key").on(table.supplierCode),
  index("idx_supplier_code").on(table.supplierCode),
]);

export const warehouseLocation = pgTable("warehouse_location", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationCode: varchar("location_code", { length: 100 }).notNull().unique(),
  warehouseId: uuid("warehouse_id").notNull(),
  areaCode: varchar("area_code", { length: 50 }),
  shelfCode: varchar("shelf_code", { length: 50 }),
  layerCode: varchar("layer_code", { length: 50 }),
  positionCode: varchar("position_code", { length: 50 }),
  locationType: varchar("location_type", { length: 20 }).notNull().default('good'),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  description: text("description"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("warehouse_location_location_code_key").on(table.locationCode),
  index("idx_wh_loc_warehouse").on(table.warehouseId),
  index("idx_wh_loc_type").on(table.locationType),
  foreignKey({
    columns: [table.warehouseId],
    foreignColumns: [warehouse.id],
    name: "warehouse_location_warehouse_id_fkey",
  }),
]);

export const warehouse = pgTable("warehouse", {
  id: uuid("id").primaryKey().defaultRandom(),
  whCode: varchar("wh_code", { length: 50 }).notNull().unique(),
  whNameZh: varchar("wh_name_zh", { length: 100 }).notNull(),
  whNameVi: varchar("wh_name_vi", { length: 100 }),
  whNameEn: varchar("wh_name_en", { length: 100 }),
  whType: varchar("wh_type", { length: 20 }).notNull().default('normal'),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  address: text("address"),
  description: text("description"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("warehouse_wh_code_key").on(table.whCode),
]);

export const sysParam = pgTable("sys_param", {
  id: uuid("id").primaryKey().defaultRandom(),
  paramKey: varchar("param_key", { length: 100 }).notNull().unique(),
  paramValue: text("param_value").notNull(),
  paramNameZh: varchar("param_name_zh", { length: 200 }),
  paramNameVi: varchar("param_name_vi", { length: 200 }),
  paramNameEn: varchar("param_name_en", { length: 200 }),
  description: text("description"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("sys_param_param_key_key").on(table.paramKey),
]);

// ===== IQC 检验严格度状态管理 =====

export const iqcInspectionStrictness = pgTable("iqc_inspection_strictness", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull(),
  // 账本维度: material(物料级, 一个物料一条) / 历史值 appearance / dimensional（仅兼容旧数据）
  inspectionType: varchar("inspection_type", { length: 30 }).notNull(),
  // 当前严格度: normal(正常) / tightened(加严) / reduced(放宽) / exempt(免检) / suspended(暂停)
  strictness: varchar("strictness", { length: 20 }).notNull().default('normal'),
  // 首次检验时人工配置的检验水平和AQL
  inspectionLevel: varchar("inspection_level", { length: 20 }).notNull().default('II'),
  aql: varchar("aql", { length: 20 }).notNull().default('0.4'),
  // 连续接收批计数（用于正常→放宽：10批全接收）
  consecutiveAccepted: integer("consecutive_accepted").notNull().default(0),
  // 近5批中不接收批数（用于正常→加严：5批内2批不接收）
  recentRejectedIn5: integer("recent_rejected_in_5").notNull().default(0),
  // 加严期间累计不接收批数（用于加严→暂停：累计5批不接收）
  tightenedRejectedTotal: integer("tightened_rejected_total").notNull().default(0),
  // 加严期间连续接收批数（用于加严→正常：连续5批接收）
  tightenedConsecutiveAccepted: integer("tightened_consecutive_accepted").notNull().default(0),
  // 异常登记来源（免检→正常时记录）
  exceptionSource: varchar("exception_source", { length: 50 }),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("iqc_inspection_strictness_material_type_key").on(table.materialId, table.inspectionType),
  index("idx_iqc_strictness_material").on(table.materialId),
  index("idx_iqc_strictness_status").on(table.strictness),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "iqc_inspection_strictness_material_id_fkey",
  }).onDelete("cascade"),
]);

export const iqcStrictnessTransferLog = pgTable("iqc_strictness_transfer_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull(),
  inspectionType: varchar("inspection_type", { length: 30 }).notNull(),
  fromStrictness: varchar("from_strictness", { length: 20 }).notNull(),
  toStrictness: varchar("to_strictness", { length: 20 }).notNull(),
  // 转移类型: auto(自动) / manual(人工)
  transferType: varchar("transfer_type", { length: 20 }).notNull().default('auto'),
  // 关联的检验报告ID（自动转移时关联）
  reportId: uuid("report_id"),
  lotId: uuid("lot_id"),
  // 转移原因说明
  reason: text("reason"),
  // 人工操作时的操作员
  operatorId: userProfile("operator_id"),
  operatorName: varchar("operator_name", { length: 100 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_iqc_st_log_material").on(table.materialId),
  index("idx_iqc_st_log_type").on(table.inspectionType),
  index("idx_iqc_st_log_created").on(table.createdAt),
  foreignKey({
    columns: [table.materialId],
    foreignColumns: [material.id],
    name: "iqc_strictness_transfer_log_material_id_fkey",
  }).onDelete("cascade"),
]);

// ===== IQC 严格度自动计数台账 =====
// 用途：严格度自动流转（正常→放宽 / 正常→加严 / 加严→正常 / 加严→暂停）的「接收批数」以
// 「提交到 IQC 后合并成的批次（iqc_lot）」为计数单位。此表按 (lot_id, inspection_type) 唯一，
// 保证同一批次只计一次，避免同一批次被重复审批时重复累加计数。
export const iqcLotStrictnessCount = pgTable("iqc_lot_strictness_count", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id").notNull(),
  materialId: uuid("material_id").notNull(),
  // 检验类型: appearance(外观) / dimensional(尺寸功能)
  inspectionType: varchar("inspection_type", { length: 30 }).notNull(),
  // 该批次该类型的判定结果：true=接收(合格) / false=不接收(不合格)
  accepted: boolean("accepted").notNull(),
  // 计数后严格度所处的状态（便于追溯当时参与的是哪条流转规则）
  strictnessAtCount: varchar("strictness_at_count", { length: 20 }).notNull(),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("iqc_lot_strictness_count_lot_type_key").on(table.lotId, table.inspectionType),
  index("idx_iqc_lot_st_count_material").on(table.materialId),
]);

// ===== 产线退料 =====

export const productionReturn = pgTable("production_return", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnNo: varchar("return_no", { length: 50 }).notNull().unique(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 100 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  supplierId: uuid("supplier_id"),
  supplierCode: varchar("supplier_code", { length: 50 }),
  supplierName: varchar("supplier_name", { length: 200 }),
  quantity: numeric("quantity").notNull(),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  productionDate: date("production_date"),
  batchNo: varchar("batch_no", { length: 100 }),
  returnReason: text("return_reason"),
  workOrderNo: varchar("work_order_no", { length: 50 }),
  // 状态: draft(草稿) / submitted_iqc(已提交IQC) / iqc_completed(检验完成) / received(已入库)
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  // 已入库数量（按良品/来料不良/作业不良累计），用于入库进度统计
  receivedGoodQty: numeric("received_good_qty").notNull().default('0'),
  receivedIncomingDefectQty: numeric("received_incoming_defect_qty").notNull().default('0'),
  receivedOperationDefectQty: numeric("received_operation_defect_qty").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("production_return_return_no_key").on(table.returnNo),
  index("idx_pr_status").on(table.status),
  index("idx_pr_material").on(table.materialId),
  index("idx_pr_created").on(table.createdAt),
]);

// ===== 产线退料标签 =====
// 标签流水号格式：TL{yyyyMMdd}{3位流水}，例如 TL20261001001。
// 类别（良品/来料不良/作业不良）不编码进流水号，由本表记录，入库扫码时后台查表校验。
export const productionReturnLabel = pgTable("production_return_label", {
  id: uuid("id").primaryKey().defaultRandom(),
  labelNo: varchar("label_no", { length: 50 }).notNull().unique(),
  returnId: uuid("return_id").notNull(),
  // 类别: good(良品) / incoming_defect(来料不良) / operation_defect(作业不良)
  category: varchar("category", { length: 30 }).notNull(),
  quantity: numeric("quantity").notNull().default('0'),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
}, (table) => [
  index("idx_prl_label_no").on(table.labelNo),
  index("idx_prl_return").on(table.returnId),
  foreignKey({
    columns: [table.returnId],
    foreignColumns: [productionReturn.id],
    name: "production_return_label_return_id_fkey",
  }).onDelete("cascade"),
]);

export const productionReturnLabelTable = productionReturnLabel;

export const productionReturnIqc = pgTable("production_return_iqc", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnId: uuid("return_id").notNull(),
  goodQty: numeric("good_qty").notNull().default('0'),
  incomingDefectQty: numeric("incoming_defect_qty").notNull().default('0'),
  operationDefectQty: numeric("operation_defect_qty").notNull().default('0'),
  inspectorId: userProfile("inspector_id"),
  inspectorName: varchar("inspector_name", { length: 100 }),
  inspectionTime: customTimestamptz("inspection_time", { precision: 3 }),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_pri_return").on(table.returnId),
  foreignKey({
    columns: [table.returnId],
    foreignColumns: [productionReturn.id],
    name: "production_return_iqc_return_id_fkey",
  }).onDelete("cascade"),
]);

// ============================================================
// MRB 拆分处置：处置明细 / 供应商退货单 / 返工单
// ============================================================

export const mrbDisposition = pgTable("mrb_disposition", {
  id: uuid("id").primaryKey().defaultRandom(),
  mrbId: uuid("mrb_id").notNull(),
  dispositionType: varchar("disposition_type", { length: 20 }).notNull(),
  /** 其他处置去向：customer_return / sample / hold（mrb-v2.1 新增） */
  otherType: varchar("other_type", { length: 20 }),
  /** 退回客户单号 / 留样编号（mrb-v2 新增） */
  refNo: varchar("ref_no", { length: 50 }),
  /** 待定暂存复核日期（mrb-v2 新增） */
  holdUntil: date("hold_until"),
  quantity: numeric("quantity").notNull().default('0'),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  fromLocationId: uuid("from_location_id"),
  toLocationId: uuid("to_location_id"),
  execStatus: varchar("exec_status", { length: 20 }).notNull().default('pending'),
  execTime: customTimestamptz("exec_time", { precision: 3 }),
  remark: text("remark"),
  sortOrder: integer("sort_order").notNull().default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_mrb_disp_mrb").on(table.mrbId),
  index("idx_mrb_disp_status").on(table.execStatus),
]);

/**
 * 二维码分摊明细（MRB v3）
 * 一行 = 某个处置行从某个收货箱里分走多少数量。
 * 一箱可拆到多个处置，故唯一键是 (disposition_id, receipt_id) 而非 (mrb_id, receipt_id)。
 * 注意：这是单据凭证，不是库存账——库存仍按批次管理。
 */
export const mrbDispositionLabel = pgTable("mrb_disposition_label", {
  id: uuid("id").primaryKey().defaultRandom(),
  mrbId: uuid("mrb_id").notNull(),
  dispositionId: uuid("disposition_id").notNull(),
  receiptId: uuid("receipt_id").notNull(),
  receiptNo: varchar("receipt_no", { length: 50 }),
  /** 六段码原文，界面直接展示 */
  qrContent: text("qr_content"),
  labelNo: varchar("label_no", { length: 100 }),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default('0'),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_mdl_mrb").on(table.mrbId),
  index("idx_mdl_disp").on(table.dispositionId),
  index("idx_mdl_receipt").on(table.receiptId),
  uniqueIndex("uq_mdl_disp_receipt").on(table.dispositionId, table.receiptId),
  foreignKey({
    columns: [table.mrbId],
    foreignColumns: [mrbReview.id],
    name: "mrb_disposition_label_mrb_id_fkey",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.dispositionId],
    foreignColumns: [mrbDisposition.id],
    name: "mrb_disposition_label_disp_id_fkey",
  }).onDelete("cascade"),
]);

/** MRB 抄送名单快照（MRB v3）：存姓名，人员改名不影响历史单据 */
export const mrbCc = pgTable("mrb_cc", {
  id: uuid("id").primaryKey().defaultRandom(),
  mrbId: uuid("mrb_id").notNull(),
  userId: userProfile("user_id").notNull(),
  userName: varchar("user_name", { length: 100 }),
  roleCode: varchar("role_code", { length: 50 }),
  readAt: customTimestamptz("read_at", { precision: 3 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
}, (table) => [
  index("idx_mrb_cc_mrb").on(table.mrbId),
  foreignKey({
    columns: [table.mrbId],
    foreignColumns: [mrbReview.id],
    name: "mrb_cc_mrb_id_fkey",
  }).onDelete("cascade"),
]);

/** 站内消息（MRB v3）：顶栏铃铛数据源，不做邮件/企微 */
export const sysNotice = pgTable("sys_notice", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: userProfile("user_id").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content"),
  /** mrb / rework / system */
  bizType: varchar("biz_type", { length: 20 }).notNull().default('mrb'),
  bizId: uuid("biz_id"),
  bizNo: varchar("biz_no", { length: 50 }),
  isRead: boolean("is_read").notNull().default(false),
  readAt: customTimestamptz("read_at", { precision: 3 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
}, (table) => [
  index("idx_notice_biz").on(table.bizType, table.bizId),
]);

export const supplierReturnOrder = pgTable("supplier_return_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnNo: varchar("return_no", { length: 50 }).notNull().unique(),
  mrbId: uuid("mrb_id"),
  dispositionId: uuid("disposition_id"),
  supplierId: uuid("supplier_id"),
  supplierCode: varchar("supplier_code", { length: 50 }),
  supplierName: varchar("supplier_name", { length: 200 }),
  batchNo: varchar("batch_no", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default('pending_out'),
  totalQty: numeric("total_qty").notNull().default('0'),
  outQty: numeric("out_qty").notNull().default('0'),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  outTime: customTimestamptz("out_time", { precision: 3 }),
  outBy: userProfile("out_by"),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_supplier_return_status").on(table.status),
  index("idx_supplier_return_mrb").on(table.mrbId),
]);

export const supplierReturnItem = pgTable("supplier_return_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 100 }),
  materialName: varchar("material_name", { length: 200 }),
  batchNo: varchar("batch_no", { length: 100 }),
  locationId: uuid("location_id"),
  inventoryId: uuid("inventory_id"),
  quantity: numeric("quantity").notNull().default('0'),
  outQty: numeric("out_qty").notNull().default('0'),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  dispositionId: uuid("disposition_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_supplier_return_item_order").on(table.orderId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [supplierReturnOrder.id],
    name: "supplier_return_item_order_id_fkey",
  }).onDelete("cascade"),
]);

export const reworkOrder = pgTable("rework_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  reworkNo: varchar("rework_no", { length: 50 }).notNull().unique(),
  mrbId: uuid("mrb_id"),
  dispositionId: uuid("disposition_id"),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 100 }),
  materialName: varchar("material_name", { length: 200 }),
  supplierId: uuid("supplier_id"),
  supplierCode: varchar("supplier_code", { length: 50 }),
  supplierName: varchar("supplier_name", { length: 200 }),
  batchNo: varchar("batch_no", { length: 100 }),
  quantity: numeric("quantity").notNull().default('0'),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  sourceLocationId: uuid("source_location_id"),
  targetLocationId: uuid("target_location_id"),
  finishTime: customTimestamptz("finish_time", { precision: 3 }),
  finishBy: userProfile("finish_by"),
  finishRemark: text("finish_remark"),
  reinspectTime: customTimestamptz("reinspect_time", { precision: 3 }),
  reinspectBy: userProfile("reinspect_by"),
  reinspectResult: varchar("reinspect_result", { length: 20 }),
  reinspectRemark: text("reinspect_remark"),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by"),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  index("idx_rework_status").on(table.status),
  index("idx_rework_mrb").on(table.mrbId),
]);

// table aliases
export const mrbDispositionTable = mrbDisposition;
export const supplierReturnOrderTable = supplierReturnOrder;
export const supplierReturnItemTable = supplierReturnItem;
export const reworkOrderTable = reworkOrder;
export const bomTable = bom;
export const bomItemTable = bomItem;
export const inventoryTable = inventory;
export const inventoryTransactionTable = inventoryTransaction;
export const iqcInspectionItemTable = iqcInspectionItem;
export const iqcInspectionRecordTable = iqcInspectionRecord;
export const iqcInspectionDraftTable = iqcInspectionDraft;
export const iqcLotTable = iqcLot;
export const iqcLotReceiptTable = iqcLotReceipt;
export const iqcReportTable = iqcReport;
export const iqcTemplateTable = iqcTemplate;
export const iqcTemplateItemTable = iqcTemplateItem;
export const iqcStandardItemTable = iqcStandardItem;
export const iqcTemplateMaterialTable = iqcTemplateMaterial;
export const materialTable = material;
export const materialSubstitutionTable = materialSubstitution;
export const materialExpiryExtensionTable = materialExpiryExtension;
export const materialRequirementTable = materialRequirement;
export const materialRequirementItemTable = materialRequirementItem;
export const mrbReviewTable = mrbReview;
export const mrbReviewerTable = mrbReviewer;
export const operationLogTable = operationLog;
export const pickingOrderTable = pickingOrder;
export const pickingOrderItemTable = pickingOrderItem;
export const receiptOrderTable = receiptOrder;
export const roleUserTable = roleUser;
export const stockTransferTable = stockTransfer;
export const supplierTable = supplier;
export const supplierMaterialTable = supplierMaterial;
export const sysAccountTable = sysAccount;
export const sysParamTable = sysParam;
export const sysRoleTable = sysRole;
export const warehouseTable = warehouse;
export const warehouseLocationTable = warehouseLocation;
export const workOrderTable = workOrder;
export const iqcInspectionStrictnessTable = iqcInspectionStrictness;
export const iqcStrictnessTransferLogTable = iqcStrictnessTransferLog;
export const productionReturnTable = productionReturn;
export const productionReturnIqcTable = productionReturnIqc;

export const defectiveMoveTask = pgTable("defective_move_task", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 调拨单号：MRB 派生 = <检验单号>-NGDB；手工制单 = NGDB+日期-流水 */
  moveNo: varchar("move_no", { length: 50 }),
  /** 来源 IQC 检验单号（MRB 派生单才有；手工制单为空） */
  sourceInspectionNo: varchar("source_inspection_no", { length: 50 }),
  // 手工制单没有来料批次，生产退料也可能没有供应商 —— 两列均放开非空
  lotId: uuid("lot_id"),
  materialId: uuid("material_id").notNull(),
  supplierId: uuid("supplier_id"),
  batchNo: varchar("batch_no", { length: 100 }),
  quantity: varchar("quantity", { length: 50 }).notNull(),
  unit: varchar("unit", { length: 20 }),
  fromLocationId: uuid("from_location_id").notNull(),
  toLocationId: uuid("to_location_id"),
  /** 制单时锁定的来源库存行（手工单执行时按此精确扣减） */
  inventoryId: uuid("inventory_id"),
  /** good=良品手工调拨，defective/scrapped=MRB 冻结行 */
  fromStockStatus: varchar("from_stock_status", { length: 20 }),
  /** pending_confirm / pending / completed / cancelled */
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  operatorId: userProfile("operator_id"),
  remark: varchar("remark", { length: 500 }),
  // ---- MRB v3 增量：来源单据 ----
  mrbId: uuid("mrb_id"),
  /** mrb_reject / mrb_return / mrb_scrap / manual */
  source: varchar("source", { length: 20 }),
  reason: text("reason"),
  // ---- v2 增量：制单 / 主管确认 ----
  createdBy: userProfile("created_by"),
  confirmedBy: userProfile("confirmed_by"),
  confirmedAt: customTimestamptz("confirmed_at", { precision: 3 }),
  confirmRemark: text("confirm_remark"),
  // ---- v2 增量：扫码凭据（搬的是哪几箱、落到哪个库位） ----
  scanCodes: text("scan_codes"),
  scanToCode: varchar("scan_to_code", { length: 100 }),
  scanAt: customTimestamptz("scan_at", { precision: 3 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const defectiveMoveTaskTable = defectiveMoveTask;
// ===== 超补领料单 =====

export const overPickingOrder = pgTable("over_picking_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
  /** OA 电子流实例（超补领料单） */
  oaInstanceId: bigint("oa_instance_id", { mode: 'number' }),
  oaStatus: varchar("oa_status", { length: 20 }),
  workOrderId: uuid("work_order_id").notNull(),
  workOrderNo: varchar("work_order_no", { length: 50 }).notNull(),
  // 状态: pending_approval(待审批) / approved(已生效) / rejected(已驳回) / cancelled(已取消)
  status: varchar("status", { length: 20 }).notNull().default('pending_approval'),
  totalQty: numeric("total_qty").default('0'),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).default('0'),
  applicantId: userProfile("applicant_id"),
  applicantName: varchar("applicant_name", { length: 100 }),
  approverId: userProfile("approver_id"),
  approverName: varchar("approver_name", { length: 100 }),
  approvalTime: customTimestamptz("approval_time", { precision: 3 }),
  approvalRemark: text("approval_remark"),
  // 生效后生成的领料单
  pickingId: uuid("picking_id"),
  pickingNo: varchar("picking_no", { length: 50 }),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("over_picking_order_no_key").on(table.orderNo),
  index("idx_opo_work_order").on(table.workOrderId),
  index("idx_opo_status").on(table.status),
  foreignKey({
    columns: [table.workOrderId],
    foreignColumns: [workOrder.id],
    name: "over_picking_order_work_order_id_fkey",
  }),
]);

export const overPickingItem = pgTable("over_picking_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  materialId: uuid("material_id").notNull(),
  materialCode: varchar("material_code", { length: 100 }).notNull(),
  materialName: varchar("material_name", { length: 200 }).notNull(),
  specification: text("specification"),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  quantity: numeric("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).default('0'),
  amount: numeric("amount", { precision: 14, scale: 2 }).default('0'),
  workSection: varchar("work_section", { length: 20 }),
  reason: text("reason"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_opi_order").on(table.orderId),
  index("idx_opi_material").on(table.materialId),
  foreignKey({
    columns: [table.orderId],
    foreignColumns: [overPickingOrder.id],
    name: "over_picking_item_order_id_fkey",
  }).onDelete("cascade"),
]);

// ===== 库存盘点 =====

export const stockTakeOrder = pgTable("stock_take_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  takeNo: varchar("take_no", { length: 50 }).notNull().unique(),
  // 盘点期间（YYYY-MM），每月一次
  periodMonth: varchar("period_month", { length: 7 }).notNull(),
  // ---- 主子盘点单 ----
  /** 子单所属主盘点单；主单与单张盘点单为空 */
  parentId: uuid("parent_id"),
  /** standalone=单张盘点单 / main=主盘点单（只做汇总） / sub=子盘点单（按库位范围） */
  orderType: varchar("order_type", { length: 12 }).notNull().default('standalone'),
  /** 子单盘点范围：区域 / 货架 / 层 / 地址码起止 */
  scopeArea: varchar("scope_area", { length: 50 }),
  scopeShelf: varchar("scope_shelf", { length: 50 }),
  scopeLayer: varchar("scope_layer", { length: 50 }),
  scopeLocFrom: varchar("scope_loc_from", { length: 100 }),
  scopeLocTo: varchar("scope_loc_to", { length: 100 }),
  /** 主单下子单数量（冗余，便于列表展示） */
  childCount: integer("child_count").notNull().default(0),
  // 盘点类型: monthly(月度盘点) / spot(临时抽盘)
  takeType: varchar("take_type", { length: 20 }).notNull().default('monthly'),
  // 盘点范围: all(良品仓+不良品仓) / good(仅良品仓) / defective(仅不良品仓)
  scope: varchar("scope", { length: 20 }).notNull().default('all'),
  // 盘点所属仓库（按仓库代码建立盘点清单）
  warehouseId: uuid("warehouse_id"),
  warehouseCode: varchar("warehouse_code", { length: 50 }),
  warehouseName: varchar("warehouse_name", { length: 100 }),
  // 状态: draft(盘点中) / pending_approval(待审批) / approved(已批准) / rejected(已驳回) / cancelled(已取消)
  status: varchar("status", { length: 24 }).notNull().default('draft'),
  title: varchar("title", { length: 200 }),
  operatorId: userProfile("operator_id"),
  operatorName: varchar("operator_name", { length: 100 }),
  approverId: userProfile("approver_id"),
  approverName: varchar("approver_name", { length: 100 }),
  approvalTime: customTimestamptz("approval_time", { precision: 3 }),
  approvalRemark: text("approval_remark"),
  submitTime: customTimestamptz("submit_time", { precision: 3 }),
  // 管理员授权修改（审批后如需更新）
  unlockAuthorizedBy: userProfile("unlock_authorized_by"),
  unlockAuthorizedName: varchar("unlock_authorized_name", { length: 100 }),
  unlockAuthorizedAt: customTimestamptz("unlock_authorized_at", { precision: 3 }),
  unlockReason: text("unlock_reason"),
  revisionCount: integer("revision_count").notNull().default(0),
  // 汇总统计
  totalLines: integer("total_lines").notNull().default(0),
  checkedLines: integer("checked_lines").notNull().default(0),
  matchLines: integer("match_lines").notNull().default(0),
  profitLines: integer("profit_lines").notNull().default(0),
  lossLines: integer("loss_lines").notNull().default(0),
  bookQtyTotal: numeric("book_qty_total").default('0'),
  actualQtyTotal: numeric("actual_qty_total").default('0'),
  diffQtyTotal: numeric("diff_qty_total").default('0'),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("stock_take_order_take_no_key").on(table.takeNo),
  index("idx_sto_period").on(table.periodMonth),
  index("idx_sto_warehouse").on(table.warehouseCode),
  index("idx_sto_status").on(table.status),
  index("idx_sto_operator").on(table.operatorId),
  index("idx_sto_parent").on(table.parentId),
]);

export const stockTakeItem = pgTable("stock_take_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  takeId: uuid("take_id").notNull(),
  // 账面库存行（盘盈行可能为空）
  inventoryId: uuid("inventory_id"),
  materialId: uuid("material_id"),
  materialCode: varchar("material_code", { length: 100 }).notNull(),
  materialName: varchar("material_name", { length: 200 }),
  specification: text("specification"),
  unit: varchar("unit", { length: 20 }).notNull().default('PCS'),
  supplierId: uuid("supplier_id"),
  supplierCode: varchar("supplier_code", { length: 100 }),
  supplierName: varchar("supplier_name", { length: 200 }),
  locationId: uuid("location_id"),
  locationCode: varchar("location_code", { length: 100 }),
  warehouseId: uuid("warehouse_id"),
  warehouseCode: varchar("warehouse_code", { length: 50 }),
  warehouseName: varchar("warehouse_name", { length: 100 }),
  // 库存状态: good(良品仓) / defective(不良品仓) / rework
  stockStatus: varchar("stock_status", { length: 20 }).notNull().default('good'),
  batchNo: varchar("batch_no", { length: 100 }),
  labelNo: varchar("label_no", { length: 150 }),
  productionDate: date("production_date"),
  // 账面数量
  bookQty: numeric("book_qty").notNull().default('0'),
  // 实盘数量（扫码累加 / 手工录入）
  actualQty: numeric("actual_qty").notNull().default('0'),
  // 差异数量 = 实盘 - 账面
  diffQty: numeric("diff_qty").notNull().default('0'),
  // 差异类型: pending(未盘点) / match(账实一致) / profit(盘盈) / loss(盘亏)
  diffType: varchar("diff_type", { length: 12 }).notNull().default('pending'),
  // 已扫描标签明细 [{ labelNo, materialCode, batchNo, qty, scanTime, operatorName }]
  scannedLabels: jsonb("scanned_labels").default([]),
  scanCount: integer("scan_count").notNull().default(0),
  // 是否已确认盘点（扫码或手工确认）
  checked: boolean("checked").notNull().default(false),
  remark: text("remark"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_sti_take").on(table.takeId),
  index("idx_sti_material").on(table.materialId),
  index("idx_sti_supplier").on(table.supplierId),
  index("idx_sti_diff_type").on(table.diffType),
  index("idx_sti_label").on(table.labelNo),
  foreignKey({
    columns: [table.takeId],
    foreignColumns: [stockTakeOrder.id],
    name: "stock_take_item_take_id_fkey",
  }).onDelete("cascade"),
]);

export const stockTakeLog = pgTable("stock_take_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  takeId: uuid("take_id").notNull(),
  itemId: uuid("item_id"),
  // 操作: create / scan / adjust / confirm_missing / submit / approve / reject / unlock / cancel
  action: varchar("action", { length: 30 }).notNull(),
  detail: text("detail"),
  operatorId: userProfile("operator_id"),
  operatorName: varchar("operator_name", { length: 100 }),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_stl_take").on(table.takeId),
  index("idx_stl_action").on(table.action),
  foreignKey({
    columns: [table.takeId],
    foreignColumns: [stockTakeOrder.id],
    name: "stock_take_log_take_id_fkey",
  }).onDelete("cascade"),
]);

// =============================================================
// MES 接入（2026-10-31）
// 对应接口文档：WMS工单下发接口_对接文档_20261030.md v1.0
// =============================================================

/** MES 用料明细快照：工单需求 + 缺口，按 (mo_no, 物料, 位号) 唯一 */
export const mesWorkOrderMaterial = pgTable("mes_work_order_material", {
  id: uuid("id").primaryKey().defaultRandom(),
  moNo: varchar("mo_no", { length: 50 }).notNull(),
  workSection: varchar("work_section", { length: 20 }).notNull().default('smt'),
  materialCode: varchar("material_code", { length: 100 }).notNull(),
  materialName: varchar("material_name", { length: 200 }),
  specification: text("specification"),
  unit: varchar("unit", { length: 20 }).default('PCS'),
  qtyPer: numeric("qty_per", { precision: 18, scale: 4 }).default('0'),
  needQty: numeric("need_qty", { precision: 18, scale: 4 }).default('0'),
  issueQty: numeric("issue_qty", { precision: 18, scale: 4 }).default('0'),
  openQty: numeric("open_qty", { precision: 18, scale: 4 }).default('0'),
  mpq: numeric("mpq", { precision: 18, scale: 4 }).default('1'),
  suggestQty: numeric("suggest_qty", { precision: 18, scale: 4 }).default('0'),
  posRef: varchar("pos_ref", { length: 200 }),
  altList: text("alt_list"),
  isAlt: boolean("is_alt").default(false),
  /** issue = 来自 MES 已开领料单；bom = BOM 现算的理论用量 */
  srcType: varchar("src_type", { length: 20 }).default('bom'),
  segmentRaw: varchar("segment_raw", { length: 20 }),
  materialId: uuid("material_id"),
  syncedAt: customTimestamptz("synced_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_mes_mat_mo").on(table.moNo),
  index("idx_mes_mat_code").on(table.materialCode),
]);

/** 同步游标：记录每类同步任务拉到哪里，进程重启不丢 */
export const mesSyncState = pgTable("mes_sync_state", {
  syncKey: varchar("sync_key", { length: 50 }).primaryKey(),
  cursorUpdated: customTimestamptz("cursor_updated", { precision: 3 }),
  lastRunAt: customTimestamptz("last_run_at", { precision: 3 }),
  lastOkAt: customTimestamptz("last_ok_at", { precision: 3 }),
  lastStatus: varchar("last_status", { length: 20 }),
  lastMessage: text("last_message"),
  lastRequestId: varchar("last_request_id", { length: 64 }),
  updatedAt: customTimestamptz("updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** 同步运行日志：每轮一条，界面上直接看「为什么没进来」 */
export const mesSyncLog = pgTable("mes_sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  task: varchar("task", { length: 30 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  pulled: integer("pulled").default(0),
  created: integer("created").default(0),
  updated: integer("updated").default(0),
  skipped: integer("skipped").default(0),
  failed: integer("failed").default(0),
  message: text("message"),
  requestId: varchar("request_id", { length: 64 }),
  startedAt: customTimestamptz("started_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: customTimestamptz("finished_at", { precision: 3 }),
});

/**
 * MES 发料结果回写队列
 * ------------------------------------------------------------------
 * MES 工单结案要按「实际发料数量」结算，而 MES 给 WMS 的接口是只读的，
 * 所以 WMS 必须先把发料事件可靠落库，再由后台任务推给 MES。
 *
 * 为什么独立建表而不是在 picking_order 上加列：
 *  1. 一张单会有 issued / received / returned 多个事件，一列表达不了；
 *  2. 重试次数、下次重试时间、最后错误属于投递状态，不该污染业务表；
 *  3. 运维要能看到「哪些没推成功、为什么」。
 *
 * 幂等：(picking_id, event_type) 唯一。补发/重发料时重置为 pending，
 * 用新的数据快照再推一次（幂等键带版本，MES 侧按分片覆盖）。
 */
export const mesIssueWriteback = pgTable("mes_issue_writeback", {
  id: uuid("id").primaryKey().defaultRandom(),
  pickingId: uuid("picking_id").notNull(),
  pickingNo: varchar("picking_no", { length: 50 }).notNull(),
  /** issued = 发料完成；received = 产线签收；returned = 产线退料（预留） */
  eventType: varchar("event_type", { length: 20 }).notNull().default('issued'),
  /** pending 待推 / sent 已成功 / failed 超过重试上限 / skipped 不满足回写条件 */
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: customTimestamptz("next_retry_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  lastError: text("last_error"),
  /** 推送时的快照，事后核对「当时发的到底是什么」 */
  payload: jsonb("payload"),
  requestId: varchar("request_id", { length: 64 }),
  sentAt: customTimestamptz("sent_at", { precision: 3 }),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("mes_issue_writeback_picking_event_key").on(table.pickingId, table.eventType),
  index("idx_miw_status_retry").on(table.status, table.nextRetryAt),
  index("idx_miw_picking_no").on(table.pickingNo),
]);

