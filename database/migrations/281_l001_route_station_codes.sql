-- 过站引擎数据修复（station-pass / mes 差分对齐前置条件）：
--
-- 1) L001 的 station_sequences 用的是语义编码（smt_pda_loading 等，迁移 163），
--    它们既不是真实工位码也不是工位类型码：routes/station-pass.js loadRoute()
--    的两级解析（工位码精确匹配 → 工位类型码匹配）只能解析出 smt_aoi 一站，
--    整条路线 configured=false → 过站一律 ROUTE_NOT_CONFIGURED。
--    这里把它们改写为 L001 上真实存在的工位码（仅当目标工位确实挂在线上才改）。
-- 2) station_code_aliases.canonical_code 同步指向真实工位码，保持语义一致。
-- 3) process_route_steps.station_id：历史种子（003_mes_process_route_seed.sql）
--    插入时未带 station_id，按 station_type 回填到该类型第一个在用工位；
--    匹配不到的类型保持 NULL，不做猜测。

UPDATE station_sequences ss
   SET station_code = m.real_code
  FROM (VALUES
          ('smt_pda_loading',    'PDA-01'),
          ('smt_laser_marking',  'SMT-LASER-01'),
          ('smt_auto_insertion', 'AI1-01'),
          ('smt_printer',        'SMT-PRINT-01'),
          ('smt_spi',            'SMT-SPI-01'),
          ('smt_placement',      'SMT-PNP-01'),
          ('smt_aoi',            'AOI-01')
        ) AS m(old_code, real_code)
 WHERE ss.line_code = 'L001'
   AND ss.station_code = m.old_code
   AND EXISTS (
         SELECT 1
           FROM stations s
           JOIN production_lines pl ON pl.id = s.line_id
          WHERE pl.internal_code = 'L001'
            AND s.code = m.real_code);

UPDATE station_code_aliases ca
   SET canonical_code = m.real_code
  FROM (VALUES
          ('smt_pda_loading',    'PDA-01'),
          ('smt_laser_marking',  'SMT-LASER-01'),
          ('smt_auto_insertion', 'AI1-01'),
          ('smt_printer',        'SMT-PRINT-01'),
          ('smt_spi',            'SMT-SPI-01'),
          ('smt_placement',      'SMT-PNP-01'),
          ('smt_aoi',            'AOI-01')
        ) AS m(old_code, real_code)
 WHERE ca.line_code = 'L001'
   AND ca.canonical_code = m.old_code;

UPDATE process_route_steps prs
   SET station_id = (
         SELECT s.id
           FROM stations s
           JOIN station_types st ON st.id = s.station_type_id
          WHERE lower(st.code) = lower(prs.station_type)
            AND s.status IN ('running', 'idle')
          ORDER BY s.code
          LIMIT 1)
 WHERE prs.station_id IS NULL;
