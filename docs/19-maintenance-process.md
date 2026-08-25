# Equipment & Facilities Maintenance Process Manual
# SMT Factory — Vietnam Ruijing

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     EQUIPMENT MANAGEMENT SYSTEM                       │
├──────────────────────┬──────────────────────┬───────────────────────┤
│   设备资产台账        │   维保计划与执行       │   点检系统             │
│   Equipment Assets   │   Maintenance Plans   │   Inspections          │
│   (042 migration)    │   & Work Orders      │   (040 migration)       │
├──────────────────────┼──────────────────────┼───────────────────────┤
│   设施基础设施        │   任务库              │   视图与报表            │
│   Facilities (039)   │   Task Library(041)  │   Views (043)          │
└──────────────────────┴──────────────────────┴───────────────────────┘
```

---

## 2. Core Tables Reference

### Migration Execution Order

```
005_equipment_management_schema  (existing)
        ↓
039_facilities_maintenance       (facilities schema)
        ↓
040_machine_inspection           (inspection system)
        ↓
041_maint_task_library           (task library: 208 tasks, 302 parts)
        ↓
042_equipment_asset_reg          (asset registration + PM auto-generation)
        ↓
043_maintenance_views            (11 views, triggers, functions)
        ↓
044_maintenance_fixes            (fixes, alert rules, plan_steps, triggers)
```

### Migration Map

| Migration | 内容 | 关键表/功能 |
|-----------|------|------------|
| `005_equipment_management_schema` | 设备管理核心schema | `equipment_assets`, `maintenance_plans`, `maintenance_orders`, `breakdown_events` |
| `039_facilities_maintenance` | 设施基础设施 | `facility_categories`, `facility_assets`, `fac_esd_records`, `fac_hvac_records`, `fac_air_records`, `fac_power_records`, `fac_alert_rules`, `fac_alerts` |
| `040_machine_inspection` | 点检执行系统 | `inspection_templates`, `inspection_template_items`, `inspection_assignments`, `inspection_records`, `inspection_record_items`, `inspection_abnormals`, `machine_oee_logs`, `machine_status_snapshots` |
| `041_maint_task_library` | 维保任务库 | `maint_task_library` (24 machine types, 208 tasks), `wear_parts_reference` (302 parts) |
| `042_equipment_asset_reg` | 资产注册+PM计划生成 | Seeds categories/models; creates `equipment_assets` from `machines`; auto-generates `maintenance_plans`; pre-generates `inspection_assignments` for today+tomorrow |
| `043_maintenance_views` | 视图+函数 | 11 views, 2 triggers, 2 functions |
| `044_maintenance_fixes` | 修复+增强 | 修复view拼写错误; seeds 22条告警规则; 自动填充`maintenance_plan_steps`; 自动生成逾期`maintenance_schedules`+工单; 设施监测自动告警触发器 |

---

## 3. Daily Operation Process (日常运行流程)

### 3.1 Shift Start — Operator Pre-Shift Check

```
操作员上班
    │
    ▼
┌─────────────────────────────────────┐
│  查看今日点检任务                    │
│  SELECT * FROM v_pending_inspections │
│  WHERE shift_date = TODAY           │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  打开设备点检执行页面                │
│  inspection_records (新建)          │
│  • 扫机器条码 → machine_id          │
│  • 选班次 (day/night)              │
│  • 系统自动加载检查项列表            │
│    inspection_record_items          │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  逐项执行检查 (inspection_record_items)
│  结果: PASS / FAIL / NA / SKIPPED   │
│  FAIL项 → 记录实测值 + 拍照          │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  关键安全项 FAIL?                    │
│  (is_critical_safety = true)       │
│      │                              │
│     YES → 立即停机 → 通知工程师      │
│     NO  → 记录异常继续              │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  点检完成 (inspection_records)       │
│  • overall_result = PASS/FAIL      │
│  • system auto-counts pass/fail    │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  有异常项?                           │
│      │                              │
│     YES → inspection_abnormals      │
│           (异常升级单)              │
│           可选: → maintenance_orders │
│                 (维修工单)           │
│      NO  → 点检关闭                 │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  OEE数据录入 (machine_oee_logs)      │
│  • planned_hours, actual_hours     │
│  • downtime_minutes               │
│  • output_qty, defect_qty         │
│  → OEE自动计算                     │
└─────────────────────────────────────┘
```

### 3.2 Facilities Daily Monitoring

```
设施巡查 (每天白班)
    │
    ▼
┌─────────────────────────────────────┐
│  ESD 点检 (fac_esd_records)         │
│  • 人员腕带测试 (<1Ω)              │
│  • 防静电鞋测试                     │
│  • 工作台表面电阻 (10⁶-10⁹Ω)       │
│  • 离子风机平衡                     │
│  结果: PASS/FAIL → 记录             │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  温湿度记录 (fac_hvac_records)      │
│  车间: 23±3°C, 45±10% RH           │
│  结果超出阈值 → fac_alerts 自动告警 │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  压缩空气 (fac_air_records)          │
│  压力: 0.5-0.7 MPa                  │
│  露点 / 油含量                      │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  电能质量 (fac_power_records)        │
│  三相电压 380V±10%                  │
│  频率 50Hz±1%                       │
└─────────────────────────────────────┘
```

### 3.3 Preventive Maintenance Process

```
Maintenance Planner (每周)
    │
    ▼
┌─────────────────────────────────────┐
│  查看逾期维保 (v_overdue_maintenance)│
│  当前逾期 + 未来7天到期             │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  为每台到期设备创建维修工单          │
│  maintenance_orders                 │
│  order_type: 'preventive'           │
│  priority: normal                   │
│  linked: plan_id → plan_no          │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  分配给技术员 (operator_id)          │
│  设定计划时间 (planned_start/end)    │
│  → maintenance_order_lines          │
│    (拆解任务步骤, 关联备件)         │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  技术员执行                          │
│  maintenance_work_logs (记录工时)    │
│  实际时间 → actual_start/end        │
│  备件消耗 → 关联 equipment_spare_parts
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  工单完成 (status = 'completed')    │
│  → Trigger 自动更新下次到期日        │
│    (maintenance_plans.next_due_date)│
│    = current + frequency_value      │
└─────────────────────────────────────┘
```

### 3.4 Breakdown/Corrective Maintenance

```
设备突发故障 (操作员或点检发现)
    │
    ▼
┌─────────────────────────────────────┐
│  breakdown_events (新建)            │
│  • event_no = 'BD-' + date + seq   │
│  • fault_reason (初步描述)          │
│  • start_at = now()                │
│  • status = 'open'                 │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  同时创建 maintenance_orders         │
│  order_type: 'corrective'           │
│  priority: high / urgent            │
│  linked: breakdown_event_id         │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  技术员抢修                          │
│  → equipment_repair_records         │
│  (维修记录: 更换备件/维修措施)       │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  故障解决 → breakdown_events.end_at │
│  downtime_minutes 自动计算          │
│  → 更新 MTBF/MTTR 数据              │
└─────────────────────────────────────┘
```

---

## 4. Key Performance Indicators

### Equipment KPIs

```
OEE = 设备综合效率
  = 可用率 × 性能率 × 质量率
  ≥ 85%

可用率 = (计划生产时间 - 停机时间) / 计划生产时间 × 100%
  ≥ 95%

MTBF (平均故障间隔)
  = 总运行时间 / 故障次数
  贴片机目标: ≥ 500小时
  回流焊目标: ≥ 1000小时

MTTR (平均修复时间)
  = 总维修时间 / 维修次数
  目标: ≤ 30分钟

PM完成率
  = 已完成PM工单 / 计划PM工单 × 100%
  目标: ≥ 98%

点检执行率
  = 实际完成点检 / 计划点检 × 100%
  目标: ≥ 99%

关键安全点检一次通过率
  目标: ≥ 99.5%
```

### Facilities KPIs

```
ESD一次通过率 = PASS人数 / 测试总人数 × 100%
  目标: ≥ 95%

温湿度合规率 = 合规记录数 / 总记录数 × 100%
  目标: ≥ 99%

压缩空气露点 ≤ 规定的露点温度

告警响应时间 = 告警产生到确认的时间
  目标: ≤ 15分钟 (critical), ≤ 1小时 (warning)

年维护成本率 = 年度维保总成本 / 年度产值 × 100%
  目标: ≤ 2%
```

---

## 5. Alarm/Alert Rules

### Facilities Alert Thresholds (fac_alert_rules)

| 类别 | 指标 | Warning | Critical | 操作 |
|------|------|---------|----------|------|
| ESD | 腕带电阻 (Ω) | >0.5M | >1M | 立即更换 |
| HVAC | 温度 (°C) | >26 或 <20 | >28 或 <18 | 通知空调 |
| HVAC | 湿度 (%RH) | >55 或 <35 | >60 或 <30 | 通知空调 |
| Air | 压力 (MPa) | <0.45 或 >0.75 | <0.4 或 >0.8 | 停机通知 |
| Power | 电压偏差 (%) | >±10 | >±15 | 通知电气 |
| Power | 接地电阻 (Ω) | >0.5 | >1 | 立即停机 |

### Alert Lifecycle

```
告警产生 (fac_alerts.status = 'open')
    │
    ▼
  通知相关角色 (notify_roles)
    │
    ▼
  值班人员确认 (status = 'acknowledged')
    │
    ▼
  处理措施记录 (resolution_note)
    │
    ▼
  解决 → 工程师确认 (status = 'resolved')
    │
    ▼
  关闭 (status = 'closed')
```

---

## 6. Common Operations — SQL Quick Reference

### 点检执行 (每日)

```sql
-- 查看今日待点检任务
SELECT * FROM v_pending_inspections
WHERE shift_date = current_date
ORDER BY line_code, machine_code;

-- 执行点检 (完成后)
INSERT INTO inspection_records (
  record_no, machine_id, line_id, template_id,
  shift_date, shift_type, inspector_id,
  started_at, completed_at, overall_result,
  total_items, passed_items, failed_items
) VALUES (
  'IR-' || to_char(now(),'YYYYMMDD') || '-001',
  1, 1, 1,
  current_date, 'day',
  (SELECT id FROM users WHERE username = 'operator1'),
  now(), now(), 'pass',
  8, 8, 0
);

-- 某项点检失败 → 创建异常升级
INSERT INTO inspection_abnormals (
  abnormal_no, record_id, machine_id,
  abnormality_type, description, severity
) VALUES (
  'ABN-001', currval('inspection_records_id_seq'), 1,
  'defect', '吸嘴表面有无锡渣但变形', 'medium'
);
```

### 创建维修工单

```sql
-- 从逾期PM计划创建工单
INSERT INTO maintenance_orders (
  order_no, plan_id, asset_id,
  order_type, priority,
  planned_start, planned_end,
  operator_id, created_by
) VALUES (
  fn_generate_mo_number(),
  (SELECT id FROM maintenance_plans WHERE plan_no = 'PLN-XXX' LIMIT 1),
  (SELECT asset_id FROM maintenance_plans WHERE plan_no = 'PLN-XXX'),
  'preventive', 'normal',
  now(), now() + interval '2 hours',
  (SELECT id FROM users WHERE username = 'tech1'),
  (SELECT id FROM users WHERE username = 'planner1')
);

-- 从故障事件创建紧急工单
INSERT INTO maintenance_orders (
  order_no, asset_id,
  order_type, priority,
  planned_start, actual_start,
  operator_id, created_by
) VALUES (
  fn_generate_mo_number(),
  (SELECT asset_id FROM breakdown_events WHERE event_no = 'BD-20250627-001'),
  'corrective', 'urgent',
  now(), now(),
  (SELECT id FROM users WHERE username = 'tech1'),
  (SELECT id FROM users WHERE username = 'supervisor1')
);
```

### OEE 查询

```sql
-- 产线每日OEE
SELECT * FROM v_daily_oee_by_line
WHERE log_date = current_date - 1;

-- 某台机OEE趋势 (最近30天)
SELECT log_date, oee_availability, oee_quality, oee_overall
FROM machine_oee_logs
WHERE machine_id = 1
  AND log_date >= current_date - 30
ORDER BY log_date;
```

### 维保KPI

```sql
-- 本月KPI
SELECT * FROM v_maintenance_kpi
WHERE month = date_trunc('month', current_date);

-- 逾期维保清单 (发给维修主管)
SELECT * FROM v_overdue_maintenance
ORDER BY overdue_status, machine_code;
```

---

## 7. Menu Structure (建议在MES系统菜单中)

```
设备管理 Equipment Management
├── 设备资产总览 / Asset Overview
├── 设备状态监控 / Status Monitor
├── 维保计划 / Maintenance Plans
├── 维保工单 / Maintenance Orders
├── 故障记录 / Breakdown Log
├── 点检任务 / Inspection Tasks
├── 点检记录 / Inspection Records
├── 异常升级 / Abnormal Escalation
├── OEE仪表板 / OEE Dashboard
├── 维保KPI / Maintenance KPIs
├── 设施监测 / Facilities Monitoring
│   ├── ESD点检 / ESD Records
│   ├── 温湿度记录 / HVAC Records
│   ├── 压缩空气 / Air Quality
│   ├── 电能质量 / Power Quality
│   └── 告警管理 / Alerts
├── 备件库存 / Spare Parts
└── 维保报表 / Reports
```

---

## 8. Report Templates

### 日报: 设备点检日报

```
报告日期: YYYY-MM-DD
产线: L001 / SMT Line 1
班次: 白班/晚班

点检完成情况:
  计划点检: N 台
  实际完成: N 台
  执行率: XX%

点检结果:
  通过: N 台 (AA%)
  失败: N 台 (BB%)
  关键失败: N 台 → 已停机处理

主要异常:
  1. NXT-01 吸嘴变形 → 已更换 → 工单 MO-XXXXXXXX
  2. REFLOW-01 3#区温度偏低 → 已校准 → 持续观察

OEE:
  L001 今日: AA.B%
  L002 今日: BB.B%

操作员: XXX    审核: XXX    日期: YYYY-MM-DD
```

### 周报: 维保周报

```
报告周期: YYYY-MM-DD ~ YYYY-MM-DD

维保计划执行:
  计划工单: N 个    完成: N 个    完成率: XX%
  逾期工单: N 个    紧急工单: N 个

MTBF:  XXX小时 (目标 ≥ 500小时)
MTTR:  XX分钟 (目标 ≤ 30分钟)
PM合规率: XX%

本周故障:
  故障次数: N 次
  总停机时间: XXX分钟
  最大单次停机: XXX分钟 (NXT-01 真空泵故障)

下周重点:
  1. L001 回流焊炉计划维护 (PLN-REFLOW-001)
  2. SPI-01 光源更换

审核: XXX    日期: YYYY-MM-DD
```

---

## 9. User Roles & Permissions

| 角色 | 可执行操作 |
|------|-----------|
| `smt_operator` | 执行点检、记录结果、上报异常 |
| `smt_technician` | 执行维保工单、记录维修、领取备件 |
| `maintenance_engineer` | 创建维保计划、校准、执行 engineer 级任务 |
| `quality` | 查看点检结果、执行 inspection/calibration 任务 |
| `warehouse` | 管理备件库存 |
| `management` | 查看所有报表、审核KPI、审批维修申请 |

---

## 10. Appendix: Machine Types & Task Count Summary

| machine_type | 设备数 (demo) | 维保任务数 | 关键任务 |
|-------------|-------------|---------|---------|
| mounter | 6 | 17 | 吸嘴清洁/精度校准 |
| reflow | 2 | 16 | 炉温曲线/热电偶 |
| printer | 3 | 15 | 钢网张力/印刷精度 |
| SPI | 2 | 9 | 光学校准/基准板 |
| AOI | 2 | 11 | 漏检率测试/光源 |
| pcb_laser | 4 | 10 | 激光功率/冷却水 |
| ai_insert | 3 | 10 | 切脚刀片/润滑 |
| wave_solder | 1 | 11 | 锡成分分析 |
| ICT | 2 | 8 | 探针磨损 |
| FCT | 2 | 6 | 仪表校准 |
| depanel | 2 | 8 | 刀片研磨 |
| ultrasonic | 3 | 8 | 振子检查 |
| burnin | 3 | 8 | 温控校验 |
| hipot | 4 | 7 | 高压安全 |
| dispenser | 1 | 9 | 点胶量校准 |
| ATE | 6 | 7 | 仪表校准 |
| rework_station | 1 | 7 | 温度校准 |
| hot_air_gun | 1 | 5 | 发热芯 |
| soldering_iron | 1 | 5 | 接地电阻 |
| label_printer | 1 | 7 | 打印头 |
| nameplate | 2 | 6 | 打印头 |
| pack_scan | 2 | 6 | 传送皮带 |
| WS-AOI | 3 | 6 | 光学校准 |
| PDA | 2 | 6 | 电池 |
