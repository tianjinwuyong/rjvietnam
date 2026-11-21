-- Product stagnation tracking and scrap management tables

-- Table: product_stagnation_logs
-- Tracks PCBs that have been at a station longer than threshold
CREATE TABLE IF NOT EXISTS product_stagnation_logs (
    id BIGSERIAL PRIMARY KEY,
    pcb_serial_id BIGINT NOT NULL,
    work_order_id BIGINT,
    from_station_id BIGINT NOT NULL,
    to_station_id BIGINT,
    station_code VARCHAR(50) NOT NULL,
    line_code VARCHAR(20) NOT NULL,
    customer_code VARCHAR(50),
    product_model VARCHAR(100),
    sn VARCHAR(100) NOT NULL,
    pcb_no VARCHAR(100),
    laser_qr_date TIMESTAMPTZ,
    stagnation_minutes INTEGER DEFAULT 0,
    stagnation_level VARCHAR(20) DEFAULT 'normal', -- normal, warning, alert, critical
    status VARCHAR(20) DEFAULT 'open', -- open, resolved, escalated
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by BIGINT
);

COMMENT ON TABLE product_stagnation_logs IS 'Tracks PCBs staying at stations beyond threshold - 产品滞留追踪';

-- Table: product_scraps
-- Records scrapped products with reasons
CREATE TABLE IF NOT EXISTS product_scraps (
    id BIGSERIAL PRIMARY KEY,
    pcb_serial_id BIGINT,
    work_order_id BIGINT,
    product_id BIGINT,
    customer_code VARCHAR(50),
    product_model VARCHAR(100) NOT NULL,
    sn VARCHAR(100) NOT NULL,
    pcb_no VARCHAR(100),
    laser_qr_date TIMESTAMPTZ,
    scrap_station VARCHAR(50) NOT NULL,
    line_code VARCHAR(20) NOT NULL,
    scrap_reason_code VARCHAR(50),
    scrap_reason_detail TEXT,
    responsible_person VARCHAR(100),
    responsible_department VARCHAR(100),
    po_number VARCHAR(50),
    quantity INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    approved_by BIGINT,
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE product_scraps IS 'Records scrapped products - 产品报废';

-- Table: station_flow_records
-- Detailed PCB movement tracking between stations
CREATE TABLE IF NOT EXISTS station_flow_records (
    id BIGSERIAL PRIMARY KEY,
    pcb_serial_id BIGINT NOT NULL,
    work_order_id BIGINT,
    station_id BIGINT NOT NULL,
    station_code VARCHAR(50) NOT NULL,
    station_type VARCHAR(30),
    line_code VARCHAR(20) NOT NULL,
    event_type VARCHAR(30) NOT NULL, -- arrival, departure, inspection, hold
    sn VARCHAR(100) NOT NULL,
    pcb_no VARCHAR(100),
    laser_qr_date TIMESTAMPTZ,
    arrival_time TIMESTAMPTZ NOT NULL,
    departure_time TIMESTAMPTZ,
    dwell_minutes INTEGER,
    is_stagnation BOOLEAN DEFAULT FALSE,
    stagnation_level VARCHAR(20), -- normal, warning, alert, critical
    result VARCHAR(20), -- PASS, FAIL, HOLD
    operator_id BIGINT,
    operator_name VARCHAR(100),
    machine_code VARCHAR(50),
    next_station_id BIGINT,
    next_station_code VARCHAR(50),
    po_number VARCHAR(50),
    product_model VARCHAR(100),
    customer_code VARCHAR(50),
    quality_check_result VARCHAR(20),
    quality_check_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE station_flow_records IS 'Detailed PCB movement tracking between stations - 工位流转记录';

-- Table: stagnation_thresholds
-- Configurable thresholds for different stations
CREATE TABLE IF NOT EXISTS stagnation_thresholds (
    id BIGSERIAL PRIMARY KEY,
    station_code VARCHAR(50) NOT NULL,
    station_type VARCHAR(30),
    line_code VARCHAR(20),
    warning_minutes INTEGER DEFAULT 60,
    alert_minutes INTEGER DEFAULT 120,
    critical_minutes INTEGER DEFAULT 240,
    auto_escalate BOOLEAN DEFAULT TRUE,
    notify_roles TEXT[], -- array of role codes to notify
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(station_code)
);

COMMENT ON TABLE stagnation_thresholds IS 'Configurable thresholds for stagnation alerts - 滞留阈值配置';

-- Table: scrap_reason_codes
-- Master data for scrap reasons
CREATE TABLE IF NOT EXISTS scrap_reason_codes (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name_zh VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    name_vi VARCHAR(100),
    category VARCHAR(50), -- quality, material, process, equipment, other
    require_responsible BOOLEAN DEFAULT TRUE,
    require_detail BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE scrap_reason_codes IS 'Scrap reason codes master data - 报废原因代码';

-- Insert default thresholds for common stations
INSERT INTO stagnation_thresholds (station_code, station_type, warning_minutes, alert_minutes, critical_minutes) VALUES
('FCT', 'testing', 30, 60, 120),
('ATE', 'testing', 30, 60, 120),
('ICT', 'testing', 30, 60, 120),
('AOI', 'inspection', 20, 40, 80),
('SPI', 'inspection', 15, 30, 60),
('SMT', 'placement', 15, 30, 60),
('Ultrasonic', 'assembly', 30, 60, 120),
('Depanel', 'post_smt', 20, 40, 80),
('OQC', 'qc', 30, 60, 120)
ON CONFLICT (station_code) DO NOTHING;

-- Insert common scrap reason codes
INSERT INTO scrap_reason_codes (code, name_zh, name_en, name_vi, category) VALUES
('BALL_STRIKE', '球击测试', 'Ball strike test', 'Kiểm tra va đập', 'quality'),
('DRY_JOINT', '虚焊', 'Dry joint', 'Mối hàn khô', 'quality'),
('SHORT_CIRCUIT', '短路', 'Short circuit', 'Ngắn mạch', 'quality'),
('MISSING_COMP', '缺件', 'Missing component', 'Thiếu linh kiện', 'quality'),
('WRONG_PLACEMENT', '错件', 'Wrong placement', 'Đặt sai linh kiện', 'quality'),
('DAMAGED_PCB', 'PCB损坏', 'Damaged PCB', 'PCB hỏng', 'material'),
('ESD_DAMAGE', 'ESD损坏', 'ESD damage', 'Hư hỏng ESD', 'equipment'),
('OVERHEATING', '过热', 'Overheating', 'Quá nhiệt', 'process'),
('CONTAMINATION', '污染', 'Contamination', 'Nhiễm bẩn', 'quality'),
('OTHER', '其他', 'Other', 'Khác', 'other')
ON CONFLICT (code) DO NOTHING;
