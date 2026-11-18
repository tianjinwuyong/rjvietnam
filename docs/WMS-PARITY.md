# WMS 对齐（Parity）方案 · rjvn → smt-factory-system

**日期**：2026-11-17
**来源**：`D:\rj\rjvn\WMS-20261019`（NestJS + Drizzle + PG 17.11，库 `wms`）
**目标**：`smt-factory-system`（Express + 裸 pg，库 `smt_factory`）
**范围**：只对齐 WMS/IQC 相关表；**OA 完全排除**（不建 `oa_*` 表、不保留 `oa_*` 列）
**交付**：`database/drafts/280_rjvn_wms_parity.sql`（草稿，未进 `database/migrations/`）

---

## 1. 做法：先对齐表结构，再灌数据

不在 `smt_factory` 里新建 schema（你的要求），而是把 rjvn 的表**带前缀复制进现有 `public`**：

```
public.rjvn_material      ← wms.material
public.rjvn_iqc_lot       ← wms.iqc_lot
public.rjvn_receipt_order ← wms.receipt_order
...
```

- **零冲突**：`rjvn_` 前缀与现有 `materials` / `suppliers` / `boms` / `iqc_inspections` / `receiving_orders` 物理隔离
- **零回滚成本**：`DROP TABLE public.rjvn_*` 即可
- **不动现有表**：`public.materials` 等 1,108 张表一个字段都不改，MES/PMC/财务/QMS 不受影响

数据加载是**下一步独立动作**，届时再做字段映射（映射关系见 §4）。

---

## 2. 已验证的结果

在 scratch 库 `rjvn_parity_verify` 上以 `ON_ERROR_STOP=1` 完整执行：

| 指标 | 结果 |
|---|---|
| 建表 | **75 张**（含 FK 依赖表，如 `rjvn_warehouse_location`） |
| 外键 | 69 |
| 索引 | 321 |
| `oa_*` 列 | **0**（源库里有 8 个 OA 列被剥离） |
| `oa_*` 表 | **0** |
| 新建 schema | **0** |
| 执行错误 | 0 |

> 源库里 OA 是**字段级**混进 WMS 的：`iqc_lot.oa_claimed_by/oa_claimed_at/oa_source`、`picking_order.oa_instance_id/oa_status/oa_synced_at/oa_stage`、`receipt_order.oa_*`。本方案按"OA must not be in WMS"全部剔除，并对引用它们的部分索引一并丢弃。

---

## 3. 数据规模（待加载）

`wms` 库 98 表中 33 张非空，24 MB：

| 表 | 行数 | 归属 |
|---|---|---|
| `mes_sync_log` | 11,127 | **不搬**（运行日志） |
| `material` | 2,487 | 主数据 |
| `receipt_order` | 1,394 | 收料 |
| `iqc_lot_receipt` | 1,230 | IQC |
| `operation_log` | 1,006 | **不搬**（审计噪点） |
| `inventory` | 505 | 库存余额 |
| `iqc_lot` | 501 | IQC 批次 |
| `oa_event_outbox` | 501 | **不搬**（OA） |
| `bom_item` | 461 | BOM |
| `supplier` | 348 | 主数据 |
| `iqc_report` | 331 | IQC |
| `iqc_lot_strictness_count` | 312 | IQC 严格度 |
| 其余 21 表 | < 110 各 | 模板/标准/拣料/退货 |

---

## 4. 加载到业务表时的映射（下一步）

`rjvn_*` 只是中转层。真正喂给业务表时，列重合度很低，必须逐字段映射：

| rjvn 表 | smt 业务表 | 列重合 | 必须做的转换 |
|---|---|---|---|
| `material` (24) | `materials` (27) | 6 | `material_code`→`code`、`material_name`→`name_zh/en/vi`、`unit`→`uom`、`unit_price`→`standard_unit_cost`、`expiry_days`→`shelf_life_days` |
| `supplier` (13) | `suppliers` (24) | 3 | `supplier_code`→`code`、`supplier_name`→三语名、`contact_person`→`contact_name` |
| `bom` (12) | `boms` (11) | 2 | `product_code`→`product_id` 解析、`version`→`revision` |
| `bom_item` (16) | `bom_lines` (22) | 4 | `quantity`→`qty_per`、`material_code`→`material_id` |
| `receipt_order` (19) | `receiving_orders`(9)+`receiving_order_lines`(11) | 4/3 | **平表→头/行拆分** |
| `iqc_lot` (30) | `iqc_inspections` (40) | 5 | 挂 `receiving_order_line_id` / `material_lot_id` |
| `iqc_inspection_record` (26) | `iqc_inspection_items` (28) | 3 | `spec_min/max`→`lower/upper_spec_limit` |
| `iqc_template` (23) | `iqc_sampling_plans` (9) | 2 | AQL 分级体系不同（packaging/appearance/dimension） |
| `inventory` (18) | `inventory_transactions` (18) | 1 | **余额→期初流水**（smt 不存余额，靠流水派生） |

---

## 5. 应用与回滚

```powershell
# 干跑（推荐先做）
psql -h 127.0.0.1 -U postgres -d rjvn_parity_verify -v ON_ERROR_STOP=1 -f database/drafts/280_rjvn_wms_parity.sql

# 正式应用（需人工批准；不要走 npm run migrate）
psql -h 127.0.0.1 -U postgres -d smt_factory -v ON_ERROR_STOP=1 -f database/drafts/280_rjvn_wms_parity.sql
```

回滚（草稿文件尾部已内联全部语句）：

```sql
DROP TABLE IF EXISTS public.rjvn_<name> CASCADE;   -- 75 条
```

---

## 6. 已完成（2026-11-17 续）

| 项 | 状态 | 证据 |
|---|---|---|
| 75 张表应用到 `smt_factory.public` | ✅ | 75 tables / 69 FKs / 321 indexes / 0 OA 列 |
| 数据加载 `wms` → `rjvn_*` | ✅ | `node scripts/etl/rjvn-wms-load.mjs`，**74 表行数全对账通过** |
| 只读 API | ✅ | `/api/rjvn-wms/{summary,tables,data/:table,iqc/overview}`，需 `wms.view` |
| 前端 WMS 页签 | ✅ | `WmsRjvnData` → WMS → 仓库总览 → "rjvn WMS 镜像数据" |
| 校验 | ✅ | typecheck 0 错误；test 380 passed / 3 既有失败（无新增） |

数据加载要点（已写进 ETL 脚本）：`pg_dump --data-only` 后剥离 OA 列及其对应数据单元、`setval()`、`\restrict/\unrestrict`，再 `session_replication_role=replica` 导入。

配套修复：
- `database/migrations/20260731_users_password_hash.sql` 已应用（登录从明文改为 scrypt）
- admin 角色补 `wms.view` 权限；`smt_factory` DB 用户补 `rjvn_*` 表 SELECT 权限

## 7. 下一步（数据映射到正式业务表，未做）

`rjvn_*` 目前是**只读镜像**。§4 的字段映射（→ `materials` / `suppliers` / `receiving_orders` / `iqc_inspections` / `inventory_transactions`）尚未实施，需单独评审：列重合度低、IQC 语义不同、库存需把余额转成期初流水。

---

## 7. IQC 核心逻辑移植（2026-11-17）

源：`D:\rj\rjvn\WMS-20261019\server\modules\iqc`（**排除全部 `oa-*.ts`**）

后端：`services/api/src/rjvn-iqc.js`（纯逻辑 + 8 个路由），在 `server.js` 注册
前端：`apps/web/src/wms/WmsRjvnIqc.tsx` → WMS → 仓库总览 → "IQC 核心逻辑（rjvn 移植）"

### 移植的三条核心规则

| 规则 | 来源 | 规则内容 |
|---|---|---|
| **判定** | `iqc.service.ts:43-76` | 单项合格 ⟺ `defectQty ≤ Ac`（Ac 缺省 = 0）；**客户端传的 `isPass` 一律不信**，服务端重新推导；批次合格 ⟺ 所有项合格。源系统不产生 `hold` |
| **严格度** | `strictness.service.ts:143-302` | 滑窗取最近 10 批判定：`normal`→`tightened`（近 5 批拒收 ≥ 2）；`normal`→`reduced`（连续 10 批接收）；`tightened`→`normal`（连续 5 批接收，保留连续计数）；`tightened`→`suspended`（累计 5 批拒收）；`reduced`→`normal`（出现 1 批拒收）。仅在级别变化时写转移日志 |
| **抽样** | `sampling-plan.service.ts:12-294` | GB/T 2828.1-2012：批量区间 → 检验字码；normal/tightened/reduced 三张 Ac/Re 表 + ↓/↑ 箭头解析；Ac=0/Re=1 兜底 |

全部阈值集中在 `CONFIG` 对象，便于调整。

### 接口

```
GET  /rjvn-iqc/pending?q=&limit=&offset=
GET  /rjvn-iqc/lot/:id
GET  /rjvn-iqc/strictness/current?materialId=
GET  /rjvn-iqc/strictness/list?limit=&offset=
GET  /rjvn-iqc/strictness/transfer-logs?materialId=&limit=
GET  /rjvn-iqc/sampling/calculate?lotId=&qty=&aql=&inspectionLevel=&strictness=
POST /rjvn-iqc/inspect/:lotId
GET  /rjvn-iqc/stats
```

均需 `wms.view` 权限。提交判定在**单个事务**内完成：写明细 → 写报告 → 写严格度计数 → 重算严格度级别 → 必要时写转移日志 → 更新批次状态。

### 验证

| 项 | 结果 |
|---|---|
| 接口冒烟 | 8 个全部 200；重复提交 / 空记录均 400 |
| 抽样计算 | 实测 `G-II / N=125 / Ac=2 Re=3` |
| 规则引擎 | 提交后严格度计数 312→317、报告 331→336、转移日志 14→15（实测触发 `reduced → normal`） |
| UI 端到端 | Playwright：登录 → 待检列表 → 明细 → 抽样计算 → 提交判定 → 横幅 `判定结果: pass` |
| typecheck | 0 错误 |
| test | 380 passed / 3 既有失败（无新增） |

> 镜像数据被冒烟测试改动过几个批次（`IQC202611110337/0447/0430/0431/0432` 等），
> 均为正常判定流程产生的真实副作用，不是脏数据。

## 8. 收料核心逻辑移植（2026-11-17 续）

源：`D:\rj\rjvn\WMS-20261019\server\modules\receipt\receipt.service.ts`（OA 文件已排除）

后端：`services/api/src/rjvn-receipt.js`，前端：`apps/web/src/wms/WmsRjvnReceipt.tsx`
入口：WMS → 仓库总览 → "收料核心逻辑（rjvn 移植）"

| 规则 | 源行 | 实现 |
|---|---|---|
| QR 解析 | `:120-140` | 6 段 `供应商*物料*生产日期*数量*批次号*流水号`，空值/数量非法 → 400 |
| QR 校验 | `:142-270` | 物料存在 + 供应商合格 + 流水号未重复 |
| 合并提交 IQC | `:764-1130` | `status='received'` 且未关联批次 → 按 `物料+供应商+生产日期+批次号` 分组；同键 active 批次冲突 → 409；`pg_advisory_xact_lock` 串行；存在 pending/rejected 批次则累加数量/箱数/库位、刷新末次收料日，否则新建 `IQC+日期+序号` 批次；写关联表、收料单转 `pending_iqc`。**单事务** |
| 幂等 | `:783` | 再跑一次返回 0（收料单已不再满足条件） |

接口：`GET /rjvn-receipt/{pending,list,list/:id,warehouses}`、`POST /rjvn-receipt/{verify-qr,verify-location,submit-iqc/preview,submit-iqc}`

验证：
- 164 待提交收料单 → 预览 34 批次 → 实际提交生成 34 批次 / 164 收料，再跑返回 0
- 实测中发现的 `date` 参数序列化错误（pg 返回 JS Date）已修：本地日期归一化 `YYYY-MM-DD`
- Playwright：页签渲染、空态/有数据态、QR 校验 `true · 陶瓷电容`、无控制台错误
- typecheck 0 错误；test 380 passed / 3 既有失败
- 测试数据已完整回滚（received=164 / lots=501 / links=1230）

## 9. 库存核心逻辑移植（2026-11-17 续）

源：`D:\rj\rjvn\WMS-20261019\server\modules\inventory\inventory.service.ts`（OA 文件已排除）

后端：`services/api/src/rjvn-inventory.js`，前端：`apps/web/src/wms/WmsRjvnInventory.tsx`
入口：WMS → 仓库总览 → "库存核心逻辑（rjvn 移植）"

| 规则 | 源行 | 实现 |
|---|---|---|
| 库存查询/汇总 | `:59-231`, `:977-1000` | 多条件分页（物料/批次/库位/仓库/状态）+ 可用库存按物料汇总（good + 未锁定） |
| 移库 doTransfer | `:1654-1781` | 源库位 `FOR UPDATE` 校验（good/未锁定/数量）→ 目标库位 active 校验 → 扣源（归零则删行，否则 CAS 递减）→ 目标 upsert（唯一键 `material+location+batch+status` 冲突则累加）→ 写 `stock_transfer`。**单事务** |
| 盘点调整 adjustInventory | `:2074-2191` | 参数校验 → MRB 占用校验 → `pg_try_advisory_xact_lock(hashtext(id))` 防并发 → 读当前值 → 锁定需 force+授权原因 → 无差异直接返回 → CAS 更新（`WHERE quantity=旧值`）→ 写 `inventory_transaction`（`balance_after` 取实际值） |
| 锁定/解锁 | `:1944-2042` | MRB 校验 + 状态 CAS + 写 LCK/ULK 流水；`pending_qc` 库存禁止手工解锁（须走 IQC） |
| MRB 占用守卫 | `:1519-1568` | `lock_reason LIKE 'MRB-%'` / `'MRB-OTHER:%'` 命中 → 400 拒绝操作 |

接口：`GET /rjvn-inventory/{list,summary,transactions,transfers}`、`POST /rjvn-inventory/{transfer,adjust,lock,unlock}`

验证：
- 读端点全 200：list 505 行、good 306、locked 199、summary 49 物料、流水/移库初始 0
- 写端点实测：移库 100（5000→4900，目标库位新建行 + transfer 记录）；调整 4900→4910（写 ADJ 流水，`balance_after=4910`）；无差异调整返回 `unchanged`；锁定→调整锁定库存返回 400→解锁全通
- MRB / pending_qc 守卫按源码规则实现
- 修了 2 个自引入 bug：分页占位符与筛选参数冲突；`created_by` 列名应为 `_created_by`
- 测试数据已完整回滚（inv 505 / src qty 5000 / tx 0 / transfer 0）
- Playwright：页签渲染、50 行库存表、选中行操作面板、3 个子标签切换、无控制台错误
- typecheck 0 错误；test 380 passed / 3 既有失败

## 10. 拣货核心逻辑移植（2026-11-17 续）

源：`D:\rj\rjvn\WMS-20261019\server\modules\workorder\workorder.service.ts` 的 picking 部分（oa-integration 已排除）

后端：`services/api/src/rjvn-picking.js`，前端：`apps/web/src/wms/WmsRjvnPicking.tsx`
入口：WMS → 仓库总览 → "拣货核心逻辑（rjvn 移植）"

| 规则 | 源行 | 实现 |
|---|---|---|
| 列表/详情 | `:1480`, `:2469` | 拣货单分页 + 状态统计 + 明细 |
| 审批 | `:1757` | `pending_approval → approved/rejected`，单事务 `FOR UPDATE` |
| 拣货出库 | `:1781-2091` | 校验 approved + 实拣≤应拣 → 按 `production_date, _created_at` FIFO 遍历 good/未锁定库存 → 逐批扣减（归零删行）→ 写 `inventory_transaction`（tx_type=pick, 负数量, balance_after）→ 写 `picking_reel` → 更新明细实拣量 → status `issued`。不足量 409，锁定库存单独提示 |
| 签收 | `:2092-2168` | `issued/completed → received`，写明细签收量与备注 |

接口：`GET /rjvn-picking/{list,detail/:id,reels}`、`POST /rjvn-picking/{:id/approve,:id/pick,:id/receive}`

验证：
- 读端点：4 张 approved 拣货单（PK202611050001~0004）、49 条明细，全 200
- 写端点实测：PK...0001 拣货 3 明细各 1 → issued（3 笔 pick 流水 + 3 料卷），签收 → received
- 测试数据已完整回滚（order=approved / pick_tx=0 / reels=0 / inv=505）
- Playwright：页签、4 单列表、详情 49 明细、料卷子标签切换、无控制台错误
- typecheck 0 错误；test 380 passed / 3 既有失败

## 11. 其余单据流程移植（2026-11-17 续）

后端：`services/api/src/rjvn-docflow.js`，前端：`apps/web/src/wms/WmsRjvnDocFlow.tsx`
入口：WMS → 仓库总览 → "其余单据流程（rjvn 移植）"，4 个子标签：盘点 / MRB / 供应商退货 / 超领

源（OA 已排除）：`modules/stock-take`、`modules/mrb`、`modules/supplier-return`、`modules/over-picking`

| 单据 | 接口 | 状态流转 |
|---|---|---|
| 盘点 | `/rjvn-doc/stock-take/{list,detail/:id,submit,approve,cancel}` | draft → submitted → approved；取消 |
| MRB | `/rjvn-doc/mrb/{list,detail/:id,submit,final-approve,reject}` | draft → pending_review → approved/rejected；含处置明细与物料/供应商联查 |
| 供应商退货 | `/rjvn-doc/supplier-return/{list,detail/:id,outbound,cancel}` | pending/approved → out/cancelled |
| 超领 | `/rjvn-doc/over-picking/{list,detail/:id,approve,cancel}` | pending(_approval) → approved/cancelled |

通用实现：分页列表 + 状态统计 + 子表明细；状态操作用 `UPDATE ... WHERE id AND status IN(allowed)` 单事务，非法状态返回 409。

**重要事实**：这 4 类镜像表在 `smt_factory` 中均为 **0 行**（源库演示数据止于收料/IQC/拣货）。路由按源码实现，导入数据后即可用；页面正确显示空态。这是"移植逻辑"而非"移植数据"。

验证：4 个 list 端点全 200（total=0）；Playwright 页签渲染、4 子标签切换、空态、无控制台错误；typecheck 0 错误；test 380 passed / 3 既有失败。

## 12. 已知风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 主数据撞码 | `materials` 现有 262 条，rjvn 2,487 条，可能同 code 不同实体 | 第 2 步前先出**冲突报告** |
| IQC 语义不同 | rjvn 是"批次 + 严格度累积"，smt 是 inspection + sampling_plan | 只搬数据，规则引擎需单独移植 |
| 库存语义不同 | smt 余额靠流水派生，不能直接写余额 | 生成期初流水并校验合计 |
| 50 字符表名前缀 | `rjvn_` 前缀后最长表名 27 字符，未超 PG 63 上限 | 无需处理 |

## 13. 正式表数据 UI + 导入收尾（2026-11-18）

### 正式表只读视图

后端：`services/api/src/rjvn-canonical-api.js`（10 个只读端点，均需 `wms.view`）
前端：`apps/web/src/wms/WmsCanonicalData.tsx`
入口：WMS → 仓库总览 → "正式表数据（导入后）"（页签 `rjvnCanonical`）

端点：`/canonical-data/{summary,materials,suppliers,lots,receipts,inspections,boms,bom-lines,picking,reels}`

`summary` 实测：

| 表 | 行数 | 表 | 行数 |
|---|---|---|---|
| `materials` | 2,951 | `wms_receipt_orders` | 1,394 |
| `suppliers` | 355 | `iqc_inspections` | 338 |
| `storage_locations` | 202 | `boms` / `bom_lines` | 6 / 743 |
| `material_lots` | 517 | `wms_picking_orders` / `_items` | 4 / 67 |
| `rjvn_external_id_map` | 5,538 | — | — |

映射分布：`bom=3`、`bom_item=461`、`iqc_lot=501`、`iqc_report=336`、`location=4`、`material=2487`、`picking=4`、`receipt=1394`、`supplier=348`。

**权限**：新表由 `postgres` 创建，API 用户 `smt_factory` 初次访问报"权限不足"。已执行：

```sql
grant select, insert, update on public.wms_receipt_orders, public.wms_picking_orders,
  public.wms_picking_order_items, public.rjvn_external_id_map to smt_factory;
```

### 多语言与校对清单

- `scripts/etl/rjvn-translate-names.mjs`（Ollama `qwen2.5:1.5b`，分批 + 重试 + 按原文匹配）+ `scripts/etl/rjvn-translate-manual.sql`（8 条特殊字符长描述）
- **0 条中文占位**；`materials` 2,869 / `suppliers` 353 / `products` 8 已翻译
- `summary` 里 `pending=82 materials / 2 suppliers` 是**纯 ASCII 编码名**（`PCB`、`USB`、`NTC` 等），`name_en = name_zh` 属正确结果，不是漏翻
- 校对清单（机器翻译，需业务确认）：`docs/translation-review/{materials,suppliers,products}.csv`
  - 这三个文件被 `.gitignore` 的 `*.csv` 规则忽略，已用 `git add -f` 纳入版本控制

### BOM 审核

见 `docs/BOM-REVIEW.md`。**结论：3 个 draft BOM 不转 active**，因为与原有 BOM 的物料编码交集为 0（两套编码体系），需业务先确认映射策略。原 active BOM 未改动。

### 验证

- 10 个 canonical 端点全部 200（修复权限后）
- Playwright：`rjvnCanonical` 页签渲染、summary 显示 `materials 2,951`、5 个实体切换分别 50/50/50/6/4 行、无控制台错误
- `npm run typecheck` 0 错误；`npm run test` 380 passed / 3 既有失败（无新增）

### 自检修复（同日）

- `rjvn-canonical-api.js` 的 `listRoute`：count 查询原先漏了 join，`lots/inspections/boms/reels` 带 `q` 搜索时 500；已补上同一 join，4 端点实测 200
- `WmsCanonicalData` / `WmsRjvnInventory` / `WmsRjvnPicking` / `WmsRjvnDocFlow`：删除重复 load effect，改为单一 debounce，避免筛选时双份请求
- 全量 rjvn 读端点带 `q` 冒烟：除 `q` 非该端点参数外全部 200；正确路径 `/rjvn-iqc/strictness/transfer-logs` 200（15 条）
- 修复提交：`8e3b55b`、`02bcf52`（typecheck 0 错误；Playwright 3 页签搜索正常，无控制台错误）

### 翻译残留中文清理

权威检查（Node `[\u4e00-\u9fff]`，psql 经 PowerShell 传中文正则会乱码，不可靠）发现 LLM 对 244 条长技术描述只译了前半段，英文名残留中文 37+12 条、越文名残留 187+35 条（如 `Dongguan Lingen五金电子有限公司`、`đèn capacitor电解`）。

`scripts/etl/rjvn-translate-mixed.mjs` 用 **112 个中文片段 → EN/VI 术语词典**确定性替换（长片段优先，避免 `热敏电阻` 被 `电阻` 部分替换）。结果：`materials` 202 行、`suppliers` 42 行清理完毕，**残留中文 0**。词典仅覆盖残留片段，输出仍是机器生成，业务校对清单已刷新。

### 人工校对第一批（59 条）

启发式扫描发现 59 条 `name_en = name_vi`（英文被复制到越文字段），其中 6 条英文也译错（LLM 条目错位，如 `集成电路IC → Mother Seat`、`平头螺丝 → Silicone Foot Pad`、`12刀卡 → 12 Volt Card`）。
`scripts/etl/rjvn-translate-proofread.sql` 逐条给出 EN/VI 修正（幂等 guard `name_en=name_vi`）。
结果：`name_en = name_vi` 降至 **0**，校对 CSV 已刷新。其余检查：截断 25 条（varchar 160 上限）、双空格 2 条，未发现 `??`/`undefined` 等占位符。
