--
-- PostgreSQL database dump
--

\restrict eIlwfexFGZPgZOf2gPzUe2kUDydVyywtpLgq6rJ2MRs4PkFu1E63kU9disDmaeV

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: file_attachment; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.file_attachment AS (
	bucket_id text,
	file_path text
);


--
-- Name: user_profile; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_profile AS (
	user_id text
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bom; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bom (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bom_code character varying(50) NOT NULL,
    product_code character varying(100) NOT NULL,
    product_name character varying(200) NOT NULL,
    version character varying(20) DEFAULT 'V1.0'::character varying,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    description text,
    _dev_test_marker character varying(100) DEFAULT 'from_dev_db'::character varying,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: bom_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bom_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bom_id uuid NOT NULL,
    material_id uuid,
    material_code character varying(100) NOT NULL,
    vietnam_code character varying(100),
    material_name character varying(200) NOT NULL,
    specification text,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    quantity numeric NOT NULL,
    work_section character varying(20) DEFAULT 'smt'::character varying NOT NULL,
    sort_order integer DEFAULT 0,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: defective_move_task; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defective_move_task (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid,
    material_id uuid NOT NULL,
    supplier_id uuid,
    batch_no character varying(100),
    quantity character varying(50) NOT NULL,
    unit character varying(20),
    from_location_id uuid NOT NULL,
    to_location_id uuid,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    operator_id public.user_profile,
    remark character varying(500),
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    mrb_id uuid,
    source character varying(20),
    reason text,
    move_no character varying(50),
    inventory_id uuid,
    from_stock_status character varying(20),
    created_by public.user_profile,
    confirmed_by public.user_profile,
    confirmed_at timestamp(3) with time zone,
    confirm_remark text,
    scan_codes text,
    scan_to_code character varying(100),
    scan_at timestamp(3) with time zone,
    source_inspection_no character varying(50)
);


--
-- Name: COLUMN defective_move_task.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.defective_move_task.status IS 'pending_confirm=待主管确认 / pending=待执行 / completed / cancelled';


--
-- Name: COLUMN defective_move_task.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.defective_move_task.source IS '来源：mrb_reject(否决) / mrb_return(退货) / manual(人工)';


--
-- Name: COLUMN defective_move_task.move_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.defective_move_task.move_no IS '调拨单号（DMT+日期-流水）';


--
-- Name: COLUMN defective_move_task.inventory_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.defective_move_task.inventory_id IS '制单时锁定的来源库存行（手工单执行时按此精确扣减）';


--
-- Name: COLUMN defective_move_task.from_stock_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.defective_move_task.from_stock_status IS '来源库存状态：good=良品手工调拨，defective/scrapped=MRB 冻结行';


--
-- Name: COLUMN defective_move_task.source_inspection_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.defective_move_task.source_inspection_no IS '来源 IQC 检验单号（JY...）；手工制单为空';


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    location_id uuid NOT NULL,
    batch_no character varying(100) DEFAULT ''::character varying NOT NULL,
    supplier_id uuid,
    quantity numeric DEFAULT '0'::numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    stock_status character varying(20) DEFAULT 'good'::character varying NOT NULL,
    production_date date,
    locked boolean DEFAULT false NOT NULL,
    lock_reason text,
    is_special_admit boolean DEFAULT false NOT NULL,
    special_admit_ref character varying(100),
    label_no character varying(100),
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: inventory_transaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transaction (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    location_id uuid NOT NULL,
    batch_no character varying(100),
    label_no character varying(100),
    stock_status character varying(20) DEFAULT 'good'::character varying NOT NULL,
    tx_type character varying(30) NOT NULL,
    tx_no character varying(100),
    qty numeric DEFAULT '0'::numeric NOT NULL,
    balance_after numeric DEFAULT '0'::numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    reference_no character varying(100),
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: iqc_inspection_draft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_inspection_draft (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    payload jsonb NOT NULL,
    inspector_id public.user_profile,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: iqc_inspection_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_inspection_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    item_name character varying(200) NOT NULL,
    standard text,
    spec_min character varying(100),
    spec_max character varying(100),
    unit character varying(20),
    sort_order integer DEFAULT 0,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: iqc_inspection_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_inspection_record (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    item_id uuid,
    item_name character varying(200) NOT NULL,
    standard text,
    spec_min character varying(100),
    spec_max character varying(100),
    unit character varying(20),
    measured_value character varying(200),
    defect_description text,
    defect_qty numeric DEFAULT '0'::numeric,
    is_pass boolean,
    sort_order integer DEFAULT 0,
    section_type character varying(30),
    template_item_id uuid,
    measured_values jsonb,
    spec character varying(50),
    sampling_plan_text character varying(100),
    aql character varying(20),
    sample_size integer,
    ac integer,
    re integer,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: iqc_inspection_strictness; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_inspection_strictness (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    inspection_type character varying(30) NOT NULL,
    strictness character varying(20) DEFAULT 'normal'::character varying NOT NULL,
    inspection_level character varying(20) DEFAULT 'II'::character varying NOT NULL,
    aql character varying(20) DEFAULT '0.4'::character varying NOT NULL,
    consecutive_accepted integer DEFAULT 0 NOT NULL,
    recent_rejected_in_5 integer DEFAULT 0 NOT NULL,
    tightened_rejected_total integer DEFAULT 0 NOT NULL,
    tightened_consecutive_accepted integer DEFAULT 0 CONSTRAINT iqc_inspection_strictness_tightened_consecutive_accept_not_null NOT NULL,
    exception_source character varying(50),
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: iqc_lot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_lot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_no character varying(50) NOT NULL,
    inspection_no character varying(50),
    receipt_date date NOT NULL,
    last_receipt_date date,
    supplier_id uuid,
    material_id uuid NOT NULL,
    total_qty numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    production_date date,
    batch_no character varying(100),
    location_codes text,
    box_count integer DEFAULT 0,
    material_source character varying(200),
    inspector_id public.user_profile,
    approver_id public.user_profile,
    inspection_result character varying(20) DEFAULT 'pending'::character varying,
    defect_type character varying(50),
    inspection_time timestamp(3) with time zone,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    remark text,
    template_id uuid,
    last_template_id uuid,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    oa_claimed_by character varying(100),
    oa_claimed_at timestamp with time zone,
    oa_source character varying(10)
);


--
-- Name: COLUMN iqc_lot.oa_claimed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iqc_lot.oa_claimed_by IS 'OA 认领检验人（双入口防冲突；4h 未提交由 OA 释放）';


--
-- Name: COLUMN iqc_lot.oa_claimed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iqc_lot.oa_claimed_at IS 'OA 认领时间';


--
-- Name: COLUMN iqc_lot.oa_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.iqc_lot.oa_source IS '检验来源：oa / wms / NULL(历史)';


--
-- Name: iqc_lot_receipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_lot_receipt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    receipt_id uuid NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: iqc_lot_strictness_count; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_lot_strictness_count (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    material_id uuid NOT NULL,
    inspection_type character varying(30) NOT NULL,
    accepted boolean NOT NULL,
    strictness_at_count character varying(20) NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: iqc_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_report (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    report_no character varying(50) NOT NULL,
    final_result character varying(20) NOT NULL,
    inspector_id public.user_profile,
    inspection_time timestamp(3) with time zone,
    reviewer_id public.user_profile,
    review_time timestamp(3) with time zone,
    review_remark text,
    remark text,
    review_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reject_reason text,
    reject_time timestamp(3) with time zone,
    rejector_id public.user_profile,
    judge_mode character varying(20) DEFAULT 'inspection'::character varying NOT NULL,
    judge_reason text,
    judged_by public.user_profile,
    judged_at timestamp(3) with time zone,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    oa_instance_id bigint,
    oa_status character varying(20)
);


--
-- Name: iqc_standard_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_standard_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    section_type character varying(30) NOT NULL,
    item_name character varying(300) NOT NULL,
    item_name_vi character varying(300),
    item_name_en character varying(300),
    standard text,
    standard_vi text,
    standard_en text,
    spec character varying(50),
    lsl character varying(100),
    usl character varying(100),
    unit character varying(20),
    aql character varying(20) DEFAULT '0.4'::character varying,
    sampling_plan_text character varying(100),
    sample_size integer,
    ac integer,
    re integer,
    sort_order integer DEFAULT 0,
    is_required boolean DEFAULT true,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: iqc_strictness_transfer_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_strictness_transfer_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    inspection_type character varying(30) NOT NULL,
    from_strictness character varying(20) NOT NULL,
    to_strictness character varying(20) NOT NULL,
    transfer_type character varying(20) DEFAULT 'auto'::character varying NOT NULL,
    report_id uuid,
    lot_id uuid,
    reason text,
    operator_id public.user_profile,
    operator_name character varying(100),
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: iqc_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_template (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_name character varying(200) NOT NULL,
    template_code character varying(50),
    version character varying(20) DEFAULT '1.0'::character varying,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    description text,
    packaging_aql character varying(20),
    appearance_level character varying(20) DEFAULT 'G-II'::character varying,
    appearance_aql character varying(20) DEFAULT '0.4'::character varying,
    dimension_level character varying(20) DEFAULT 'S-2'::character varying,
    dimension_aql character varying(20) DEFAULT '0.4'::character varying,
    reliability_sample_size integer DEFAULT 2,
    environmental_sample_size integer DEFAULT 1,
    selected_sections character varying(30)[] DEFAULT '{}'::character varying[] NOT NULL,
    raw_data jsonb,
    row_count integer DEFAULT 0,
    col_count integer DEFAULT 0,
    file_name character varying(500),
    sheet_name character varying(200),
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: iqc_template_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_template_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    section_type character varying(30) NOT NULL,
    item_name character varying(300) NOT NULL,
    item_name_vi character varying(300),
    item_name_en character varying(300),
    standard text,
    standard_vi text,
    standard_en text,
    spec character varying(50),
    lsl character varying(100),
    usl character varying(100),
    unit character varying(20),
    aql character varying(20) DEFAULT '0.4'::character varying,
    sampling_plan_text character varying(100),
    sample_size integer,
    ac integer,
    re integer,
    sort_order integer DEFAULT 0,
    is_required boolean DEFAULT true,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: iqc_template_material; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iqc_template_material (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    material_id uuid NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile
);


--
-- Name: material; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_code character varying(100) NOT NULL,
    material_name character varying(200) NOT NULL,
    specification text,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    material_type character varying(50),
    msl_level character varying(20) DEFAULT '不管控'::character varying,
    grade character varying(50),
    vietnam_code character varying(100),
    inspection_standard text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    description text,
    expiry_days integer,
    force_scrap_days integer,
    unit_price numeric(12,2) DEFAULT '0'::numeric,
    over_issue_ratio integer DEFAULT 0,
    supplement_ratio integer DEFAULT 0,
    supplier_code character varying(50),
    material_source character varying(200),
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    packaging_type character varying(20) DEFAULT 'normal'::character varying NOT NULL
);


--
-- Name: material_expiry_extension; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_expiry_extension (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    batch_no character varying(100) NOT NULL,
    location_id uuid NOT NULL,
    original_expiry_date date NOT NULL,
    new_expiry_date date NOT NULL,
    extended_days integer DEFAULT 0 NOT NULL,
    operator_id public.user_profile,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: material_requirement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_requirement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    req_no character varying(50) NOT NULL,
    work_order_id uuid NOT NULL,
    work_section character varying(20),
    total_qty numeric DEFAULT '0'::numeric,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    applicant_id public.user_profile,
    approver_id public.user_profile,
    approval_time timestamp(3) with time zone,
    approval_remark text,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: material_requirement_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_requirement_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    req_id uuid NOT NULL,
    material_id uuid NOT NULL,
    material_code character varying(100) NOT NULL,
    material_name character varying(200) NOT NULL,
    specification text,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    required_qty numeric NOT NULL,
    base_qty numeric DEFAULT '0'::numeric,
    over_issue_qty numeric DEFAULT '0'::numeric,
    supplement_qty numeric DEFAULT '0'::numeric,
    issued_qty numeric DEFAULT '0'::numeric,
    work_section character varying(20),
    unit_usage numeric DEFAULT '0'::numeric,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: material_substitution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_substitution (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    material_code character varying(100) NOT NULL,
    substitute_material_id uuid NOT NULL,
    substitute_material_code character varying(100) NOT NULL,
    remark character varying(500),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    substitution_type character varying(20) DEFAULT 'one_way'::character varying NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: mrb_cc; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mrb_cc (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mrb_id uuid NOT NULL,
    user_id public.user_profile NOT NULL,
    user_name character varying(100),
    role_code character varying(50),
    read_at timestamp(3) with time zone,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile
);


--
-- Name: mrb_disposition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mrb_disposition (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mrb_id uuid NOT NULL,
    disposition_type character varying(20) NOT NULL,
    other_type character varying(20),
    ref_no character varying(50),
    hold_until date,
    quantity numeric DEFAULT '0'::numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    from_location_id uuid,
    to_location_id uuid,
    exec_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    exec_time timestamp(3) with time zone,
    remark text,
    sort_order integer DEFAULT 0 NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: COLUMN mrb_disposition.other_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_disposition.other_type IS '其他处置去向：customer_return=退回客户 / sample=转留样 / hold=待定暂存';


--
-- Name: COLUMN mrb_disposition.ref_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_disposition.ref_no IS '退回客户/留样的关联单号或留样编号';


--
-- Name: COLUMN mrb_disposition.hold_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_disposition.hold_until IS '待定暂存复核日期，到期未转正式处置即进巡检清单';


--
-- Name: COLUMN mrb_disposition.exec_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_disposition.exec_status IS 'planned(方案已定) / pending(待执行) / done(已执行) / cancelled(已取消)';


--
-- Name: mrb_disposition_label; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mrb_disposition_label (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mrb_id uuid NOT NULL,
    disposition_id uuid NOT NULL,
    receipt_id uuid NOT NULL,
    receipt_no character varying(50),
    qr_content text,
    label_no character varying(100),
    quantity numeric(18,4) DEFAULT 0 NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: mrb_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mrb_review (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mrb_no character varying(50) NOT NULL,
    lot_id uuid NOT NULL,
    material_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    batch_no character varying(100),
    quantity numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    fail_reason text,
    status character varying(20) DEFAULT 'pending_review'::character varying NOT NULL,
    final_decision character varying(20),
    sqe_id public.user_profile,
    quality_manager_id public.user_profile,
    final_approval_time timestamp(3) with time zone,
    final_remark text,
    remark text,
    completeness_result character varying(20),
    completeness_by public.user_profile,
    completeness_time timestamp(3) with time zone,
    completeness_remark text,
    is_urgent boolean DEFAULT false NOT NULL,
    urgent_reason text,
    status_since timestamp(3) with time zone DEFAULT now() NOT NULL,
    cancel_reason text,
    cancel_by public.user_profile,
    cancel_time timestamp(3) with time zone,
    separation_remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    plan_by public.user_profile,
    plan_time timestamp(3) with time zone,
    cc_sent_at timestamp(3) with time zone,
    withdraw_reason text,
    withdraw_by public.user_profile,
    withdraw_time timestamp(3) with time zone,
    return_reason text,
    return_by public.user_profile,
    return_time timestamp(3) with time zone,
    return_from character varying(20),
    source_inspection_no character varying(50),
    oa_instance_id bigint,
    oa_status character varying(20)
);


--
-- Name: COLUMN mrb_review.completeness_result; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.completeness_result IS '齐全性确认结果：complete=齐全 / incomplete=不齐退回';


--
-- Name: COLUMN mrb_review.completeness_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.completeness_by IS '齐全性确认人（质量主管）';


--
-- Name: COLUMN mrb_review.completeness_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.completeness_time IS '齐全性确认时间';


--
-- Name: COLUMN mrb_review.is_urgent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.is_urgent IS '急件：压缩各环节时限，但不跳过任何签批节点';


--
-- Name: COLUMN mrb_review.urgent_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.urgent_reason IS '急件原因（停线/客户急单等）';


--
-- Name: COLUMN mrb_review.status_since; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.status_since IS '进入当前状态的时间；巡检 SLA 唯一基准（不要用 _updated_at）';


--
-- Name: COLUMN mrb_review.cancel_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.cancel_reason IS '作废原因（作废时必填，≥5 字）';


--
-- Name: COLUMN mrb_review.cancel_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.cancel_by IS '作废人';


--
-- Name: COLUMN mrb_review.cancel_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.cancel_time IS '作废时间';


--
-- Name: COLUMN mrb_review.separation_remark; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.separation_remark IS '预审人与终审人为同一人时的代审说明（2~200 字）';


--
-- Name: COLUMN mrb_review.plan_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.plan_by IS 'SQE 提交方案的操作人';


--
-- Name: COLUMN mrb_review.plan_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.plan_time IS '方案提交时间（评审 SLA 起点）';


--
-- Name: COLUMN mrb_review.cc_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.cc_sent_at IS '抄送发送时间，防重复推送';


--
-- Name: COLUMN mrb_review.withdraw_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.withdraw_reason IS 'SQE 撤回方案的原因（评审中 → 待制定方案）';


--
-- Name: COLUMN mrb_review.withdraw_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.withdraw_by IS '撤回操作人';


--
-- Name: COLUMN mrb_review.withdraw_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.withdraw_time IS '撤回时间';


--
-- Name: COLUMN mrb_review.return_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.return_reason IS '审批驳回原因（预审 / 终审退回 SQE 改方案）';


--
-- Name: COLUMN mrb_review.return_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.return_by IS '驳回操作人';


--
-- Name: COLUMN mrb_review.return_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.return_time IS '驳回时间';


--
-- Name: COLUMN mrb_review.return_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.return_from IS '退回来路：pending_approval=预审 / pending_final=终审';


--
-- Name: COLUMN mrb_review.source_inspection_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mrb_review.source_inspection_no IS '来源 IQC 检验单号（JY...），单号前缀同源，用于追溯';


--
-- Name: mrb_reviewer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mrb_reviewer (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mrb_id uuid NOT NULL,
    reviewer_id public.user_profile NOT NULL,
    reviewer_role character varying(50),
    review_opinion text,
    review_result character varying(20),
    review_time timestamp(3) with time zone,
    sort_order integer DEFAULT 0,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: oa_callback_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oa_callback_log (
    id bigint NOT NULL,
    oa_instance_id bigint NOT NULL,
    event character varying(30) NOT NULL,
    node_index integer,
    biz_type character varying(50),
    biz_key character varying(100),
    payload jsonb,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: oa_callback_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oa_callback_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oa_callback_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oa_callback_log_id_seq OWNED BY public.oa_callback_log.id;


--
-- Name: oa_event_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oa_event_outbox (
    id bigint NOT NULL,
    event character varying(40) NOT NULL,
    biz_key character varying(80) NOT NULL,
    payload jsonb NOT NULL,
    status character varying(12) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE oa_event_outbox; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.oa_event_outbox IS 'WMS → OA 事件队列（待检推送等），outbox 模式';


--
-- Name: oa_event_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oa_event_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oa_event_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oa_event_outbox_id_seq OWNED BY public.oa_event_outbox.id;


--
-- Name: operation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    biz_type character varying(50) NOT NULL,
    biz_id uuid,
    biz_no character varying(100),
    action character varying(50) NOT NULL,
    action_detail text,
    operator_id public.user_profile,
    operator_name character varying(100),
    ip_address character varying(50),
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: over_picking_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.over_picking_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    material_id uuid NOT NULL,
    material_code character varying(100) NOT NULL,
    material_name character varying(200) NOT NULL,
    specification text,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    quantity numeric NOT NULL,
    unit_price numeric(12,2) DEFAULT '0'::numeric,
    amount numeric(14,2) DEFAULT '0'::numeric,
    work_section character varying(20),
    reason text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: over_picking_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.over_picking_order (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_no character varying(50) NOT NULL,
    work_order_id uuid NOT NULL,
    work_order_no character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'pending_approval'::character varying NOT NULL,
    total_qty numeric DEFAULT '0'::numeric,
    total_amount numeric(14,2) DEFAULT '0'::numeric,
    applicant_id public.user_profile,
    applicant_name character varying(100),
    approver_id public.user_profile,
    approver_name character varying(100),
    approval_time timestamp(3) with time zone,
    approval_remark text,
    picking_id uuid,
    picking_no character varying(50),
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    oa_instance_id bigint,
    oa_status character varying(20)
);


--
-- Name: picking_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.picking_order (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    picking_no character varying(50) NOT NULL,
    work_order_id uuid NOT NULL,
    req_id uuid,
    work_section character varying(20) NOT NULL,
    is_supplement boolean DEFAULT false NOT NULL,
    total_qty numeric DEFAULT '0'::numeric,
    status character varying(20) DEFAULT 'pending_approval'::character varying NOT NULL,
    applicant_id public.user_profile,
    approver_id public.user_profile,
    approval_time timestamp(3) with time zone,
    approval_remark text,
    picker_id public.user_profile,
    pick_time timestamp(3) with time zone,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    received_by public.user_profile,
    received_time timestamp(3) with time zone,
    receive_remark text,
    oa_instance_id bigint,
    oa_status character varying(20),
    oa_synced_at timestamp(3) with time zone,
    oa_stage character varying(20)
);


--
-- Name: picking_order_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.picking_order_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    picking_id uuid NOT NULL,
    material_id uuid,
    material_code character varying(100) NOT NULL,
    material_name character varying(200) NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    pick_qty numeric NOT NULL,
    actual_qty numeric DEFAULT '0'::numeric,
    actual_material_id uuid,
    actual_material_code character varying(100),
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    received_qty numeric DEFAULT 0,
    receive_remark text
);


--
-- Name: picking_reel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.picking_reel (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    picking_id uuid NOT NULL,
    picking_item_id uuid NOT NULL,
    work_order_id uuid NOT NULL,
    material_id uuid NOT NULL,
    reel_no character varying(120) NOT NULL,
    batch_no character varying(100),
    from_location_id uuid,
    issued_qty numeric DEFAULT 0 NOT NULL,
    returned_qty numeric DEFAULT 0 NOT NULL,
    consumed_qty numeric DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'issued'::character varying NOT NULL,
    issued_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    issued_by public.user_profile,
    returned_at timestamp(3) with time zone,
    returned_by public.user_profile,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: production_return; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_return (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_no character varying(50) NOT NULL,
    material_id uuid NOT NULL,
    material_code character varying(100) NOT NULL,
    material_name character varying(200) NOT NULL,
    supplier_id uuid,
    supplier_code character varying(50),
    supplier_name character varying(200),
    quantity numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    production_date date,
    batch_no character varying(100),
    return_reason text,
    work_order_no character varying(50),
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    received_good_qty numeric DEFAULT '0'::numeric NOT NULL,
    received_incoming_defect_qty numeric DEFAULT '0'::numeric NOT NULL,
    received_operation_defect_qty numeric DEFAULT '0'::numeric NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    reel_no character varying(120)
);


--
-- Name: production_return_iqc; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_return_iqc (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id uuid NOT NULL,
    good_qty numeric DEFAULT '0'::numeric NOT NULL,
    incoming_defect_qty numeric DEFAULT '0'::numeric NOT NULL,
    operation_defect_qty numeric DEFAULT '0'::numeric NOT NULL,
    inspector_id public.user_profile,
    inspector_name character varying(100),
    inspection_time timestamp(3) with time zone,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: production_return_label; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_return_label (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label_no character varying(50) NOT NULL,
    return_id uuid NOT NULL,
    category character varying(30) NOT NULL,
    quantity numeric DEFAULT '0'::numeric NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile
);


--
-- Name: receipt_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipt_order (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_no character varying(50) NOT NULL,
    receipt_date date NOT NULL,
    supplier_id uuid,
    material_id uuid NOT NULL,
    quantity numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    production_date date,
    batch_no character varying(100),
    serial_no character varying(100),
    location_id uuid,
    keeper_id public.user_profile,
    qr_content text,
    remark text,
    status character varying(20) DEFAULT 'pending_iqc'::character varying NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: rework_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rework_order (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rework_no character varying(50) NOT NULL,
    mrb_id uuid,
    disposition_id uuid,
    material_id uuid NOT NULL,
    material_code character varying(100),
    material_name character varying(200),
    supplier_id uuid,
    supplier_code character varying(50),
    supplier_name character varying(200),
    batch_no character varying(100),
    quantity numeric DEFAULT '0'::numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    source_location_id uuid,
    target_location_id uuid,
    finish_time timestamp(3) with time zone,
    finish_by public.user_profile,
    finish_remark text,
    reinspect_time timestamp(3) with time zone,
    reinspect_by public.user_profile,
    reinspect_result character varying(20),
    reinspect_remark text,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: role_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_code character varying(50) NOT NULL,
    user_id character varying(100) NOT NULL,
    user_name character varying(100),
    work_section character varying(20),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL
);


--
-- Name: seq_adjust_tx_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_adjust_tx_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_inventory_label_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_inventory_label_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_iqc_inspection_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_iqc_inspection_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_iqc_lot_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_iqc_lot_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_mrb_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_mrb_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_over_picking_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_over_picking_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_receipt_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_receipt_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_report_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_report_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_rework_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_rework_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_stock_take_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_stock_take_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_supplier_return_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_supplier_return_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: seq_transfer_no; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.seq_transfer_no
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_take_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_take_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    take_id uuid NOT NULL,
    inventory_id uuid,
    material_id uuid,
    material_code character varying(100) NOT NULL,
    material_name character varying(200),
    specification text,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    supplier_id uuid,
    supplier_code character varying(100),
    supplier_name character varying(200),
    location_id uuid,
    location_code character varying(100),
    warehouse_id uuid,
    warehouse_code character varying(50),
    warehouse_name character varying(100),
    stock_status character varying(20) DEFAULT 'good'::character varying NOT NULL,
    batch_no character varying(100),
    label_no character varying(150),
    production_date date,
    book_qty numeric DEFAULT '0'::numeric NOT NULL,
    actual_qty numeric DEFAULT '0'::numeric NOT NULL,
    diff_qty numeric DEFAULT '0'::numeric NOT NULL,
    diff_type character varying(12) DEFAULT 'pending'::character varying NOT NULL,
    scanned_labels jsonb DEFAULT '[]'::jsonb,
    scan_count integer DEFAULT 0 NOT NULL,
    checked boolean DEFAULT false NOT NULL,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: stock_take_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_take_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    take_id uuid NOT NULL,
    item_id uuid,
    action character varying(30) NOT NULL,
    detail text,
    operator_id public.user_profile,
    operator_name character varying(100),
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: stock_take_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_take_order (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    take_no character varying(50) NOT NULL,
    period_month character varying(7) NOT NULL,
    take_type character varying(20) DEFAULT 'monthly'::character varying NOT NULL,
    scope character varying(20) DEFAULT 'all'::character varying NOT NULL,
    warehouse_id uuid,
    warehouse_code character varying(50),
    warehouse_name character varying(100),
    status character varying(24) DEFAULT 'draft'::character varying NOT NULL,
    title character varying(200),
    operator_id public.user_profile,
    operator_name character varying(100),
    approver_id public.user_profile,
    approver_name character varying(100),
    approval_time timestamp(3) with time zone,
    approval_remark text,
    submit_time timestamp(3) with time zone,
    unlock_authorized_by public.user_profile,
    unlock_authorized_name character varying(100),
    unlock_authorized_at timestamp(3) with time zone,
    unlock_reason text,
    revision_count integer DEFAULT 0 NOT NULL,
    total_lines integer DEFAULT 0 NOT NULL,
    checked_lines integer DEFAULT 0 NOT NULL,
    match_lines integer DEFAULT 0 NOT NULL,
    profit_lines integer DEFAULT 0 NOT NULL,
    loss_lines integer DEFAULT 0 NOT NULL,
    book_qty_total numeric DEFAULT '0'::numeric,
    actual_qty_total numeric DEFAULT '0'::numeric,
    diff_qty_total numeric DEFAULT '0'::numeric,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    parent_id uuid,
    order_type character varying(12) DEFAULT 'standalone'::character varying NOT NULL,
    scope_area character varying(50),
    scope_shelf character varying(50),
    scope_layer character varying(50),
    scope_loc_from character varying(100),
    scope_loc_to character varying(100),
    child_count integer DEFAULT 0 NOT NULL,
    oa_instance_id bigint,
    oa_status character varying(20)
);


--
-- Name: stock_transfer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_transfer (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_no character varying(50) NOT NULL,
    transfer_date date NOT NULL,
    from_location_id uuid NOT NULL,
    to_location_id uuid NOT NULL,
    material_id uuid NOT NULL,
    batch_no character varying(100),
    quantity numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    operator_id public.user_profile,
    status character varying(20) DEFAULT 'completed'::character varying NOT NULL,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: supplier; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_code character varying(50) NOT NULL,
    supplier_name character varying(200) NOT NULL,
    contact_person character varying(100),
    contact_phone character varying(50),
    contact_email character varying(100),
    address text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    description text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: supplier_debt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_debt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    debt_no character varying(50) NOT NULL,
    supplier_id uuid NOT NULL,
    supplier_code character varying(50) NOT NULL,
    supplier_name character varying(200) NOT NULL,
    material_id uuid NOT NULL,
    material_code character varying(100) NOT NULL,
    material_name character varying(200) NOT NULL,
    origin_qty numeric(18,4) DEFAULT 0 NOT NULL,
    settled_qty numeric(18,4) DEFAULT 0 NOT NULL,
    source_type character varying(50) DEFAULT 'production_return'::character varying NOT NULL,
    source_id uuid NOT NULL,
    source_no character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_by public.user_profile
);


--
-- Name: supplier_debt_settlement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_debt_settlement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    debt_id uuid NOT NULL,
    receipt_id uuid,
    receipt_no character varying(50),
    qty numeric(18,4) DEFAULT 0 NOT NULL,
    iqc_result character varying(20) DEFAULT 'pass'::character varying NOT NULL,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_by public.user_profile
);


--
-- Name: supplier_material; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_material (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    material_id uuid NOT NULL,
    supplier_material_code character varying(100),
    msl_level character varying(20) DEFAULT '不管控'::character varying,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: supplier_return_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_return_item (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    material_id uuid NOT NULL,
    material_code character varying(100),
    material_name character varying(200),
    batch_no character varying(100),
    location_id uuid,
    inventory_id uuid,
    quantity numeric DEFAULT '0'::numeric NOT NULL,
    out_qty numeric DEFAULT '0'::numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    disposition_id uuid,
    sort_order integer DEFAULT 0 NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: supplier_return_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_return_order (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_no character varying(50) NOT NULL,
    mrb_id uuid,
    disposition_id uuid,
    supplier_id uuid,
    supplier_code character varying(50),
    supplier_name character varying(200),
    batch_no character varying(100),
    status character varying(20) DEFAULT 'pending_out'::character varying NOT NULL,
    total_qty numeric DEFAULT '0'::numeric NOT NULL,
    out_qty numeric DEFAULT '0'::numeric NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    out_time timestamp(3) with time zone,
    out_by public.user_profile,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: sys_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sys_account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account character varying(50) NOT NULL,
    password_hash character varying(200) NOT NULL,
    name character varying(100) NOT NULL,
    role_code character varying(50) NOT NULL,
    work_section character varying(20),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    is_first_login boolean DEFAULT true NOT NULL,
    last_login_at timestamp(3) with time zone,
    platform_user_id character varying(100),
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    oa_user_id bigint
);


--
-- Name: sys_notice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sys_notice (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id public.user_profile NOT NULL,
    title character varying(200) NOT NULL,
    content text,
    biz_type character varying(20) DEFAULT 'mrb'::character varying NOT NULL,
    biz_id uuid,
    biz_no character varying(50),
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp(3) with time zone,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile
);


--
-- Name: sys_param; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sys_param (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    param_key character varying(100) NOT NULL,
    param_value text NOT NULL,
    param_name_zh character varying(200),
    param_name_vi character varying(200),
    param_name_en character varying(200),
    description text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: sys_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sys_role (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_code character varying(50) NOT NULL,
    role_name character varying(100) NOT NULL,
    description character varying(500),
    menu_permissions text[] DEFAULT '{}'::text[] NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: warehouse; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouse (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wh_code character varying(50) NOT NULL,
    wh_name_zh character varying(100) NOT NULL,
    wh_name_vi character varying(100),
    wh_name_en character varying(100),
    wh_type character varying(20) DEFAULT 'normal'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    address text,
    description text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: warehouse_location; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouse_location (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_code character varying(100) NOT NULL,
    warehouse_id uuid NOT NULL,
    area_code character varying(50),
    shelf_code character varying(50),
    layer_code character varying(50),
    position_code character varying(50),
    location_type character varying(20) DEFAULT 'good'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    description text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile
);


--
-- Name: work_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_order (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_order_no character varying(50) NOT NULL,
    bom_id uuid,
    product_code character varying(100) NOT NULL,
    product_name character varying(200) NOT NULL,
    plan_qty numeric NOT NULL,
    actual_qty numeric DEFAULT '0'::numeric,
    work_order_date date NOT NULL,
    is_supplement boolean DEFAULT false NOT NULL,
    parent_order_id uuid,
    status character varying(20) DEFAULT 'created'::character varying NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    planner_id public.user_profile,
    remark text,
    _created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _created_by public.user_profile,
    _updated_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    _updated_by public.user_profile,
    over_consume_status character varying(20),
    over_consume_rate numeric,
    over_consume_qty numeric,
    over_consume_approved_by public.user_profile,
    over_consume_approved_time timestamp(3) with time zone,
    over_consume_remark text,
    oa_instance_id bigint,
    oa_status character varying(20)
);


--
-- Name: oa_callback_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oa_callback_log ALTER COLUMN id SET DEFAULT nextval('public.oa_callback_log_id_seq'::regclass);


--
-- Name: oa_event_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oa_event_outbox ALTER COLUMN id SET DEFAULT nextval('public.oa_event_outbox_id_seq'::regclass);


--
-- Name: bom bom_bom_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom
    ADD CONSTRAINT bom_bom_code_unique UNIQUE (bom_code);


--
-- Name: bom_item bom_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_item
    ADD CONSTRAINT bom_item_pkey PRIMARY KEY (id);


--
-- Name: bom bom_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom
    ADD CONSTRAINT bom_pkey PRIMARY KEY (id);


--
-- Name: defective_move_task defective_move_task_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defective_move_task
    ADD CONSTRAINT defective_move_task_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: inventory_transaction inventory_transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transaction
    ADD CONSTRAINT inventory_transaction_pkey PRIMARY KEY (id);


--
-- Name: iqc_inspection_draft iqc_inspection_draft_lot_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_draft
    ADD CONSTRAINT iqc_inspection_draft_lot_id_unique UNIQUE (lot_id);


--
-- Name: iqc_inspection_draft iqc_inspection_draft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_draft
    ADD CONSTRAINT iqc_inspection_draft_pkey PRIMARY KEY (id);


--
-- Name: iqc_inspection_item iqc_inspection_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_item
    ADD CONSTRAINT iqc_inspection_item_pkey PRIMARY KEY (id);


--
-- Name: iqc_inspection_record iqc_inspection_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_record
    ADD CONSTRAINT iqc_inspection_record_pkey PRIMARY KEY (id);


--
-- Name: iqc_inspection_strictness iqc_inspection_strictness_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_strictness
    ADD CONSTRAINT iqc_inspection_strictness_pkey PRIMARY KEY (id);


--
-- Name: iqc_lot iqc_lot_lot_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_lot
    ADD CONSTRAINT iqc_lot_lot_no_unique UNIQUE (lot_no);


--
-- Name: iqc_lot iqc_lot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_lot
    ADD CONSTRAINT iqc_lot_pkey PRIMARY KEY (id);


--
-- Name: iqc_lot_receipt iqc_lot_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_lot_receipt
    ADD CONSTRAINT iqc_lot_receipt_pkey PRIMARY KEY (id);


--
-- Name: iqc_lot_strictness_count iqc_lot_strictness_count_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_lot_strictness_count
    ADD CONSTRAINT iqc_lot_strictness_count_pkey PRIMARY KEY (id);


--
-- Name: iqc_report iqc_report_lot_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_report
    ADD CONSTRAINT iqc_report_lot_id_unique UNIQUE (lot_id);


--
-- Name: iqc_report iqc_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_report
    ADD CONSTRAINT iqc_report_pkey PRIMARY KEY (id);


--
-- Name: iqc_report iqc_report_report_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_report
    ADD CONSTRAINT iqc_report_report_no_unique UNIQUE (report_no);


--
-- Name: iqc_standard_item iqc_standard_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_standard_item
    ADD CONSTRAINT iqc_standard_item_pkey PRIMARY KEY (id);


--
-- Name: iqc_strictness_transfer_log iqc_strictness_transfer_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_strictness_transfer_log
    ADD CONSTRAINT iqc_strictness_transfer_log_pkey PRIMARY KEY (id);


--
-- Name: iqc_template_item iqc_template_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_template_item
    ADD CONSTRAINT iqc_template_item_pkey PRIMARY KEY (id);


--
-- Name: iqc_template_material iqc_template_material_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_template_material
    ADD CONSTRAINT iqc_template_material_pkey PRIMARY KEY (id);


--
-- Name: iqc_template iqc_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_template
    ADD CONSTRAINT iqc_template_pkey PRIMARY KEY (id);


--
-- Name: material_expiry_extension material_expiry_extension_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_expiry_extension
    ADD CONSTRAINT material_expiry_extension_pkey PRIMARY KEY (id);


--
-- Name: material material_material_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material
    ADD CONSTRAINT material_material_code_unique UNIQUE (material_code);


--
-- Name: material material_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material
    ADD CONSTRAINT material_pkey PRIMARY KEY (id);


--
-- Name: material_requirement_item material_requirement_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_requirement_item
    ADD CONSTRAINT material_requirement_item_pkey PRIMARY KEY (id);


--
-- Name: material_requirement material_requirement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_requirement
    ADD CONSTRAINT material_requirement_pkey PRIMARY KEY (id);


--
-- Name: material_requirement material_requirement_req_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_requirement
    ADD CONSTRAINT material_requirement_req_no_unique UNIQUE (req_no);


--
-- Name: material_substitution material_substitution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_substitution
    ADD CONSTRAINT material_substitution_pkey PRIMARY KEY (id);


--
-- Name: mrb_cc mrb_cc_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_cc
    ADD CONSTRAINT mrb_cc_pkey PRIMARY KEY (id);


--
-- Name: mrb_disposition_label mrb_disposition_label_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_disposition_label
    ADD CONSTRAINT mrb_disposition_label_pkey PRIMARY KEY (id);


--
-- Name: mrb_disposition mrb_disposition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_disposition
    ADD CONSTRAINT mrb_disposition_pkey PRIMARY KEY (id);


--
-- Name: mrb_review mrb_review_mrb_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_review
    ADD CONSTRAINT mrb_review_mrb_no_unique UNIQUE (mrb_no);


--
-- Name: mrb_review mrb_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_review
    ADD CONSTRAINT mrb_review_pkey PRIMARY KEY (id);


--
-- Name: mrb_reviewer mrb_reviewer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_reviewer
    ADD CONSTRAINT mrb_reviewer_pkey PRIMARY KEY (id);


--
-- Name: oa_callback_log oa_callback_log_oa_instance_id_event_node_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oa_callback_log
    ADD CONSTRAINT oa_callback_log_oa_instance_id_event_node_index_key UNIQUE (oa_instance_id, event, node_index);


--
-- Name: oa_callback_log oa_callback_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oa_callback_log
    ADD CONSTRAINT oa_callback_log_pkey PRIMARY KEY (id);


--
-- Name: oa_event_outbox oa_event_outbox_event_biz_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oa_event_outbox
    ADD CONSTRAINT oa_event_outbox_event_biz_key_key UNIQUE (event, biz_key);


--
-- Name: oa_event_outbox oa_event_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oa_event_outbox
    ADD CONSTRAINT oa_event_outbox_pkey PRIMARY KEY (id);


--
-- Name: operation_log operation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_log
    ADD CONSTRAINT operation_log_pkey PRIMARY KEY (id);


--
-- Name: over_picking_item over_picking_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.over_picking_item
    ADD CONSTRAINT over_picking_item_pkey PRIMARY KEY (id);


--
-- Name: over_picking_order over_picking_order_order_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.over_picking_order
    ADD CONSTRAINT over_picking_order_order_no_unique UNIQUE (order_no);


--
-- Name: over_picking_order over_picking_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.over_picking_order
    ADD CONSTRAINT over_picking_order_pkey PRIMARY KEY (id);


--
-- Name: picking_order_item picking_order_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picking_order_item
    ADD CONSTRAINT picking_order_item_pkey PRIMARY KEY (id);


--
-- Name: picking_order picking_order_picking_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picking_order
    ADD CONSTRAINT picking_order_picking_no_unique UNIQUE (picking_no);


--
-- Name: picking_order picking_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picking_order
    ADD CONSTRAINT picking_order_pkey PRIMARY KEY (id);


--
-- Name: picking_reel picking_reel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picking_reel
    ADD CONSTRAINT picking_reel_pkey PRIMARY KEY (id);


--
-- Name: production_return_iqc production_return_iqc_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_return_iqc
    ADD CONSTRAINT production_return_iqc_pkey PRIMARY KEY (id);


--
-- Name: production_return_label production_return_label_label_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_return_label
    ADD CONSTRAINT production_return_label_label_no_unique UNIQUE (label_no);


--
-- Name: production_return_label production_return_label_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_return_label
    ADD CONSTRAINT production_return_label_pkey PRIMARY KEY (id);


--
-- Name: production_return production_return_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_return
    ADD CONSTRAINT production_return_pkey PRIMARY KEY (id);


--
-- Name: production_return production_return_return_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_return
    ADD CONSTRAINT production_return_return_no_unique UNIQUE (return_no);


--
-- Name: receipt_order receipt_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_order
    ADD CONSTRAINT receipt_order_pkey PRIMARY KEY (id);


--
-- Name: receipt_order receipt_order_receipt_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_order
    ADD CONSTRAINT receipt_order_receipt_no_unique UNIQUE (receipt_no);


--
-- Name: rework_order rework_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rework_order
    ADD CONSTRAINT rework_order_pkey PRIMARY KEY (id);


--
-- Name: rework_order rework_order_rework_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rework_order
    ADD CONSTRAINT rework_order_rework_no_unique UNIQUE (rework_no);


--
-- Name: role_user role_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_user
    ADD CONSTRAINT role_user_pkey PRIMARY KEY (id);


--
-- Name: stock_take_item stock_take_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_take_item
    ADD CONSTRAINT stock_take_item_pkey PRIMARY KEY (id);


--
-- Name: stock_take_log stock_take_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_take_log
    ADD CONSTRAINT stock_take_log_pkey PRIMARY KEY (id);


--
-- Name: stock_take_order stock_take_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_take_order
    ADD CONSTRAINT stock_take_order_pkey PRIMARY KEY (id);


--
-- Name: stock_take_order stock_take_order_take_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_take_order
    ADD CONSTRAINT stock_take_order_take_no_unique UNIQUE (take_no);


--
-- Name: stock_transfer stock_transfer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_pkey PRIMARY KEY (id);


--
-- Name: stock_transfer stock_transfer_transfer_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_transfer_no_unique UNIQUE (transfer_no);


--
-- Name: supplier_debt supplier_debt_debt_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_debt
    ADD CONSTRAINT supplier_debt_debt_no_key UNIQUE (debt_no);


--
-- Name: supplier_debt supplier_debt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_debt
    ADD CONSTRAINT supplier_debt_pkey PRIMARY KEY (id);


--
-- Name: supplier_debt_settlement supplier_debt_settlement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_debt_settlement
    ADD CONSTRAINT supplier_debt_settlement_pkey PRIMARY KEY (id);


--
-- Name: supplier_material supplier_material_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_material
    ADD CONSTRAINT supplier_material_pkey PRIMARY KEY (id);


--
-- Name: supplier supplier_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier
    ADD CONSTRAINT supplier_pkey PRIMARY KEY (id);


--
-- Name: supplier_return_item supplier_return_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_return_item
    ADD CONSTRAINT supplier_return_item_pkey PRIMARY KEY (id);


--
-- Name: supplier_return_order supplier_return_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_return_order
    ADD CONSTRAINT supplier_return_order_pkey PRIMARY KEY (id);


--
-- Name: supplier_return_order supplier_return_order_return_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_return_order
    ADD CONSTRAINT supplier_return_order_return_no_unique UNIQUE (return_no);


--
-- Name: supplier supplier_supplier_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier
    ADD CONSTRAINT supplier_supplier_code_unique UNIQUE (supplier_code);


--
-- Name: sys_account sys_account_account_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sys_account
    ADD CONSTRAINT sys_account_account_unique UNIQUE (account);


--
-- Name: sys_account sys_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sys_account
    ADD CONSTRAINT sys_account_pkey PRIMARY KEY (id);


--
-- Name: sys_account sys_account_platform_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sys_account
    ADD CONSTRAINT sys_account_platform_user_id_unique UNIQUE (platform_user_id);


--
-- Name: sys_notice sys_notice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sys_notice
    ADD CONSTRAINT sys_notice_pkey PRIMARY KEY (id);


--
-- Name: sys_param sys_param_param_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sys_param
    ADD CONSTRAINT sys_param_param_key_unique UNIQUE (param_key);


--
-- Name: sys_param sys_param_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sys_param
    ADD CONSTRAINT sys_param_pkey PRIMARY KEY (id);


--
-- Name: sys_role sys_role_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sys_role
    ADD CONSTRAINT sys_role_pkey PRIMARY KEY (id);


--
-- Name: sys_role sys_role_role_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sys_role
    ADD CONSTRAINT sys_role_role_code_unique UNIQUE (role_code);


--
-- Name: warehouse_location warehouse_location_location_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_location
    ADD CONSTRAINT warehouse_location_location_code_unique UNIQUE (location_code);


--
-- Name: warehouse_location warehouse_location_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_location
    ADD CONSTRAINT warehouse_location_pkey PRIMARY KEY (id);


--
-- Name: warehouse warehouse_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT warehouse_pkey PRIMARY KEY (id);


--
-- Name: warehouse warehouse_wh_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse
    ADD CONSTRAINT warehouse_wh_code_unique UNIQUE (wh_code);


--
-- Name: work_order work_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order
    ADD CONSTRAINT work_order_pkey PRIMARY KEY (id);


--
-- Name: work_order work_order_work_order_no_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order
    ADD CONSTRAINT work_order_work_order_no_unique UNIQUE (work_order_no);


--
-- Name: bom_bom_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bom_bom_code_key ON public.bom USING btree (bom_code);


--
-- Name: idx_bom_item_bom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bom_item_bom ON public.bom_item USING btree (bom_id);


--
-- Name: idx_bom_item_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bom_item_section ON public.bom_item USING btree (work_section);


--
-- Name: idx_dmt_inventory; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmt_inventory ON public.defective_move_task USING btree (inventory_id);


--
-- Name: idx_dmt_mrb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmt_mrb ON public.defective_move_task USING btree (mrb_id);


--
-- Name: idx_dmt_source_inspection_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmt_source_inspection_no ON public.defective_move_task USING btree (source_inspection_no);


--
-- Name: idx_dmt_source_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmt_source_status ON public.defective_move_task USING btree (source, status);


--
-- Name: idx_dmt_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dmt_status ON public.defective_move_task USING btree (status);


--
-- Name: idx_expiry_mat_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expiry_mat_batch ON public.material_expiry_extension USING btree (material_id, batch_no);


--
-- Name: idx_inv_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_batch ON public.inventory USING btree (batch_no);


--
-- Name: idx_inv_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_location ON public.inventory USING btree (location_id);


--
-- Name: idx_inv_lock_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_lock_reason ON public.inventory USING btree (lock_reason);


--
-- Name: idx_inv_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_material ON public.inventory USING btree (material_id);


--
-- Name: idx_inv_pending_qc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_pending_qc ON public.inventory USING btree (material_id, batch_no) WHERE ((stock_status)::text = 'pending_qc'::text);


--
-- Name: idx_inv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_status ON public.inventory USING btree (stock_status);


--
-- Name: idx_inventory_label_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_label_no ON public.inventory USING btree (label_no);


--
-- Name: idx_inventory_mrb_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_mrb_lookup ON public.inventory USING btree (material_id, supplier_id, batch_no) WHERE (quantity > (0)::numeric);


--
-- Name: idx_inventory_special_admit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_special_admit ON public.inventory USING btree (is_special_admit);


--
-- Name: idx_invt_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invt_batch ON public.inventory_transaction USING btree (batch_no);


--
-- Name: idx_invt_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invt_created ON public.inventory_transaction USING btree (_created_at);


--
-- Name: idx_invt_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invt_label ON public.inventory_transaction USING btree (label_no);


--
-- Name: idx_invt_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invt_location ON public.inventory_transaction USING btree (location_id);


--
-- Name: idx_invt_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invt_material ON public.inventory_transaction USING btree (material_id);


--
-- Name: idx_invt_tx_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invt_tx_no ON public.inventory_transaction USING btree (tx_no);


--
-- Name: idx_invt_tx_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invt_tx_type ON public.inventory_transaction USING btree (tx_type);


--
-- Name: idx_iqc_item_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_item_material ON public.iqc_inspection_item USING btree (material_id);


--
-- Name: idx_iqc_lot_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_batch ON public.iqc_lot USING btree (batch_no);


--
-- Name: idx_iqc_lot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_date ON public.iqc_lot USING btree (receipt_date);


--
-- Name: idx_iqc_lot_last_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_last_template ON public.iqc_lot USING btree (last_template_id);


--
-- Name: idx_iqc_lot_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_material ON public.iqc_lot USING btree (material_id);


--
-- Name: idx_iqc_lot_merge_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_merge_key ON public.iqc_lot USING btree (receipt_date, supplier_id, material_id, production_date, batch_no);


--
-- Name: idx_iqc_lot_oa_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_oa_claim ON public.iqc_lot USING btree (oa_claimed_at) WHERE (oa_claimed_at IS NOT NULL);


--
-- Name: idx_iqc_lot_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_result ON public.iqc_lot USING btree (inspection_result);


--
-- Name: idx_iqc_lot_st_count_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_st_count_material ON public.iqc_lot_strictness_count USING btree (material_id);


--
-- Name: idx_iqc_lot_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_status ON public.iqc_lot USING btree (status);


--
-- Name: idx_iqc_lot_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_lot_supplier ON public.iqc_lot USING btree (supplier_id);


--
-- Name: idx_iqc_rec_lot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_rec_lot ON public.iqc_inspection_record USING btree (lot_id);


--
-- Name: idx_iqc_rpt_judge_mode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_rpt_judge_mode ON public.iqc_report USING btree (judge_mode);


--
-- Name: idx_iqc_rpt_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_rpt_result ON public.iqc_report USING btree (final_result);


--
-- Name: idx_iqc_rpt_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_rpt_review_status ON public.iqc_report USING btree (review_status);


--
-- Name: idx_iqc_st_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_st_log_created ON public.iqc_strictness_transfer_log USING btree (_created_at);


--
-- Name: idx_iqc_st_log_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_st_log_material ON public.iqc_strictness_transfer_log USING btree (material_id);


--
-- Name: idx_iqc_st_log_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_st_log_type ON public.iqc_strictness_transfer_log USING btree (inspection_type);


--
-- Name: idx_iqc_std_item_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_std_item_section ON public.iqc_standard_item USING btree (section_type);


--
-- Name: idx_iqc_strictness_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_strictness_material ON public.iqc_inspection_strictness USING btree (material_id);


--
-- Name: idx_iqc_strictness_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_strictness_status ON public.iqc_inspection_strictness USING btree (strictness);


--
-- Name: idx_iqc_tpl_item_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_tpl_item_section ON public.iqc_template_item USING btree (template_id, section_type);


--
-- Name: idx_iqc_tpl_item_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_tpl_item_template ON public.iqc_template_item USING btree (template_id);


--
-- Name: idx_iqc_tpl_mat_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iqc_tpl_mat_material ON public.iqc_template_material USING btree (material_id);


--
-- Name: idx_material_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_code ON public.material USING btree (material_code);


--
-- Name: idx_material_packaging; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_packaging ON public.material USING btree (packaging_type);


--
-- Name: idx_material_supplier_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_supplier_code ON public.material USING btree (supplier_code);


--
-- Name: idx_material_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_type ON public.material USING btree (material_type);


--
-- Name: idx_mdl_disp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mdl_disp ON public.mrb_disposition_label USING btree (disposition_id);


--
-- Name: idx_mdl_mrb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mdl_mrb ON public.mrb_disposition_label USING btree (mrb_id);


--
-- Name: idx_mdl_receipt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mdl_receipt ON public.mrb_disposition_label USING btree (receipt_id);


--
-- Name: idx_mr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mr_status ON public.material_requirement USING btree (status);


--
-- Name: idx_mr_work_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mr_work_order ON public.material_requirement USING btree (work_order_id);


--
-- Name: idx_mrb_cc_mrb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_cc_mrb ON public.mrb_cc USING btree (mrb_id);


--
-- Name: idx_mrb_disp_hold; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_disp_hold ON public.mrb_disposition USING btree (exec_status, hold_until);


--
-- Name: idx_mrb_disp_mrb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_disp_mrb ON public.mrb_disposition USING btree (mrb_id);


--
-- Name: idx_mrb_disp_other; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_disp_other ON public.mrb_disposition USING btree (other_type, hold_until) WHERE (other_type IS NOT NULL);


--
-- Name: idx_mrb_disp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_disp_status ON public.mrb_disposition USING btree (exec_status);


--
-- Name: idx_mrb_disp_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_disp_type ON public.mrb_disposition USING btree (disposition_type);


--
-- Name: idx_mrb_lot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_lot ON public.mrb_review USING btree (lot_id);


--
-- Name: idx_mrb_lot_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_lot_status ON public.mrb_review USING btree (lot_id, status);


--
-- Name: idx_mrb_r_mrb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_r_mrb ON public.mrb_reviewer USING btree (mrb_id);


--
-- Name: idx_mrb_source_inspection_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_source_inspection_no ON public.mrb_review USING btree (source_inspection_no);


--
-- Name: idx_mrb_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_status ON public.mrb_review USING btree (status);


--
-- Name: idx_mrb_status_since; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_status_since ON public.mrb_review USING btree (status, status_since);


--
-- Name: idx_mrb_status_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mrb_status_updated ON public.mrb_review USING btree (status, _updated_at);


--
-- Name: idx_mri_req; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mri_req ON public.material_requirement_item USING btree (req_id);


--
-- Name: idx_ms_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ms_material ON public.material_substitution USING btree (material_id);


--
-- Name: idx_ms_material_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ms_material_code ON public.material_substitution USING btree (material_code);


--
-- Name: idx_ms_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ms_status ON public.material_substitution USING btree (status);


--
-- Name: idx_ms_substitute; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ms_substitute ON public.material_substitution USING btree (substitute_material_id);


--
-- Name: idx_notice_biz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notice_biz ON public.sys_notice USING btree (biz_type, biz_id);


--
-- Name: idx_notice_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notice_user_time ON public.sys_notice USING btree (((user_id).user_id), is_read, _created_at DESC);


--
-- Name: idx_oa_outbox_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oa_outbox_due ON public.oa_event_outbox USING btree (next_attempt_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_oa_outbox_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oa_outbox_status ON public.oa_event_outbox USING btree (status, created_at DESC);


--
-- Name: idx_opi_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opi_material ON public.over_picking_item USING btree (material_id);


--
-- Name: idx_opi_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opi_order ON public.over_picking_item USING btree (order_id);


--
-- Name: idx_oplog_biz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oplog_biz ON public.operation_log USING btree (biz_type, biz_id);


--
-- Name: idx_oplog_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oplog_created ON public.operation_log USING btree (_created_at);


--
-- Name: idx_opo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opo_status ON public.over_picking_order USING btree (status);


--
-- Name: idx_opo_work_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opo_work_order ON public.over_picking_order USING btree (work_order_id);


--
-- Name: idx_po_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_section ON public.picking_order USING btree (work_section);


--
-- Name: idx_po_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_status ON public.picking_order USING btree (status);


--
-- Name: idx_po_work_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_work_order ON public.picking_order USING btree (work_order_id);


--
-- Name: idx_poi_picking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poi_picking ON public.picking_order_item USING btree (picking_id);


--
-- Name: idx_pr_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_created ON public.production_return USING btree (_created_at);


--
-- Name: idx_pr_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_material ON public.production_return USING btree (material_id);


--
-- Name: idx_pr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pr_status ON public.production_return USING btree (status);


--
-- Name: idx_pri_return; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pri_return ON public.production_return_iqc USING btree (return_id);


--
-- Name: idx_prl_label_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prl_label_no ON public.production_return_label USING btree (label_no);


--
-- Name: idx_prl_return; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prl_return ON public.production_return_label USING btree (return_id);


--
-- Name: idx_receipt_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipt_batch ON public.receipt_order USING btree (batch_no);


--
-- Name: idx_receipt_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipt_date ON public.receipt_order USING btree (receipt_date);


--
-- Name: idx_receipt_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipt_material ON public.receipt_order USING btree (material_id);


--
-- Name: idx_receipt_qr_content_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_receipt_qr_content_unique ON public.receipt_order USING btree (qr_content) WHERE (qr_content IS NOT NULL);


--
-- Name: idx_receipt_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipt_status ON public.receipt_order USING btree (status);


--
-- Name: idx_receipt_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipt_supplier ON public.receipt_order USING btree (supplier_id);


--
-- Name: idx_reel_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reel_material ON public.picking_reel USING btree (material_id);


--
-- Name: idx_reel_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reel_no ON public.picking_reel USING btree (reel_no);


--
-- Name: idx_reel_wo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reel_wo ON public.picking_reel USING btree (work_order_id);


--
-- Name: idx_rework_mrb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rework_mrb ON public.rework_order USING btree (mrb_id);


--
-- Name: idx_rework_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rework_status ON public.rework_order USING btree (status);


--
-- Name: idx_sds_debt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sds_debt ON public.supplier_debt_settlement USING btree (debt_id);


--
-- Name: idx_sds_receipt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sds_receipt ON public.supplier_debt_settlement USING btree (receipt_id);


--
-- Name: idx_sm_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_material ON public.supplier_material USING btree (material_id);


--
-- Name: idx_sm_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_supplier ON public.supplier_material USING btree (supplier_id);


--
-- Name: idx_st_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_st_date ON public.stock_transfer USING btree (transfer_date);


--
-- Name: idx_sti_diff_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sti_diff_type ON public.stock_take_item USING btree (diff_type);


--
-- Name: idx_sti_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sti_label ON public.stock_take_item USING btree (label_no);


--
-- Name: idx_sti_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sti_material ON public.stock_take_item USING btree (material_id);


--
-- Name: idx_sti_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sti_supplier ON public.stock_take_item USING btree (supplier_id);


--
-- Name: idx_sti_take; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sti_take ON public.stock_take_item USING btree (take_id);


--
-- Name: idx_stl_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stl_action ON public.stock_take_log USING btree (action);


--
-- Name: idx_stl_take; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stl_take ON public.stock_take_log USING btree (take_id);


--
-- Name: idx_sto_operator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sto_operator ON public.stock_take_order USING btree (operator_id);


--
-- Name: idx_sto_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sto_parent ON public.stock_take_order USING btree (parent_id);


--
-- Name: idx_sto_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sto_period ON public.stock_take_order USING btree (period_month);


--
-- Name: idx_sto_period_wh; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sto_period_wh ON public.stock_take_order USING btree (period_month, warehouse_code);


--
-- Name: idx_sto_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sto_status ON public.stock_take_order USING btree (status);


--
-- Name: idx_sto_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sto_warehouse ON public.stock_take_order USING btree (warehouse_code);


--
-- Name: idx_supplier_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_code ON public.supplier USING btree (supplier_code);


--
-- Name: idx_supplier_debt_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_debt_created ON public.supplier_debt USING btree (_created_at);


--
-- Name: idx_supplier_debt_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_debt_material ON public.supplier_debt USING btree (material_id);


--
-- Name: idx_supplier_debt_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_debt_source ON public.supplier_debt USING btree (source_id);


--
-- Name: idx_supplier_debt_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_debt_status ON public.supplier_debt USING btree (status);


--
-- Name: idx_supplier_debt_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_debt_supplier ON public.supplier_debt USING btree (supplier_id);


--
-- Name: idx_supplier_return_item_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_return_item_order ON public.supplier_return_item USING btree (order_id);


--
-- Name: idx_supplier_return_mrb; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_return_mrb ON public.supplier_return_order USING btree (mrb_id);


--
-- Name: idx_supplier_return_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_return_status ON public.supplier_return_order USING btree (status);


--
-- Name: idx_sys_account_platform_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sys_account_platform_user_id ON public.sys_account USING btree (platform_user_id);


--
-- Name: idx_sys_account_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sys_account_role ON public.sys_account USING btree (role_code);


--
-- Name: idx_sys_account_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sys_account_status ON public.sys_account USING btree (status);


--
-- Name: idx_wh_loc_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wh_loc_type ON public.warehouse_location USING btree (location_type);


--
-- Name: idx_wh_loc_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wh_loc_warehouse ON public.warehouse_location USING btree (warehouse_id);


--
-- Name: idx_wo_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wo_date ON public.work_order USING btree (work_order_date);


--
-- Name: idx_wo_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wo_parent ON public.work_order USING btree (parent_order_id);


--
-- Name: idx_wo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wo_status ON public.work_order USING btree (status);


--
-- Name: inventory_material_id_location_id_batch_no_stock_status_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_material_id_location_id_batch_no_stock_status_key ON public.inventory USING btree (material_id, location_id, batch_no, stock_status);


--
-- Name: iqc_inspection_draft_lot_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_inspection_draft_lot_id_key ON public.iqc_inspection_draft USING btree (lot_id);


--
-- Name: iqc_inspection_strictness_material_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_inspection_strictness_material_type_key ON public.iqc_inspection_strictness USING btree (material_id, inspection_type);


--
-- Name: iqc_lot_active_dedup_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_lot_active_dedup_uniq ON public.iqc_lot USING btree (supplier_id, material_id, production_date, batch_no) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'inspecting'::character varying, 'review_pending'::character varying, 'rejected'::character varying])::text[]));


--
-- Name: iqc_lot_inspection_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_lot_inspection_no_key ON public.iqc_lot USING btree (inspection_no);


--
-- Name: iqc_lot_lot_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_lot_lot_no_key ON public.iqc_lot USING btree (lot_no);


--
-- Name: iqc_lot_receipt_lot_id_receipt_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_lot_receipt_lot_id_receipt_id_key ON public.iqc_lot_receipt USING btree (lot_id, receipt_id);


--
-- Name: iqc_lot_strictness_count_lot_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_lot_strictness_count_lot_type_key ON public.iqc_lot_strictness_count USING btree (lot_id, inspection_type);


--
-- Name: iqc_report_lot_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_report_lot_id_key ON public.iqc_report USING btree (lot_id);


--
-- Name: iqc_report_report_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_report_report_no_key ON public.iqc_report USING btree (report_no);


--
-- Name: iqc_template_material_template_id_material_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX iqc_template_material_template_id_material_id_key ON public.iqc_template_material USING btree (template_id, material_id);


--
-- Name: material_material_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX material_material_code_key ON public.material USING btree (material_code);


--
-- Name: material_requirement_req_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX material_requirement_req_no_key ON public.material_requirement USING btree (req_no);


--
-- Name: material_requirement_wo_section_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX material_requirement_wo_section_uniq ON public.material_requirement USING btree (work_order_id, work_section) WHERE ((status)::text <> 'cancelled'::text);


--
-- Name: material_substitution_mat_sub_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX material_substitution_mat_sub_key ON public.material_substitution USING btree (material_id, substitute_material_id);


--
-- Name: mrb_review_mrb_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mrb_review_mrb_no_key ON public.mrb_review USING btree (mrb_no);


--
-- Name: over_picking_order_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX over_picking_order_no_key ON public.over_picking_order USING btree (order_no);


--
-- Name: picking_order_picking_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX picking_order_picking_no_key ON public.picking_order USING btree (picking_no);


--
-- Name: production_return_return_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX production_return_return_no_key ON public.production_return USING btree (return_no);


--
-- Name: receipt_order_receipt_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX receipt_order_receipt_no_key ON public.receipt_order USING btree (receipt_no);


--
-- Name: role_user_role_code_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX role_user_role_code_user_id_key ON public.role_user USING btree (role_code, user_id);


--
-- Name: stock_take_order_take_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stock_take_order_take_no_key ON public.stock_take_order USING btree (take_no);


--
-- Name: stock_transfer_transfer_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stock_transfer_transfer_no_key ON public.stock_transfer USING btree (transfer_no);


--
-- Name: supplier_debt_settlement_debt_receipt_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_debt_settlement_debt_receipt_uniq ON public.supplier_debt_settlement USING btree (debt_id, receipt_id);


--
-- Name: supplier_material_supplier_id_material_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_material_supplier_id_material_id_key ON public.supplier_material USING btree (supplier_id, material_id);


--
-- Name: supplier_supplier_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_supplier_code_key ON public.supplier USING btree (supplier_code);


--
-- Name: sys_account_account_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sys_account_account_key ON public.sys_account USING btree (account);


--
-- Name: sys_param_param_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sys_param_param_key_key ON public.sys_param USING btree (param_key);


--
-- Name: sys_role_role_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sys_role_role_code_key ON public.sys_role USING btree (role_code);


--
-- Name: uq_dmt_move_no; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_dmt_move_no ON public.defective_move_task USING btree (move_no);


--
-- Name: uq_mdl_disp_receipt; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mdl_disp_receipt ON public.mrb_disposition_label USING btree (disposition_id, receipt_id);


--
-- Name: uq_mrb_cc_mrb_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_mrb_cc_mrb_user ON public.mrb_cc USING btree (mrb_id, ((user_id).user_id));


--
-- Name: uq_picking_reel; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_picking_reel ON public.picking_reel USING btree (picking_id, reel_no);


--
-- Name: warehouse_location_location_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX warehouse_location_location_code_key ON public.warehouse_location USING btree (location_code);


--
-- Name: warehouse_wh_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX warehouse_wh_code_key ON public.warehouse USING btree (wh_code);


--
-- Name: work_order_work_order_no_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX work_order_work_order_no_key ON public.work_order USING btree (work_order_no);


--
-- Name: bom_item bom_item_bom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_item
    ADD CONSTRAINT bom_item_bom_id_fkey FOREIGN KEY (bom_id) REFERENCES public.bom(id) ON DELETE CASCADE;


--
-- Name: inventory inventory_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.warehouse_location(id);


--
-- Name: inventory inventory_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id);


--
-- Name: iqc_inspection_draft iqc_inspection_draft_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_draft
    ADD CONSTRAINT iqc_inspection_draft_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.iqc_lot(id) ON DELETE CASCADE;


--
-- Name: iqc_inspection_item iqc_inspection_item_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_item
    ADD CONSTRAINT iqc_inspection_item_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id);


--
-- Name: iqc_inspection_record iqc_inspection_record_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_record
    ADD CONSTRAINT iqc_inspection_record_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.iqc_inspection_item(id);


--
-- Name: iqc_inspection_record iqc_inspection_record_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_record
    ADD CONSTRAINT iqc_inspection_record_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.iqc_lot(id);


--
-- Name: iqc_inspection_record iqc_inspection_record_template_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_record
    ADD CONSTRAINT iqc_inspection_record_template_item_id_fkey FOREIGN KEY (template_item_id) REFERENCES public.iqc_template_item(id);


--
-- Name: iqc_inspection_strictness iqc_inspection_strictness_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_inspection_strictness
    ADD CONSTRAINT iqc_inspection_strictness_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id) ON DELETE CASCADE;


--
-- Name: iqc_lot iqc_lot_last_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_lot
    ADD CONSTRAINT iqc_lot_last_template_id_fkey FOREIGN KEY (last_template_id) REFERENCES public.iqc_template(id);


--
-- Name: iqc_lot iqc_lot_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_lot
    ADD CONSTRAINT iqc_lot_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id);


--
-- Name: iqc_lot_receipt iqc_lot_receipt_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_lot_receipt
    ADD CONSTRAINT iqc_lot_receipt_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.iqc_lot(id) ON DELETE CASCADE;


--
-- Name: iqc_lot_receipt iqc_lot_receipt_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_lot_receipt
    ADD CONSTRAINT iqc_lot_receipt_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.receipt_order(id) ON DELETE CASCADE;


--
-- Name: iqc_lot iqc_lot_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_lot
    ADD CONSTRAINT iqc_lot_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.iqc_template(id);


--
-- Name: iqc_report iqc_report_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_report
    ADD CONSTRAINT iqc_report_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.iqc_lot(id);


--
-- Name: iqc_strictness_transfer_log iqc_strictness_transfer_log_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_strictness_transfer_log
    ADD CONSTRAINT iqc_strictness_transfer_log_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id) ON DELETE CASCADE;


--
-- Name: iqc_template_item iqc_template_item_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_template_item
    ADD CONSTRAINT iqc_template_item_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.iqc_template(id) ON DELETE CASCADE;


--
-- Name: iqc_template_material iqc_template_material_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_template_material
    ADD CONSTRAINT iqc_template_material_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id) ON DELETE CASCADE;


--
-- Name: iqc_template_material iqc_template_material_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iqc_template_material
    ADD CONSTRAINT iqc_template_material_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.iqc_template(id) ON DELETE CASCADE;


--
-- Name: material_requirement_item material_requirement_item_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_requirement_item
    ADD CONSTRAINT material_requirement_item_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id);


--
-- Name: material_requirement_item material_requirement_item_req_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_requirement_item
    ADD CONSTRAINT material_requirement_item_req_id_fkey FOREIGN KEY (req_id) REFERENCES public.material_requirement(id) ON DELETE CASCADE;


--
-- Name: material_requirement material_requirement_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_requirement
    ADD CONSTRAINT material_requirement_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_order(id);


--
-- Name: material_substitution material_substitution_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_substitution
    ADD CONSTRAINT material_substitution_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id);


--
-- Name: material_substitution material_substitution_substitute_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_substitution
    ADD CONSTRAINT material_substitution_substitute_material_id_fkey FOREIGN KEY (substitute_material_id) REFERENCES public.material(id);


--
-- Name: mrb_cc mrb_cc_mrb_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_cc
    ADD CONSTRAINT mrb_cc_mrb_id_fkey FOREIGN KEY (mrb_id) REFERENCES public.mrb_review(id) ON DELETE CASCADE;


--
-- Name: mrb_disposition_label mrb_disposition_label_disp_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_disposition_label
    ADD CONSTRAINT mrb_disposition_label_disp_id_fkey FOREIGN KEY (disposition_id) REFERENCES public.mrb_disposition(id) ON DELETE CASCADE;


--
-- Name: mrb_disposition_label mrb_disposition_label_mrb_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_disposition_label
    ADD CONSTRAINT mrb_disposition_label_mrb_id_fkey FOREIGN KEY (mrb_id) REFERENCES public.mrb_review(id) ON DELETE CASCADE;


--
-- Name: mrb_review mrb_review_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_review
    ADD CONSTRAINT mrb_review_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.iqc_lot(id);


--
-- Name: mrb_review mrb_review_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_review
    ADD CONSTRAINT mrb_review_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id);


--
-- Name: mrb_review mrb_review_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_review
    ADD CONSTRAINT mrb_review_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier(id);


--
-- Name: mrb_reviewer mrb_reviewer_mrb_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mrb_reviewer
    ADD CONSTRAINT mrb_reviewer_mrb_id_fkey FOREIGN KEY (mrb_id) REFERENCES public.mrb_review(id) ON DELETE CASCADE;


--
-- Name: over_picking_item over_picking_item_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.over_picking_item
    ADD CONSTRAINT over_picking_item_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.over_picking_order(id) ON DELETE CASCADE;


--
-- Name: over_picking_order over_picking_order_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.over_picking_order
    ADD CONSTRAINT over_picking_order_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_order(id);


--
-- Name: picking_order_item picking_order_item_picking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picking_order_item
    ADD CONSTRAINT picking_order_item_picking_id_fkey FOREIGN KEY (picking_id) REFERENCES public.picking_order(id) ON DELETE CASCADE;


--
-- Name: picking_order picking_order_req_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picking_order
    ADD CONSTRAINT picking_order_req_id_fkey FOREIGN KEY (req_id) REFERENCES public.material_requirement(id);


--
-- Name: picking_order picking_order_work_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.picking_order
    ADD CONSTRAINT picking_order_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES public.work_order(id);


--
-- Name: production_return_iqc production_return_iqc_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_return_iqc
    ADD CONSTRAINT production_return_iqc_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.production_return(id) ON DELETE CASCADE;


--
-- Name: production_return_label production_return_label_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_return_label
    ADD CONSTRAINT production_return_label_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.production_return(id) ON DELETE CASCADE;


--
-- Name: receipt_order receipt_order_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_order
    ADD CONSTRAINT receipt_order_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.warehouse_location(id);


--
-- Name: receipt_order receipt_order_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_order
    ADD CONSTRAINT receipt_order_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id);


--
-- Name: stock_take_item stock_take_item_take_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_take_item
    ADD CONSTRAINT stock_take_item_take_id_fkey FOREIGN KEY (take_id) REFERENCES public.stock_take_order(id) ON DELETE CASCADE;


--
-- Name: stock_take_log stock_take_log_take_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_take_log
    ADD CONSTRAINT stock_take_log_take_id_fkey FOREIGN KEY (take_id) REFERENCES public.stock_take_order(id) ON DELETE CASCADE;


--
-- Name: stock_transfer stock_transfer_from_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.warehouse_location(id);


--
-- Name: stock_transfer stock_transfer_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id);


--
-- Name: stock_transfer stock_transfer_to_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.warehouse_location(id);


--
-- Name: supplier_debt_settlement supplier_debt_settlement_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_debt_settlement
    ADD CONSTRAINT supplier_debt_settlement_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES public.supplier_debt(id);


--
-- Name: supplier_material supplier_material_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_material
    ADD CONSTRAINT supplier_material_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.material(id);


--
-- Name: supplier_material supplier_material_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_material
    ADD CONSTRAINT supplier_material_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.supplier(id);


--
-- Name: supplier_return_item supplier_return_item_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_return_item
    ADD CONSTRAINT supplier_return_item_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.supplier_return_order(id) ON DELETE CASCADE;


--
-- Name: warehouse_location warehouse_location_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouse_location
    ADD CONSTRAINT warehouse_location_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouse(id);


--
-- Name: work_order work_order_bom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order
    ADD CONSTRAINT work_order_bom_id_fkey FOREIGN KEY (bom_id) REFERENCES public.bom(id);


--
-- Name: work_order work_order_parent_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_order
    ADD CONSTRAINT work_order_parent_order_id_fkey FOREIGN KEY (parent_order_id) REFERENCES public.work_order(id);


--
-- PostgreSQL database dump complete
--

\unrestrict eIlwfexFGZPgZOf2gPzUe2kUDydVyywtpLgq6rJ2MRs4PkFu1E63kU9disDmaeV

