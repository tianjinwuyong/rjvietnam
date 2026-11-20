-- ============================================================
-- schema 补全脚本（2026-10-16 回归修复）
--
-- 为什么需要它：
--   init-db.ts 历史上只做「建类型 / 建表 / 建角色账号」，
--   从未执行 server/database 下的补充脚本；同时历史库是由更早版本的
--   schema.ts 建出的，于是出现下列缺口，导致收料 nextval() 直接 500、
--   MRB / 退货 / 返工 / 超补领料 / 盘点 / IQC 若干模块整块不可用：
--     · 12 个单据号序列全部缺失（含 seq_receipt_no）→ 收货 500 直接原因
--     · 若干 schema.ts 已定义、旧库却没有的表 / 列 / 索引
--   本文件把这些缺口一次性、幂等地补齐。
--
-- 幂等性：全部使用 IF NOT EXISTS；外键用 DO 块判存在后添加，
--         重复执行不报错、不重复建对象、不破坏已有数据。
-- 执行顺序：必须在「建表」（drizzle-kit push）之后执行。
-- 注意：纯英文/ASCII 与中文注释混排，交由 postgres-js 直接执行（不经 psql）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 单据号序列（12 个）
--    对应各 service 里的 nextval('...') 调用点：
--      seq_iqc_lot_no / seq_iqc_inspection_no  -> iqc.service.ts, inventory.service.ts, receipt.service.ts
--      seq_transfer_no / seq_adjust_tx_no      -> inventory.service.ts
--      seq_report_no                           -> iqc.service.ts
--      seq_over_picking_no                     -> over-picking.service.ts
--      seq_inventory_label_no                  -> receipt.service.ts
--      seq_receipt_no                          -> receipt.service.ts
--      seq_mrb_no                              -> mrb.service.ts
--      seq_supplier_return_no / seq_rework_no  -> mrb.service.ts
--      seq_stock_take_no                       -> stock-take.service.ts
--   用序列而非 MAX+1，避免并发下生成重复单据号。
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_iqc_lot_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_iqc_inspection_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_transfer_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_adjust_tx_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_report_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_over_picking_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_inventory_label_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_receipt_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_mrb_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_supplier_return_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_rework_no START 1;
CREATE SEQUENCE IF NOT EXISTS seq_stock_take_no START 1;

-- ------------------------------------------------------------
-- 2. 缺失业务表（schema.ts 已定义、旧库缺、且没有其它补充脚本负责的 7 张）
--    字段定义严格对齐 schema.ts（经 drizzle-kit generate 产出后转写）。
-- ------------------------------------------------------------

-- IQC 检验草稿（进行中批次的检验录入暂存，同一 lot 仅一份）
CREATE TABLE IF NOT EXISTS "iqc_inspection_draft" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lot_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "inspector_id" "user_profile",
  "_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "iqc_inspection_draft_lot_id_unique" UNIQUE("lot_id")
);

-- 产线退料标签（退料单生成后打印/扫码入库用）
CREATE TABLE IF NOT EXISTS "production_return_label" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "label_no" varchar(50) NOT NULL,
  "return_id" uuid NOT NULL,
  "category" varchar(30) NOT NULL,
  "quantity" numeric DEFAULT '0' NOT NULL,
  "_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "_created_by" "user_profile",
  CONSTRAINT "production_return_label_label_no_unique" UNIQUE("label_no")
);

-- 超补领料单（明细）
CREATE TABLE IF NOT EXISTS "over_picking_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "material_id" uuid NOT NULL,
  "material_code" varchar(100) NOT NULL,
  "material_name" varchar(200) NOT NULL,
  "specification" text,
  "unit" varchar(20) DEFAULT 'PCS' NOT NULL,
  "quantity" numeric NOT NULL,
  "unit_price" numeric(12, 2) DEFAULT '0',
  "amount" numeric(14, 2) DEFAULT '0',
  "work_section" varchar(20),
  "reason" text,
  "_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 超补领料单（头）
CREATE TABLE IF NOT EXISTS "over_picking_order" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_no" varchar(50) NOT NULL,
  "work_order_id" uuid NOT NULL,
  "work_order_no" varchar(50) NOT NULL,
  "status" varchar(20) DEFAULT 'pending_approval' NOT NULL,
  "total_qty" numeric DEFAULT '0',
  "total_amount" numeric(14, 2) DEFAULT '0',
  "applicant_id" "user_profile",
  "applicant_name" varchar(100),
  "approver_id" "user_profile",
  "approver_name" varchar(100),
  "approval_time" timestamptz(3),
  "approval_remark" text,
  "picking_id" uuid,
  "picking_no" varchar(50),
  "remark" text,
  "_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "_created_by" "user_profile",
  "_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "_updated_by" "user_profile",
  CONSTRAINT "over_picking_order_order_no_unique" UNIQUE("order_no")
);

-- 盘点单（头）。必须先于 stock_take_item / stock_take_log 建，供其外键引用。
CREATE TABLE IF NOT EXISTS "stock_take_order" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "take_no" varchar(50) NOT NULL,
  "period_month" varchar(7) NOT NULL,
  "take_type" varchar(20) DEFAULT 'monthly' NOT NULL,
  "scope" varchar(20) DEFAULT 'all' NOT NULL,
  "warehouse_id" uuid,
  "warehouse_code" varchar(50),
  "warehouse_name" varchar(100),
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "title" varchar(200),
  "operator_id" "user_profile",
  "operator_name" varchar(100),
  "approver_id" "user_profile",
  "approver_name" varchar(100),
  "approval_time" timestamptz(3),
  "approval_remark" text,
  "submit_time" timestamptz(3),
  "unlock_authorized_by" "user_profile",
  "unlock_authorized_name" varchar(100),
  "unlock_authorized_at" timestamptz(3),
  "unlock_reason" text,
  "revision_count" integer DEFAULT 0 NOT NULL,
  "total_lines" integer DEFAULT 0 NOT NULL,
  "checked_lines" integer DEFAULT 0 NOT NULL,
  "match_lines" integer DEFAULT 0 NOT NULL,
  "profit_lines" integer DEFAULT 0 NOT NULL,
  "loss_lines" integer DEFAULT 0 NOT NULL,
  "book_qty_total" numeric DEFAULT '0',
  "actual_qty_total" numeric DEFAULT '0',
  "diff_qty_total" numeric DEFAULT '0',
  "remark" text,
  "_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "_created_by" "user_profile",
  "_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "_updated_by" "user_profile",
  CONSTRAINT "stock_take_order_take_no_unique" UNIQUE("take_no")
);

-- 盘点明细
CREATE TABLE IF NOT EXISTS "stock_take_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "take_id" uuid NOT NULL,
  "inventory_id" uuid,
  "material_id" uuid,
  "material_code" varchar(100) NOT NULL,
  "material_name" varchar(200),
  "specification" text,
  "unit" varchar(20) DEFAULT 'PCS' NOT NULL,
  "supplier_id" uuid,
  "supplier_code" varchar(100),
  "supplier_name" varchar(200),
  "location_id" uuid,
  "location_code" varchar(100),
  "warehouse_id" uuid,
  "warehouse_code" varchar(50),
  "warehouse_name" varchar(100),
  "stock_status" varchar(20) DEFAULT 'good' NOT NULL,
  "batch_no" varchar(100),
  "label_no" varchar(150),
  "production_date" date,
  "book_qty" numeric DEFAULT '0' NOT NULL,
  "actual_qty" numeric DEFAULT '0' NOT NULL,
  "diff_qty" numeric DEFAULT '0' NOT NULL,
  "diff_type" varchar(12) DEFAULT 'pending' NOT NULL,
  "scanned_labels" jsonb DEFAULT '[]'::jsonb,
  "scan_count" integer DEFAULT 0 NOT NULL,
  "checked" boolean DEFAULT false NOT NULL,
  "remark" text,
  "_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 盘点操作日志
CREATE TABLE IF NOT EXISTS "stock_take_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "take_id" uuid NOT NULL,
  "item_id" uuid,
  "action" varchar(30) NOT NULL,
  "detail" text,
  "operator_id" "user_profile",
  "operator_name" varchar(100),
  "_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ------------------------------------------------------------
-- 3. 缺失列（旧库建表时 schema 里还没有的列）
--    ORDER BY 无关，ADD COLUMN IF NOT EXISTS 幂等。
-- ------------------------------------------------------------
-- BUG-001/005 相关：IQC 批次检验单号（schema.ts 已加，旧库缺）
ALTER TABLE "iqc_lot" ADD COLUMN IF NOT EXISTS "inspection_no" varchar(50);
-- 检验项 AQL 快照（采样方案展示用）
ALTER TABLE "iqc_inspection_record" ADD COLUMN IF NOT EXISTS "aql" varchar(20);
-- 特采批次标记（MRB 特采方案配套；mrb_disposition_tables.sql 中亦有同样语句，幂等）
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "is_special_admit" boolean NOT NULL DEFAULT false;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "special_admit_ref" varchar(100);

-- ------------------------------------------------------------
-- 4. 缺失索引（与 schema.ts 的 index()/uniqueIndex() 对齐）
-- ------------------------------------------------------------
-- iqc_inspection_draft
CREATE UNIQUE INDEX IF NOT EXISTS "iqc_inspection_draft_lot_id_key" ON "iqc_inspection_draft" USING btree ("lot_id");
-- production_return_label
CREATE INDEX IF NOT EXISTS "idx_prl_label_no" ON "production_return_label" USING btree ("label_no");
CREATE INDEX IF NOT EXISTS "idx_prl_return" ON "production_return_label" USING btree ("return_id");
-- over_picking_item
CREATE INDEX IF NOT EXISTS "idx_opi_order" ON "over_picking_item" USING btree ("order_id");
CREATE INDEX IF NOT EXISTS "idx_opi_material" ON "over_picking_item" USING btree ("material_id");
-- over_picking_order
CREATE UNIQUE INDEX IF NOT EXISTS "over_picking_order_no_key" ON "over_picking_order" USING btree ("order_no");
CREATE INDEX IF NOT EXISTS "idx_opo_work_order" ON "over_picking_order" USING btree ("work_order_id");
CREATE INDEX IF NOT EXISTS "idx_opo_status" ON "over_picking_order" USING btree ("status");
-- stock_take_order
CREATE UNIQUE INDEX IF NOT EXISTS "stock_take_order_take_no_key" ON "stock_take_order" USING btree ("take_no");
CREATE INDEX IF NOT EXISTS "idx_sto_period" ON "stock_take_order" USING btree ("period_month");
CREATE INDEX IF NOT EXISTS "idx_sto_warehouse" ON "stock_take_order" USING btree ("warehouse_code");
CREATE INDEX IF NOT EXISTS "idx_sto_status" ON "stock_take_order" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_sto_operator" ON "stock_take_order" USING btree ("operator_id");
-- stock_take_item
CREATE INDEX IF NOT EXISTS "idx_sti_take" ON "stock_take_item" USING btree ("take_id");
CREATE INDEX IF NOT EXISTS "idx_sti_material" ON "stock_take_item" USING btree ("material_id");
CREATE INDEX IF NOT EXISTS "idx_sti_supplier" ON "stock_take_item" USING btree ("supplier_id");
CREATE INDEX IF NOT EXISTS "idx_sti_diff_type" ON "stock_take_item" USING btree ("diff_type");
CREATE INDEX IF NOT EXISTS "idx_sti_label" ON "stock_take_item" USING btree ("label_no");
-- stock_take_log
CREATE INDEX IF NOT EXISTS "idx_stl_take" ON "stock_take_log" USING btree ("take_id");
CREATE INDEX IF NOT EXISTS "idx_stl_action" ON "stock_take_log" USING btree ("action");
-- iqc_lot：inspection_no 的唯一索引（旧库缺列，补列后补索引）
CREATE UNIQUE INDEX IF NOT EXISTS "iqc_lot_inspection_no_key" ON "iqc_lot" USING btree ("inspection_no");

-- ------------------------------------------------------------
-- 5. 外键（Postgres 不支持 ADD CONSTRAINT IF NOT EXISTS，用 DO 块判存在后添加）
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'iqc_inspection_draft_lot_id_fkey') THEN
    ALTER TABLE "iqc_inspection_draft" ADD CONSTRAINT "iqc_inspection_draft_lot_id_fkey"
      FOREIGN KEY ("lot_id") REFERENCES "public"."iqc_lot"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_return_label_return_id_fkey') THEN
    ALTER TABLE "production_return_label" ADD CONSTRAINT "production_return_label_return_id_fkey"
      FOREIGN KEY ("return_id") REFERENCES "public"."production_return"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'over_picking_order_work_order_id_fkey') THEN
    ALTER TABLE "over_picking_order" ADD CONSTRAINT "over_picking_order_work_order_id_fkey"
      FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'over_picking_item_order_id_fkey') THEN
    ALTER TABLE "over_picking_item" ADD CONSTRAINT "over_picking_item_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "public"."over_picking_order"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_item_take_id_fkey') THEN
    ALTER TABLE "stock_take_item" ADD CONSTRAINT "stock_take_item_take_id_fkey"
      FOREIGN KEY ("take_id") REFERENCES "public"."stock_take_order"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_log_take_id_fkey') THEN
    ALTER TABLE "stock_take_log" ADD CONSTRAINT "stock_take_log_take_id_fkey"
      FOREIGN KEY ("take_id") REFERENCES "public"."stock_take_order"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
