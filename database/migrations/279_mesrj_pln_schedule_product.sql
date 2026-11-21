-- MES-ruijing W4 补充：pln_schedule.product_code（产线负载按产品×工序算 UPH 负载）
-- 源库为运行期演化列（api/plan.py /plan/load 按 p.product_code 分组），
-- 源跟踪代码未建列；此处固化，并由开单同步排产 / 排产接口写入。
ALTER TABLE pln_schedule ADD COLUMN IF NOT EXISTS product_code TEXT NOT NULL DEFAULT '';
