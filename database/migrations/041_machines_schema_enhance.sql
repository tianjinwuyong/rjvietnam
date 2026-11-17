-- Machines table schema enhancement
-- Adds updated_at, machine_type lookup table, and proper FK constraint
-- Also adds an equipment category mapping for SMT machine classification

begin;

-- ============================================================
-- MACHINE TYPES LOOKUP (reference table for machine_type values)
-- ============================================================

create table if not exists machine_types (
    code varchar(40) primary key,
    name_zh varchar(120) not null,
    name_en varchar(120) not null,
    name_vi varchar(120) not null,
    category varchar(40) not null,          -- smt_core, smt_inspection, post_smt, facilities
    requires_inspection boolean not null default true,
    sort_order integer not null default 0,
    status varchar(20) not null default 'active',
    created_at timestamptz not null default now()
);

insert into machine_types (code, name_zh, name_en, name_vi, category, requires_inspection, sort_order) values
-- Core SMT line machines
('mounter', '贴片机', 'Pick & Place Mounter', 'Máy đặt linh kiện', 'smt_core', true, 10),
('printer', '锡膏印刷机', 'Solder Paste Printer', 'Máy in kem hàn', 'smt_core', true, 20),
('reflow', '回流焊', 'Reflow Oven', 'Lò reflow', 'smt_core', true, 30),
('SPI', 'SPI 锡膏检测', 'Solder Paste Inspection', 'Máy SPI', 'smt_inspection', true, 40),
('AOI', 'AOI 自动光学检测', 'Automated Optical Inspection', 'Máy AOI', 'smt_inspection', true, 50),
-- Post-SMT machines
('pcb_laser', 'PCB 镭码机', 'PCB Laser Marking', 'Máy khắc laser', 'post_smt', true, 60),
('ai_insert', 'AI 插件机', 'AI Insertion', 'Máy cắm AI', 'post_smt', true, 70),
('wave_solder', '波峰焊', 'Wave Soldering', 'Máy hàn sóng', 'post_smt', true, 80),
('WS-AOI', '波峰焊 AOI', 'Wave Solder AOI', 'Máy AOI sóng hàn', 'post_smt', true, 90),
('dispenser', '点胶机', 'Dispenser', 'Máy phun keo', 'post_smt', true, 100),
('ultrasonic', '超声焊接', 'Ultrasonic Welding', 'Máy hàn siêu âm', 'post_smt', true, 110),
('depanel', '分板机', 'Depaneling', 'Máy tách panel', 'post_smt', true, 120),
-- Testing
('ICT', 'ICT 测试', 'ICT Test', 'Máy đo ICT', 'testing', true, 130),
('FCT', 'FCT 功能测试', 'FCT Test', 'Máy đo FCT', 'testing', true, 140),
('ATE', 'ATE 测试', 'ATE Test', 'Máy đo ATE', 'testing', true, 150),
('hipot', '高压测试', 'Hipot Test', 'Máy đo Hipot', 'testing', true, 160),
('burnin', '老化测试', 'Burn-in Test', 'Máy đo老化', 'testing', true, 170),
-- Facilities & support
('PDA', 'PDA 扫描', 'PDA Scanner', 'Máy quét PDA', 'support', false, 200),
('label_printer', '标签打印机', 'Label Printer', 'Máy in nhãn', 'support', false, 210),
('nameplate', '铭牌打印', 'Nameplate Printer', 'Máy in tên', 'support', false, 220),
('pack_scan', '包装扫描', 'Packaging Scanner', 'Máy quét bao bì', 'support', false, 230),
('rework_station', '返修台', 'Rework Station', 'Bàn sửa lỗi', 'support', false, 300),
('hot_air_gun', '热风枪', 'Hot Air Gun', 'Súng nhiệt', 'support', false, 310),
('soldering_iron', '烙铁', 'Soldering Iron', 'Mỏ hàn', 'support', false, 320),
('baking_oven', '烘箱', 'Baking Oven', 'Lò sấy', 'support', false, 330)
on conflict (code) do update set
    name_zh = excluded.name_zh,
    name_en = excluded.name_en,
    name_vi = excluded.name_vi,
    category = excluded.category;

-- ============================================================
-- ADD updated_at TO machines TABLE
-- ============================================================

alter table machines
    add column if not exists updated_at timestamptz not null default now();

-- ============================================================
-- ADD FOREIGN KEY CONSTRAINT FROM machines.machine_type
-- ============================================================

-- Only add FK if there are no invalid values
do $$
begin
    if exists (select 1 from machines where machine_type not in (select code from machine_types)) then
        raise warning 'Some machines have machine_type values not in machine_types lookup table. FK not added.';
    else
        alter table machines
            add constraint machines_machine_type_fk
            foreign key (machine_type) references machine_types(code);
    end if;
end $$;

commit;
