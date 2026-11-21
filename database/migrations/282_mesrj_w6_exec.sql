-- MES-ruijing 移植 W6a：过站引擎（exec 域）运行期演化列
-- 来源：源系统在 api/exec.py 里用 _ensure_route_change_cols / _ensure_mo_actual_cols
--       在运行时给老库补的列；这里一次性固化。
-- 说明：md_station.is_sampling / deny_manual_pass（源 _ensure_sampling_col /
--       _ensure_deny_manual_col 的目标列）在本库建 md_station 时已带上，无需再加；
--       ord_mo.actual_start 已由迁移 278 补过（勿重复），这里只补 actual_end。

-- ── prd_route_change：临时路线有效期（_ensure_route_change_cols）──
ALTER TABLE prd_route_change ADD COLUMN IF NOT EXISTS is_temp     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prd_route_change ADD COLUMN IF NOT EXISTS expire_at   TEXT    NOT NULL DEFAULT '';
ALTER TABLE prd_route_change ADD COLUMN IF NOT EXISTS restored_at TEXT    NOT NULL DEFAULT '';

-- ── ord_mo：实际完工时间（_ensure_mo_actual_cols）──
ALTER TABLE ord_mo ADD COLUMN IF NOT EXISTS actual_end TEXT NOT NULL DEFAULT '';

-- ── prd_pass：员工工号 + 实际扫的工位（换产线生产时与 station_code 不同）──
ALTER TABLE prd_pass ADD COLUMN IF NOT EXISTS operator_no     TEXT NOT NULL DEFAULT '';
ALTER TABLE prd_pass ADD COLUMN IF NOT EXISTS actual_station  TEXT NOT NULL DEFAULT '';

-- ── prd_defect_rec：员工工号 ──
ALTER TABLE prd_defect_rec ADD COLUMN IF NOT EXISTS operator_no TEXT NOT NULL DEFAULT '';

-- ── prd_sn：建档备注（AOI 设备数据自动建档留痕）──
ALTER TABLE prd_sn ADD COLUMN IF NOT EXISTS sn_note TEXT NOT NULL DEFAULT '';
