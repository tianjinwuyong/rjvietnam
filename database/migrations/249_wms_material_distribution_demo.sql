ALTER TABLE wms_fetch_packages ADD COLUMN IF NOT EXISTS source_po varchar(80);
ALTER TABLE wms_fetch_packages ADD COLUMN IF NOT EXISTS planned_delivery_at timestamptz;
ALTER TABLE wms_fetch_packages ADD COLUMN IF NOT EXISTS delivery_due_at timestamptz;
ALTER TABLE wms_fetch_packages ADD COLUMN IF NOT EXISTS priority varchar(16) NOT NULL DEFAULT 'NORMAL';

DO $$
DECLARE actor_id bigint;
BEGIN
  SELECT id INTO actor_id FROM users WHERE status='active' ORDER BY id LIMIT 1;
  IF actor_id IS NULL THEN RETURN; END IF;

  INSERT INTO requisitions(doc_no,status,work_order_code,line_code,requestor_name,notes,created_by,submitted_at,approved_at,executed_at)
  VALUES
    ('REQ-DIST-DEMO-001','EXECUTING','WO-DEMO-260901','SMT-LINE-01','PMC DEMO','配送测试：主料补给',actor_id,now()-interval '2 hours',now()-interval '90 minutes',now()-interval '30 minutes'),
    ('REQ-DIST-DEMO-002','EXECUTING','WO-DEMO-260902','SMT-LINE-02','PMC DEMO','配送测试：换线备料',actor_id,now()-interval '3 hours',now()-interval '2 hours',now()-interval '50 minutes'),
    ('REQ-DIST-DEMO-003','EXECUTING','WO-DEMO-260903','MANUAL-LINE','PMC DEMO','配送测试：紧急补料',actor_id,now()-interval '70 minutes',now()-interval '50 minutes',now()-interval '15 minutes')
  ON CONFLICT(doc_no) DO NOTHING;

  INSERT INTO requisition_lines(requisition_id,material_code,material_name_zh,unit,requested_qty,approved_qty,executed_qty,lot_no,location_code,line_status)
  SELECT r.id,v.material_code,v.material_name,'PCS',v.qty,v.qty,v.qty,v.lot_no,v.location_code,'APPROVED'
  FROM (VALUES
    ('REQ-DIST-DEMO-001','RJ-MAT-0001','贴片电阻 20K',12000::numeric,'LOT-R-260901','RM-A01-01'),
    ('REQ-DIST-DEMO-002','RJ-MAT-0002','MLCC 100nF',8000::numeric,'LOT-C-260902','RM-A02-03'),
    ('REQ-DIST-DEMO-003','RJ-MAT-0003','USB-C 连接器',1500::numeric,'LOT-J-260903','RM-B01-02')
  ) v(doc_no,material_code,material_name,qty,lot_no,location_code)
  JOIN requisitions r ON r.doc_no=v.doc_no
  WHERE NOT EXISTS(SELECT 1 FROM requisition_lines l WHERE l.requisition_id=r.id AND l.material_code=v.material_code);

  INSERT INTO wms_fetch_packages(package_no,qr_value,requisition_id,work_order_code,line_code,total_qty,contents,status,source_po,planned_delivery_at,delivery_due_at,priority)
  SELECT 'DIST-DEMO-'||right(r.doc_no,3),'WMS-DIST|DIST-DEMO-'||right(r.doc_no,3)||'|'||r.id,r.id,r.work_order_code,r.line_code,
    COALESCE(sum(l.executed_qty),0),jsonb_agg(jsonb_build_object('material_code',l.material_code,'material_name_zh',l.material_name_zh,'lot_no',l.lot_no,'executed_qty',l.executed_qty,'unit',l.unit)),
    'PREPARED','PO-DEMO-'||right(r.doc_no,3),now()+interval '15 minutes',now()+CASE right(r.doc_no,3) WHEN '003' THEN interval '30 minutes' ELSE interval '2 hours' END,
    CASE right(r.doc_no,3) WHEN '003' THEN 'URGENT' ELSE 'NORMAL' END
  FROM requisitions r JOIN requisition_lines l ON l.requisition_id=r.id
  WHERE r.doc_no LIKE 'REQ-DIST-DEMO-%'
  GROUP BY r.id
  ON CONFLICT(requisition_id) DO NOTHING;

  INSERT INTO wms_fetch_package_events(fetch_package_id,event_type,actor,detail)
  SELECT p.id,'PREPARED','SYSTEM-DEMO',jsonb_build_object('source','distribution-demo-seed') FROM wms_fetch_packages p
  WHERE p.package_no LIKE 'DIST-DEMO-%' AND NOT EXISTS(SELECT 1 FROM wms_fetch_package_events e WHERE e.fetch_package_id=p.id AND e.event_type='PREPARED');
END $$;
