# 越南工厂瑞晶 — Power BI 实施方案

> 基于 MES PostgreSQL 数据仓库，采用 DirectQuery 模式

---

## 1. 连接配置

### 1.1 PostgreSQL（主数据源）

| 属性 | 值 |
|------|-----|
| 服务器 | `127.0.0.1` |
| 端口 | `5432` |
| 数据库 | `smt_factory` |
| 用户名 | `postgres` |
| 密码 | `postgres` |
| 模式 | `public` |

> ⚠️ 生产部署建议创建只读用户：`CREATE USER pbi_reader WITH PASSWORD 'xxx'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO pbi_reader;`

### 1.2 MySQL（AOI 质检数据 — 如需补充）

| 属性 | 值 |
|------|-----|
| 服务器 | `127.0.0.1` |
| 端口 | `3306` |
| 数据库 | `smt_factory` |
| 用户名 | `root` |
| 密码 | `root1234` |
| 表 | `aoi_inspection_records` |

---

## 2. 数据模型（Star Schema）

### 2.1 维度表（Dimensions）

| 视图名 | 用途 | 主键 | 行数 |
|--------|------|------|------|
| `powerbi_dim_date` | 日期维度（2026-2035） | `date` | ~3652 |
| `powerbi_dim_line` | 产线信息（L001-L005） | `line_id` | 6 |
| `powerbi_dim_station` | 工位信息（含类型/工序顺序） | `station_id` | 188 |
| `powerbi_dim_product` | 产品信息 | `product_id` | 11 |
| `powerbi_dim_customer` | 客户信息 | `customer_id` | 4 |
| `powerbi_dim_employee` | 员工/操作员（含部门/岗位） | `employee_id` | 18 |
| `powerbi_dim_work_order` | 工单信息 | `work_order_id` | 18 |
| `powerbi_dim_defect_code` | 缺陷代码字典 | `defect_code_id` | 12 |

### 2.2 事实表（Facts）

| 视图名 | 粒度 | 行数 | 说明 |
|--------|------|------|------|
| `powerbi_fact_station_events_daily` | 产线+工位+日期 | 124 | **核心**：日产量、Pass/Fail、停机事件 |
| `powerbi_fact_work_order` | 每工单 | 7 | 工单进度、逾期状态、交期风险 |
| `powerbi_fact_quality_defects` | 每条缺陷记录 | 0* | 不良代码分析、维修记录 |
| `powerbi_fact_oee_daily` | 产线+日期 | 161K | **核心**：OEE% + Availability/Performance/Quality |
| `powerbi_fact_inventory_current` | 每物料 | 276 | 当前库存余额、批次数量 |
| `powerbi_fact_attendance_daily` | 员工+日期 | 30 | 出勤记录、工时 |
| `powerbi_fact_delivery_risk` | 每客户PO | 3 | 交期风险等级、逾期天数 |

> *`powerbi_fact_quality_defects` 目前 0 行 — `quality_inspections` 表暂时无 FAIL 记录。AOI 质检数据在 MySQL `aoi_inspection_records` 表，可补充。

### 2.3 表关系（Power BI Model）

```
powerbi_dim_date (date)
  ├── powerbi_fact_station_events_daily (event_date)
  ├── powerbi_fact_oee_daily (date)
  ├── powerbi_fact_attendance_daily (attendance_date)
  └── powerbi_fact_work_order (released_at / due_date)

powerbi_dim_line (line_code)
  ├── powerbi_dim_station (line_code)
  ├── powerbi_fact_station_events_daily (line_code)
  ├── powerbi_fact_work_order (line_code)
  └── powerbi_fact_oee_daily (line_code)

powerbi_dim_work_order (work_order_id)
  ├── powerbi_fact_quality_defects (work_order_id)
  ├── powerbi_fact_station_events_daily (via station→line)
  └── powerbi_fact_work_order (work_order_code)

powerbi_dim_employee (employee_id)
  └── powerbi_fact_attendance_daily (employee_id)
```

---

## 3. 推荐报表页

### 页1：生产总览（Dashboard）

| 视觉对象 | 数据源 | 度量值 |
|----------|--------|--------|
| KPI 卡片 | `powerbi_fact_station_events_daily` | 今日总产量 = SUM(pass_count) |
| KPI 卡片 | `powerbi_fact_oee_daily` | 今日全厂 OEE = AVERAGE(oee) |
| KPI 卡片 | `powerbi_fact_delivery_risk` | 逾期工单数 = COUNT(work_order_codes) WHERE is_overdue=TRUE |
| 折线图 | `powerbi_fact_oee_daily` | 各线 OEE 趋势（近30天） |
| 柱状图 | `powerbi_fact_station_events_daily` | 各线当日产出对比 |
| 表格 | `powerbi_fact_work_order` | 在制工单进度列表 |

### 页2：产线 OEE 分析

```
【筛选器】date = 本月，line_code = 全部
【折线图】X=date, Y=OEE% (Avg), 图例=line_code
【仪表盘】
  - Availability% = AVERAGE(availability)
  - Performance% = AVERAGE(performance)
  - Quality% = AVERAGE(quality)
【矩阵】行=line_code, 列=month, 值=AVERAGE(oee)
```

### 页3：工单进度与交期

```
【表格】work_order_code, product_code, line_code, progress_pct, due_date, is_overdue
【条件格式】progress_pct < 50% → 红色, 50-80% → 黄色, >80% → 绿色
【切片器】work_order_status, line_code
【卡片】逾期工单数，平均完成率
```

### 页4：质量分析（补充 MySQL AOI 后）

```
【Pareto 图】defect_code → COUNT(defect_code)
【堆积柱状图】station_type → COUNT(result=Freq) 按 defect_code 分类
【表格】TOP 10 defect_code 明细
```

### 页5：工位实况

```
【卡片图】在线工位数 = COUNT(station_id) WHERE station_status='running'
【条形图】各线工位数量分布
【表格】station_code, station_name_zh, station_type, line_code, last_event_at
  （用 powerbi_dim_station 关联 powerbi_fact_station_events_daily 最近日期）
```

### 页6：人员出勤

```
【柱状图】部门 → SUM(work_hours) 按月
【表格】employee_name, attendance_date, clock_in, clock_out, work_hours, attendance_status
【切片器】department_code, attendance_date
```

---

## 4. Power BI 连接步骤

### 方式 A：DirectQuery（推荐）

1. Power BI Desktop → **获取数据** → **PostgreSQL 数据库**
2. 服务器：`127.0.0.1:5432`，数据库：`smt_factory`
3. 选择"DirectQuery"连接模式
4. 选择以下视图（按需）：
   - `powerbi_dim_*` 所有维度
   - `powerbi_fact_*` 所需事实
5. **管理关系** → 自动检测或按 2.3 节手动创建
6. **DAX 度量值** → 参考第 5 节

### 方式 B：导入模式（大数据量时更快）

> 适合 `powerbi_fact_station_events_daily`（~300K 行/月）和 `powerbi_dim_*` 小表
> `powerbi_fact_oee_daily`（161K 行）也适合导入

1. 选择"导入"模式
2. 设置每日/每小时计划刷新（Power BI Gateway）

---

## 5. DAX 度量值示例

```dax
// ── 生产指标 ──

今日总产量 = 
  CALCULATE(
    SUM(powerbi_fact_station_events_daily[pass_count]),
    powerbi_fact_station_events_daily[event_date] = TODAY()
  )

今日不良率 = 
  VAR total = SUM(powerbi_fact_station_events_daily[scan_in_events])
  VAR fail = SUM(powerbi_fact_station_events_daily[fail_count])
  RETURN DIVIDE(fail, total, 0)

当月OEE = 
  AVERAGE(powerbi_fact_oee_daily[oee])

工单完成率 = 
  AVERAGE(powerbi_fact_work_order[progress_pct])

逾期工单数 = 
  COUNTROWS(
    FILTER(
      powerbi_fact_work_order,
      powerbi_fact_work_order[is_overdue] = TRUE
    )
  )

// ── 趋势指标 ──

MoM OEE 变化 = 
  VAR CurrentMonth = AVERAGEX(
    FILTER(powerbi_fact_oee_daily, powerbi_fact_oee_daily[date] IN DATESMTD('powerbi_dim_date'[date])),
    powerbi_fact_oee_daily[oee]
  )
  VAR PrevMonth = CALCULATE(
    AVERAGE(powerbi_fact_oee_daily[oee]),
    PREVIOUSMONTH('powerbi_dim_date'[date])
  )
  RETURN CurrentMonth - PrevMonth

产出达标率 = 
  VAR actual = SUM(powerbi_fact_station_events_daily[pass_count])
  VAR target = SUM(powerbi_fact_work_order[planned_qty]) / 30  -- 日均目标
  RETURN DIVIDE(actual, target, 0)
```

---

## 6. 刷新策略

| 数据 | 刷新频率 | 模式建议 |
|------|----------|----------|
| `powerbi_dim_*` | 每天一次 | 导入 |
| `powerbi_fact_station_events_daily` | 每小时 | DirectQuery |
| `powerbi_fact_oee_daily` | 每小时 | DirectQuery |
| `powerbi_fact_work_order` | 每15分钟 | DirectQuery |
| `powerbi_fact_attendance_daily` | 每天一次 | 导入 |
| `powerbi_fact_delivery_risk` | 每15分钟 | DirectQuery |
| `powerbi_fact_inventory_current` | 每小时 | DirectQuery |

---

## 7. 运维注意事项

1. **PostgreSQL 连接数**: Power BI DirectQuery 可能消耗连接池，建议 `max_connections=50`
2. **查询超时**: 设置 Power BI 查询超时为 120s
3. **`powerbi_fact_oee_daily` 161K 行**: 建议在 Power BI 添加 `date` 筛选器默认最近30天
4. **`powerbi_fact_station_events_daily`**: 按 `event_date` 筛选，避免全表扫描
5. **质量数据空洞**: 目前的 `quality_inspections` 表 `result='fail'` 记录为空。AOI 缺陷数据在 MySQL `aoi_inspection_records` 中，可通过 Power Query 合并补充

---

## 8. 补充 MySQL AOI 数据（如需要）

```powerquery
// Power Query M — 合并 AOI 质检数据
let
    Source = PostgreSQL.Database("127.0.0.1:5432", "smt_factory"),
    PBI_Defects = Source{[Schema="public",Item="powerbi_fact_quality_defects"]}[Data],
    AOI_MySQL = MySQL.Database("127.0.0.1:3306", "smt_factory"),
    AOI_Records = AOI_MySQL{[Schema="",Item="aoi_inspection_records"]}[Data],
    // 合并两个来源
    Combined = Table.Combine({PBI_Defects, AOI_Records})
in
    Combined
```

---

## 9. 快速开始（5 分钟）

```
1. 打开 Power BI Desktop
2. 获取数据 → PostgreSQL → 127.0.0.1:5432 / smt_factory
3. 勾选：powerbi_dim_date, powerbi_dim_line, powerbi_dim_station,
          powerbi_fact_station_events_daily, powerbi_fact_oee_daily,
          powerbi_fact_work_order, powerbi_fact_delivery_risk
4. 选择 DirectQuery → 加载
5. 管理关系 → 按 2.3 节映射
6. 新建度量值 → 参照第 5 节
7. 添加可视化 → 参照第 3 节
```

> 💡 **需要帮助？** 打开 MES API (`server.js` on port 8080) 即可查看实时数据。
> 管理员账号 `PMC_CN_01` / `Factory@123` 可查看全厂数据。
