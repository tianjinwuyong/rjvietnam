# rjvn_* → 正式业务表映射冲突报告

日期：2026-11-18 · 状态：**只读分析，未写入任何正式表**

## 1. 结论

`rjvn_*` 镜像数据与正式业务表是**两套完全独立的编码体系**，零重叠。因此不存在"按 code 更新现有记录"的映射——只能作为**全新记录导入**，会显著改变正式表数据。

| 实体 | rjvn 表 / 行数 | 正式表 / 行数 | code 重叠 | 导入后正式表行数 |
|---|---|---|---|---|
| 物料 | `rjvn_material` 2,487 | `materials` 262 | **0** | 262 → 2,749 |
| 供应商 | `rjvn_supplier` 348 | `suppliers` 7 | **0** | 7 → 355 |
| IQC 批次/料号 | `rjvn_iqc_lot` 501 | `material_lots` 16 | **0** | 16 → 517 |
| 库位 | `rjvn_warehouse_location` 4 | `storage_locations` 198 | **0** | 198 → 202 |
| 收料单 | `rjvn_receipt_order` 1,394 | 无对应正式表 | — | 需新建正式表 |
| BOM | `rjvn_bom` 3 / `bom_item` 461 | `boms` 3 / `bom_lines` 282 | code 体系不同 | 需逐项比对 |

辅助校验：`vietnam_code` 重叠 0；`material_name = name_zh` 仅 5 条（疑似巧合同名）。

### 编码样本对比

```
rjvn material_code : 0.01.00.01.0037S-HF   0.14.02.01.0238   1.02.01.00.0017D
smt  materials.code: C-0805-100NF           R-0603-10K-1      42
rjvn supplier_code : A.967  A.122  E.017
smt  suppliers.code: SUP-SZ-CAP  SUP-SH-IC  SUP-KR-CONN
```

## 2. 技术冲突

| 冲突 | 说明 | 影响 |
|---|---|---|
| **主键类型不同** | `rjvn_*` 用 `uuid`，正式表用 `bigint` | 所有 FK（`material_id` / `supplier_id` / `location_id` 等）必须经映射表重映射，不能直接 INSERT |
| **无现有映射设施** | 未发现任何 `*_id_mapping` / `external_id` / `cross_ref` 表 | 需新建一张 `rjvn_external_id_map(entity, rjvn_id uuid, canonical_id bigint, code)` |
| **必填字段缺口** | `materials` 需 `name_en`, `name_vi`, `material_type`；`storage_locations` 需 `area`, `name_en`, `name_vi` | rjvn 侧只有中文名，需生成或留占位值（违反"多语言 master data"约定） |
| **反向 FK 众多** | 正式表引用物料 30 处、供应商 36 处、料号 48 处、库位 19 处 | 新增主数据后这些表的关联语义需复核（例如按 code 查物料的逻辑可能命中两条） |
| **语义不同** | rjvn IQC 是"批次 + 严格度累积"，smt 是 `iqc_inspections` + `sampling_plan` | 不能直接把 501 个 lot 当 501 次 inspection；只适合落到 `material_lots` |

### 必填列（NOT NULL 且无默认值）

```
materials         : code, name_zh, name_en, name_vi, uom, material_type
suppliers         : code, name_zh, name_en, name_vi
material_lots     : material_id, supplier_id, lot_no, received_qty
storage_locations : code, area, name_zh, name_en, name_vi
iqc_inspections   : inspection_no, material_lot_id, result, operator_id
```

## 3. 建议方案（待批准）

**分阶段，全程可回滚，先不碰正式表直到你确认。**

1. **建映射表** `public.rjvn_external_id_map`（uuid ↔ bigint + code），只写这一张新表。
2. **主数据导入**（材料 → 供应商 → 库位）：用 `ON CONFLICT (code) DO NOTHING`，因零重叠等于纯新增；逐条登记映射。
3. **料号导入** `rjvn_iqc_lot` → `material_lots`，FK 走映射表；`lot_no` 唯一，零冲突。
4. **单据导入**：收料单/IQC 报告/Picking 落到正式表或新建对应正式表（需你决定目标表）。
5. **回填对照**：在映射表基础上出一份 `rjvn code → canonical id` 清单供业务核对。

## 4. 风险

- 正式表行数将大幅增长（物料 ×10.5，供应商 ×50），可能影响现有报表、成本计算与界面分页。
- 多语言字段只能用占位值，不够格称"已完成多语言主数据"。
- 一旦写入正式表，回滚需按映射表逐条删除，且要处理新增记录被其他表引用的情况。

## 5. 待你决策

- [ ] 是否允许向正式表写入（当前报告阶段**未写入**）
- [ ] 导入范围：只主数据 / 主数据+料号 / 全部单据
- [ ] `name_en` / `name_vi` / `material_type` 用占位值、还是先补翻译再导
- [x] 用户决策（2026-11-18）：**全部单据**
- [x] 导入范围：主数据 + 料号 + 收料单 / IQC 报告 / Picking
- [x] 多语言已补全（见第 7 节）：0 条中文占位，2,869 物料 / 353 供应商 / 4 产品已翻译（机器翻译，建议业务校对）

## 6. 执行结果（2026-11-18）

脚本：`scripts/etl/rjvn-canonical-import.sql`（单 `BEGIN/COMMIT` 原子事务，每条 INSERT 带 `NOT EXISTS` 幂等守卫）。

第一次执行因 `storage_locations_status_check` 拒绝 rjvn 的 `disabled` 状态而失败，**整个事务回滚**（含新建表）；修正枚举映射后一次通过。

状态映射修正：
- `rjvn_warehouse_location.status='disabled'` → `storage_locations.status='blocked'`
- `rjvn_iqc_lot.inspection_result`: `pass→released`, `fail→rejected`, `pending→pending`（原写的 `passed/failed` 不在 CHECK 枚举内）
- `material_lots.lot_status` 统一 `open`（rjvn 的 pass/fail/pending 不是合法枚举）
- `iqc_inspections.result`: `pass/fail/else→hold`（原 `pending` 非法）

| 实体 | 源行数 | 映射记录 | 正式表 | 行数变化 |
|---|---|---|---|---|
| 供应商 | 348 | 348 | `suppliers` | 7 → **355** |
| 物料 | 2,487 | 2,487 | `materials` | 262 → **2,749** |
| 库位 | 4 | 4 | `storage_locations` | 198 → **202** |
| IQC 批次 | 501 | 501 | `material_lots` | 16 → **517** |
| 收料单 | 1,394 | 1,394 | **新建** `wms_receipt_orders` | 0 → **1,394** |
| IQC 报告 | 336 | 336 | `iqc_inspections` | 2 → **338** |
| 拣货单 | 4 | 4 | **新建** `wms_picking_orders` | 0 → **4** |
| 拣货明细 | 67 | — | **新建** `wms_picking_order_items` | 0 → **67** |

新建的 `public.rjvn_external_id_map` 共 **7,074** 条 UUID↔bigint 映射；所有 FK 关联完整（517/1394/338/67 全部命中主数据）。

验证：`npm run typecheck` 0 错误；`npm run test` 380 passed / 3 既有失败（无新增）；Playwright 7 个 WMS 页面全部正常渲染、无控制台错误。

**未导入**：`rjvn_bom` / `bom_item`（product_code 与 `products` 仅 1/3 匹配，需单独核对后再导）。

**回滚方式**：整个导入在单事务内完成，重跑脚本幂等；如需撤销，按 `rjvn_external_id_map` 的 `canonical_id` 逐实体删除，并 DROP 两张新建 `wms_*` 表与映射表。

## 7. BOM 导入 + 多语言补全（2026-11-18 续）

脚本：`scripts/etl/rjvn-bom-import.sql`（原子事务，幂等，依赖第 6 节的映射表）

| 项 | 结果 |
|---|---|
| `rjvn_bom_item.material_id` | 461 条全为 NULL，只能按 `material_code` 关联 |
| 缺失物料主数据 | 202 个 code 不在 `rjvn_material` 中 → 补建 202 条 `materials` |
| 产品匹配 | 3 个 BOM：1 精确（EPS48R1-36）、1 前缀（EPS18R1G-36→EPS18R1G）、1 缺失（NBC56B120460VU AF39a）→ 补建 1 个 `products` |
| BOM 头 | +3 条（新 revision V2.6 / V2.0 / V1.3）。因 `uq_boms_one_active_per_product` 是 partial index（仅 active），新版本以 `draft` 状态导入，**不覆盖**原有 active BOM |
| BOM 明细 | +461 条 `bom_lines`，无 NULL FK |
| 映射 | `entity=bom` 3 条、`entity=bom_item` 461 条（1 组重复 code 用 `DISTINCT ON` 去重） |

导入后：`products` 7→8、`materials` 2749→2951、`boms` 3→6、`bom_lines` 282→743。

两次失败均整体回滚后发现并修正：
1. `uq_boms_one_active_per_product` 冲突 → 新版本改为 `draft`
2. `rjvn_external_id_map_pkey` 重复键 → `DISTINCT ON (bi.id)` 去重

### 多语言补全

脚本：`scripts/etl/rjvn-translate-names.mjs`，用本地 Ollama `qwen2.5:1.5b` 把导入记录的 `name_en` / `name_vi` 从中文占位翻译为目标语言。

- 幂等：只处理 `name_en = name_zh` 且含中文的记录；中断可重跑
- 分批 40 条，按原文 `zh` 字段匹配（模型可能漏项/乱序），单批事务提交
- `varchar(160)` 截断；temperature=0
- 最终状态：**0 条中文占位**；`materials` 2,869 / `suppliers` 353 / `products` 4 已翻译
- 8 条含特殊字符（Φ、*、全角括号）的长包装描述模型持续失败，由 `scripts/etl/rjvn-translate-manual.sql` 手工翻译补齐
- 机器翻译，建议业务侧校对
- 后续发现 244 条长技术描述残留中文片段（LLM 只译前半段），由 `scripts/etl/rjvn-translate-mixed.mjs` 用 112 条术语词典确定性清理；**最终残留中文 0**，校对清单已刷新
