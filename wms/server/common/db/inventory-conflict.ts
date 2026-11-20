/**
 * `inventory` 表的 ON CONFLICT 冲突目标 —— 单一来源。
 *
 * 为什么单独成文件：
 *  `inventory` 的唯一索引 `(material_id, location_id, batch_no, stock_status)` 被全仓
 *  20+ 处 `insert(inventory).onConflictDoUpdate()` 依赖。这个索引**不能**改（包括改成
 *  部分索引 / 加表达式列）：任何一处调用方忘了同步 `target` / `targetWhere`，运行时
 *  就会报 42P10「there is no unique or exclusion constraint matching the ON CONFLICT
 *  specification」，直接影响收料、IQC、发料、调拨、退料等主链路。
 *
 *  因此 MRB「其他」处置的库存隔离**不通过索引实现**，而是通过
 *  「一张 MRB 一个专属保留库位」（`<不良品仓编码>-MRB-RSV-<mrbNo>`）实现：
 *  4 列唯一键里含 `location_id`，跨 MRB 天然隔离；同一 MRB 内多条明细合并成一行
 *  （数量累加）是预期行为，因为核销按 `mrb_disposition.quantity` 逐条扣减。
 *  详见 `server/modules/mrb/mrb.status.ts` 的 `MRB_OTHER_LOCK_PREFIX` 注释与设计文档
 *  §7-5（v2.1-arch.1）。
 *
 * 用法：
 * ```ts
 * await tx.insert(inventory).values({...}).onConflictDoUpdate({
 *   target: INVENTORY_STOCK_CONFLICT_TARGET,
 *   set: { quantity: sql`${inventory.quantity} + excluded.quantity` },
 * });
 * ```
 * ⚠️ 不要再写 `targetWhere`：库上没有部分索引，带上 WHERE 谓词反而推断不到索引。
 */
import { inventory } from '@server/database/schema';

/** `inventory` 唯一索引的列顺序，必须与 `schema.ts` 里 `uniqueIndex(...)` 完全一致 */
export const INVENTORY_STOCK_CONFLICT_TARGET = [
  inventory.materialId,
  inventory.locationId,
  inventory.batchNo,
  inventory.stockStatus,
];
