/**
 * 盘点冻结守卫（Stock-take freeze guard）。
 *
 * 业务规则（用户需求）：制定盘点计划后，必须冻结仓库异动，才能获得盘点的真实数据。
 *   - 冻结判定：某仓库存在 `status IN ('draft', 'pending_approval')` 的盘点单，即视为「冻结中」。
 *   - 冻结时机：创建盘点单（draft）即冻结；提交审批（pending_approval）仍冻结。
 *   - 解冻时机：审批通过（approved）/ 驳回（rejected）/ 取消（cancelled）即解冻。
 *
 * 所有会产生库存异动（发料、调拨、收货、退货、返工、报废、盘点调整等）的入口，
 * 都应在事务内、改动库存前调用 `assertWarehouseNotFrozen` / `assertLocationNotFrozen`。
 */
import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

type DbExecutor = {
  execute: (query: any) => Promise<any[]>;
};

/** 冻结中的盘点单状态集合 */
const FREEZING_STATUSES = ['draft', 'pending_approval'];

/**
 * 查询某仓库当前冻结中的盘点单（返回 take_no 列表）。
 * 无冻结返回空数组。
 */
export async function getFreezingTakeNos(
  db: DbExecutor,
  warehouseId: string,
): Promise<string[]> {
  if (!warehouseId) return [];
  const rows = (await db.execute(
    sql`
      SELECT take_no
      FROM stock_take_order
      WHERE warehouse_id = ${warehouseId}::uuid
        AND status IN (${sql.join(FREEZING_STATUSES.map((s) => sql`${s}`), sql`, `)})
      ORDER BY _created_at ASC
    `,
  )) as unknown as Array<{ take_no: string }>;
  return rows.map((r) => r.take_no);
}

/** 某仓库是否冻结中 */
export async function isWarehouseFrozen(
  db: DbExecutor,
  warehouseId: string,
): Promise<boolean> {
  const nos = await getFreezingTakeNos(db, warehouseId);
  return nos.length > 0;
}

/** 断言仓库未冻结；冻结则抛 ConflictException */
export async function assertWarehouseNotFrozen(
  db: DbExecutor,
  warehouseId: string,
  actionDesc = '该操作',
): Promise<void> {
  if (!warehouseId) return;
  const nos = await getFreezingTakeNos(db, warehouseId);
  if (nos.length > 0) {
    throw new ConflictException(
      `该仓库正在进行盘点（盘点单 ${nos.join('、')}），库存已冻结，${actionDesc}暂不可执行。请待盘点完成或取消盘点单后再操作。`,
    );
  }
}

/**
 * 根据库位断言未冻结：先反查库位所属仓库，再校验。
 * 用于入口只拿到 locationId 的场景。
 */
export async function assertLocationNotFrozen(
  db: DbExecutor,
  locationId: string,
  actionDesc = '该操作',
): Promise<void> {
  if (!locationId) return;
  const rows = (await db.execute(
    sql`SELECT warehouse_id FROM warehouse_location WHERE id = ${locationId}::uuid LIMIT 1`,
  )) as unknown as Array<{ warehouse_id: string }>;
  const warehouseId = rows[0]?.warehouse_id;
  if (!warehouseId) return;
  await assertWarehouseNotFrozen(db, warehouseId, actionDesc);
}
