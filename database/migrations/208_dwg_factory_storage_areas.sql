-- Storage areas normalized from 新工厂布局图 WMS.dwg into the shared metre-based plant frame.
CREATE TABLE IF NOT EXISTS wms_floor_storage_areas (
  area_code varchar(40) PRIMARY KEY,
  area_name varchar(120) NOT NULL,
  area_type varchar(40) NOT NULL,
  polygon jsonb NOT NULL,
  capacity integer NOT NULL DEFAULT 0,
  occupied integer NOT NULL DEFAULT 0,
  status varchar(24) NOT NULL DEFAULT 'AVAILABLE',
  source_layout varchar(160) NOT NULL DEFAULT '新工厂布局图 WMS.dwg',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO wms_floor_storage_areas
  (area_code, area_name, area_type, polygon, capacity, occupied, status, source_layout)
VALUES
  ('FL-RECV-01', '来料待检区', 'RECEIVING', '[[-18.87,-19.16],[-10.37,-19.16],[-10.37,-12.16],[-18.87,-12.16]]', 24, 0, 'AVAILABLE', '新工厂布局图 WMS.dwg'),
  ('FL-IQC-01', 'IQC 检验区', 'IQC_HOLD', '[[-10.11,-19.19],[0.39,-19.19],[0.39,-12.19],[-10.11,-12.19]]', 20, 0, 'AVAILABLE', '新工厂布局图 WMS.dwg'),
  ('FL-IQC-PASS', 'IQC 合格区', 'IQC_RELEASED', '[[-9.2,-23.0],[-3.0,-23.0],[-3.0,-20.0],[-9.2,-20.0]]', 16, 0, 'AVAILABLE', '新工厂布局图 WMS.dwg'),
  ('FL-IQC-NG', 'IQC 不合格区', 'QUARANTINE', '[[-3.0,-23.0],[2.5,-23.0],[2.5,-20.0],[-3.0,-20.0]]', 12, 0, 'HOLD', '新工厂布局图 WMS.dwg'),
  ('FL-NG-01', '不良品暂放区域', 'QUARANTINE', '[[-24.5,21.8],[-17.5,21.8],[-17.5,27.7],[-24.5,27.7]]', 12, 0, 'HOLD', '新工厂布局图 WMS.dwg'),
  ('FL-FG-01', '成品暂存区', 'FINISHED_GOODS', '[[9.6,15.9],[21.6,15.9],[21.6,20.9],[9.6,20.9]]', 20, 0, 'AVAILABLE', '新工厂布局图 WMS.dwg'),
  ('FL-TOOL-01', '工具存储区', 'TOOL_STORAGE', '[[-32.0,17.5],[-25.0,17.5],[-25.0,23.5],[-32.0,23.5]]', 20, 0, 'AVAILABLE', '新工厂布局图 WMS.dwg'),
  ('FL-LINE-04', 'L004 线边配送暂存区', 'LINE_SIDE', '[[-33.0,5.8],[-26.0,5.8],[-26.0,12.3],[-33.0,12.3]]', 16, 0, 'AVAILABLE', '新工厂布局图 WMS.dwg')
ON CONFLICT (area_code) DO UPDATE SET
  area_name=EXCLUDED.area_name, area_type=EXCLUDED.area_type, polygon=EXCLUDED.polygon,
  capacity=EXCLUDED.capacity, status=EXCLUDED.status, source_layout=EXCLUDED.source_layout,
  updated_at=now();
