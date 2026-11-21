-- 266: process-domain classification for EPS18R1G BOM (bom_id=2).
-- 工段 per product flow of a power adapter:
--   SMT(贴片): chip R/C/D/IC/MOS + PCBs        (R0204, R0210-R0217, R0222)
--   AUTO(AI插件): transformer/inductor/opto/ECAP/X2Y1/varistor/thermistor/fuse
--   MANUAL(插件焊/组装): housing/solder/flux/DC wire
--   PACKAGING: boxes/bags/foam/straps/tapes/labels
UPDATE bom_lines bl
   SET process_domain = CASE
     WHEN m.code IN ('R0204-01001','R0204-01002')
        OR m.code LIKE 'R0210-%' OR m.code LIKE 'R0211-%' OR m.code LIKE 'R0212-%'
        OR m.code LIKE 'R0213-%' OR m.code LIKE 'R0214-%' OR m.code LIKE 'R0215-%'
        OR m.code LIKE 'R0216-%' OR m.code LIKE 'R0217-%' OR m.code LIKE 'R0222-%'
       THEN 'SMT'
     WHEN m.code IN ('R0203-01001','R0206-01001','R0207-01001','R0208-01001',
                     'R0209-01001','R0209-01002','R0218-01001','R0219-01001',
                     'R0220-01001','R0220-01002','R0221-01001')
       THEN 'AUTO'
     WHEN m.code IN ('R0101-01001','R0102-01001','R0103-01001','R0104-01001',
                     'R0105-01001','R0106-01001','R0108-01001','R0110-01002',
                     'R0201-01001','R0202-01001')
       THEN 'MANUAL'
     WHEN m.code IN ('R0111-01001','R0112-01001','R0301-01002','R0302-01001',
                     'R0303-01001','R0304-01001','R0305-01001',
                     'R0306-01001','R0306-01002','R0307-01001',
                     'R0308-01001','R0308-01002','R0308-01003')
       THEN 'PACKAGING'
     ELSE process_domain END,
       process_stage = CASE
     WHEN m.code IN ('R0204-01001','R0204-01002')
        OR m.code LIKE 'R0210-%' OR m.code LIKE 'R0211-%' OR m.code LIKE 'R0212-%'
        OR m.code LIKE 'R0213-%' OR m.code LIKE 'R0214-%' OR m.code LIKE 'R0215-%'
        OR m.code LIKE 'R0216-%' OR m.code LIKE 'R0217-%' OR m.code LIKE 'R0222-%'
       THEN '贴片段'
     WHEN m.code IN ('R0203-01001','R0206-01001','R0207-01001','R0208-01001',
                     'R0209-01001','R0209-01002','R0218-01001','R0219-01001',
                     'R0220-01001','R0220-01002','R0221-01001')
       THEN 'AI/组装段'
     WHEN m.code IN ('R0101-01001','R0102-01001','R0103-01001','R0104-01001',
                     'R0105-01001','R0106-01001','R0108-01001','R0110-01002',
                     'R0201-01001','R0202-01001')
       THEN '插件段'
     WHEN m.code IN ('R0111-01001','R0112-01001','R0301-01002','R0302-01001',
                     'R0303-01001','R0304-01001','R0305-01001',
                     'R0306-01001','R0306-01002','R0307-01001',
                     'R0308-01001','R0308-01002','R0308-01003')
       THEN '包装段'
     ELSE process_stage END
   FROM materials m
  WHERE m.id = bl.material_id AND bl.bom_id = 2;
