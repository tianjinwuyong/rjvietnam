# IQC 来料检验模块 · 系统功能需求规格（AI 可执行 / OA 重写用）

| 项    | 值                                                                  |
| ---- | ------------------------------------------------------------------ |
| 文档版本 | v1.1（2026-10-22 修订：字段名 `spc` 已在 WMS 全链路更名为 `spec`）                             |
| 生成时间 | 2026-10-22                                                         |
| 文档性质 | **唯一事实来源（Single Source of Truth）**。本文件自包含，实施方无需阅读任何既有代码            |
| 目标读者 | 具备代码生成能力的 AI 编码器 + 1 名人工审核者                                        |
| 目标系统 | OA 协同管理平台（Node + Fastify + PostgreSQL + Vue3/Element Plus，或等价技术栈）  |
| 来源系统 | WMS 仓库管理系统 IQC 模块（NestJS + React + PostgreSQL），行为已逐行核对             |
| 覆盖链路 | IQC 检验模板库 → 检验批次 → 抽样方案推定 → 抽样数量 → 检验录入 → spec 判定 → 报告 → 审批 → 库存落账 |

---

## 0. 给实施 AI 的元指令（先读这一节）

1. **本文件描述"系统必须表现出的行为"，不是"界面长什么样"。** UI 可自由设计，但字段、枚举、算法、状态机、校验、错误码必须逐条对齐。
2. **标注约定**
   - 🔒 = 硬约束。逐字符实现，不得"优化"、不得"简化"、不得改变语义。
   - 💡 = 实现建议。可用等价方案替换，但对外行为必须一致。
   - ⚠️ = 已知缺陷 / 历史坑。新系统**必须修掉**，不要照抄。
3. **优先级**：数据模型（§3） > 判定算法（§5 §6 §7） > 状态机（§7 §8） > 校验（§9） > 接口（§10） > UI。
4. **禁止事项**（详见 §14）：不得自行改抽样表数值；不得合并"检验判定"与"审批"两步；不得把 Ac/Re 存在前端；不得允许"零检验项"的报告落库。
5. **验收标准**：§13 全部用例通过 + §11 全部不变量在数据库中可验证。任一用例失败即视为未完成。
6. 文中所有表名/字段名使用 `snake_case`（数据库口径），代码中可用 `camelCase`。**字段名不得改名**，因为 OA 与 WMS 之间有 JSON 契约（§10）。

---

## 1. 术语表

| 中文      | 代码名                 | 定义                                                  |
| ------- | ------------------- | --------------------------------------------------- |
| 物料      | `material`          | 被检验的对象（料号 + 名称 + 单位）。同一物料可有多个供应商                    |
| 供应商     | `supplier`          | 来料来源                                                |
| 收货单     | `receipt_order`     | 仓库一次收货记录，状态 `pending_iqc` 表示"待报检"                   |
| 检验批次    | `iqc_lot`           | **判定的最小单位**。多张收货单可并批成一个批次；一份批次只出一份报告                |
| 批量      | `lot_size`          | = `iqc_lot.total_qty`，并批后的合计数量。**是抽样计算的唯一输入**       |
| 检验模板    | `iqc_template`      | 某类物料的检验标准清单（哪些项目、什么规格、什么抽样方案）                       |
| 检验项目    | `template_item`     | 模板中的一行，如"外观无划伤"、"长度 10±0.1"                         |
| 检验工段    | `section_type`      | 项目所属分类：包装/外观/尺寸/功能可靠性/环保，共 5 类                      |
| 检验报告    | `iqc_report`        | 一个批次一份，含最终判定 `pass`/`fail`                          |
| 检验记录    | `inspection_record` | 报告下的一行 = 一个项目的实测数据与单项判定                             |
| 抽样方案    | `sampling_plan`     | 形如 `G-II`、`S-2`、`N=5`、`全检` 的文本，决定怎么抽                |
| 检验水平    | `inspection_level`  | GB/T 2828.1 的 S-1~S-4 / I / II / III（业务常写 G-Ⅱ = II） |
| AQL     | `aql`               | 接收质量限，如 `0.40`、`1.0`、`2.5`                          |
| 样本量字码   | `code_letter`       | GB/T 2828.1 表1 输出的字母 A~R（跳过 I、O）                    |
| 抽样数量    | `sample_size`       | 实际要抽检的件数                                            |
| Ac / Re | `ac` / `re`         | 接收数 / 拒收数。**不良数 ≤ Ac 判接收，≥ Re 判拒收**                 |
| spec    | `spec`              | 规格文本，如 `10±0.1`、`≤5`、`3.15~4.15`，用于判定每个实测值是否超差。**全链路统一为 spec**（历史拼写 spc 已于 2026-10-22 全部清理） |
| 严格度     | `strictness`        | 物料级的检验强度状态：正常/加严/放宽/暂停/免检                           |
| 并批      | merge               | 同供应商+同物料+同生产日期+同批号的多张收货单合成一个检验批次                    |
| MRB     | `mrb`               | 不合格品评审委员会流程，IQC 判 fail 审批通过后自动创建                    |
| 欠料冲减    | supplier debt       | 供应商历史欠料在本次来料合格时按数量抵扣                                |

---

## 2. 系统边界与数据所有权

### 2.1 职责划分（🔒）

| 能力            | OA（本次重写目标）    | WMS（保持不动）        |
| ------------- | ------------- | ---------------- |
| 检验模板库维护       | ✅ 主责          | ❌ 只读同步           |
| 检验批次生成（收料/并批） | ❌             | ✅ 主责（OA 只读消费）    |
| 待检任务列表        | ✅ 主责          | 提供数据源            |
| 检验录入（实测值、不良数） | ✅ 主责          | ❌                |
| 抽样数量推定        | ✅ 主责（本地算法）    | 提供只读计算服务兜底       |
| 单项/批次判定       | ✅ 主责          | 落库时二次校验          |
| 检验报告生成与打印     | ✅ 主责          | 只读               |
| 报告审批（主管）      | ✅ 主责（OA 流程引擎） | 接收回调             |
| 库存迁移（良品/不良品仓） | ❌             | ✅ 主责             |
| 欠料冲减          | ❌             | ✅ 主责             |
| MRB 建单        | ❌             | ✅ 主责（OA 接收并走评审流） |
| 严格度状态机        | ❌             | ✅ 主责（OA 只展示）     |

> **关键原则（🔒）**：OA 是"判定与审批"的主人，WMS 是"库存与批次"的主人。**OA 绝不允许直接改库存**，只能通过 §10.3 的提交/审批接口通知 WMS。

### 2.2 数据流向

```
WMS 收货 ──► iqc_lot(pending) ──HTTP──► OA 待检列表
                                          │
                              OA 认领 + 打开检验单
                                          │
                    模板库 → 项目清单 → 【抽样方案推定算法】→ 抽样数量/Ac/Re
                                          │
                             检验员录入实测值 ──►【spec 判定】──► 单项判定
                                          │
                             全部单项 AND ──► 批次判定 pass/fail
                                          │
                             提交 ──HTTP──► WMS 落报告(review_status=pending)
                                          │
                              OA 审批流（主管）通过
                                          │
                     ┌────────────────────┴────────────────────┐
              回调 WMS /approve                        OA 留档 + 报告打印
                     │
        库存迁移 + 欠料冲减 + 自动MRB + 严格度转移（WMS 事务内）
```

---

## 3. 领域模型

### 3.1 实体关系

```
material 1───n template_material n───1 iqc_template 1───n template_item
                                                        │
                      (模板匹配)                          │ 项目快照
                                                        ▼
receipt_order n───1 iqc_lot 1───1 iqc_report 1───n inspection_record
                      │                │
                      │                └── review_status: pending/approved/rejected
                      └── status: pending/inspecting/review_pending/rejected/pass/fail

material 1───1 inspection_strictness 1───n strictness_transfer_log
                     └── 1───n lot_strictness_count（计数台账，幂等键）
```


### 3.2 表定义

#### 3.2.1 `iqc_template`（检验模板库）

| 字段                          | 类型            | 约束                        | 语义                     |
| --------------------------- | ------------- | ------------------------- | ---------------------- |
| `id`                        | uuid          | PK                        |                        |
| `template_name`             | varchar(200)  | NOT NULL                  | 模板名，如"电容-来料检验"         |
| `template_code`             | varchar(50)   |                           | 模板编码，业务检索用             |
| `version`                   | varchar(20)   | default `1.0`             |                        |
| `status`                    | varchar(20)   | NOT NULL default `active` | `active` / `inactive`  |
| `packaging_aql`             | varchar(20)   |                           | 包装工段默认 AQL             |
| `appearance_level`          | varchar(20)   | default `G-II`            | 外观工段默认检验水平             |
| `appearance_aql`            | varchar(20)   | default `0.4`             | 外观工段默认 AQL             |
| `dimension_level`           | varchar(20)   | default `S-2`             | 尺寸工段默认检验水平             |
| `dimension_aql`             | varchar(20)   | default `0.4`             | 尺寸工段默认 AQL             |
| `reliability_sample_size`   | int           | default 2                 | 可靠性工段固定抽样数             |
| `environmental_sample_size` | int           | default 1                 | 环保工段固定抽样数              |
| `selected_sections`         | varchar(30)[] | NOT NULL default `[]`     | 启用的工段，取值见 §3.3.2       |
| `raw_data`                  | jsonb         |                           | 从 Excel 导入的原始单元格/合并/列宽 |
| `description`               | text          |                           |                        |

> ⚠️ 上表 5 个 `*_level` / `*_aql` / `*_sample_size` 是**模板级默认值**，仅用于新建项目时预填。**运行期一律以 `template_item` 的行内值为准**（🔒）。这是历史踩坑点：曾有实现读模板级值覆盖了项目级值，导致同模板内不同项目被算成同一抽样数。

#### 3.2.2 `template_item`（模板项目行）

| 字段                              | 类型           | 约束                               | 语义                                            |
| ------------------------------- | ------------ | -------------------------------- | --------------------------------------------- |
| `id`                            | uuid         | PK                               |                                               |
| `template_id`                   | uuid         | FK → template, ON DELETE CASCADE |                                               |
| `section_type`                  | varchar(30)  | NOT NULL                         | 见 §3.3.2                                      |
| `item_name`                     | varchar(300) | NOT NULL                         | 项目名（必填，空名项目视为无效）                              |
| `item_name_vi` / `item_name_en` | varchar(300) |                                  | 越南语/英语名（多语言展示用）                               |
| `standard`                      | text         |                                  | 检验标准描述文本（如"无划伤、无变形"）                          |
| `spec`                          | varchar(50)  |                                  | **规格表达式**，供 §6 解析。🔒 字段名统一为 `spec`（历史笔误 `spc` 已废弃，见 §14.1 D-02） |
| `lsl` / `usl`                   | varchar(100) |                                  | 显式上下限；为空则从 `spec` 解析          |
| `unit`                          | varchar(20)  |                                  | 单位                                            |
| `aql`                           | varchar(20)  | default `0.4`                    | 该项目使用的 AQL                                    |
| `sampling_plan_text`            | varchar(100) |                                  | 抽样方案文本，如 `G-II` / `S-2` / `N=5` / `全检`        |
| `sample_size`                   | int          |                                  | 固定抽样数（方案为 `N=x` 或自定义时使用）                      |
| `ac` / `re`                     | int          |                                  | 固定接收/拒收数（仅非国标方案使用）                            |
| `sort_order`                    | int          | default 0                        | 同工段内排序                                        |
| `is_required`                   | boolean      | default true                     | 是否必检项                                         |

#### 3.2.3 `iqc_standard_item`（标准项目库）

字段与 `template_item` 完全相同（去掉 `template_id`）。作用：全局标准项目池，模板可"从标准库按工段导入"。导入语义：把同 `section_type` 的标准项目复制进模板（🔒 幂等：先删除该模板该工段的旧项目再插入，不追加）。

#### 3.2.4 `iqc_template_material`（模板↔物料绑定）

| `id` | `template_id` | `material_id` | 唯一键 `(template_id, material_id)` |

一个物料可绑定多个模板；开检验单时按**绑定关系 + 优先级**选模板（💡 建议：优先取该物料上次使用的模板 `last_template_id`，无则取最新 `active` 模板）。

#### 3.2.5 `iqc_lot`（检验批次）

| 字段                                 | 类型           | 约束                         | 语义                                                               |
| ---------------------------------- | ------------ | -------------------------- | ---------------------------------------------------------------- |
| `id`                               | uuid         | PK                         |                                                                  |
| `lot_no`                           | varchar(50)  | UNIQUE NOT NULL            | 批次号，来料报检批次以 `IQC` 开头（🔒 严格度计数靠这个前缀过滤）                            |
| `inspection_no`                    | varchar(50)  | UNIQUE                     | **检验编号 = 报告编号**，格式 `JY` + `yyyyMMdd` + 4 位日流水，如 `JY202610220007` |
| `receipt_date`                     | date         | NOT NULL                   | **首次**收货日（并批后不变）                                                 |
| `last_receipt_date`                | date         |                            | 最近一次到货日                                                          |
| `supplier_id`                      | uuid         |                            |                                                                  |
| `material_id`                      | uuid         | NOT NULL                   |                                                                  |
| `total_qty`                        | numeric      | NOT NULL                   | 并批后合计数量（**批量来源**）                                                |
| `unit`                             | varchar(20)  | NOT NULL default `PCS`     |                                                                  |
| `production_date`                  | date         |                            | 生产日期                                                             |
| `batch_no`                         | varchar(100) |                            | 供应商批号                                                            |
| `location_codes`                   | text         |                            | 库位码（可多值）                                                         |
| `box_count`                        | int          | default 0                  | 箱数                                                               |
| `material_source`                  | varchar(200) |                            | 物料来源                                                             |
| `inspector_id`                     | uuid         |                            | 检验员（报告表头用）                                                       |
| `approver_id`                      | uuid         |                            | 批准人                                                              |
| `inspection_result`                | varchar(20)  | default `pending`          | `pending`/`pass`/`fail`                                          |
| `defect_type`                      | varchar(50)  |                            | 不合格类型，判 fail 时必填，取值见 §3.3.4                                      |
| `inspection_time`                  | timestamptz  |                            |                                                                  |
| `status`                           | varchar(20)  | NOT NULL default `pending` | 见 §8.1                                                           |
| `remark`                           | text         |                            |                                                                  |
| `template_id` / `last_template_id` | uuid         | FK → template              | 本次/上次使用的模板                                                       |
| `oa_claimed_by`                    | varchar(100) |                            | OA 认领人（防双入口）                                                     |
| `oa_claimed_at`                    | timestamptz  |                            | 认领时间，4 小时 TTL                                                    |
| `oa_source`                        | varchar(10)  |                            | `oa`/`wms`/`null`，仅审计用，不参与判定                                     |

**并批规则（🔒）**：合并键 = `(supplier_id, material_id, production_date, batch_no)`（**不含** 收货日期）。仅当存在同键且 `status in ('pending','inspecting','review_pending','rejected')` 的批次时并入该批次（累加 `total_qty`、更新 `last_receipt_date`）；否则新建批次。已完成（pass/fail）的批次不可再并入，同键再来货视为新批次。

> ⚠️ 历史坑：合并键曾是 5 列含 `receipt_date` 且建了唯一索引，导致"同一天两次到货并批、隔天到货被静默丢弃"。新系统**必须**用 4 列键 + 部分唯一索引（`WHERE status in (...)`），且 `NULLS NOT DISTINCT`（生产日期/批号为空时也要能去重）。

#### 3.2.6 `iqc_report`（检验报告）

| 字段                                              | 类型                   | 约束                            | 语义                                                                  |
| ----------------------------------------------- | -------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `id`                                            | uuid                 | PK                            |                                                                     |
| `lot_id`                                        | uuid                 | **UNIQUE** NOT NULL           | 一批次一报告                                                              |
| `report_no`                                     | varchar(50)          | UNIQUE NOT NULL               | = `iqc_lot.inspection_no`（🔒 两处必须一致）                                |
| `final_result`                                  | varchar(20)          | NOT NULL                      | `pass` / `fail`                                                     |
| `inspector_id` / `inspection_time`              |                      |                               | 检验员与提交时间                                                            |
| `reviewer_id` / `review_time` / `review_remark` |                      |                               | 审批痕迹                                                                |
| `review_status`                                 | varchar(20)          | NOT NULL default `pending`    | `pending`/`approved`/`rejected`                                     |
| `reject_reason` / `reject_time` / `rejector_id` |                      |                               | 驳回痕迹                                                                |
| `judge_mode`                                    | varchar(20)          | NOT NULL default `inspection` | `inspection`=按项目推导（**唯一正常路径**）；`manual`=主管人工判定（仅当批次无任何有效项目时允许，原因必填） |
| `judge_reason` / `judged_by` / `judged_at`      |                      |                               | 人工判定痕迹                                                              |
| `oa_instance_id` / `oa_status`                  | bigint / varchar(20) |                               | OA 流程实例                                                             |
| `remark`                                        | text                 |                               |                                                                     |

#### 3.2.7 `inspection_record`（检验记录）

| 字段                          | 类型           | 说明                             |
| --------------------------- | ------------ | ------------------------------ |
| `lot_id`                    | uuid         | 冗余批次，便于按批查                     |
| `template_item_id`          | uuid         | 来源项目                           |
| `item_name`                 | varchar(200) | **快照**（模板改名不影响历史报告）            |
| `standard`                  | text         | 快照                             |
| `spec`                      | varchar(50)  | 快照（字段名 `spec`）                |
| `spec_min` / `spec_max`     | varchar(100) | = 解析后的 LSL / USL               |
| `unit`                      | varchar(20)  |                                |
| `measured_value`            | varchar(200) | 单值输入（非尺寸项）                     |
| `measured_values`           | jsonb        | 多值数组（尺寸项，长度为抽样数量）              |
| `defect_qty`                | numeric      | 不良数，default 0                  |
| `defect_description`        | text         | 不良描述                           |
| `is_pass`                   | boolean      | 单项判定结果                         |
| `section_type`              | varchar(30)  | 快照                             |
| `sampling_plan_text`        | varchar(100) | 快照                             |
| `aql`                       | varchar(20)  | 快照，**报告必须打印 AQL**              |
| `sample_size` / `ac` / `re` | int          | 快照——**报告上显示的是提交那一刻的值，不随严格度变化** |
| `sort_order`                | int          |                                |

> 🔒 **快照原则**：报告一旦提交，`inspection_record` 中所有项目属性（名称/规格/抽样方案/AQL/样本量/Ac/Re）都是快照，此后模板修改不得影响历史报告。

#### 3.2.8 `inspection_draft`（草稿）

`(lot_id UNIQUE, payload jsonb, inspector_id)`。`payload = {template_id, records[], remark, defectType, updatedAt}`。

> 🔒 **草稿与记录完全隔离**：草稿不参与判定、不产生报告、不影响库存。只解决"填一半断电不丢数据"。打开检验单时若存在草稿，优先载入草稿并用当前算法重算判定值（⚠️ 历史坑：曾把旧草稿里缓存的 `is_pass` 直接显示，导致解析器修复后仍显示旧结论）。

#### 3.2.9 严格度三表

`inspection_strictness`：

| 字段                               | 说明                                                  |
| -------------------------------- | --------------------------------------------------- |
| `material_id`                    | 唯一（按物料一条账，**不按工段拆分**）                               |
| `inspection_type`                | 固定写 `material`（兼容历史列的占位值）                           |
| `strictness`                     | `normal`/`tightened`/`reduced`/`suspended`/`exempt` |
| `inspection_level` / `aql`       | 该物料的默认水平与 AQL                                       |
| `consecutive_accepted`           | 连续接收批数                                              |
| `recent_rejected_in_5`           | 近 5 批不接收数（展示用）                                      |
| `tightened_rejected_total`       | 加严期累计不接收批数                                          |
| `tightened_consecutive_accepted` | 加严期连续接收批数                                           |
| `remark`                         | 人工调整原因                                              |

`strictness_transfer_log`：`(material_id, from_strictness, to_strictness, transfer_type: auto|manual, report_id, lot_id, reason, operator_id, operator_name)` —— **每次状态变化必须留痕，无日志即视为 bug**。

`lot_strictness_count`：`(lot_id, inspection_type) UNIQUE`，`(material_id, inspection_type, accepted, strictness_at_count)`。**这是"每批只计一次"的幂等锁**（🔒 唯一键冲突 = 已计过数，直接跳过）。

### 3.3 枚举字典（🔒 取值不得增删，新增需评审）

#### 3.3.1 批次状态 `iqc_lot.status`

| 值                | 含义            | 允许的下一状态                                       |
| ---------------- | ------------- | --------------------------------------------- |
| `pending`        | 待检            | `inspecting`, `review_pending`, `fail`(仅人工判定) |
| `inspecting`     | 检验中（已打开/已存草稿） | `review_pending`, `pending`(放弃)               |
| `review_pending` | 已提交，待审批       | `pass`, `fail`(审批通过), `rejected`(驳回)          |
| `rejected`       | 已驳回，需重检       | `inspecting`, `review_pending`                |
| `pass`           | 终态：接收         | —                                             |
| `fail`           | 终态：拒收         | —                                             |

#### 3.3.2 检验工段 `section_type`

| 值               | 中文    | 排序 | 默认方案         | 数据形态              |
| --------------- | ----- | -- | ------------ | ----------------- |
| `packaging`     | 包装    | 1  | 固定抽样数        | 单值/文字             |
| `appearance`    | 外观    | 2  | `G-II` + AQL | 单值/不良数            |
| `dimension`     | 尺寸&功能 | 3  | `S-2` + AQL  | **多值数组**（每格一个实测值） |
| `reliability`   | 可靠性   | 4  | `N=2`        | 单值                |
| `environmental` | 环保    | 5  | `N=1`        | 单值                |

#### 3.3.3 判定/审核

- `final_result` / `inspection_result`：`pass` | `fail`
- `review_status`：`pending` | `approved` | `rejected`
- `judge_mode`：`inspection` | `manual`
- `strictness`：`normal` | `tightened` | `reduced` | `suspended` | `exempt`

#### 3.3.4 不合格类型 `defect_type`（判 fail 时**必填**，八选一）

`包装`、`外观`、`尺寸`、`功能`、`安规`、`可靠性`、`环保`、`无检验资料`

> 🔒 值必须是上述中文字符串之一，不得存英文键。历史库里曾有 `appearance`/`packaging` 等英文值，新系统必须做归一映射（`appearance→外观` 等）。

---

## 4. 主业务流程（10 步）

| #  | 步骤    | 触发者      | 输入       | 输出 / 副作用                                                                 | 失败处理                   |
| -- | ----- | -------- | -------- | ------------------------------------------------------------------------ | ---------------------- |
| 1  | 收货    | 仓管       | 收货单      | `receipt_order(status=pending_iqc)`                                      | —                      |
| 2  | 报检    | 仓管       | 若干收货单    | 按 §3.2.5 并批生成/更新 `iqc_lot(status=pending)`，生成 `inspection_no`            | 编号冲突则重试取号（唯一键冲突不报错）    |
| 3  | 拉取待检  | OA 定时/实时 | —        | OA 待检列表                                                                  | 拉取失败保留上次快照并标黄          |
| 4  | 认领    | 检验员      | `lot_no` | `oa_claimed_by/at`；4h 未提交自动释放                                            | 已被他人认领 → 409           |
| 5  | 打开检验单 | 检验员      | `lot_id` | 模板 → 项目快照 → **抽样推定(§5)** → 空记录                                           | 无模板 → 阻断并提示"请先绑定模板"    |
| 6  | 录入    | 检验员      | 实测值/不良数  | 每格即时 spec 判定(§6)，自动累计 `defect_qty`；每 5 秒存草稿                              | 解析失败不阻断，标黄提示           |
| 7  | 提交    | 检验员      | 全部记录     | 二次校验(§9) → 推导批次结论 → 落 `report(pending)` + `records`；批次置 `review_pending` | 校验失败逐条返回 §9 错误码        |
| 8  | 审批    | 品质主管     | 报告       | 通过 → 回调 WMS；驳回 → `review_status=rejected`，原因必填                           | 重复审批 409               |
| 9  | 落账    | WMS      | 回调       | 库存迁移 + 欠料冲减 + 自动 MRB + 严格度转移，**同一事务**                                    | 失败整体回滚，OA 侧显示"落账失败待重试" |
| 10 | 归档/打印 | —        | 报告       | 报告 PDF，文件名 `{检验编号}-{物料编号}`（🔒）                                           | —                      |

> 🔒 **第 7 步与第 8 步必须分离**：提交 ≠ 审批通过。提交只写 `review_pending`，不改库存；只有审批通过才落账。

---

## 5. 算法 A：抽样方案与抽样数量推定（核心）

### 5.1 输入 / 输出

```jsonc
// 输入（单个检验项目）
{
  "lotSize": 1200,            // = iqc_lot.total_qty，整数，>=2
  "inspectionLevel": "G-II",  // 来自 sampling_plan_text
  "aql": "0.40",              // 项目级 aql
  "strictness": "normal",     // 物料当前严格度
  "samplingPlanText": "G-II", // 原始文本，用于判断分支
  "fixedSampleSize": null,    // 模板固定值（兜底）
  "fixedAc": null,
  "fixedRe": null,
  "sectionType": "dimension"
}
// 输出
{
  "codeLetter": "J",
  "sampleSize": 80,
  "ac": 0,
  "re": 1,
  "applied": true,            // false = 沿用模板固定值，未走国标表
  "strictness": "normal",
  "inspectionLevel": "II",    // 归一化后的水平
  "aql": "0.40",
  "fullInspection": false     // 见 §5.7 全检规则
}
```

### 5.2 归一化（🔒 先归一，再查表）

**检验水平归一**（`normalizeLevel`）：

1. `trim()` → 全角转半角 → 转大写
2. 全角罗马数字 `Ⅰ Ⅱ Ⅲ` → `I II III`
3. 去掉 `G-` 前缀、去空格/下划线
4. 映射表：

| 输入                          | 归一结果           |
| --------------------------- | -------------- |
| `S-1`/`S1`                  | `S-1`          |
| `S-2`/`S2`                  | `S-2`          |
| `S-3`/`S3`                  | `S-3`          |
| `S-4`/`S4`                  | `S-4`          |
| `I`/`1`/`G-Ⅰ`/`G1`          | `I`            |
| `II`/`2`/`G-Ⅱ`/`G2`/`GII`   | `II`           |
| `III`/`3`/`G-Ⅲ`/`G3`/`GIII` | `III`          |
| 其它任何值                       | **`II`**（不得抛错） |

**AQL 归一**（`normalizeAql`）：`parseFloat` 后到 §附录A.1 的 26 个标准列里找数值相等者，返回标准字符串；找不到则返回原串（后续查表会失败 → 走兜底）。

> ⚠️ `0.4` 与 `0.40` 必须等价；`1` 与 `1.0` 必须等价。

### 5.3 步骤 1：批量 → 样本量字码（表 1，🔒 完整表）

| 批量下限   | 批量上限   | S-1 | S-2 | S-3 | S-4 | I | II | III |
| ------ | ------ | --- | --- | --- | --- | - | -- | --- |
| 2      | 8      | A   | A   | A   | A   | A | A  | B   |
| 9      | 15     | A   | A   | A   | A   | A | B  | C   |
| 16     | 25     | A   | A   | B   | B   | B | C  | D   |
| 26     | 50     | A   | B   | B   | C   | C | D  | E   |
| 51     | 90     | B   | B   | C   | C   | C | E  | F   |
| 91     | 150    | B   | B   | C   | D   | D | F  | G   |
| 151    | 280    | B   | C   | D   | E   | E | G  | H   |
| 281    | 500    | B   | C   | D   | E   | F | H  | J   |
| 501    | 1200   | C   | C   | E   | F   | G | J  | K   |
| 1201   | 3200   | C   | D   | E   | G   | H | K  | L   |
| 3201   | 10000  | C   | D   | F   | G   | J | L  | M   |
| 10001  | 35000  | C   | D   | F   | H   | K | M  | N   |
| 35001  | 150000 | D   | E   | G   | J   | L | N  | P   |
| 150001 | 500000 | D   | E   | G   | J   | M | P  | Q   |
| 500001 | ∞      | D   | E   | H   | K   | N | Q  | R   |

> 表 1 覆盖 2 ~ ∞，**不存在"批量超范围"**。批量 < 2 直接拒绝（见 §5.8）。字码序列中**没有 I 和 O**（避免与数字 1、0 混淆），顺序为 `A B C D E F G H J K L M N P Q R S`。

### 5.4 步骤 2：字码 + AQL + 严格度 → Ac/Re（表 2-A / 2-B / 2-C）

三张表都是 17 行（字码） × 26 列（AQL）。**表数据见附录 A**，此处只给算法：

```text
function resolveAcRe(table, sampleSizeMap, codeLetter, aqlIndex):
    cur = codeLetter
    for guard in 1..17:
        cell = table[cur][aqlIndex]
        if cell is [ac, re]:  return { codeLetter: cur, sampleSize: sampleSizeMap[cur], ac, re }
        if cell == '↓':      cur = nextLetter(cur)      # 向下找第一个有数字的行
        elif cell == '↑':    cur = prevLetter(cur)      # 向上找第一个有数字的行
        else: break                                      # 越界
    return FALLBACK(codeLetter, sampleSizeMap)           # 见 §5.8
```

**箭头语义（🔒 极易实现错）**：

- `↓`：本格无方案，**沿同 AQL 列向下**找第一个有方案的行，用那一行的 Ac/Re **和那一行的样本量**。样本量不是原字码的样本量。
- `↑`：沿同 AQL 列**向上**找第一个有方案的行。
- 例：批量 100、水平 II、AQL 0.40 → 表1 得 `F`；表2-A `F` 行 AQL 0.40 为 `↓` → `G`(↓) → `H`(↓) → `J` 得 `[0,1]`；样本量取 `J`=80。**正确结果：80/0/1，不是 20/0/1。**

### 5.5 步骤 3：字码 → 样本量

| 字码 | A | B | C | D | E  | F  | G  | H  | J  | K   | L   | M   | N   | P   | Q    | R    | S    |
| -- | - | - | - | - | -- | -- | -- | -- | -- | --- | --- | --- | --- | --- | ---- | ---- | ---- |
| 正常 | 2 | 3 | 5 | 8 | 13 | 20 | 32 | 50 | 80 | 125 | 200 | 315 | 500 | 800 | 1250 | 2000 | —    |
| 加严 | 2 | 3 | 5 | 8 | 13 | 20 | 32 | 50 | 80 | 125 | 200 | 315 | 500 | 800 | 1250 | 2000 | 3150 |
| 放宽 | 2 | 2 | 2 | 3 | 5  | 8  | 13 | 20 | 32 | 50  | 80  | 125 | 200 | 315 | 500  | 800  | —    |

> 🔒 放宽表的样本量**不是**正常表的一半，而是按上表逐字码取值。不要把 `sampleSize = normal/2` 当实现。

### 5.6 逐项推定 `planForItems`（打开检验单时对每个项目执行）

分支判定顺序（🔒 顺序不可调换）：

```text
scheme = trim(item.samplingPlanText) || 'G-II'
fallback = { sampleSize: item.sampleSize||0, ac: item.ac||0, re: item.re||1 }

# 分支 1：固定样本量  N=5 / N=1
if /^N\s*=\s*(\d+)/i matches scheme:
    return { sampleSize: 匹配到的数字, ac: fallback.ac, re: fallback.re||1,
             strictness:'fixed', applied:false }

# 分支 2：全检 / 免检 / 自定义文本 → 沿用模板值
if 无法把 scheme 归一成 S-1..S-4 / I / II / III:
    return { ...fallback, strictness:'fixed', applied:false }

# 分支 3：国标方案 → 查表
strictness = (sectionType=='dimension' ? 物料.dimensional : 物料.appearance) || 'normal'
try:
    plan = calculateSamplingPlan(strictness, level, item.aql||'0.40', lotSize)
    return { ...plan, strictness, applied:true }
catch:
    return { ...fallback, strictness, applied:false }
```

- `applied=false` 的项目**不随后续严格度变化而改变抽样数**（🔒）。
- `applied=true` 的项目在严格度切换（正常↔加严↔放宽）后必须**重算**，前端要提供"切换方案"操作并提示"抽样数已由 X 变为 Y"。
- 严格度**按物料一条账**，外观与尺寸共用同一档（历史实现曾分两档，已废弃）。

### 5.7 全检规则（⚠️ 现系统缺失，新系统必须实现）

GB/T 2828.1 规定：**当样本量 ≥ 批量时应进行 100% 全检**。  
现系统未做此约束，导致 `批量=2` 时算出 `sampleSize=80`（荒谬值，且前端会渲染 80 个输入格）。

🔒 新系统规则：

```text
if (sampleSize >= lotSize) {
    sampleSize = lotSize;
    fullInspection = true;   // 报告上标注「全检」，Ac/Re 照常显示但不再作为接收依据
}
```

### 5.8 边界与兜底

| 场景             | 行为                          | 错误码                     |                   |              |
| -------------- | --------------------------- | ----------------------- | ----------------- | ------------ |
| `lotSize < 2`  | 抛错，不返回方案                    | `E-SAMP-001` 批量必须大于等于 2 |                   |              |
| AQL 不在 26 列内   | **不抛错**，走兜底方案并记 warning 日志  | `W-SAMP-002`            |                   |              |
| 箭头越界（走到表末仍无方案） | 兜底：\`sampleSize = 样本量表[原字码] |                         | 2`，`ac=0`,`re=1\` | `W-SAMP-003` |
| 表行缺失           | 同兜底                         | `W-SAMP-003`            |                   |              |
| `lotSize` 非整数  | `Math.trunc` 后使用            | —                       |                   |              |

> 🔒 **兜底必须记日志且必须在报告上可见**（UI 打 ⚠️ 标记）。静默兜底会让"全部合格才接收"这种超严判定悄悄生效，事后无法追溯。

### 5.9 黄金测试向量（🔒 逐条写成单测，全通过才算实现正确）

| #  | strictness | level | aql  | lotSize | codeLetter | sampleSize | Ac | Re |                        |
| -- | ---------- | ----- | ---- | ------- | ---------- | ---------- | -- | -- | ---------------------- |
| 1  | normal     | II    | 0.40 | 100     | J          | 80         | 0  | 1  |                        |
| 2  | normal     | II    | 0.40 | 1200    | J          | 80         | 0  | 1  |                        |
| 3  | normal     | II    | 1.0  | 3200    | K          | 125        | 5  | 6  |                        |
| 4  | normal     | II    | 2.5  | 80      | E          | 13         | 2  | 3  |                        |
| 5  | normal     | S-2   | 0.40 | 500     | J          | 80         | 0  | 1  |                        |
| 6  | normal     | S-4   | 0.65 | 150     | F          | 20         | 0  | 1  |                        |
| 7  | normal     | III   | 0.10 | 1250    | L          | 200        | 0  | 1  |                        |
| 8  | normal     | II    | 0.65 | 5000    | L          | 200        | 5  | 6  |                        |
| 9  | normal     | II    | 4.0  | 20000   | M          | 315        | 21 | 22 |                        |
| 10 | normal     | I     | 1.5  | 50      | E          | 13         | 1  | 2  |                        |
| 11 | normal     | II    | 0.40 | 8       | J          | 80         | 0  | 1  |                        |
| 12 | tightened  | II    | 0.40 | 100     | H          | 50         | 0  | 1  |                        |
| 13 | tightened  | II    | 0.40 | 1200    | J          | 80         | 1  | 2  |                        |
| 14 | tightened  | G-II  | 1.0  | 3200    | K          | 125        | 5  | 6  |                        |
| 15 | tightened  | II    | 2.5  | 80      | H          | 50         | 5  | 6  |                        |
| 16 | tightened  | S-2   | 0.40 | 500     | H          | 50         | 0  | 1  |                        |
| 17 | tightened  | II    | 6.5  | 20000   | M          | 315        | 27 | 28 |                        |
| 18 | reduced    | II    | 0.40 | 100     | H          | 20         | 0  | 1  |                        |
| 19 | reduced    | II    | 1.0  | 1200    | J          | 32         | 1  | 2  |                        |
| 20 | reduced    | S-2   | 0.65 | 500     | G          | 13         | 0  | 1  |                        |
| 21 | normal     | II    | 0.40 | 2       | A          | 2          | 0  | 1  | ← 应用 §5.7 后（原系统给 J/80） |

---

## 6. 算法 B：spec 判定

### 6.1 判定分层

```
测量值 ──[6.3 单值判定]──► 超差个数 ──► defect_qty ──[6.4 项目判定]──► is_pass ──[6.5]──► final_result
```

### 6.2 `spec` 解析规则（🔒 按顺序匹配，先命中者生效）

预处理：

1. `trim()`，删除所有空白
2. 科学计数：`10^9` → `1000000000`，`1.5e6` → `1500000`
3. 逗号小数归一：`(\d),(\d{1,2})(?!\d)` → `$1.$2`（如 `3.15-4,15` → `3.15-4.15`）
4. 千分位剥离：`(\d),(\d{3})(?!\d)` → `$1$2`（如 `1,000-2,000` → `1000-2000`）

| 序  | 模式            | 示例                                          | 结果                         |
| -- | ------------- | ------------------------------------------- | -------------------------- |
| 1  | 含`不小于`/`不低于`  | `不小于5`                                      | lsl=5（闭）                   |
| 2  | 含`不大于`/`不高于`  | `不大于5`                                      | usl=5（闭）                   |
| 3  | 含`小于`/`低于`    | `小于5`                                       | usl=5（**开**：等于5判NG）        |
| 4  | 含`大于`/`高于`    | `大于5`                                       | lsl=5（**开**）               |
| 5  | 范围            | `3.15~4.15`、`10到20`、`5-8`、`5—8`、`5–8`、`5，8` | lsl=min, usl=max（闭）        |
| 6  | 前缀 `≤` / `<=` | `≤5`                                        | usl=5（闭）                   |
| 7  | 前缀 `＜` / `<`  | `<5`                                        | usl=5（**开**）               |
| 8  | 前缀 `≥` / `>=` | `≥5`                                        | lsl=5（闭）                   |
| 9  | 前缀 `＞` / `>`  | `>5`                                        | lsl=5（**开**）               |
| 10 | 含 `MAX`       | `5MAX`                                      | usl=5                      |
| 11 | 含 `MIN`       | `5MIN`                                      | lsl=5                      |
| 12 | 双向公差          | `10±0.1`、`10±5%`                            | lsl=base-tol, usl=base+tol |
| 13 | 上下偏差          | `10(+0.1/-0.2)`                             | lsl=10-0.2, usl=10+0.1     |
| 14 | 纯数字           | `5`                                         | **解析失败**（"请指定公差或上下限"）      |
| 15 | 其它            | `无划伤`                                       | **解析失败**（"无法识别的规格格式"）      |

> ⚠️ **规则 1-4 的顺序是坑**：`不小于5` 包含子串 `小于5`，必须先匹配否定式，否则会被解析成 `usl=5 开`，把合格品判成 NG。  
> ⚠️ 规则 5 的分隔符包含全角 `～` 和中文逗号 `，`。

### 6.3 单值判定 `isOutOfSpec(value, spec)`

```text
if value 为空/undefined/null:            return false   # 空值不判 NG
n = parseFloat(value); if not finite:    return false
spec = parse(specText)
if not spec.valid:                       return false   # 解析不了不自动判定，交人工
if spec.lsl != null:
    if n <  spec.lsl:                    return true
    if spec.lslExclusive and n == spec.lsl: return true
if spec.usl != null:
    if n >  spec.usl:                    return true
    if spec.uslExclusive and n == spec.usl: return true
return false
```

🔒 **失败即放行**：空值、非数值、规格解析失败一律返回"没超差"，由检验员手工填不良数。系统**不得**因解析失败而阻拦提交或自动判 NG。

### 6.4 项目判定

```text
is_pass = defect_qty <= ac          # ac 为空时按 ac=0 处理（即不良数必须为 0）
```

- **尺寸工段**：`defect_qty` 自动 = `count(isOutOfSpec(v, spec) for v in measured_values)`，检验员改动 spec 或任一实测值时**必须立刻重算**并同步 `is_pass`。
- **非尺寸工段**：`measured_value` 可为文字（如"无划伤 OK"），`defect_qty` 由检验员手填，`is_pass` 随 `defect_qty`/`ac` 自动算。
- 手工改 `is_pass` 的入口 🔒 **不提供**（避免与 Ac 规则冲突）。

### 6.5 批次判定

```text
final_result = 'fail' if 任一 record.is_pass === false else 'pass'
```

🔒 **单向纠正规则**：报告详情读取时，若库中 `final_result='pass'` 但存在任一 `is_pass=false` 的记录，**输出必须纠正为 `fail`** 并记 warning。反向不成立（全部合格也可以是 fail，例如人工判定）。

### 6.6 `is_pass` 缺失的历史数据兼容

`is_pass` 为 `null` 时，按 `defect_qty <= ac` 现算，**不得默认 false**。

> ⚠️ 历史坑：曾把缺失当 `false`，导致"全部没填却判 fail"和"有 NG 却判 pass"两种自相矛盾的报告。

---

## 7. 算法 C：严格度状态机

### 7.1 状态

| 状态          | 含义   | 抽样影响                |
| ----------- | ---- | ------------------- |
| `normal`    | 正常检验 | 用表 2-A              |
| `tightened` | 加严检验 | 用表 2-B（样本量不变，Ac 更严） |
| `reduced`   | 放宽检验 | 用表 2-C（样本量更小）       |
| `suspended` | 暂停检验 | **禁止提交检验**（硬拦截）     |
| `exempt`    | 免检   | 不生成检验任务             |

### 7.2 转移规则（🔒 触发点：报告审批通过后，每次一批）

计数口径（🔒 极重要）：

- 计数单位是**检验批次**（`iqc_lot`），不是收货单张数。
- **只统计来料报检批次**：`lot_no` 必须以 `IQC` 开头。超期复检（`EXP` 前缀）等不计。
- 每批只计一次（`lot_strictness_count` 唯一键保证幂等）。
- 只看**整份报告的最终判定**，不按工段拆分。

转移表：

| 当前          | 条件                            | 新状态                  | 必须写入的 reason         |
| ----------- | ----------------------------- | -------------------- | -------------------- |
| `normal`    | 最近 5 批中不接收（fail）≥ **2** 批     | `tightened`          | `近5批中有N批不接收，转为加严检验`  |
| `normal`    | 最近 **10** 批全部接收（且已满 10 批）     | `reduced`            | `正常检验连续10批接收，转为放宽检验` |
| `tightened` | 连续接收 ≥ **5** 批                | `normal`             | `加严检验连续N批接收，恢复正常检验`  |
| `tightened` | 累计不接收（加严期内）≥ **5** 批          | `suspended`          | `加严检验累计N批不接收，暂停检验`   |
| `reduced`   | 出现 **1** 批不接收                 | `normal`             | `放宽检验出现1批不接收，恢复正常检验` |
| `suspended` | 人工恢复（品质主管，原因必填）               | `tightened`          | 人工                   |
| `reduced`   | 人工转免检，前置条件：放宽期连续接收 ≥ **10** 批 | `exempt`             | 人工                   |
| 任意          | 人工改正常/加严（原因必填）                | `normal`/`tightened` | `人工调整为...：{原因}`      |

**窗口计算（🔒 用真实序列，不要用加减计数）**：

```text
recent = 该物料(inspection_type='material') 最近 10 条 count 记录，按 created_at DESC
flags  = map(recent, r => r.accepted)          # index 0 = 最新
rejectedIn5 = count(flags[0..4] == false)
acceptedStreak = 从 index 0 起连续 true 的个数（遇 false 停止）
allAcceptedIn10 = flags.length >= 10 && all(flags[0..9] == true)
```

> ⚠️ 历史坑：曾用"接收就减 1"的衰减计数表示"近 5 批拒收数"，序列 `R A A R` 时计数是 `1→0→0→1`，"5 批内 2 批拒收"永远触发不了。**必须**直接读最近 N 条的原始结果。

`exempt`/`suspended` 状态**不参与计数**（直接 return，不写 count 台账）。

### 7.3 暂停的硬拦截

提交检验时（服务端，不是仅前端）：

```text
if 物料当前 strictness == 'suspended':
    throw E-STRICT-001 "该物料检验已暂停，不能提交检验。请品质主管确认供应方改进后恢复加严检验。"
```

### 7.4 审计

每次状态变化必须插一条 `strictness_transfer_log`，字段齐全（谁、何时、从哪到哪、为什么、关联报告/批次）。🔒 无日志的状态变化视为缺陷。

---

## 8. 状态机：批次与报告

### 8.1 `iqc_lot.status`（见 §3.3.1）

```
pending ──打开检验单──► inspecting ──提交──► review_pending ──通过──► pass
   │                       │                    │              └──► fail
   │                       └──放弃──► pending    └──驳回──► rejected ──重检──► reviewing...
   └──人工判定(无项目)──────────────────────────► pass / fail
```

**提交时的 CAS 守卫（🔒 必须做，且必须在 SQL 的 WHERE 里做）**：

```sql
UPDATE iqc_lot SET ... WHERE id=$1 AND status NOT IN ('pass','fail','review_pending');
-- 影响行数 = 0 → 抛「该批次已完成检验，不可重复提交」（或 404 若批次不存在）
```

> ⚠️ 历史坑：先 SELECT 再 UPDATE 的写法在并发下两个请求都能通过，导致已有报告被回退状态、审批痕迹被抹掉。**必须**用条件更新（影响行数判定），不得用"先查后改"。

### 8.2 `iqc_report.review_status`

```
pending ──审批通过──► approved（终态，不可再改）
   └────驳回──► rejected ──重新提交──► pending（原位更新同一条报告，不新增）
```

审批通过（🔒 全部在**一个事务**内）：

1. CAS 抢占：`UPDATE iqc_report SET review_status='approved' WHERE id=$1 AND review_status IS DISTINCT FROM 'approved'`，影响行数=0 → 409「该检验报告已审批，请勿重复审批」
2. 批次同步：`UPDATE iqc_lot SET status=final_result, approver_id=... WHERE id=$1 AND status IN ('pending','inspecting','review_pending','rejected')`
3. 库存迁移（fail 时不良品入不良仓并锁定；pass 时解除锁定入良品仓）
4. `pass` 且供应商+物料齐备 → 欠料冲减

事务外（允许失败，各自幂等，失败只记日志不阻断）：  
5\. `fail` → 自动创建 MRB（原因：`IQC检验不合格主管审批通过，自动触发MRB评审`），再入队推送 OA  
6\. 严格度转移（§7.2）

> ⚠️ 历史坑：库存流转和欠料冲减曾在事务外且用 try/catch 吞异常，造成"审批通过但不良品未隔离""重复审批重复扣减"。**必须**进事务、失败即回滚。

---

## 9. 校验规则清单（🔒 全部在服务端执行，前端只做体验）

| 编号   | 规则                                                                        | 触发点   | 错误文案                                               |
| ---- | ------------------------------------------------------------------------- | ----- | -------------------------------------------------- |
| V-01 | `lot_size >= 2`，否则拒绝计算抽样                                                  | 打开检验单 | 批量必须大于等于 2                                         |
| V-02 | 有效检验项目数 > 0                                                               | 提交    | 检验记录为空，不能提交。若该批次确实无需检验小项，请由 IQC 主管使用「人工判定」并填写原因    |
| V-03 | 每个项目 `item_name` 非空                                                       | 提交    | 第 N 行检验项目名称为空                                      |
| V-04 | 尺寸项目实测值全部为数值或空                                                            | 提交    | 第 N 行「{项目}」存在非数值输入：{值}                             |
| V-05 | `defect_qty` 为非负整数                                                        | 提交    | 第 N 行不良数必须为 0 或正整数                                 |
| V-06 | `defect_qty <= sample_size`（🔒 不良数不能超过抽样数）                                | 提交    | 第 N 行不良数（{x}）超过抽样数量（{y}）                           |
| V-07 | `final_result` 必须由记录推导得出，前端传值仅作参考（不一致时以推导值为准并记 warning）                   | 提交    | —                                                  |
| V-08 | 判 `fail` 时 `defect_type` 必填且属于八项之一                                        | 提交    | 检验判定为不合格时必须选择不合格类型（可选：包装、外观、尺寸、功能、安规、可靠性、环保、无检验资料） |
| V-09 | 批次状态不在 `pass/fail/review_pending`                                         | 提交    | 该批次已完成检验，不可重复提交                                    |
| V-10 | 物料严格度 ≠ `suspended`                                                       | 提交    | 该物料检验已暂停，不能提交检验。请品质主管确认供应方改进后恢复加严检验。               |
| V-11 | 报告存在且 `review_status != approved`                                         | 审批    | 该检验报告已审批，请勿重复审批                                    |
| V-12 | 驳回原因非空                                                                    | 驳回    | 请填写驳回原因                                            |
| V-13 | 认领未过期（4h）且认领人一致                                                           | 提交    | 该批次已被 {name} 认领，请联系其释放                             |
| V-14 | `judge_mode='manual'` 仅在 `inspection_record` 数为 0 时允许，且 `judge_reason` 必填 | 人工判定  | 该批次已有检验记录，不能人工判定                                   |
| V-15 | 人工调整严格度必须填原因                                                              | 严格度页  | 请填写调整原因                                            |
| V-16 | 免检转换前置：`reduced` + 连续接收 ≥ 10                                              | 严格度页  | 放宽检验需连续10批接收才能转免检，当前已连续 N 批                        |
| V-17 | `spec` 解析失败不阻断，但要在该行显示"规格无法识别，判定需人工确认"                                     | 录入    | （黄色提示，非阻断）                                         |
| V-18 | 模板必须已绑定该物料                                                                | 打开检验单 | 该物料未绑定检验模板，请先在模板库中绑定                               |
| V-19 | 提交时 `sample_size/ac/re` 以提交那一刻的记录值为快照写入                                   | 提交    | —                                                  |
| V-20 | 报告编号必须 = 批次检验编号；缺失时才自动取号 `JY+yyyyMMdd+4位`                                 | 提交    | —                                                  |

---

## 10. 接口契约

### 10.1 OA 需要向 WMS 调用的接口（WMS 提供）

鉴权：请求头 `X-Api-Key: <OA_API_KEY>`（🔒 常量时间比较；未配置则一律 401）。

#### ① 抽样方案计算（单点）

```http
POST /api/oa/sampling
{ "lotSize": 1200, "inspectionLevel": "G-II", "aql": "0.40", "strictness": "normal" }
→ 200 { "lotSize":1200, "strictness":"normal", "inspectionLevel":"II",
        "aql":"0.40", "codeLetter":"J", "sampleSize":80, "ac":0, "re":1 }
```

#### ② 批量抽样计算（逐项）

```http
POST /api/iqc/sampling/plans
{ "materialId":"uuid", "lotSize":1200,
  "items":[ { "sectionType":"dimension", "samplingPlanText":"S-2", "aql":"0.40",
              "sampleSize":null,"ac":null,"re":null } ] }
→ 200 { "items":[ { "sampleSize":80,"ac":0,"re":1,"strictness":"normal",
                    "applied":true,"codeLetter":"J" } ], "strictness":"normal" }
```

#### ③ 认领 / 释放

```http
POST /api/oa/iqc/claim   { "lotNo":"IQC20261022001", "operator":"张三", "operatorId":"uuid" }
→ 200 { "claimed":true, "claimedBy":"张三", "expiresAt":"..." }
→ 409 { "error":"该批次已被李四认领" }

POST /api/oa/iqc/release { "lotNo":"IQC20261022001" }
```

#### ④ 提交检验结果

```http
POST /api/oa/iqc/result
{
  "lotNo":"IQC20261022001", "reportNo":"JY202610220007",
  "result":"fail", "defectType":"外观", "defectQty":3,
  "inspector": { "employeeNo":"E1001", "name":"张三" },
  "oaInstanceId": 12345,
  "items": [
    { "name":"外观","spec":"无划伤","measured":"有划伤","verdict":"ng","qty":3 },
    { "name":"长度","spec":"10±0.1","measured":10.15,"verdict":"ng","qty":1 }
  ],
  "contentHtml":"<富文本报告>"
}
→ 200 { "reportId":"uuid", "reviewStatus":"pending" }
→ 409 报告已审批 / 批次已完成判定
```

#### ⑤ 审批通过（触发落账）

```http
POST /api/oa/iqc/approve { "reportId":"uuid", "reviewerId":"uuid", "reviewerName":"李四", "remark":"同意" }
→ 200 { "reviewStatus":"approved", "finalResult":"fail", "mrbNo":"MRB20261022001" }
```

### 10.2 OA 必须提供给 WMS 的接口（WMS 回调）

#### ① 审批状态回调

```http
POST {OA_BASE}/api/integration/oa/callback
Headers: X-OA-Signature: HMAC-SHA256(rawBody, sharedSecret)
Body:
{
  "event": "node_passed" | "completed" | "rejected",
  "instanceId": 12345, "instanceNo": "FL20261022001",
  "bizSystem": "WMS", "bizType": "iqc_report", "bizKey": "JY202610220007",
  "status": "running", "nodeIndex": 1, "approver": "李四",
  "comment": "同意", "finalResult": "pass", "occurredAt": "2026-10-22T10:00:00Z"
}
```

🔒 语义约定（**历史最严重的坑，务必按此实现**）：

- `event=node_passed` → 中间节点通过，`status=running`，**不得携带终态语义**
- `event=completed` → **终态（审批通过）**。此时 payload 中**没有** `status:"approved"` 字段
- `event=rejected` → 终态（驳回），`status=rejected`
- 接收方判断终态必须写成：`approved = (event=='completed' || status=='approved')`

#### ② 幂等（🔒 接收方必须实现）

```sql
-- 幂等表
CREATE TABLE oa_callback_log (
  oa_instance_id bigint, event varchar(30), node_index int,
  biz_type varchar(40), biz_key varchar(80), payload jsonb, created_at timestamptz default now(),
  UNIQUE (oa_instance_id, event, node_index)
);
```

执行顺序必须是：**先查重 → 跑副作用 → 再写幂等记录**。

> ⚠️ 历史坑：先写日志再跑副作用，一旦副作用失败，日志已存在，重试被永久跳过 → 数据永久丢失。

#### ③ 验签（🔒 失败即拒绝，不得放行）

```text
secret = env.OA_WEBHOOK_SECRET
if (!secret) throw 401 "回调密钥未配置"
expected = HMAC_SHA256(secret, rawBody)   // 用原始字节，不是 JSON.stringify(parsed)
if (!timingSafeEqual(expected, header['x-oa-signature'])) throw 401
```

> ⚠️ 历史坑：签名用 `JSON.stringify(parsedBody)`，键序与空白可能与原始报文不同，导致验签随机失败。**必须**用 raw body。

### 10.3 提交/审批的重试与对账

- OA 提交失败 → 本地置 `pending_sync`，指数退避重试（1s/5s/30s/2min/10min，最多 10 次），超过则转人工。
- 每日凌晨对账：比对 OA 侧"已审批"与 WMS 侧"已落账"，差异输出报表。
- 🔒 所有跨系统写操作必须携带业务主键（`lotNo`/`reportNo`），接收方按主键做幂等 upsert。

---

## 11. 数据一致性不变量（可用 SQL 断言，🔒 全部必须成立）

| 编号   | 不变量                               | 断言                                                                                                                                                                                          |
| ---- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-01 | 一个批次最多一份报告                        | `SELECT lot_id, count(*) FROM iqc_report GROUP BY 1 HAVING count(*)>1` → 空                                                                                                                  |
| I-02 | 报告编号 = 批次检验编号                     | `SELECT r.report_no, l.inspection_no FROM iqc_report r JOIN iqc_lot l ON l.id=r.lot_id WHERE r.report_no IS DISTINCT FROM l.inspection_no` → 空                                              |
| I-03 | 已审批报告的批次必须是终态                     | `... WHERE r.review_status='approved' AND l.status NOT IN ('pass','fail')` → 空                                                                                                              |
| I-04 | 批次终态与报告结论一致                       | `... WHERE l.status IN ('pass','fail') AND l.status <> r.final_result` → 空                                                                                                                  |
| I-05 | 有 NG 记录的报告结论必须 fail               | `... WHERE r.final_result='pass' AND EXISTS(SELECT 1 FROM iqc_inspection_record x WHERE x.lot_id=r.lot_id AND x.is_pass=false)` → 空                                                         |
| I-06 | 判 fail 的批次必须有 `defect_type` 且在八项内 | `... WHERE inspection_result='fail' AND (defect_type IS NULL OR defect_type NOT IN (...))` → 空                                                                                              |
| I-07 | 每个进行中批次唯一                         | `SELECT supplier_id,material_id,production_date,batch_no,count(*) FROM iqc_lot WHERE status IN ('pending','inspecting','review_pending','rejected') GROUP BY 1,2,3,4 HAVING count(*)>1` → 空 |
| I-08 | 严格度计数一批一次                         | `SELECT lot_id,count(*) FROM iqc_lot_strictness_count GROUP BY 1 HAVING count(*)>1` → 空                                                                                                     |
| I-09 | 无零项目报告                            | `SELECT lot_id FROM iqc_report r WHERE NOT EXISTS(SELECT 1 FROM iqc_inspection_record x WHERE x.lot_id=r.lot_id) AND r.judge_mode<>'manual'` → 空                                            |
| I-10 | 抽样数不超过批量                          | `SELECT id FROM iqc_inspection_record WHERE sample_size > (SELECT total_qty FROM iqc_lot WHERE id=lot_id)` → 空                                                                              |
| I-11 | 严格度变化必有日志                         | 每次 `strictness` 变更前后应存在 `strictness_transfer_log` 记录（应用层断言）                                                                                                                                 |

---

## 12. 非功能需求

| 类别   | 要求                                                                         |
| ---- | -------------------------------------------------------------------------- |
| 并发   | 提交/审批必须 CAS；同一批次并发提交只允许 1 次成功，其余 409                                       |
| 幂等   | 回调按 `(instanceId,event,nodeIndex)` 幂等；提交按 `report_no` upsert               |
| 性能   | 打开检验单（含逐项抽样推定）≤ 800ms（1200 批次/60 项目）；报告打印 ≤ 2s                             |
| 草稿   | 录入页每 5s 自动存草稿；刷新/断网恢复；草稿不产生任何业务副作用                                         |
| 打印   | 文件名 = `{检验编号}-{物料编号}`（🔒），通过临时改写 `document.title` 实现，`afterprint` 后恢复      |
| 打印内容 | 必须包含：检验编号、物料编号/名称、供应商、批量、抽样方案+AQL、抽样数、Ac、Re、每项实测值、不良数、单项判定、最终判定、检验员、审批人、日期 |
| 多语言  | 项目名支持 中/越/英 三语（`item_name` / `item_name_vi` / `item_name_en`），缺失时回落中文      |
| 审计   | 报告的提交人/时间、审批人/时间、驳回人/时间/原因，全部不可覆盖，仅可追加                                     |
| 权限   | 检验员：录入+提交；主管：审批+驳回+人工判定+严格度调整；仓管：查看。**提交人不得审批自己提交的报告**                     |
| 缓存   | HTML 入口 `Cache-Control: no-store`；静态资源 hash 指纹 + immutable                 |
| 时区   | 全部 `timestamptz`，展示按本地时区（Asia/Shanghai 或 Asia/Ho_Chi_Minh，可配置）             |

---

## 13. 验收用例（🔒 全部通过才可交付）

| 编号    | Given                                | When       | Then                                |
| ----- | ------------------------------------ | ---------- | ----------------------------------- |
| TC-01 | 批量 1200、水平 G-II、AQL 0.40、正常          | 计算抽样       | 字码 J，样本量 80，Ac 0，Re 1               |
| TC-02 | 同 TC-01 但严格度加严                       | 计算抽样       | 字码 J，样本量 80，Ac 1，Re 2               |
| TC-03 | 同 TC-01 但严格度放宽                       | 计算抽样       | 字码 J，样本量 32，Ac 1，Re 2               |
| TC-04 | §5.9 全 21 条向量                        | 逐条执行       | 与本文件表格完全一致                          |
| TC-05 | 项目方案 `N=5`，模板 sampleSize=5/ac=0/re=1 | 打开检验单      | 抽样数 5，不随严格度变化，`applied=false`       |
| TC-06 | 项目方案 `全检`                            | 打开检验单      | 抽样数 = 批量，`applied=false`            |
| TC-07 | 批量 2                                 | 打开检验单      | 抽样数 = 2，标记"全检"（不是 80）               |
| TC-08 | spec `10±0.1`，实测 10.1                | 判定         | 不超差（闭边界）                            |
| TC-09 | spec `>5`，实测 5                       | 判定         | 超差（开边界）                             |
| TC-10 | spec `不小于5`，实测 5                     | 判定         | 不超差（否定式优先，不得解析成 usl）                |
| TC-11 | spec `3.15-4,15`，实测 4.1              | 判定         | 不超差（逗号小数已归一）                        |
| TC-12 | spec `无划伤`（不可解析），实测任意                | 判定         | 不自动判 NG，提示人工确认                      |
| TC-13 | 尺寸项 80 个实测值中 1 个超差，Ac=0              | 提交         | defect_qty=1，is_pass=false，报告 fail  |
| TC-14 | 全部项目合格，任一项目 Ac=0 且 defect_qty=0      | 提交         | 报告 pass                             |
| TC-15 | 报告 fail 但未选 defect_type              | 提交         | 拒绝，返回 V-08 文案                       |
| TC-16 | 批次已 pass                             | 再次提交       | 409「该批次已完成检验，不可重复提交」                |
| TC-17 | 报告已 approved                         | 再次审批       | 409「该检验报告已审批，请勿重复审批」                |
| TC-18 | 无任何检验项目                              | 提交         | 拒绝，返回 V-02 文案                       |
| TC-19 | 无任何检验项目                              | 主管人工判定+填原因 | 成功，`judge_mode='manual'`            |
| TC-20 | 物料 suspended                         | 提交         | 拒绝，返回 V-10 文案                       |
| TC-21 | 回调 `event=completed`（无 status 字段）    | 接收         | 视为审批通过，执行落账                         |
| TC-22 | 同一回调重复推送 3 次                         | 接收         | 落账只执行 1 次                           |
| TC-23 | 回调签名错误                               | 接收         | 401，不执行任何副作用                        |
| TC-24 | 正常检验连续 10 批接收                        | 第 10 批审批通过 | 严格度 normal→reduced，日志齐全             |
| TC-25 | 正常检验近 5 批有 2 批不接收                    | 第 5 批审批通过  | 严格度 normal→tightened                |
| TC-26 | 加严期累计 5 批不接收                         | 审批通过       | 严格度 →suspended，后续提交被拦               |
| TC-27 | 放宽期 1 批不接收                           | 审批通过       | 严格度 →normal                         |
| TC-28 | 序列 R A A R（4 批）                      | 逐批审批       | 不误触发加严（近 5 批只有 2 批 fail → 第 4 批时触发） |
| TC-29 | 打印报告                                 | 保存 PDF     | 默认文件名 `JY202610220007-MAT001`       |
| TC-30 | 模板改了项目名称                             | 打开历史报告     | 报告仍显示提交时的旧名称（快照）                    |

---

## 14. 已知缺陷与禁止事项

### 14.1 现系统已知缺陷（新系统必须修掉，不得照抄）

| #    | 缺陷                              | 后果               | 新系统要求                       |
| ---- | ------------------------------- | ---------------- | --------------------------- |
| D-01 | 抽样数未与批量做 `min` 约束               | 批量 2 时抽样数 80     | 实现 §5.7 全检规则                |
| D-02 | 字段名 `spc`（写）/`spec`（读）不一致       | 规格输入框"输了不显示"     | **已修（2026-10-22）**：DB 列、服务端、前端、共享类型全部统一为 `spec`；历史草稿 JSON 键已批量迁移；migration 见 `server/database/rename-spc-to-spec-20261022.sql` |
| D-03 | 回调终态判断用 `status=='approved'`    | 全部落账逻辑永不执行（P0）   | 用 `event=='completed'`      |
| D-04 | 幂等日志先写后跑副作用                     | 失败后永久跳过（数据丢失）    | 先查重→副作用→写日志                 |
| D-05 | 回调验签在密钥为空时放行                    | 无鉴权              | 密钥缺失直接 401                  |
| D-06 | 严格度计数用衰减计数                      | "5 批内 2 批拒收"永不触发 | 读最近 N 条原始序列                 |
| D-07 | 审批副作用在事务外且吞异常                   | 审批通过但库存未隔离/重复扣减  | 全部进事务，失败回滚                  |
| D-08 | 并批键含 `receipt_date` 且唯一         | 隔天到货被静默丢弃        | 4 列键 + 部分唯一索引               |
| D-09 | `is_pass` 缺失默认 false            | 自相矛盾的报告          | 按 `defect_qty<=ac` 现算       |
| D-10 | 前端本地存 Ac/Re                     | 前后端判定不一致         | Ac/Re 只由服务端产出               |
| D-11 | 零项目报告可直接落库                      | 质量体系审核硬伤         | V-02 拦截                     |
| D-12 | 检验记录页每次读定义级 `form_schema`，非版本快照 | 改模板影响在途单据        | 表单结构版本化                     |

### 14.2 实施禁止事项（🔒）

1. **不得修改**附录 A 的任何表数值。如需更正，走独立变更单并附 GB/T 2828.1-2012 纸质表照片。
2. **不得合并**"提交检验"与"审批通过"为一个操作。
3. **不得**允许 OA 直接写 WMS 的库存/批次表；只能走 §10 接口。
4. **不得**在浏览器端缓存抽样表作为唯一数据源（可作为"离线兜底"，但服务端返回必须覆盖它）。
5. **不得**用 `null`/`0` 代表"未判定"；未判定就必须是 `null`。
6. **不得**允许手工修改 `is_pass`。单项判定只能由 `defect_qty` 与 `ac` 推导。
7. **不得**让模板修改影响已提交报告的任何字段。
8. **不得**在报告上省略 AQL / Ac / Re —— 国标方案必须随报告打印。
9. **不得**实现"部分提交"（一批次只能整体提交一次，除驳回重检）。
10. **不得**把 `defect_type` 存英文键。

---

## 附录 A：GB/T 2828.1-2012 抽样表（机器可读编码）

### A.0 编码格式

26 列顺序（`AQL_COLUMNS`，索引 0..25）：

```
0:0.010  1:0.015  2:0.025  3:0.040  4:0.065  5:0.10  6:0.15  7:0.25  8:0.40
9:0.65  10:1.0  11:1.5  12:2.5  13:4.0  14:6.5  15:10  16:15  17:25
18:40  19:65  20:100  21:150  22:250  23:400  24:650  25:1000
```

每行 26 个字符，逐列对应：

- `.` = `↓`（用下面第一个有方案的行）
- `^` = `↑`（用上面第一个有方案的行）
- 字母 `A`..`O` = 该表 `PAIRS` 数组中的第 (charCode-65) 项，项形如 `Ac/Re`

### A.1 表 2-A 正常检验一次抽样方案

```
PAIRS_2A = ["0/1","1/2","2/3","3/4","5/6","6/7","7/8","10/11","14/15","21/22","24/25"]

A  ..........................
B  ..........................
C  ..............A...........
D  .............AB...........
E  ..........ABCD............
F  .........ABCDEF...........
G  ..........ABCDE...........
H  .........ABCDEGH..........
J  ........ABCDEGHI..........
K  ......ABCDEGHIJK..........
L  .....ABCDEGHIJ^^^^^^^^^^^^
M  .....ABCDEGHIJ^^^^^^^^^^^^
N  ....ABCDEGHIJ^^^^^^^^^^^^^
P  ...ABCDEGHIJ^^^^^^^^^^^^^^
Q  ..ABCDEGHIJ^^^^^^^^^^^^^^^
R  .ABCDEGHIJ^^^^^^^^^^^^^^^^
```

### A.2 表 2-B 加严检验一次抽样方案

```
PAIRS_2B = ["0/1","1/2","2/3","3/4","5/6","7/8","9/10","12/13","16/17","21/22",
            "27/28","34/35","43/44","18/19","22/23"]

A  ...............A..........
B  ..............A...........
C  .............A............
D  ............A.............
E  ...........A..............
F  ..........A...............
G  .........A................
H  ........ABCDEFG...........
J  .......ABCDEFGH...........
K  ......ABCDEFGHI...........
L  .....ABCDEFGHIJ...........
M  ....ABCDEFGHIJK...........
N  ...ABCDEFGHIJKL...........
P  ..ABCDEFGHIJKLM...........
Q  .ABCDEFGHIJKL.............
R  ABCDEFGHIJKL..............
S  ^^^^^^^^^^^^^^^^^^^^^^^^NO
```

> 注意：加严表比正常表多一个 `S` 字码（样本量 3150）；`PAIRS_2B` 中 `N=18/19`、`O=22/23` 仅用于 `S` 行。

### A.3 表 2-C 放宽检验一次抽样方案

```
PAIRS_2C = ["0/1","1/2","2/3","3/4","5/6","6/7","8/9","10/11","12/13"]

A  ...............A..........
B  ..............A...........
C  .............A............
D  ............AABB..........
E  ...........AABBCC..........
F  ..........AABBCDEE.........
G  .........AABBCDEFG........
H  ........AABBCDEFGH........
J  .......AABBCDEFGHI........
K  ......AABBCDEFGHI.........
L  .....AABBCDEFGHI..........
M  ....AABBCDEFGHI...........
N  ...AABBCDEFGHI............
P  ..AABBCDEFGHI.............
Q  .AABBCDEFGHI..............
R  AABBCDEFGHI...............
```

> ⚠️ `E`、`F` 两行为 27 字符（尾部多一个 `.`）。因为查表只访问索引 0..25，**不影响任何取值**，重写时按 26 字符截断即可。这是现网数据的填充瑕疵，不是逻辑错误。

### A.4 解码算法（参考实现）

```js
const LETTERS = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S'];
const NORMAL_N   = {A:2,B:3,C:5,D:8,E:13,F:20,G:32,H:50,J:80,K:125,L:200,M:315,N:500,P:800,Q:1250,R:2000};
const TIGHTENED_N= {...NORMAL_N, S:3150};
const REDUCED_N  = {A:2,B:2,C:2,D:3,E:5,F:8,G:13,H:20,J:32,K:50,L:80,M:125,N:200,P:315,Q:500,R:800};

function decodeRow(rowStr, pairs) {
  return [...rowStr].map(ch => ch === '.' ? '↓' : ch === '^' ? '↑'
    : pairs[ch.charCodeAt(0) - 65].split('/').map(Number));
}

function resolveAcRe(rows, pairs, sizeMap, startLetter, aqlIndex) {
  let cur = startLetter;
  for (let guard = 0; guard < 20; guard++) {
    const cell = rows[cur][aqlIndex];
    if (Array.isArray(cell)) {
      return { codeLetter: cur, sampleSize: sizeMap[cur], ac: cell[0], re: cell[1] };
    }
    const i = LETTERS.indexOf(cur);
    if (cell === '↓') { if (i + 1 < LETTERS.length) { cur = LETTERS[i + 1]; continue; } }
    else if (cell === '↑') { if (i - 1 >= 0) { cur = LETTERS[i - 1]; continue; } }
    break;
  }
  return { codeLetter: startLetter, sampleSize: sizeMap[startLetter] || 2, ac: 0, re: 1, fallback: true };
}
```

### A.5 表 1 的机器可读形式

```json
[{"min":2,"max":8,"L":{"S-1":"A","S-2":"A","S-3":"A","S-4":"A","I":"A","II":"A","III":"B"}},
 {"min":9,"max":15,"L":{"S-1":"A","S-2":"A","S-3":"A","S-4":"A","I":"A","II":"B","III":"C"}},
 {"min":16,"max":25,"L":{"S-1":"A","S-2":"A","S-3":"B","S-4":"B","I":"B","II":"C","III":"D"}},
 {"min":26,"max":50,"L":{"S-1":"A","S-2":"B","S-3":"B","S-4":"C","I":"C","II":"D","III":"E"}},
 {"min":51,"max":90,"L":{"S-1":"B","S-2":"B","S-3":"C","S-4":"C","I":"C","II":"E","III":"F"}},
 {"min":91,"max":150,"L":{"S-1":"B","S-2":"B","S-3":"C","S-4":"D","I":"D","II":"F","III":"G"}},
 {"min":151,"max":280,"L":{"S-1":"B","S-2":"C","S-3":"D","S-4":"E","I":"E","II":"G","III":"H"}},
 {"min":281,"max":500,"L":{"S-1":"B","S-2":"C","S-3":"D","S-4":"E","I":"F","II":"H","III":"J"}},
 {"min":501,"max":1200,"L":{"S-1":"C","S-2":"C","S-3":"E","S-4":"F","I":"G","II":"J","III":"K"}},
 {"min":1201,"max":3200,"L":{"S-1":"C","S-2":"D","S-3":"E","S-4":"G","I":"H","II":"K","III":"L"}},
 {"min":3201,"max":10000,"L":{"S-1":"C","S-2":"D","S-3":"F","S-4":"G","I":"J","II":"L","III":"M"}},
 {"min":10001,"max":35000,"L":{"S-1":"C","S-2":"D","S-3":"F","S-4":"H","I":"K","II":"M","III":"N"}},
 {"min":35001,"max":150000,"L":{"S-1":"D","S-2":"E","S-3":"G","S-4":"J","I":"L","II":"N","III":"P"}},
 {"min":150001,"max":500000,"L":{"S-1":"D","S-2":"E","S-3":"G","S-4":"J","I":"M","II":"P","III":"Q"}},
 {"min":500001,"max":null,"L":{"S-1":"D","S-2":"E","S-3":"H","S-4":"K","I":"N","II":"Q","III":"R"}}]
```

（`max:null` 表示 ∞）

---

## 附录 B：错误码表

| 错误码            | HTTP | 文案                          | 触发                     |
| -------------- | ---- | --------------------------- | ---------------------- |
| `E-SAMP-001`   | 400  | 批量必须大于等于 2                  | lotSize < 2            |
| `W-SAMP-002`   | —    | 不支持的 AQL 值：{aql}            | AQL 不在标准列（warning，走兜底） |
| `W-SAMP-003`   | —    | 抽样表箭头越界，已使用兜底方案（Ac=0,Re=1）  | 箭头走到表末                 |
| `E-LOT-001`    | 404  | 检验批次不存在                     | lotNo/id 查无            |
| `E-LOT-002`    | 409  | 该批次已完成检验，不可重复提交             | CAS 影响行数 0             |
| `E-LOT-003`    | 409  | 该批次已被 {name} 认领，请联系其释放      | 认领冲突                   |
| `E-RPT-001`    | 404  | 检验报告不存在                     |                        |
| `E-RPT-002`    | 409  | 该检验报告已审批，请勿重复审批             | 审批 CAS 失败              |
| `E-RPT-003`    | 409  | 该批次报告已审批，不能覆盖结果             | 结果回写时                  |
| `E-VAL-002`    | 400  | 检验记录为空，不能提交……               | V-02                   |
| `E-VAL-006`    | 400  | 第 N 行不良数（{x}）超过抽样数量（{y}）    | V-06                   |
| `E-VAL-008`    | 400  | 检验判定为不合格时必须选择不合格类型（可选：…）    | V-08                   |
| `E-STRICT-001` | 400  | 该物料检验已暂停，不能提交检验……           | V-10                   |
| `E-STRICT-002` | 400  | 放宽检验需连续10批接收才能转免检，当前已连续 N 批 | V-16                   |
| `E-AUTH-001`   | 401  | API Key 无效                  | 入站鉴权                   |
| `E-AUTH-002`   | 401  | 回调密钥未配置                     | 验签前置                   |
| `E-AUTH-003`   | 401  | 签名校验失败                      | 验签                     |
| `E-TPL-001`    | 400  | 该物料未绑定检验模板，请先在模板库中绑定        | V-18                   |

---

**文档结束。实施方应以此为唯一依据；任何与本文不符的实现都视为缺陷。**
