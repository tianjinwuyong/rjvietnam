-- ============================================================
-- 部署环境自愈配置（2026-10-16）
--
-- 背景：
--   mrb_disposition_tables.sql 把 good_warehouse_code / defective_warehouse_code
--   写死成 WL001 / NG01（那是另一套部署环境的编码）。本库 warehouse 只有 01–05，
--   且 wh_type 全为 normal，**不存在 defective 仓**：
--     · good_warehouse_code=WL001 解析不到 → 回落 wh_type='normal' 命中 01，尚可用；
--     · defective_warehouse_code=NG01 解析不到 → 回落查 wh_type='defective' 得 0 行
--       → iqc.service.ts getDefectiveWarehouseLocation() 抛 NotFoundException。
--   而 IQC 不合格审批（reviewReport -> finalizeLotInventory）已不再吞异常，
--   → 「IQC 判不合格」整批回滚、库存无法流转到不良品仓。同源还有 mrb 特采入库。
--
-- 本文件做三件事（用户已决策「建 NG01 不良品仓」）：
--   1) 全新空库兜底：仅当 warehouse 表【完全为空】（真正的全新库）时，
--      建一个默认良品仓（01）+ 其 active 库位，并 RAISE WARNING 提示操作员；
--   2) 建 wh_code='NG01' 的不良品仓（wh_type='defective'）+ 其 active 库位；
--   3) 把两个系统参数改成**数据驱动**：指向 warehouse 中真实存在的仓库编码，
--      换部署环境也自洽（不再依赖 WL001/NG01 这类环境专有值）。
--
-- ★ 取舍（重要）——「免安装版开箱可用」 vs「不掩盖主数据配置错误」：
--   默认良品仓的守卫被**刻意收紧**为「warehouse 表完全为空」。
--   · 好处：真正的全新库（整包首次部署）自动具备可解析的良/不良品仓，开箱可用。
--   · 代价：若某环境**本应有良品仓、却被人误删或漏配**（warehouse 非空但无 normal 仓），
--     本脚本**不会**静默新建 '01'，参数也保持不可解析——这是**期望行为**：
--     交由 iqc.service.ts findWarehouseIdByParamOrType() 抛 NotFoundException，
--     把真实的主数据错误**暴露**出来，而不是被兜底掩盖。
--   · 注意：正因守卫是「表为空」，也天然规避了「'01' 已存在但 wh_type 非 normal」
--     时 INSERT 撞 warehouse_wh_code_key 唯一键的风险（表非空即不进入该分支）。
--
-- 幂等：全部 EXISTS/NOT EXISTS 守卫；重复执行不报错、不重复建对象、不破坏已有数据。
--
-- ⚠️ 全新空库安全性（重要）：
--   本脚本必须能在「全新空库」上成功执行。空库在 init-db 的 [3/5] 阶段执行本脚本，
--   此时 sys_param 里可能只有 mrb 脚本写入、却指向不存在仓库（如 WL001）的旧值。
--   「数据驱动」的 UPDATE 若把这些值改写成子查询结果，而子查询查不到仓库会返回
--   NULL，触发 sys_param.param_value 的 NOT NULL 约束而使整脚本失败。
--   因此：所有改写/插入都加 EXISTS/来源行守卫，解析不到真实仓库时【保持原值不写】。
--
-- ⚠️ 执行顺序敏感：必须在 mrb_disposition_tables.sql【之后】执行，
--    否则会被它把参数再次改回 WL001/NG01（init-db.ts 已把它排在该脚本之后）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 全新空库兜底：默认良品仓 + 其库位（仅当 warehouse 表完全为空时）
--    必须在建 NG01 之前执行，否则 NG01 落库后「表为空」不再成立。
-- -----------------------------------------------------------------
DO $$
DECLARE
  v_wh_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM warehouse) THEN
    INSERT INTO warehouse (wh_code, wh_name_zh, wh_name_vi, wh_name_en, wh_type, status, description)
    VALUES ('01', '良品仓', 'Kho hàng tốt', 'Good Warehouse', 'normal', 'active',
            '部署自愈脚本自动创建：全新库默认良品仓')
    RETURNING id INTO v_wh_id;

    INSERT INTO warehouse_location
      (location_code, warehouse_id, area_code, shelf_code, layer_code, position_code, location_type, status, description)
    VALUES
      ('01-A-01-00-0001', v_wh_id, 'A', '01', '00', '0001', 'good', 'active', '部署自愈脚本自动创建'),
      ('01-A-01-00-0002', v_wh_id, 'A', '01', '00', '0002', 'good', 'active', '部署自愈脚本自动创建');

    RAISE WARNING '[provision-deploy-config] 检测到【全新空库】：已自动创建默认良品仓 wh_code=01 (良品仓) 及其 2 个 good 库位。请按实际主数据核对/调整。';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. 不良品仓 NG01（不存在才建）
-- ------------------------------------------------------------
INSERT INTO warehouse (wh_code, wh_name_zh, wh_name_vi, wh_name_en, wh_type, status, description)
SELECT 'NG01', '不良品仓', 'Kho hàng lỗi', 'Defective Warehouse', 'defective', 'active',
       '部署自愈脚本自动创建：IQC 不合格 / MRB 退货隔离仓'
WHERE NOT EXISTS (SELECT 1 FROM warehouse WHERE wh_code = 'NG01');

-- ------------------------------------------------------------
-- 3. NG01 的 active 库位（与 mrb_disposition_tables.sql 的编码保持一致）
--    即便 mrb 脚本先跑时 NG01 还不存在（当时插 0 行），这里也能补出。
-- ------------------------------------------------------------
INSERT INTO warehouse_location
  (location_code, warehouse_id, area_code, shelf_code, layer_code, position_code, location_type, status, description)
SELECT v.location_code, w.id, v.area_code, v.shelf_code, v.layer_code, v.position_code,
       'defective', 'active', '部署自愈脚本自动创建'
FROM warehouse w
CROSS JOIN (VALUES
  ('NG01-A-01-00-0001', 'A', '01', '00', '0001'),
  ('NG01-A-01-00-0002', 'A', '01', '00', '0002')
) AS v(location_code, area_code, shelf_code, layer_code, position_code)
WHERE w.wh_code = 'NG01'
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_location l WHERE l.location_code = v.location_code
  );

-- ------------------------------------------------------------
-- 4. 系统参数改为数据驱动：仅在「当前值解析不到真实仓库」时才纠正，
--    不覆盖人工配置的有效值；且**能解析到真实仓库时才写**（避免写入 NULL）。
--    ⚠️ 这里不新增任何兜底：若环境有仓但无 normal/defective 仓，参数保持不可解析，
--       由 iqc.service.ts findWarehouseIdByParamOrType() 抛 NotFoundException 暴露问题。
-- ------------------------------------------------------------
UPDATE sys_param
SET param_value = (
  SELECT wh_code FROM warehouse WHERE wh_type = 'normal' AND status = 'active' ORDER BY wh_code LIMIT 1
)
WHERE param_key = 'good_warehouse_code'
  AND EXISTS (SELECT 1 FROM warehouse WHERE wh_type = 'normal' AND status = 'active')
  AND (param_value IS NULL
       OR NOT EXISTS (SELECT 1 FROM warehouse w WHERE w.wh_code = sys_param.param_value));

UPDATE sys_param
SET param_value = (
  SELECT wh_code FROM warehouse WHERE wh_type = 'defective' AND status = 'active' ORDER BY wh_code LIMIT 1
)
WHERE param_key = 'defective_warehouse_code'
  AND EXISTS (SELECT 1 FROM warehouse WHERE wh_type = 'defective' AND status = 'active')
  AND (param_value IS NULL
       OR NOT EXISTS (SELECT 1 FROM warehouse w WHERE w.wh_code = sys_param.param_value));

-- ------------------------------------------------------------
-- 5. 参数缺失时补插（数据驱动取值）
--    仅在能从 warehouse 解析到真实编码时插入，避免 NULL 触发 NOT NULL 约束。
-- ------------------------------------------------------------
INSERT INTO sys_param (param_key, param_value, description)
SELECT 'good_warehouse_code', w.wh_code, '良品仓库编码'
FROM warehouse w
WHERE w.wh_type = 'normal' AND w.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM sys_param WHERE param_key = 'good_warehouse_code')
ORDER BY w.wh_code
LIMIT 1;

INSERT INTO sys_param (param_key, param_value, description)
SELECT 'defective_warehouse_code', w.wh_code, '不良品仓库编码'
FROM warehouse w
WHERE w.wh_type = 'defective' AND w.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM sys_param WHERE param_key = 'defective_warehouse_code')
ORDER BY w.wh_code
LIMIT 1;
