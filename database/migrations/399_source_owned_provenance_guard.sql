-- =============================================================================
-- 399: 源数据所有权 —— provenance 标记 + 列级防写触发器（无重复库方案）
-- =============================================================================
-- 两条要求（2026-11-23，用户拍板）：
--   ① SMT 库里不要有源系统的重复数据库 → ext_wms_src/ext_oa_src 改为
--      「瞬态管道」：同步→按 provenance 摄取→DROP SCHEMA，常态不存在。
--      「哪些行来自运行中的 WMS/OA」记在业务行自己身上（data_provenance），
--      对账直接 源↔业务表，不再靠一张重复表。
--   ② SMT 里的逻辑不得与运行中的 WMS/OA 冲突 → 列级所有权：
--      源拥有的列（收货/IQC/审批等事实）在 SMT 侧只读，改动被触发器拒绝
--      （42501），除非会话标志 app.source_sync='on'（只有 live-converge
--      摄取事务设置它，见 live-sync.js withSourceSyncTx）。
--      SMT 自己拥有的列照常可写：上架库位(storage_location_id)、货架格、
--      lot_status、预留、QMS disposition/remarks、MES 侧发料 —— 这些是
--      SMT 的操作事实，源系统不写它们，所以不冲突。
--      DELETE 对源拥有行一律拒绝（不变量②：无硬删）。
--      业务操作请去运行中的 WMS/OA 做，结果每 5 分钟同步进来。
--
-- 触发器参数 = 源拥有的列清单（'*' = 整行只读）。INSERT 不受限：
-- 新行业务侧随便建（provenance NULL 的行归 SMT 所有）。
-- rjvn_* 镜像不加触发器：309 投影从 canonical 侧写它们；镜像的只读由
-- 路由层 409 保证（rjvn-iqc/picking/inventory/receipt 的 mutation 端点）。
-- =============================================================================

ALTER TABLE public.material_lots           ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE public.iqc_inspections         ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE public.inventory_transactions  ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE public.wms_picking_orders      ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE oa.flow_instance               ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE oa.flow_definition             ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE oa.flow_task                   ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE oa.flow_log                    ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE oa.org_user                    ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE oa.org_department              ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE oa.doc_system                  ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE oa.attachment                  ADD COLUMN IF NOT EXISTS data_provenance text;
ALTER TABLE oa.doc_change_log              ADD COLUMN IF NOT EXISTS data_provenance text;

COMMENT ON COLUMN public.material_lots.data_provenance IS
  '来源标记: wms-rjvn/oa-portal=运行中的源系统拥有该行的源事实列,SMT 侧这些列只读(触发器强制);NULL=SMT 本地创建';

CREATE OR REPLACE FUNCTION public.reject_source_owned_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prov text;
  c text;
BEGIN
  IF coalesce(current_setting('app.source_sync', true), '') = 'on' THEN
    RETURN NEW;  -- live-converge 摄取事务专用标志(SET LOCAL,单事务)
  END IF;
  IF TG_TABLE_NAME = 'flow_instance' THEN
    -- 260 张 graft 实例 biz_system 为 NULL,靠 data_provenance 标记;
    -- live-sync 新建的 11 张已有 biz_system。
    prov := COALESCE(OLD.biz_system, OLD.data_provenance);
  ELSE
    prov := OLD.data_provenance;
  END IF;
  IF prov IS NULL THEN
    RETURN NEW;  -- SMT 本地行,随便写
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '该行属于运行中的源系统(%)。SMT 禁止删除源数据 —— 请在源系统中作废/关闭,同步会带过来。', prov
      USING ERRCODE = '42501';
  END IF;
  FOREACH c IN ARRAY TG_ARGV LOOP
    IF c = '*' THEN
      RAISE EXCEPTION '该行属于运行中的源系统(%)且整行只读。请在源系统中操作,结果每 5 分钟自动同步进来。', prov
        USING ERRCODE = '42501';
    END IF;
    IF to_jsonb(OLD) ->> c IS DISTINCT FROM to_jsonb(NEW) ->> c THEN
      RAISE EXCEPTION '列 % 是运行中源系统(%)拥有的事实,SMT 侧只读 —— 请在源系统中修改,同步每 5 分钟生效。SMT 自有列(库位/状态/disposition 等)不受限。', c, prov
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- (schema, table, 源拥有列) —— '*' 表示整行只读。列清单与真实列取交集
-- (源 schema 漂移不得让迁移失败);参数逐个传给触发器(TG_ARGV 是 text[],
-- 整个数组用 %L 传会变成单个字符串字面量,FOREACH 就废了)。
DO $$
DECLARE
  g record;
  c text;
  real_cols text[];
  arglist text;
BEGIN
  FOR g IN SELECT * FROM (VALUES
    ('public','material_lots',          ARRAY['lot_no','material_id','supplier_id','received_qty','iqc_status','received_at']),
    ('public','iqc_inspections',        ARRAY['inspection_no','material_lot_id','result','sampled_qty','inspected_qty','operator_id','occurred_at']),
    ('public','inventory_transactions', ARRAY['tx_no','action','material_lot_id','qty','occurred_at','voided']),
    ('public','wms_picking_orders',     ARRAY['picking_no','status','total_qty','work_order_no','work_section','approval_time','approval_remark','mes_issue_no','is_supplement','remark']),
    ('oa','flow_instance',              ARRAY['instance_no','definition_id','title','form_data','status','applicant_id','organization','current_index','submitted_at','finished_at','closed_loop']),
    ('oa','flow_definition',            ARRAY['*']),
    ('oa','flow_task',                  ARRAY['instance_id','node_index','assignee_id','status','action','due_at']),
    ('oa','flow_log',                   ARRAY['*']),
    ('oa','org_user',                   ARRAY['*']),
    ('oa','org_department',             ARRAY['*']),
    ('oa','doc_system',                 ARRAY['code','title','level','category','status','current_version','owner_dept_id','security_level','issue_date','next_review_date']),
    ('oa','attachment',                 ARRAY['file_name','file_path','file_size','instance_id']),
    ('oa','doc_change_log',             ARRAY['*'])
  ) AS v(s, t, cols) LOOP
    CONTINUE WHEN to_regclass(g.s || '.' || g.t) IS NULL;
    IF g.cols = ARRAY['*'] THEN
      arglist := '''*''';
    ELSE
      SELECT array_agg(k) INTO real_cols
        FROM unnest(g.cols) k
        WHERE exists (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = g.s AND table_name = g.t AND column_name = k);
      CONTINUE WHEN real_cols IS NULL OR cardinality(real_cols) = 0;
      arglist := (SELECT string_agg('''' || k || '''', ', ') FROM unnest(real_cols) k);
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_reject_source_owned ON %I.%I', g.s, g.t);
    EXECUTE format(
      'CREATE TRIGGER trg_reject_source_owned BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.reject_source_owned_mutation(%s)',
      g.s, g.t, arglist);
  END LOOP;
END $$;

DO $$
DECLARE
  app_role text := coalesce(nullif(current_setting('smt.app_role', true), ''), 'smt_factory');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE NOTICE 'role % missing; skipping ownership transfer', app_role;
    RETURN;
  END IF;
  EXECUTE format('ALTER FUNCTION public.reject_source_owned_mutation() OWNER TO %I', app_role);
END $$;
