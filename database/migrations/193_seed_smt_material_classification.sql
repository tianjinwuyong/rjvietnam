BEGIN;

-- Only classify from physical SMT evidence. Do not guess from a material name.
INSERT INTO material_process_classifications
  (material_id,process_domain,tracking_level,consumption_source,requires_feeder,requires_msd_control,classified_by,reason)
SELECT DISTINCT m.id,'SMT_MATERIAL','REEL_SN','NPM',TRUE,
  COALESCE(NULLIF(m.msd_level,''),'N/A')<>'N/A',
  'SYSTEM_MIGRATION','Observed in SMT feeder binding history'
FROM materials m
JOIN feeder_binding_events f ON f.material_code=m.code
ON CONFLICT(material_id) DO NOTHING;

INSERT INTO smt_material_flow_exceptions
  (exception_no,exception_type,severity,work_order_code,material_code,material_sn,source_ref,detail)
SELECT 'SMT-UNCLASS-'||f.id,'UNCLASSIFIED_MATERIAL','BLOCK',f.work_order_code,f.material_code,f.material_sn,
  'feeder_binding_events:'||f.id,to_jsonb(f)
FROM feeder_binding_events f
LEFT JOIN materials m ON m.code=f.material_code
LEFT JOIN material_process_classifications c ON c.material_id=m.id
WHERE f.status='active' AND c.material_id IS NULL
ON CONFLICT(exception_no) DO NOTHING;

INSERT INTO _migrations(filename,hash)
VALUES('193_seed_smt_material_classification.sql','seed-smt-by-physical-evidence-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
