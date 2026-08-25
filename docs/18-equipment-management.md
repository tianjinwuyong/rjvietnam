# Equipment Management

## Placement

Equipment management belongs under `MES` as a core sub-module.

It shares master data with `Admin` and operational events with `Quality` and `Traceability`.

## Scope

This module manages:

- equipment master data
- equipment status
- preventive maintenance
- corrective maintenance
- breakdown and downtime records
- inspection and calibration records
- spare parts usage
- maintenance history
- facilities infrastructure (ESD, HVAC, compressed air, power)

## Existing Table

The current schema already has:

- `machines`
- Full equipment management schema in `005_equipment_management_schema.sql`

## Implemented Schema

### Equipment Master Data

- `equipment_categories`
- `equipment_models`
- `equipment_assets`
- `equipment_locations`
- `equipment_status_codes`
- `equipment_spare_parts`

### Maintenance Planning

- `maintenance_plans`
- `maintenance_plan_steps`
- `maintenance_plan_assignments`
- `maintenance_schedules`

### Execution Records

- `maintenance_orders`
- `maintenance_order_lines`
- `maintenance_work_logs`
- `breakdown_events`
- `downtime_events`
- `inspection_tasks`
- `inspection_results`
- `calibration_records`
- `equipment_repair_records`

### Spare Parts

- `equipment_spare_parts`

### Traceability And Audit

- `equipment_events`
- `equipment_status_history`
- `audit_logs`

## SMT Equipment Preventive Maintenance Schedule

### Core SMT Line Equipment

| 设备 | 类别 | 每日 | 每周 | 每月 | 每季度 | 每年 |
|------|------|------|------|------|--------|------|
| **贴片机 Pick & Place** | placement | 吸嘴清洁/检查、校准零点、检查气压源 | 清洁轨道、润滑丝杠、检查取料姿态 | 校准视觉系统、检查皮带张力、校验贴装精度 (≥99.5%) | 更换磨损轴承、执行全面精度测试、校验运动模组 | 全面检修、更换老化皮带和轴承 |
| **锡膏印刷机 Printer** | printing | 钢网清洁、校验刮刀压力和速度 | 清洁丝杠和导轨、检查PCB定位夹具磨损 | 校准印刷精度（偏移<0.1mm）、检查锡膏厚度 (SPI) | 更换刮刀垫片、清洁润滑导轨、校验钢网张力 | 更换钢网密封、检查回流链路 |
| **回流焊 Reflow Oven** | soldering | 记录炉温曲线、检查助焊剂残留、清洁传送带 | 清洁传送带和导轨、校准热电偶 | 做炉温曲线测试（升温速率、恒温时间、回流峰值） | 检查加热管升温速率、清洁冷却风扇、更换过滤器 | 更换发热管组件、检查热电偶精度 |
| **AOI 自动光学检测** | inspection | 校准光源亮度、执行软硬件自检 | 清洁镜头和反光碗、标定基准板 | 执行精度测试（漏检率<0.5%）、验证检测阈值 | 更换光源、校准运动平台、检查XY平台精度 | 全面标定、执行 golden 板测试 |
| **SPI 锡膏检测** | inspection | 清洁光学镜头和投射光栅 | 校准基准板、检查传送机构 | 执行精度测试、校验测量重复性 | 更换光源灯泡、清洁光路组件 | 全面校准、执行系统验证 |
| **洗板机 Cleaning** | cleaning | 清洁喷嘴、检查水压和清洗液液位 | 清洁过滤网、排除管路积水 | 检查加热系统、管路除垢、检测水质 | 全面除垢、更换密封圈和滤芯 | 更换管路、检查泵和加热棒 |
| **上下料机 Loader/Unloader** | handling | 检查PCB夹具磨损、检查传感器灵敏度 | 清洁传动机构、润滑链条 | 校验皮带张力和定位精度 | 更换磨损皮带和轴承、检查传感器 | 全面检修、更换老化元器件 |
| **UV 固化机** | curing | 检查UV灯管亮度、记录开机时间 | 清洁反光罩和灯管、检查冷却风扇 | 测量UV强度（mW/cm²）、校验曝光计时器 | 更换UV灯管、清洁光路、更换过滤器 | 全面检修、更换镇流器 |

### Facilities Infrastructure

| 设施 | 类别 | 每日 | 每周 | 每月 | 每季度 | 每年 |
|------|------|------|------|------|--------|------|
| **ESD 静电防护** | esd | 人员静电测试（<1Ω）、记录测试结果 | 检测地板/工作台表面电阻（10⁶-10⁹Ω） | 校准静电消除器、检测离子风机离子平衡 | 更换ESD手腕带、检测接地系统连续性 | 全面ESD审计、校验测试设备 |
| **温湿度控制** | hvac | 记录车间温湿度（温度23±3°C，湿度45±10%RH） | 检查空调运行状态、记录异常 | 校准温湿度传感器、清洁空调过滤网 | 清洁空调机组、检查制冷剂充注量 | 全面检修空调系统、更换压缩机 |
| **压缩空气系统** | compressed_air | 记录气压（0.5-0.7MPa）、日常排水排污 | 检测排水系统、检查泄漏 | 检测压缩空气油水含量、更换干燥剂 | 更换过滤器、执行泄漏检测 | 全面检修空压机、更换密封件 |
| **供电系统** | power | 记录三相电压（380V±10%）、检查UPS状态 | 检测接地电阻、检查配电箱 | UPS充放电测试、检测相间不平衡 | 检测避雷器、检查接地系统 | 全面检修配电柜、更换老化电缆 |
| **纯水系统** | water | 记录出水电导率（<10μS/cm）、检查运行状态 | 清洁预处理滤芯、检查管路 | 校准电导率仪、更换RO膜 | 检测水质微生物、更换紫外灯管 | 全面更换滤芯、消毒管路 |
| **废气处理** | exhaust | 检查排风机运行状态、记录压差 | 清洁排风口、检查管道泄漏 | 更换活性炭、检测废气浓度 | 检查燃烧装置、更换催化剂 | 全面检修废气处理系统 |

## Key Maintenance KPIs

```
设备综合效率 OEE = 可用率 × 性能率 × 质量率
  目标：OEE ≥ 85%

MTBF（平均故障间隔）= 总运行时间 / 故障次数
  贴片机目标：MTBF ≥ 500 小时
  回流焊目标：MTBF ≥ 1000 小时

MTTR（平均修复时间）= 总停机时间 / 故障次数
  目标：MTTR ≤ 30 分钟

PM 计划执行率 = 实际完成 PM 数 / 计划 PM 数 × 100%
  目标：≥ 98%

设备可用率 = (总运行时间 - 停机时间) / 总运行时间 × 100%
  目标：≥ 95%

维保成本率 = 维保总成本 / 产值 × 100%
  目标：≤ 2%

备件库存周转率 = 年度消耗备件成本 / 平均备件库存 × 100%
  目标：≥ 4次/年

点检执行率 = 实际点检项次 / 计划点检项次 × 100%
  目标：≥ 99%
```

## Suggested Fields

### `equipment_assets`

- asset code
- asset name
- machine type
- line code
- station code
- vendor
- model
- serial number
- purchase date
- install date
- status

### `maintenance_orders`

- maintenance order number
- equipment asset id
- order type
- priority
- planned start
- planned end
- actual start
- actual end
- status
- operator

### `breakdown_events`

- event number
- equipment asset id
- line code
- station code
- failure type
- failure reason
- start time
- end time
- downtime minutes
- operator

### `inspection_results`

- inspection number
- equipment asset id
- inspection type
- result
- measured value
- standard value
- operator
- occurred at

## Menu Structure

Suggested menu placement inside MES:

- `Equipment Dashboard`
- `Equipment Master`
- `Equipment Status`
- `Preventive Maintenance`
- `Corrective Maintenance`
- `Breakdown Log`
- `Inspection Check`
- `Calibration`
- `Spare Parts`
- `Maintenance History`
- `Facilities Monitoring` (ESD/HVAC/Power/Air)
- `Equipment Reports`

## Workflow

```
Equipment Master
  -> Maintenance Plan
  -> Maintenance Schedule
  -> Work Order
  -> Inspection / Repair
  -> Breakdown / Downtime Log
  -> Spare Part Consumption
  -> Traceability Event

Facilities Infrastructure
  -> Daily Monitoring (ESD/HVAC/Power/Air/Water)
  -> Alert Management
  -> Maintenance Trigger
  -> Resolution Record
  -> Compliance Report
```

## Integration Points

- `MES` uses equipment status for line execution
- `Quality` uses inspection and calibration results
- `Traceability` stores the key event trail
- `Admin` owns the master data and access control
- `WMS` consumes spare parts from inventory for maintenance


## Machine Inspection (点检) — Real Machine Daily Checks

In addition to heavy maintenance work orders, operators perform **lightweight daily/shift inspections** on real machines. This is separate from `maintenance_orders` which are scheduled repairs.

### Inspection Tables (migration `040_machine_inspection.sql`)

- `inspection_templates` — per machine type, defines the checklist template (贴片机/回流焊/印刷机/AOI)
- `inspection_template_items` — each check point: method, pass criteria, fail action, key/critical flags
- `inspection_assignments` — scheduled inspection tasks per machine per shift/date
- `inspection_records` — completed inspection master record (pass/fail/conditional, counts)
- `inspection_record_items` — per-item result (pass/fail/na/skipped + notes + photo)
- `inspection_abnormals` — abnormality escalation from failed checks → triggers maintenance order
- `machine_oee_logs` — daily shift-level OEE data aggregated from inspections
- `machine_status_snapshots` — real-time equipment status (running/idle/breakdown/maintenance)

### Inspection Workflow

```
每班次/每日:
  inspection_assignments (自动生成或手动排程)
    -> inspection_records (操作员执行点检)
      -> inspection_record_items (每项检查结果)
        -> 发现异常 -> inspection_abnormals (升级)
          -> 自动或手动创建 maintenance_orders (工单)
        -> 点检完成 -> machine_oee_logs (更新OEE数据)
        -> machine_status_snapshots (更新设备状态)
```

### Pre-seeded Templates

| Template Code | Machine Type (DB) | 机型 | 类型 | 频率 |
|---|---|---|---|---|---|
| TPL-PNP-001 | mounter | 贴片机 | 日常点检表 | daily |
| TPL-PNP-002 | mounter | 贴片机 | 周点检表 | weekly |
| TPL-RFL-001 | reflow | 回流焊 | 日常点检表 | daily |
| TPL-RFL-002 | reflow | 回流焊 | 周点检表 | weekly |
| TPL-PRT-001 | printer | 印刷机 | 日常点检表 | daily |
| TPL-PRT-002 | printer | 印刷机 | 周点检表 | weekly |
| TPL-AOI-001 | AOI | AOI | 日常点检表 | daily |

Key points in daily inspection: 吸嘴清洁、气压、真空度、贴装头异响、安全门联锁 (critical safety items marked `is_critical_safety=true`).

### Integration

- `inspection_abnormals` → `maintenance_orders` via `maintenance_order_id` FK
- `machine_status_snapshots` → consumed by MES line execution display
- `machine_oee_logs` → equipment dashboard and reporting
- Failed key/critical items generate immediate alert to supervisor


## Common SQL Queries

Reference queries are in `database/migrations/043_inspection_reports.sql` (commented out — not a real migration).

Key query categories:
1. **Pending inspections today** — filter `inspection_assignments` by `status IN ('pending','in_progress')`
2. **Daily completion rate** — aggregate assignments by date over last 30 days
3. **Open abnormality summary** — `inspection_abnormals` with severity, linked to `maintenance_orders`
4. **OEE dashboard** — 7-day trend from `machine_oee_logs` (availability, quality, overall)
5. **Worst OEE machines today** — bottom 5 machines sorted by `oee_overall`
6. **Inspection detail with items** — full join of records + items + template for shift review
7. **Machine status overview** — real-time snapshot from `machine_status_snapshots`
8. **Weekly fail rate by machine type** — inspection pass/fail rate grouped by machine_type
9. **MTBF/MTTR** — breakdown events aggregated per machine over last 30 days

## PM Schedule System (migration `044_pm_schedule_system.sql`)

Separate from the lightweight operator point-check (040), this is the **scheduled preventive maintenance** system with natural frequencies.

### Tables

| Table | Purpose |
|---|---|
| `pm_frequencies` | Lookup: daily, weekly, monthly, quarterly, halfyear, yearly (each with `interval_days`) |
| `pm_templates` | PM template per (machine_type + frequency), e.g. "mounter + monthly" |
| `pm_template_tasks` | Individual tasks: check, clean, replace, calibrate, lubricate, test |
| `pm_schedule_assignments` | Links a template to an `equipment_asset`, with `next_due_date` tracking |
| `pm_execution_logs` | Completed PM records linked to `maintenance_orders` |

### Frequency vs Inspection (040) Distinction

| Aspect | Inspection (040) | PM Schedule (044) |
|---|---|---|
| Who | Operator (每班) | Maintenance engineer/technician |
| What | Quick daily checks (点检) | Structured maintenance tasks |
| When | Per shift/daily | Daily/weekly/monthly/quarterly/yearly |
| Requires shutdown | Usually no | Usually yes for monthly+ |
| Output | `inspection_records` | `maintenance_orders` via PM schedule |
| Critical safety | Yes (immediate alert) | Yes (planned) |

### Auto-generation

Function `generate_pm_orders()` scans `pm_schedule_assignments` where `next_due_date <= current_date`, creates `maintenance_orders` + `pm_execution_logs`. Call daily via cron/scheduler:

```sql
SELECT * FROM generate_pm_orders();
```

### Seeded Templates

25 templates covering 5 machine types × 5 frequencies (daily/weekly/monthly/quarterly/yearly):

- **Mounter**: nozzle cleaning → spindle lube → vision cal → bearing replace → full overhaul
- **Printer**: stencil clean → rail clean → print cal → blade replace → seal replace
- **Reflow**: profile check → TC cal → profile test → heater check → element replace
- **AOI**: light cal → lens clean → accuracy test → light replace → full cal + golden board
- **SPI**: lens clean → baseline cal → repeatability → bulb replace → full system verify

### Demo Schedule Assignments

EQ-0001 (NXT-01 mounter on L001) has 3 active PM assignments:
- `PM-MOUNTER-D` daily (due today, production team)
- `PM-MOUNTER-M` monthly (due in 7 days)
- `PM-MOUNTER-Y` yearly (due in 30 days)

## Migration Order

```
...existing migrations...
039_facilities_maintenance.sql   (facility tables: ESD, HVAC, air, power, water)
040_machine_inspection.sql       (inspection tables + 7 template seeds)
041_machines_schema_enhance.sql  (machine_types lookup + updated_at + FK)
044_pm_schedule_system.sql       (PM schedule tables + 25 template seeds)
```

Seeds:
```
005_equipment_management_seed.sql
006_machine_inspection_demo_seed.sql  (demo assignments, records, OEE data)
007_pm_schedule_seed.sql              (demo PM schedule assignments)
```

## Notes

- Keep equipment events append-only where possible
- Do not overwrite failure history
- Use status fields for active, idle, maintenance, breakdown, and retired states
- Link every maintenance or breakdown event to the affected line or station when available
- The current implementation keeps audit history in the shared `audit_logs` table
- Facilities monitoring should generate real-time alerts when sensor readings exceed thresholds
- All calibration records should store actual vs. standard values with certificate numbers for ISO compliance
- machine_type codes should match `machine_types` lookup table (in `041_machines_schema_enhance.sql`)
- The `inspection_templates.machine_type` is a VARCHAR label matching `machines.machine_type` (no FK enforced)
