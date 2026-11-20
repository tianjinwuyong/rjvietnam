import { ConflictException, BadRequestException } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';

/**
 * 乐观并发控制（CAS, Compare-And-Swap）与悲观行锁的统一工具。
 *
 * 背景：
 *   项目内多处「状态机」写法为「事务外先读状态 → 事务内无条件写入」，
 *   在并发下会同时通过前置校验，导致重复审批、重复扣减、重复流水等问题
 *   （详见 BUG-002 / BUG-005 / BUG-016 / BUG-019 / BUG-020）。
 *
 *   本工具把「正确的写法」固化为可复用的原语，供各业务模块统一调用，
 *   避免每个模块各写一遍、又写错一遍。
 *
 * 参考实现（改造前项目内已有的正确写法）：
 *   - rework.service.ts:startRework / finishRework / reinspect
 *   - mrb.service.ts:finalApprove（「状态 CAS + 行锁」）
 *
 * 事务类型：为了让工具能同时用于 `db` 与 `tx`，这里用宽松的结构类型，
 * 不直接依赖 Drizzle 事务的复杂泛型，避免在各调用点产生类型摩擦。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbLike = any;

/** CAS 失败时抛出的默认提示，可按业务覆盖 */
const DEFAULT_CONFLICT_MESSAGE = '数据状态已变更，请刷新后重试';

export interface CasUpdateOptions<T extends PgTable> {
  /** 目标表 */
  table: T;
  /** 主键列 */
  idColumn: PgColumn;
  /** 主键值 */
  id: string;
  /** 要写入的字段（不含状态条件字段） */
  set: Record<string, unknown>;
  /**
   * CAS 前置条件：只有满足这些条件时更新才会生效。
   * 通常是 `[eq(table.status, 'pending_finial')]` 这类状态守卫。
   * 传入后会自动与主键条件 AND 组合。
   */
  guard?: SQL[];
  /** CAS 失败（影响行数 = 0）时抛出的异常信息；传 null 表示不抛异常 */
  conflictMessage?: string | null;
  /** 期望返回的字段，默认返回 id */
  returning?: Record<string, PgColumn>;
}

/**
 * 条件更新（CAS）：仅当 `guard` 全部满足时更新，影响行数为 0 视为并发冲突。
 *
 * @returns 更新影响的行数组（长度 1 表示成功）
 * @throws ConflictException 当 guard 不满足（被其他请求抢先修改）且未禁用异常时
 */
export async function casUpdate<T extends PgTable>(
  db: DbLike,
  opts: CasUpdateOptions<T>,
): Promise<Array<Record<string, unknown>>> {
  const { table, idColumn, id, set, guard = [], conflictMessage = DEFAULT_CONFLICT_MESSAGE } = opts;
  const returning = opts.returning ?? { id: idColumn };

  const where = and(eq(idColumn, id), ...guard);

  const rows = (await db
    .update(table)
    .set(set)
    .where(where)
    .returning(returning)) as Array<Record<string, unknown>>;

  if (rows.length === 0 && conflictMessage !== null) {
    throw new ConflictException(conflictMessage);
  }
  return rows;
}

/**
 * 读取一行并加悲观行锁（SELECT ... FOR UPDATE），必须在事务内调用。
 *
 * 用于「锁内重算」场景：例如盘点调整需要拿到最新数量再计算差额。
 *
 * @returns 行对象；不存在时返回 null
 */
export async function lockRow<T extends PgTable>(
  db: DbLike,
  table: T,
  idColumn: PgColumn,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = (await db
    .select()
    .from(table)
    .where(eq(idColumn, id))
    .for('update')
    .limit(1)) as Array<Record<string, unknown>>;
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 按任意条件读取一行并加行锁（SELECT ... FOR UPDATE），必须在事务内调用。
 */
export async function lockRowWhere<T extends PgTable>(
  db: DbLike,
  table: T,
  condition: SQL | undefined,
): Promise<Record<string, unknown> | null> {
  const rows = (await db
    .select()
    .from(table)
    .where(condition)
    .for('update')
    .limit(1)) as Array<Record<string, unknown>>;
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 条件扣减/自增数量（原子），防止并发下扣成负数。
 *
 * 生成的 SQL 形如：
 *   UPDATE t SET quantity = quantity - :delta
 *   WHERE id = :id AND quantity >= :delta
 *
 * @returns 是否成功（false = 库存不足，未做任何修改）
 */
export async function conditionalDecrement(
  db: DbLike,
  table: PgTable,
  qtyColumn: PgColumn,
  idColumn: PgColumn,
  id: string,
  delta: number | string,
  extraGuard: SQL[] = [],
): Promise<boolean> {
  const rows = (await db
    .update(table)
    .set({ [qtyColumn.name]: sql`${qtyColumn} - ${delta}` })
    .where(and(eq(idColumn, id), sql`${qtyColumn} >= ${delta}`, ...extraGuard))
    .returning({ id: idColumn })) as Array<{ id: string }>;
  return rows.length > 0;
}

/**
 * 将数值按固定精度放大为整数，用于避免浮点误差下的比较/求和偏差。
 * 保持与业务侧 toScaled 一致（默认 4 位小数）。
 */
export function toScaled(value: unknown, decimals = 4): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * Math.pow(10, decimals));
}

/** 与 toScaled 对应的还原函数 */
export function fromScaled(scaled: number, decimals = 4): number {
  return scaled / Math.pow(10, decimals);
}

/** UUID 形态校验（v1~v5 均可，宽松匹配） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 入口参数守卫：把「缺失/非法 UUID」在进 SQL 之前挡掉。
 *
 * 背景（BUG-021）：项目大量 service 直接把 body 里的 id 丢进 SQL，
 * 缺失时为 `undefined`、非法时形如 `abc`，PG 报 22P02 invalid input syntax，
 * 被包装成 500 并把 SQL 语句与内部路径回吐给客户端。
 * 统一在服务入口调用本函数，返回 400 而不是 500。
 *
 * @param value 待校验值
 * @param label 字段中文名，用于组装错误提示
 * @throws BadRequestException
 */
export function requireUuid(value: unknown, label = '参数'): string {
  if (value === undefined || value === null || value === '') {
    throw new BadRequestException(`${label}不能为空`);
  }
  const s = String(value);
  if (!UUID_RE.test(s)) {
    throw new BadRequestException(`${label}格式不正确`);
  }
  return s;
}
