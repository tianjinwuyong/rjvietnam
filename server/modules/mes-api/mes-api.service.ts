import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';

/**
 * MES / 第三方查询接口
 * ------------------------------------------------------------------
 * 只读接口：库存现有量、库存统计、领料单、产线退料单。
 * 不写业务表，不在调用链里触发审批/库存变动，出错不会影响 WMS 自身。
 *
 * 约定：
 *   - 所有金额/数量统一转 float8 返回，避免 numeric 被序列化成字符串；
 *   - 分页用 count(*) OVER() 一次查出总数，避免二次查询；
 *   - pageSize 上限 500，防止外部一次拉全表把库拖慢。
 */

export interface PageQuery {
  page?: string;
  pageSize?: string;
}

export interface StockQuery extends PageQuery {
  materialCode?: string;
  warehouseCode?: string;
  locationCode?: string;
  batchNo?: string;
  stockStatus?: string;
  keyword?: string;
  /** 传 'false' 时连零库存一起返回，默认只返回有量的 */
  onlyAvailable?: string;
}

export interface StockSummaryQuery {
  materialCode?: string;
  warehouseCode?: string;
  stockStatus?: string;
  onlyAvailable?: string;
  /** material（默认）按物料汇总；warehouse 按仓库汇总 */
  groupBy?: string;
}

export interface PickingQuery extends PageQuery {
  pickingNo?: string;
  workOrderNo?: string;
  workSection?: string;
  status?: string;
  /** 创建时间起，格式 YYYY-MM-DD 或 ISO */
  from?: string;
  to?: string;
}

export interface ReturnQuery extends PageQuery {
  returnNo?: string;
  workOrderNo?: string;
  materialCode?: string;
  status?: string;
  from?: string;
  to?: string;
}

function parsePaging(q: PageQuery) {
  const page = Math.max(1, Number(q.page) || 1);
  let pageSize = Number(q.pageSize) || 100;
  if (pageSize < 1) pageSize = 100;
  if (pageSize > 500) pageSize = 500;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** YYYY-MM-DD 或完整 ISO 都接受；非法值直接 400，避免静默返回错误结果 */
function parseDate(v: string | undefined, field: string): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new BadRequestException(`${field} 不是合法日期：${v}`);
  return new Date(t).toISOString();
}

/** Postgres 的 timestamptz 默认序列化成 "2026-10-23 17:23:43+07"，
 *  对第三方系统不友好，统一转成 ISO 8601（UTC）。 */
function iso(col: string) {
  return sql.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class MesApiService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 连通性自检：同时验证服务与数据库 */
  async ping() {
    const rows = (await this.db.execute(sql`SELECT now() AS db_time, current_database() AS db`)) as unknown as any[];
    return {
      ok: true,
      serverTime: new Date().toISOString(),
      database: {
        connected: true,
        name: rows[0]?.db ?? null,
        time: rows[0]?.db_time ?? null,
      },
    };
  }

  // ---------------------------------------------------------------- 库存现有量
  async listStock(q: StockQuery) {
    const { page, pageSize, offset } = parsePaging(q);
    const conds: SQL[] = [sql`TRUE`];
    if (q.materialCode) conds.push(sql`m.material_code = ${q.materialCode}`);
    if (q.warehouseCode) conds.push(sql`w.wh_code = ${q.warehouseCode}`);
    if (q.locationCode) conds.push(sql`l.location_code = ${q.locationCode}`);
    if (q.batchNo) conds.push(sql`i.batch_no = ${q.batchNo}`);
    if (q.stockStatus) conds.push(sql`i.stock_status = ${q.stockStatus}`);
    if (q.keyword) {
      const like = `%${q.keyword}%`;
      conds.push(sql`(m.material_code ILIKE ${like} OR m.material_name ILIKE ${like})`);
    }
    if (q.onlyAvailable !== 'false') conds.push(sql`i.quantity > 0`);
    const where = sql.join(conds, sql` AND `);

    const rows = (await this.db.execute(sql`
      SELECT m.material_code, m.material_name, m.specification, i.unit,
             w.wh_code AS warehouse_code, w.wh_name_zh AS warehouse_name,
             l.location_code, i.batch_no, i.quantity::float8 AS quantity,
             i.stock_status, i.locked, i.lock_reason,
             i.production_date, i.label_no, ${iso('i._updated_at')} AS updated_at,
             count(*) OVER() AS total
        FROM inventory i
        JOIN material m ON m.id = i.material_id
        JOIN warehouse_location l ON l.id = i.location_id
        JOIN warehouse w ON w.id = l.warehouse_id
       WHERE ${where}
       ORDER BY m.material_code, i.batch_no, l.location_code
       LIMIT ${pageSize} OFFSET ${offset}
    `)) as unknown as any[];

    const items = rows.map((r) => ({
      materialCode: r.material_code,
      materialName: r.material_name,
      specification: r.specification,
      unit: r.unit,
      warehouseCode: r.warehouse_code,
      warehouseName: r.warehouse_name,
      locationCode: r.location_code,
      batchNo: r.batch_no,
      quantity: num(r.quantity),
      stockStatus: r.stock_status,
      locked: !!r.locked,
      lockReason: r.lock_reason,
      productionDate: r.production_date,
      labelNo: r.label_no,
      updatedAt: r.updated_at,
    }));

    return { items, page, pageSize, total: rows.length ? num(rows[0].total) : 0 };
  }

  // ---------------------------------------------------------------- 库存统计
  async stockSummary(q: StockSummaryQuery) {
    const groupBy = q.groupBy === 'warehouse' ? 'warehouse' : 'material';
    const conds: SQL[] = [sql`TRUE`];
    if (q.materialCode) conds.push(sql`m.material_code = ${q.materialCode}`);
    if (q.warehouseCode) conds.push(sql`w.wh_code = ${q.warehouseCode}`);
    if (q.stockStatus) conds.push(sql`i.stock_status = ${q.stockStatus}`);
    if (q.onlyAvailable !== 'false') conds.push(sql`i.quantity > 0`);
    const where = sql.join(conds, sql` AND `);

    if (groupBy === 'warehouse') {
      const rows = (await this.db.execute(sql`
        SELECT w.wh_code AS warehouse_code, w.wh_name_zh AS warehouse_name,
               sum(i.quantity)::float8 AS total_qty,
               count(DISTINCT m.id)::int AS material_count,
               count(*)::int AS lot_count,
               sum(CASE WHEN i.locked THEN i.quantity ELSE 0 END)::float8 AS locked_qty
          FROM inventory i
          JOIN material m ON m.id = i.material_id
          JOIN warehouse_location l ON l.id = i.location_id
          JOIN warehouse w ON w.id = l.warehouse_id
         WHERE ${where}
         GROUP BY w.wh_code, w.wh_name_zh
         ORDER BY total_qty DESC
      `)) as unknown as any[];

      return {
        groupBy,
        items: rows.map((r) => ({
          warehouseCode: r.warehouse_code,
          warehouseName: r.warehouse_name,
          totalQty: num(r.total_qty),
          lockedQty: num(r.locked_qty),
          materialCount: num(r.material_count),
          lotCount: num(r.lot_count),
        })),
      };
    }

    const rows = (await this.db.execute(sql`
      SELECT m.material_code, m.material_name, m.specification, m.unit,
             sum(i.quantity)::float8 AS total_qty,
             sum(CASE WHEN i.locked THEN i.quantity ELSE 0 END)::float8 AS locked_qty,
             count(*)::int AS lot_count,
             count(DISTINCT w.wh_code)::int AS warehouse_count
        FROM inventory i
        JOIN material m ON m.id = i.material_id
        JOIN warehouse_location l ON l.id = i.location_id
        JOIN warehouse w ON w.id = l.warehouse_id
       WHERE ${where}
       GROUP BY m.material_code, m.material_name, m.specification, m.unit
       ORDER BY total_qty DESC, m.material_code
    `)) as unknown as any[];

    return {
      groupBy,
      items: rows.map((r) => ({
        materialCode: r.material_code,
        materialName: r.material_name,
        specification: r.specification,
        unit: r.unit,
        totalQty: num(r.total_qty),
        lockedQty: num(r.locked_qty),
        lotCount: num(r.lot_count),
        warehouseCount: num(r.warehouse_count),
      })),
    };
  }

  // ---------------------------------------------------------------- 领料单
  async listPicking(q: PickingQuery) {
    const { page, pageSize, offset } = parsePaging(q);
    const conds: SQL[] = [sql`TRUE`];
    if (q.pickingNo) conds.push(sql`p.picking_no = ${q.pickingNo}`);
    if (q.workOrderNo) conds.push(sql`w.work_order_no = ${q.workOrderNo}`);
    if (q.workSection) conds.push(sql`p.work_section = ${q.workSection}`);
    if (q.status) conds.push(sql`p.status = ${q.status}`);
    const from = parseDate(q.from, 'from');
    const to = parseDate(q.to, 'to');
    if (from) conds.push(sql`p._created_at >= ${from}::timestamptz`);
    if (to) conds.push(sql`p._created_at <= ${to}::timestamptz`);
    const where = sql.join(conds, sql` AND `);

    const rows = (await this.db.execute(sql`
      SELECT p.picking_no, p.work_section, p.is_supplement,
             p.total_qty::float8 AS total_qty, p.status, p.oa_status,
             ${iso('p._created_at')} AS created_at, ${iso('p.pick_time')} AS pick_time, ${iso('p.received_time')} AS received_time,
             w.work_order_no, w.product_code, w.product_name,
             (SELECT count(*)::int FROM picking_order_item it WHERE it.picking_id = p.id) AS item_count,
             count(*) OVER() AS total
        FROM picking_order p
        LEFT JOIN work_order w ON w.id = p.work_order_id
       WHERE ${where}
       ORDER BY p._created_at DESC
       LIMIT ${pageSize} OFFSET ${offset}
    `)) as unknown as any[];

    const items = rows.map((r) => ({
      pickingNo: r.picking_no,
      workOrderNo: r.work_order_no,
      productCode: r.product_code,
      productName: r.product_name,
      workSection: r.work_section,
      isSupplement: !!r.is_supplement,
      totalQty: num(r.total_qty),
      status: r.status,
      oaStatus: r.oa_status,
      itemCount: num(r.item_count),
      createdAt: r.created_at,
      pickTime: r.pick_time,
      receivedTime: r.received_time,
    }));

    return { items, page, pageSize, total: rows.length ? num(rows[0].total) : 0 };
  }

  async getPicking(pickingNo: string) {
    const head = (await this.db.execute(sql`
      SELECT p.picking_no, p.work_section, p.is_supplement, p.total_qty::float8 AS total_qty,
             p.status, p.oa_status, p.remark,
             ${iso('p._created_at')} AS created_at, ${iso('p.pick_time')} AS pick_time, ${iso('p.received_time')} AS received_time, p.receive_remark,
             w.work_order_no, w.product_code, w.product_name, w.plan_qty::float8 AS plan_qty
        FROM picking_order p
        LEFT JOIN work_order w ON w.id = p.work_order_id
       WHERE p.picking_no = ${pickingNo}
       LIMIT 1
    `)) as unknown as any[];

    if (!head.length) throw new NotFoundException(`领料单不存在：${pickingNo}`);

    const items = (await this.db.execute(sql`
      SELECT it.material_code, it.material_name, it.unit,
             it.pick_qty::float8 AS pick_qty, it.actual_qty::float8 AS actual_qty,
             it.received_qty::float8 AS received_qty, it.actual_material_code,
             m.specification, m.packaging_type
        FROM picking_order_item it
        LEFT JOIN material m ON m.id = it.material_id
       WHERE it.picking_id = (SELECT id FROM picking_order WHERE picking_no = ${pickingNo})
       ORDER BY it.material_code
    `)) as unknown as any[];

    const h = head[0];
    return {
      pickingNo: h.picking_no,
      workOrderNo: h.work_order_no,
      productCode: h.product_code,
      productName: h.product_name,
      planQty: h.plan_qty === null ? null : num(h.plan_qty),
      workSection: h.work_section,
      isSupplement: !!h.is_supplement,
      totalQty: num(h.total_qty),
      status: h.status,
      oaStatus: h.oa_status,
      remark: h.remark,
      createdAt: h.created_at,
      pickTime: h.pick_time,
      receivedTime: h.received_time,
      receiveRemark: h.receive_remark,
      items: items.map((r) => ({
        materialCode: r.material_code,
        materialName: r.material_name,
        specification: r.specification,
        packagingType: r.packaging_type,
        unit: r.unit,
        pickQty: num(r.pick_qty),
        actualQty: num(r.actual_qty),
        receivedQty: num(r.received_qty),
        actualMaterialCode: r.actual_material_code,
      })),
    };
  }

  // ---------------------------------------------------------------- 产线退料
  async listReturns(q: ReturnQuery) {
    const { page, pageSize, offset } = parsePaging(q);
    const conds: SQL[] = [sql`TRUE`];
    if (q.returnNo) conds.push(sql`r.return_no = ${q.returnNo}`);
    if (q.workOrderNo) conds.push(sql`r.work_order_no = ${q.workOrderNo}`);
    if (q.materialCode) conds.push(sql`r.material_code = ${q.materialCode}`);
    if (q.status) conds.push(sql`r.status = ${q.status}`);
    const from = parseDate(q.from, 'from');
    const to = parseDate(q.to, 'to');
    if (from) conds.push(sql`r._created_at >= ${from}::timestamptz`);
    if (to) conds.push(sql`r._created_at <= ${to}::timestamptz`);
    const where = sql.join(conds, sql` AND `);

    const rows = (await this.db.execute(sql`
      SELECT r.return_no, r.material_code, r.material_name, r.unit,
             r.quantity::float8 AS quantity, r.batch_no, r.production_date,
             r.work_order_no, r.status, r.return_reason,
             r.received_good_qty::float8 AS received_good_qty,
             r.received_incoming_defect_qty::float8 AS received_incoming_defect_qty,
             r.received_operation_defect_qty::float8 AS received_operation_defect_qty,
             ${iso('r._created_at')} AS created_at,
             count(*) OVER() AS total
        FROM production_return r
       WHERE ${where}
       ORDER BY r._created_at DESC
       LIMIT ${pageSize} OFFSET ${offset}
    `)) as unknown as any[];

    const items = rows.map((r) => {
      const total = num(r.quantity);
      const received =
        num(r.received_good_qty) + num(r.received_incoming_defect_qty) + num(r.received_operation_defect_qty);
      return {
        returnNo: r.return_no,
        materialCode: r.material_code,
        materialName: r.material_name,
        unit: r.unit,
        quantity: total,
        batchNo: r.batch_no,
        productionDate: r.production_date,
        workOrderNo: r.work_order_no,
        status: r.status,
        returnReason: r.return_reason,
        receivedQty: received,
        pendingQty: Math.round((total - received) * 1000) / 1000,
        createdAt: r.created_at,
      };
    });

    return { items, page, pageSize, total: rows.length ? num(rows[0].total) : 0 };
  }

  async getReturn(returnNo: string) {
    const rows = (await this.db.execute(sql`
      SELECT r.return_no, r.material_code, r.material_name, r.unit,
             r.quantity::float8 AS quantity, r.batch_no, r.production_date,
             r.supplier_code, r.supplier_name, r.work_order_no, r.status, r.return_reason,
             r.received_good_qty::float8 AS received_good_qty,
             r.received_incoming_defect_qty::float8 AS received_incoming_defect_qty,
             r.received_operation_defect_qty::float8 AS received_operation_defect_qty,
             ${iso('r._created_at')} AS created_at, ${iso('r._updated_at')} AS updated_at
        FROM production_return r
       WHERE r.return_no = ${returnNo}
       LIMIT 1
    `)) as unknown as any[];

    if (!rows.length) throw new NotFoundException(`退料单不存在：${returnNo}`);
    const r = rows[0];
    return {
      returnNo: r.return_no,
      materialCode: r.material_code,
      materialName: r.material_name,
      unit: r.unit,
      quantity: num(r.quantity),
      batchNo: r.batch_no,
      productionDate: r.production_date,
      supplierCode: r.supplier_code,
      supplierName: r.supplier_name,
      workOrderNo: r.work_order_no,
      status: r.status,
      returnReason: r.return_reason,
      receivedQty: {
        good: num(r.received_good_qty),
        incomingDefect: num(r.received_incoming_defect_qty),
        operationDefect: num(r.received_operation_defect_qty),
      },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
