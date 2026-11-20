# WMS 单机版 · 全方位测试与缺陷汇总报告

- 测试对象：`D:\WMS-standalone-migrate\WMS-standalone`
- 测试方式：接口级黑盒 + 并发压测 + 数据库直连校验 + 静态代码审计
- 测试范围：收料 / IQC / 发料领料 / 库存操作 / 盘点 / MRB / 退货 / 返工 / 不良品移库 / 超补领料
- 测试脚本：`_qa/`（t1~t8，可重复执行）
- 数据库已还原至测试前基线（inventory = 12 行，无 QA 残留）

---

## 一、缺陷总览（按严重度）

| 编号 | 标题 | 等级 | 模块 | 后果 |
|---|---|---|---|---|
| BUG-016 | 并发盘点调整：全部成功且流水余额与实物不符 | **P0** | 库存 | 账实不符且账本不可审计 |
| BUG-017 | 锁定（QC 冻结）库存仍可被盘点调整改写 | **P0** | 库存 | 质量冻结失效 |
| BUG-021 | 非法/缺失 UUID → 500，并泄漏 SQL 栈与内部路径 | **P0** | 全局 | 18 个接口可被外部打崩 + 信息泄漏 |
| BUG-002 | IQC 审批非幂等 → 供应商债务重复扣减 | **P0** | IQC/债 | 财务数据被放大 N 倍 |
| BUG-005 | 并发发料重复扣减库存（10×） | **P0** | 发料 | 库存账被吃掉 10 倍 |
| BUG-001 | `label_no` 唯一键冲突 → 合法收料 500 | **P0** | 收料 | 正常业务被阻断 |
| BUG-004 | `requirement/generate` 无幂等 → 重复需求单 | **P1** | 领料 | 重复单据、重复领料 |
| BUG-019 | 同月同仓可重复创建盘点单 | **P1** | 盘点 | 同范围双单并行调整 |
| BUG-018 | 锁定/解锁不写库存流水 | **P1** | 库存 | 无审计留痕 |
| BUG-003 | 工单 `workOrderDate` 缺省 → 500 | **P2** | 工单 | 接口不健壮 |
| BUG-006 | 重复工单号返回 500 而非 409 | **P2** | 工单 | 错误语义错误 |
| BUG-007 | 未审批领料单发料返回 500 而非 400 | **P2** | 发料 | 错误语义错误 |
| BUG-020 | 并发取消盘点单 → 重复审计日志 | **P2** | 盘点 | 日志污染 |

---

## 二、P0 缺陷详情与修复方案

### BUG-021 · 非法/缺失 UUID 导致 500 + 栈信息泄漏（**建议最先修**）

**现象**：只要路径或查询参数里的 UUID 非法或缺失，就返回 500，并且把完整 SQL 语句、`node_modules` 绝对路径、`PGPASSWORD` 上下文等返回给客户端：

```
HTTP 500
{"error":{"code":"INTERNAL_ERROR","message":"服务器内部错误",
 "stack":"Error: Failed query: select \"id\",\"return_no\",... from \"supplier_return_order\" where \"id\" = $1 ...
    at PostgresJsPreparedQuery.queryWithCache (D:\\WMS-standalone-migrate\\WMS-standalone\\node_modules\\drizzle-orm\\...)
 "cause":{"code":"22P02","name":"PostgresError"}}}
```

**实测爆炸面：28 个探测接口中 18 个 500 泄漏**，含：

- `GET /api/inventory/list?locationId=not-a-uuid`
- `GET /api/material/list?pageSize=5&warehouseId=not-a-uuid`
- `GET /api/warehouse/locations?warehouseId=not-a-uuid`
- `GET /api/stock-take/{id}/{detail|report|logs|items}`、`POST .../submit|approve|cancel|unlock`
- `GET /api/rework/detail/{id}`、`GET /api/supplier-return/detail/{id}`、`GET /api/over-picking/detail/{id}`
- `POST /api/inventory/{adjust|lock|unlock}`、`POST /api/inventory/expiry/extend`
- `POST /api/receipt/batch-receipt`、`POST /api/workorder/requirement/generate`

**根因（已精确定位，单行级）**：`server/common/filters/exception.filter.ts`

过滤器**已经**写了 `22P02` 的处理分支（第 47–61 行，映射为 404），但判断条件取的是 `exception.code`；而 Drizzle 会把 Postgres 错误**包一层**，真实错误码在 `exception.cause.code`：

```
exception.code        → undefined
exception.cause.code  → '22P02'   ← 真正的错误码在这里
```

于是该分支**永远不命中**，直接落到最后的 `else`（第 62–73 行），该分支把 `stack` 与 `cause` 一起序列化给客户端。

**修复方案（推荐 A）**

- **A（最小改动，改 1 处，收益最大）**：在过滤器里同时检查嵌套 cause，并**在生产环境隐藏 stack**：
  ```ts
  const code = (exception as any)?.code ?? (exception as any)?.cause?.code;
  if (code === '22P02') { /* 映射 404，同现有逻辑 */ }
  // else 分支：stack/cause 仅在 NODE_ENV === 'development' 时输出
  ```
- **B（更彻底）**：在 `main.ts` 增加全局 `ValidationPipe` 的 UUID 校验（`@Param('id', ParseUUIDPipe)`），从入口拦住非法 UUID。
- **建议 A + B 一起做**：A 兜住所有历史遗漏，B 保证新增接口不再犯。

---

### BUG-016 · 并发盘点调整：全部成功 + 流水余额与实物不符

**复现**：同一库存行（100 件）并发调用 10 次 `/api/inventory/adjust`，目标值 90…99。

**实测**：
```
成功 10/10（预期最多 1）
实物终值 = 91
最新流水 balance_after = 94   ← 与实物不一致
inventory_transaction 共 10 条，每条声称不同余额
```

**根因**：`inventory.service.ts:adjustInventory`

- 第 1389–1401 行：**在事务外**先读 `currentQty` 并算 `diff`（陈旧读）
- 第 1411–1434 行：事务内直接 `set({ quantity: actualQty })` 绝对赋值，**无行锁、无版本校验、无状态条件**

**修复方案**

- **A（推荐，与 codebase 既有正确写法一致）**：改为「事务内 `SELECT ... FOR UPDATE` 锁行 → 在锁内重算 diff → 条件更新」，并把流水写入同一事务。
- **B（轻量 CAS）**：沿用仓库 `rework.service.ts` 的写法，`UPDATE ... WHERE id=? AND quantity=<读到的旧值>`，更新行数为 0 则抛 409。
- 审计建议：流水 `balance_after` 必须取锁内更新后的真实值。

> 参考实现：`rework.service.ts:156-163,209-225` 是**全项目最标准的 CAS 写法**，建议以此为模板统一整改。

---

### BUG-017 · 锁定（QC 冻结）库存仍可被盘点调整改写

**复现**：把库存行 `locked=true, lock_reason='QC-HOLD'` 后调用 adjust。

**实测**：`HTTP 201`，库存 60 → **999**。质量冻结形同虚设。

**对照**：`transfer`（调拨）**正确拒绝**了锁定库存（400）。说明守卫是**逐接口手写的，漏了 adjust**。

**根因**：`adjustInventory` 只校验 `actualQty >= 0` 和 `reason` 非空，**完全没有检查 `inventory.locked`**。

**修复方案**

- **A（推荐）**：在 `adjustInventory` 加前置校验：若 `inv.locked === true` 且未显式传 `force`/授权角色，则抛 400「该批次处于冻结状态，不可盘点调整，请先解锁」。
- **B（架构级）**：抽出统一的「库存可变更校验」函数（含 locked / stockStatus / 效期），所有库存变更接口（adjust / transfer / pick / 报废 / 退货出库）共用，杜绝再漏。

---

### BUG-002 · IQC 审批非幂等 → 供应商债务重复扣减

**复现**：对同一 IQC 报告重复（或并发）调用 `POST /api/iqc/report/:id/review`。

**实测**：10 并发 → **全部成功**；到货 100 却把 1000 的供应商债务**全额结清**（应为 100）；生成 **10 条结算记录**。顺序点击 3 次同样放大 3 倍。

**根因**

- `iqc.service.ts:reviewReport`（约 1653 行）第 1671 行有注释「**去掉重复审批校验，直接允许审批**」，且事务内无状态复检、无 `FOR UPDATE`。
- `supplier-debt.service.ts:settleDebtOnReceipt`（第 62 行）是纯「先读后写」，**无事务、无锁**。

**修复方案**

- **A（推荐）**：恢复状态守卫并改为 CAS —— 事务内 `UPDATE iqc_report SET status='approved' WHERE id=? AND status='pending'`，影响行数为 0 则抛 409「该报告已审批」。债务结算必须并入**同一事务**。
- **B（补强）**：`supplier_debt` 结算加唯一键 `(source_type, source_id)`，从数据库层兜底防重复结算。
- 注意：**不需**回退严格度计数逻辑 —— `iqc_lot_strictness_count` 已有唯一键，天然幂等（此前修复有效，已验证）。

---

### BUG-005 · 并发发料重复扣减库存（10×）

**复现**：对同一领料单并发调用 10 次发料接口。

**实测**：10/10 全成功；一次 155 的发料，`inventory_transaction` 合计 **1550**（10 倍）；`picking_order_item.actual_qty` 记为 **1000**（应为 100）；单据已 `completed` 但 10 次写全部落地。

**根因**：`workorder.service.ts:pickMaterialIncremental`（约 2030 行）—— `po[0].status` 与 `poItems` 均**在事务外读取**，事务内无 `FOR UPDATE`、无状态复检。

**修复方案**：与 BUG-016 同源，统一采用 `rework.service.ts` 的 CAS 模板：事务内 CAS 更新领料单状态 + `FOR UPDATE` 锁库存行 + 条件扣减。

---

### BUG-001 · `label_no` 唯一键冲突 → 合法收料 500

**复现**：用已用过的流水号（第 6 段）收另一物料。

**实测**：`HTTP 500`。供应商跨物料复用流水号是常见现象，**正常业务被阻断**。

**根因**：`receipt.service.ts` 把 `inventory.labelNo = verifyResult.serialNo`（第 6 段），但 `label_no` 有 UNIQUE 索引。

**修复方案（三选一，需你定）**

- **A**：去掉 `label_no` 的唯一约束，改为普通索引（承认流水号可复用）。
- **B**：把 `labelNo` 改为**全局唯一生成**（如 `物料-批次-流水`组合），收料时自行编排。
- **C**：保留唯一性但改成**冲突更新**（`onConflictDoUpdate` + 累加数量），语义最正确但改动最大。
- 短期兜底：至少要把该场景从 500 变成 409 + 明确提示。

---

## 三、P1 / P2 缺陷（摘要）

| 编号 | 现象 | 根因 | 修复要点 |
|---|---|---|---|
| BUG-004 | `requirement/generate` 重复调用生成 N 张需求单（实测 3 次 → 3 张） | 无幂等键、无「已生成」校验 | 加 `(work_order_id)` 唯一键 + 唯一冲突返回已有单 |
| BUG-019 | 同月同仓可重复建盘点单（实测 2 张并存） | `createTakeForWarehouse` 无去重；`stock_take_order` 无 `(period_month, warehouse_code)` 唯一索引 | 加 DB 唯一索引 + 应用层预检 |
| BUG-018 | lock/unlock 不写 `inventory_transaction` | 两个方法只 `UPDATE inventory` | 补写流水，txType 用 `lock`/`unlock` |
| BUG-003 | 工单 `workOrderDate` 缺省 → 500 | 可选参数透传 `''` 给 `NOT NULL date` 列 | DTO 校验必填，或给默认值 |
| BUG-006 | 重复工单号返回 500 | PG `23505` 唯一冲突未映射 | 捕获 `23505` 转 409 |
| BUG-007 | 未审批领料单发料返回 500 | 状态异常未前置校验 | 前置状态校验返回 400 |
| BUG-020 | 并发取消盘点单成功 5/5 → 5 条 cancel 日志 | `cancelTake` 状态在事务外读、UPDATE 无状态条件 | 同 BUG-016 的 CAS 写法 |

> BUG-006/007 与 BUG-021 同源：**PG 错误码未映射**导致 500。修完 BUG-021 的过滤器后，这两项会自动改善为 404/409，建议一并回归验证。

---

## 四、跨模块的根因归纳（**这才是重点**）

测试过程中反复出现同一类缺陷，可归纳为 **3 个系统性根因**：

### 根因 1：状态机「先读后写」，事务外读、事务内写，无 CAS
**命中**：BUG-002（IQC 审批）、BUG-005（并发发料）、BUG-016（盘点调整）、BUG-020（取消盘点）、BUG-019（重复建单）

**关键事实**：**项目里已经有正确写法** —— `rework.service.ts`（`startRework`/`finishRework`/`reinspect`）和 `mrb.service.ts:finalApprove`（第 1038–1054 行有明确注释「状态 CAS + 行锁」）都是标准实现。**问题是正确写法只在部分模块落地，未统一。**

**统一修复策略**：把「CAS + 事务」抽成公共方法（如 `casUpdate(tx, table, {id, from, to})`），全模块替换。预计可一次性消除 5 个 P0/P1。

### 根因 2：全局异常过滤器对嵌套错误失效 + 生产环境泄漏 stack
**命中**：BUG-021（18 个接口）、BUG-006、BUG-007

**统一修复策略**：修 `exception.filter.ts` 一处（见 BUG-021 方案）+ 生产环境关闭 stack 输出。

### 根因 3：缺少数据库层唯一约束兜底，全靠应用层判断
**命中**：BUG-004（需求单）、BUG-019（盘点单）、BUG-002（债务结算）

**统一修复策略**：对「业务上天然唯一」的组合补唯一索引，并让应用层捕获唯一冲突返回 409。应用层判断会被并发绕过，数据库约束不会。

---

## 五、修复优先级建议（供决策）

| 批次 | 内容 | 理由 |
|---|---|---|
| **第 1 批（立即）** | BUG-021（过滤器单行修复 + 生产关栈） | 改动最小、收益最大、可被外部触发，属安全类问题 |
| **第 2 批（本迭代）** | BUG-017、BUG-018、BUG-016 | 库存核心正确性 + 质量冻结有效性，同一模块一并改 |
| **第 3 批（本迭代）** | BUG-002、BUG-005 | 财务/库存放大类，影响最大但涉及事务改造 |
| **第 4 批** | BUG-001、BUG-004、BUG-019 | 需你先做业务决策（尤其 BUG-001 的三种语义） |
| **第 5 批** | BUG-003、BUG-006、BUG-007、BUG-020 | 健壮性/语义完善，随第 1 批完成后自动改善一部分 |

---

## 六、需要你决策的问题

1. **BUG-001**：`label_no` 流水号可复用是**客观事实**，选 A（放宽约束）/ B（全局重编）/ C（冲突累加）？
2. **BUG-017**：锁定库存做盘点调整，应**一律禁止**，还是允许**特定角色强改**（留痕）？
3. **修复方式**：是否同意「先抽出统一 CAS 工具类，再批量替换」的架构级做法，还是**逐点最小修改**？
4. **验收标准**：修复后是否要求 `_qa/` 全部脚本**零失败**作为回归门槛？

---

## 附：测试脚本清单（可重复执行）

| 脚本 | 覆盖 |
|---|---|
| `_qa/lib.cjs` | 测试框架（请求、断言、并发、DB 直连） |
| `_qa/t1-receipt.cjs` | 收料全流程 + 并发 |
| `_qa/t2-iqc.cjs` | IQC 全流程 + 并发 |
| `_qa/t3-debt-race.cjs` | 供应商债务竞态 |
| `_qa/t4-issue.cjs` | 工单/需求/领料/发料 + 并发 |
| `_qa/t5-inventory.cjs` | 调拨/移库/调整/锁定/效期 + 并发 |
| `_qa/t6-modules.cjs` | 盘点/MRB/退货/返工/不良品移库/超补 |
| `_qa/t7-targeted.cjs` | 过滤器失效面 / IQC 幂等 / 500 泄漏面 |
| `_qa/t8-verify.cjs` | 每个 BUG 的最小复现确认 |
| `_qa/fixture.sql`、`_qa/fixture-bom.sql` | 测试夹具（造数） |
| `_qa/cleanup.sql` | 数据清理/还原 |
