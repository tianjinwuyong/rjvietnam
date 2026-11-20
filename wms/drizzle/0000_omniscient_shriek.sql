CREATE TABLE "bom" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_code" varchar(50) NOT NULL,
	"product_code" varchar(100) NOT NULL,
	"product_name" varchar(200) NOT NULL,
	"version" varchar(20) DEFAULT 'V1.0',
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"description" text,
	"_dev_test_marker" varchar(100) DEFAULT 'from_dev_db',
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "bom_bom_code_unique" UNIQUE("bom_code")
);
--> statement-breakpoint
CREATE TABLE "bom_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_id" uuid NOT NULL,
	"material_id" uuid,
	"material_code" varchar(100) NOT NULL,
	"vietnam_code" varchar(100),
	"material_name" varchar(200) NOT NULL,
	"specification" text,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"quantity" numeric NOT NULL,
	"work_section" varchar(20) DEFAULT 'smt' NOT NULL,
	"sort_order" integer DEFAULT 0,
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "defective_move_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"batch_no" varchar(100),
	"quantity" varchar(50) NOT NULL,
	"unit" varchar(20),
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"operator_id" "user_profile",
	"remark" varchar(500),
	"_created_at" timestamptz (3) DEFAULT 'sqlCURRENT_TIMESTAMP' NOT NULL,
	"_updated_at" timestamptz (3) DEFAULT 'sqlCURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"batch_no" varchar(100),
	"supplier_id" uuid,
	"quantity" numeric DEFAULT '0' NOT NULL,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"stock_status" varchar(20) DEFAULT 'good' NOT NULL,
	"production_date" date,
	"locked" boolean DEFAULT false NOT NULL,
	"lock_reason" text,
	"label_no" varchar(100),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "inventory_label_no_unique" UNIQUE("label_no")
);
--> statement-breakpoint
CREATE TABLE "inventory_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"batch_no" varchar(100),
	"label_no" varchar(100),
	"stock_status" varchar(20) DEFAULT 'good' NOT NULL,
	"tx_type" varchar(30) NOT NULL,
	"tx_no" varchar(100),
	"qty" numeric DEFAULT '0' NOT NULL,
	"balance_after" numeric DEFAULT '0' NOT NULL,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"reference_no" varchar(100),
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "iqc_inspection_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"item_name" varchar(200) NOT NULL,
	"standard" text,
	"spec_min" varchar(100),
	"spec_max" varchar(100),
	"unit" varchar(20),
	"sort_order" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "iqc_inspection_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"item_id" uuid,
	"item_name" varchar(200) NOT NULL,
	"standard" text,
	"spec_min" varchar(100),
	"spec_max" varchar(100),
	"unit" varchar(20),
	"measured_value" varchar(200),
	"defect_description" text,
	"defect_qty" numeric DEFAULT '0',
	"is_pass" boolean,
	"sort_order" integer DEFAULT 0,
	"section_type" varchar(30),
	"template_item_id" uuid,
	"measured_values" jsonb,
	"spc" varchar(50),
	"sampling_plan_text" varchar(100),
	"sample_size" integer,
	"ac" integer,
	"re" integer,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "iqc_inspection_strictness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"inspection_type" varchar(30) NOT NULL,
	"strictness" varchar(20) DEFAULT 'normal' NOT NULL,
	"inspection_level" varchar(20) DEFAULT 'II' NOT NULL,
	"aql" varchar(20) DEFAULT '0.4' NOT NULL,
	"consecutive_accepted" integer DEFAULT 0 NOT NULL,
	"recent_rejected_in_5" integer DEFAULT 0 NOT NULL,
	"tightened_rejected_total" integer DEFAULT 0 NOT NULL,
	"tightened_consecutive_accepted" integer DEFAULT 0 NOT NULL,
	"exception_source" varchar(50),
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "iqc_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_no" varchar(50) NOT NULL,
	"receipt_date" date NOT NULL,
	"supplier_id" uuid,
	"material_id" uuid NOT NULL,
	"total_qty" numeric NOT NULL,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"production_date" date,
	"batch_no" varchar(100),
	"location_codes" text,
	"box_count" integer DEFAULT 0,
	"material_source" varchar(200),
	"inspector_id" "user_profile",
	"approver_id" "user_profile",
	"inspection_result" varchar(20) DEFAULT 'pending',
	"defect_type" varchar(50),
	"inspection_time" timestamptz (3),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"remark" text,
	"template_id" uuid,
	"last_template_id" uuid,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "iqc_lot_lot_no_unique" UNIQUE("lot_no")
);
--> statement-breakpoint
CREATE TABLE "iqc_lot_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iqc_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"report_no" varchar(50) NOT NULL,
	"final_result" varchar(20) NOT NULL,
	"inspector_id" "user_profile",
	"inspection_time" timestamptz (3),
	"reviewer_id" "user_profile",
	"review_time" timestamptz (3),
	"review_remark" text,
	"remark" text,
	"review_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"reject_time" timestamptz (3),
	"rejector_id" "user_profile",
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "iqc_report_lot_id_unique" UNIQUE("lot_id"),
	CONSTRAINT "iqc_report_report_no_unique" UNIQUE("report_no")
);
--> statement-breakpoint
CREATE TABLE "iqc_standard_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_type" varchar(30) NOT NULL,
	"item_name" varchar(300) NOT NULL,
	"item_name_vi" varchar(300),
	"item_name_en" varchar(300),
	"standard" text,
	"standard_vi" text,
	"standard_en" text,
	"spc" varchar(50),
	"lsl" varchar(100),
	"usl" varchar(100),
	"unit" varchar(20),
	"aql" varchar(20) DEFAULT '0.4',
	"sampling_plan_text" varchar(100),
	"sample_size" integer,
	"ac" integer,
	"re" integer,
	"sort_order" integer DEFAULT 0,
	"is_required" boolean DEFAULT true,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "iqc_strictness_transfer_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"inspection_type" varchar(30) NOT NULL,
	"from_strictness" varchar(20) NOT NULL,
	"to_strictness" varchar(20) NOT NULL,
	"transfer_type" varchar(20) DEFAULT 'auto' NOT NULL,
	"report_id" uuid,
	"lot_id" uuid,
	"reason" text,
	"operator_id" "user_profile",
	"operator_name" varchar(100),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iqc_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_name" varchar(200) NOT NULL,
	"template_code" varchar(50),
	"version" varchar(20) DEFAULT '1.0',
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"description" text,
	"packaging_aql" varchar(20),
	"appearance_level" varchar(20) DEFAULT 'G-II',
	"appearance_aql" varchar(20) DEFAULT '0.4',
	"dimension_level" varchar(20) DEFAULT 'S-2',
	"dimension_aql" varchar(20) DEFAULT '0.4',
	"reliability_sample_size" integer DEFAULT 2,
	"environmental_sample_size" integer DEFAULT 1,
	"selected_sections" varchar(30)[] DEFAULT '{}' NOT NULL,
	"raw_data" jsonb,
	"row_count" integer DEFAULT 0,
	"col_count" integer DEFAULT 0,
	"file_name" varchar(500),
	"sheet_name" varchar(200),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "iqc_template_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"section_type" varchar(30) NOT NULL,
	"item_name" varchar(300) NOT NULL,
	"item_name_vi" varchar(300),
	"item_name_en" varchar(300),
	"standard" text,
	"standard_vi" text,
	"standard_en" text,
	"spc" varchar(50),
	"lsl" varchar(100),
	"usl" varchar(100),
	"unit" varchar(20),
	"aql" varchar(20) DEFAULT '0.4',
	"sampling_plan_text" varchar(100),
	"sample_size" integer,
	"ac" integer,
	"re" integer,
	"sort_order" integer DEFAULT 0,
	"is_required" boolean DEFAULT true,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "iqc_template_material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_code" varchar(100) NOT NULL,
	"material_name" varchar(200) NOT NULL,
	"specification" text,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"material_type" varchar(50),
	"msl_level" varchar(20) DEFAULT '不管控',
	"vietnam_code" varchar(100),
	"inspection_standard" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"description" text,
	"expiry_days" integer,
	"force_scrap_days" integer,
	"unit_price" numeric(12, 2) DEFAULT '0',
	"over_issue_ratio" integer DEFAULT 0,
	"supplement_ratio" integer DEFAULT 0,
	"supplier_code" varchar(50),
	"material_source" varchar(200),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "material_material_code_unique" UNIQUE("material_code")
);
--> statement-breakpoint
CREATE TABLE "material_expiry_extension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"batch_no" varchar(100) NOT NULL,
	"location_id" uuid NOT NULL,
	"original_expiry_date" date NOT NULL,
	"new_expiry_date" date NOT NULL,
	"extended_days" integer DEFAULT 0 NOT NULL,
	"operator_id" "user_profile",
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "material_requirement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"req_no" varchar(50) NOT NULL,
	"work_order_id" uuid NOT NULL,
	"work_section" varchar(20),
	"total_qty" numeric DEFAULT '0',
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"applicant_id" "user_profile",
	"approver_id" "user_profile",
	"approval_time" timestamptz (3),
	"approval_remark" text,
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "material_requirement_req_no_unique" UNIQUE("req_no")
);
--> statement-breakpoint
CREATE TABLE "material_requirement_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"req_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"material_code" varchar(100) NOT NULL,
	"material_name" varchar(200) NOT NULL,
	"specification" text,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"required_qty" numeric NOT NULL,
	"base_qty" numeric DEFAULT '0',
	"over_issue_qty" numeric DEFAULT '0',
	"supplement_qty" numeric DEFAULT '0',
	"issued_qty" numeric DEFAULT '0',
	"work_section" varchar(20),
	"unit_usage" numeric DEFAULT '0',
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_substitution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"material_code" varchar(100) NOT NULL,
	"substitute_material_id" uuid NOT NULL,
	"substitute_material_code" varchar(100) NOT NULL,
	"remark" varchar(500),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"substitution_type" varchar(20) DEFAULT 'one_way' NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "mrb_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mrb_no" varchar(50) NOT NULL,
	"lot_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"batch_no" varchar(100),
	"quantity" numeric NOT NULL,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"fail_reason" text,
	"status" varchar(20) DEFAULT 'pending_review' NOT NULL,
	"final_decision" varchar(20),
	"sqe_id" "user_profile",
	"quality_manager_id" "user_profile",
	"final_approval_time" timestamptz (3),
	"final_remark" text,
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "mrb_review_mrb_no_unique" UNIQUE("mrb_no")
);
--> statement-breakpoint
CREATE TABLE "mrb_reviewer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mrb_id" uuid NOT NULL,
	"reviewer_id" "user_profile" NOT NULL,
	"reviewer_role" varchar(50),
	"review_opinion" text,
	"review_result" varchar(20),
	"review_time" timestamptz (3),
	"sort_order" integer DEFAULT 0,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "operation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"biz_type" varchar(50) NOT NULL,
	"biz_id" uuid,
	"biz_no" varchar(100),
	"action" varchar(50) NOT NULL,
	"action_detail" text,
	"operator_id" "user_profile",
	"operator_name" varchar(100),
	"ip_address" varchar(50),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "picking_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"picking_no" varchar(50) NOT NULL,
	"work_order_id" uuid NOT NULL,
	"req_id" uuid,
	"work_section" varchar(20) NOT NULL,
	"is_supplement" boolean DEFAULT false NOT NULL,
	"total_qty" numeric DEFAULT '0',
	"status" varchar(20) DEFAULT 'pending_approval' NOT NULL,
	"applicant_id" "user_profile",
	"approver_id" "user_profile",
	"approval_time" timestamptz (3),
	"approval_remark" text,
	"picker_id" "user_profile",
	"pick_time" timestamptz (3),
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "picking_order_picking_no_unique" UNIQUE("picking_no")
);
--> statement-breakpoint
CREATE TABLE "picking_order_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"picking_id" uuid NOT NULL,
	"material_id" uuid,
	"material_code" varchar(100) NOT NULL,
	"material_name" varchar(200) NOT NULL,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"pick_qty" numeric NOT NULL,
	"actual_qty" numeric DEFAULT '0',
	"actual_material_id" uuid,
	"actual_material_code" varchar(100),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_return" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_no" varchar(50) NOT NULL,
	"material_id" uuid NOT NULL,
	"material_code" varchar(100) NOT NULL,
	"material_name" varchar(200) NOT NULL,
	"supplier_id" uuid,
	"supplier_code" varchar(50),
	"supplier_name" varchar(200),
	"quantity" numeric NOT NULL,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"production_date" date,
	"batch_no" varchar(100),
	"return_reason" text,
	"work_order_no" varchar(50),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"received_good_qty" numeric DEFAULT '0' NOT NULL,
	"received_incoming_defect_qty" numeric DEFAULT '0' NOT NULL,
	"received_operation_defect_qty" numeric DEFAULT '0' NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "production_return_return_no_unique" UNIQUE("return_no")
);
--> statement-breakpoint
CREATE TABLE "production_return_iqc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"good_qty" numeric DEFAULT '0' NOT NULL,
	"incoming_defect_qty" numeric DEFAULT '0' NOT NULL,
	"operation_defect_qty" numeric DEFAULT '0' NOT NULL,
	"inspector_id" "user_profile",
	"inspector_name" varchar(100),
	"inspection_time" timestamptz (3),
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "receipt_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_no" varchar(50) NOT NULL,
	"receipt_date" date NOT NULL,
	"supplier_id" uuid,
	"material_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"production_date" date,
	"batch_no" varchar(100),
	"serial_no" varchar(100),
	"location_id" uuid,
	"keeper_id" "user_profile",
	"qr_content" text,
	"remark" text,
	"status" varchar(20) DEFAULT 'pending_iqc' NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "receipt_order_receipt_no_unique" UNIQUE("receipt_no")
);
--> statement-breakpoint
CREATE TABLE "role_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_code" varchar(50) NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"user_name" varchar(100),
	"work_section" varchar(20),
	"status" varchar(20) DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_no" varchar(50) NOT NULL,
	"transfer_date" date NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"batch_no" varchar(100),
	"quantity" numeric NOT NULL,
	"unit" varchar(20) DEFAULT 'PCS' NOT NULL,
	"operator_id" "user_profile",
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "stock_transfer_transfer_no_unique" UNIQUE("transfer_no")
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_code" varchar(50) NOT NULL,
	"supplier_name" varchar(200) NOT NULL,
	"contact_person" varchar(100),
	"contact_phone" varchar(50),
	"contact_email" varchar(100),
	"address" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"description" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "supplier_supplier_code_unique" UNIQUE("supplier_code")
);
--> statement-breakpoint
CREATE TABLE "supplier_material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"supplier_material_code" varchar(100),
	"msl_level" varchar(20) DEFAULT '不管控',
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile"
);
--> statement-breakpoint
CREATE TABLE "sys_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" varchar(50) NOT NULL,
	"password_hash" varchar(200) NOT NULL,
	"name" varchar(100) NOT NULL,
	"role_code" varchar(50) NOT NULL,
	"work_section" varchar(20),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"is_first_login" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamptz (3),
	"platform_user_id" varchar(100),
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "sys_account_account_unique" UNIQUE("account"),
	CONSTRAINT "sys_account_platform_user_id_unique" UNIQUE("platform_user_id")
);
--> statement-breakpoint
CREATE TABLE "sys_param" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"param_key" varchar(100) NOT NULL,
	"param_value" text NOT NULL,
	"param_name_zh" varchar(200),
	"param_name_vi" varchar(200),
	"param_name_en" varchar(200),
	"description" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "sys_param_param_key_unique" UNIQUE("param_key")
);
--> statement-breakpoint
CREATE TABLE "sys_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_code" varchar(50) NOT NULL,
	"role_name" varchar(100) NOT NULL,
	"description" varchar(500),
	"menu_permissions" text[] DEFAULT '{}' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "sys_role_role_code_unique" UNIQUE("role_code")
);
--> statement-breakpoint
CREATE TABLE "warehouse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wh_code" varchar(50) NOT NULL,
	"wh_name_zh" varchar(100) NOT NULL,
	"wh_name_vi" varchar(100),
	"wh_name_en" varchar(100),
	"wh_type" varchar(20) DEFAULT 'normal' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"address" text,
	"description" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "warehouse_wh_code_unique" UNIQUE("wh_code")
);
--> statement-breakpoint
CREATE TABLE "warehouse_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_code" varchar(100) NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"area_code" varchar(50),
	"shelf_code" varchar(50),
	"layer_code" varchar(50),
	"position_code" varchar(50),
	"location_type" varchar(20) DEFAULT 'good' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"description" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "warehouse_location_location_code_unique" UNIQUE("location_code")
);
--> statement-breakpoint
CREATE TABLE "work_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_no" varchar(50) NOT NULL,
	"bom_id" uuid,
	"product_code" varchar(100) NOT NULL,
	"product_name" varchar(200) NOT NULL,
	"plan_qty" numeric NOT NULL,
	"actual_qty" numeric DEFAULT '0',
	"work_order_date" date NOT NULL,
	"is_supplement" boolean DEFAULT false NOT NULL,
	"parent_order_id" uuid,
	"status" varchar(20) DEFAULT 'created' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"planner_id" "user_profile",
	"remark" text,
	"_created_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile",
	"_updated_at" timestamptz (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile",
	CONSTRAINT "work_order_work_order_no_unique" UNIQUE("work_order_no")
);
--> statement-breakpoint
ALTER TABLE "bom_item" ADD CONSTRAINT "bom_item_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "public"."bom"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_inspection_item" ADD CONSTRAINT "iqc_inspection_item_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_inspection_record" ADD CONSTRAINT "iqc_inspection_record_template_item_id_fkey" FOREIGN KEY ("template_item_id") REFERENCES "public"."iqc_template_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_inspection_record" ADD CONSTRAINT "iqc_inspection_record_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."iqc_inspection_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_inspection_record" ADD CONSTRAINT "iqc_inspection_record_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."iqc_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_inspection_strictness" ADD CONSTRAINT "iqc_inspection_strictness_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_lot" ADD CONSTRAINT "iqc_lot_last_template_id_fkey" FOREIGN KEY ("last_template_id") REFERENCES "public"."iqc_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_lot" ADD CONSTRAINT "iqc_lot_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."iqc_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_lot" ADD CONSTRAINT "iqc_lot_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_lot_receipt" ADD CONSTRAINT "iqc_lot_receipt_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_lot_receipt" ADD CONSTRAINT "iqc_lot_receipt_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."iqc_lot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_report" ADD CONSTRAINT "iqc_report_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."iqc_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_strictness_transfer_log" ADD CONSTRAINT "iqc_strictness_transfer_log_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_template_item" ADD CONSTRAINT "iqc_template_item_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."iqc_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_template_material" ADD CONSTRAINT "iqc_template_material_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iqc_template_material" ADD CONSTRAINT "iqc_template_material_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."iqc_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requirement" ADD CONSTRAINT "material_requirement_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requirement_item" ADD CONSTRAINT "material_requirement_item_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requirement_item" ADD CONSTRAINT "material_requirement_item_req_id_fkey" FOREIGN KEY ("req_id") REFERENCES "public"."material_requirement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution" ADD CONSTRAINT "material_substitution_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_substitution" ADD CONSTRAINT "material_substitution_substitute_material_id_fkey" FOREIGN KEY ("substitute_material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrb_review" ADD CONSTRAINT "mrb_review_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrb_review" ADD CONSTRAINT "mrb_review_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrb_review" ADD CONSTRAINT "mrb_review_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."iqc_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mrb_reviewer" ADD CONSTRAINT "mrb_reviewer_mrb_id_fkey" FOREIGN KEY ("mrb_id") REFERENCES "public"."mrb_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_order" ADD CONSTRAINT "picking_order_req_id_fkey" FOREIGN KEY ("req_id") REFERENCES "public"."material_requirement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_order" ADD CONSTRAINT "picking_order_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_order_item" ADD CONSTRAINT "picking_order_item_picking_id_fkey" FOREIGN KEY ("picking_id") REFERENCES "public"."picking_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_return_iqc" ADD CONSTRAINT "production_return_iqc_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "public"."production_return"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_order" ADD CONSTRAINT "receipt_order_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_order" ADD CONSTRAINT "receipt_order_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "public"."warehouse_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "public"."warehouse_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material" ADD CONSTRAINT "supplier_material_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."material"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_material" ADD CONSTRAINT "supplier_material_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_location" ADD CONSTRAINT "warehouse_location_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_parent_order_id_fkey" FOREIGN KEY ("parent_order_id") REFERENCES "public"."work_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order" ADD CONSTRAINT "work_order_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "public"."bom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bom_bom_code_key" ON "bom" USING btree ("bom_code");--> statement-breakpoint
CREATE INDEX "idx_bom_item_bom" ON "bom_item" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "idx_bom_item_section" ON "bom_item" USING btree ("work_section");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_material_id_location_id_batch_no_stock_status_key" ON "inventory" USING btree ("material_id","location_id","batch_no","stock_status");--> statement-breakpoint
CREATE INDEX "idx_inv_material" ON "inventory" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_inv_location" ON "inventory" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_inv_batch" ON "inventory" USING btree ("batch_no");--> statement-breakpoint
CREATE INDEX "idx_inv_status" ON "inventory" USING btree ("stock_status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_inventory_label_no" ON "inventory" USING btree ("label_no");--> statement-breakpoint
CREATE INDEX "idx_invt_material" ON "inventory_transaction" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_invt_location" ON "inventory_transaction" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_invt_batch" ON "inventory_transaction" USING btree ("batch_no");--> statement-breakpoint
CREATE INDEX "idx_invt_label" ON "inventory_transaction" USING btree ("label_no");--> statement-breakpoint
CREATE INDEX "idx_invt_tx_type" ON "inventory_transaction" USING btree ("tx_type");--> statement-breakpoint
CREATE INDEX "idx_invt_tx_no" ON "inventory_transaction" USING btree ("tx_no");--> statement-breakpoint
CREATE INDEX "idx_invt_created" ON "inventory_transaction" USING btree ("_created_at");--> statement-breakpoint
CREATE INDEX "idx_iqc_item_material" ON "iqc_inspection_item" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_iqc_rec_lot" ON "iqc_inspection_record" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iqc_inspection_strictness_material_type_key" ON "iqc_inspection_strictness" USING btree ("material_id","inspection_type");--> statement-breakpoint
CREATE INDEX "idx_iqc_strictness_material" ON "iqc_inspection_strictness" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_iqc_strictness_status" ON "iqc_inspection_strictness" USING btree ("strictness");--> statement-breakpoint
CREATE UNIQUE INDEX "iqc_lot_lot_no_key" ON "iqc_lot" USING btree ("lot_no");--> statement-breakpoint
CREATE INDEX "idx_iqc_lot_date" ON "iqc_lot" USING btree ("receipt_date");--> statement-breakpoint
CREATE INDEX "idx_iqc_lot_supplier" ON "iqc_lot" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_iqc_lot_material" ON "iqc_lot" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_iqc_lot_batch" ON "iqc_lot" USING btree ("batch_no");--> statement-breakpoint
CREATE INDEX "idx_iqc_lot_status" ON "iqc_lot" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_iqc_lot_result" ON "iqc_lot" USING btree ("inspection_result");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_iqc_lot_merge_key" ON "iqc_lot" USING btree ("receipt_date","supplier_id","material_id","production_date","batch_no");--> statement-breakpoint
CREATE INDEX "idx_iqc_lot_last_template" ON "iqc_lot" USING btree ("last_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iqc_lot_receipt_lot_id_receipt_id_key" ON "iqc_lot_receipt" USING btree ("lot_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iqc_report_lot_id_key" ON "iqc_report" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iqc_report_report_no_key" ON "iqc_report" USING btree ("report_no");--> statement-breakpoint
CREATE INDEX "idx_iqc_rpt_result" ON "iqc_report" USING btree ("final_result");--> statement-breakpoint
CREATE INDEX "idx_iqc_rpt_review_status" ON "iqc_report" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "idx_iqc_std_item_section" ON "iqc_standard_item" USING btree ("section_type");--> statement-breakpoint
CREATE INDEX "idx_iqc_st_log_material" ON "iqc_strictness_transfer_log" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_iqc_st_log_type" ON "iqc_strictness_transfer_log" USING btree ("inspection_type");--> statement-breakpoint
CREATE INDEX "idx_iqc_st_log_created" ON "iqc_strictness_transfer_log" USING btree ("_created_at");--> statement-breakpoint
CREATE INDEX "idx_iqc_tpl_item_template" ON "iqc_template_item" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "idx_iqc_tpl_item_section" ON "iqc_template_item" USING btree ("template_id","section_type");--> statement-breakpoint
CREATE UNIQUE INDEX "iqc_template_material_template_id_material_id_key" ON "iqc_template_material" USING btree ("template_id","material_id");--> statement-breakpoint
CREATE INDEX "idx_iqc_tpl_mat_material" ON "iqc_template_material" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_material_code_key" ON "material" USING btree ("material_code");--> statement-breakpoint
CREATE INDEX "idx_material_code" ON "material" USING btree ("material_code");--> statement-breakpoint
CREATE INDEX "idx_material_type" ON "material" USING btree ("material_type");--> statement-breakpoint
CREATE INDEX "idx_material_supplier_code" ON "material" USING btree ("supplier_code");--> statement-breakpoint
CREATE INDEX "idx_expiry_mat_batch" ON "material_expiry_extension" USING btree ("material_id","batch_no");--> statement-breakpoint
CREATE UNIQUE INDEX "material_requirement_req_no_key" ON "material_requirement" USING btree ("req_no");--> statement-breakpoint
CREATE INDEX "idx_mr_work_order" ON "material_requirement" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_mr_status" ON "material_requirement" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_mri_req" ON "material_requirement_item" USING btree ("req_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_substitution_mat_sub_key" ON "material_substitution" USING btree ("material_id","substitute_material_id");--> statement-breakpoint
CREATE INDEX "idx_ms_material" ON "material_substitution" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_ms_material_code" ON "material_substitution" USING btree ("material_code");--> statement-breakpoint
CREATE INDEX "idx_ms_substitute" ON "material_substitution" USING btree ("substitute_material_id");--> statement-breakpoint
CREATE INDEX "idx_ms_status" ON "material_substitution" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "mrb_review_mrb_no_key" ON "mrb_review" USING btree ("mrb_no");--> statement-breakpoint
CREATE INDEX "idx_mrb_lot" ON "mrb_review" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "idx_mrb_status" ON "mrb_review" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_mrb_r_mrb" ON "mrb_reviewer" USING btree ("mrb_id");--> statement-breakpoint
CREATE INDEX "idx_oplog_biz" ON "operation_log" USING btree ("biz_type","biz_id");--> statement-breakpoint
CREATE INDEX "idx_oplog_created" ON "operation_log" USING btree ("_created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "picking_order_picking_no_key" ON "picking_order" USING btree ("picking_no");--> statement-breakpoint
CREATE INDEX "idx_po_work_order" ON "picking_order" USING btree ("work_order_id");--> statement-breakpoint
CREATE INDEX "idx_po_status" ON "picking_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_po_section" ON "picking_order" USING btree ("work_section");--> statement-breakpoint
CREATE INDEX "idx_poi_picking" ON "picking_order_item" USING btree ("picking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_return_return_no_key" ON "production_return" USING btree ("return_no");--> statement-breakpoint
CREATE INDEX "idx_pr_status" ON "production_return" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pr_material" ON "production_return" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_pr_created" ON "production_return" USING btree ("_created_at");--> statement-breakpoint
CREATE INDEX "idx_pri_return" ON "production_return_iqc" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_order_receipt_no_key" ON "receipt_order" USING btree ("receipt_no");--> statement-breakpoint
CREATE INDEX "idx_receipt_date" ON "receipt_order" USING btree ("receipt_date");--> statement-breakpoint
CREATE INDEX "idx_receipt_supplier" ON "receipt_order" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_receipt_material" ON "receipt_order" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_receipt_batch" ON "receipt_order" USING btree ("batch_no");--> statement-breakpoint
CREATE INDEX "idx_receipt_status" ON "receipt_order" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "role_user_role_code_user_id_key" ON "role_user" USING btree ("role_code","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfer_transfer_no_key" ON "stock_transfer" USING btree ("transfer_no");--> statement-breakpoint
CREATE INDEX "idx_st_date" ON "stock_transfer" USING btree ("transfer_date");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_supplier_code_key" ON "supplier" USING btree ("supplier_code");--> statement-breakpoint
CREATE INDEX "idx_supplier_code" ON "supplier" USING btree ("supplier_code");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_material_supplier_id_material_id_key" ON "supplier_material" USING btree ("supplier_id","material_id");--> statement-breakpoint
CREATE INDEX "idx_sm_supplier" ON "supplier_material" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_sm_material" ON "supplier_material" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sys_account_account_key" ON "sys_account" USING btree ("account");--> statement-breakpoint
CREATE INDEX "idx_sys_account_role" ON "sys_account" USING btree ("role_code");--> statement-breakpoint
CREATE INDEX "idx_sys_account_status" ON "sys_account" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sys_account_platform_user_id" ON "sys_account" USING btree ("platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sys_param_param_key_key" ON "sys_param" USING btree ("param_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sys_role_role_code_key" ON "sys_role" USING btree ("role_code");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_wh_code_key" ON "warehouse" USING btree ("wh_code");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_location_location_code_key" ON "warehouse_location" USING btree ("location_code");--> statement-breakpoint
CREATE INDEX "idx_wh_loc_warehouse" ON "warehouse_location" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_wh_loc_type" ON "warehouse_location" USING btree ("location_type");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_work_order_no_key" ON "work_order" USING btree ("work_order_no");--> statement-breakpoint
CREATE INDEX "idx_wo_date" ON "work_order" USING btree ("work_order_date");--> statement-breakpoint
CREATE INDEX "idx_wo_status" ON "work_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wo_parent" ON "work_order" USING btree ("parent_order_id");