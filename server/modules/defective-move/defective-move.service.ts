import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, desc, asc, sql, count, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  defectiveMoveTask,
  inventory,
  warehouseLocation,
  material,
  supplier,
  mrbReview,
} from '@server/database/schema';
import { NoticeService } from '../notice/notice.service';
import { nextDefectiveMoveNo } from '../../common/utils/doc-no.util';
import { assertLocationNotFrozen } from '../../common/utils/stocktake-freeze';

/** 目标库位（别名）：一条 SQL 里要同时取「来源库位」和「目标库位」 */
const toLocation = alias(warehouseLocation, 'to_location');

/** 手工单锁定库存时写入的 lock_reason 前缀（与 MRB 的 `MRB-` 标记族区分） */
const MANUAL_LOCK_PREFIX = 'DEFECTIVE-MOVE:';

/** 单据状态 */
const ST_PENDING_CONFIRM = 'pending_confirm';
const ST_PENDING = 'pending';
const ST_COMPLETED = 'completed';
const ST_CANCELLED = 'cancelled';

interface ParsedLabel {
  raw: string;
  supplierCode?: string;
  materialCode?: string;
  batchNo?: string;
  quantity?: number;
  productionDate?: string;
  serialNo?: string;
  /** 是否为完整六段码 */
  structured: boolean;
}

/**
 * 解析货物标签。
 *
 * 现场同时存在两种六段码分隔符：收料/不良品调拨用 `*`，PDA 来料码用 `|`，
 * 两种都必须认。不足六段时按「物料码 / 批次号」单值处理，仍然参与校验，
 * 只是校验强度低一档（至少能挡住「拿错料」）。
 */
export function parseLabelCode(raw: string): ParsedLabel | null {
  const text = (raw || '').trim();
  if (!text) return null;
  const sep = text.includes('|') ? '|' : text.includes('*') ? '*' : null;
  if (!sep) {
    return { raw: text, structured: false };
  }
  const parts = text.split(sep).map((p) => p.trim());
  if (parts.length < 6) {
    return { raw: text, structured: false };
  }
  const qty = Number(parts[3]);
  return {
    raw: text,
    supplierCode: parts[0],
    materialCode: parts[1],
    productionDate: parts[2],
    quantity: Number.isFinite(qty) ? qty : undefined,
    batchNo: parts[4],
    serialNo: parts[5],
    structured: true,
  };
}

/**
 * 不良品调拨单（统一单据：MRB 派生 + 良品手工制单）。
 *
 * 业务定位：任何货要进不良品仓，都必须挂在一张单据上，并由仓管员**扫码**执行：
 *  - MRB 判「退货 / 报废 / 否决」后，终审自动生成本单（待执行）；
 *  - 良品仓在生产过程中发现不良时，仓管员手工制单 → 仓库主管确认 → 仓管员扫码执行。
 *
 * 为什么强制扫码：改造前 PC 端只要选一个不良品仓库位就能点「完成」，
 * 仓管员搬错货、搬错库位系统都看不出来。现在服务端强制要求「货物标签 + 目标库位码」，
 * 标签必须与本单的物料 + 批次一致，目标库位必须属于不良品仓。
 */
@Injectable()
export class DefectiveMoveService {
  private readonly logger = new Logger(DefectiveMoveService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly noticeService: NoticeService,
  ) {}

  // =========================================================================
  // 一、查询
  // =========================================================================

  /**
   * 单据列表。
   *
   * `status` 支持逗号分隔（前端「待处理」= pending_confirm,pending）；
   * `keyword` 同时匹配单号 / MRB 单号 / 物料码 / 物料名 / 批次。
   */
  async getTaskList(params: {
    page: number;
    pageSize: number;
    status?: string;
    materialCode?: string;
    mrbNo?: string;
    source?: string;
    keyword?: string;
  }) {
    const { page, pageSize, status, materialCode, mrbNo, source, keyword } = params;
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 20));

    const conditions: any[] = [];
    if (status) {
      const list = status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length === 1) conditions.push(eq(defectiveMoveTask.status, list[0]));
      else if (list.length > 1) conditions.push(inArray(defectiveMoveTask.status, list));
    }
    if (source) conditions.push(eq(defectiveMoveTask.source, source));
    if (materialCode) conditions.push(like(material.materialCode, `%${materialCode}%`));
    if (mrbNo) conditions.push(like(mrbReview.mrbNo, `%${mrbNo}%`));
    if (keyword) {
      const kw = `%${keyword.trim()}%`;
      conditions.push(
        sql`(
          ${defectiveMoveTask.moveNo} ILIKE ${kw}
          OR ${defectiveMoveTask.sourceInspectionNo} ILIKE ${kw}
          OR ${mrbReview.mrbNo} ILIKE ${kw}
          OR ${material.materialCode} ILIKE ${kw}
          OR ${material.materialName}::text ILIKE ${kw}
          OR ${defectiveMoveTask.batchNo} ILIKE ${kw}
        )`,
      );
    }

    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        id: defectiveMoveTask.id,
        moveNo: defectiveMoveTask.moveNo,
        sourceInspectionNo: defectiveMoveTask.sourceInspectionNo,
        lotId: defectiveMoveTask.lotId,
        mrbId: defectiveMoveTask.mrbId,
        mrbNo: mrbReview.mrbNo,
        source: defectiveMoveTask.source,
        reason: defectiveMoveTask.reason,
        materialId: defectiveMoveTask.materialId,
        supplierId: defectiveMoveTask.supplierId,
        batchNo: defectiveMoveTask.batchNo,
        quantity: defectiveMoveTask.quantity,
        unit: defectiveMoveTask.unit,
        fromLocationId: defectiveMoveTask.fromLocationId,
        toLocationId: defectiveMoveTask.toLocationId,
        inventoryId: defectiveMoveTask.inventoryId,
        fromStockStatus: defectiveMoveTask.fromStockStatus,
        status: defectiveMoveTask.status,
        remark: defectiveMoveTask.remark,
        confirmRemark: defectiveMoveTask.confirmRemark,
        confirmedAt: defectiveMoveTask.confirmedAt,
        scanCodes: defectiveMoveTask.scanCodes,
        scanToCode: defectiveMoveTask.scanToCode,
        scanAt: defectiveMoveTask.scanAt,
        createdAt: defectiveMoveTask.createdAt,
        updatedAt: defectiveMoveTask.updatedAt,
        materialCode: material.materialCode,
        materialName: material.materialName,
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        fromLocationCode: warehouseLocation.locationCode,
        toLocationCode: toLocation.locationCode,
        // user_profile 是复合类型，取值必须显式转型，否则 42804
        operatorId: sql<string | null>`((${defectiveMoveTask.operatorId}).user_id)::text`,
        operatorName: sql<string | null>`(
          SELECT a.name FROM sys_account a
          WHERE a.id = ((${defectiveMoveTask.operatorId}).user_id)::uuid
        )`,
        createdById: sql<string | null>`((${defectiveMoveTask.createdBy}).user_id)::text`,
        createdByName: sql<string | null>`(
          SELECT a.name FROM sys_account a
          WHERE a.id = ((${defectiveMoveTask.createdBy}).user_id)::uuid
        )`,
        confirmedByName: sql<string | null>`(
          SELECT a.name FROM sys_account a
          WHERE a.id = ((${defectiveMoveTask.confirmedBy}).user_id)::uuid
        )`,
      })
      .from(defectiveMoveTask)
      .leftJoin(material, eq(defectiveMoveTask.materialId, material.id))
      .leftJoin(supplier, eq(defectiveMoveTask.supplierId, supplier.id))
      .leftJoin(mrbReview, eq(defectiveMoveTask.mrbId, mrbReview.id))
      .leftJoin(warehouseLocation, eq(defectiveMoveTask.fromLocationId, warehouseLocation.id))
      .leftJoin(toLocation, eq(defectiveMoveTask.toLocationId, toLocation.id));

    const whereQuery = whereCondition ? baseQuery.where(whereCondition) : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(defectiveMoveTask)
      .leftJoin(material, eq(defectiveMoveTask.materialId, material.id))
      .leftJoin(mrbReview, eq(defectiveMoveTask.mrbId, mrbReview.id))
      .where(whereCondition);

    const total = Number(countResult[0]?.count || 0);

    const items = await whereQuery
      .orderBy(desc(defectiveMoveTask.createdAt))
      .limit(safeSize)
      .offset((safePage - 1) * safeSize);

    return {
      items: items.map((item: any) => ({
        ...item,
        quantity: Number(item.quantity),
        createdAt: item.createdAt ? item.createdAt.toISOString() : undefined,
        updatedAt: item.updatedAt ? item.updatedAt.toISOString() : undefined,
        confirmedAt: item.confirmedAt ? item.confirmedAt.toISOString() : null,
        scanAt: item.scanAt ? item.scanAt.toISOString() : null,
      })),
      total,
      page: safePage,
      pageSize: safeSize,
    };
  }

  /** 待办数量：待执行 + 待确认（菜单角标 / 首页待办用） */
  async getPendingCount(): Promise<{ pending: number; pendingConfirm: number; total: number }> {
    const rows = (await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'pending_confirm')::int AS pending_confirm
      FROM defective_move_task
    `)) as unknown as Array<{ pending: number; pending_confirm: number }>;
    const pending = Number(rows[0]?.pending || 0);
    const pendingConfirm = Number(rows[0]?.pending_confirm || 0);
    return { pending, pendingConfirm, total: pending + pendingConfirm };
  }

  /** 单条详情（PDA 扫码作业用，带物料码/批次/数量） */
  async getTaskDetail(id: string) {
    const rows = (await this.db.execute(sql`
      SELECT t.id::text AS id,
             t.move_no AS "moveNo",
             t.source_inspection_no AS "sourceInspectionNo",
             t.batch_no AS "batchNo",
             t.quantity::numeric AS quantity,
             t.unit,
             t.status,
             t.source,
             t.reason,
             t.remark,
             t.from_stock_status AS "fromStockStatus",
             t.scan_codes AS "scanCodes",
             t.scan_to_code AS "scanToCode",
             m.material_code AS "materialCode",
             m.material_name AS "materialName",
             fl.location_code AS "fromLocationCode",
             tl.location_code AS "toLocationCode",
             mr.mrb_no AS "mrbNo"
      FROM defective_move_task t
      LEFT JOIN material m ON m.id = t.material_id
      LEFT JOIN warehouse_location fl ON fl.id = t.from_location_id
      LEFT JOIN warehouse_location tl ON tl.id = t.to_location_id
      LEFT JOIN mrb_review mr ON mr.id = t.mrb_id
      WHERE t.id = ${id}::uuid
    `)) as unknown as Array<Record<string, any>>;
    if (rows.length === 0) throw new NotFoundException('调拨单不存在');
    return rows[0];
  }

  /**
   * 不良品仓的可选库位。
   *
   * 仓库执行调拨时必须落到 `warehouse.wh_type = 'defective'` 的库位 ——
   * 如果允许随便选库位，货可能被搬回良品区，后面的退货出库/报废销毁会全部取不到货。
   * 注意：这份列表只用于「扫码后回显仓库名」和扫码校验，前端不允许直接下拉选择。
   */
  async getDefectiveLocations() {
    const rows = (await this.db.execute(sql`
      SELECT l.id::text AS id,
             l.location_code AS "locationCode",
             w.wh_code AS "whCode",
             w.wh_name_zh AS "whNameZh",
             w.wh_name_en AS "whNameEn",
             (SELECT COUNT(*)::int FROM inventory i WHERE i.location_id = l.id AND i.quantity > 0) AS "stockRows"
      FROM warehouse_location l
      JOIN warehouse w ON w.id = l.warehouse_id
      WHERE w.wh_type = 'defective'
        AND l.status = 'active'
        AND w.status = 'active'
      ORDER BY l.location_code
    `)) as unknown as Record<string, any>[];
    return rows;
  }

  /**
   * 制单可选的来源库存（良品仓，未锁定，可用量 > 0）。
   *
   * 已经在待确认/待执行手工单里的库存行会被排除，避免同一批货被两张单同时占用。
   */
  async getSourceStock(params: { keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
    const kw = (params.keyword || '').trim();
    const kwLike = `%${kw}%`;

    const keywordCond = kw
      ? sql`AND (m.material_code ILIKE ${kwLike} OR m.material_name::text ILIKE ${kwLike}
               OR i.batch_no ILIKE ${kwLike} OR l.location_code ILIKE ${kwLike})`
      : sql``;

    const base = sql`
      FROM inventory i
      JOIN material m ON m.id = i.material_id
      JOIN warehouse_location l ON l.id = i.location_id
      JOIN warehouse w ON w.id = l.warehouse_id
      LEFT JOIN supplier s ON s.id = i.supplier_id
      WHERE i.stock_status = 'good'
        AND i.locked = false
        AND i.quantity > 0
        AND w.wh_type <> 'defective'
        AND w.status = 'active'
        AND l.status = 'active'
        ${keywordCond}
        AND NOT EXISTS (
          SELECT 1 FROM defective_move_task t
          WHERE t.inventory_id = i.id AND t.status IN ('pending_confirm', 'pending')
        )
    `;

    const rows = (await this.db.execute(sql`
      SELECT i.id::text AS "inventoryId",
             m.material_code AS "materialCode",
             m.material_name AS "materialName",
             i.batch_no AS "batchNo",
             i.quantity::numeric AS "availableQty",
             i.unit,
             i.supplier_id::text AS "supplierId",
             s.supplier_name AS "supplierName",
             i.production_date AS "productionDate",
             l.id::text AS "locationId",
             l.location_code AS "locationCode",
             w.wh_code AS "whCode",
             w.wh_name_zh AS "whNameZh"
      ${base}
      ORDER BY m.material_code, i.batch_no, l.location_code
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `)) as unknown as Record<string, any>[];

    const totalRows = (await this.db.execute(sql`
      SELECT COUNT(*)::int AS total ${base}
    `)) as unknown as Array<{ total: number }>;

    return { items: rows, total: Number(totalRows[0]?.total || 0), page, pageSize };
  }

  // =========================================================================
  // 二、制单 → 主管确认 → 执行
  // =========================================================================

  /**
   * 制单（仓管员）：良品仓库存 → 不良品仓。
   *
   * 制单阶段**不锁库存**：制单只是「我要搬」的申请，真正生效要主管确认。
   * 如果制单就锁，仓管员随手建单就能把正常发料的货锁死。
   */
  async createOrder(
    params: {
      inventoryId: string;
      quantity: number;
      reason: string;
      remark?: string;
      toLocationId?: string;
    },
    operatorId: string,
  ) {
    const { inventoryId, reason } = params;
    const quantity = Number(params.quantity);

    if (!inventoryId) throw new BadRequestException('请选择来源库存');
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('调拨数量必须大于 0');
    }
    if (!reason || !reason.trim()) {
      throw new BadRequestException('请填写调拨原因（如：生产过程中发现外观不良）');
    }

    const stockRows = (await this.db.execute(sql`
      SELECT i.id::text AS id,
             i.material_id::text AS material_id,
             i.location_id::text AS location_id,
             i.batch_no,
             i.quantity::numeric AS quantity,
             i.unit,
             i.stock_status,
             i.locked,
             i.lock_reason,
             i.supplier_id::text AS supplier_id,
             w.wh_type,
             w.status AS wh_status,
             l.status AS loc_status
      FROM inventory i
      JOIN warehouse_location l ON l.id = i.location_id
      JOIN warehouse w ON w.id = l.warehouse_id
      WHERE i.id = ${inventoryId}::uuid
    `)) as unknown as Array<Record<string, any>>;

    if (stockRows.length === 0) throw new NotFoundException('来源库存不存在');
    const stock = stockRows[0];

    if (stock.wh_type === 'defective') {
      throw new BadRequestException('来源库位已是不良品仓，无需调拨');
    }
    if (stock.loc_status !== 'active' || stock.wh_status !== 'active') {
      throw new BadRequestException('来源库位或仓库已停用');
    }
    if (stock.stock_status !== 'good') {
      throw new BadRequestException(`来源库存状态为 ${stock.stock_status}，只有良品库存可以手工调拨`);
    }
    if (stock.locked) {
      throw new BadRequestException(
        `来源库存已被锁定（${stock.lock_reason || '占用中'}），请先解除占用再制单`,
      );
    }

    const available = Number(stock.quantity || 0);
    if (quantity > available + 1e-9) {
      throw new BadRequestException(`调拨数量超过可用库存（可用 ${available}）`);
    }

    const duplicated = (await this.db.execute(sql`
      SELECT move_no FROM defective_move_task
      WHERE inventory_id = ${inventoryId}::uuid
        AND status IN ('pending_confirm', 'pending')
      LIMIT 1
    `)) as unknown as Array<{ move_no: string }>;
    if (duplicated.length > 0) {
      throw new ConflictException(
        `该库存行已有待处理的调拨单（${duplicated[0].move_no}），请勿重复制单`,
      );
    }

    const moveNo = await nextDefectiveMoveNo(this.db);

    const inserted = await this.db
      .insert(defectiveMoveTask)
      .values({
        moveNo,
        lotId: null,
        materialId: stock.material_id,
        supplierId: stock.supplier_id || null,
        batchNo: stock.batch_no || '',
        quantity: String(quantity),
        unit: stock.unit,
        fromLocationId: stock.location_id,
        toLocationId: params.toLocationId || null,
        inventoryId: stock.id,
        fromStockStatus: 'good',
        status: ST_PENDING_CONFIRM,
        source: 'manual',
        reason: reason.trim(),
        remark: params.remark?.trim() || null,
        createdBy: operatorId || null,
      })
      .returning({ id: defectiveMoveTask.id, moveNo: defectiveMoveTask.moveNo });

    const created = inserted[0];

    // 通知仓库主管：有单待确认
    await this.notifyManagers(
      `不良品调拨待确认：${moveNo}`,
      [
        `调拨数量：${quantity} ${stock.unit || ''}`.trim(),
        `调拨原因：${reason.trim()}`,
        '请到「库存 → 不良品调拨」确认生效后，仓管员才能执行扫码调拨。',
      ].join('\n'),
      created?.id,
      moveNo,
      operatorId,
    );

    return { id: created?.id, moveNo, status: ST_PENDING_CONFIRM };
  }

  /**
   * 主管确认 / 驳回。
   *
   * 确认生效时**锁库存**（`locked=true` + `DEFECTIVE-MOVE:<单号>`）：
   * 货已经确定要搬走，不能再被拣货/发料消耗掉，否则执行时必然「库存不足」。
   */
  async confirmOrder(
    id: string,
    params: { approve: boolean; remark?: string },
    operator: { userId: string; name?: string },
  ) {
    if (!id) throw new BadRequestException('缺少单据ID');

    const result = await this.db.transaction(async (tx) => {
      const lockedRows = (await tx.execute(sql`
        SELECT * FROM defective_move_task WHERE id = ${id}::uuid FOR UPDATE
      `)) as unknown as Array<Record<string, any>>;
      if (lockedRows.length === 0) throw new NotFoundException('调拨单不存在');
      const task = lockedRows[0];
      if (task.status !== ST_PENDING_CONFIRM) {
        throw new ConflictException('该单据已处理，请刷新');
      }

      if (!params.approve) {
        await tx
          .update(defectiveMoveTask)
          .set({
            status: ST_CANCELLED,
            confirmedBy: operator.userId || null,
            confirmedAt: new Date(),
            confirmRemark: params.remark?.trim() || '主管驳回',
            updatedAt: new Date(),
          })
          .where(eq(defectiveMoveTask.id, id));
        return { status: ST_CANCELLED, moveNo: task.move_no as string, createdBy: task.created_by };
      }

      if (!task.inventory_id) {
        throw new ConflictException('单据未记录来源库存行，无法生效（请作废后重新制单）');
      }

      const invRows = (await tx.execute(sql`
        SELECT * FROM inventory WHERE id = ${task.inventory_id}::uuid FOR UPDATE
      `)) as unknown as Array<Record<string, any>>;
      if (invRows.length === 0) {
        throw new ConflictException('来源库存行已不存在（可能已被其它单据消耗），请作废后重新制单');
      }
      const inv = invRows[0];
      if (inv.locked && String(inv.lock_reason || '').startsWith('MRB-')) {
        throw new ConflictException('来源库存已被 MRB 占用，不能调拨');
      }
      if (inv.locked && !String(inv.lock_reason || '').startsWith(MANUAL_LOCK_PREFIX)) {
        throw new ConflictException(`来源库存已被锁定：${inv.lock_reason || '占用中'}`);
      }
      if (inv.stock_status !== 'good') {
        throw new ConflictException(`来源库存状态已变为 ${inv.stock_status}，请核对`);
      }

      const want = Number(task.quantity || 0);
      const have = Number(inv.quantity || 0);
      if (have + 1e-9 < want) {
        throw new ConflictException(`库存不足：单据需调拨 ${want}，当前可用 ${have}`);
      }

      await tx
        .update(inventory)
        .set({
          locked: true,
          lockReason: `${MANUAL_LOCK_PREFIX}${task.move_no}`,
          updatedAt: new Date(),
        })
        .where(eq(inventory.id, task.inventory_id));

      await tx
        .update(defectiveMoveTask)
        .set({
          status: ST_PENDING,
          confirmedBy: operator.userId || null,
          confirmedAt: new Date(),
          confirmRemark: params.remark?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(defectiveMoveTask.id, id));

      return { status: ST_PENDING, moveNo: task.move_no as string, createdBy: task.created_by };
    });

    // 通知制单人：单子生效了，可以去扫码执行
    const creatorId = this.extractUserId(result.createdBy);
    if (creatorId) {
      await this.noticeService.pushMany({
        userIds: [creatorId],
        title: `不良品调拨单已生效：${result.moveNo}`,
        content: `仓库主管已确认。请到「库存 → 不良品调拨」扫码执行，搬入不良品仓。`,
        bizType: 'defective_move',
        bizId: id,
        bizNo: result.moveNo,
        createdBy: operator.userId || null,
      });
    }

    return result;
  }

  /** 作废 / 撤销：待确认可由制单人撤销，待执行只能由仓库主管作废；已锁库存同步解锁 */
  async cancelOrder(
    id: string,
    params: { reason?: string },
    operator: { userId: string; roleCode?: string },
  ) {
    if (!id) throw new BadRequestException('缺少单据ID');
    const isManager = ['wh_manager', 'admin'].includes(operator.roleCode || '');

    await this.db.transaction(async (tx) => {
      const lockedRows = (await tx.execute(sql`
        SELECT * FROM defective_move_task WHERE id = ${id}::uuid FOR UPDATE
      `)) as unknown as Array<Record<string, any>>;
      if (lockedRows.length === 0) throw new NotFoundException('调拨单不存在');
      const task = lockedRows[0];

      if (![ST_PENDING_CONFIRM, ST_PENDING].includes(task.status)) {
        throw new ConflictException('只有待确认 / 待执行的单据可以作废');
      }

      const creatorId = this.extractUserId(task.created_by);
      if (task.status === ST_PENDING && !isManager) {
        throw new BadRequestException('单据已生效，只有仓库主管可以作废');
      }
      if (task.status === ST_PENDING_CONFIRM && !isManager && creatorId !== operator.userId) {
        throw new BadRequestException('只有制单人本人或仓库主管可以撤销');
      }

      if (task.status === ST_PENDING && task.inventory_id) {
        const invRows = (await tx.execute(sql`
          SELECT * FROM inventory WHERE id = ${task.inventory_id}::uuid FOR UPDATE
        `)) as unknown as Array<Record<string, any>>;
        const inv = invRows[0];
        if (
          inv &&
          inv.locked &&
          String(inv.lock_reason || '').startsWith(`${MANUAL_LOCK_PREFIX}${task.move_no}`)
        ) {
          await tx
            .update(inventory)
            .set({ locked: false, lockReason: null, updatedAt: new Date() })
            .where(eq(inventory.id, task.inventory_id));
        }
      }

      await tx
        .update(defectiveMoveTask)
        .set({
          status: ST_CANCELLED,
          confirmRemark: params.reason?.trim() || '手工作废',
          updatedAt: new Date(),
        })
        .where(eq(defectiveMoveTask.id, id));
    });

    return { success: true };
  }

  // =========================================================================
  // 三、扫码
  // =========================================================================

  /**
   * 校验单个货物标签：必须与本单的物料 + 批次一致。
   *
   * 前端每扫一箱调一次，能立刻给出「这箱不是本单的货」；提交时再全量重校验，
   * 防止绕过前端直接调接口。
   */
  async scanCode(id: string, code: string) {
    const task = await this.loadTaskForScan(id);
    return this.matchCode(task, code);
  }

  private async loadTaskForScan(id: string) {
    const rows = (await this.db.execute(sql`
      SELECT t.id::text AS id,
             t.move_no AS "moveNo",
             t.status,
             t.batch_no AS "batchNo",
             t.quantity::numeric AS "quantity",
             t.unit,
             m.material_code AS "materialCode",
             m.material_name AS "materialName",
             fl.location_code AS "fromLocationCode"
      FROM defective_move_task t
      LEFT JOIN material m ON m.id = t.material_id
      LEFT JOIN warehouse_location fl ON fl.id = t.from_location_id
      WHERE t.id = ${id}::uuid
    `)) as unknown as Array<Record<string, any>>;
    if (rows.length === 0) throw new NotFoundException('调拨单不存在');
    const task = rows[0];
    if (task.status !== ST_PENDING) {
      throw new BadRequestException('该单据当前不可执行调拨');
    }
    return task;
  }

  /** 标签 ↔ 单据比对（物料 + 批次，缺一不可） */
  private matchCode(task: Record<string, any>, rawCode: string) {
    const code = (rawCode || '').trim();
    if (!code) throw new BadRequestException('扫描内容为空');

    const parsed = parseLabelCode(code);
    if (!parsed) throw new BadRequestException('无法识别的标签内容');

    const expectMaterial = String(task.materialCode || '').trim();
    const expectBatch = String(task.batchNo || '').trim();

    if (parsed.structured) {
      if (parsed.materialCode && expectMaterial && parsed.materialCode !== expectMaterial) {
        throw new BadRequestException(
          `物料不符：扫描的是 ${parsed.materialCode}，本单应为 ${expectMaterial}`,
        );
      }
      if (parsed.batchNo && expectBatch && parsed.batchNo !== expectBatch) {
        throw new BadRequestException(
          `批次不符：扫描的是 ${parsed.batchNo}，本单应为 ${expectBatch}`,
        );
      }
      return {
        matched: true,
        code,
        materialCode: parsed.materialCode || expectMaterial,
        materialName: task.materialName,
        batchNo: parsed.batchNo || expectBatch,
        qty: parsed.quantity ?? null,
        unit: task.unit,
        expectQty: Number(task.quantity || 0),
        expectMaterial,
        expectBatch,
      };
    }

    // 非六段码：允许扫「物料码」或「批次号」单值，任一命中即可
    if (expectMaterial && code === expectMaterial) {
      return {
        matched: true,
        code,
        materialCode: expectMaterial,
        materialName: task.materialName,
        batchNo: expectBatch,
        qty: null,
        unit: task.unit,
        expectQty: Number(task.quantity || 0),
        expectMaterial,
        expectBatch,
      };
    }
    if (expectBatch && code === expectBatch) {
      return {
        matched: true,
        code,
        materialCode: expectMaterial,
        materialName: task.materialName,
        batchNo: expectBatch,
        qty: null,
        unit: task.unit,
        expectQty: Number(task.quantity || 0),
        expectMaterial,
        expectBatch,
      };
    }
    throw new BadRequestException(
      `条码无法匹配本单：本单物料 ${expectMaterial || '-'}，批次 ${expectBatch || '-'}`,
    );
  }

  // =========================================================================
  // 四、执行调拨
  // =========================================================================

  /**
   * 执行调拨（扫码）。
   *
   * 服务端强制校验：
   *  1. 至少扫一个货物标签，且每个标签的物料 + 批次都必须与本单一致；
   *  2. 目标库位码必须**精确命中**不良品仓的启用库位（不再接受库位 ID 直传）；
   *  3. 手工单按 `inventory_id` 精确扣减（制单时锁定的那一行），MRB 单按锁标记族定位；
   *  4. 来源状态 / lock_reason 必须跟随，`scrapped` 不能写成 `defective`，
   *     否则同批次退货行与待销毁行会被唯一键合并，数量再也分不清。
   */
  async completeTask(
    id: string,
    params: { scannedCodes?: string[]; toLocationCode?: string },
    operatorId: string,
  ) {
    if (!id) throw new BadRequestException('缺少任务ID');

    const scannedCodes = (params.scannedCodes || []).map((c) => (c || '').trim()).filter(Boolean);
    if (scannedCodes.length === 0) {
      throw new BadRequestException('请先扫描货物标签（扫一箱即可，必须与本单物料、批次一致）');
    }
    const toCode = (params.toLocationCode || '').trim();
    if (!toCode) {
      throw new BadRequestException('请扫描不良品仓的库位地址码');
    }

    // 1. 目标库位：按库位码精确匹配 + 必须属不良品仓
    const locRows = (await this.db.execute(sql`
      SELECT l.id::text AS id, l.location_code, l.status, w.wh_type
      FROM warehouse_location l
      JOIN warehouse w ON w.id = l.warehouse_id
      WHERE l.location_code = ${toCode}
        AND w.wh_type = 'defective'
      LIMIT 1
    `)) as unknown as Array<Record<string, any>>;
    if (locRows.length === 0) {
      throw new BadRequestException(`库位码 ${toCode} 不属于不良品仓，或库位不存在`);
    }
    if (locRows[0].status !== 'active') {
      throw new BadRequestException(`库位 ${toCode} 已停用，请换一个不良品库位`);
    }
    const targetId = locRows[0].id as string;

    // 2. 任务基础校验
    const taskRows = (await this.db.execute(sql`
      SELECT * FROM defective_move_task WHERE id = ${id}::uuid
    `)) as unknown as Array<Record<string, any>>;
    if (taskRows.length === 0) throw new NotFoundException('移库任务不存在');
    const task = taskRows[0];
    if (task.status !== ST_PENDING) {
      throw new BadRequestException(
        task.status === ST_PENDING_CONFIRM
          ? '该单据尚未经仓库主管确认，不能执行'
          : '该任务已完成或已作废',
      );
    }

    // 3. 全量复核扫码内容（防绕过前端）
    const materialRow = (await this.db.execute(sql`
      SELECT material_code, material_name FROM material WHERE id = ${task.material_id}::uuid
    `)) as unknown as Array<{ material_code: string; material_name: string }>;
    const scanCtx = {
      materialCode: materialRow[0]?.material_code,
      materialName: materialRow[0]?.material_name,
      batchNo: task.batch_no,
      quantity: Number(task.quantity || 0),
      unit: task.unit,
    };
    for (const code of scannedCodes) {
      this.matchCode(scanCtx, code);
    }

    let movedQty = 0;
    let movedStatus = 'defective';

    try {
      await this.db.transaction(async (tx) => {
      // 4. 行级锁：同一任务被两个人同时扫码提交时，只有一个人能搬
      const lockedRows = (await tx.execute(sql`
        SELECT * FROM defective_move_task WHERE id = ${id}::uuid FOR UPDATE
      `)) as unknown as Array<Record<string, any>>;
      if (lockedRows.length === 0) throw new NotFoundException('移库任务不存在');
      const locked = lockedRows[0];
      if (locked.status !== ST_PENDING) throw new ConflictException('任务已被处理，请刷新');

      const isManual = locked.source === 'manual';
      const isScrap = locked.source === 'mrb_scrap';

      let row: Record<string, any> | null = null;

      if (isManual) {
        // 手工单：只认制单时锁定的那一行，避免同批次多行被「优先排序」搬错。
        // 注意必须用 drizzle 查询（驼峰字段），不能走 tx.execute 拿原始行 ——
        // 后者是 snake_case，后面统一按 `row.materialId` 取值会全部 undefined。
        const invRows = await tx
          .select()
          .from(inventory)
          .where(eq(inventory.id, locked.inventory_id))
          .for('update');
        if (invRows.length === 0) {
          throw new ConflictException('来源库存行已不存在，请核对库存后作废重制');
        }
        row = invRows[0] as any;
        const lockOk =
          !row!.locked ||
          String(row!.lockReason || '').startsWith(`${MANUAL_LOCK_PREFIX}${locked.move_no}`);
        if (!lockOk) {
          throw new ConflictException(`来源库存已被其它单据占用：${row!.lockReason || ''}`);
        }
        if (row!.stockStatus !== 'good') {
          throw new ConflictException(`来源库存状态已变为 ${row!.stockStatus}，请核对`);
        }
      } else {
        // MRB 单：状态必须按来源收窄。
        // 同批次可能同时存在「退货冻结行 defective」和「待销毁行 scrapped」，
        // 若只按 lock_reason 排序而不限状态，退货任务会把待销毁的量搬走。
        const candidateStatuses = isScrap ? ['scrapped'] : ['defective', 'good'];
        const lockMarker = isScrap ? `MRB-SCRAP:${locked.mrb_id}` : 'MRB-RETURN:';
        const preferredStatus = isScrap ? 'scrapped' : 'defective';

        const invRows = await tx
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.materialId, locked.material_id),
              eq(inventory.batchNo, locked.batch_no ?? ''),
              eq(inventory.locationId, locked.from_location_id),
              inArray(inventory.stockStatus, candidateStatuses),
              eq(inventory.locked, true),
            ),
          )
          .orderBy(
            sql`CASE
              WHEN ${inventory.lockReason} LIKE ${lockMarker + '%'} THEN 0
              WHEN ${inventory.stockStatus} = ${preferredStatus} THEN 1
              ELSE 2
            END`,
            inventory.createdAt,
          )
          .limit(1);

        if (invRows.length === 0) {
          throw new ConflictException(
            `未找到待调拨库存（物料 ${locked.material_id}，批次 ${locked.batch_no || '-'}），请先核对原库位库存`,
          );
        }
        row = invRows[0] as any;
      }

      const have = Number(row!.quantity || 0);
      const want = Number(locked.quantity || 0);
      if (have <= 0) {
        throw new ConflictException('来源库存数量为 0，无需调拨，请核对库存');
      }
      // 任务量大于现存：说明期间被其它单据动过，硬报错比「搬一半也算完成」安全
      if (want > 0 && have + 1e-9 < want) {
        throw new ConflictException(
          `库存不足：单据需调拨 ${want}，原库位现存 ${have}，请核对后再执行`,
        );
      }

      if (isManual) {
        movedStatus = 'defective';
      } else {
        movedStatus = row!.stockStatus === 'scrapped' ? 'scrapped' : 'defective';
      }
      movedQty = want > 0 ? Math.min(have, want) : have;
      const remain = Number((have - movedQty).toFixed(4));

      let targetBalance = movedQty;
      const sameLocation = row!.locationId === targetId;

      if (!sameLocation) {
        // 目标库位是否已有同物料 + 同批次 + 同状态的行（唯一键口径）
        const existing = await tx
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.materialId, locked.material_id),
              eq(inventory.locationId, targetId),
              eq(inventory.batchNo, row!.batchNo ?? ''),
              eq(inventory.stockStatus, movedStatus),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          targetBalance = Number((Number(existing[0].quantity || 0) + movedQty).toFixed(4));
          await tx
            .update(inventory)
            .set({
              quantity: String(targetBalance),
              // MRB 冻结行搬过去后仍带锁标记；手工调拨的不良品不再带锁（defective 状态本身即不可发料）
              locked: isManual ? false : existing[0].locked || !!row!.lockReason,
              lockReason: isManual
                ? null
                : existing[0].lockReason ?? row!.lockReason ?? null,
              updatedAt: new Date(),
            })
            .where(eq(inventory.id, existing[0].id));
        } else if (remain > 0) {
          // 只有「部分搬移」才需要新建目标行；
          // 整行搬走（remain = 0）时走下面的「整行换库位」，否则会先插一行再改源行库位，
          // 直接撞 (物料, 库位, 批次, 状态) 唯一键 → 23505。
          await tx.insert(inventory).values({
            materialId: row!.materialId,
            locationId: targetId,
            batchNo: row!.batchNo ?? '',
            supplierId: row!.supplierId,
            quantity: String(movedQty),
            unit: row!.unit,
            stockStatus: movedStatus,
            productionDate: row!.productionDate,
            // MRB 冻结行保留锁定；手工调拨只是把状态改成不良品，无需长期锁
            locked: !isManual,
            lockReason: isManual ? null : row!.lockReason ?? 'IQC检验不合格',
            isSpecialAdmit: row!.isSpecialAdmit,
            specialAdmitRef: row!.specialAdmitRef,
            // label_no 全局唯一，来源行还占着，新行不能带
            labelNo: null,
          });
        }

        if (remain > 0) {
          // 部分搬移：来源留余量。手工单要把占用锁释放掉（单据已执行完）
          await tx
            .update(inventory)
            .set({
              quantity: String(remain),
              ...(isManual ? { locked: false, lockReason: null } : {}),
              updatedAt: new Date(),
            })
            .where(eq(inventory.id, row!.id));
        } else if (existing.length > 0) {
          // 整行并入已有目标行
          await tx.delete(inventory).where(eq(inventory.id, row!.id));
        } else {
          // 整行换库位：状态与 lock_reason 必须跟随来源（MRB），手工单则清锁
          await tx
            .update(inventory)
            .set({
              locationId: targetId,
              stockStatus: movedStatus,
              ...(isManual
                ? { locked: false, lockReason: null }
                : {
                    locked: true,
                    lockReason: row!.lockReason ?? 'IQC检验不合格',
                  }),
              updatedAt: new Date(),
            })
            .where(eq(inventory.id, row!.id));
        }

        // 5. 库存流水（移出 + 移入两条，审计能看出「从哪搬到哪」）
        const referenceNo =
          (locked.move_no as string) ||
          (locked.mrb_id
            ? (
                (await tx.execute(sql`
                  SELECT mrb_no FROM mrb_review WHERE id = ${locked.mrb_id}::uuid
                `)) as unknown as Array<{ mrb_no: string }>
              )[0]?.mrb_no || null
            : null);
        const txNo = (locked.move_no as string) || `DM-${String(locked.id).slice(0, 8).toUpperCase()}`;
        const remark = locked.remark || locked.reason || '不良品调拨';
        const createdByExpr = operatorId
          ? sql`ROW(${operatorId})::user_profile`
          : sql`null`;

        // 盘点冻结守卫：不良品调拨会改变源/目标库位库存
        await assertLocationNotFrozen(tx, row!.locationId, '不良品调拨出库');
        await assertLocationNotFrozen(tx, targetId, '不良品调拨入库');

        await tx.execute(sql`
          INSERT INTO inventory_transaction
            (material_id, location_id, batch_no, stock_status, tx_type, tx_no, qty, balance_after, unit, reference_no, remark, _created_by)
          VALUES
            (${row!.materialId}::uuid, ${row!.locationId}::uuid, ${row!.batchNo ?? ''}, ${movedStatus},
             'defective_move_out', ${txNo}, ${String(-movedQty)}, ${String(remain)}, ${row!.unit},
             ${referenceNo}, ${remark}, ${createdByExpr})
        `);
        await tx.execute(sql`
          INSERT INTO inventory_transaction
            (material_id, location_id, batch_no, stock_status, tx_type, tx_no, qty, balance_after, unit, reference_no, remark, _created_by)
          VALUES
            (${row!.materialId}::uuid, ${targetId}::uuid, ${row!.batchNo ?? ''}, ${movedStatus},
             'defective_move_in', ${txNo}, ${String(movedQty)}, ${String(targetBalance)}, ${row!.unit},
             ${referenceNo}, ${remark}, ${createdByExpr})
        `);
      }

      // 6. 任务完成：记录实际落位与扫码凭据
      await tx
        .update(defectiveMoveTask)
        .set({
          toLocationId: targetId,
          status: ST_COMPLETED,
          operatorId: operatorId || null,
          scanCodes: JSON.stringify(scannedCodes),
          scanToCode: toCode,
          scanAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(defectiveMoveTask.id, id));
      });
    } catch (e: any) {
      // 异常过滤器会把 PG 的 not_null_violation 等统一成「必填字段缺失」，
      // 这里把原始信息打进日志，便于定位是哪一列
      this.logger.error(`不良品调拨执行失败：${e?.message || e}`);
      throw e;
    }

    return {
      success: true,
      message: '调拨完成',
      quantity: movedQty,
      stockStatus: movedStatus,
      toLocationCode: toCode,
    };
  }

  // =========================================================================
  // 五、内部工具
  // =========================================================================

  /** user_profile 值可能是 `(uuid)` 或 `uuid`，统一取出 uuid */
  private extractUserId(value: any): string | null {
    if (!value) return null;
    const text = String(value);
    const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : null;
  }

  private async notifyManagers(
    title: string,
    content: string,
    bizId?: string | null,
    bizNo?: string | null,
    createdBy?: string | null,
  ) {
    try {
      const rows = (await this.db.execute(sql`
        SELECT id::text AS id FROM sys_account
        WHERE role_code IN ('wh_manager') AND status = 'active'
      `)) as unknown as Array<{ id: string }>;
      if (rows.length === 0) return;
      await this.noticeService.pushMany({
        userIds: rows.map((r) => r.id),
        title,
        content,
        bizType: 'defective_move',
        bizId: bizId || null,
        bizNo: bizNo || null,
        createdBy: createdBy || null,
      });
    } catch (e: any) {
      // 消息失败不能回滚已经落库的单据
      this.logger.warn(`推送不良品调拨待确认消息失败：${e?.message || e}`);
    }
  }
}
