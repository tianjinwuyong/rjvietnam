

// ============================================================
// RJVN 统一管理系统 — 新增模块表定义
// ============================================================

// ========== 销售模块 ==========
export const salesCustomer = pgTable("sales_customer", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerCode: varchar("customer_code", { length: 50 }).notNull(),
  customerName: varchar("customer_name", { length: 200 }).notNull(),
  customerNameVi: varchar("customer_name_vi", { length: 200 }),
  customerNameEn: varchar("customer_name_en", { length: 200 }),
  contactPerson: varchar("contact_person", { length: 100 }),
  contactPhone: varchar("contact_phone", { length: 30 }),
  contactEmail: varchar("contact_email", { length: 150 }),
  address: varchar("address", { length: 500 }),
  taxCode: varchar("tax_code", { length: 50 }),
  paymentTerm: varchar("payment_term", { length: 50 }).default('NET30'),
  currency: varchar("currency", { length: 10 }).default('VND'),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("sales_customer_customer_code_key").on(table.customerCode),
  index("idx_sales_customer_status").on(table.status),
]);

export const salesQuotation = pgTable("sales_quotation", {
  id: uuid("id").primaryKey().defaultRandom(),
  quotationNo: varchar("quotation_no", { length: 50 }).notNull(),
  customerId: uuid("customer_id").notNull(),
  quotationDate: date("quotation_date").notNull().default(sql`CURRENT_DATE`),
  validUntil: date("valid_until"),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).default('0'),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).default('10'),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).default('0'),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).default('0'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("sales_quotation_quotation_no_key").on(table.quotationNo),
  index("idx_sales_quotation_customer").on(table.customerId),
  index("idx_sales_quotation_status").on(table.status),
]);

export const salesOrder = pgTable("sales_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNo: varchar("order_no", { length: 50 }).notNull(),
  customerId: uuid("customer_id").notNull(),
  quotationId: uuid("quotation_id"),
  orderDate: date("order_date").notNull().default(sql`CURRENT_DATE`),
  deliveryDate: date("delivery_date"),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).default('0'),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).default('10'),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).default('0'),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).default('0'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("sales_order_order_no_key").on(table.orderNo),
  index("idx_sales_order_customer").on(table.customerId),
  index("idx_sales_order_status").on(table.status),
]);

// ========== 人事模块 ==========
export const hrDepartment = pgTable("hr_department", {
  id: uuid("id").primaryKey().defaultRandom(),
  deptCode: varchar("dept_code", { length: 50 }).notNull(),
  deptName: varchar("dept_name", { length: 100 }).notNull(),
  deptNameVi: varchar("dept_name_vi", { length: 100 }),
  deptNameEn: varchar("dept_name_en", { length: 100 }),
  parentId: uuid("parent_id"),
  managerId: uuid("manager_id"),
  sortOrder: integer("sort_order").default(0),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("hr_department_dept_code_key").on(table.deptCode),
  index("idx_hr_dept_parent").on(table.parentId),
  index("idx_hr_dept_status").on(table.status),
]);

export const hrEmployee = pgTable("hr_employee", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeNo: varchar("employee_no", { length: 30 }).notNull(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  fullNameVi: varchar("full_name_vi", { length: 100 }),
  gender: varchar("gender", { length: 10 }),
  birthDate: date("birth_date"),
  idCard: varchar("id_card", { length: 20 }),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 150 }),
  departmentId: uuid("department_id"),
  position: varchar("position", { length: 100 }),
  employmentType: varchar("employment_type", { length: 20 }).default('full_time'),
  hireDate: date("hire_date"),
  leaveDate: date("leave_date"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("hr_employee_employee_no_key").on(table.employeeNo),
  index("idx_hr_employee_dept").on(table.departmentId),
  index("idx_hr_employee_status").on(table.status),
]);

export const hrAttendanceRaw = pgTable("hr_attendance_raw", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull(),
  workDate: date("work_date").notNull(),
  clockIn: customTimestamptz("clock_in", { precision: 3 }),
  clockOut: customTimestamptz("clock_out", { precision: 3 }),
  clockInMethod: varchar("clock_in_method", { length: 20 }).default('pda'),
  clockOutMethod: varchar("clock_out_method", { length: 20 }).default('pda'),
  deviceId: varchar("device_id", { length: 40 }),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("hr_attendance_raw_employee_id_work_date_key").on(table.employeeId, table.workDate),
  index("idx_hr_att_employee").on(table.employeeId, table.workDate),
]);

export const hrPayrollBatch = pgTable("hr_payroll_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchNo: varchar("batch_no", { length: 48 }).notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  currency: varchar("currency", { length: 10 }).default('VND'),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  employeeCount: integer("employee_count").default(0),
  totalGross: numeric("total_gross", { precision: 18, scale: 2 }).default('0'),
  totalDeductions: numeric("total_deductions", { precision: 18, scale: 2 }).default('0'),
  totalNet: numeric("total_net", { precision: 18, scale: 2 }).default('0'),
  calculatedAt: customTimestamptz("calculated_at", { precision: 3 }),
  paidAt: customTimestamptz("paid_at", { precision: 3 }),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("hr_payroll_batch_batch_no_key").on(table.batchNo),
  uniqueIndex("hr_payroll_batch_year_month_key").on(table.year, table.month),
  index("idx_hr_payroll_batch_period").on(table.year, table.month, table.status),
]);

// ========== 审批引擎 ==========
export const flowInstance = pgTable("flow_instance", {
  id: uuid("id").primaryKey().defaultRandom(),
  flowNo: varchar("flow_no", { length: 50 }).notNull(),
  flowType: varchar("flow_type", { length: 50 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  bizType: varchar("biz_type", { length: 50 }),
  bizId: uuid("biz_id"),
  bizNo: varchar("biz_no", { length: 100 }),
  applicantId: uuid("applicant_id").notNull(),
  status: varchar("status", { length: 20 }).notNull().default('pending'),
  currentStep: integer("current_step").default(1),
  totalSteps: integer("total_steps").default(1),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("flow_instance_flow_no_key").on(table.flowNo),
  index("idx_flow_instance_status").on(table.status),
  index("idx_flow_instance_applicant").on(table.applicantId),
]);

// ========== 设备管理 ==========
export const equipmentAsset = pgTable("equipment_asset", {
  id: uuid("id").primaryKey().defaultRandom(),
  equipmentCode: varchar("equipment_code", { length: 50 }).notNull(),
  equipmentName: varchar("equipment_name", { length: 200 }).notNull(),
  equipmentNameVi: varchar("equipment_name_vi", { length: 200 }),
  category: varchar("category", { length: 50 }),
  model: varchar("model", { length: 100 }),
  serialNo: varchar("serial_no", { length: 100 }),
  location: varchar("location", { length: 200 }),
  purchaseDate: date("purchase_date"),
  warrantyUntil: date("warranty_until"),
  status: varchar("status", { length: 20 }).notNull().default('active'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("equipment_asset_equipment_code_key").on(table.equipmentCode),
  index("idx_equipment_category").on(table.category),
  index("idx_equipment_status").on(table.status),
]);

// ========== 采购模块 ==========
export const purchaseOrder = pgTable("purchase_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  poNo: varchar("po_no", { length: 50 }).notNull(),
  supplierId: uuid("supplier_id"),
  poDate: date("po_date").notNull().default(sql`CURRENT_DATE`),
  expectedDate: date("expected_date"),
  status: varchar("status", { length: 20 }).notNull().default('draft'),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).default('0'),
  remark: text("remark"),
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  createdBy: userProfile("_created_by"),
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: userProfile("_updated_by"),
}, (table) => [
  uniqueIndex("purchase_order_po_no_key").on(table.poNo),
  index("idx_po_supplier").on(table.supplierId),
  index("idx_po_status").on(table.status),
]);
