import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { sql, desc, like, eq, and, gte, lt, count } from 'drizzle-orm';
import { customTimestamptz } from '../../database/schema';

@Injectable()
export class SupplierDebtService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 自动生成欠料单号 */
  private async nextDebtNo(conn: any): Promise<string> {
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix = `SD${dateStr}`;
    const result = await conn
      .execute(sql`SELECT MAX(debt_no) as max_no FROM supplier_debt WHERE debt_no LIKE ${prefix + '%'}`);
    // postgres.js 驱动的 execute 直接返回行数组（无 .rows 包装）
    const maxNo = (result as unknown as Array<{ max_no?: string }>)[0]?.max_no;
    if (!maxNo) return `${prefix}0001`;
    const seq = parseInt(maxNo.slice(prefix.length), 10);
    return `${prefix}${String(seq + 1).padStart(4, '0')}`;
  }

  /** user_profile 复合类型列的写入表达式（直接传 uuid 字符串会报 22P02） */
  private userLit(userId?: string | null) {
    return userId ? sql`ROW(${userId})::user_profile` : sql`null`;
  }

  /**
   * 新增欠料记录。
   *
   * `tx` 传入时必须与调用方同事务：MRB 终审是「审批 + 库存 + 退货单 + 欠料」一次提交，
   * 若这里自建连接写入，事务回滚会留下孤儿欠料，导致供应商被凭空记一笔债。
   */
  async createDebt(params: {
    supplierId: string;
    supplierCode: string;
    supplierName: string;
    materialId: string;
    materialCode: string;
    materialName: string;
    qty: number;
    sourceType: string;
    sourceId: string;
    sourceNo: string;
    userId?: string;
    /** 外部事务；不传则自建事务 */
    tx?: any;
  }): Promise<void> {
    const run = async (conn: any) => {
      const debtNo = await this.nextDebtNo(conn);
      await conn.execute(sql`
        INSERT INTO supplier_debt (
          debt_no, supplier_id, supplier_code, supplier_name,
          material_id, material_code, material_name,
          origin_qty, settled_qty, source_type, source_id, source_no,
          status, _created_by, _updated_by
        ) VALUES (
          ${debtNo}, ${params.supplierId}, ${params.supplierCode}, ${params.supplierName},
          ${params.materialId}, ${params.materialCode}, ${params.materialName},
          ${params.qty}, 0, ${params.sourceType}, ${params.sourceId}, ${params.sourceNo},
          'pending', ${this.userLit(params.userId)}, ${this.userLit(params.userId)}
        )
      `);
    };

    if (params.tx) {
      await run(params.tx);
    } else {
      await this.db.transaction((tx) => run(tx));
    }
  }

  /**
   * 收料IQC PASS解锁时自动冲减欠料。
   *
   * BUG-002 修复要点：
   *  1) 支持传入外部事务 `tx` —— 审批与冲减必须在同一事务内完成，否则重复审批会在窗口内重复冲减；
   *  2) 读取欠料行时使用 `FOR UPDATE` 行锁，避免并发审批同时读到相同 settled_qty 后各自覆盖（丢失更新）；
   *  3) 以 (debt_id, receipt_id) 做幂等：同一张收料单对同一条欠料只冲减一次，
   *     即使上游出现重复调用也不会重复扣减。
   */
  async settleDebtOnReceipt(params: {
    supplierId: string;
    materialId: string;
    qty: number;
    receiptId: string;
    receiptNo: string;
    userId?: string;
    /** 外部事务；不传则自建事务（保证与调用方原子性） */
    tx?: any;
  }): Promise<{ settledQty: number; remainingQty: number }> {
    const { supplierId, materialId, qty, receiptId, receiptNo, userId } = params;

    const run = async (conn: any) => {
      let remaining = qty;
      let totalSettled = 0;

      // 查询所有未平账的欠料并加行锁（FOR UPDATE），按创建时间排序（先欠的先冲）
      const pendingDebts = await conn.execute(sql`
        SELECT id, debt_no, origin_qty, settled_qty, (origin_qty - settled_qty) as remaining_qty
        FROM supplier_debt
        WHERE supplier_id = ${supplierId}
          AND material_id = ${materialId}
          AND status = 'pending'
        ORDER BY _created_at ASC
        FOR UPDATE
      `);

      for (const debt of pendingDebts as unknown as Array<Record<string, any>>) {
        if (remaining <= 0) break;
        const debtRemaining = parseFloat(debt.remaining_qty);
        if (debtRemaining <= 0) continue;

        // ---- 幂等守卫：同一条欠料 + 同一张收料单只允许冲减一次 ----
        const dup = await conn.execute(sql`
          SELECT COALESCE(SUM(qty), 0) AS already
          FROM supplier_debt_settlement
          WHERE debt_id = ${debt.id} AND receipt_id = ${receiptId}
        `);
        const already = parseFloat(
          (dup as unknown as Array<{ already?: string }>)[0]?.already ?? '0',
        );
        const capacity = Math.max(debtRemaining - already, 0);
        if (capacity <= 0) continue;

        const settleQty = Math.min(remaining, capacity);
        totalSettled += settleQty;
        remaining -= settleQty;

        // 更新欠料表的已补数量
        const newSettledQty = parseFloat(debt.settled_qty) + settleQty;
        const newStatus = newSettledQty >= parseFloat(debt.origin_qty) ? 'settled' : 'pending';

        await conn.execute(sql`
          UPDATE supplier_debt
          SET settled_qty = ${newSettledQty}, status = ${newStatus}, _updated_by = ${this.userLit(userId)}
          WHERE id = ${debt.id}
        `);

        // 插入冲减记录
        await conn.execute(sql`
          INSERT INTO supplier_debt_settlement (
            debt_id, receipt_id, receipt_no, qty, iqc_result, _created_by, _updated_by
          ) VALUES (
            ${debt.id}, ${receiptId}, ${receiptNo}, ${settleQty}, 'pass', ${this.userLit(userId)}, ${this.userLit(userId)}
          )
        `);
      }

      return { settledQty: totalSettled, remainingQty: remaining };
    };

    if (params.tx) {
      return run(params.tx);
    }
    return this.db.transaction((tx) => run(tx));
  }

  /** 欠料台账列表 */
  async getDebtList(params: {
    page: number;
    pageSize: number;
    supplierName?: string;
    materialCode?: string;
    status?: string;
  }): Promise<{ items: any[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize, supplierName, materialCode, status } = params;
    const offset = (page - 1) * pageSize;

    let whereClause = sql`1=1`;
    const conditions = [];
    if (supplierName) {
      conditions.push(sql`supplier_name LIKE ${'%' + supplierName + '%'}`);
    }
    if (materialCode) {
      conditions.push(sql`material_code LIKE ${'%' + materialCode + '%'}`);
    }
    if (status) {
      conditions.push(sql`status = ${status}`);
    }
    if (conditions.length > 0) {
      whereClause = sql.join(conditions, sql` AND `);
    }

    const totalResult = await this.db.execute(sql`
      SELECT COUNT(*) as total FROM supplier_debt WHERE ${whereClause}
    `);

    const result = await this.db.execute(sql`
      SELECT
        id, debt_no, supplier_code, supplier_name,
        material_code, material_name,
        origin_qty, settled_qty, (origin_qty - settled_qty) as remaining_qty,
        source_type, source_no, status, remark,
        _created_at, _updated_at
      FROM supplier_debt
      WHERE ${whereClause}
      ORDER BY _created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    return {
      items: result as unknown as any[],
      total: parseInt((totalResult as unknown as Array<{ total?: string }>)[0]?.total || '0'),
      page,
      pageSize,
    };
  }

  /** 欠料详情（包含冲减记录） */
  async getDebtDetail(id: string): Promise<any> {
    const debtResult = await this.db.execute(sql`
      SELECT * FROM supplier_debt WHERE id = ${id}
    `) as unknown as any[];
    if (debtResult.length === 0) {
      throw new BadRequestException('欠料记录不存在');
    }

    const settlementResult = await this.db.execute(sql`
      SELECT * FROM supplier_debt_settlement
      WHERE debt_id = ${id}
      ORDER BY _created_at ASC
    `) as unknown as any[];

    return {
      ...debtResult[0],
      settlements: settlementResult,
    };
  }

  /** 检查某供应商某料号是否有未平账欠料 */
  async hasPendingDebt(supplierId: string, materialId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT COUNT(*) as count FROM supplier_debt
      WHERE supplier_id = ${supplierId} AND material_id = ${materialId} AND status = 'pending'
    `);
    return parseInt((result as unknown as Array<{ count?: string }>)[0]?.count || '0') > 0;
  }
}
