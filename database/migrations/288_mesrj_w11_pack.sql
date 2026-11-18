-- W11: 外箱绑码（pack）—— prd_box 补 line_code
--
-- 源：D:\rj\repos\MES-ruijing\api\pack.py 的 _ensure_box_line_col()（运行时 ALTER TABLE）
-- 场景（2026-11-02 现场加急）：同一张工单同时开 2 条包装线装箱。
--   原来「开箱」只按工单找未封箱的箱 → 两条线拿到**同一个箱**：
--   两只物理箱子记成一只、封箱只打印一张外箱标签、数量也对不上。
--   所以给箱加 line_code：同一张单在每条线各有各的箱和板。
--
-- PG 方言：与既有 mesrj 表一致（text + now() 默认值）。

ALTER TABLE prd_box ADD COLUMN IF NOT EXISTS line_code text NOT NULL DEFAULT '';

-- 「该工单当前装箱中的箱」是高频查询（按工单 + 状态 + 产线定位）
CREATE INDEX IF NOT EXISTS ix_prd_box_mo_status ON prd_box(mo_no, status);
CREATE INDEX IF NOT EXISTS ix_prd_box_no ON prd_box(box_no);
